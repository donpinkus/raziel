# Goal

Build a browser‑based system that listens to **live guitar** (mic/DI), detects **polyphonic notes in near‑real time**, and tells the user whether the **intended chord tones** are correct so they can **progress to the next note/chord** with low perceived latency.

---

## Constraints & Targets

- **Environment:** Web app, client‑side; avoid server round‑trip. Optional server fallback permitted.
- **Instrument:** 6‑string guitar; clean or moderately overdriven tones.
- **Polyphony:** Chords + arpeggios; simultaneous notes common.
- **Latency target (user‑perceived):** Desktop: 180–250 ms median; <300 ms p95. Mobile: 220–320 ms median; <380 ms p95 (shorter W/tail on low‑end).
- **Accuracy target:** ≥95% correct identification of target chord tones on clean DI; ≥90% on mic’d acoustic; ≥85% on moderate distortion. Octave‑invariant.
- **Robustness:** Handle strums, vibrato, bends, pull‑offs/hammer‑ons, sympathetic ring.
- **Privacy:** Audio remains on‑device by default.

Non‑goals (Phase 1): key/scale estimation, automatic chord naming from scratch, score alignment, full transcription export (nice to have).

---

## Research & Approach Summary

### Model choices

- **Primary:** **Basic Pitch** (Spotify) — polyphonic AMT model; robust on guitar; exports note events with pitch‑bend and timings. Runs in JS/TS via a packaged model and can execute fully in the browser (TF.js / WASM/WebGL/WebGPU depending on build).
- **Optional parallel mono path:** **CREPE** (or similar) for very fast single‑F0 feedback if we introduce single‑note drills. Not required for chord correctness, but available as a latency optimization for melody‑only exercises.

### Streaming pattern (to make Basic Pitch “feel realtime”)

Basic Pitch is window‑based. We emulate streaming by keeping a **rolling window** of recent audio and re‑running inference at a **fixed cadence**. We then **emit only new onsets** detected near the tail of the window. This yields consistent, low‑jitter updates while preserving enough context for stable polyphonic estimates.

### Chord correctness decision

We compare the set of **detected pitches** in the tail of the window to the **expected chord tones** (pitch classes), with octave invariance. We expose three policies:

1. **K‑of‑N policy** (default): a chord is “correct” if at least **K** of the **N** expected pitch classes are active above threshold for M frames in the tail (e.g., K=2 for triads, K=3 when we want full confirmation).
2. **Includes‑target policy:** treat success as “target pitch class present” (useful for step‑wise note practice while a chord is ringing).
3. **Bass‑priority policy:** success if **lowest active** detected note matches one of the expected pitch classes (good for exercises that emphasize the bass/root).

### Key engineering decisions

- **Window length (W):** 1.3 s (tune 1.2–1.5). Enough context to reduce octave flips & onset transients for guitar.
- **Tick cadence (Δ):** 40 ms (25 Hz UI updates).
- **Decision tail (G):** last 120 ms of the window; only consider onsets in [now−G−ε, now].
- **Confirmation:** require ≥2–3 consecutive 20–40 ms frames above threshold (≈60–120 ms persistence) within ±50 cents to declare “present.”
- **Guitar range gate:** default **E2–E6** (~82.41–1318.51 Hz); allow **Drop‑D**/alternate tunings via `minF0Hz` (e.g., **D2** ≈ 73.42 Hz). Gate is configurable per exercise.
- **Preprocessing:** disable AGC/NS/EC in `getUserMedia`. Optional gentle low‑pass (~5 kHz) for high‑gain tones. Optional HPSS (percussive suppression) if transient leakage is an issue.

---

## System Architecture

### High‑level dataflow

**Mic → AudioWorklet (48 kHz) → SAB Ring Buffer (mono float32) → Worker (every 40 ms):**

1. Pull last **W** seconds into a contiguous buffer; resample to 22.05 kHz if needed.
2. Create an `AudioBuffer` (or raw Float32Array, depending on model API).
3. Run **Basic Pitch** inference on the window.
4. Convert framewise outputs → note events; filter events with onsets in **tail**.
5. Aggregate to **pitch classes**; apply **policy (K‑of‑N, etc.)** with confirmation.
6. Emit events to UI (`onChordDetected`, `onCorrect`, debug diagnostics).

### Threads & isolation

- **Audio thread:** `AudioWorkletProcessor` writes to a **SharedArrayBuffer** ring. Requires COOP/COEP headers for cross‑origin isolation.
- **Inference thread:** Web Worker (optionally **Worker + WebGPU** backend). Keeps Basic Pitch model warm and avoids blocking UI.
- **UI thread:** React app; renders status, advances exercise state machine.

### Runtime backends & fallbacks

