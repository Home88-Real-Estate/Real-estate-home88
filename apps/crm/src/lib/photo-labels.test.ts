import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { altTextFor, altUpdates, fitWithin, isLabelCode, PHOTO_LABELS, type PhotoLabel } from "./photo-labels";

describe("photo labels on the screen", () => {
  it("has a Greek and an English name for every label, and OTHER sets no alt text", () => {
    assert.ok(PHOTO_LABELS.every((l) => l.el && l.en));
    assert.deepEqual(altTextFor("KITCHEN"), { altEl: "Κουζίνα", altEn: "Kitchen" });
    assert.equal(altTextFor("OTHER"), null);
    assert.ok(isLabelCode("POOL"));
    assert.ok(!isLabelCode("pool") && !isLabelCode(""));
  });

  it("scales a photo down to fit and never up", () => {
    assert.deepEqual(fitWithin(4000, 3000, 640), { width: 640, height: 480 });
    assert.deepEqual(fitWithin(3000, 4000, 640), { width: 480, height: 640 });
    assert.deepEqual(fitWithin(300, 200, 640), { width: 300, height: 200 });
    assert.deepEqual(fitWithin(1, 5000, 640), { width: 1, height: 640 });
  });

  it("turns only the labels the agent accepted into alt text, for photos that were uploaded", () => {
    const labels: Record<string, PhotoLabel> = {
      a: { code: "KITCHEN", confidence: "high", accepted: true },
      b: { code: "BEDROOM", confidence: "low", accepted: false }, // only a suggestion
      c: { code: "OTHER", confidence: "agent", accepted: true }, // says nothing
      d: { code: "VIEW", confidence: "agent", accepted: true }, // upload failed: no media id
    };
    const media = { a: "m1", b: "m2", c: "m3" } as Record<string, string>;
    const out = altUpdates([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }], labels, (id) => media[id]);
    assert.deepEqual(out, [{ mediaId: "m1", altEl: "Κουζίνα", altEn: "Kitchen" }]);
  });
});
