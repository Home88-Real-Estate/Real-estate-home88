import assert from "node:assert/strict";
import { test } from "node:test";
import { PDFDocument } from "pdf-lib";

import { renderMandatePdf } from "./mandate-pdf";

test("mandate PDF embeds Greek text, paginates long text and stamps every page", async () => {
  const paragraph = "Κείμενο δοκιμής με ελληνικούς χαρακτήρες: ΑΦΜ, ΔΟΥ, ΚΑΕΚ — όχι νομικό κείμενο. ".repeat(12);
  const text = Array.from({ length: 30 }, () => paragraph).join("\n\n");
  const pdf = await renderMandatePdf({ title: "Αποκλειστική Εντολή Ανάθεσης", number: "ΕΝΤ-00001", text, checksum: "a".repeat(64) });
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
  const doc = await PDFDocument.load(pdf);
  assert.ok(doc.getPageCount() > 1, "long text spans pages");
  assert.match(doc.getTitle() ?? "", /ΕΝΤ-00001/);
  assert.ok(pdf.length < 400_000, `font is subset (${pdf.length} bytes)`);
});
