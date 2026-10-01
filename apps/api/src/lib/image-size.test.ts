import assert from "node:assert/strict";
import { test } from "node:test";
import { imageDimensions } from "./image-size";

test("reads PNG dimensions from the IHDR chunk", () => {
  const png = Buffer.alloc(24);
  png.writeUInt32BE(0x89504e47, 0);
  png.writeUInt32BE(0x0d0a1a0a, 4);
  png.writeUInt32BE(640, 16);
  png.writeUInt32BE(480, 20);
  assert.deepEqual(imageDimensions(png), { width: 640, height: 480 });
});

test("reads GIF dimensions from the logical screen descriptor", () => {
  const gif = Buffer.alloc(10);
  gif.write("GIF89a", 0, "ascii");
  gif.writeUInt16LE(320, 6);
  gif.writeUInt16LE(240, 8);
  assert.deepEqual(imageDimensions(gif), { width: 320, height: 240 });
});

test("reads JPEG dimensions from a start-of-frame marker", () => {
  const jpeg = Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x64, 0x00, 0xc8, 0x03,
    0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
  ]);
  assert.deepEqual(imageDimensions(jpeg), { width: 200, height: 100 });
});

test("reads WebP lossless dimensions", () => {
  const webp = Buffer.alloc(30);
  webp.write("RIFF", 0, "ascii");
  webp.write("WEBP", 8, "ascii");
  webp.write("VP8L", 12, "ascii");
  webp[20] = 0x2f;
  const bits = 299 | (199 << 14);
  webp.writeUInt32LE(bits >>> 0, 21);
  assert.deepEqual(imageDimensions(webp), { width: 300, height: 200 });
});

test("returns null for unknown, truncated or empty input", () => {
  assert.equal(imageDimensions(Buffer.alloc(0)), null);
  assert.equal(imageDimensions(Buffer.from("not an image at all")), null);
  assert.equal(imageDimensions(Buffer.from([0x89, 0x50, 0x4e])), null);
  assert.equal(imageDimensions(Buffer.alloc(24)), null);
});
