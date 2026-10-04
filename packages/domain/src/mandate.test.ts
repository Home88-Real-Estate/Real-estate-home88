import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canMoveMandate,
  formatMandateNumber,
  mandateDisplayStatus,
  mandateSettingsMissing,
  renderTemplate,
  sniffMatches,
  templateFields,
  validateTemplate,
} from "./mandate";

// Placeholder text only: real wording is the lawyer's, stored in Settings.
const BODY = "Εντολή {{ mandate.number }} — {{principal.fullName}} — {{property.reference}} — {{terms.commission}}";

test("template fields are listed once, in order", () => {
  assert.deepEqual(templateFields(BODY), ["mandate.number", "principal.fullName", "property.reference", "terms.commission"]);
});

test("unknown fields and broken placeholders are template errors", () => {
  assert.deepEqual(validateTemplate("{{owner.name}} {{principal.fullName}}").unknown, ["owner.name"]);
  assert.equal(validateTemplate("{{principal.fullName").unclosed, true);
  assert.equal(validateTemplate(BODY).unclosed, false);
});

test("rendering refuses blanks and shows them in the preview", () => {
  const r = renderTemplate(BODY, { "mandate.number": "ΕΝΤ-0001", "principal.fullName": "Μαρία Κ.", "property.reference": "  " });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.deepEqual(r.missing, ["Κωδικός ακινήτου", "Αμοιβή γραφείου"]);
    assert.match(r.preview, /«Κωδικός ακινήτου»/);
    assert.match(r.preview, /ΕΝΤ-0001/);
  }
  const ok = renderTemplate(BODY, { "mandate.number": "ΕΝΤ-0001", "principal.fullName": "Μαρία Κ.", "property.reference": "H88-000001", "terms.commission": "2%" });
  assert.ok(ok.ok);
  if (ok.ok) assert.equal(ok.text, "Εντολή ΕΝΤ-0001 — Μαρία Κ. — H88-000001 — 2%");
});

test("values are inserted literally, never re-expanded", () => {
  const r = renderTemplate("{{principal.fullName}}", { "principal.fullName": "{{agency.vatNumber}}" });
  assert.ok(r.ok && r.text === "{{agency.vatNumber}}");
});

test("lifecycle, display status, numbering, settings, file sniffing", () => {
  assert.ok(canMoveMandate("DRAFT", "ISSUED"));
  assert.ok(canMoveMandate("ISSUED", "SIGNED"), "signed on paper");
  assert.ok(canMoveMandate("VIEWED", "DECLINED"));
  assert.ok(!canMoveMandate("DRAFT", "SIGNED"), "must be issued first");
  assert.ok(!canMoveMandate("SIGNED", "CANCELLED"), "signed is final");
  assert.equal(mandateDisplayStatus("SIGNED", "2020-01-01"), "ENDED");
  assert.equal(mandateDisplayStatus("SIGNED", "2999-01-01"), "ACTIVE");
  assert.equal(mandateDisplayStatus("SENT", null), "SENT");
  assert.equal(formatMandateNumber("ΕΝΤ", 5, 42), "ΕΝΤ-00042");
  assert.deepEqual(mandateSettingsMissing({}, false), ["Πρόθεμα αρίθμησης", "Ψηφία αριθμού"]);
  assert.equal(mandateSettingsMissing({ numberingPrefix: "ΕΝΤ", numberingDigits: 5 }, true).length, 3);
  assert.ok(sniffMatches("application/pdf", new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])));
  assert.ok(!sniffMatches("application/pdf", new Uint8Array([0x89, 0x50, 0x4e, 0x47])), "a PNG named .pdf is refused");
  assert.ok(!sniffMatches("text/html", new Uint8Array([0x3c])));
});
