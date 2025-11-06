/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/// <reference lib="webworker" />

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  abstract process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: { new (): AudioWorkletProcessor }
): void;

class SharedRingBuffer {
  private readonly i32: Int32Array;
  private readonly f32: Float32Array;

  constructor(sab: SharedArrayBuffer) {
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

class RecorderWorkletProcessor extends AudioWorkletProcessor {
  private rb: SharedRingBuffer | null;
  private tmp: Float32Array;

  constructor() {
    super();
    this.rb = null;
    this.tmp = new Float32Array(128);
    this.port.onmessage = (event: MessageEvent<{ sab?: SharedArrayBuffer }>) => {
      if (event.data?.sab) {
        this.rb = new SharedRingBuffer(event.data.sab);
      }
    };
  }

  process(inputs: Float32Array[][]) {
    if (!this.rb) return true;
    const ch0 = inputs[0]?.[0];
    const ch1 = inputs[0]?.[1];
    const N = ch0?.length ?? 0;
    if (!N) return true;
    if (this.tmp.length < N) this.tmp = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const l = ch0[i] || 0;
      const r = ch1 ? ch1[i] || 0 : l;
      this.tmp[i] = 0.5 * (l + r);
    }
    this.rb.write(this.tmp.subarray(0, N));
    return true;
  }
}

registerProcessor("recorder-worklet", RecorderWorkletProcessor);

export {};
