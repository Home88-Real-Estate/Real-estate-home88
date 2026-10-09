/** Checks that uploaded bytes really are audio of a type the provider accepts. */

export function sniffAudio(b: Uint8Array): string | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "audio/wav";
  if (b.length >= 4 && ascii(0, 4) === "OggS") return "audio/ogg";
  if (b.length >= 4 && ascii(0, 4) === "fLaC") return "audio/flac";
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "audio/webm";
  if (b.length >= 12 && ascii(4, 8) === "ftyp") return "audio/mp4";
  if (b.length >= 3 && ascii(0, 3) === "ID3") return "audio/mpeg";
  if (b.length >= 2 && b[0] === 0xff && (b[1]! & 0xe0) === 0xe0) return (b[1]! & 0x06) === 0 ? "audio/aac" : "audio/mpeg";
  return null;
}
