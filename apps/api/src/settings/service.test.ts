import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

import { createMemorySettingsStore } from "./memory-store";
import { createSecretBox, keyIdOf, parseKey, SecretUnreadableError } from "./secret-box";
import { createSettingsService } from "./service";
import { toRequestConfig } from "./index";

const SUPER = { id: "u-super", role: "SUPER_ADMIN", name: "Super" };
const ADMIN = { id: "u-admin", role: "ADMIN", name: "Admin" };
const MANAGER = { id: "u-manager", role: "MANAGER", name: "Manager" };
const AGENT = { id: "u-agent", role: "AGENT", name: "Agent" };
const ip = { ip: "203.0.113.1" };

function setup(opts: { key?: Buffer | null; now?: () => number } = {}) {
  const store = createMemorySettingsStore();
  const key = opts.key === undefined ? randomBytes(32) : opts.key;
  const box = key ? createSecretBox(key) : null;
  const service = createSettingsService({ store, box: () => box, now: opts.now, envSmtpConfigured: () => false });
  return { store, service, box };
}

async function rejects(promise: Promise<unknown>, status: number) {
  await assert.rejects(promise, (error: { statusCode?: number }) => error.statusCode === status);
}

// --- Authorisation --------------------------------------------------------------

test("AGENT can neither read nor change protected settings", async () => {
  const { service } = setup();
  await rejects(service.view(AGENT, "legal"), 403);
  await rejects(service.view(AGENT, "company"), 403);
  await rejects(service.update(AGENT, "company", { values: { officeName: "X" } }, ip), 403);
  assert.deepEqual(await service.visible(AGENT), []);
});

test("ADMIN can change company and legal settings, but not security or permissions", async () => {
  const { service } = setup();
  const view = await service.update(ADMIN, "company", { values: { officeName: "HOME88" } }, ip);
  assert.equal(view.values.officeName, "HOME88");
  assert.equal(view.canManage, true);
  await service.update(ADMIN, "legal", { values: { taxOffice: "Α' Αθηνών" } }, ip);

  const security = await service.view(ADMIN, "security");
  assert.equal(security.canManage, false);
  await rejects(service.update(ADMIN, "security", { values: { passwordMinLength: 16 } }, ip), 403);
  await rejects(service.update(ADMIN, "subscription", { values: { plan: "Pro" } }, ip), 403);
  await rejects(service.setPermission(ADMIN, { role: "AGENT", permission: "settings.company.view", granted: true }, ip), 403);
});

test("SUPER_ADMIN can change system settings", async () => {
  const { service } = setup();
  const v = await service.update(SUPER, "security", { values: { passwordMinLength: 16, maxLoginAttempts: 5 } }, ip);
  assert.equal(v.values.passwordMinLength, 16);
  const s = await service.update(SUPER, "subscription", { values: { plan: "Pro", startsAt: "2026-01-01", expiresAt: "2026-11-21" } }, ip);
  assert.equal(s.values.expiresAt, "2026-11-21");
});

test("MANAGER sees operational sections only and manages requests", async () => {
  const { service } = setup();
  const keys = (await service.visible(MANAGER)).map((s) => s.key);
  assert.ok(keys.includes("requests"));
  assert.ok(!keys.includes("legal"));
  assert.ok(!keys.includes("email"));
  await service.update(MANAGER, "requests", { values: { minMatchScore: 55 } }, ip);
  await rejects(service.update(MANAGER, "company", { values: { officeName: "X" } }, ip), 403);
});

test("permission overrides apply, and reserved permissions can never be granted", async () => {
  const { service } = setup();
  await service.setPermission(SUPER, { role: "AGENT", permission: "settings.areas.view", granted: true }, ip);
  assert.ok((await service.visible(AGENT)).some((s) => s.key === "areas"));

  await rejects(service.setPermission(SUPER, { role: "ADMIN", permission: "settings.permissions.manage", granted: true }, ip), 409);
  await rejects(service.setPermission(SUPER, { role: "ADMIN", permission: "settings.security.manage", granted: true }, ip), 409);
  // A crafted request cannot target SUPER_ADMIN either.
  await rejects(service.setPermission(SUPER, { role: "SUPER_ADMIN", permission: "settings.company.view", granted: false }, ip), 422);

  await service.setPermission(SUPER, { role: "ADMIN", permission: "settings.legal.manage", granted: false }, ip);
  await rejects(service.update(ADMIN, "legal", { values: { taxOffice: "X" } }, ip), 403);
});