- **Primary backends:** Prefer **WebGPU** → **WebGL** → **WASM** in that order for TF.js or ONNX Runtime Web builds.
- **ONNX option:** Keep an **ONNX Runtime Web** build alongside TF.js; choose at runtime based on feature detection and perf probes. Warm up the chosen backend (1 dummy inference) before enabling UI progression.
- **Quantization:** Provide fp16 and int8 variants for low‑end devices; expose a debug toggle.
- **SAB fallback:** If cross‑origin isolation is unavailable, fall back to Worklet ↔ Worker messaging (chunked `Float32Array`). Expect +20–40 ms latency; reduce `W` and `tailMs` accordingly to compensate.

### Mobile & performance tiers

- **Tier A (desktop/laptop):** W=1.3–1.5 s, tail=120 ms, framesConfirm=3.
- **Tier B (modern phones/tablets):** W=1.1–1.3 s, tail=100–120 ms, framesConfirm=3; prefer WebGPU/WebGL.
- **Tier C (low‑end/mobile WASM):** W=1.0–1.2 s, tail=90–110 ms, framesConfirm=2–3; optionally downsample the input earlier (e.g., to 16 kHz) if acceptable.

### Packaging

- **Model assets** served via static hosting / CDN; prefetch on app load.
- **Code splitting**: lazy‑load the inference worker after permissions granted.
- **Caching**: `CacheStorage` for model weights; versioned URLs for cache bust.

---

## Detailed Implementation Design

### 1) Audio acquisition & ring buffer

- **Constraints:**

  ```js
  navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      sampleRate: { ideal: 48000 },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
  ```

- **AudioWorklet** writes frames into a **SAB ring** with atomic head/tail indices.
- **Ring sizing:** at least `W + 0.5 s` worth of samples + margin; e.g., 2 s at 48 kHz → 96,000 floats.

**SAB layout**

- Header (Int32Array): `writeIdx`, `readIdx`, `capacity`.
- Data (Float32Array): mono samples.

### 2) Resampling (48 kHz → 22.05 kHz)

- **Method:** polyphase/linear interpolation in Worker (fast, deterministic). Keep state between ticks for continuity.
- **Hop:** We resample the entire W‑window each tick (simple, reliable). For optimization, maintain a downsampled rolling buffer.

### 3) Inference windowing cadence

- **Tick:** every 40 ms (use `setInterval` in Worker or a postMessage clock from UI).
- **Window:** last 1.3 s of downsampled audio → `AudioBuffer` (1 ch, 22050 Hz).
- Run **Basic Pitch** once per tick.

### 4) Post‑processing to notes

- Convert model frames to note events with start/end **times** and **MIDI** numbers plus optional cents offset.
- **Dedupe:** track `lastPublishedOnsetTime`. Publish only events with `startTime ∈ [now−G−ε, now]` and `startTime > lastPublishedOnsetTime`.
- **Range gate:** discard notes outside E2–E6.
- **Smoothing:** median/HMM on per‑note activation if outputs are frame‑level.

### 5) Chord correctness logic

- **Inputs:**

  - `expected: PitchClassSet` — e.g., `{E, G, B}` for E minor. Provide helpers to parse textual chord specs (e.g., via `tonal` library) to pitch classes.
  - `policy: 'K_OF_N' | 'INCLUDES_TARGET' | 'BASS_PRIORITY'`
  - thresholds: `centsTol=50`, `energyTol`, `framesConfirm=3`.

- **Aggregation:** For each note event active in `[now−G, now]`, compute **pitch class** `pc = midi % 12` and accumulate **salience**.
- **Decision:**

  - _K‑of‑N:_ count `pc ∈ expected` with `salience ≥ energyTol` and `present ≥ framesConfirm`. Success if count ≥ K.
  - _Includes‑target:_ success if **any** `pc ∈ expected` passes confirmation.
  - _Bass‑priority:_ find **min MIDI** among confirmed; success if its `pc ∈ expected`.

- **Debounce:** after success, suppress new successes for `debounceMs` (e.g., 150–250 ms) to avoid rapid re‑firing during sustain.

### 5.1) Tuning, capo, and transposition

- **Global tuning (A4):** allow `a4Hz` override (default 440). Internally, convert Hz→MIDI using this reference so slight detunes (e.g., 442 Hz orchestral or drift on acoustics) don’t cause off‑by‑1 semitone errors.
- **Capo support:** accept `transposeSemitones` (e.g., capo at 2 → +2). Apply transpose to **expected** chord pitch classes (not to detected audio). UI should display both concert and capo-relative names when helpful.
- **Alternate tunings:** widen `minF0Hz` (e.g., Drop‑D to D2) and keep **octave‑invariant** pitch‑class matching for verification. For exercises tied to specific strings, enable an optional **string mask** to bias bass‑priority toward expected low strings.
- **Adaptive cent tolerance:** during sustained vibrato/bends, allow dynamic `centsTol` up to 70–80 cents provided pitch class remains stable for `framesConfirm`.

