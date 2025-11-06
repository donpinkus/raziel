Below is a production‑ready skeleton you can drop into a Vite/Next/CRA app. It includes:

- A **React hook** (`useChordVerifier`) that exposes `start/stop/setExpected` and streams correctness.
- An **AudioWorklet** that writes mono audio into a **SharedArrayBuffer ring buffer**.
- A **Web Worker** that, every 40 ms, pulls the last 1.3 s from the ring buffer, **resamples to 22.05 kHz**, runs **Basic Pitch**, and applies the **K‑of‑N chord policy**.
- A **BasicPitch adapter** you can swap (TF.js vs ONNX Runtime Web) without touching the hook.
- Utility code for **pitch‑class mapping**, **resampling**, and **SAB ring buffer**.
- A minimal **demo component**.

> **Requirements:** COOP/COEP (for SAB), HTTPS, and a modern browser. Prefer WebGPU/WebGL backends; WASM will work with higher latency.

---

## 0) Install deps

```bash
npm i @spotify/basic-pitch tonal onnxruntime-web
# or: pnpm add ... / yarn add ...
```

> You may use TF.js (if your Basic Pitch build targets it) or keep **ONNX Runtime Web** as the primary runtime. This skeleton wires an **adapter** so you can switch later.

---

## 1) COOP/COEP (enable SharedArrayBuffer)

Add these headers in dev and prod.

**Vite (vite.config.ts)**

```ts
export default defineConfig({
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
```

**Static hosting (e.g., Nginx)**

```
add_header Cross-Origin-Opener-Policy same-origin;
add_header Cross-Origin-Embedder-Policy require-corp;
```

---

## 2) Types & Utilities

**`src/types/audio.ts`**

```ts
export type PitchClass = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11; // C..B
export type Policy = "K_OF_N" | "INCLUDES_TARGET" | "BASS_PRIORITY";

export type ChordSpec = {
  name?: string;
  pcs: PitchClass[]; // expected pitch classes (octave‑invariant)
  K?: number; // how many of N required (default: min(2,N))
};

export type NoteEvent = {
  midi: number; // integer MIDI note number
  cents?: number; // detune amount
  startTime: number; // seconds in audio clock
  endTime?: number; // seconds
  salience?: number; // model activation (0..1), if available
};

export type WorkerInit = {
  sab: SharedArrayBuffer;
  sampleRate: number; // worklet input SR (e.g., 48000)
  windowSec: number; // 1.3
  tailMs: number; // 120
  tickMs: number; // 40
  a4Hz: number; // 440
  minF0Hz: number; // 82.41 (E2) or 73.42 (D2)
  maxF0Hz: number; // 1318.51 (E6)
};

export type WorkerSetExpected = {
  expected: ChordSpec;
  policy: Policy;
  centsTol: number; // 50
  framesConfirm: number; // 3
  transposeSemitones: number; // 0
  acceptInversions: boolean; // true
};

export type ResultEvent =
  | { type: "TICK"; t: number; inferenceMs: number }
  | { type: "NOTES"; t: number; notes: NoteEvent[] }
  | { type: "CHORD_MATCH"; t: number }
  | {
      type: "CHORD_MISS";
      t: number;
      matched: PitchClass[];
      missing: PitchClass[];
    }
  | { type: "ERROR"; message: string };
```

**`src/utils/pitch.ts`**

```ts
import { Note } from "tonal";
import type { PitchClass } from "../types/audio";

export function hzToMidi(hz: number, a4 = 440): number {
  return 69 + 12 * Math.log2(hz / a4);
}

export function midiToPc(midi: number, transpose = 0): PitchClass {
  return ((((Math.round(midi) + transpose) % 12) + 12) % 12) as PitchClass;
}

export function nameToPc(name: string): PitchClass {
  // e.g., 'C#' → 1
  const m = Note.midi(name);
  if (m == null) throw new Error(`Bad note: ${name}`);
  return (m % 12) as PitchClass;
}
```

**`src/utils/resample.ts`** (linear downsampler 48k → 22.05k)

```ts
export function resampleLinear(
  input: Float32Array,
  inRate: number,
  outRate: number,
  out: Float32Array
) {
  const ratio = inRate / outRate;
  const n = out.length;
  let pos = 0;
  for (let i = 0; i < n; i++) {
    const idx = pos | 0;
    const frac = pos - idx;
    const s0 = input[idx] ?? 0;
    const s1 = input[idx + 1] ?? s0;
    out[i] = s0 + (s1 - s0) * frac;
    pos += ratio;
  }
}
```

