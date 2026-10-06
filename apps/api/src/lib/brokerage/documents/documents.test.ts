/** Unit tests (no database): audit masking and the PDF engine. */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { buildDocumentBlocks, type DocumentKind, type DocumentSnapshot } from "@home88/domain";

import { DOCUMENT_AUDIT_EVENTS, maskAuditPayload } from "./audit";
import { PdfRenderError, renderDocumentPdf } from "./pdf";

const company = { legalName: "HOME88 Μεσιτική", vatNumber: "123456783", taxOffice: "ΔΟΥ Α΄", gemiNumber: "123", address: "Οδός 1, Αθήνα", phone: "2100000000", email: "info@home88.test", place: "Αθήνα" };
const party = { role: "OWNER", fullName: "Ελένη Παπαδοπούλου", taxId: "123456783", idNumber: "ΑΒ123456", address: "Οδός 7", isSignatory: true, capacity: "OWNER", sharePercent: 100 };
const fee = { payer: "OWNER", method: "PERCENTAGE", basis: "ASKING_PRICE", percentage: 2, currency: "EUR", vatTreatment: "PLUS_VAT", vatRate: 24, amounts: { net: 5000, vat: 1200, gross: 6200 }, milestones: [] };

function snapshot(kind: DocumentKind, properties = 1, language: "el" | "en" = "el"): DocumentSnapshot {
  return {
    kind, language, number: "T-00001", issuedOn: "2026-10-06", verificationCode: "ABCDEFGHJKMN", company, representativeName: "Μάνος Μάνος",
    parties: [party],
    properties: Array.from({ length: properties }, (_, i) => ({ code: `H88-${i + 1}`, address: `Οδός ${i + 1}, Αθήνα`, description: "Διαμέρισμα με θέα", transactionType: "SALE", currency: "EUR", price: 250000 })),
    fee,
    ...(kind === "EXCLUSIVE_ASSIGNMENT" ? { term: { startDate: "2026-11-01", endDate: "2027-04-30", durationType: "FIXED_TERM" as const, duration: { months: 6, days: 0, totalDays: 180 }, exceptions: [] } } : {}),
    template: { version: 3, checksum: "b".repeat(64) },
  };
}

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const issuedAt = new Date("2026-10-06T09:00:00Z");

test("audit payloads never carry identity data, addresses or document text", () => {
  const masked = JSON.stringify(
    maskAuditPayload({
      taxId: "123456789", idNumber: "ΑΒ123456", address: "Οδός 7", email: "a@b.gr", phone: "6900000000", renderedText: "κείμενο", body: "κείμενο",
      note: "Καλέστε 123456789 ή a@b.gr", pdfChecksum: "f".repeat(64), storageKey: "private/documents/x.pdf", status: "ISSUED", count: 3,
    }),
  );
  for (const secret of ["123456789", "ΑΒ123456", "Οδός 7", "a@b.gr", "6900000000", "κείμενο"]) assert.ok(!masked.includes(secret), `${secret} leaked: ${masked}`);
  assert.ok(masked.includes("f".repeat(64)), "digests stay");
  assert.ok(masked.includes("private/documents/x.pdf"), "storage keys stay");
  assert.ok(masked.includes('"status":"ISSUED"'));
});

test("audit masking reaches nested and array values and survives odd input", () => {
  const out = JSON.stringify(maskAuditPayload({ parties: [{ fullName: "Α", taxId: "123456789" }], deep: { a: { b: { address: "Οδός" } } }, when: new Date("2026-01-01T00:00:00Z"), n: null }));
  assert.ok(!out.includes("123456789") && !out.includes("Οδός"));
  assert.ok(out.includes("2026-01-01"));
});

test("the audit event vocabulary covers every event the specification names", () => {
  const required = [
    "SHOWING_CREATED", "SHOWING_UPDATED", "SHOWING_VALIDATED", "SHOWING_ISSUED", "SHOWING_PDF_GENERATED", "SHOWING_SENT", "SHOWING_VIEWED", "SHOWING_SIGNED", "SHOWING_DECLINED", "SHOWING_CANCELLED", "SHOWING_REPLACED", "SHOWING_PDF_DOWNLOADED",
    "MANDATE_VALIDATED", "MANDATE_ISSUED", "MANDATE_PDF_GENERATED", "MANDATE_SENT", "MANDATE_VIEWED", "MANDATE_SIGNED", "MANDATE_DECLINED", "MANDATE_CANCELLED", "MANDATE_REPLACED", "MANDATE_EXTENDED", "MANDATE_PDF_DOWNLOADED",
    "TEMPLATE_RESOLVED", "TEMPLATE_CHECKSUM_VERIFIED", "DOCUMENT_VALIDATION_BLOCKED", "COMMISSION_ANOMALY_ACKNOWLEDGED", "EXCLUSIVE_CONFLICT_DETECTED", "EXCLUSIVE_CONFLICT_OVERRIDE_APPROVED",
  ];
  for (const e of required) assert.ok((DOCUMENT_AUDIT_EVENTS as readonly string[]).includes(e), e);
});

