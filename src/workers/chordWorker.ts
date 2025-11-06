/// <reference lib="webworker" />

import { SharedRingBufferReader } from "../audio/ringBuffer";
import { basicPitchAdapter } from "../services/basicPitchAdapter";
import type {
  ResultEvent,
  WorkerInit,
  WorkerSetExpected,
  NoteEvent,
  ChordSpec,
  Policy,
  PitchClass,
} from "../types/audio";
import { resampleMonoBuffer } from "../utils/resample";
import { midiToPitchClass } from "../utils/pitch";

const TARGET_SAMPLE_RATE = 22050;

type IncomingMessage =
  | { type: "INIT"; payload: WorkerInit }
  | { type: "SET_EXPECTED"; payload: WorkerSetExpected }
  | { type: "STOP" };

let reader: SharedRingBufferReader | null = null;
let sampleRate = 48000;
let windowSec = 1.3;
let tickMs = 40;
let expected: ChordSpec | null = null;
let policy: Policy = "K_OF_N";
let framesConfirm = 3;
let transposeSemitones = 0;
let acceptInversions = true;
let audioWindow = new Float32Array(0);
let tickHandle: number | null = null;
let confirmCounter = 0;

self.onmessage = (event: MessageEvent<IncomingMessage>) => {
  const msg = event.data;
  if (!msg) return;
  try {
    switch (msg.type) {
      case "INIT": {
        reader = new SharedRingBufferReader(msg.payload.sab);
        sampleRate = msg.payload.sampleRate;
        windowSec = msg.payload.windowSec;
        tickMs = msg.payload.tickMs;
        ensureWindow();
        basicPitchAdapter.init().catch((err) => reportError(err));
        startTicking();
        break;
      }
      case "SET_EXPECTED": {
        expected = msg.payload.expected;
        policy = msg.payload.policy;
        framesConfirm = msg.payload.framesConfirm;
        transposeSemitones = msg.payload.transposeSemitones;
        acceptInversions = msg.payload.acceptInversions;
        confirmCounter = 0;
        break;
      }
      case "STOP": {
        if (tickHandle !== null) {
          clearInterval(tickHandle);
          tickHandle = null;
        }
        break;
      }
      default:
        break;
    }
  } catch (err) {
    reportError(err);
  }
};

function startTicking() {
  if (tickHandle !== null) return;
  tickHandle = self.setInterval(() => {
    processTick().catch((err) => reportError(err));
  }, tickMs);
}

function ensureWindow() {
  const needed = Math.ceil(windowSec * sampleRate);
  if (audioWindow.length !== needed) {
    audioWindow = new Float32Array(needed);
  }
}

async function processTick() {
  if (!reader || !expected) return;
  ensureWindow();
  reader.readLatest(audioWindow.length, audioWindow);
  const resampled = resampleMonoBuffer(audioWindow, sampleRate, TARGET_SAMPLE_RATE);
  const now = performance.now();
  const notes = await basicPitchAdapter.evaluateMono22k(resampled);
  postMessageSafe({ type: "NOTES", t: now / 1000, notes });
  evaluateChord(notes, now);
  const inferenceMs = performance.now() - now;
  postMessageSafe({ type: "TICK", t: performance.now() / 1000, inferenceMs });
}

function evaluateChord(notes: NoteEvent[], timestamp: number) {
  if (!expected) return;
  const pcsInWindow = new Set<PitchClass>();
  let lowestMidi = Infinity;
  let lowestPc: PitchClass | null = null;
  notes.forEach((note) => {
    const pc = midiToPitchClass(note.midi, transposeSemitones);
    pcsInWindow.add(pc);
    if (note.midi < lowestMidi) {
      lowestMidi = note.midi;
      lowestPc = pc;
    }
  });

  const matched = expected.pcs.filter((pc) => pcsInWindow.has(pc));
  const missing = expected.pcs.filter((pc) => !pcsInWindow.has(pc));
  const required = expected.K ?? Math.min(2, expected.pcs.length);
  let passesPolicy = false;
  switch (policy) {
    case "K_OF_N":
      passesPolicy = matched.length >= required;
      break;
    case "INCLUDES_TARGET":
      passesPolicy = pcsInWindow.has(expected.pcs[0]);
      break;
    case "BASS_PRIORITY":
      passesPolicy =
        matched.length >= required &&
        (!!lowestPc && lowestPc === expected.pcs[0]);
      break;
    default:
      passesPolicy = matched.length >= required;
  }

  if (!acceptInversions && lowestPc !== null) {
    passesPolicy = passesPolicy && lowestPc === expected.pcs[0];
  }

  if (passesPolicy) {
    confirmCounter += 1;
    if (confirmCounter >= framesConfirm) {
      postMessageSafe({ type: "CHORD_MATCH", t: timestamp / 1000 });
    }
  } else {
    confirmCounter = 0;
    postMessageSafe({
      type: "CHORD_MISS",
      t: timestamp / 1000,
      matched,
      missing,
    });
  }
}

function postMessageSafe(event: ResultEvent) {
  (self as DedicatedWorkerGlobalScope).postMessage(event);
}

function reportError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  postMessageSafe({ type: "ERROR", message });
}

export {};
