import { Note } from "tonal";
import type { PitchClass } from "../types/audio";

const PC_LABELS = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

export function hzToMidi(hz: number, a4 = 440): number {
  return 69 + 12 * Math.log2(hz / a4);
}

export function midiToPitchClass(midi: number, transpose = 0): PitchClass {
  return ((((Math.round(midi) + transpose) % 12) + 12) % 12) as PitchClass;
}

export function nameToPitchClass(name: string): PitchClass {
  const midi = Note.midi(name);
  if (midi == null) throw new Error(`Bad note name: ${name}`);
  return (midi % 12) as PitchClass;
}

export function pitchClassToName(pc: PitchClass): string {
  return PC_LABELS[pc];
}