test("PDFs are deterministic: the same snapshot gives the same bytes, so an issued PDF can be re-verified", async () => {
  const s = snapshot("SIMPLE_ASSIGNMENT");
  const blocks = buildDocumentBlocks(s, "Ρήτρες της εντολής.");
  const a = await renderDocumentPdf({ blocks, snapshot: s, title: "Εντολή T-00001", issuedAt });
  const b = await renderDocumentPdf({ blocks, snapshot: s, title: "Εντολή T-00001", issuedAt });
  assert.equal(sha(a.pdf), sha(b.pdf));
  assert.equal(a.pdf.subarray(0, 4).toString(), "%PDF");
  const changed = await renderDocumentPdf({ blocks: buildDocumentBlocks({ ...s, number: "T-00002" }, "Ρήτρες της εντολής."), snapshot: { ...s, number: "T-00002" }, title: "x", issuedAt });
  assert.notEqual(sha(changed.pdf), sha(a.pdf));
});

test("Greek and English text is extractable from the PDF, with page numbers and the company identity", async () => {
  for (const language of ["el", "en"] as const) {
    const s = snapshot("EXCLUSIVE_ASSIGNMENT", 1, language);
    const { pdf } = await renderDocumentPdf({ blocks: buildDocumentBlocks(s, "Ρήτρες."), snapshot: s, title: "T", issuedAt });
    const dir = mkdtempSync(join(tmpdir(), "pdf-"));
    const file = join(dir, "d.pdf");
    writeFileSync(file, pdf);
    const out = execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
    assert.ok(out.includes("T-00001") && out.includes("H88-1") && out.includes("123456783") && out.includes("HOME88"), out.slice(0, 400));
    assert.ok(out.includes("ABCDEFGHJKMN"), "verification code in the footer");
    assert.match(out, language === "el" ? /Σελίδα 1 από \d/ : /Page 1 of \d/);
    assert.match(out, language === "el" ? /Ελένη Παπαδοπούλου/ : /Ελένη Παπαδοπούλου/);
  }
});

test("a long property table breaks across pages without splitting rows, and headers repeat", async () => {
  const s = snapshot("SHOWING", 40);
  const { layout } = await renderDocumentPdf({ blocks: buildDocumentBlocks(s, "Ρήτρες."), snapshot: s, title: "T", issuedAt });
  assert.ok(layout.pageCount > 1);
  const codes = layout.items.filter((i) => i.kind === "table-cell" && /^H88-\d+$/.test(i.text));
  assert.equal(codes.length, 40, "every property is printed exactly once");
  for (const c of codes) assert.ok(c.y >= 62 - 1, `row ${c.text} is above the bottom margin`);
  const headers = layout.items.filter((i) => i.kind === "table-head" && i.text === "Κωδικός");
  assert.ok(new Set(headers.map((h) => h.page)).size >= 2, "the header is repeated on each page the table spans");
  assert.ok(layout.items.some((i) => i.kind === "signature-name"), "signature boxes are present");
});

test("amounts and header words never break mid-token in the property table", async () => {
  const s = snapshot("SHOWING", 3, "en");
  const { layout } = await renderDocumentPdf({ blocks: buildDocumentBlocks(s, "Clauses."), snapshot: s, title: "T", issuedAt });
  const cells = layout.items.filter((i) => i.kind === "table-cell" || i.kind === "table-head").map((i) => i.text);
  assert.ok(cells.includes("€250,000.00"), `price printed on one line: ${cells.join("|")}`);
  assert.ok(cells.includes("Transaction"), "header word is whole");
  assert.ok(!cells.includes("Fee"), "the per-property fee column is omitted when no property has its own fee");
});

test("a signature section that fits on one page is never split across pages", async () => {
  const s = snapshot("EXCLUSIVE_ASSIGNMENT");
  s.parties = [1, 2, 3, 4].map((n) => ({ ...party, fullName: `Συνιδιοκτήτης ${n}`, sharePercent: 25 }));
  // Vary the body length so the signatures land at many positions, including right at a page end.
  for (let paragraphs = 1; paragraphs <= 40; paragraphs++) {
    const body = Array.from({ length: paragraphs }, (_, i) => `${i + 1}. ${"Κείμενο ρήτρας. ".repeat(18)}`).join("\n");
    const { layout } = await renderDocumentPdf({ blocks: buildDocumentBlocks(s, body), snapshot: s, title: "T", issuedAt });
    const pages = new Set(layout.items.filter((i) => i.kind.startsWith("signature")).map((i) => i.page));
    assert.equal(pages.size, 1, `signatures split across pages ${[...pages]} with ${paragraphs} paragraphs`);
  }
});

test("a character the font cannot print fails the render instead of printing a gap", async () => {
  const s = snapshot("SHOWING");
  s.parties = [{ ...party, fullName: "Test \u4e2d\u6587" }];
  await assert.rejects(renderDocumentPdf({ blocks: buildDocumentBlocks(s, "Ρήτρες."), snapshot: s, title: "T", issuedAt }), (e: unknown) => e instanceof PdfRenderError);
});
