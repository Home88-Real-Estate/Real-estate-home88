import assert from "node:assert/strict";
import { test } from "node:test";

import {
  blocksToText,
  buildDocumentBlocks,
  checkTemplateContent,
  DOCUMENT_VARIANTS,
  mentionsExclusive,
  mentionsSimpleOrIndefinite,
  mergeValues,
  renderClauses,
  resolveVariant,
  scanFinalText,
  type DocumentKind,
  type DocumentLanguage,
  type DocumentSnapshot,
} from "./index";

const company = { legalName: "HOME88 Μεσιτική", vatNumber: "123456783", taxOffice: "ΔΟΥ Α΄", gemiNumber: "123", address: "Οδός 1, Αθήνα", phone: "2100000000", email: "info@home88.test", place: "Αθήνα" };
const owner = { role: "OWNER", fullName: "Ελένη Παπαδοπούλου", taxId: "123456783", idNumber: "ΑΒ123456", address: "Οδός 7", isSignatory: true, capacity: "OWNER", sharePercent: 100 };
const prop = (code: string, price: number) => ({ code, address: "Αλαμάνας 1, Μαρούσι", description: "Διαμέρισμα", transactionType: "RENT", currency: "EUR", price });
const fee = { payer: "OWNER", method: "PERCENTAGE", basis: "MONTHLY_RENT", percentage: 100, currency: "EUR", vatTreatment: "PLUS_VAT", vatRate: 24, amounts: { net: 14600, vat: 3504, gross: 18104 }, milestones: [] };

function snap(kind: DocumentKind, language: DocumentLanguage, over: Partial<DocumentSnapshot> = {}): DocumentSnapshot {
  const assignment = kind === "SIMPLE_ASSIGNMENT" || kind === "EXCLUSIVE_ASSIGNMENT";
  return {
    kind, language, number: "T-00001", issuedOn: "2026-10-06", verificationCode: "ABCDEFGHJKMN", company, representativeName: "Μάνος Μάνος",
    parties: [kind === "SHOWING" ? { ...owner, role: "BUYER", capacity: null, sharePercent: null } : owner],
    properties: [prop("H88-1", 14600)],
    fee,
    ...(assignment
      ? {
          term: kind === "EXCLUSIVE_ASSIGNMENT"
            ? { startDate: "2026-11-01", endDate: "2027-04-30", durationType: "FIXED_TERM" as const, duration: { months: 6, days: 0, totalDays: 180 }, exceptions: [] }
            : { startDate: "2026-11-01", endDate: null, durationType: "INDEFINITE" as const, duration: null, exceptions: [] },
          permissions: { photoPermission: true },
          defects: { known: false, description: null, confirmed: true },
          cooperation: { brokerCooperationAllowed: false },
        }
      : {}),
    template: { version: 1, checksum: "a".repeat(64) },
    ...over,
  };
}

const text = (s: DocumentSnapshot) => blocksToText(buildDocumentBlocks(s, "Ρήτρες."));

test("template selection is deterministic over document type, mandate type and language", () => {
  assert.equal(resolveVariant({ documentType: "SHOWING", language: "el" }), "SHOWING_EL");
  assert.equal(resolveVariant({ documentType: "SHOWING", language: "en" }), "SHOWING_EN");
  assert.equal(resolveVariant({ documentType: "MANDATE", mandateType: "SIMPLE_ASSIGNMENT", language: "en" }), "SIMPLE_ASSIGNMENT_EN");
  assert.equal(resolveVariant({ documentType: "MANDATE", mandateType: "EXCLUSIVE_ASSIGNMENT", language: "el" }), "EXCLUSIVE_ASSIGNMENT_EL");
  assert.equal(DOCUMENT_VARIANTS.length, 6);
  assert.throws(() => resolveVariant({ documentType: "MANDATE", mandateType: "VIEWING", language: "el" }), RangeError);
  assert.throws(() => resolveVariant({ documentType: "MANDATE", language: "el" }), RangeError);
  assert.throws(() => resolveVariant({ documentType: "SHOWING", language: "fr" }), RangeError);
});

test("all six variants render, in their language, without crossing kinds", () => {
  for (const language of ["el", "en"] as const) {
    for (const kind of ["SHOWING", "SIMPLE_ASSIGNMENT", "EXCLUSIVE_ASSIGNMENT"] as const) {
      const out = text(snap(kind, language));
      assert.ok(out.includes("T-00001") && out.includes("H88-1"), `${kind}/${language}`);
      assert.deepEqual(scanFinalText(kind, out), [], `${kind}/${language}: ${scanFinalText(kind, out).map((p) => p.code)}`);
      if (language === "el") assert.match(out, /ΕΝΤΟΛΗ/); else assert.match(out, /MANDATE|ASSIGNMENT|SHOWING/i);
    }
  }
});

test("a simple assignment says 'Απλή ανάθεση' and 'Αορίστου χρόνου', with no exclusive obligations", () => {
  const out = text(snap("SIMPLE_ASSIGNMENT", "el"));
  assert.match(out, /Απλή ανάθεση/);
  assert.match(out, /Αορίστου χρόνου/);
  assert.equal(mentionsExclusive(out), false);
  assert.doesNotMatch(out, /Ορισμένου χρόνου|απλή\s*\/\s*αποκλειστική|αορίστου\s*\/\s*ορισμένου/i);
});

test("an exclusive assignment shows start, end and the calculated duration, with no simple or open-ended alternative", () => {
  const out = text(snap("EXCLUSIVE_ASSIGNMENT", "el"));
  assert.match(out, /Αποκλειστική ανάθεση/);
  assert.match(out, /01\/11\/2026/);
  assert.match(out, /30\/04\/2027/);
  assert.match(out, /6 μήν/);
  assert.equal(mentionsSimpleOrIndefinite(out), false);
});