### 6) UI integration & state machine

- **Exercise state:** `WAITING_PERMISSION → LISTENING → EXPECTING(chord) → CORRECT → ADVANCE(next)`.
- **Feedback:** show active pitch classes (12‑bin ring), highlight matches, show countdown/green flash on success.
- **Telemetry:** log tick duration, inference ms, detected notes, false/missed events (for tuning).

---

## Public API (TypeScript)

### Hook signature

```ts
export type PitchClass = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11; // C..B
export type ChordSpec = { name?: string; pcs: PitchClass[]; K?: number };

export type Policy = "K_OF_N" | "INCLUDES_TARGET" | "BASS_PRIORITY";

export type UseChordVerifierOpts = {
  windowSec?: number; // default 1.3
  tickMs?: number; // default 40
  tailMs?: number; // default 120
  centsTol?: number; // default 50
  framesConfirm?: number; // default 3
  policy?: Policy; // default 'K_OF_N'
  expected: ChordSpec; // required
  // New in v2:
  transposeSemitones?: number; // default 0 (capo/transposition)
  a4Hz?: number; // default 440 (tuning reference)
  minF0Hz?: number; // default 82.41 (E2) or 73.42 for Drop-D
  maxF0Hz?: number; // default 1318.51 (E6)
  acceptInversions?: boolean; // default true; verification is octave/voicing invariant
  onResult?: (res: ResultEvent) => void;
};

export type NoteEvent = {
  midi: number; // integer MIDI
  cents?: number; // detune
  startTime: number; // seconds (audio clock)
  endTime?: number;
  salience?: number; // model activation
};

export type ResultEvent =
  | { type: "DETECTED_NOTES"; time: number; notes: NoteEvent[] }
  | { type: "CHORD_MATCH"; time: number; chord: ChordSpec; policy: Policy }
  | {
      type: "CHORD_MISS";
      time: number;
      details: { matched: PitchClass[]; missing: PitchClass[] };
    }
  | { type: "ERROR"; error: Error };

export default function useChordVerifier(opts: UseChordVerifierOpts): {
  status: "idle" | "loading" | "listening" | "error";
  start: () => Promise<void>;
  stop: () => void;
  setExpected: (c: ChordSpec) => void;
};
```

### Worker protocol (simplified)

```ts
// UI → Worker
{ type: 'INIT', modelUrl, windowSec, tickMs }
{ type: 'START' }
{ type: 'STOP' }
{ type: 'SET_EXPECTED', expected: ChordSpec, policy, thresholds }

// Worker → UI
{ type: 'TICK', t, inferenceMs }
{ type: 'NOTES', t, notes: NoteEvent[] }
{ type: 'CHORD_MATCH', t }
{ type: 'CHORD_MISS', t, matched, missing }
{ type: 'ERROR', message }
```

---

## Core Algorithms

### 1) Rolling‑window inference loop (Worker)

```ts
// called every tickMs (≈40 ms)
function tick(nowSec: number) {
  // 1) Copy last W seconds from SAB into tmpBuffer48k
  readRingBuffer(samples48k, nowSec - W, nowSec);
  // 2) Downsample to 22.05 kHz → samples22k
  resampleLinear(samples48k, samples22k);
  // 3) Wrap in AudioBuffer (or Float32Array) for Basic Pitch
  const audioBuffer = makeAudioBuffer(samples22k, 22050);
  // 4) Inference
  const t0 = performance.now();
  const modelOut = basicPitch.evaluateModel(audioBuffer);
  const t1 = performance.now();
  // 5) Post‑process to notes with times (startTime/endTime/midi/cents)
  const notes = toTimedNotes(modelOut);
  // 6) Keep only new onsets in tail [now−G−ε, now]
  const newNotes = notes.filter(
    (n) =>
      n.startTime > lastOnset &&
      n.startTime >= nowSec - G - EPS &&
      n.startTime <= nowSec
  );
  lastOnset = Math.max(lastOnset, ...newNotes.map((n) => n.startTime));
  // 7) Emit
  postMessage({
    type: "NOTES",
    t: nowSec,
    notes: newNotes,
    inferenceMs: t1 - t0,
  });
  // 8) Chord policy
  const ok = chordPolicy.eval(newNotes, expected, thresholds, nowSec);
  postMessage(
    ok
      ? { type: "CHORD_MATCH", t: nowSec }
      : { type: "CHORD_MISS", t: nowSec, ...ok.details }
  );
}
```

