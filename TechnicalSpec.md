# Raziel - Technical Specification (MVP)

This document provides implementation-level details for building the Raziel MVP. Focus is on **core functionality first, UX polish later**.

---

# MVP Scope Definition

## What We're Building (MVP v1)

**Goal:** Prove the core concept - detect guitar notes AND chords, provide feedback.

- **Features (Minimal Set):**
  - Load **one** pre-existing MusicXML file (Song of Storms)
  - Display guitar tablature (tab view only, no staff notation)
  - Capture audio from microphone
  - Detect **both single notes AND chords** using the Basic Pitch streaming pipeline (AudioWorklet → SharedArrayBuffer → Worker inference)
  - **Wait mode** only (no Play/tempo mode)
  - Basic visual feedback (green/red/yellow for correct/incorrect/partial)
  - Simple accuracy score at the end
  - **No user accounts, no backend** - everything runs in browser
  - **No song library UI** - hardcode one song to start

**Explicitly NOT in MVP:**
- ❌ User authentication
- ❌ Backend/database
- ❌ Multiple songs or song library
- ❌ Play mode (tempo-based)
- ❌ Staff notation view
- ❌ Video tutorials
- ❌ Progress tracking over time
- ❌ Achievements
- ❌ Speed adjustment
- ❌ Section looping

**Success Criteria:**
1. Can load and display Song of Storms tabs (including chords)
2. Can detect single notes (e.g., "E2" low E string open)
3. Can detect chords (e.g., E minor = E + G + B)
4. Can advance to next note/chord in Wait mode when correctly played
5. Shows partial feedback for chords (e.g., "2 out of 3 notes correct")
6. Shows "87% accurate" at the end

---

# Project Structure

## Directory Layout

```
raziel/
├── README.md
├── package.json
├── tsconfig.json
├── vite.config.ts
├── .gitignore
├── public/
│   └── songs/
│       └── song-of-storms.musicxml
├── src/
│   ├── main.tsx                 # Entry point
│   ├── App.tsx                  # Root component
│   ├── vite-env.d.ts
│   │
│   ├── components/
│   │   ├── PracticeScreen.tsx   # Main practice UI
│   │   ├── NotationDisplay.tsx  # VexFlow tab rendering
│   │   ├── FeedbackBar.tsx      # Real-time feedback
│   │   ├── AudioSetup.tsx       # Microphone permission/test
│   │   └── SessionSummary.tsx   # End-of-session results
│   │
│   ├── services/
│   │   ├── audioEngine.ts       # Web Audio API setup
│   │   ├── pitchDetector.ts     # FFT-based pitch detection
│   │   ├── musicXmlParser.ts    # Parse MusicXML files
│   │   └── noteMatching.ts      # Compare detected vs expected
│   │
│   ├── types/
│   │   ├── song.types.ts        # Song, Note, Measure interfaces
│   │   └── audio.types.ts       # DetectionResult, AudioConfig
│   │
│   ├── utils/
│   │   ├── noteUtils.ts         # Frequency <-> Note conversion
│   │   └── constants.ts         # Note frequencies, configs
│   │
│   └── styles/
│       └── global.css
```

## Key Files Explained

- **`audioEngine.ts`**: Initialize Web Audio API, get microphone access, create analyzer node
- **`pitchDetector.ts`**: Run FFT on audio buffer, find fundamental frequency, convert to note name
- **`musicXmlParser.ts`**: Parse MusicXML, extract notes with timing, return structured data
- **`noteMatching.ts`**: Take detected note + expected note, determine if correct
- **`PracticeScreen.tsx`**: Orchestrate everything - load song, start audio, display tabs, show feedback

---

# MusicXML Parsing Implementation

## Library Choice

**Use:** `fast-xml-parser` (lightweight, no dependencies)

```bash
npm install fast-xml-parser
```

**Why not other options:**
- `musicxml-interfaces`: Too heavy, designed for full notation software
- `opensheetmusicdisplay`: Renderer + parser, overkill for MVP
- `xml2js`: Callback-based, awkward API

