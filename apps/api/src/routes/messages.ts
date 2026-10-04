/**
 * Client communications (Επικοινωνία): email and SMS to contacts, templates,
 * history, inbound SMS opt-outs and the scheduled staff reminders.
 *
 *  - Templates are HOME88's own wording; fields are checked when saved.
 *  - Every send is recorded in the message log (address and body encrypted),
 *    including the ones the rules blocked, so "what did we tell this person"
 *    has one answer.
 *  - SERVICE messages concern the client's own enquiry. MARKETING needs a
 *    current marketing consent, honours suppression and opt-outs, and every
 *    marketing email carries a one-click unsubscribe link.
 *  - No provider, no send: email without SMTP is recorded as LOGGED (nothing
 *    delivered); SMS without an adapter is refused.
 *
 * Visibility: contacts are shared, so any agent can see a contact's history;
 * the global outbox shows managers everything and agents their own sends.
 */

import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Prisma } from "@home88/database";
import {
  isGreekMobile,
  isStopKeyword,
  MESSAGE_MERGE_FIELDS,
  messageTemplateProblems,
  normalisePhone,
  renderMessage,
  sendBlockedReason,
  smsSegments,
  type MessageChannel,
  type MessagePurpose,
} from "@home88/domain";

import { loadConfig } from "../config";
import { writeAudit } from "../lib/audit";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { clientIp, parseInput, userAgent } from "../lib/http";
import { sendMail } from "../lib/mailer";
import { notify } from "../lib/notify";
import { decryptField, encryptField, hasEncryptionKey, hashEmail, hashPhone, hashSubject } from "../lib/pii";
import { db } from "../lib/prisma";
import { unsubscribeAvailable, unsubscribeUrl } from "../lib/unsubscribe";
import { requireRole, roleAtLeast } from "../plugins/auth";
import { resolveSmsProvider } from "../providers/sms";
import { ProviderNotConfiguredError } from "../providers/types";
import { settings } from "../settings";

type Actor = { id: string; role: string; firstName: string; lastName: string; email: string; phone?: string | null };

const channel = z.enum(["EMAIL", "SMS"]);
const purpose = z.enum(["SERVICE", "MARKETING"]);
const optionalId = z.string().max(40).optional().or(z.literal("")).transform((v) => (v ? v : null));

const templateSchema = z.object({
  name: z.string().trim().min(1, "Συμπληρώστε όνομα.").max(120),
  channel,
  purpose: purpose.default("SERVICE"),
  locale: z.enum(["el", "en"]).default("el"),
  subject: z.string().trim().max(200).optional().or(z.literal("")).transform((v) => (v ? v : null)),
  body: z.string().trim().min(1, "Γράψτε το κείμενο.").max(5000),
  active: z.boolean().default(true),
});

const composeSchema = z.object({
  contactId: z.string().min(1).max(40),
  channel,
  templateId: optionalId,
  purpose: purpose.optional(),
  subject: z.string().trim().max(200).optional().or(z.literal("")).transform((v) => (v ? v : null)),
  body: z.string().trim().max(5000).optional().or(z.literal("")).transform((v) => (v ? v : null)),
  propertyId: optionalId,
  /** Alternative to propertyId: the public code agents know, e.g. H88-000123. */
  propertyReference: z.string().trim().toUpperCase().max(20).optional().or(z.literal("")).transform((v) => (v ? v : null)),
  viewingId: optionalId,
  leadId: optionalId,
  transactionId: optionalId,
  sellerLeadId: optionalId,
});