### 2) Chord policy evaluators

- **Energy & persistence:** Each note contributes `salience`; a pitch class is **present** if total salience in `[now−G, now]` exceeds `energyTol` and is sustained for `framesConfirm` consecutive frames.
- **K‑of‑N:** count present pitch classes that belong to the expected set; success if `count ≥ K`.
- **Bass‑priority:** choose min‑MIDI present; success if its pitch class ∈ expected.
- **Includes‑target:** success if any expected pitch class is present.

### 3) Cents & detune tolerance

Convert frequency to MIDI + cents, snap to nearest semitone; regard within `±centsTol` (default 50) as the same pitch class. Pitch‑bend within a note should still satisfy the tolerance window.

---

## Latency Budget (typical modern laptop)

- Tick scheduler: **≤1 ms** jitter (Worker).
- Copy + resample W=1.3 s: **10–20 ms**.
- Model inference (Basic Pitch small): **20–50 ms** (WebGL/WebGPU backend), **50–90 ms** (WASM).
- Post‑processing + policy: **5–10 ms**.
- Confirmation window: **60–120 ms**.
- **Total user‑perceived:** ~**180–250 ms** median; p95 under **300 ms**.

**Mobile (modern phone):**

- Copy + resample W=1.2–1.3 s: **15–30 ms**.
- Model inference: **30–70 ms** (WebGL/WebGPU), **60–120 ms** (WASM only).
- Confirmation window: **60–110 ms**.
- **Total:** ~**220–320 ms** median; p95 under **380 ms**.

---

## Edge Cases & Mitigations$1

- **Alternate tunings & capo:** set `transposeSemitones` and adjust `minF0Hz`; expose an in‑app quick toggle for Drop‑D. Provide a brief calibration step (strum open strings) to estimate tuning drift and suggest `a4Hz`.

---

## Observability & Tuning$1

- **Pitch‑class confusion matrix:** track how often each expected class is missed vs extra, separated by device and tone profile.
- **Tuning drift monitor:** estimate best‑fit cents offset over last 10 s; surface when >20 cents to prompt recalibration.
- **Audio health:** counters for buffer underruns/overruns, Worklet xruns, and SAB fallbacks; log backend (WebGPU/WebGL/WASM) and model variant.

---

## Evaluation Plan$1

4. **Click‑track tether:** play a metronome and record LED flash via webcam/audio loopback to measure UI reaction time (ground truth alignment).
5. **Per‑string ground truth (optional):** use a hex pickup or MIDI guitar (e.g., Jamstik) to collect per‑string onsets for small test sets; use as oracle for chord‑tone presence.

---

## Security & Privacy

- Use COOP/COEP to enable SAB while keeping isolation.
- Do not persist raw audio by default. Keep only derived note/chord features in memory.
- Optional: allow opt‑in session recording for debugging; encrypt at rest; clear on session end.

---

## Roadmap

**MVP (2–3 weeks)**

- Audio stack (Worklet + SAB) and inference Worker.
- Basic Pitch integration with rolling window.
- K‑of‑N chord policy; minimal UI.
- Metrics + debug panel.

**Hardening (2–3 weeks)**

- HPSS path and LPF options.
- WebGPU/ONNX backend option for speed.
- Offline evaluation harness + automated parameter sweep.

**Polish (ongoing)**

- Visualizations (chroma wheel, fretboard overlay).
- Exercise authoring (JSON spec for expected chords/sequences).
- Export (MIDI/JSON logs) and progress analytics.

---

## Open Questions / Decisions

- **Backend choice:** TF.js vs ONNX Runtime Web vs custom WASM for the specific Basic Pitch model build.
- **Model quantization:** Explore fp16/int8 for memory & speed trade‑offs.
- **Chord library & parsing:** integrate `tonal` (or in‑house) for robust chord → pitch‑class mapping and inversions.
- **Mobile support:** iOS Safari Worklet performance & WebGPU availability; consider a smaller W (1.2 s) on mobile.

---

## Appendix: Parameter Defaults

- `windowSec` = **1.3**
- `tickMs` = **40**
- `tailMs` = **120**
- `centsTol` = **50**
- `framesConfirm` = **3**
- `policy` = **'K_OF_N'** with `K = min(2, N)` for triads; `K = 2` for power chords; `K = 3` for seventh chords when requiring fuller confirmation.
- Guitar range: **E2–E6** by default; **D2** for Drop‑D.
- `transposeSemitones` = **0** (capo offset)
- `a4Hz` = **440**
- `minF0Hz` = **82.41** (E2) | **73.42** (D2)
- `maxF0Hz` = **1318.51** (E6)