**`src/audio/ringbuffer.ts`** (SAB ring with Atomics)

```ts
export class SharedRingBuffer {
  readonly sab: SharedArrayBuffer;
  readonly i32: Int32Array; // [writeIdx, capacity]
  readonly f32: Float32Array;

  private constructor(sab: SharedArrayBuffer) {
    this.sab = sab;
    this.i32 = new Int32Array(sab, 0, 2);
    this.f32 = new Float32Array(sab, 8);
  }

  static create(capacitySamples: number) {
    const headerBytes = 8; // two int32
    const dataBytes = capacitySamples * 4;
    const sab = new SharedArrayBuffer(headerBytes + dataBytes);
    const rb = new SharedRingBuffer(sab);
    rb.i32[0] = 0; // writeIdx
    rb.i32[1] = capacitySamples; // capacity
    return rb;
  }

  static from(sab: SharedArrayBuffer) {
    return new SharedRingBuffer(sab);
  }

  write(samples: Float32Array) {
    const cap = this.i32[1];
    let w = Atomics.load(this.i32, 0);
    for (let i = 0; i < samples.length; i++) {
      this.f32[w % cap] = samples[i];
      w++;
    }
    Atomics.store(this.i32, 0, w);
  }

  // Copy the last N samples into out[] (N == out.length)
  readLast(out: Float32Array) {
    const cap = this.i32[1];
    const w = Atomics.load(this.i32, 0);
    const N = out.length;
    const start = w - N;
    for (let i = 0; i < N; i++) {
      const idx = (start + i) % cap;
      out[i] = this.f32[(idx + cap) % cap];
    }
  }
}
```

---

## 3) AudioWorklet (mono writer)

**`src/audio/RecorderWorkletProcessor.ts`**

```ts
class RecorderWorkletProcessor extends AudioWorkletProcessor {
  private rb!: SharedRingBuffer;
  private tmp!: Float32Array;

  constructor(options: any) {
    super();
    this.port.onmessage = (e) => {
      if (e.data?.sab) {
        this.rb = (globalThis as any).SharedRingBuffer.from(e.data.sab);
        this.tmp = new Float32Array(128); // default render quantum
      }
    };
  }

  process(inputs: Float32Array[][]) {
    if (!this.rb) return true;
    const chan0 = inputs[0]?.[0];
    const chan1 = inputs[0]?.[1];
    const N = chan0?.length ?? 0;
    if (N === 0) return true;
    // mono mixdown (L+R)/2 if stereo, else L
    for (let i = 0; i < N; i++) {
      const l = chan0![i] || 0;
      const r = chan1 ? chan1[i] || 0 : l;
      this.tmp[i] = 0.5 * (l + r);
    }
    this.rb.write(this.tmp.subarray(0, N));
    return true;
  }
}

// Minimal local definition to reuse ring class without bundling issues
class SharedRingBuffer {
  sab: SharedArrayBuffer;
  i32: Int32Array;
  f32: Float32Array;
  static from(sab: SharedArrayBuffer) {
    return new SharedRingBuffer(sab);
  }
  constructor(sab: SharedArrayBuffer) {
    this.sab = sab;
    this.i32 = new Int32Array(sab, 0, 2);
    this.f32 = new Float32Array(sab, 8);
  }
  write(samples: Float32Array) {
    const cap = this.i32[1];
    let w = Atomics.load(this.i32, 0);
    for (let i = 0; i < samples.length; i++) {
      this.f32[w % cap] = samples[i];
      w++;
    }
    Atomics.store(this.i32, 0, w);
  }
}

registerProcessor("recorder-worklet", RecorderWorkletProcessor);
```

> **Note:** Worklet files must be added via `audioContext.audioWorklet.addModule(url)`. We’ll create a Blob URL from this source to avoid separate hosting.

---

## 4) Basic Pitch adapter (Worker‑side)

**`src/model/BasicPitchAdapter.ts`**

