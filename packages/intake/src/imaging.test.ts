import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";

import { DEFAULT_UPLOAD_LIMITS, processPhoto, variantStorageKey } from "./index";

const L = { ...DEFAULT_UPLOAD_LIMITS, minDimension: 100 };

async function jpegWithGps(width = 800, height = 600, orientation = 1): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    .jpeg()
    .withMetadata({
      orientation,
      exif: {
        IFD0: { Make: "TestCam" },
        IFD3: {
          GPSLatitudeRef: "N",
          GPSLatitude: "37/1 58/1 30/1",
          GPSLongitudeRef: "E",
          GPSLongitude: "23/1 43/1 15/1",
        },
      },
    })
    .toBuffer();
}

test("GPS and camera metadata never survive processing", async () => {
  const input = await jpegWithGps();
  const fixture = await sharp(input).metadata();
  assert.ok(fixture.exif, "fixture really carries EXIF");
  // 0x8825 is the EXIF "GPS IFD pointer" tag: proof the fixture really holds location data.
  const exif = fixture.exif!;
  assert.ok(exif.includes(Buffer.from([0x88, 0x25])) || exif.includes(Buffer.from([0x25, 0x88])), "fixture has a GPS IFD");
  assert.ok(input.includes(Buffer.from("TestCam")), "fixture carries the camera make");

  const out = await processPhoto(input, L);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.hadMetadata, true);

  const masterMeta = await sharp(out.master.body).metadata();
  assert.equal(masterMeta.exif, undefined);
  const masterExif = (await sharp(out.master.body).metadata()).exif;
  assert.ok(!masterExif || (!masterExif.includes(Buffer.from([0x88, 0x25])) && !masterExif.includes(Buffer.from([0x25, 0x88]))), "no GPS IFD in master");
  assert.equal(out.master.body.includes(Buffer.from("TestCam")), false);
  assert.equal(out.master.body.includes(Buffer.from("GPSLatitude")), false);
  for (const variant of Object.values(out.variants)) {
    assert.equal((await sharp(variant).metadata()).exif, undefined);
  }
});

test("orientation is applied to the pixels so nothing depends on metadata", async () => {
  const out = await processPhoto(await jpegWithGps(800, 400, 6), L);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.width, 400);
  assert.equal(out.height, 800);
  const master = await sharp(out.master.body).metadata();
  assert.deepEqual([master.width, master.height], [400, 800]);
  assert.ok((master.orientation ?? 1) === 1);
});

test("four WebP variants are produced, never enlarged", async () => {
  const out = await processPhoto(await jpegWithGps(1600, 1000), L);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  const widths = Object.fromEntries(await Promise.all(Object.entries(out.variants).map(async ([k, v]) => [k, (await sharp(v).metadata()).width])));
  assert.deepEqual(widths, { thumbnail: 320, card: 640, medium: 1280, large: 1600 });
  assert.equal((await sharp(out.variants.card).metadata()).format, "webp");
  assert.equal(variantStorageKey("submissions/p/uploads/u.jpg", "card"), "submissions/p/uploads/u.card.webp");
});

test("the checksum is of the upload and identical for identical bytes", async () => {
  const input = await jpegWithGps();
  const a = await processPhoto(input, L);
  const b = await processPhoto(Buffer.from(input), L);
  assert.equal(a.ok && b.ok && a.checksum === b.checksum, true);
  const other = await processPhoto(await jpegWithGps(801, 600), L);
  assert.notEqual(other.checksum, a.checksum);
});

test("non-images and corrupt files are rejected with a reason, not thrown", async () => {
  const notImage = await processPhoto(Buffer.from("<?php echo 1; ?>"), L);
  assert.equal(notImage.ok, false);
  const truncated = (await jpegWithGps()).subarray(0, 300);
  const broken = await processPhoto(truncated, L);
  assert.equal(broken.ok, false);
  if (!notImage.ok) assert.ok(!notImage.reason.includes("php"), "reason never echoes file content");
});

test("dimension limits and the pixel budget are enforced", async () => {
  const small = await processPhoto(await jpegWithGps(120, 90), { ...L, minDimension: 300 });
  assert.equal(small.ok, false);
  const tooBig = await processPhoto(await jpegWithGps(800, 600), { ...L, maxDimension: 500 });
  assert.equal(tooBig.ok, false);
  const bomb = await processPhoto(await jpegWithGps(800, 600), { ...L, maxPixels: 1000 });
  assert.equal(bomb.ok, false);
  if (!bomb.ok) assert.match(bomb.reason, /pixels/);
});
