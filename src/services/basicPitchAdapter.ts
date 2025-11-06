import { outputToNotesPoly, noteFramesToTime } from "@spotify/basic-pitch";
import { InferenceSession, Tensor, env } from "onnxruntime-web";
import type { NoteEvent as WorkerNoteEvent } from "../types/audio";

const MODEL_WINDOW_SAMPLES = 43844; // matches Basic Pitch window
const INPUT_NAME = "serving_default_input_2:0";
const OUTPUT_FRAMES = "StatefulPartitionedCall:2";
const OUTPUT_ONSETS = "StatefulPartitionedCall:1";

export interface BasicPitchLike {
  init(): Promise<void>;
  evaluateMono22k(audio: Float32Array): Promise<WorkerNoteEvent[]>;
}

env.wasm.wasmPaths = `${import.meta.env.BASE_URL}onnxruntime-web/`;
env.wasm.proxy = true;

export class BasicPitchAdapter implements BasicPitchLike {
  private sessionPromise: Promise<InferenceSession> | null = null;
  private readonly modelUrl: string;

  constructor(modelUrl: string) {
    this.modelUrl = modelUrl;
  }

  async init(): Promise<void> {
    if (!this.sessionPromise) {
      this.sessionPromise = InferenceSession.create(this.modelUrl, {
        executionProviders: ["wasm"],
      });
    }
    await this.sessionPromise;
  }

  private async getSession(): Promise<InferenceSession> {
    if (!this.sessionPromise) {
      await this.init();
    }
    return this.sessionPromise!;
  }

  async evaluateMono22k(audio: Float32Array): Promise<WorkerNoteEvent[]> {
    const session = await this.getSession();
    const window = this.prepareWindow(audio);
    const tensor = new Tensor("float32", window, [1, window.length, 1]);
    const outputs = await session.run({ [INPUT_NAME]: tensor });
    const framesTensor = outputs[OUTPUT_FRAMES];
    const onsetsTensor = outputs[OUTPUT_ONSETS];

    if (!framesTensor || !onsetsTensor) {
      throw new Error("Basic Pitch outputs missing from ONNX session");
    }

    const frames = this.tensorTo2D(framesTensor);
    const onsets = this.tensorTo2D(onsetsTensor);

    const noteFrames = outputToNotesPoly(frames, onsets);
    const noteTimes = noteFramesToTime(noteFrames);

    return noteTimes.map((note) => ({
      midi: Math.round(note.pitchMidi),
      startTime: note.startTimeSeconds,
      endTime: note.startTimeSeconds + note.durationSeconds,
      salience: note.amplitude,
    }));
  }

  private prepareWindow(audio: Float32Array): Float32Array {
    if (audio.length === MODEL_WINDOW_SAMPLES) return audio;
    if (audio.length > MODEL_WINDOW_SAMPLES) {
      return audio.subarray(audio.length - MODEL_WINDOW_SAMPLES);
    }
    const window = new Float32Array(MODEL_WINDOW_SAMPLES);
    window.set(audio, MODEL_WINDOW_SAMPLES - audio.length);
    return window;
  }

  private tensorTo2D(tensor: Tensor): number[][] {
    const [, rows, cols] = tensor.dims;
    const data = tensor.data as Float32Array;
    const result: number[][] = new Array(rows);
    for (let r = 0; r < rows; r++) {
      const row: number[] = new Array(cols);
      for (let c = 0; c < cols; c++) {
        row[c] = data[r * cols + c];
      }
      result[r] = row;
    }
    return result;
  }
}

export const basicPitchAdapter = new BasicPitchAdapter(
  `${import.meta.env.BASE_URL}models/basic-pitch-nmp.onnx`
);