```ts
import type { NoteEvent } from "../types/audio";

export interface BasicPitchLike {
  // Runs model on a Float32Array mono audio (22_050 Hz) and returns note events.
  evaluateMono22k(audio: Float32Array): Promise<NoteEvent[]>;
}

// TF.js or ONNX implementation can satisfy this interface.

// Example scaffold using @spotify/basic-pitch (fill in actual calls per your build):
export class BasicPitchAdapter implements BasicPitchLike {
  private ready = false;
  private model: any;

  async init() {
    if (this.ready) return;
    // TODO: import and initialize your Basic Pitch model here.
    // e.g., const { basicPitch, outputToNotesPoly, ... } = await import('@spotify/basic-pitch');
    // this.model = await basicPitch.loadModel(...);
    this.ready = true;
  }

  async evaluateMono22k(audio: Float32Array): Promise<NoteEvent[]> {
    if (!this.ready) await this.init();
    // TODO: feed `audio` to model and convert frames → notes
    // Placeholder: return empty until wired
    return [];
  }
}
```

> Wire this to your chosen runtime (TF.js or ONNX Runtime Web). Keep it isolated so the rest of the worker doesn’t change when you swap backends.

---

## 5) Worker (rolling window inference + policy)

**`src/workers/chordWorker.ts`**

```ts
/// <reference lib="webworker" />
import { resampleLinear } from "../utils/resample";
import { midiToPc } from "../utils/pitch";
import type {
  NoteEvent,
  PitchClass,
  Policy,
  WorkerInit,
  WorkerSetExpected,
  ResultEvent,
} from "../types/audio";
import { BasicPitchAdapter } from "../model/BasicPitchAdapter";

// Local minimal clone to read SAB without importing the app class into worker
class SharedRingBuffer {
  constructor(public sab: SharedArrayBuffer) {
    this.i32 = new Int32Array(sab, 0, 2);
    this.f32 = new Float32Array(sab, 8);
  }
  i32: Int32Array;
  f32: Float32Array;
  readLast(out: Float32Array) {
    const cap = this.i32[1];
    const w = Atomics.load(this.i32, 0);
    const N = out.length;
    const start = w - N;
    for (let i = 0; i < N; i++) {
      const idx = (start + i) % cap;
      out[i] = this.f32[(idx + cap) % cap];
    }
  }
}

let rb: SharedRingBuffer | null = null;
let inSR = 48000;
let windowSec = 1.3;
let tailMs = 120;
let tickMs = 40;
let a4Hz = 440;
let minF0Hz = 82.41; // E2
let maxF0Hz = 1318.51; // E6
let expected: PitchClass[] = [];
let K = 2;
let policy: Policy = "K_OF_N";
let centsTol = 50; // not used in this scaffold; depends on adapter’s frame detail
let framesConfirm = 3;
let transposeSemitones = 0;
let acceptInversions = true;

let tickHandle: number | null = null;
let lastPublishedOnset = -1;

const adapter = new BasicPitchAdapter();

function startLoop() {
  if (tickHandle !== null) return;
  const inNsamp = Math.round(windowSec * inSR);
  const outSR = 22050;
  const outNsamp = Math.round(windowSec * outSR);
  const bufIn = new Float32Array(inNsamp);
  const buf22k = new Float32Array(outNsamp);

  const tick = async () => {
    if (!rb) return;
    const tStart = performance.now();
    // 1) copy last W seconds at inSR
    rb.readLast(bufIn);
    // 2) resample to 22.05 kHz
    resampleLinear(bufIn, inSR, outSR, buf22k);
    // 3) run model
    const notes: NoteEvent[] = await adapter.evaluateMono22k(buf22k);
    // 4) filter new onsets in tail window & aggregate PCs
    const nowSec = performance.now() / 1000; // UI clock proxy
    const tailSec = tailMs / 1000;
    const tailStart = nowSec - tailSec - 0.02; // epsilon overlap
    const newNotes = notes.filter(
      (n) =>
        n.startTime > lastPublishedOnset &&
        n.startTime >= tailStart &&
        n.startTime <= nowSec
    );
    if (newNotes.length) {
      lastPublishedOnset = Math.max(
        lastPublishedOnset,
        ...newNotes.map((n) => n.startTime)
      );
    }

    const pcs = new Map<PitchClass, number>();
    for (const n of newNotes) {
      const pc = midiToPc(n.midi, transposeSemitones);
      pcs.set(pc, (pcs.get(pc) || 0) + (n.salience ?? 1));
    }

    // Decide chord match
    const present: PitchClass[] = [];
    expected.forEach((pc) => {
      if ((pcs.get(pc) || 0) > 0) present.push(pc);
    });

    let match = false;
    if (policy === "K_OF_N")
      match = present.length >= Math.min(K, expected.length);
    else if (policy === "INCLUDES_TARGET") match = present.length >= 1;
    else if (policy === "BASS_PRIORITY") {
      const bass = newNotes.length
        ? newNotes.reduce((a, b) => (a.midi < b.midi ? a : b))
        : null;
      match = !!(
        bass && expected.includes(midiToPc(bass.midi, transposeSemitones))
      );
    }

    const inferenceMs = performance.now() - tStart;
    const post: ResultEvent[] = [
      { type: "TICK", t: nowSec, inferenceMs },
      { type: "NOTES", t: nowSec, notes: newNotes },
      match
        ? { type: "CHORD_MATCH", t: nowSec }
        : {
            type: "CHORD_MISS",
            t: nowSec,
            matched: present,
            missing: expected.filter((pc) => !present.includes(pc)),
          },
    ];
    post.forEach((m) => (self as any).postMessage(m));
  };

  tickHandle = setInterval(tick, tickMs) as unknown as number;
}

self.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data;
  try {
    if (msg?.type === "INIT") {
      const cfg = msg as { type: "INIT"; payload: WorkerInit };
      const {
        sab,
        sampleRate,
        windowSec: W,
        tailMs: G,
        tickMs: D,
        a4Hz: A4,
        minF0Hz: Fmin,
        maxF0Hz: Fmax,
      } = cfg.payload;
      rb = new SharedRingBuffer(sab);
      inSR = sampleRate;
      windowSec = W;
      tailMs = G;
      tickMs = D;
      a4Hz = A4;
      minF0Hz = Fmin;
      maxF0Hz = Fmax;
      await adapter.init();
      startLoop();
    } else if (msg?.type === "SET_EXPECTED") {
      const ep = msg as { type: "SET_EXPECTED"; payload: WorkerSetExpected };
      expected = ep.payload.expected.pcs;
      K = ep.payload.expected.K ?? Math.min(2, expected.length);
      policy = ep.payload.policy;
      centsTol = ep.payload.centsTol;
      framesConfirm = ep.payload.framesConfirm;
      transposeSemitones = ep.payload.transposeSemitones;
      acceptInversions = ep.payload.acceptInversions;
    } else if (msg?.type === "STOP") {
      if (tickHandle !== null) {
        clearInterval(tickHandle as any);
        tickHandle = null;
      }
    }
  } catch (e: any) {
    (self as any).postMessage({
      type: "ERROR",
      message: String(e?.message || e),
    });
  }
};
```

