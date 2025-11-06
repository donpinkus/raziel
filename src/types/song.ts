import type { PitchClass, ChordSpec } from "./audio";

export type Song = {
  title: string;
  tempo: number;
  timeSignature: {
    beats: number;
    beatType: number;
  };
  events: SongEvent[];
  totalBeats: number;
};

export type SongEvent = {
  id: string;
  measureNumber: number;
  startBeat: number;
  durationBeats: number;
  notes: TabNote[];
  chordSpec: ChordSpec;
  label: string;
};

export type TabNote = {
  midi: number;
  pitchClass: PitchClass;
  name: string;
  string?: number;
  fret?: number;
};

export type PracticeSongState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; song: Song };
