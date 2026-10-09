import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { encodeWav, SPEECH_SAMPLE_RATE, toBase64 } from "./wav";

describe("voice clip encoding", () => {
  it("writes a valid 16 kHz mono 16-bit WAV header", () => {
    const wav = encodeWav(new Float32Array(1600));
    const view = new DataView(wav.buffer);
    const tag = (o: number) => String.fromCharCode(...wav.subarray(o, o + 4));
    assert.equal(tag(0), "RIFF");
    assert.equal(tag(8), "WAVE");
    assert.equal(tag(12), "fmt ");
    assert.equal(view.getUint16(20, true), 1, "PCM");
    assert.equal(view.getUint16(22, true), 1, "mono");
    assert.equal(view.getUint32(24, true), SPEECH_SAMPLE_RATE);
    assert.equal(view.getUint16(34, true), 16);
    assert.equal(tag(36), "data");
    assert.equal(view.getUint32(40, true), 3200);
    assert.equal(wav.length, 44 + 3200);
  });

  it("clips out-of-range samples instead of wrapping them", () => {
    const wav = encodeWav(Float32Array.from([2, -2, 0.5, 0]));
    const view = new DataView(wav.buffer);
    assert.equal(view.getInt16(44, true), 32767);
    assert.equal(view.getInt16(46, true), -32768);
    assert.equal(view.getInt16(48, true), Math.trunc(0.5 * 0x7fff));
    assert.equal(view.getInt16(50, true), 0);
  });

  it("keeps a full-length recording under the server's 3 MB limit", () => {
    const sixtySeconds = 60 * SPEECH_SAMPLE_RATE * 2 + 44;
    assert.ok(sixtySeconds < 3 * 1024 * 1024);
  });

  it("encodes long clips to base64 without overflowing the stack", () => {
    const bytes = new Uint8Array(1_000_000).fill(7);
    assert.equal(Buffer.from(toBase64(bytes), "base64").length, 1_000_000);
  });
});