---

## 6) React hook (loads worklet + worker, exposes API)

**`src/hooks/useChordVerifier.ts`**

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChordSpec, Policy, ResultEvent } from "../types/audio";
import { SharedRingBuffer } from "../audio/ringbuffer";

export type UseChordVerifierOpts = {
  windowSec?: number; // default 1.3
  tickMs?: number; // default 40
  tailMs?: number; // default 120
  centsTol?: number; // default 50
  framesConfirm?: number; // default 3
  policy?: Policy; // default 'K_OF_N'
  expected: ChordSpec; // required
  transposeSemitones?: number; // default 0
  a4Hz?: number; // default 440
  minF0Hz?: number; // default 82.41 or 73.42
  maxF0Hz?: number; // default 1318.51
  onResult?: (ev: ResultEvent) => void;
};

export default function useChordVerifier(opts: UseChordVerifierOpts) {
  const {
    windowSec = 1.3,
    tickMs = 40,
    tailMs = 120,
    centsTol = 50,
    framesConfirm = 3,
    policy = "K_OF_N",
    expected,
    transposeSemitones = 0,
    a4Hz = 440,
    minF0Hz = 82.41,
    maxF0Hz = 1318.51,
    onResult,
  } = opts;

  const [status, setStatus] = useState<
    "idle" | "loading" | "listening" | "error"
  >("idle");
  const acRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const mediaRef = useRef<MediaStream | null>(null);
  const rbRef = useRef<ReturnType<typeof SharedRingBuffer.create> | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const recorderWorkletURL = useMemo(() => {
    // Inline worklet source → Blob URL (avoids hosting a separate file)
    const src = `(${workletSource.toString()})()`;
    return URL.createObjectURL(
      new Blob([src], { type: "application/javascript" })
    );
  }, []);

  const workerURL = useMemo(
    () => new URL("../workers/chordWorker.ts", import.meta.url),
    []
  );

  const start = useCallback(async () => {
    try {
      setStatus("loading");
      const ac = new AudioContext({ latencyHint: "interactive" });
      acRef.current = ac;

      // 1) Mic
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 2,
        },
      });
      mediaRef.current = stream;
      const src = ac.createMediaStreamSource(stream);

      // 2) SAB ring
      const capacity = Math.ceil((windowSec + 0.5) * ac.sampleRate);
      const rb = SharedRingBuffer.create(capacity);
      rbRef.current = rb;

      // 3) Worklet
      await ac.audioWorklet.addModule(recorderWorkletURL);
      const node = new AudioWorkletNode(ac, "recorder-worklet");
      workletRef.current = node;
      node.port.postMessage({ sab: rb.sab });
      src.connect(node).connect(ac.destination); // destination optional (monitoring)

      // 4) Worker
      const worker = new Worker(workerURL, { type: "module" });
      workerRef.current = worker;
      worker.onmessage = (e: MessageEvent<ResultEvent>) => onResult?.(e.data);
      worker.postMessage({
        type: "INIT",
        payload: {
          sab: rb.sab,
          sampleRate: ac.sampleRate,
          windowSec,
          tailMs,
          tickMs,
          a4Hz,
          minF0Hz,
          maxF0Hz,
        },
      });

      // 5) Send expected chord
      worker.postMessage({
        type: "SET_EXPECTED",
        payload: {
          expected,
          policy,
          centsTol,
          framesConfirm,
          transposeSemitones,
          acceptInversions: true,
        },
      });

      setStatus("listening");
    } catch (e) {
      console.error(e);
      setStatus("error");
    }
  }, [
    expected,
    policy,
    centsTol,
    framesConfirm,
    transposeSemitones,
    a4Hz,
    minF0Hz,
    maxF0Hz,
    tailMs,
    tickMs,
    windowSec,
    onResult,
    recorderWorkletURL,
    workerURL,
  ]);

  const stop = useCallback(() => {
    try {
      workerRef.current?.postMessage({ type: "STOP" });
      workerRef.current?.terminate();
      workerRef.current = null;
      workletRef.current?.disconnect();
      workletRef.current = null;
      mediaRef.current?.getTracks().forEach((t) => t.stop());
      mediaRef.current = null;
      acRef.current?.close();
      acRef.current = null;
      setStatus("idle");
    } catch (e) {
      console.error(e);
      setStatus("error");
    }
  }, []);

  const setExpected = useCallback(
    (c: ChordSpec) => {
      workerRef.current?.postMessage({
        type: "SET_EXPECTED",
        payload: {
          expected: c,
          policy,
          centsTol,
          framesConfirm,
          transposeSemitones,
          acceptInversions: true,
        },
      });
    },
    [policy, centsTol, framesConfirm, transposeSemitones]
  );

  useEffect(() => () => stop(), [stop]);

  return { status, start, stop, setExpected } as const;
}