// --- Validation -----------------------------------------------------------------

test("validation: Greek VAT check digit, colour contrast, commission split, unknown section", async () => {
  const { service } = setup();
  await rejects(service.update(ADMIN, "legal", { values: { vatNumber: "123456789" } }, ip), 422);
  await service.update(ADMIN, "legal", { values: { vatNumber: "094014201" } }, ip);

  await rejects(service.update(ADMIN, "branding", { values: { colorPrimary: "#F5F5F5" } }, ip), 422);
  await rejects(service.update(ADMIN, "branding", { values: { colorPrimary: "blue" } }, ip), 422);
  await service.update(ADMIN, "branding", { values: { colorPrimary: "#0b5394" } }, ip);

  await rejects(service.update(ADMIN, "commissions", { values: { agentSharePct: 60, agencySharePct: 30 } }, ip), 422);
  await rejects(service.update(ADMIN, "commissions", { values: { saleCommissionPct: 120 } }, ip), 422);
  await service.update(ADMIN, "commissions", { values: { agentSharePct: 40, agencySharePct: 60 } }, ip);

  await rejects(service.view(ADMIN, "nope"), 404);
  await rejects(service.update(ADMIN, "email", { values: {}, secrets: { notAField: "x" } }, ip), 422);
});

test("read-only platform values cannot be changed by a crafted request", async () => {
  const { service } = setup();
  const v = await service.update(ADMIN, "app", { values: { timezone: "America/New_York", currency: "USD" } }, ip);
  assert.equal(v.values.timezone, "Europe/Athens");
  assert.equal(v.values.currency, "EUR");
});

// --- Persistence and cache ------------------------------------------------------

test("persistence: values survive and business fields start empty, never guessed", async () => {
  const { service } = setup();
  const fresh = await service.view(ADMIN, "commissions");
  for (const value of Object.values(fresh.values)) assert.equal(value, null);
  const company = await service.view(ADMIN, "company");
  assert.equal(company.values.officeName, null);
  assert.equal(company.values.email, null);

  const requests = await service.view(ADMIN, "requests");
  assert.equal(requests.values.minMatchScore, 40, "40% is the configurable default");

  await service.update(ADMIN, "requests", { values: { minMatchScore: 65 } }, ip);
  assert.equal((await service.config("requests")).minMatchScore, 65);
  assert.equal(toRequestConfig(await service.config("requests")).minMatchScore, 65);
});

test("cache: reads are cached, a save invalidates immediately, the TTL bounds staleness", async () => {
  let clock = 0;
  const { service, store } = setup({ now: () => clock });
  await service.config("calendar");
  await service.config("calendar");
  assert.equal(store.reads, 1, "second read served from cache");

  await service.update(ADMIN, "calendar", { values: { viewingMinutes: 45 } }, ip);
  assert.equal((await service.config("calendar")).viewingMinutes, 45, "save is visible at once");

  // Another instance changed the row: visible after the TTL.
  store.sections.set("calendar", { values: { viewingMinutes: 60 }, updatedAt: new Date(), updatedById: "x" });
  assert.equal((await service.config("calendar")).viewingMinutes, 45);
  clock += 31_000;
  assert.equal((await service.config("calendar")).viewingMinutes, 60);
});

// --- Secrets, masking and audit ---------------------------------------------------

