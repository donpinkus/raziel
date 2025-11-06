export type PitchClass =
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11;

export type Policy = "K_OF_N" | "INCLUDES_TARGET" | "BASS_PRIORITY";

export type ChordSpec = {
  name?: string;
  pcs: PitchClass[];
  K?: number;
};

export type NoteEvent = {
  midi: number;
  cents?: number;
  startTime: number;
  endTime?: number;
  salience?: number;
};

export type WorkerInit = {
  sab: SharedArrayBuffer;
  sampleRate: number;
  windowSec: number;
  tailMs: number;
  tickMs: number;
  a4Hz: number;
  minF0Hz: number;
  maxF0Hz: number;
};

export type WorkerSetExpected = {
  expected: ChordSpec;
  policy: Policy;
  centsTol: number;
  framesConfirm: number;
  transposeSemitones: number;
  acceptInversions: boolean;
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
