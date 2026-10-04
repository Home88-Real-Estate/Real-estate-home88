/**
 * The Connections overview through the real API and a real Postgres. Runs only
 * when TEST_DATABASE_URL points at a disposable database with all migrations
 * applied:
 *
 *   TEST_DATABASE_URL=postgresql://… npx tsx --test src/routes/connections.integration.test.ts
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

const url = process.env.TEST_DATABASE_URL;

test("connections: managers see each service's state, never a credential", { skip: !url && "TEST_DATABASE_URL not set" }, async () => {
  process.env.DATABASE_URL = url!;
  process.env.JWT_SECRET ??= randomBytes(32).toString("base64");
  process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
  process.env.PII_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
  const cronSecret = `cron-${randomBytes(12).toString("hex")}`;
  process.env.CRON_SECRET = cronSecret;
  process.env.UNSUBSCRIBE_SECRET = "";
  const { handleApiRequest } = await import("../handler");
  const { db } = await import("../lib/prisma");
  const { hashPassword } = await import("../lib/passwords");
  const { resetConfig } = await import("../config");
  const { setEmailProvider } = await import("../providers/email");
  resetConfig();

  const run = randomBytes(4).toString("hex");
  const password = "Integration-Test-Password-123";
  const hash = hashPassword(password, 10);
  const mk = (role: string, tag: string) =>
    db().user.create({ data: { email: `${tag}-${run}@test.invalid`, firstName: tag, lastName: "Test", role: role as never, passwordHash: hash } });
  const [agent, manager, admin] = await Promise.all([mk("AGENT", "xagent"), mk("MANAGER", "xmanager"), mk("ADMIN", "xadmin")]);

  async function login(email: string) {
    const res = await handleApiRequest(new Request("http://crm.test/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }));
    assert.equal(res.status, 200, `login ${email}`);
    return res.headers.get("set-cookie")!.split(";")[0]!;
  }
  const [agentCookie, managerCookie, adminCookie] = await Promise.all([login(agent.email), login(manager.email), login(admin.email)]);
  const get = async (cookie: string | null) => {
    const res = await handleApiRequest(new Request("http://crm.test/api/connections", { headers: cookie ? { cookie } : {} }));
    const text = await res.text();
    return { status: res.status, text, body: JSON.parse(text) as any };
  };

  assert.equal((await get(null)).status, 401);
  assert.equal((await get(agentCookie)).status, 403, "agents do not see infrastructure");

  // No provider: email is logged, not sent.
  setEmailProvider({
    name: "fake-email",
    async send() {
      return { delivered: true, providerMessageId: "fake-1" };
    },
    getStatus: () => ({ state: "not_configured", provider: null }),
    async handleWebhook() {
      return { handled: false };
    },
  });
  let r = await get(managerCookie);
  assert.equal(r.status, 200);
  const keys = r.body.data.map((c: any) => c.key);
  for (const k of ["email", "sms", "signature", "storage", "pii", "reminders", "unsubscribe"]) assert.ok(keys.includes(k), `row ${k}`);
  assert.ok(keys.some((k: string) => k.startsWith("portal:")), "portals are listed");
  const row = (body: any, key: string) => body.data.find((c: any) => c.key === key);
  assert.equal(row(r.body, "email").status, "NOT_CONFIGURED");
  assert.equal(row(r.body, "pii").status, "CONFIGURED");
  assert.equal(row(r.body, "unsubscribe").status, "NOT_CONFIGURED");
  assert.deepEqual(row(r.body, "reminders").variables, ["CRON_SECRET"], "names of server variables, never values");
  assert.ok(!r.text.includes(cronSecret), "the cron secret never leaves the server");
  assert.ok(!r.text.includes(process.env.PII_ENCRYPTION_KEY!), "the encryption key never leaves the server");
  assert.equal(typeof r.body.summary.attention, "number");

  // A configured provider: no longer "not configured". The latest delivery is global state other
  // test files write concurrently, so the success/error ordering is covered by the domain tests.
  setEmailProvider({
    name: "fake-email",
    async send() {
      return { delivered: true, providerMessageId: "fake-2" };
    },
    getStatus: () => ({ state: "configured", provider: "smtp" }),
    async handleWebhook() {
      return { handled: false };
    },
  });
  await db().message.create({ data: { channel: "EMAIL", purpose: "SERVICE", status: "FAILED", error: "Η διεύθυνση είναι στη λίστα διαγραφών." } });
  r = await get(adminCookie);
  const email = row(r.body, "email");
  assert.ok(["CONFIGURED", "CONNECTED", "ERROR"].includes(email.status), email.status);
  assert.equal(email.provider, "smtp");
  assert.notEqual(email.lastError, "Η διεύθυνση είναι στη λίστα διαγραφών.", "recipient problems are not provider errors");
  assert.equal(email.settingsHref, "/settings/email", "administrators get the Settings link");
  assert.equal(row(r.body, "storage").settingsHref, null, "server variables are set in hosting, not in Settings");

  setEmailProvider(null);
  process.env.CRON_SECRET = "";
  resetConfig();
  await db().$disconnect();
});
