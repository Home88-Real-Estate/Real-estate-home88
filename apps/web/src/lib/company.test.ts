import assert from "node:assert/strict";
import { test } from "node:test";

import { isPlaceholderEmail, mergeCompany, type CompanyRows } from "./company";

const ENV = {
  legalName: "HOME88",
  postalAddress: "",
  privacyEmail: "privacy@example.com",
  dmcaEmail: "dmca@example.com",
  phone: "2166003838",
  contactEmail: "",
  hours: "Δευτέρα - Παρασκευή 09:00 - 17:00",
  policyVersion: "2026-10-01",
} as const;

const empty: CompanyRows = { settings: null, privacy: null, socials: [], profileEl: null };

test("placeholder addresses are never shown", () => {
  assert.equal(isPlaceholderEmail("privacy@example.com"), true);
  assert.equal(isPlaceholderEmail("info@home88.gr"), false);
  const info = mergeCompany(empty, ENV);
  assert.equal(info.privacyEmail, null);
  assert.equal(info.dmcaEmail, null);
  assert.equal(info.email, null);
  assert.equal(info.address, null);
});

test("values entered in the CRM override the environment", () => {
  const info = mergeCompany(
    {
      settings: { officeName: "HOME88 Γλυφάδα", phone1: "210 0000000", mobile: "690 0000000", addressEl: "Οδός 1", postalCode: "16675", city: "Γλυφάδα", hoursEl: "Δευ-Παρ 10-18", email: "info@home88.gr" },
      privacy: { privacyEmail: "dpo@home88.gr", dmcaEmail: null },
      socials: [{ platform: "INSTAGRAM", url: "https://instagram.com/home88" }, { platform: "GOOGLE_PLUS", url: "https://plus.google.com/x" }, { platform: "FACEBOOK", url: "https://facebook.com/home88" }],
      profileEl: "Προφίλ",
    },
    ENV,
  );
  assert.equal(info.name, "HOME88 Γλυφάδα");
  assert.deepEqual(info.phones, ["210 0000000", "690 0000000"]);
  assert.equal(info.address, "Οδός 1, 16675 Γλυφάδα");
  assert.equal(info.privacyEmail, "dpo@home88.gr");
  assert.equal(info.email, "info@home88.gr");
  // Legacy Google+ is kept in data but never shown; order is fixed.
  assert.deepEqual(info.socials.map((s) => s.platform), ["FACEBOOK", "INSTAGRAM"]);
});

test("without settings, the published phone and hours from the environment remain", () => {
  const info = mergeCompany(empty, ENV);
  assert.equal(info.phone, "2166003838");
  assert.equal(info.hours, ENV.hours);
  assert.equal(info.name, "HOME88");
});