## Parsing Strategy

### Input (MusicXML Structure)

Based on Song of Storms file:
```xml
<score-partwise>
  <part id="P0">
    <measure number="1">
      <attributes>
        <divisions>12</divisions>
        <time><beats>3</beats><beat-type>4</beat-type></time>
      </attributes>
      <direction>
        <sound tempo="107" />
      </direction>
      <note>
        <pitch><step>E</step><octave>2</octave></pitch>
        <duration>12</duration>
      </note>
      <note>
        <pitch><step>B</step><octave>3</octave></pitch>
        <duration>12</duration>
      </note>
      <note>
        <chord />  <!-- This means it's part of a chord with previous note -->
        <pitch><step>G</step><octave>3</octave></pitch>
        <duration>12</duration>
      </note>
    </measure>
  </part>
</score-partwise>
```

### Output (Our Data Structure)

```typescript
// types/song.types.ts
export interface Song {
  title: string;
  tempo: number;        // BPM
  timeSignature: {
    beats: number;
    beatType: number;
  };
  measures: Measure[];
}

export interface Measure {
  number: number;
  notes: Note[];
}

export interface Note {
  pitch: string;        // e.g., "E2", "B3"
  duration: number;     // In beats (quarter note = 1)
  timeOffset: number;   // When this note should be played (in beats from start of song)
  isChord: boolean;     // True if part of a chord
  chordGroup?: number;  // Group ID for notes that are played together
}
```

### Parser Implementation

```typescript
// services/musicXmlParser.ts
import { XMLParser } from 'fast-xml-parser';

export function parseMusicXML(xmlString: string): Song {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_'
  });

  const data = parser.parse(xmlString);
  const scorePartwise = data['score-partwise'];

  // Extract metadata
  const title = scorePartwise['movement-title'] || 'Untitled';

  // Get first part (we only handle single-part songs in MVP)
  const part = Array.isArray(scorePartwise.part)
    ? scorePartwise.part[0]
    : scorePartwise.part;

  const measures: Measure[] = [];
  let currentTimeOffset = 0;
  let tempo = 120; // Default
  let divisions = 1;
  let timeSignature = { beats: 4, beatType: 4 };

  const measureArray = Array.isArray(part.measure)
    ? part.measure
    : [part.measure];

  for (const measureData of measureArray) {
    const measureNumber = parseInt(measureData['@_number']);

    // Extract attributes if present (tempo, time signature, divisions)
    if (measureData.attributes) {
      if (measureData.attributes.divisions) {
        divisions = measureData.attributes.divisions;
      }
      if (measureData.attributes.time) {
        timeSignature.beats = measureData.attributes.time.beats;
        timeSignature.beatType = measureData.attributes.time['beat-type'];
      }
    }

    // Extract tempo if present
    if (measureData.direction?.['direction-type']?.metronome) {
      tempo = measureData.direction['direction-type'].metronome['per-minute'];
    }
    if (measureData.direction?.sound?.['@_tempo']) {
      tempo = measureData.direction.sound['@_tempo'];
    }

    // Extract notes
    const notes: Note[] = [];
    let noteArray = measureData.note;
    if (!noteArray) {
      measures.push({ number: measureNumber, notes: [] });
      continue;
    }
    if (!Array.isArray(noteArray)) noteArray = [noteArray];

    let chordGroupId = 0;
    let lastNoteWasChord = false;

    for (const noteData of noteArray) {
      // Skip rests
      if (noteData.rest) {
        const restDuration = noteData.duration / divisions;
        currentTimeOffset += restDuration;
        continue;
      }

      const isChord = !!noteData.chord;

      if (isChord && lastNoteWasChord) {
        // Same chord group as previous note
        chordGroupId = chordGroupId;
      } else if (isChord) {
        // Start of new chord
        chordGroupId++;
      } else {
        // Single note
        chordGroupId = 0;
        lastNoteWasChord = false;
      }

      const pitch = noteData.pitch;
      const noteName = `${pitch.step}${pitch.octave}`;
      const duration = noteData.duration / divisions;

      notes.push({
        pitch: noteName,
        duration,
        timeOffset: isChord ? currentTimeOffset : currentTimeOffset,
        isChord,
        chordGroup: isChord ? chordGroupId : undefined
      });

      // Only advance time if this is not a chord note
      if (!isChord) {
        currentTimeOffset += duration;
      }

      lastNoteWasChord = isChord;
    }

    measures.push({ number: measureNumber, notes });
  }

  return { title, tempo, timeSignature, measures };
}
```