const listSchema = z.object({
  contactId: z.string().max(40).optional(),
  channel: channel.optional(),
  status: z.enum(["SENT", "LOGGED", "FAILED", "BLOCKED"]).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

function meta(request: FastifyRequest) {
  return { ipAddress: clientIp(request), userAgent: userAgent(request) };
}

function assertTemplate(body: string, subject: string | null) {
  for (const text of [body, subject ?? ""]) {
    const { unknown, unclosed } = messageTemplateProblems(text);
    if (unknown.length || unclosed) {
      const parts = [unknown.length ? `άγνωστα πεδία: ${unknown.map((u) => `{{${u}}}`).join(", ")}` : "", unclosed ? "πεδίο χωρίς κλείσιμο }}" : ""].filter(Boolean);
      throw badRequest(`Το πρότυπο δεν αποθηκεύτηκε — ${parts.join(" · ")}.`, { body: [parts.join(" · ")] });
    }
  }
}

type Prepared = {
  channel: MessageChannel;
  purpose: MessagePurpose;
  contact: { id: string; name: string };
  to: string | null;
  subject: string | null;
  text: string | null;
  missing: string[];
  blocked: string | null;
  segments: ReturnType<typeof smsSegments> | null;
  templateId: string | null;
  consentRecordId: string | null;
  context: { propertyId: string | null; viewingId: string | null; leadId: string | null; transactionId: string | null; sellerLeadId: string | null };
};

/** Resolve recipient, fill the template and apply the sending rules — shared by preview and send. */
async function prepare(actor: Actor, input: z.infer<typeof composeSchema>): Promise<Prepared> {
  const contact = await db().contact.findUnique({ where: { id: input.contactId } });
  if (!contact) throw notFound("Η επαφή δεν βρέθηκε.");
  if (input.propertyReference && !input.propertyId) {
    const ref = await db().property.findUnique({ where: { reference: input.propertyReference }, select: { id: true } });
    if (!ref) throw badRequest("Δεν βρέθηκε ακίνητο με αυτόν τον κωδικό.", { propertyReference: ["Άγνωστος κωδικός ακινήτου."] });
    input.propertyId = ref.id;
  }

  const template = input.templateId ? await db().messageTemplate.findUnique({ where: { id: input.templateId } }) : null;
  if (input.templateId && (!template || !template.active)) throw badRequest("Το πρότυπο δεν βρέθηκε.");
  if (template && template.channel !== input.channel) throw badRequest("Το πρότυπο είναι για άλλο κανάλι.");
  const body = template?.body ?? input.body;
  const subjectTpl = input.channel === "EMAIL" ? (template?.subject ?? input.subject) : null;
  if (!body) throw badRequest("Γράψτε μήνυμα ή επιλέξτε πρότυπο.", { body: ["Απαιτείται κείμενο."] });
  if (input.channel === "EMAIL" && !subjectTpl) throw badRequest("Συμπληρώστε θέμα.", { subject: ["Απαιτείται θέμα."] });
  const msgPurpose: MessagePurpose = (template?.purpose as MessagePurpose | undefined) ?? input.purpose ?? "SERVICE";
  if (!template) assertTemplate(body, subjectTpl);

  const [company, agent, property, viewing] = await Promise.all([
    settings().config("company"),
    db().user.findUnique({ where: { id: actor.id }, select: { firstName: true, lastName: true, email: true, phone: true } }),
    input.propertyId ? db().property.findUnique({ where: { id: input.propertyId }, select: { id: true, reference: true, titleEl: true, price: true, monthlyRent: true, listingType: true, publishedOnWebsite: true } }) : null,
    input.viewingId ? db().viewing.findUnique({ where: { id: input.viewingId }, select: { id: true, startsAt: true, propertyId: true } }) : null,
  ]);
  if (input.propertyId && !property) throw badRequest("Το ακίνητο δεν βρέθηκε.");
  if (input.viewingId && !viewing) throw badRequest("Το ραντεβού δεν βρέθηκε.");

  const cfg = loadConfig();
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  const price = property ? Number(property.listingType === "RENT" ? (property.monthlyRent ?? property.price) : property.price) : null;
  const tz = { timeZone: "Europe/Athens" } as const;
  const values: Record<string, string> = {
    "contact.firstName": contact.firstName,
    "contact.lastName": contact.lastName,
    "contact.fullName": `${contact.firstName} ${contact.lastName}`.trim(),
    "agent.fullName": agent ? `${agent.firstName} ${agent.lastName}`.trim() : "",
    "agent.phone": agent?.phone ?? "",
    "agent.email": agent?.email ?? "",
    "agency.name": s(company.officeName) || s(company.legalName),
    "agency.phone": s(company.phone1),
    "property.reference": property?.reference ?? "",
    "property.title": property?.titleEl ?? "",
    "property.price": price ? `${new Intl.NumberFormat("el-GR").format(price)} €` : "",
    "property.url": property?.publishedOnWebsite ? `${cfg.SITE_URL.replace(/\/+$/, "")}/property/${encodeURIComponent(property.reference)}` : "",
    "viewing.date": viewing ? new Intl.DateTimeFormat("el-GR", { ...tz, dateStyle: "full" }).format(viewing.startsAt) : "",
    "viewing.time": viewing ? new Intl.DateTimeFormat("el-GR", { ...tz, timeStyle: "short" }).format(viewing.startsAt) : "",
  };
  const rendered = renderMessage(body, values);
  const renderedSubject = subjectTpl ? renderMessage(subjectTpl, values) : null;
  const missing = [...new Set([...(rendered.ok ? [] : rendered.missing), ...(renderedSubject && !renderedSubject.ok ? renderedSubject.missing : [])])];

  // Recipient and the rules that apply to them.
  const email = decryptField(contact.emailEncrypted);
  const phone = normalisePhone(decryptField(contact.mobileEncrypted) ?? decryptField(contact.phoneEncrypted));
  const to = input.channel === "EMAIL" ? email : isGreekMobile(phone) ? phone : null;
  const subjectHashes = [hashSubject(email), hashSubject(decryptField(contact.mobileEncrypted) ?? decryptField(contact.phoneEncrypted))].filter((h): h is string => !!h);
  const [consent, suppression] = await Promise.all([
    msgPurpose === "MARKETING" && subjectHashes.length
      ? db().consentRecord.findFirst({ where: { subjectHash: { in: subjectHashes }, purpose: "MARKETING" }, orderBy: { createdAt: "desc" } })
      : null,
    email ? db().emailSuppression.findUnique({ where: { emailHash: hashEmail(email) ?? "" } }) : null,
  ]);
  const consentValid = !!consent && consent.granted && !consent.revokedAt && (!consent.expiresAt || consent.expiresAt > new Date());
  const blocked = sendBlockedReason({
    channel: input.channel,
    purpose: msgPurpose,
    hasAddress: !!to,
    marketingConsent: consentValid,
    suppressed: input.channel === "EMAIL" && !!suppression,
    smsOptedOut: !!contact.smsOptOutAt,
    marketingOptedOut: !!contact.marketingOptOutAt,
    unsubscribeAvailable: unsubscribeAvailable(),
  });

  let text = rendered.ok ? rendered.text : rendered.preview;
  if (input.channel === "EMAIL") {
    const email = await settings().config("email");
    const disclaimer = s(contact.preferredLocale === "en" ? email.disclaimerEn || email.disclaimerEl : email.disclaimerEl);
    if (disclaimer) text = `${text}\n\n—\n${disclaimer}`;
    if (msgPurpose === "MARKETING" && to) {
      const link = unsubscribeUrl(to);
      if (link) text = `${text}\n\nΔιαγραφή από τις ενημερώσεις: ${link}`;
    }
  }

  return {
    channel: input.channel,
    purpose: msgPurpose,
    contact: { id: contact.id, name: `${contact.firstName} ${contact.lastName}`.trim() },
    to,
    subject: renderedSubject ? (renderedSubject.ok ? renderedSubject.text : renderedSubject.preview) : null,
    text,
    missing,
    blocked,
    segments: input.channel === "SMS" ? smsSegments(text) : null,
    templateId: template?.id ?? null,
    consentRecordId: consentValid ? consent!.id : null,
    context: {
      propertyId: property?.id ?? viewing?.propertyId ?? null,
      viewingId: viewing?.id ?? null,
      leadId: input.leadId,
      transactionId: input.transactionId,
      sellerLeadId: input.sellerLeadId,
    },
  };
}

function cronAuthorised(request: FastifyRequest): boolean {
  const secret = loadConfig().CRON_SECRET;
  if (!secret) return false;
  const header = String(request.headers.authorization ?? "");
  const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function messageRoutes(app: FastifyInstance): Promise<void> {
  const agent = { preHandler: requireRole("AGENT") };
  const manager = { preHandler: requireRole("MANAGER") };

  // --- Templates -------------------------------------------------------------------

  app.get("/message-templates", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const q = parseInput(z.object({ channel: channel.optional(), all: z.enum(["1"]).optional() }), request.query);
    const showAll = q.all === "1" && roleAtLeast(actor.role, "MANAGER");
    const rows = await db().messageTemplate.findMany({
      where: { ...(q.channel ? { channel: q.channel } : {}), ...(showAll ? {} : { active: true }) },
      orderBy: [{ channel: "asc" }, { name: "asc" }],
    });
    return { data: rows, mergeFields: MESSAGE_MERGE_FIELDS, canManage: roleAtLeast(actor.role, "MANAGER") };
  });

  app.post("/message-templates", manager, async (request) => {
    const actor = request.auth!.user as Actor;
    const input = parseInput(templateSchema, request.body);
    if (input.channel === "EMAIL" && !input.subject) throw badRequest("Συμπληρώστε θέμα.", { subject: ["Απαιτείται θέμα για email."] });
    assertTemplate(input.body, input.subject);
    const row = await db().messageTemplate.create({ data: { ...input, subject: input.channel === "EMAIL" ? input.subject : null, createdById: actor.id, updatedById: actor.id } });
    await writeAudit({ entity: "MESSAGE", entityId: row.id, action: "template_create", changes: { name: row.name, channel: row.channel, purpose: row.purpose }, actorId: actor.id, ...meta(request) });
    return { template: row };
  });

  app.patch("/message-templates/:id", manager, async (request) => {
    const actor = request.auth!.user as Actor;
    const { id } = request.params as { id: string };
    const existing = await db().messageTemplate.findUnique({ where: { id } });
    if (!existing) throw notFound("Το πρότυπο δεν βρέθηκε.");
    const input = parseInput(templateSchema.partial(), request.body);
    const ch = input.channel ?? existing.channel;
    const subject = input.subject !== undefined ? input.subject : existing.subject;
    if (ch === "EMAIL" && !subject) throw badRequest("Συμπληρώστε θέμα.", { subject: ["Απαιτείται θέμα για email."] });
    assertTemplate(input.body ?? existing.body, subject);
    const row = await db().messageTemplate.update({ where: { id }, data: { ...input, subject: ch === "EMAIL" ? subject : null, updatedById: actor.id } });
    await writeAudit({ entity: "MESSAGE", entityId: id, action: "template_update", changes: { fields: Object.keys(input) }, actorId: actor.id, ...meta(request) });
    return { template: row };
  });

  // --- Compose / send ----------------------------------------------------------------

  app.post("/messages/preview", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const p = await prepare(actor, parseInput(composeSchema, request.body));
    const sms = p.channel === "SMS" ? (await resolveSmsProvider()).getStatus() : null;
    return {
      preview: {
        channel: p.channel,
        purpose: p.purpose,
        to: p.to,
        subject: p.subject,
        text: p.text,
        missing: p.missing,
        blocked: p.blocked ?? (sms && sms.state !== "configured" ? "Δεν έχει ρυθμιστεί πάροχος SMS." : null),
        segments: p.segments,
      },
    };
  });

  app.post("/messages", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const input = parseInput(composeSchema, request.body);
    if (!hasEncryptionKey()) throw conflict("Το αρχείο μηνυμάτων αποθηκεύεται κρυπτογραφημένο και η κρυπτογράφηση δεν έχει ρυθμιστεί (PII_ENCRYPTION_KEY).");
    const p = await prepare(actor, input);
    if (p.missing.length) throw badRequest(`Λείπουν στοιχεία για το μήνυμα: ${p.missing.join(", ")}.`);
    const sms = p.channel === "SMS" ? await resolveSmsProvider() : null;
    if (sms && sms.getStatus().state !== "configured" && !p.blocked) {
      throw conflict("Δεν έχει ρυθμιστεί πάροχος SMS. Επιλέξτε πάροχο στις Ρυθμίσεις → SMS.");
    }

    const base = {
      channel: p.channel,
      purpose: p.purpose,
      contactId: p.contact.id,
      ...p.context,
      templateId: p.templateId,
      toEncrypted: encryptField(p.to),
      subject: p.subject,
      bodyEncrypted: encryptField(p.text),
      segments: p.segments?.segments ?? null,
      sentById: actor.id,
    };

    if (p.blocked) {
      const row = await db().message.create({ data: { ...base, status: "BLOCKED", error: p.blocked } });
      await writeAudit({ entity: "MESSAGE", entityId: row.id, action: "blocked", changes: { channel: p.channel, purpose: p.purpose, reason: p.blocked }, actorId: actor.id, ...meta(request) });
      throw conflict(p.blocked);
    }

    let status: "SENT" | "LOGGED" | "FAILED" = "SENT";
    let providerMessageId: string | null = null;
    let emailLogId: string | null = null;
    let error: string | null = null;
    try {
      if (p.channel === "EMAIL") {
        const unsubscribe = p.purpose === "MARKETING" ? unsubscribeUrl(p.to!) : null;
        const result = await sendMail({
          to: p.to!,
          subject: p.subject!,
          text: p.text!,
          category: p.purpose === "MARKETING" ? "MARKETING" : "TRANSACTIONAL",
          template: `message:${p.templateId ?? "custom"}`,
          consentRecordId: p.consentRecordId,
          headers: unsubscribe ? { "List-Unsubscribe": `<${unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined,
          metadata: { contactId: p.contact.id },
        });
        if (!result.ok) {
          status = "FAILED";
          error = result.reason === "suppressed" ? "Η διεύθυνση είναι στη λίστα διαγραφών." : "Χωρίς παραλήπτη.";
        } else {
          emailLogId = result.emailLogId;
          status = result.delivered ? "SENT" : "LOGGED";
        }
      } else {
        const r = await sms!.sendSms({ to: p.to!, text: p.text!, kind: p.purpose === "MARKETING" ? "MARKETING" : "OTHER", related: { contactId: p.contact.id, propertyId: p.context.propertyId ?? undefined, viewingId: p.context.viewingId ?? undefined } });
        providerMessageId = r.providerMessageId;
        status = r.accepted ? "SENT" : "FAILED";
        if (!r.accepted) error = "Ο πάροχος δεν δέχτηκε το μήνυμα.";
      }
    } catch (e) {
      status = "FAILED";
      error = e instanceof ProviderNotConfiguredError ? "Δεν έχει ρυθμιστεί πάροχος." : `Σφάλμα αποστολής (${e instanceof Error ? e.name : "Error"}).`;
    }

    const row = await db().message.create({
      data: { ...base, status, providerMessageId, emailLogId, error, sentAt: status === "SENT" ? new Date() : null },
    });
    await writeAudit({ entity: "MESSAGE", entityId: row.id, action: "send", changes: { channel: p.channel, purpose: p.purpose, status, templateId: p.templateId }, actorId: actor.id, ...meta(request) });
    return { message: { id: row.id, status, error } };
  });

  // --- History -------------------------------------------------------------------------

  app.get("/messages", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const q = parseInput(listSchema, request.query);
    const isManager = roleAtLeast(actor.role, "MANAGER");
    // Agents see their own outbox; a contact's full history is shown on the contact.
    const where: Prisma.MessageWhereInput = {
      ...(q.contactId ? { contactId: q.contactId } : isManager ? {} : { sentById: actor.id }),
      ...(q.channel ? { channel: q.channel } : {}),
      ...(q.status ? { status: q.status } : {}),
    };
    const take = 30;
    const [rows, total] = await Promise.all([
      db().message.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take,
        skip: (q.page - 1) * take,
        include: {
          contact: { select: { id: true, reference: true, firstName: true, lastName: true } },
          property: { select: { id: true, reference: true } },
          template: { select: { name: true } },
          sentBy: { select: { firstName: true, lastName: true } },
        },
      }),
      db().message.count({ where }),
    ]);
    return {
      data: rows.map((m) => ({
        id: m.id,
        channel: m.channel,
        purpose: m.purpose,
        status: m.status,
        to: decryptField(m.toEncrypted),
        subject: m.subject,
        body: decryptField(m.bodyEncrypted),
        segments: m.segments,
        error: m.error,
        contact: m.contact ? { id: m.contact.id, reference: m.contact.reference, name: `${m.contact.firstName} ${m.contact.lastName}`.trim() } : null,
        property: m.property,
        template: m.template?.name ?? null,
        sentBy: m.sentBy ? `${m.sentBy.firstName} ${m.sentBy.lastName}`.trim() : null,
        sentAt: m.sentAt,
        createdAt: m.createdAt,
      })),
      pagination: { page: q.page, limit: take, total, pages: Math.max(1, Math.ceil(total / take)) },
    };
  });

  /** Consent and opt-out state for a contact, for the compose panel. */
  app.get("/contacts/:id/communication", agent, async (request) => {
    const { id } = request.params as { id: string };
    const c = await db().contact.findUnique({ where: { id } });
    if (!c) throw notFound("Η επαφή δεν βρέθηκε.");
    const email = decryptField(c.emailEncrypted);
    const phone = normalisePhone(decryptField(c.mobileEncrypted) ?? decryptField(c.phoneEncrypted));
    const hashes = [hashSubject(email), hashSubject(decryptField(c.mobileEncrypted) ?? decryptField(c.phoneEncrypted))].filter((h): h is string => !!h);
    const [consent, suppression, sms] = await Promise.all([
      hashes.length ? db().consentRecord.findFirst({ where: { subjectHash: { in: hashes }, purpose: "MARKETING" }, orderBy: { createdAt: "desc" } }) : null,
      email ? db().emailSuppression.findUnique({ where: { emailHash: hashEmail(email) ?? "" } }) : null,
      resolveSmsProvider(),
    ]);
    return {
      hasEmail: !!email,
      hasMobile: isGreekMobile(phone),
      marketingConsent: !!consent && consent.granted && !consent.revokedAt && (!consent.expiresAt || consent.expiresAt > new Date()),
      marketingOptOut: !!c.marketingOptOutAt || !!suppression,
      smsOptOut: !!c.smsOptOutAt,
      smsProvider: sms.getStatus(),
      unsubscribeAvailable: unsubscribeAvailable(),
    };
  });

  // --- Inbound SMS ---------------------------------------------------------------------

  /** Provider callbacks. Public; the adapter verifies them. Without an adapter: 404, nothing changes. */
  app.post("/webhooks/sms", async (request, reply) => {
    const provider = await resolveSmsProvider();
    const headers = Object.fromEntries(Object.entries(request.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : String(v ?? "")]));
    const result = await provider.handleWebhook(request.body, headers);
    if (!result.handled) return reply.code(404).send({ error: { code: "not_found", message: "Not found." } });
    if (result.inbound && isStopKeyword(result.inbound.text)) {
      const phoneHash = hashPhone(result.inbound.from);
      if (phoneHash) {
        const updated = await db().contact.updateMany({ where: { phoneHash, smsOptOutAt: null }, data: { smsOptOutAt: new Date() } });
        if (updated.count) await writeAudit({ entity: "CONTACT", entityId: phoneHash.slice(0, 16), action: "sms_opt_out", changes: { contacts: updated.count } });
      }
    }
    if (result.delivery) {
      await db().message.updateMany({
        where: { providerMessageId: result.delivery.providerMessageId, channel: "SMS" },
        data: result.delivery.status === "FAILED" ? { status: "FAILED", error: result.delivery.detail ?? "Δεν παραδόθηκε." } : { status: "SENT" },
      });
    }
    return { ok: true };
  });

  /** Manual SMS opt-out / opt-in from the CRM (e.g. the client asked by phone). */
  app.post("/contacts/:id/sms-opt-out", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const { id } = request.params as { id: string };
    const input = parseInput(z.object({ optOut: z.boolean() }), request.body);
    const c = await db().contact.findUnique({ where: { id }, select: { id: true } });
    if (!c) throw notFound("Η επαφή δεν βρέθηκε.");
    if (!input.optOut && !roleAtLeast(actor.role, "MANAGER")) throw forbidden("Την επαναφορά SMS την κάνει υπεύθυνος.");
    await db().contact.update({ where: { id }, data: { smsOptOutAt: input.optOut ? new Date() : null } });
    await writeAudit({ entity: "CONTACT", entityId: id, action: input.optOut ? "sms_opt_out" : "sms_opt_in", actorId: actor.id, ...meta(request) });
    return { ok: true };
  });

  // --- Scheduled reminders --------------------------------------------------------------

  /**
   * Run by the scheduler with `Authorization: Bearer <CRON_SECRET>` (Vercel
   * Cron sends it automatically). Each item is claimed before it is announced,
   * so overlapping runs never notify twice.
   */
  const reminders = async (request: FastifyRequest, reply: { code(n: number): { send(b: unknown): unknown } }) => {
    if (!cronAuthorised(request)) return reply.code(401).send({ error: { code: "unauthorized", message: "Unauthorized." } });
    const now = new Date();
    let tasks = 0;
    let viewings = 0;

    const dueTasks = await db().task.findMany({
      where: { status: { in: ["OPEN", "IN_PROGRESS"] }, dueNotifiedAt: null, assignedToId: { not: null }, dueAt: { gte: new Date(now.getTime() - 86_400_000), lte: new Date(now.getTime() + 60 * 60_000) } },
      take: 200,
      select: { id: true, title: true, assignedToId: true },
    });
    for (const t of dueTasks) {
      const claimed = await db().task.updateMany({ where: { id: t.id, dueNotifiedAt: null }, data: { dueNotifiedAt: now } });
      if (!claimed.count) continue;
      await notify({ event: "TASK_DUE", title: `Εργασία προς λήξη: ${t.title}`, entityType: "TASK", entityId: t.id, userIds: [t.assignedToId], link: "/reminders" });
      tasks += 1;
    }

    const minutes = (await settings().config("calendar")).reminderMinutesBefore;
    if (typeof minutes === "number" && minutes > 0) {
      const upcoming = await db().viewing.findMany({
        where: { status: "SCHEDULED", reminderSentAt: null, startsAt: { gt: now, lte: new Date(now.getTime() + minutes * 60_000) } },
        take: 200,
        select: { id: true, startsAt: true, agentId: true, property: { select: { reference: true } } },
      });
      for (const v of upcoming) {
        const claimed = await db().viewing.updateMany({ where: { id: v.id, reminderSentAt: null }, data: { reminderSentAt: now } });
        if (!claimed.count) continue;
        const when = new Intl.DateTimeFormat("el-GR", { timeZone: "Europe/Athens", timeStyle: "short" }).format(v.startsAt);
        await notify({ event: "REMINDER", title: `Ραντεβού στις ${when} για ${v.property.reference}`, entityType: "VIEWING", entityId: v.id, userIds: [v.agentId], link: "/calendar" });
        viewings += 1;
      }
    }
    return { ok: true, tasks, viewings, viewingReminders: typeof minutes === "number" && minutes > 0 };
  };
  app.get("/cron/reminders", reminders);
  app.post("/cron/reminders", reminders);
}