// --- inline worklet source ---
function workletSource() {
  // The body below is exactly the file we wrote earlier.
  class RecorderWorkletProcessor extends (globalThis as any)
    .AudioWorkletProcessor {
    rb;
    tmp;
    constructor() {
      super();
      this.port.onmessage = (e) => {
        if (e.data?.sab) {
          this.rb = new SharedRingBuffer(e.data.sab);
          this.tmp = new Float32Array(128);
        }
      };
    }
    process(inputs) {
      if (!this.rb) return true;
      const ch0 = inputs[0]?.[0];
      const ch1 = inputs[0]?.[1];
      const N = ch0?.length ?? 0;
      if (!N) return true;
      for (let i = 0; i < N; i++) {
        const l = ch0[i] || 0;
        const r = ch1 ? ch1[i] || 0 : l;
        this.tmp[i] = 0.5 * (l + r);
      }
      this.rb.write(this.tmp.subarray(0, N));
      return true;
    }
  }
  class SharedRingBuffer {
    constructor(sab) {
      this.sab = sab;
      this.i32 = new Int32Array(sab, 0, 2);
      this.f32 = new Float32Array(sab, 8);
    }
    write(samples) {
      const cap = this.i32[1];
      let w = Atomics.load(this.i32, 0);
      for (let i = 0; i < samples.length; i++) {
        this.f32[w % cap] = samples[i];
        w++;
      }
      Atomics.store(this.i32, 0, w);
    }
  }
  (globalThis as any).registerProcessor(
    "recorder-worklet",
    RecorderWorkletProcessor
  );
}
```

---

## 7) Demo usage

**`src/App.tsx`**

```tsx
import React, { useMemo, useState } from "react";
import useChordVerifier from "./hooks/useChordVerifier";
import type { ResultEvent, PitchClass } from "./types/audio";