### Handling Chords in Practice Mode

Keep all notes including chords:
```typescript
// Group notes by their time position for chord detection
function groupNotesByTime(measures: Measure[]): NoteGroup[] {
  const groups: NoteGroup[] = [];

  for (const measure of measures) {
    let currentGroup: Note[] = [];
    let currentTime = -1;

    for (const note of measure.notes) {
      if (note.timeOffset !== currentTime) {
        // New time position - save previous group if exists
        if (currentGroup.length > 0) {
          groups.push({
            notes: currentGroup,
            timeOffset: currentTime,
            isChord: currentGroup.length > 1
          });
        }
        currentGroup = [note];
        currentTime = note.timeOffset;
      } else {
        // Same time position - part of chord
        currentGroup.push(note);
      }
    }

    // Don't forget last group
    if (currentGroup.length > 0) {
      groups.push({
        notes: currentGroup,
        timeOffset: currentTime,
        isChord: currentGroup.length > 1
      });
    }
  }

  return groups;
}

interface NoteGroup {
  notes: Note[];
  timeOffset: number;
  isChord: boolean;
}
```

---

# Chord & Pitch Detection Implementation

## Selected Approach: Basic Pitch Streaming Pipeline

Raziel now standardizes on Spotify's **Basic Pitch** model running entirely in the browser. Rather than deriving a 12-bin chromagram with Meyda, we stream a polyphonic transcription model across short audio windows so we can reason about true note onsets, salience, and sustained tones. This approach matches the dedicated architecture captured in `Architecture - Pitch Detection.md` and the implementation scaffold in `Implementation Plan - Pitch Detection.md`.

### Why Basic Pitch instead of chromagram-only detection?
- **Polyphonic accuracy:** Basic Pitch is trained on multi-note guitar data and preserves per-note MIDI + cents output, which is more reliable than heuristic chroma thresholds for rolled chords or noisy environments.
- **Latency control:** By re-running inference every 40 ms over a rolling 1.3 s window we achieve <300 ms perceived latency without sacrificing stability.
- **Policy flexibility:** Having explicit MIDI events lets us implement K-of-N, includes-target, and bass-priority policies with octave invariance and configurable detune tolerances.
- **Future-proofing:** The same pipeline scales to Play mode, analytics, and recording replays without swapping out the detection core.

### Architecture Overview
```
Mic → AudioWorklet (48 kHz) → SharedArrayBuffer Ring Buffer → Web Worker
     → Resample to 22.05 kHz → Basic Pitch model → Note Events → Policy engine
     → React UI (Wait mode state machine, feedback, logging)
```

Key tunables (baseline):
- Rolling window `W = 1.3 s`, decision tail `G = 120 ms`, inference cadence `Δ = 40 ms`
- Guitar range gate `E2–E6` (extend to `D2` for Drop-D)
- Confirmation threshold `framesConfirm = 3` (≈120 ms), detune tolerance `±50 cents`

### Core Modules
1. **AudioWorkletProcessor** – captures mono input, writes Float32 samples into a `SharedArrayBuffer`. Requires COOP/COEP headers (already documented in the implementation plan).
2. **Shared ring buffer util** – wraps SAB read/write operations with Atomics to safely transfer the last `W` seconds into the worker on demand.
3. **Inference Worker** – wakes up every `tickMs`, copies the tail window, resamples to 22.05 kHz, runs Basic Pitch via ONNX Runtime Web (preferred) or TF.js, and emits note events plus timing metadata.
4. **Basic Pitch adapter** – isolates the runtime (WebGPU/WebGL/WASM). Swappable so we can ship fp16/int8 builds or move between ORT and TF.js without touching hook consumers.
5. **Chord policy engine** – converts the note events in the `[now-G, now]` tail into pitch classes, applies policy rules (K-of-N by default) and emits `CHORD_MATCH` / `CHORD_MISS` events with partial feedback info.
6. **`useChordVerifier` hook** – React-friendly surface that exposes `start()`, `stop()`, `setExpected(chordSpec)` and streams the worker results to Wait mode / feedback components. The hook also handles warm-up, permission prompts, and teardown.