test("English documents use English labels and the same facts", () => {
  const out = text(snap("EXCLUSIVE_ASSIGNMENT", "en"));
  assert.match(out, /Exclusive assignment/);
  assert.match(out, /01\/11\/2026|1 Nov|2026-11-01/);
  assert.doesNotMatch(out, /Αποκλειστική/);
});

test("the rent example never prints the price as the fee", () => {
  const out = text(snap("SIMPLE_ASSIGNMENT", "el"));
  // 14.600 € is the monthly rent (the price); the fee is 100% of it only because the terms say so and the amounts are printed as net/VAT/gross.
  assert.match(out, /14\.600/);
  const withoutAmounts = text(snap("SIMPLE_ASSIGNMENT", "el", { fee: { ...fee, method: "PERCENTAGE", percentage: 2, basis: "FINAL_SALE_PRICE", amounts: null } }));
  assert.doesNotMatch(withoutAmounts, /Αμοιβή[^\n]*14\.600/, "no amount is invented when the base is unknown");
});

test("several properties and several signatories each get their own row and signature block", () => {
  const s = snap("EXCLUSIVE_ASSIGNMENT", "el", {
    properties: [prop("H88-1", 100000), prop("H88-2", 200000)],
    parties: [owner, { ...owner, fullName: "Νίκος Παπαδόπουλος", taxId: "987654321", sharePercent: 50 }, { ...owner, fullName: "Μη υπογράφων", isSignatory: false }],
  });
  const blocks = buildDocumentBlocks(s, "Ρήτρες.");
  const out = blocksToText(blocks);
  assert.match(out, /H88-1/); assert.match(out, /H88-2/);
  const signatures = blocks.filter((b) => b.t === "signatures");
  assert.equal(signatures.length, 1);
  const boxes = signatures[0]!.t === "signatures" ? signatures[0]!.boxes : [];
  assert.equal(boxes.length, 3, "two signing owners and the broker; the non-signatory has no box");
  assert.ok(!boxes.some((b) => b.name === "Μη υπογράφων"));
  assert.match(out, /Νίκος Παπαδόπουλος/);
});

test("clause rendering is strict: unknown, missing and unclosed fields fail instead of printing blanks", () => {
  const values = mergeValues(snap("SHOWING", "el"));
  const ok = renderClauses("Αρ. {{document.number}} {{client.fullName}}", values);
  assert.ok(ok.ok && ok.text.includes("T-00001"));
  const unknown = renderClauses("{{owner.name}}", values);
  assert.ok(!unknown.ok && unknown.unknown.includes("owner.name"));
  const missing = renderClauses("{{term.endDate}}", { ...values, "term.endDate": "" });
  assert.ok(!missing.ok && missing.missing.length === 1);
  const unclosed = renderClauses("{{document.number", values);
  assert.ok(!unclosed.ok && unclosed.unclosed);
});

test("template content is checked against the kind it is for", () => {
  const codes = (k: DocumentKind, b: string) => checkTemplateContent(k, b).map((p) => p.code);
  assert.deepEqual(codes("SIMPLE_ASSIGNMENT", "Απλή ανάθεση. {{document.number}}"), []);
  assert.ok(codes("SIMPLE_ASSIGNMENT", "Αποκλειστική ανάθεση").includes("EXCLUSIVE_WORDING_IN_SIMPLE"));
  assert.deepEqual(codes("SIMPLE_ASSIGNMENT", "Η ανάθεση είναι μη αποκλειστική."), [], "negated wording is allowed");
  assert.ok(codes("EXCLUSIVE_ASSIGNMENT", "Αορίστου χρόνου").includes("SIMPLE_WORDING_IN_EXCLUSIVE"));
  assert.ok(codes("SHOWING", "Η ανάθεση του ιδιοκτήτη").includes("ASSIGNMENT_WORDING_IN_SHOWING"));
  assert.ok(codes("EXCLUSIVE_ASSIGNMENT", "Διάρκεια αορίστου/ορισμένου χρόνου").length > 0);
  assert.ok(codes("SIMPLE_ASSIGNMENT", "Όνομα: ……………").includes("UNFILLED_PLACEHOLDERS"));
});

test("the final text is scanned for leftovers whatever the template said", () => {
  const codes = (k: DocumentKind, t: string) => scanFinalText(k, t).map((p) => p.code);
  assert.ok(codes("EXCLUSIVE_ASSIGNMENT", "Διάρκεια: αορίστου/ορισμένου χρόνου").includes("DURATION_ALTERNATIVE"));
  assert.ok(codes("SIMPLE_ASSIGNMENT", "Είδος: Απλή/Αποκλειστική").includes("TYPE_ALTERNATIVE"));
  assert.ok(codes("SIMPLE_ASSIGNMENT", "{{x}}").includes("UNRESOLVED_FIELD"));
  assert.ok(codes("SIMPLE_ASSIGNMENT", "τιμή undefined").includes("BROKEN_VALUE"));
  assert.ok(codes("SIMPLE_ASSIGNMENT", "Αποκλειστική εντολή").includes("EXCLUSIVE_IN_SIMPLE"));
  assert.ok(codes("EXCLUSIVE_ASSIGNMENT", "Απλή ανάθεση").includes("SIMPLE_IN_EXCLUSIVE"));
  assert.deepEqual(codes("SIMPLE_ASSIGNMENT", "Απλή ανάθεση, μη αποκλειστική"), []);
});
