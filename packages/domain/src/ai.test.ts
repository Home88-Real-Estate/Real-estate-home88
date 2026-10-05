import { test } from "node:test";
import assert from "node:assert/strict";

import { buildDescriptionPrompt, buildReportSummaryPrompt, cleanAiText, findPersonalData, pickPropertyFacts } from "./ai";

test("personal data in free text is found; prices and areas are not", () => {
  assert.deepEqual(findPersonalData("Καλέστε στο 6945 111 222"), ["phone"]);
  assert.deepEqual(findPersonalData("+30 210 123 4567"), ["phone"]);
  assert.deepEqual(findPersonalData("2101234567"), ["phone"]);
  assert.deepEqual(findPersonalData("maria.p@example.com"), ["email"]);
  assert.deepEqual(findPersonalData("GR16 0110 1250 0000 0001 2300 695"), ["iban"]);
  assert.deepEqual(findPersonalData("Τιμή 1.250.000 € · 120 τ.μ. · κατασκευή 2005 · 3ος όροφος"), []);
  assert.deepEqual(findPersonalData("12.500.000"), []);
  assert.deepEqual(findPersonalData("Ευρύχωρο, φωτεινό, κοντά στο μετρό"), []);
});

test("only allow-listed property facts reach a prompt", () => {
  const facts = pickPropertyFacts({
    propertyType: "APARTMENT", bedrooms: 2, area: { toString: () => "85.5" }, price: 210000,
    address: "Οδός Τάδε 5", latitude: 37.9, ownerName: "Μαρία", agentId: "u1", notes: "κωδικός πόρτας 1234",
    pool: false, balcony: true, city: "Αθήνα", titleEl: "τίτλος", heating: "NOT_AVAILABLE", energyClass: "C",
  });
  assert.deepEqual(Object.keys(facts).sort(), ["area", "balcony", "bedrooms", "city", "energyClass", "price", "propertyType"]);
  assert.equal(facts.area, 85.5);
  const prompt = buildDescriptionPrompt(facts, "el");
  for (const secret of ["Οδός Τάδε", "Μαρία", "1234", "37.9", "u1"]) assert.ok(!prompt.user.includes(secret) && !prompt.system.includes(secret), secret);
  assert.match(prompt.system, /ΜΟΝΟ τα στοιχεία που δίνονται/);
});

test("report summaries carry aggregates only and the output is bounded plain text", () => {
  const p = buildReportSummaryPrompt({ title: "Leads", period: "Οκτώβριος", scope: "όλο το γραφείο", metrics: [{ label: "Leads", value: 42 }, { label: "Μετατροπή", value: null }] });
  assert.match(p.user, /Leads: 42/);
  assert.match(p.user, /Μετατροπή: —/);
  assert.equal(cleanAiText("  a\r\n\n\n\nb  "), "a\n\nb");
  assert.equal(cleanAiText("x".repeat(5000)).length, 4000);
});