Detailed scaffolding (types, worker wiring, resampler, hook) lives in `Implementation Plan - Pitch Detection.md`. Treat that file as the canonical reference when creating `src/audio`, `src/workers`, and `src/hooks` files.

### Dependencies
Install the audio stack packages once the Vite project is initialized:
```bash
npm install @spotify/basic-pitch onnxruntime-web tonal
```
Optional: include `@tensorflow/tfjs` if we need the TF.js build, otherwise lean on ORT Web for better WebGPU support.

### Worker Loop Summary
```typescript
// pseudo-code based on Implementation Plan
const workerState = {
  model: await loadBasicPitchModel(),
  ring: SharedRingBuffer.from(initMessage.sab),
  windowSamples: initMessage.windowSec * initMessage.sampleRate,
};

setInterval(async () => {
  workerState.ring.readLast(windowBuffer);
  resampleLinear(windowBuffer, 48000, 22050, resampledBuffer);
  const noteEvents = await runBasicPitch(resampledBuffer);
  const verdict = evaluateChordPolicy(noteEvents, currentExpectedChord, config);
  postMessage(verdict);
}, tickMs);
```

### Policy Engine Essentials
- **K-of-N (default):** success when ≥K expected pitch classes are confirmed in the tail window. Use `K = min(2, N)` for triads unless a chord explicitly requires all tones.
- **Includes-target:** success when at least one expected pitch class is present (useful for melodic passages while a chord sustains).
- **Bass-priority:** success only if the lowest confirmed MIDI note maps to one of the expected pitch classes (good for root-focus exercises).
- **Partial feedback:** always emit `matched[]` and `missing[]` pitch classes so the UI can color chords yellow or show “Missing: B”.
- **Debounce:** after a success, suppress another success for ~200 ms to avoid multiple triggers during sustain.

### React Integration Flow
1. User clicks “Start practice” → `useChordVerifier.start()` requests mic permission, initializes AudioWorklet + worker, and performs one warm-up inference.
2. Practice screen subscribes to hook callbacks (`onResult`, `onError`). When the state machine loads a new note/chord group, call `setExpected({ name, pcs, K })`.
3. Worker emits events:
   - `TICK` for diagnostics (UI can show latency)
   - `NOTES` for debugging overlays (optional)
   - `CHORD_MATCH` / `CHORD_MISS` with `matched`, `missing`, `t`
4. Wait mode consumes these events to advance, set feedback colors, and update streak/accuracy counters.

### Reference Implementation
Follow **Implementation Plan – Pitch Detection** for:
- COOP/COEP server headers (Vite + production hosting)
- Type definitions (`PitchClass`, `ChordSpec`, worker messages)
- `SharedRingBuffer` helper
- Resampling utility
- Worker + hook wiring
- Minimal demo component for local verification

That file is intentionally production-ready; copy the scaffold into `src/audio`, `src/workers`, and `src/hooks`, then tailor as needed.

### Testing & Calibration Notes
- Start with `windowSec=1.3`, `tickMs=40`, `tailMs=120`, `framesConfirm=3`, `centsTol=50`.
- Provide a debug overlay (e.g., 12-bin ring) to visualize detected pitch classes during tuning sessions.
- Log inference duration and matched pitch classes to the console while developing; aim for <60 ms per inference on desktop WebGPU/WebGL.
- If SAB is unavailable (older Safari), detect capability early and show a friendly “unsupported browser” message for now (future work: fall back to a simpler analyzer).

---

# Tab Display with VexFlow