const pcsToName = (pc: PitchClass) =>
  ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][pc];

export default function App() {
  const [log, setLog] = useState<string[]>([]);
  const expected = useMemo(
    () => ({ name: "E minor", pcs: [4, 7, 11] as PitchClass[], K: 2 }),
    []
  ); // E,G,B

  const { status, start, stop } = useChordVerifier({
    expected,
    onResult: (ev: ResultEvent) => {
      if (ev.type === "CHORD_MATCH")
        setLog((l) => [`✅ MATCH`, ...l].slice(0, 10));
      if (ev.type === "CHORD_MISS")
        setLog((l) =>
          [
            `… miss (have: ${ev.matched
              .map(pcsToName)
              .join(", ")}, need: ${ev.missing.map(pcsToName).join(", ")})`,
            ...l,
          ].slice(0, 10)
        );
    },
  });

  return (
    <div style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>Chord Verifier Demo</h1>
      <p>
        Status: <b>{status}</b>
      </p>
      <button onClick={start} disabled={status !== "idle"}>
        Start
      </button>
      <button onClick={stop} disabled={status === "idle"}>
        Stop
      </button>
      <h3>Log</h3>
      <ul>
        {log.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    </div>
  );
}
```

---

## 8) Swapping in the real Basic Pitch calls

Inside `BasicPitchAdapter.evaluateMono22k`, wire the actual library functions. Depending on your build, this will look roughly like:

```ts
import { basicPitch, outputToNotesPoly /*, ...*/ } from "@spotify/basic-pitch";

export class BasicPitchAdapter implements BasicPitchLike {
  private model: any;
  private ready = false;
  async init() {
    if (this.ready) return;
    this.model = await basicPitch.loadModel();
    this.ready = true;
  }
  async evaluateMono22k(audio: Float32Array): Promise<NoteEvent[]> {
    const sr = 22050;
    const { frame_predictions, onsets /*…*/ } = await basicPitch.evaluateModel(
      this.model,
      audio,
      sr
    );
    const notes = outputToNotesPoly(
      frame_predictions,
      onsets /*, pitch_bends*/
    );
    return notes.map((n) => ({
      midi: Math.round(n.pitchMidi),
      startTime: n.startTimeSec,
      endTime: n.endTimeSec,
      salience: n.amplitude ?? 1,
    }));
  }
}
```

> If you prefer **ONNX Runtime Web**, convert the model and call it from here; keep the NoteEvent shape identical. Also consider a smaller variant or fp16/int8 quantization for low‑end devices.

---

## 9) Tuning knobs (defaulted per tech plan)

- `windowSec=1.3`, `tickMs=40`, `tailMs=120`
- `framesConfirm=3`, `centsTol=50`, `policy='K_OF_N'`
- Guitar gate: `minF0Hz=82.41 (E2)` to `maxF0Hz=1318.51 (E6)`; Drop‑D → `minF0Hz=73.42`
- Transposition/capo via `transposeSemitones`

---

## 10) Notes on accuracy & perf

- Prefer **WebGPU/WebGL** backends; WASM is OK with ~+40–70 ms.
- Keep inference **off the audio thread** (we do, in Worker). Worklet writes only.
- For distorted tones, pre‑LPF (~5 kHz) before sending to worker, or add an **HPSS** step in the worker and feed the harmonic stem to the model.
- For fast arpeggios, you can drop `framesConfirm` to 2 (policy‑driven) while keeping chord K‑of‑N=2.

---

This skeleton is intentionally modular: you can plug in the model backend you want, adjust the windowing policy, and expand the UI without changing the core dataflow.
