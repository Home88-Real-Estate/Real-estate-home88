/**
 * Audio conversions for the live conversation. Pure functions, no browser APIs, so they are unit tested.
 *
 * Gemini Live takes 16-bit little-endian mono PCM at 16 kHz and answers at 24 kHz. Microphones run at the
 * device's own rate (often 44.1 or 48 kHz), so the browser converts in small chunks as it records.
 */

export const INPUT_RATE = 16_000;
export const OUTPUT_RATE = 24_000;
/** 100 ms per chunk: short enough for low latency, long enough not to flood the socket. */
export const CHUNK_SAMPLES = 1_600;

/**
 * Streaming down-sampler to 16 kHz. Each output sample is the average of the input samples it covers (a simple
 * low-pass that keeps speech clear and avoids aliasing), and the position carries over between chunks, so
 * chunk boundaries add no clicks or drift.
 */
export class Resampler {
  private readonly ratio: number;
  private carry: number[] = [];

  constructor(readonly inputRate: number, readonly outputRate: number = INPUT_RATE) {
    if (!(inputRate > 0) || !(outputRate > 0)) throw new Error("Invalid sample rate");
    this.ratio = inputRate / outputRate;
  }

  push(input: Float32Array): Float32Array {
    const data = this.carry.length ? Float32Array.from([...this.carry, ...input]) : input;
    if (this.ratio === 1) {
      this.carry = [];
      return Float32Array.from(data);
    }
    const count = Math.floor(data.length / this.ratio);
    const out = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const start = Math.floor(i * this.ratio);
      const end = Math.max(start + 1, Math.floor((i + 1) * this.ratio));
      let sum = 0;
      for (let j = start; j < end; j++) sum += data[j]!;
      out[i] = sum / (end - start);
    }
    this.carry = Array.from(data.subarray(Math.floor(count * this.ratio)));
    return out;
  }
}

/** Float samples (-1..1) to 16-bit signed integers, clipped. */
export function floatToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]!));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

/** Root-mean-square level, 0..1: how loud a chunk is. */
export function rms(input: Float32Array): number {
  if (input.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < input.length; i++) sum += input[i]! * input[i]!;
  return Math.sqrt(sum / input.length);
}

/**
 * While the assistant's voice is playing, quiet microphone input is most likely its own voice coming back from
 * the speaker (what the browser's echo cancellation did not remove). It is replaced by silence so the assistant
 * does not interrupt itself; speech louder than that still gets through, so the agent can interrupt it.
 */
export const ECHO_GATE_LEVEL = 0.035;
export function gateEcho(input: Float32Array, assistantSpeaking: boolean, level: number = ECHO_GATE_LEVEL): Float32Array {
  return assistantSpeaking && rms(input) < level ? new Float32Array(input.length) : input;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** 16-bit samples as little-endian bytes, base64: the Live API's `audio/pcm;rate=16000` payload. */
export function int16ToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) view.setInt16(i * 2, samples[i]!, true);
  return bytesToBase64(bytes);
}

/** The Live API's 24 kHz little-endian 16-bit answer as float samples for the Web Audio API. */
export function base64PcmToFloat(b64: string): Float32Array<ArrayBuffer> {
  const binary = atob(b64);
  const n = Math.floor(binary.length / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8);
    if (v >= 0x8000) v -= 0x10000;
    out[i] = v / 0x8000;
  }
  return out;
}

/** Collects resampled audio into fixed-size chunks. */
export class Chunker {
  private buffer: number[] = [];
  constructor(private readonly size: number = CHUNK_SAMPLES) {}

  push(samples: Float32Array): Float32Array[] {
    for (let i = 0; i < samples.length; i++) this.buffer.push(samples[i]!);
    const out: Float32Array[] = [];
    while (this.buffer.length >= this.size) out.push(Float32Array.from(this.buffer.splice(0, this.size)));
    return out;
  }

  /** What is left (shorter than a chunk), e.g. when the microphone is muted or stopped. */
  drain(): Float32Array | null {
    if (!this.buffer.length) return null;
    const rest = Float32Array.from(this.buffer);
    this.buffer = [];
    return rest;
  }
}