## VexFlow Integration

```bash
npm install vexflow
```

```typescript
// components/NotationDisplay.tsx
import { useEffect, useRef } from 'react';
import { Renderer, Stave, TabStave, Voice, Formatter, TabNote } from 'vexflow';

interface NotationDisplayProps {
  notes: Note[];
  currentNoteIndex: number;
}

export function NotationDisplay({ notes, currentNoteIndex }: NotationDisplayProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Clear previous render
    containerRef.current.innerHTML = '';

    // Create renderer
    const renderer = new Renderer(
      containerRef.current,
      Renderer.Backends.SVG
    );
    renderer.resize(800, 200);
    const context = renderer.getContext();

    // Create tab stave
    const stave = new TabStave(10, 40, 780);
    stave.addClef('tab');
    stave.setContext(context).draw();

    // Convert our notes to VexFlow TabNotes
    const tabNotes = notes.slice(0, 8).map((note, idx) => {
      const positions = noteToTabPosition(note.pitch);
      const tabNote = new TabNote({
        positions,
        duration: durationToVexFlow(note.duration)
      });

      // Highlight current note
      if (idx === currentNoteIndex) {
        tabNote.setStyle({ fillStyle: 'green', strokeStyle: 'green' });
      }

      return tabNote;
    });

    // Format and draw
    const voice = new Voice({ num_beats: 4, beat_value: 4 });
    voice.addTickables(tabNotes);

    new Formatter().joinVoices([voice]).format([voice], 700);
    voice.draw(context, stave);

  }, [notes, currentNoteIndex]);

  return <div ref={containerRef} />;
}

// Convert note name to tab position
function noteToTabPosition(noteName: string): Array<{ str: number, fret: number }> {
  // Map note names to guitar tab positions
  // E2=string 6, F2=string 6 fret 1, etc.
  const NOTE_TO_TAB: Record<string, { str: number, fret: number }> = {
    'E2': { str: 6, fret: 0 },
    'F2': { str: 6, fret: 1 },
    'F#2': { str: 6, fret: 2 },
    'G2': { str: 6, fret: 3 },
    'G#2': { str: 6, fret: 4 },
    'A2': { str: 5, fret: 0 },
    'A#2': { str: 5, fret: 1 },
    'B2': { str: 5, fret: 2 },
    'C3': { str: 5, fret: 3 },
    'C#3': { str: 5, fret: 4 },
    'D3': { str: 4, fret: 0 },
    'D#3': { str: 4, fret: 1 },
    'E3': { str: 4, fret: 2 },
    'F3': { str: 4, fret: 3 },
    'F#3': { str: 4, fret: 4 },
    'G3': { str: 3, fret: 0 },
    'G#3': { str: 3, fret: 1 },
    'A3': { str: 3, fret: 2 },
    'A#3': { str: 3, fret: 3 },
    'B3': { str: 2, fret: 0 },
    'C4': { str: 2, fret: 1 },
    'C#4': { str: 2, fret: 2 },
    'D4': { str: 2, fret: 3 },
    'D#4': { str: 2, fret: 4 },
    'E4': { str: 1, fret: 0 },
    'F4': { str: 1, fret: 1 },
    'F#4': { str: 1, fret: 2 },
    'G4': { str: 1, fret: 3 },
    // Add more as needed
  };

  const position = NOTE_TO_TAB[noteName];
  if (!position) {
    console.warn(`Unknown note: ${noteName}`);
    return [{ str: 1, fret: 0 }];
  }

  return [position];
}

function durationToVexFlow(duration: number): string {
  // duration is in beats (quarter note = 1)
  if (duration >= 4) return 'w';  // Whole note
  if (duration >= 2) return 'h';  // Half note
  if (duration >= 1) return 'q';  // Quarter note
  if (duration >= 0.5) return '8'; // Eighth note
  return '16'; // Sixteenth note
}
```

---

# Data Flow Architecture

## High-Level Flow

