export function recorderWorkletSource(): string {
  return `
  class RecorderWorkletProcessor extends AudioWorkletProcessor {
    rb = null;
    tmp = new Float32Array(128);
    constructor() {
      super();
      this.port.onmessage = (event) => {
        if (event.data?.sab) {
          this.rb = new SharedRingBuffer(event.data.sab);
        }
      };
    }
    process(inputs) {
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
  registerProcessor("recorder-worklet", RecorderWorkletProcessor);
`;
}
