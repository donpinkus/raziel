# Raziel - Technical Specification (MVP)

This document provides implementation-level details for building the Raziel MVP. Focus is on **core functionality first, UX polish later**.

---

# MVP Scope Definition

## What We're Building (MVP v1)

**Goal:** Prove the core concept - detect guitar notes AND chords, provide feedback.

**Features (Minimal Set):**
- Load **one** pre-existing MusicXML file (Song of Storms)
- Display guitar tablature (tab view only, no staff notation)
- Capture audio from microphone
- Detect **both single notes AND chords** using chromagram-based detection
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

## Research-Backed Approach

### Industry Standard: Chromagram / Pitch Class Profile (PCP)

After researching current best practices in guitar chord detection (see references), the **chromagram** (also called Pitch Class Profile) is the proven approach for chord recognition:

**Why Chromagram:**
- Industry standard for chord recognition in music information retrieval (MIR)
- Reduces all frequencies to 12 pitch classes (C, C#, D, etc.) regardless of octave
- Perfect for guitar chords where octave doesn't matter (E3 and E4 both = "E")
- Handles polyphonic audio (multiple notes simultaneously)
- Robust to overtones and harmonics

**How It Works:**
1. Use **Constant-Q Transform** (CQT) instead of FFT - uses logarithmically-spaced frequencies like human hearing
2. Compute energy in each of 12 pitch classes
3. Get a 12-dimensional vector representing which notes are present
4. Match against expected chord

**Alternatives Considered:**
- Simple autocorrelation: Can't detect multiple simultaneous pitches (chords)
- Pure FFT peak detection: Too sensitive to harmonics, hard to distinguish fundamentals
- Machine Learning: Overkill for MVP, requires training data
- Multiple autocorrelation passes: Computationally expensive, less accurate

### JavaScript Library Choice: Meyda

**Use:** [Meyda](https://meyda.js.org/) - Audio feature extraction library

```bash
npm install meyda
```

**Why Meyda:**
- Built specifically for Web Audio API
- Has **chroma** feature extraction built-in (12-bin chromagram)
- Lightweight (~50KB)
- Actively maintained
- Well-documented
- Used in production applications

**Alternatives:**
- **Essentia.js**: More comprehensive but heavier (~2MB), includes HPCP (Harmonic PCP)
- **chord_detector**: Outdated (8 years old)
- **Custom implementation**: Time-consuming, harder to get right

**References:**
- Fujishima, T. (1999). "Realtime Chord Recognition of Musical Sound"
- Meyda documentation: https://meyda.js.org/
- Music Technology Group, Essentia.js research papers

## Web Audio API Setup with Meyda

```typescript
// services/audioEngine.ts
import Meyda from 'meyda';

export class AudioEngine {
  private audioContext: AudioContext;
  private analyser: AnalyserNode;
  private microphone: MediaStreamAudioSourceNode | null = null;
  private meydaAnalyzer: any; // Meyda analyzer instance

  constructor() {
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.analyser = this.audioContext.createAnalyser();

    // Configuration for chroma extraction
    this.analyser.fftSize = 8192;  // Larger FFT for better frequency resolution
    this.analyser.smoothingTimeConstant = 0.8;  // Smooth out noise
  }

  async startMicrophone(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        sampleRate: 44100  // Standard sample rate
      }
    });

    this.microphone = this.audioContext.createMediaStreamSource(stream);
    this.microphone.connect(this.analyser);
    // Note: Don't connect to destination - we don't want to hear ourselves

    // Initialize Meyda analyzer
    this.meydaAnalyzer = Meyda.createMeydaAnalyzer({
      audioContext: this.audioContext,
      source: this.microphone,
      bufferSize: 8192,
      featureExtractors: ['chroma', 'rms'],  // Extract chromagram and signal strength
      callback: null  // We'll get features manually
    });
  }

  getChroma(): number[] | null {
    if (!this.meydaAnalyzer) return null;

    const features = this.meydaAnalyzer.get(['chroma', 'rms']);

    // Check if signal is strong enough
    if (!features || features.rms < 0.01) {
      return null;  // Too quiet
    }

    // Chroma is a 12-element array representing pitch classes
    // [C, C#, D, D#, E, F, F#, G, G#, A, A#, B]
    return features.chroma;
  }

  getSampleRate(): number {
    return this.audioContext.sampleRate;
  }

  stop(): void {
    if (this.microphone) {
      this.microphone.disconnect();
      this.microphone.mediaStream.getTracks().forEach(track => track.stop());
    }
  }
}
```

## Chord Detection Algorithm Using Chromagram

```typescript
// services/chordDetector.ts

// Pitch class names corresponding to chroma array indices
const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export interface DetectedNotes {
  pitchClasses: string[];  // e.g., ['E', 'G', 'B']
  confidence: number;       // Overall confidence (0-1)
}

export class ChordDetector {
  private readonly CHROMA_THRESHOLD = 0.15;  // Minimum energy to consider a pitch class present

  /**
   * Convert chromagram (12-element array) to detected pitch classes
   * @param chroma - 12-element array from Meyda [C, C#, D, ..., B]
   * @returns Detected notes with confidence
   */
  detectNotes(chroma: number[]): DetectedNotes | null {
    if (!chroma || chroma.length !== 12) return null;

    // Normalize chroma vector (make it sum to 1)
    const sum = chroma.reduce((a, b) => a + b, 0);
    if (sum < 0.01) return null; // Too quiet

    const normalizedChroma = chroma.map(v => v / sum);

    // Find peaks above threshold
    const detectedPitches: string[] = [];
    const values: number[] = [];

    for (let i = 0; i < 12; i++) {
      if (normalizedChroma[i] > this.CHROMA_THRESHOLD) {
        detectedPitches.push(PITCH_CLASSES[i]);
        values.push(normalizedChroma[i]);
      }
    }

    if (detectedPitches.length === 0) return null;

    // Calculate average confidence
    const confidence = values.reduce((a, b) => a + b, 0) / values.length;

    return {
      pitchClasses: detectedPitches,
      confidence
    };
  }

  /**
   * Add octave information to pitch classes based on expected notes
   * For MVP: Simple matching without worrying too much about octave
   */
  matchToExpectedNotes(detected: string[], expected: string[]): string[] {
    // Extract pitch classes from expected notes (remove octave)
    const expectedPitchClasses = expected.map(note => note.replace(/\d+$/, ''));

    // Match detected pitch classes, assuming octaves from expected
    const matched: string[] = [];

    for (const expectedFull of expected) {
      const pitchClass = expectedFull.replace(/\d+$/, '');
      if (detected.includes(pitchClass)) {
        matched.push(expectedFull);  // Keep the full note with octave
      }
    }

    return matched;
  }

  /**
   * Normalize note names for comparison (handle enharmonic equivalents)
   */
  normalizePitchClass(note: string): string {
    // Remove octave number
    const pitchClass = note.replace(/\d+$/, '');

    // Map flats to sharps for consistent comparison
    const flatToSharp: Record<string, string> = {
      'Db': 'C#',
      'Eb': 'D#',
      'Gb': 'F#',
      'Ab': 'G#',
      'Bb': 'A#'
    };

    return flatToSharp[pitchClass] || pitchClass;
  }
}
```

## Chord Matching Logic

```typescript
// services/chordMatcher.ts

export interface MatchResult {
  isCorrect: boolean;
  correctNotes: string[];   // Notes that were played correctly
  missingNotes: string[];   // Notes that should be played but weren't
  extraNotes: string[];     // Notes that were played but shouldn't be
  accuracy: number;         // 0-100%
}

export function matchChord(
  detectedNotes: string[],
  expectedNotes: string[]
): MatchResult {
  // Normalize all notes (remove octaves for comparison)
  const normalize = (note: string) => note.replace(/\d+$/, '');

  const detectedSet = new Set(detectedNotes.map(normalize));
  const expectedSet = new Set(expectedNotes.map(normalize));

  // Find overlaps
  const correctNotes = expectedNotes.filter(n => detectedSet.has(normalize(n)));
  const missingNotes = expectedNotes.filter(n => !detectedSet.has(normalize(n)));
  const extraNotes = detectedNotes.filter(n => !expectedSet.has(normalize(n)));

  // Calculate accuracy
  const accuracy = expectedNotes.length > 0
    ? (correctNotes.length / expectedNotes.length) * 100
    : 0;

  // Determine if correct:
  // - For single notes: must match exactly
  // - For 2-note chords: need both notes
  // - For 3+ note chords: need at least 66% (2 out of 3, 3 out of 4, etc.)
  let isCorrect: boolean;
  if (expectedNotes.length === 1) {
    isCorrect = correctNotes.length === 1 && missingNotes.length === 0;
  } else if (expectedNotes.length === 2) {
    isCorrect = correctNotes.length === 2;
  } else {
    const threshold = Math.ceil(expectedNotes.length * 0.66);
    isCorrect = correctNotes.length >= threshold;
  }

  return {
    isCorrect,
    correctNotes,
    missingNotes,
    extraNotes,
    accuracy
  };
}
```

## Detection Loop

```typescript
// In PracticeScreen component or a detection service
function startDetectionLoop() {
  const audioEngine = new AudioEngine();
  await audioEngine.startMicrophone();

  const chordDetector = new ChordDetector();
  let lastDetectionTime = 0;
  const DETECTION_INTERVAL = 100; // Detect every 100ms (10 times per second)

  function detectFrame(timestamp: number) {
    // Throttle detection to avoid processing every frame
    if (timestamp - lastDetectionTime < DETECTION_INTERVAL) {
      requestAnimationFrame(detectFrame);
      return;
    }
    lastDetectionTime = timestamp;

    // Get chromagram from Meyda
    const chroma = audioEngine.getChroma();

    if (chroma) {
      const detected = chordDetector.detectNotes(chroma);

      if (detected && detected.pitchClasses.length > 0) {
        console.log(`Detected pitch classes: ${detected.pitchClasses.join(', ')}`);
        console.log(`Confidence: ${(detected.confidence * 100).toFixed(1)}%`);

        // Pass to chord matching logic
        handleDetectedChord(detected.pitchClasses);
      }
    }

    requestAnimationFrame(detectFrame);
  }

  requestAnimationFrame(detectFrame);
}
```

---

# Note & Chord Matching Logic (Wait Mode)

## Wait Mode Implementation

In Wait mode:
1. Show current note/chord that needs to be played
2. Listen for that note/chord
3. When detected correctly, advance to next
4. Show partial feedback for chords (yellow = some notes correct)
5. Track accuracy

```typescript
// services/waitModeController.ts
import { matchChord, MatchResult } from './chordMatcher';
import { NoteGroup } from './musicXmlParser';

export interface FeedbackResult {
  isCorrect: boolean;
  isPartial: boolean;     // True if some (but not all) notes in chord are correct
  matchResult: MatchResult;
  feedbackColor: 'green' | 'yellow' | 'red';
}

export class WaitModeController {
  private currentGroupIndex = 0;
  private noteGroups: NoteGroup[];  // Groups of notes (single or chord)
  private correctCount = 0;
  private totalAttempts = 0;
  private onGroupAdvance: (index: number, feedback: FeedbackResult) => void;

  constructor(
    noteGroups: NoteGroup[],
    onGroupAdvance: (index: number, feedback: FeedbackResult) => void
  ) {
    this.noteGroups = noteGroups;
    this.onGroupAdvance = onGroupAdvance;
  }

  getCurrentGroup(): NoteGroup | null {
    if (this.currentGroupIndex >= this.noteGroups.length) {
      return null; // Song finished
    }
    return this.noteGroups[this.currentGroupIndex];
  }

  /**
   * Check detected notes against expected notes/chord
   * @param detectedPitchClasses - Array of detected pitch classes (e.g., ['E', 'G', 'B'])
   * @returns Feedback result
   */
  checkNotes(detectedPitchClasses: string[]): FeedbackResult | null {
    const expected = this.getCurrentGroup();
    if (!expected) return null;

    this.totalAttempts++;

    // Get expected note names
    const expectedNotes = expected.notes.map(n => n.pitch);

    // Match detected against expected
    const matchResult = matchChord(detectedPitchClasses, expectedNotes);

    // Determine feedback
    let isPartial = false;
    let feedbackColor: 'green' | 'yellow' | 'red' = 'red';

    if (matchResult.isCorrect) {
      feedbackColor = 'green';
      this.correctCount++;
      this.currentGroupIndex++;
      // Notify listeners to advance
      setTimeout(() => {
        this.onGroupAdvance(this.currentGroupIndex, {
          isCorrect: true,
          isPartial: false,
          matchResult,
          feedbackColor: 'green'
        });
      }, 300);  // Brief delay to show feedback
    } else if (matchResult.accuracy > 0) {
      // Some notes correct but not all
      isPartial = true;
      feedbackColor = 'yellow';
    }

    return {
      isCorrect: matchResult.isCorrect,
      isPartial,
      matchResult,
      feedbackColor
    };
  }

  getAccuracy(): number {
    if (this.totalAttempts === 0) return 0;
    return (this.correctCount / this.totalAttempts) * 100;
  }

  isFinished(): boolean {
    return this.currentGroupIndex >= this.noteGroups.length;
  }

  getProgress(): { current: number; total: number } {
    return {
      current: this.currentGroupIndex,
      total: this.noteGroups.length
    };
  }
}
```

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
npm install fast-xml-parser vexflow meyda
npm install -D @types/node
```

**Package Explanations:**
- `fast-xml-parser` - Parse MusicXML files
- `vexflow` - Render guitar tabs
- `meyda` - Extract chromagram for chord detection

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

## Week 1: Audio Foundation with Chromagram

**Goal:** Get audio input working and detecting pitch classes.

**Tasks:**
1. Create `AudioEngine` class with Meyda integration
2. Get microphone permission working
3. Extract chromagram from audio
4. Create `ChordDetector` class
5. Convert chromagram to detected pitch classes
6. Create simple UI with "Start" button
7. Console.log detected pitch classes

**Deliverable:** Play any note/chord, see pitch classes in console (e.g., "Detected: E, G, B")

**Files to Create:**
- `src/services/audioEngine.ts`
- `src/services/chordDetector.ts`
- `src/App.tsx` (basic UI)

## Week 2: MusicXML Parsing & Display

**Goal:** Load Song of Storms and display tabs with chords.

**Tasks:**
1. Create `musicXmlParser.ts`
2. Fetch and parse `/songs/song-of-storms.musicxml`
3. Group notes by time position (for chord detection)
4. Console.log the note groups
5. Create `NotationDisplay` component with VexFlow
6. Display first measure with tabs (including chords)
7. Highlight current note/chord

**Deliverable:** Tabs render on screen showing both single notes and chords stacked

**Files to Create:**
- `src/services/musicXmlParser.ts`
- `src/components/NotationDisplay.tsx`
- `src/utils/noteUtils.ts`

## Week 3: Chord Matching & Wait Mode

**Goal:** Match detected notes/chords against expected and advance.

**Tasks:**
1. Create `chordMatcher.ts` - compare detected vs expected
2. Create `WaitModeController.ts` - manage progression
3. Connect chord detector to wait mode controller
4. Advance when correct note/chord detected
5. Show visual feedback:
   - Green = correct
   - Yellow = partial (some notes in chord correct)
   - Red = incorrect
6. Display helpful feedback (e.g., "Missing: B")

**Deliverable:** Play notes/chords, see tabs advance and get color-coded feedback

**Files to Create:**
- `src/services/chordMatcher.ts`
- `src/services/waitModeController.ts`
- `src/components/FeedbackBar.tsx`

## Week 4: Complete MVP & Polish

**Goal:** End-to-end working app with session summary.

**Tasks:**
1. Build session summary screen
   - Show accuracy percentage
   - Show number of correct vs total
   - Show chords vs single notes breakdown
2. Add "Restart" button
3. Basic styling with CSS
   - Center content
   - Readable fonts
   - Clean layout
4. Test with real guitar
5. Tune detection thresholds based on testing
6. Bug fixes

**Deliverable:** Working MVP - load song, play through it, see summary

**Files to Create:**
- `src/components/SessionSummary.tsx`
- `src/styles/global.css`

## Testing Strategy

After each week:
1. **Manual testing with guitar**
2. **Tune thresholds** (CHROMA_THRESHOLD, detection intervals)
3. **Console.log extensively** to debug detection issues
4. **Test edge cases** (loud/quiet, different guitars, background noise)

---

# Testing Strategy (MVP)

## Manual Testing

Primary testing method for MVP:

1. **Audio Detection Test**
   - Play each guitar string open
   - Verify correct note detected
   - Test with different volumes

2. **Note Matching Test**
   - Play Song of Storms slowly
   - Verify tabs advance correctly
   - Test incorrect notes (shouldn't advance)

3. **Browser Compatibility**
   - Test in Chrome
   - Test in Firefox
   - (Safari has Web Audio issues, skip for MVP)

## Automated Testing (Phase 2)

For MVP, skip unit tests. Add later:
- Mock `AudioContext` for testing
- Test MusicXML parser with fixture files
- Test note matching logic

---

# Performance Targets

## MVP Requirements

- **Detection Latency**: < 100ms (from note played to detection)
- **Frame Rate**: 60 FPS for UI updates
- **Memory**: < 200MB RAM usage
- **Load Time**: < 2 seconds to first render

## Optimization Strategy

1. **Detection loop**: Use `requestAnimationFrame` (60 Hz), not `setInterval`
2. **VexFlow rendering**: Only re-render when notes change
3. **Audio buffer**: Reuse Float32Array, don't allocate each frame

---

# Troubleshooting Guide

## Common Issues

### 1. Microphone not working
- Check browser permissions (chrome://settings/content/microphone)
- Ensure HTTPS (or localhost) - Web Audio requires secure context
- Try different browser

### 2. Notes/chords not detected
- Check Meyda RMS threshold (might be too high)
- Verify guitar is in tune
- Try playing note/chord louder and clearer
- Lower CHROMA_THRESHOLD (try 0.10 instead of 0.15)
- Check console for chromagram values

### 3. Wrong notes detected or too many notes
- CHROMA_THRESHOLD too low - increase it (try 0.20)
- Guitar overtones triggering false positives
- Play notes more cleanly (mute unused strings)
- Check that chromagram shows expected peaks

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

// Audio Engine (Meyda)
export const FFT_SIZE = 8192;  // Larger FFT for better frequency resolution with chromagram
export const SMOOTHING_TIME_CONSTANT = 0.8;
export const BUFFER_SIZE = 8192;  // For Meyda analyzer
export const SAMPLE_RATE = 44100;

// Chord Detection (Chromagram)
export const CHROMA_THRESHOLD = 0.15;  // Minimum normalized energy to consider pitch class present
export const MIN_RMS_THRESHOLD = 0.01; // Minimum signal strength to process

// Note Matching
export const DETECTION_INTERVAL_MS = 100; // Check for notes every 100ms (10 Hz)

// Chord Matching Thresholds
export const SINGLE_NOTE_EXACT_MATCH = true;
export const TWO_NOTE_CHORD_BOTH_REQUIRED = true;
export const MULTI_NOTE_CHORD_THRESHOLD = 0.66; // Need 66% of notes for 3+ note chords

// UI
export const NOTES_PER_LINE = 8; // How many notes to show at once in tabs
export const FEEDBACK_DISPLAY_MS = 300; // How long to show feedback before advancing

// Pitch Classes (matching Meyda's chromagram order)
export const PITCH_CLASSES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
```

**Tuning Notes:**
- If too sensitive (detecting noise): Increase `CHROMA_THRESHOLD` to 0.20-0.25
- If not sensitive enough (missing notes): Decrease to 0.10-0.12
- If detection is laggy: Decrease `DETECTION_INTERVAL_MS` to 50ms
- If detection is jittery: Increase to 150-200ms

---

# Summary Checklist

Before starting implementation:
- [ ] Node.js 18+ installed
- [ ] Vite + React + TypeScript project created
- [ ] `fast-xml-parser`, `vexflow`, and `meyda` installed
- [ ] MusicXML file in `public/songs/`
- [ ] Project structure folders created
- [ ] Git repository initialized

First code to write (Week 1):
1. `audioEngine.ts` - microphone access + Meyda integration
2. `chordDetector.ts` - chromagram to pitch classes
3. Simple UI with "Start" button
4. Console.log detected pitch classes

**Focus:** Get chromagram extraction working first, see pitch classes in console, then build on top.

**MVP Timeline:** 4 weeks to working chord detection app