```
User starts app
    ↓
Load MusicXML → Parse → Extract Notes
    ↓
Request Microphone Permission
    ↓
Initialize Audio Engine + Pitch Detector
    ↓
Display first measure of tabs
    ↓
Start Detection Loop:
    1. Get audio buffer (60fps)
    2. Detect pitch → Convert to note
    3. Compare with expected note
    4. If correct: advance, show green feedback
    5. If incorrect: show red feedback
    ↓
Repeat until all notes played
    ↓
Show Session Summary (accuracy %)
```

## State Management (React)

For MVP, use **React Context** (no Redux needed yet):

```typescript
// App.tsx or context file
interface AppState {
  song: Song | null;
  currentNoteIndex: number;
  detectedNote: string | null;
  isCorrect: boolean | null;
  totalCorrect: number;
  totalAttempts: number;
}

const AppContext = React.createContext<AppState>({ /* defaults */ });
```

---

# Environment Setup

## Prerequisites

- **Node.js**: 18.x or higher
- **npm**: 9.x or higher (comes with Node)
- **Browser**: Chrome 90+ or Firefox 88+ (for Web Audio API)
- **Git**: For version control

## Installation Steps

### 1. Install Node.js

```bash
# Check if already installed
node --version
npm --version

# If not installed, download from https://nodejs.org
# Or use nvm (recommended):
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 18
nvm use 18
```

### 2. Create Project

```bash
cd ~/Desktop/raziel
npm create vite@latest . -- --template react-ts

# Install dependencies
npm install

# Install additional packages for MVP
npm install fast-xml-parser vexflow @spotify/basic-pitch onnxruntime-web tonal
npm install -D @types/node
```

**Package Explanations:**
- `fast-xml-parser` - Parse MusicXML files
- `vexflow` - Render guitar tabs
- `@spotify/basic-pitch` - Pretrained polyphonic transcription model
- `onnxruntime-web` - Browser runtime (WebGPU/WebGL/WASM) for Basic Pitch
- `tonal` - Pitch-class helpers for chord specification/transposition

### 3. Configure TypeScript

