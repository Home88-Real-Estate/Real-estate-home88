/**
 * End-to-end test of staff notifications, client email/SMS and the scheduled
 * reminders through the real API and a real Postgres, with fake email and SMS
 * providers. Runs only when TEST_DATABASE_URL points at a disposable database
 * with all migrations applied:
 *
 *   TEST_DATABASE_URL=postgresql://… npx tsx --test src/routes/messages.integration.test.ts
 *
 * Template texts below are test placeholders, not HOME88 wording.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

const url = process.env.TEST_DATABASE_URL;

test("notifications, client messaging rules, SMS opt-out and reminders", { skip: !url && "TEST_DATABASE_URL not set" }, async () => {
  process.env.DATABASE_URL = url!;
  process.env.JWT_SECRET ??= randomBytes(32).toString("base64");
  process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
  process.env.PII_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
  process.env.UNSUBSCRIBE_SECRET = "";
  process.env.CRON_SECRET = "";
  const { handleApiRequest } = await import("../handler");
  const { db } = await import("../lib/prisma");
  const { hashPassword } = await import("../lib/passwords");
  const { encryptField, hashEmail, hashPhone, hashSubject } = await import("../lib/pii");
  const { resetConfig } = await import("../config");
  const { setEmailProvider } = await import("../providers/email");
  const { setSmsProvider } = await import("../providers/sms");
  const { notify } = await import("../lib/notify");
  resetConfig();

  // Fake providers that record what would have been sent.
  const mails: Array<{ to: string; subject: string; text: string; headers?: Record<string, string> }> = [];
  setEmailProvider({
    name: "fake-email",
    async send(m) {
      mails.push(m);
      return { delivered: true, providerMessageId: `mail-${mails.length}` };
    },
    getStatus: () => ({ state: "configured", provider: "fake" }),
    async handleWebhook() {
      return { handled: false };
    },
  });

  const run = randomBytes(4).toString("hex");
  const RUN = run.toUpperCase();
  const password = "Integration-Test-Password-123";
  const hash = hashPassword(password, 10);
  const mk = (role: string, tag: string, phone?: string) =>
    db().user.create({ data: { email: `${tag}-${run}@test.invalid`, firstName: tag, lastName: "Test", role: role as never, passwordHash: hash, phone } });
  const [agentUser, other, manager, admin] = await Promise.all([mk("AGENT", "cagent", "6971111111"), mk("AGENT", "cagent2"), mk("MANAGER", "cmanager"), mk("ADMIN", "cadmin")]);
  const property = await db().property.create({
    data: { reference: `MSG-${RUN}`, slug: `msg-${run}`, listingType: "SALE", propertyType: "APARTMENT", titleEl: "Διαμέρισμα δοκιμής", descriptionEl: "Δοκιμή", price: 210000, status: "ACTIVE", agentId: agentUser.id, publishedOnWebsite: true },
  });
  const clientEmail = `client-${run}@test.invalid`;
  const clientMobile = `69${String(Date.now()).slice(-8)}`;
  const contact = await db().contact.create({
    data: {
      reference: `C-T${RUN}`, firstName: "Ελένη", lastName: "Πελάτισσα", roles: ["BUYER"],
      emailEncrypted: encryptField(clientEmail), emailHash: hashEmail(clientEmail),
      mobileEncrypted: encryptField(clientMobile), phoneHash: hashPhone(clientMobile),
    },
  });

  async function login(email: string) {
    const res = await handleApiRequest(new Request("http://crm.test/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }));
    assert.equal(res.status, 200, `login ${email}`);
    return res.headers.get("set-cookie")!.split(";")[0]!;
  }
  const [agentCookie, otherCookie, managerCookie, adminCookie] = await Promise.all([login(agentUser.email), login(other.email), login(manager.email), login(admin.email)]);
  const call = async (cookie: string | null, method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => {
    const headers: Record<string, string> = { ...extra, ...(body === undefined ? {} : { "content-type": "application/json" }) };
    if (cookie) headers.cookie = cookie;
    const res = await handleApiRequest(new Request(`http://crm.test/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: res.status, body: (await res.json()) as any };
  };

  // --- Staff notifications follow the Settings matrix -------------------------------
  // Email notifications can only be switched on once an email provider is set (the fake one catches the sends).
  { const r = await call(adminCookie, "PUT", "/settings/sections/email", { values: { mode: "SMTP", smtpHost: "smtp.test.invalid", smtpPort: 587, fromEmail: "crm@test.invalid" } }); assert.equal(r.status, 200, JSON.stringify(r.body)); }
  { const r = await call(adminCookie, "PUT", "/settings/notifications", { event: "OFFER", channel: "EMAIL", enabled: true }); assert.equal(r.status, 200, JSON.stringify(r.body)); }
  const trx = await call(managerCookie, "POST", "/transactions", { propertyReference: property.reference, buyerName: "Αγοραστής" });
  assert.equal(trx.status, 200, JSON.stringify(trx.body));
  mails.length = 0;
  assert.equal((await call(managerCookie, "POST", `/transactions/${trx.body.transaction.id}/offers`, { party: "BUYER", amount: 200000 })).status, 200);
  const inbox = await call(agentCookie, "GET", "/notifications");
  assert.ok(inbox.body.data.some((n: any) => n.kind === "OFFER" && n.entityId === trx.body.transaction.id), "agent gets the in-CRM notice");
  const staffMail = mails.find((m) => m.to === agentUser.email);
  assert.ok(staffMail && /προσφορά/.test(staffMail.subject), "email channel switched on → agent emailed");
  assert.ok(!staffMail!.text.includes(clientEmail) && !staffMail!.text.includes(clientMobile), "no client details in staff notifications");
  assert.ok(!(await call(otherCookie, "GET", "/notifications")).body.data.some((n: any) => n.entityId === trx.body.transaction.id), "others do not see it");
  assert.equal((await call(adminCookie, "PUT", "/settings/notifications", { event: "PORTAL_FAILED", channel: "CRM", enabled: false })).status, 200);
  const off = await notify({ event: "PORTAL_FAILED", title: "x", entityType: "PROPERTY", entityId: property.id });
  assert.equal(off.crm, 0, "switched off in Settings → nothing");
  await call(adminCookie, "PUT", "/settings/notifications", { event: "PORTAL_FAILED", channel: "CRM", enabled: true });
  await call(adminCookie, "PUT", "/settings/notifications", { event: "OFFER", channel: "EMAIL", enabled: false });

  // --- Templates ----------------------------------------------------------------------
  const tplBody = "[ΔΟΚΙΜΗ] Γεια σας {{contact.firstName}}, για το {{property.reference}}: {{property.url}} — {{agent.fullName}}";
  assert.equal((await call(agentCookie, "POST", "/message-templates", { name: "x", channel: "EMAIL", subject: "s", body: tplBody })).status, 403, "templates are manager-only");
  const typo = await call(managerCookie, "POST", "/message-templates", { name: "x", channel: "EMAIL", subject: "s", body: "{{contact.firstname}}" });
  assert.equal(typo.status, 400);
  assert.match(typo.body.error.message, /contact\.firstname/);
  const tpl = await call(managerCookie, "POST", "/message-templates", { name: `Ενημέρωση ${run}`, channel: "EMAIL", purpose: "SERVICE", subject: "[ΔΟΚΙΜΗ] {{property.reference}}", body: tplBody });
  assert.equal(tpl.status, 200, JSON.stringify(tpl.body));
  const tplId = tpl.body.template.id as string;

  // --- Preview and send (service) ------------------------------------------------------
  let preview = await call(agentCookie, "POST", "/messages/preview", { contactId: contact.id, channel: "EMAIL", templateId: tplId });
  assert.equal(preview.status, 200);
  assert.ok(preview.body.preview.missing.includes("Κωδικός ακινήτου"), "fields with no value are named");
  assert.equal((await call(agentCookie, "POST", "/messages", { contactId: contact.id, channel: "EMAIL", templateId: tplId })).status, 400, "no send with blanks");
  preview = await call(agentCookie, "POST", "/messages/preview", { contactId: contact.id, channel: "EMAIL", templateId: tplId, propertyId: property.id });
  assert.deepEqual(preview.body.preview.missing, []);
  assert.match(preview.body.preview.text, new RegExp(`/property/${property.reference}`));

  assert.equal((await call(adminCookie, "PUT", "/settings/sections/email", { values: { disclaimerEl: "[ΔΟΚΙΜΑΣΤΙΚΟ ΥΠΟΣΕΛΙΔΟ]" } })).status, 200);
  mails.length = 0;
  const sent = await call(agentCookie, "POST", "/messages", { contactId: contact.id, channel: "EMAIL", templateId: tplId, propertyId: property.id });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(sent.body.message.status, "SENT");
  assert.equal(mails[0]!.to, clientEmail);
  assert.match(mails[0]!.text, /Γεια σας Ελένη/);
  assert.match(mails[0]!.text, /ΔΟΚΙΜΑΣΤΙΚΟ ΥΠΟΣΕΛΙΔΟ/, "disclaimer from Settings appended");
  assert.equal(mails[0]!.headers, undefined, "no unsubscribe header on service mail");
  const row = await db().message.findUniqueOrThrow({ where: { id: sent.body.message.id } });
  assert.ok(row.toEncrypted?.startsWith("v1:") && row.bodyEncrypted?.startsWith("v1:"), "address and body stored encrypted");
  await assert.rejects(db().message.update({ where: { id: row.id }, data: { subject: "edited" } }), "the record cannot be rewritten");
  await assert.rejects(db().message.delete({ where: { id: row.id } }), "or deleted");

  // --- Marketing rules --------------------------------------------------------------------
  const marketing = { contactId: contact.id, channel: "EMAIL", purpose: "MARKETING", subject: "[ΔΟΚΙΜΗ] Νέα ακίνητα", body: "[ΔΟΚΙΜΗ] {{contact.firstName}}" };
  let m = await call(agentCookie, "POST", "/messages", marketing);
  assert.equal(m.status, 409);
  assert.match(m.body.error.message, /συγκατάθεση/);
  assert.equal(await db().message.count({ where: { contactId: contact.id, status: "BLOCKED" } }), 1, "blocked attempts are recorded");
  await db().consentRecord.create({ data: { subjectHash: hashSubject(clientEmail)!, purpose: "MARKETING", granted: true, policyVersion: "test", source: "test", grantedAt: new Date() } });
  m = await call(agentCookie, "POST", "/messages", marketing);
  assert.equal(m.status, 409);
  assert.match(m.body.error.message, /UNSUBSCRIBE_SECRET/, "no unsubscribe link → no marketing mail");
  process.env.UNSUBSCRIBE_SECRET = "test-unsubscribe-secret";
  resetConfig();
  mails.length = 0;
  m = await call(agentCookie, "POST", "/messages", marketing);
  assert.equal(m.status, 200, JSON.stringify(m.body));
  assert.match(mails[0]!.text, /\/unsubscribe\?token=/);
  assert.match(mails[0]!.headers?.["List-Unsubscribe"] ?? "", /^<https?:\/\/.+\/unsubscribe\?token=.+>$/);
  assert.equal(mails[0]!.headers?.["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  await db().emailSuppression.create({ data: { email: clientEmail, emailHash: hashEmail(clientEmail)!, reason: "UNSUBSCRIBE" } });
  m = await call(agentCookie, "POST", "/messages", marketing);
  assert.equal(m.status, 409);
  assert.match(m.body.error.message, /διαγραφεί/);
  const svc = await call(agentCookie, "POST", "/messages", { contactId: contact.id, channel: "EMAIL", subject: "[ΔΟΚΙΜΗ] Ραντεβού", body: "[ΔΟΚΙΜΗ] Επιβεβαίωση" });
  assert.equal(svc.status, 200, "service mail still reaches an unsubscribed client");

  // --- SMS -------------------------------------------------------------------------------
  const smsBody = { contactId: contact.id, channel: "SMS", body: "[ΔΟΚΙΜΗ] Καλησπέρα {{contact.firstName}}" };
  m = await call(agentCookie, "POST", "/messages", smsBody);
  assert.equal(m.status, 409);
  assert.match(m.body.error.message, /πάροχος SMS/);
  const texts: Array<{ to: string; text: string }> = [];
  setSmsProvider({
    name: "fake-sms",
    async sendSms(msg) {
      texts.push(msg);
      return { accepted: true, providerMessageId: `sms-${run}-${texts.length}` };
    },
    getStatus: () => ({ state: "configured", provider: "fake" }),
    async handleWebhook(payload) {
      const p = payload as { secret?: string; from?: string; text?: string; id?: string; status?: "DELIVERED" | "FAILED" };
      if (p.secret !== "ok") return { handled: false };
      return { handled: true, ...(p.from ? { inbound: { from: p.from, text: p.text ?? "" } } : {}), ...(p.id ? { delivery: { providerMessageId: p.id, status: p.status ?? "DELIVERED" } } : {}) };
    },
  });
  preview = await call(agentCookie, "POST", "/messages/preview", smsBody);
  assert.equal(preview.body.preview.segments.encoding, "UCS-2", "Greek → UCS-2");
  m = await call(agentCookie, "POST", "/messages", smsBody);
  assert.equal(m.status, 200, JSON.stringify(m.body));
  assert.equal(texts[0]!.to, `+30${clientMobile}`);
  const smsRow = await db().message.findUniqueOrThrow({ where: { id: m.body.message.id } });
  assert.equal(smsRow.segments, 1);

  assert.equal((await call(null, "POST", "/webhooks/sms", { secret: "bad", from: clientMobile, text: "STOP" })).status, 404, "unverified callbacks ignored");
  assert.equal((await call(null, "POST", "/webhooks/sms", { secret: "ok", id: smsRow.providerMessageId, status: "FAILED" })).status, 200);
  assert.equal((await db().message.findUniqueOrThrow({ where: { id: smsRow.id } })).status, "FAILED", "delivery report recorded");
  assert.equal((await call(null, "POST", "/webhooks/sms", { secret: "ok", from: `+30${clientMobile}`, text: "Στοπ" })).status, 200);
  assert.ok((await db().contact.findUniqueOrThrow({ where: { id: contact.id } })).smsOptOutAt, "STOP opts the client out");
  m = await call(agentCookie, "POST", "/messages", smsBody);
  assert.equal(m.status, 409);
  assert.match(m.body.error.message, /SMS/);
  assert.equal((await call(agentCookie, "POST", `/contacts/${contact.id}/sms-opt-out`, { optOut: false })).status, 403, "only a manager reverses an opt-out");
  setSmsProvider(null);

  // --- History visibility ------------------------------------------------------------------
  const own = await call(otherCookie, "GET", "/messages");
  assert.ok(!own.body.data.some((x: any) => x.contact?.id === contact.id), "agents' outbox shows only their own sends");
  const history = await call(otherCookie, "GET", `/messages?contactId=${contact.id}`);
  assert.ok(history.body.data.length >= 4, "a contact's history is visible on the contact");
  const state = await call(agentCookie, "GET", `/contacts/${contact.id}/communication`);
  assert.deepEqual([state.body.marketingConsent, state.body.marketingOptOut, state.body.smsOptOut], [true, true, true]);

  // --- Scheduled reminders --------------------------------------------------------------------
  assert.equal((await call(null, "GET", "/cron/reminders")).status, 401, "no CRON_SECRET → refused");
  process.env.CRON_SECRET = "cron-test-secret";
  resetConfig();
  assert.equal((await call(null, "GET", "/cron/reminders", undefined, { authorization: "Bearer wrong" })).status, 401);
  const task = await db().task.create({ data: { title: `Τηλέφωνο ${run}`, dueAt: new Date(Date.now() + 30 * 60_000), assignedToId: agentUser.id } });
  const viewing = await db().viewing.create({ data: { propertyId: property.id, clientName: "Πελάτης", startsAt: new Date(Date.now() + 60 * 60_000), agentId: agentUser.id } });
  const auth = { authorization: "Bearer cron-test-secret" };
  assert.equal((await call(adminCookie, "PUT", "/settings/sections/calendar", { values: { reminderMinutesBefore: null } })).status, 200);
  let cron = await call(null, "GET", "/cron/reminders", undefined, auth);
  assert.equal(cron.status, 200);
  assert.ok(cron.body.tasks >= 1);
  assert.equal(cron.body.viewingReminders, false, "appointment reminders stay off until Settings sets the time");
  assert.ok((await db().task.findUniqueOrThrow({ where: { id: task.id } })).dueNotifiedAt);
  cron = await call(null, "GET", "/cron/reminders", undefined, auth);
  assert.equal((await db().crmNotification.count({ where: { kind: "TASK_DUE", entityId: task.id } })), 1, "announced once");
  assert.equal((await call(adminCookie, "PUT", "/settings/sections/calendar", { values: { reminderMinutesBefore: 120 } })).status, 200);
  cron = await call(null, "POST", "/cron/reminders", {}, auth);
  assert.equal(cron.body.viewingReminders, true);
  assert.ok((await db().viewing.findUniqueOrThrow({ where: { id: viewing.id } })).reminderSentAt);
  assert.equal(await db().crmNotification.count({ where: { kind: "REMINDER", entityId: viewing.id, userId: agentUser.id } }), 1);

  // Clean global state for re-runs.
  await call(adminCookie, "PUT", "/settings/sections/calendar", { values: { reminderMinutesBefore: null } });
  await call(adminCookie, "PUT", "/settings/sections/email", { values: { disclaimerEl: null, mode: null, smtpHost: null, smtpPort: null, fromEmail: null } });
  process.env.CRON_SECRET = "";
  process.env.UNSUBSCRIBE_SECRET = "";
  resetConfig();
  setEmailProvider(null);
  await db().$disconnect();
});