test("secrets are write-only: never returned, and only reported as configured", async () => {
  const { service, store } = setup();
  const password = "Sup3r-Secret-Smtp-Pass";
  const view = await service.update(
    ADMIN,
    "email",
    { values: { mode: "SMTP", smtpHost: "smtp.example.net", smtpPort: 587, smtpUsername: "mailer", fromEmail: "crm@example.net" }, secrets: { smtpPassword: password } },
    ip,
  );
  assert.equal(view.secrets.smtpPassword?.configured, true);
  assert.equal(view.provider, "configured");
  assert.ok(!JSON.stringify(view).includes(password), "the view never contains the secret");
  assert.ok(!JSON.stringify(await service.view(ADMIN, "email")).includes(password));

  const stored = [...store.secrets.values()][0]!;
  assert.ok(!stored.ciphertext.includes(password), "stored encrypted");
  assert.equal(await service.secret("email", "smtpPassword"), password, "server-side use can decrypt");

  const cleared = await service.update(ADMIN, "email", { values: view.values, clearSecrets: ["smtpPassword"] }, ip);
  assert.equal(cleared.secrets.smtpPassword?.configured, false);
});

test("audit: normal fields keep old/new; secrets and tax ids are permanently masked", async () => {
  const { service, store } = setup();
  await service.update(ADMIN, "commissions", { values: { saleCommissionPct: 5 } }, ip);
  await service.update(ADMIN, "commissions", { values: { saleCommissionPct: 4 } }, ip);
  const commission = store.audit.filter((a) => a.field === "saleCommissionPct");
  assert.equal(commission.length, 2);
  assert.equal(commission[1]!.oldValue, 5);
  assert.equal(commission[1]!.newValue, 4);
  assert.equal(commission[1]!.actorName, "Admin");

  await service.update(ADMIN, "legal", { values: { vatNumber: "094014201", gemiNumber: "123456789000" } }, ip);
  const secretValue = "portal-api-key-ABC123";
  await service.update(ADMIN, "sms", { values: { provider: "Acme" }, secrets: { apiKey: secretValue, apiSecret: "s3cr3t-value" } }, ip);

  const all = JSON.stringify(store.audit);
  for (const forbidden of ["094014201", "123456789000", secretValue, "s3cr3t-value"]) {
    assert.ok(!all.includes(forbidden), `audit must not contain ${forbidden}`);
  }
  const vat = store.audit.find((a) => a.field === "vatNumber")!;
  assert.equal(vat.masked, true);
  assert.equal(vat.oldValue, undefined);
  assert.equal(vat.newValue, undefined);
  assert.match(String(vat.summary), /δεν καταγράφεται/);
  const key = store.audit.find((a) => a.field === "apiKey")!;
  assert.equal(key.action, "SECRET_SET");
  assert.equal(key.masked, true);
});

test("saving an unchanged form writes no audit entries", async () => {
  const { service, store } = setup();
  const view = await service.view(ADMIN, "app");
  await service.update(ADMIN, "app", { values: view.values }, ip);
  assert.equal(store.audit.length, 0);
});

test("without an encryption key, secrets are refused but other fields still save", async () => {
  const { service } = setup({ key: null });
  await rejects(service.update(ADMIN, "sms", { values: { provider: "Acme" }, secrets: { apiKey: "k" } }, ip), 409);
  const view = await service.update(ADMIN, "sms", { values: { provider: "Acme" } }, ip);
  assert.equal(view.values.provider, "Acme");
  assert.equal(view.encryptionReady, false);
});

// --- Crypto ---------------------------------------------------------------------

test("secret box: round trip, bound to its field, detects another key", () => {
  const key = randomBytes(32);
  const box = createSecretBox(key);
  const envelope = box.seal("email", "smtpPassword", "pässwörd");
  assert.equal(box.open("email", "smtpPassword", envelope), "pässwörd");
  assert.throws(() => box.open("email", "apiKey", envelope), SecretUnreadableError, "moved envelope fails");
  assert.throws(() => box.open("email", "smtpPassword", { ...envelope, ciphertext: Buffer.from("tampered").toString("base64") }), SecretUnreadableError);
  assert.throws(() => createSecretBox(randomBytes(32)).open("email", "smtpPassword", envelope), SecretUnreadableError);
  assert.equal(keyIdOf(key).length, 12);
  assert.equal(parseKey(key.toString("base64"))?.equals(key), true);
  assert.equal(parseKey(key.toString("hex"))?.equals(key), true);
  assert.equal(parseKey("too-short"), null);
});