Update `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

### 4. Move MusicXML File

```bash
mkdir -p public/songs
mv "Song of Storms - Legend of Zelda (Simple Guitar Tab).musicxml" public/songs/song-of-storms.musicxml
```

### 5. Run Development Server

```bash
npm run dev
# Open http://localhost:5173
```

---

# Development Workflow

## Week 1: Audio Foundation with Basic Pitch

**Goal:** Stand up the AudioWorklet → SharedArrayBuffer → Worker pipeline and prove Basic Pitch inference + chord policies run in the browser.

**Tasks:**
1. Add COOP/COEP headers to `vite.config.ts` (see implementation plan).
2. Copy the SharedArrayBuffer ring buffer, resampler, worker, and hook scaffolding from `Implementation Plan - Pitch Detection.md` into `src/audio`, `src/workers`, and `src/hooks`.
3. Implement `useChordVerifier` to expose `start/stop/setExpected` and stream worker events.
4. Hardcode a simple `ChordSpec` (e.g., `E minor`) and log `CHORD_MATCH` / `CHORD_MISS` events to the console while strumming.
5. Add a minimal UI (`Start listening` button + result log) to verify the worker loop stays under target latency.
6. Capture inference metrics (tick duration, inference ms) in the console for calibration.

**Deliverable:** Playing open strings or simple chords prints Basic Pitch detections and K-of-N verdicts in the browser console within ~250 ms.

**Files to Create:**
- `src/audio/worklets/input-processor.ts`
- `src/audio/ringBuffer.ts`
- `src/workers/basicPitchWorker.ts`
- `src/hooks/useChordVerifier.ts`
- `src/components/AudioDebugPanel.tsx`

## Week 2: MusicXML Parsing & Display

**Goal:** Load Song of Storms and display tabs with chords.

**Tasks:**
1. Create `musicXmlParser.ts`.
2. Fetch and parse `/songs/song-of-storms.musicxml`.
3. Group notes by time position (for chord detection).
4. Console.log the note groups.
5. Create `NotationDisplay` component with VexFlow.
6. Display first measure with tabs (including chords).
7. Highlight current note/chord.

**Deliverable:** Tabs render on screen showing both single notes and chords stacked.

**Files to Create:**
- `src/services/musicXmlParser.ts`
- `src/components/NotationDisplay.tsx`
- `src/utils/noteUtils.ts`

## Week 3: Chord Matching & Wait Mode

**Goal:** Feed Basic Pitch verdicts into the Wait mode controller and advance notation when chords are correct.

**Tasks:**
1. Create `chordMatcher.ts` (or extend the policy engine) to translate worker events (`matched`, `missing`, `salience`) into UI-ready feedback.
2. Create `WaitModeController.ts` to manage progression through grouped notes.
3. Connect `useChordVerifier` to the controller: call `setExpected` when the current group changes, listen for `CHORD_MATCH` to advance.
4. Show visual feedback based on `matched/missing` arrays:
   - Green = success
   - Yellow = partial (some notes correct)
   - Red = incorrect / no matches yet
5. Display helpful tips (e.g., “Missing: B”) using worker diagnostics.
6. Track streaks and accuracy.

**Deliverable:** Play notes/chords, see tabs advance and get color-coded feedback driven by the worker events.

**Files to Create:**
- `src/services/chordMatcher.ts`
- `src/services/waitModeController.ts`
- `src/components/FeedbackBar.tsx`

## Week 4: Complete MVP & Polish

**Goal:** End-to-end working app with session summary.

**Tasks:**
1. Build session summary screen (accuracy %, chord breakdown, time played).
2. Add “Restart” button and error states (e.g., unsupported browser when SAB missing).
3. Basic styling with CSS (center layout, readable fonts, dark theme option).
4. Manual testing with real guitar (clean DI + mic) to tune policy thresholds.
5. Log inference metrics in summary (avg latency, match rate) to help future optimization.
6. Address bugs and UX polish.

**Deliverable:** Working MVP – load song, play through it with Basic Pitch verification, view session summary.

**Files to Create:**
- `src/components/SessionSummary.tsx`
- `src/styles/global.css`
- `src/components/UnsupportedBrowser.tsx`

---

# Testing Strategy (MVP)

## Manual Testing

Primary testing method for MVP:

1. **Audio Detection Test**
   - Play each guitar string open
   - Verify `useChordVerifier` logs the correct pitch classes (watch `matched/missing` in devtools)
   - Test with different volumes and both DI + mic inputs

2. **Note Matching Test**
   - Play Song of Storms slowly in Wait mode
   - Verify tabs advance only after `CHORD_MATCH` events arrive
   - Test incorrect notes (should produce `CHORD_MISS` with helpful missing notes)

3. **Browser Compatibility**
   - Test in Chrome with WebGPU/WebGL
   - Test in Firefox (falls back to WebAssembly backend if WebGPU unavailable)
   - Safari currently lacks SAB by default; show Unsupported state instead of crashing

## Automated Testing (Phase 2)

For MVP, skip unit tests. Add later:
- Mock `AudioContext` for testing
- Test MusicXML parser with fixture files
- Test note matching logic

---

# Performance Targets

## MVP Requirements

- **Detection Latency**: < 250 ms median / < 300 ms p95 from pluck to `CHORD_MATCH`
- **Frame Rate**: 60 FPS for UI updates
- **Memory**: < 200MB RAM usage (model + buffers)
- **Load Time**: < 3 seconds to first render (model download included)

## Optimization Strategy

1. **Inference cadence**: Keep worker `tickMs` at 40 ms; backpressure if inference > tick to prevent piling up.
2. **Model warm-up**: Run one silent inference after load to prime WebGPU/WebGL shaders.
3. **VexFlow rendering**: Only re-render when notes change.
4. **Audio buffers**: Reuse Float32Arrays for SAB reads/resampling; avoid per-tick allocations.

---

# Troubleshooting Guide

## Common Issues

### 1. Microphone not working
- Check browser permissions (chrome://settings/content/microphone)
- Ensure HTTPS (or localhost) - Web Audio requires secure context
- Try different browser
- Confirm COOP/COEP headers are applied; without them the AudioWorklet may fail silently

### 2. Notes/chords not detected
- Make sure the worker reports `modelLoaded=true`; if not, verify Basic Pitch assets are served.
- Confirm SharedArrayBuffer is available (look for console warning about cross-origin isolation).
- Verify guitar is in tune and input gain is sufficient (watch waveform debug panel).
- Adjust `framesConfirm`, `centsTol`, or `K` in chord policy config for edge cases.
- Use the debug 12-bin ring / event log to see which pitch classes are being detected.

### 3. Wrong notes detected or too many notes
- Ensure `minF0Hz`/`maxF0Hz` gate matches the tuning (Drop-D requires extending to D2).
- Increase `framesConfirm` to 4 if strums are re-triggering too quickly.
- Use `debounceMs` to avoid multiple matches while a chord sustains.
- Check that ORT is using WebGPU/WebGL; WASM-only can increase latency and jitter.

### 4. VexFlow not rendering
- Check container has width/height
- Verify note-to-tab mapping
- Check browser console for errors

---

# Next Steps After MVP

Once MVP is working:

1. **Add second song** - test with different structure
2. **Improve chord detection** - tune CHROMA_THRESHOLD, try Essentia.js for HPCP
3. **Add Play mode** - tempo-based advancement with metronome
4. **Song library UI** - multiple songs, search, filters
5. **Backend setup** - start Phase 2 of Architecture.md (user accounts, progress tracking)

---

# Key Constants & Configuration

```typescript
// utils/constants.ts

