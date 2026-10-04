import assert from "node:assert/strict";
import { test } from "node:test";

import { enabledChannels, isGreekMobile, isStopKeyword, messageTemplateProblems, normalisePhone, renderMessage, sendBlockedReason, smsSegments } from "./communications";

test("message templates: strict fields, missing values named, literal insertion", () => {
  assert.deepEqual(messageTemplateProblems("{{contact.firstName}} {{owner.x}}").unknown, ["owner.x"]);
  const r = renderMessage("Γεια σας {{contact.firstName}}, {{property.reference}}", { "contact.firstName": "Μαρία" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual(r.missing, ["Κωδικός ακινήτου"]);
  const ok = renderMessage("{{contact.firstName}}", { "contact.firstName": "{{agent.phone}}" });
  assert.ok(ok.ok && ok.text === "{{agent.phone}}");
});

test("phone numbers normalise to E.164; only Greek mobiles take SMS", () => {
  assert.equal(normalisePhone("697 000 0000"), "+306970000000");
  assert.equal(normalisePhone("+30 697-000-0000"), "+306970000000");
  assert.equal(normalisePhone("0030 2101234567"), "+302101234567");
  assert.equal(normalisePhone("12345"), null);
  assert.equal(normalisePhone(""), null);
  assert.ok(isGreekMobile("+306970000000"));
  assert.ok(!isGreekMobile("+302101234567"));
});

test("SMS segments: Latin is GSM-7, Greek lowercase forces UCS-2", () => {
  assert.deepEqual(smsSegments("Hello"), { encoding: "GSM-7", length: 5, segments: 1, perSegment: 160 });
  assert.equal(smsSegments("a".repeat(161)).segments, 2);
  assert.equal(smsSegments("€").length, 2, "extension characters count double");
  const greek = smsSegments("Καλησπέρα");
  assert.equal(greek.encoding, "UCS-2");
  assert.equal(smsSegments("α".repeat(70)).segments, 1);
  assert.equal(smsSegments("α".repeat(71)).segments, 2);
  assert.equal(smsSegments("ΓΔΘ").encoding, "GSM-7", "Greek capitals in the GSM alphabet stay GSM-7");
});

test("stop keywords, sending rules and the notification matrix", () => {
  assert.ok(isStopKeyword(" stop "));
  assert.ok(isStopKeyword("ΣΤΟΠ"));
  assert.ok(isStopKeyword("διαγραφή"));
  assert.ok(!isStopKeyword("ok"));
  const base = { channel: "EMAIL" as const, purpose: "SERVICE" as const, hasAddress: true, marketingConsent: false, suppressed: false, smsOptedOut: false, marketingOptedOut: false, unsubscribeAvailable: false };
  assert.equal(sendBlockedReason(base), null, "service mail needs no marketing consent");
  assert.match(sendBlockedReason({ ...base, purpose: "MARKETING" })!, /συγκατάθεση/);
  assert.match(sendBlockedReason({ ...base, purpose: "MARKETING", marketingConsent: true })!, /UNSUBSCRIBE_SECRET/);
  assert.equal(sendBlockedReason({ ...base, purpose: "MARKETING", marketingConsent: true, unsubscribeAvailable: true }), null);
  assert.match(sendBlockedReason({ ...base, purpose: "MARKETING", marketingConsent: true, unsubscribeAvailable: true, suppressed: true })!, /διαγραφεί/);
  assert.match(sendBlockedReason({ ...base, channel: "SMS", smsOptedOut: true })!, /SMS/);
  assert.match(sendBlockedReason({ ...base, hasAddress: false })!, /email/);
  const stored = [{ event: "LEAD_NEW", channel: "EMAIL", enabled: true }, { event: "LEAD_NEW", channel: "CRM", enabled: false }];
  assert.deepEqual(enabledChannels("LEAD_NEW", stored, (c) => c === "CRM"), ["EMAIL"]);
  assert.deepEqual(enabledChannels("OFFER", stored, (c) => c === "CRM"), ["CRM"]);
});
