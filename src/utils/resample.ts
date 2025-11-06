export function resampleMonoBuffer(
  input: Float32Array,
  inSampleRate: number,
  outSampleRate: number
): Float32Array {
  if (inSampleRate === outSampleRate) return input.slice();
  const ratio = outSampleRate / inSampleRate;
  const outputLength = Math.floor(input.length * ratio);
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const pos = i / ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const sample0 = input[idx] ?? 0;
    const sample1 = input[idx + 1] ?? sample0;
    output[i] = sample0 + (sample1 - sample0) * frac;
  }
  return output;
}
