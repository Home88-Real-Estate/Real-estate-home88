import assert from "node:assert/strict";
import { test } from "node:test";
import { settingsSection } from "@home88/domain";

import { contrastRatio, isValidGreekVat, portalUpdateSchema, sectionUpdateSchema, sectionValuesSchema } from "./settings";

test("Greek VAT check digit", () => {
  assert.equal(isValidGreekVat("094014201"), true);
  assert.equal(isValidGreekVat("123456789"), false);
  assert.equal(isValidGreekVat("000000000"), false);
  assert.equal(isValidGreekVat("12345678"), false);
});

test("contrast of the HOME88 colours", () => {
  assert.ok(contrastRatio("#0B5394", "#FFFFFF") >= 4.5);
  assert.ok(contrastRatio("#053755", "#FFFFFF") >= 7);
  assert.ok(contrastRatio("#F5F8FB", "#053755") >= 7);
  assert.ok(contrastRatio("#FFFF00", "#FFFFFF") < 3);
});

test("form strings become typed values; empty means not set", () => {
  const schema = sectionValuesSchema(settingsSection("calendar")!);
  const v = schema.parse({ viewingMinutes: "45", workdayStart: "09:00", workdayEnd: "17:30", workingDays: ["5", "1", "1"], reminderMinutesBefore: "", timezone: "Asia/Tokyo" });
  assert.equal(v.viewingMinutes, 45);
  assert.deepEqual(v.workingDays, [1, 5]);
  assert.equal(v.reminderMinutesBefore, null);
  assert.equal(v.timezone, "Europe/Athens", "read-only field cannot be changed");
  assert.equal(schema.safeParse({ workdayStart: "18:00", workdayEnd: "09:00" }).success, false);
});

test("secrets only for declared secret fields of the section", () => {
  assert.equal(sectionUpdateSchema("email").safeParse({ values: {}, secrets: { smtpPassword: "x" } }).success, true);
  assert.equal(sectionUpdateSchema("email").safeParse({ values: {}, secrets: { fromEmail: "x" } }).success, false);
  assert.equal(sectionUpdateSchema("company").safeParse({ values: {}, secrets: { anything: "x" } }).success, false);
  assert.equal(sectionUpdateSchema("sms").safeParse({ values: { senderName: "HOME 88 Real Estate" } }).success, false);
});

test("portal rule conditions are validated and unknown keys refused", () => {
  const base = { enabled: false, values: {} };
  const ok = portalUpdateSchema.safeParse({
    ...base,
    rule: { mode: "ALL_WEBSITE", conditions: { listingTypes: ["SALE"], minPrice: 500000, cities: ["Γλυφάδα"] } },
  });
  assert.equal(ok.success, true);
  assert.equal(portalUpdateSchema.safeParse({ ...base, rule: { mode: "NONE" } }).success, true, "conditions are optional");
  assert.equal(portalUpdateSchema.safeParse({ ...base, rule: { mode: "NONE", conditions: null } }).success, true);

  const inverted = portalUpdateSchema.safeParse({ ...base, rule: { mode: "NONE", conditions: { minPrice: 9, maxPrice: 1 } } });
  assert.equal(inverted.success, false);
  assert.equal(portalUpdateSchema.safeParse({ ...base, rule: { mode: "NONE", conditions: { minPrice: -1 } } }).success, false);
  assert.equal(portalUpdateSchema.safeParse({ ...base, rule: { mode: "NONE", conditions: { script: "x" } } }).success, false);
  assert.equal(portalUpdateSchema.safeParse({ ...base, rule: { mode: "NONE", conditions: { listingTypes: ["SWAP"] } } }).success, false);
});
