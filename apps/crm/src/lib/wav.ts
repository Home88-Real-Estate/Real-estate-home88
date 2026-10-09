/**
 * Voice clips are sent as 16 kHz mono WAV.
 *
 * Browsers record in different containers (Chrome and Android: WebM/Opus,
 * Safari and iOS: MP4/AAC), and the speech model documents WAV, not those. So
 * the clip is decoded in the browser and re-encoded here, which gives every
 * device the same input. 16 kHz mono 16-bit is about 32 KB per second, so the
 * 60-second limit stays under the 3 MB the server accepts.
 */

export const SPEECH_SAMPLE_RATE = 16_000;
export const MAX_RECORDING_SECONDS = 60;

/** 16-bit PCM WAV from mono float samples in [-1, 1]. Pure, so it is unit-tested. */
export function encodeWav(samples: Float32Array, sampleRate: number = SPEECH_SAMPLE_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

/** Base64 of bytes, in chunks so a long clip does not overflow the call stack. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Decodes whatever the browser recorded and returns it as a 16 kHz mono WAV. */
export async function recordingToWav(blob: Blob): Promise<Uint8Array> {
  const Ctx = (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
  const context = new Ctx();
  try {
    const data = await blob.arrayBuffer();
    // Older Safari only has the callback form of decodeAudioData.
    const decoded = await new Promise<AudioBuffer>((resolve, reject) => {
      const maybe = context.decodeAudioData(data, resolve, reject);
      if (maybe && typeof maybe.then === "function") maybe.then(resolve, reject);
    });
    const length = Math.max(1, Math.ceil(decoded.duration * SPEECH_SAMPLE_RATE));
    const offline = new OfflineAudioContext(1, length, SPEECH_SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return encodeWav(rendered.getChannelData(0));
  } finally {
    void context.close().catch(() => undefined);
  }
}
