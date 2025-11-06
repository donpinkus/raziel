const HEADER_LENGTH = 2; // writeIdx + capacity stored as int32
const HEADER_BYTES = Int32Array.BYTES_PER_ELEMENT * HEADER_LENGTH;

export type SharedRingBufferHandle = {
  sab: SharedArrayBuffer;
  capacity: number;
};

export const SharedRingBuffer = {
  create(capacity: number): SharedRingBufferHandle {
    if (!Number.isFinite(capacity) || capacity <= 0) {
      throw new Error("Ring buffer capacity must be > 0");
    }
    const sab = new SharedArrayBuffer(
      HEADER_BYTES + Float32Array.BYTES_PER_ELEMENT * capacity
    );
    const meta = new Int32Array(sab, 0, HEADER_LENGTH);
    meta[0] = 0; // write index
    meta[1] = capacity;
    return { sab, capacity };
  },
};

export class SharedRingBufferReader {
  private readonly i32: Int32Array;
  private readonly data: Float32Array;

  constructor(sab: SharedArrayBuffer) {
    this.i32 = new Int32Array(sab, 0, HEADER_LENGTH);
    this.data = new Float32Array(sab, HEADER_BYTES);
  }

  readLatest(samples: number, target: Float32Array) {
    const capacity = this.i32[1];
    const available = Math.min(samples, capacity);
    const writeIdx = Atomics.load(this.i32, 0);
    const start = writeIdx - available;
    for (let i = 0; i < available; i++) {
      const idx = (start + i + capacity) % capacity;
      target[target.length - available + i] = this.data[idx];
    }
    if (available < target.length) {
      target.fill(0, 0, target.length - available);
    }
  }
}