// Audio / Inference pipeline
export const INPUT_SAMPLE_RATE = 48000;      // AudioWorklet capture rate
export const RESAMPLED_RATE = 22050;         // Basic Pitch model rate
export const WINDOW_SEC = 1.3;               // Rolling window length
export const TICK_MS = 40;                   // Worker cadence
export const TAIL_MS = 120;                  // Decision tail
export const FRAMES_CONFIRM = 3;             // ~120 ms persistence
export const CENTS_TOL = 50;                 // Allow ±50 cents detune
export const MIN_F0_HZ = 82.41;              // E2 (extend to 73.42 for Drop-D)
export const MAX_F0_HZ = 1318.51;            // E6
export const MATCH_DEBOUNCE_MS = 200;        // Prevent double-triggers on sustain

// Policy defaults
export const DEFAULT_POLICY = 'K_OF_N';
export const DEFAULT_K = 2;                  // Triads require 2 confirmed pitch classes

// UI
export const NOTES_PER_LINE = 8;             // How many notes to show at once in tabs
export const FEEDBACK_DISPLAY_MS = 300;      // How long to show feedback before advancing

// Pitch classes (mod 12 order)
export const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

```

**Tuning Notes:**
- Reduce `CENTS_TOL` to 35 if bends or vibrato cause false positives.
- Increase `FRAMES_CONFIRM` to 4–5 for very fast strums to avoid accidental matches.
- Drop `TICK_MS` to 30 if inference fits comfortably and you want even lower latency.
- Expand `MIN_F0_HZ` to 73.42 when practicing in Drop-D or other low tunings.

---

# Summary Checklist

Before starting implementation:
- [ ] Node.js 18+ installed
- [ ] Vite + React + TypeScript project created
- [ ] `fast-xml-parser`, `vexflow`, `@spotify/basic-pitch`, `onnxruntime-web`, and `tonal` installed
- [ ] MusicXML file in `public/songs/`
- [ ] Project structure folders created
- [ ] Git repository initialized

First code to write (Week 1):
1. AudioWorklet processor + ring buffer to capture audio into SharedArrayBuffer
2. Basic Pitch worker + adapter (copy from implementation plan scaffold)
3. `useChordVerifier` hook with `start/stop/setExpected`
4. Minimal UI that logs `CHORD_MATCH` / `CHORD_MISS`

**Focus:** Get the Basic Pitch pipeline running first, confirm policies behave correctly, then layer on notation + UI.

**MVP Timeline:** 4 weeks to working chord detection app
