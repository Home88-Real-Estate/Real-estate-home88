/**
 * Digital mandates (Εντολές).
 *
 *  - A mandate is built from the template version that Settings → Ψηφιακές
 *    Εντολές marks ACTIVE for its type and language. The wording is the
 *    lawyer's; nothing here writes legal text. Rendering is strict: unknown
 *    fields or empty values stop issuing.
 *  - Issuing allocates the official number, fills the template, renders the
 *    PDF, stores it privately and records SHA-256 checksums of the text and
 *    the PDF. From then on the database freezes what the client signs.
 *  - Signing: through the e-signature provider once one is configured (its
 *    webhooks or a status refresh move the mandate), or on paper by uploading
 *    the signed copy.
 *  - An exclusive assignment cannot overlap another live exclusive
 *    assignment on the same property.
 *  - Every step is in the append-only timeline and the audit log.
 *
 * Visibility: managers and above see every mandate; others see the ones they
 * are the agent of or created.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Prisma } from "@home88/database";
import {
  canMoveMandate,
  formatMandateNumber,
  MANDATE_MERGE_FIELDS,
  MANDATE_PRINCIPAL,
  MANDATE_STATUS_LABELS,
  MANDATE_STATUSES,
  MANDATE_TYPES,
  mandateDisplayStatus,
  mandateSettingsMissing,
  renderTemplate,
  TEMPLATE_LOCALES,
  type MandateStatus,
} from "@home88/domain";
import { label, PROPERTY_TYPE_LABELS } from "@home88/types";

import { writeAudit } from "../lib/audit";
import { recordDocumentAudit } from "../lib/brokerage/documents/audit";
import { issueDocument, loadIssuedPdf } from "../lib/brokerage/documents/issue";
import { assertFeeSaveable, milestoneInput, structuredMandateData, structuredShape } from "../lib/brokerage/documents/mandate-input";
import { applyDocumentSignatureStatus, sendDocumentForSignature } from "../lib/brokerage/documents/signing";
import { auditContext, guarded } from "../lib/doc-http";
import { mayViewSensitive, requireDocPermission } from "../lib/doc-permissions";
import { notify } from "../lib/notify";
import { documentKey, documentStore, sha256 } from "../lib/document-store";
import { badRequest, conflict, notFound } from "../lib/errors";
import { clientIp, parseInput, userAgent } from "../lib/http";
import { renderMandatePdf } from "../lib/mandate-pdf";
import { decryptField, encryptField, hasEncryptionKey } from "../lib/pii";
import { db } from "../lib/prisma";
import { allocateReference } from "../lib/references";
import { requireRole, roleAtLeast } from "../plugins/auth";
import { resolveSignatureProvider } from "../providers/signature";
import { settings } from "../settings";
import { confirmUpload } from "./documents";

type Actor = { id: string; role: string; firstName: string; lastName: string; email: string };

const TYPES = MANDATE_TYPES.map((t) => t.value) as [string, ...string[]];
const LOCALES = TEMPLATE_LOCALES.map((t) => t.value) as [string, ...string[]];
const LIVE = ["ISSUED", "SENT", "VIEWED", "SIGNED"];
const FINAL = ["SIGNED", "DECLINED", "EXPIRED", "CANCELLED"];

const text = (max: number) => z.string().trim().max(max).optional().or(z.literal("")).transform((v) => (v ? v : null));
const date = z
  .union([z.literal(""), z.null(), z.undefined(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ημερομηνία ΕΕΕΕ-ΜΜ-ΗΗ.")])
  .transform((v) => (v ? new Date(`${v}T00:00:00Z`) : null));

const partySchema = z.object({
  contactReference: z.string().trim().toUpperCase().max(20).optional().or(z.literal("")),
  fullName: text(160),
  taxId: text(20),
  idNumber: text(30),
  address: text(300),
  email: z.string().trim().toLowerCase().email("Δώστε έγκυρο email.").max(254).optional().or(z.literal("")).transform((v) => (v ? v : null)),
  phone: text(40),
});

const termsSchema = z.object({
  price: z.union([z.literal(""), z.null(), z.undefined(), z.coerce.number().positive().max(1_000_000_000)]).transform((v) => (v === "" || v == null ? null : v)),
  commission: text(300),
  viewingDate: z.union([z.literal(""), z.null(), z.undefined(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).transform((v) => (v ? v : null)),
  cadastralCode: text(40),
  special: text(4000),
  /** Explicit exceptions to an exclusive assignment; only an exclusive assignment ever prints them. */
  exceptions: z.array(z.string().trim().min(1).max(300)).max(10).optional(),
});

const draftShape = {
  propertyReference: z.string().trim().toUpperCase().max(20).optional().or(z.literal("")),
  startsAt: date,
  endsAt: date,
  terms: termsSchema.default({}),
  parties: z.array(partySchema).max(6).optional(),
  ...structuredShape,
};

const createSchema = z.object({
  type: z.enum(TYPES),
  locale: z.enum(LOCALES).default("el"),
  sellerLeadId: z.string().max(40).optional().or(z.literal("")),
  ...draftShape,
});
const updateSchema = z.object(draftShape).partial();

const listSchema = z.object({
  status: z.enum([...MANDATE_STATUSES, "OPEN"]).optional(),
  type: z.enum(TYPES).optional(),
  scope: z.enum(["mine", "all"]).optional(),
  propertyId: z.string().max(40).optional(),
  sellerLeadId: z.string().max(40).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

const signedCopySchema = z.object({ token: z.string().min(10).max(600), signedAt: date });
const cancelSchema = z.object({ reason: z.string().trim().min(1, "Συμπληρώστε τον λόγο.").max(1000) });
const noteSchema = z.object({ text: z.string().trim().min(1, "Γράψτε σημείωση.").max(4000) });

const nameOf = (a: Actor) => `${a.firstName} ${a.lastName}`.trim() || a.email;
const typeLabel = (t: string) => MANDATE_TYPES.find((x) => x.value === t)?.label ?? t;
const statusLabel = (s: string) => MANDATE_STATUS_LABELS[s as keyof typeof MANDATE_STATUS_LABELS] ?? s;
const dateFmt = (d: Date | string | null | undefined, locale: string) =>
  d ? new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "el-GR", { timeZone: "Europe/Athens", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(d)) : "";
const money = (v: number | null | undefined, locale: string) =>
  v == null ? "" : `${new Intl.NumberFormat(locale === "en" ? "en-GB" : "el-GR", { maximumFractionDigits: 2 }).format(v)} €`;

function visibleTo(actor: Actor): Prisma.MandateWhereInput {
  if (roleAtLeast(actor.role, "MANAGER")) return {};
  return { OR: [{ agentId: actor.id }, { createdById: actor.id }] };
}

async function loadOwned(actor: Actor, id: string) {
  const m = await db().mandate.findFirst({ where: { AND: [{ id }, visibleTo(actor)] } });
  if (!m) throw notFound("Η εντολή δεν βρέθηκε.");
  return m;
}

function meta(request: FastifyRequest) {
  return { ipAddress: clientIp(request), userAgent: userAgent(request) };
}

async function event(tx: Prisma.TransactionClient, mandateId: string, actor: Actor | null, type: string, summary: string, data?: Record<string, unknown>) {
  await tx.mandateEvent.create({
    data: { mandateId, type, summary, data: data as Prisma.InputJsonValue | undefined, actorId: actor?.id ?? null, actorName: actor ? nameOf(actor) : "Πάροχος υπογραφής" },
  });
}

type PartyInput = z.infer<typeof partySchema>;

/** Parties as stored rows; personal fields encrypted. Refused without an encryption key. */
async function buildParties(role: string, input: PartyInput[]): Promise<Prisma.MandatePartyCreateWithoutMandateInput[]> {
  const rows: Prisma.MandatePartyCreateWithoutMandateInput[] = [];
  for (const [i, p] of input.entries()) {
    let contactId: string | null = null;
    let fullName = p.fullName;
    if (p.contactReference) {
      const c = await db().contact.findUnique({ where: { reference: p.contactReference } });
      if (!c) throw badRequest(`Δεν βρέθηκε επαφή ${p.contactReference}.`, { parties: [`Άγνωστη επαφή ${p.contactReference}.`] });
      contactId = c.id;
      fullName ??= `${c.firstName} ${c.lastName}`.trim();
      p.email ??= decryptField(c.emailEncrypted);
      p.phone ??= decryptField(c.phoneEncrypted) ?? decryptField(c.mobileEncrypted);
      p.taxId ??= decryptField(c.taxIdEncrypted);
      p.address ??= decryptField(c.addressEncrypted);
    }
    if (!fullName) throw badRequest("Συμπληρώστε ονοματεπώνυμο εντολέα.", { parties: ["Λείπει ονοματεπώνυμο."] });
    const personal = [p.taxId, p.idNumber, p.address, p.email, p.phone].some(Boolean);
    if (personal && !hasEncryptionKey()) {
      throw conflict("Τα στοιχεία του εντολέα αποθηκεύονται μόνο κρυπτογραφημένα και η κρυπτογράφηση δεν έχει ρυθμιστεί (PII_ENCRYPTION_KEY).");
    }
    rows.push({
      role,
      ...(contactId ? { contact: { connect: { id: contactId } } } : {}),
      fullName,
      taxIdEncrypted: encryptField(p.taxId),
      idNumberEncrypted: encryptField(p.idNumber),
      addressEncrypted: encryptField(p.address),
      emailEncrypted: encryptField(p.email),
      phoneEncrypted: encryptField(p.phone),
      sortOrder: i,
    });
  }
  return rows;
}

const maskParty = (p: Party) => ({
  fullName: p.fullName,
  taxId: p.taxIdEncrypted ? "••••••••" : null,
  idNumber: p.idNumberEncrypted ? "••••••" : null,
  address: p.addressEncrypted ? "••••••••" : null,
  email: p.emailEncrypted ? "••••••••" : null,
  phone: p.phoneEncrypted ? "••••••••" : null,
  masked: true,
});

type Party = { fullName: string; taxIdEncrypted: string | null; idNumberEncrypted: string | null; addressEncrypted: string | null; emailEncrypted: string | null; phoneEncrypted: string | null };
const decryptParty = (p: Party) => ({
  fullName: p.fullName,
  taxId: decryptField(p.taxIdEncrypted),
  idNumber: decryptField(p.idNumberEncrypted),
  address: decryptField(p.addressEncrypted),
  email: decryptField(p.emailEncrypted),
  phone: decryptField(p.phoneEncrypted),
});

const FULL = {
  parties: { orderBy: { sortOrder: "asc" as const } },
  property: true,
  agent: { select: { id: true, firstName: true, lastName: true, email: true } },
} satisfies Prisma.MandateInclude;
type FullMandate = Prisma.MandateGetPayload<{ include: typeof FULL }>;

/** The values a template can use, from the mandate, Settings and the property. */
async function mergeValues(m: FullMandate, number: string | null, issuedAt: Date | null): Promise<Record<string, string>> {
  const [legal, company] = await Promise.all([settings().config("legal"), settings().config("company")]);
  const en = m.locale === "en";
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  const parties = m.parties.map(decryptParty);
  const join = (k: keyof ReturnType<typeof decryptParty>) => parties.map((p) => p[k]).filter(Boolean).join("; ");
  const terms = (m.terms ?? {}) as Record<string, unknown>;
  const p = m.property;
  return {
    "mandate.number": number ?? "",
    "mandate.date": dateFmt(issuedAt, m.locale),
    "mandate.startDate": dateFmt(m.startsAt, m.locale),
    "mandate.endDate": dateFmt(m.endsAt, m.locale),
    "agency.legalName": s(en ? legal.legalNameEn || legal.legalNameEl : legal.legalNameEl),
    "agency.vatNumber": s(legal.vatNumber),
    "agency.taxOffice": s(legal.taxOffice),
    "agency.gemiNumber": s(legal.gemiNumber),
    "agency.address": s(en ? legal.registeredAddressEn || legal.registeredAddressEl : legal.registeredAddressEl),
    "agency.phone": s(legal.phone) || s(company.phone1),
    "agency.email": s(legal.legalEmail) || s(company.email),
    "agent.fullName": m.agent ? `${m.agent.firstName} ${m.agent.lastName}`.trim() : "",
    "principal.fullName": join("fullName"),
    "principal.taxId": join("taxId"),
    "principal.idNumber": join("idNumber"),
    "principal.address": join("address"),
    "principal.phone": join("phone"),
    "principal.email": join("email"),
    "property.reference": p?.reference ?? "",
    "property.type": p ? label(PROPERTY_TYPE_LABELS, p.propertyType, en ? "en" : "el") : "",
    "property.address": p?.address ?? "",
    "property.area": p ? [p.areaName, p.city].filter(Boolean).join(", ") : "",
    "property.size": p?.area != null ? String(Number(p.area)) : "",
    "property.floor": p?.floor != null ? String(p.floor) : "",
    "property.cadastralCode": s(terms.cadastralCode),
    "terms.price": money(typeof terms.price === "number" ? terms.price : null, m.locale),
    "terms.commission": s(terms.commission),
    "terms.viewingDate": typeof terms.viewingDate === "string" ? dateFmt(`${terms.viewingDate}T12:00:00Z`, m.locale) : "",
    "terms.special": s(terms.special),
  };
}

async function activeTemplate(type: string, locale: string) {
  const tpl = await db().mandateTemplate.findUnique({ where: { type_locale: { type, locale } } });
  if (!tpl) return null;
  return db().mandateTemplateVersion.findFirst({ where: { templateId: tpl.id, status: "ACTIVE" } });
}

function draftProblems(m: { type: string; propertyId: string | null; startsAt: Date | null; endsAt: Date | null }, partyCount: number): string[] {
  const rule = MANDATE_PRINCIPAL[m.type];
  const out: string[] = [];
  if (rule?.needsProperty && !m.propertyId) out.push("Ακίνητο");
  if (rule?.needsTerm && (!m.startsAt || !m.endsAt)) out.push("Διάρκεια (έναρξη και λήξη)");
  if (m.startsAt && m.endsAt && m.endsAt <= m.startsAt) out.push("Η λήξη πρέπει να είναι μετά την έναρξη");
  if (partyCount === 0) out.push(rule?.label ?? "Εντολέας");
  return out;
}

/** Another live exclusive assignment on the same property for an overlapping period. */
async function overlappingExclusive(m: { id: string; type: string; propertyId: string | null; startsAt: Date | null; endsAt: Date | null }) {
  if (m.type !== "EXCLUSIVE_ASSIGNMENT" || !m.propertyId || !m.startsAt || !m.endsAt) return null;
  return db().mandate.findFirst({
    where: {
      id: { not: m.id },
      type: "EXCLUSIVE_ASSIGNMENT",
      propertyId: m.propertyId,
      status: { in: LIVE },
      startsAt: { lte: m.endsAt },
      endsAt: { gte: m.startsAt },
    },
    select: { reference: true, number: true },
  });
}

/** Move a mandate to a status reported by the signature provider. Idempotent. */
export async function applySignatureStatus(envelopeId: string, status: string): Promise<boolean> {
  const m = await db().mandate.findUnique({ where: { envelopeId } });
  if (!m) return false;
  const to = status as MandateStatus;
  if (m.status === to || !canMoveMandate(m.status, to)) return false;
  const at = new Date();
  const provider = await resolveSignatureProvider();
  let signed: { id: string; checksum: string } | null = null;
  if (to === "SIGNED" && provider.downloadSigned) {
    const pdf = await provider.downloadSigned(envelopeId);
    const key = documentKey("pdf");
    await documentStore().put(key, pdf, "application/pdf");
    const doc = await db().document.create({
      data: {
        title: `${typeLabel(m.type)} ${m.number ?? m.reference} (υπογεγραμμένη)`,
        category: "MANDATE",
        storageKey: key,
        mimeType: "application/pdf",
        byteSize: pdf.length,
        checksum: sha256(pdf),
        containsPersonalData: true,
        propertyId: m.propertyId,
      },
    });
    signed = { id: doc.id, checksum: doc.checksum! };
  }
  await db().$transaction(async (tx) => {
    await tx.mandate.update({
      where: { id: m.id },
      data: {
        status: to,
        ...(to === "VIEWED" ? { viewedAt: at } : {}),
        ...(to === "SIGNED" ? { signedAt: at, signatureMethod: "PROVIDER", signedDocumentId: signed?.id ?? null, signedChecksum: signed?.checksum ?? null } : {}),
        ...(to === "DECLINED" ? { declinedAt: at } : {}),
        ...(to === "EXPIRED" ? { expiredAt: at } : {}),
      },
    });
    if (to === "SIGNED") await tx.mandateParty.updateMany({ where: { mandateId: m.id, signedAt: null }, data: { signedAt: at } });
    await event(tx, m.id, null, "STATUS", `${statusLabel(m.status)} → ${statusLabel(to)}`, { from: m.status, to, envelopeId });
    if (to === "SIGNED" && m.sellerLeadId) {
      await tx.sellerLeadEvent.create({ data: { sellerLeadId: m.sellerLeadId, type: "MANDATE_SIGNED", summary: `Υπογράφηκε η εντολή ${m.number ?? m.reference}`, actorName: "Πάροχος υπογραφής" } });
    }
  });
  if (to === "SIGNED") await applyRetention(m.id);
  await writeAudit({ entity: "MANDATE", entityId: m.id, action: `provider_${to.toLowerCase()}`, changes: { envelopeId } });
  const providerAudit = { VIEWED: "MANDATE_VIEWED", SIGNED: "MANDATE_SIGNED", DECLINED: "MANDATE_DECLINED" }[to as string];
  if (providerAudit) {
    await recordDocumentAudit(db(), { actorUserId: null, actorRole: "PROVIDER", type: providerAudit as "MANDATE_VIEWED", entityType: "MANDATE", entityId: m.id, documentNumber: m.number, metadata: { method: "PROVIDER", level: m.signatureLevel, signedCopyChecksum: signed?.checksum ?? null } });
  }
  const notifyEvent = to === "VIEWED" ? "MANDATE_VIEWED" : to === "SIGNED" ? "MANDATE_SIGNED" : to === "EXPIRED" ? "MANDATE_EXPIRED" : null;
  if (notifyEvent) {
    await notify({ event: notifyEvent, title: `Εντολή ${m.number ?? m.reference}: ${statusLabel(to).toLowerCase()}`, entityType: "MANDATE", entityId: m.id, userIds: [m.agentId], link: `/mandates/${m.id}` });
  }
  return true;
}

/** Signed mandates are kept for the period HOME88 set (after legal review); never assumed. */
async function applyRetention(mandateId: string) {
  const m = await db().mandate.findUnique({ where: { id: mandateId }, select: { signedAt: true, pdfDocumentId: true, signedDocumentId: true } });
  if (!m?.signedAt) return;
  const years = (await settings().config("mandates")).retentionYears;
  if (!(typeof years === "number" && years > 0)) return;
  const until = new Date(m.signedAt);
  until.setUTCFullYear(until.getUTCFullYear() + years);
  const ids = [m.pdfDocumentId, m.signedDocumentId].filter((x): x is string => !!x);
  await db().document.updateMany({ where: { id: { in: ids } }, data: { retentionExpiresAt: until } });
}

export async function mandateRoutes(app: FastifyInstance): Promise<void> {
  const agent = { preHandler: requireRole("AGENT") };

  app.get("/mandates", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const q = parseInput(listSchema, request.query);
    const manager = roleAtLeast(actor.role, "MANAGER");
    const mine = !manager || q.scope === "mine";
    const scopeWhere: Prisma.MandateWhereInput = mine ? { OR: [{ agentId: actor.id }, { createdById: actor.id }] } : {};
    const where: Prisma.MandateWhereInput = {
      AND: [
        scopeWhere,
        q.status === "OPEN" ? { status: { in: ["DRAFT", "ISSUED", "SENT", "VIEWED"] } } : q.status ? { status: q.status } : {},
        q.type ? { type: q.type } : {},
        q.propertyId ? { propertyId: q.propertyId } : {},
        q.sellerLeadId ? { sellerLeadId: q.sellerLeadId } : {},
      ],
    };
    const take = 25;
    const [rows, total, counts] = await Promise.all([
      db().mandate.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        take,
        skip: (q.page - 1) * take,
        include: {
          property: { select: { id: true, reference: true, titleEl: true } },
          parties: { orderBy: { sortOrder: "asc" }, select: { fullName: true } },
          agent: { select: { firstName: true, lastName: true } },
        },
      }),
      db().mandate.count({ where }),
      db().mandate.groupBy({ by: ["status"], where: scopeWhere, _count: { _all: true } }),
    ]);
    const now = new Date();
    return {
      data: rows.map((m) => ({
        id: m.id,
        reference: m.reference,
        number: m.number,
        type: m.type,
        typeLabel: typeLabel(m.type),
        status: m.status,
        displayStatus: mandateDisplayStatus(m.status, m.endsAt, now),
        property: m.property,
        principal: m.parties.map((p) => p.fullName).join(", "),
        agent: m.agent,
        startsAt: m.startsAt,
        endsAt: m.endsAt,
        updatedAt: m.updatedAt,
      })),
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
      scope: mine ? "mine" : "all",
      pagination: { page: q.page, limit: take, total, pages: Math.max(1, Math.ceil(total / take)) },
    };
  });

  app.post("/mandates", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const input = parseInput(createSchema, request.body);
    const rule = MANDATE_PRINCIPAL[input.type]!;

    let seller: { id: string; propertyId: string | null; contactId: string | null; agentId: string | null; createdById: string | null } | null = null;
    if (input.sellerLeadId) {
      seller = await db().sellerLead.findFirst({
        where: { AND: [{ id: input.sellerLeadId }, roleAtLeast(actor.role, "MANAGER") ? {} : { OR: [{ agentId: actor.id }, { createdById: actor.id }] }] },
        select: { id: true, propertyId: true, contactId: true, agentId: true, createdById: true },
      });
      if (!seller) throw badRequest("Ο ιδιοκτήτης δεν βρέθηκε.");
    }
    let propertyId = seller?.propertyId ?? null;
    if (input.propertyReference) {
      const p = await db().property.findUnique({ where: { reference: input.propertyReference }, select: { id: true } });
      if (!p) throw badRequest("Δεν βρέθηκε ακίνητο με αυτόν τον κωδικό.", { propertyReference: ["Άγνωστος κωδικός ακινήτου."] });
      propertyId = p.id;
    }
    // Default principal: the owner record the mandate is created from.
    let partiesInput = input.parties ?? [];
    if (partiesInput.length === 0 && seller?.contactId) {
      const c = await db().contact.findUnique({ where: { id: seller.contactId }, select: { reference: true } });
      if (c) partiesInput = [{ contactReference: c.reference, fullName: null, taxId: null, idNumber: null, address: null, email: null, phone: null }];
    }
    const parties = await buildParties(rule.role, partiesInput);
    assertFeeSaveable(input);
    const supersedes = input.supersedesReference ? await db().mandate.findUnique({ where: { reference: input.supersedesReference.toUpperCase() }, select: { id: true } }) : null;
    if (input.supersedesReference && !supersedes) throw badRequest("Δεν βρέθηκε η εντολή που αντικαθίσταται.", { supersedesReference: ["Άγνωστη εντολή."] });

    const created = await db().$transaction(async (tx) => {
      const reference = await allocateReference(tx, "mandate", "MND");
      const m = await tx.mandate.create({
        data: {
          reference,
          type: input.type,
          locale: input.locale,
          propertyId,
          sellerLeadId: seller?.id ?? null,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          terms: input.terms as Prisma.InputJsonValue,
          agentId: actor.id,
          createdById: actor.id,
          parties: { create: parties },
          ...(structuredMandateData(input) as Partial<Prisma.MandateUncheckedCreateInput>),
          supersedesMandateId: supersedes?.id ?? null,
        },
      });
      for (const ms of input.milestones ?? []) {
        await tx.paymentMilestone.create({ data: { mandateId: m.id, sequence: ms.sequence, percentage: ms.percentage ?? null, fixedAmount: ms.fixedAmount ?? null, trigger: ms.trigger, description: ms.description, dueDateRule: ms.dueDateRule } });
      }
      await event(tx, m.id, actor, "CREATED", `Νέα ${typeLabel(input.type).toLowerCase()} (πρόχειρη)`);
      if (seller) {
        await tx.sellerLeadEvent.create({ data: { sellerLeadId: seller.id, type: "MANDATE", summary: `Πρόχειρη εντολή ${reference}`, actorId: actor.id, actorName: nameOf(actor) } });
      }
      await recordDocumentAudit(tx, { ...auditContext(request), type: "MANDATE_CREATED", entityType: "MANDATE", entityId: m.id, documentNumber: m.reference, after: { status: "DRAFT", type: input.type } });
      return m;
    });
    await writeAudit({ entity: "MANDATE", entityId: created.id, action: "create", changes: { type: input.type }, actorId: actor.id, ...meta(request) });
    return { mandate: { id: created.id, reference: created.reference } };
  });

  app.get("/mandates/:id", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const { id } = request.params as { id: string };
    await loadOwned(actor, id);
    const m = await db().mandate.findUniqueOrThrow({
      where: { id },
      include: {
        ...FULL,
        sellerLead: { select: { id: true, reference: true, ownerName: true } },
        templateVersion: { select: { id: true, version: true, checksum: true } },
        pdfDocument: { select: { id: true, byteSize: true, checksum: true } },
        signedDocument: { select: { id: true, byteSize: true, checksum: true, mimeType: true } },
        events: { orderBy: { createdAt: "desc" }, take: 200 },
      },
    });
    const sensitive = await mayViewSensitive(actor.role, "mandates");
    const draft = m.status === "DRAFT";
    const template = draft ? await activeTemplate(m.type, m.locale) : null;
    const mandatesSettings = await settings().config("mandates");
    let preview: { text: string; missing: string[]; unknown: string[] } | null = null;
    if (draft && template && sensitive) {
      const values = await mergeValues(m, null, new Date());
      values["mandate.number"] = "«αριθμός κατά την έκδοση»";
      const r = renderTemplate(template.body, values);
      preview = r.ok ? { text: r.text, missing: [], unknown: [] } : { text: r.preview, missing: r.missing, unknown: r.unknown };
    }
    const provider = await resolveSignatureProvider();
    return {
      mandate: {
        id: m.id,
        reference: m.reference,
        number: m.number,
        type: m.type,
        typeLabel: typeLabel(m.type),
        locale: m.locale,
        status: m.status,
        statusLabel: statusLabel(m.status),
        displayStatus: mandateDisplayStatus(m.status, m.endsAt),
        property: m.property ? { id: m.property.id, reference: m.property.reference, titleEl: m.property.titleEl } : null,
        sellerLead: m.sellerLead,
        agent: m.agent ? { firstName: m.agent.firstName, lastName: m.agent.lastName } : null,
        startsAt: m.startsAt,
        endsAt: m.endsAt,
        terms: m.terms,
        parties: m.parties.map((p) => ({ id: p.id, role: p.role, contactId: p.contactId, signedAt: p.signedAt, ...(sensitive ? decryptParty(p) : maskParty(p)) })),
        structured: {
          fee: { payer: m.feePayer, method: m.feeMethod, basis: m.feeBasis, percentage: m.feePercentage, fixedAmount: m.feeFixedAmount, currency: m.feeCurrency, vatTreatment: m.vatTreatment, vatRate: m.vatRate, paymentTrigger: m.paymentTrigger },
          durationType: m.durationType, specialTerms: m.specialTerms, knownDefects: m.knownDefects, storageState: m.storageState, verificationCode: m.verificationCode, supersedesMandateId: m.supersedesMandateId,
        },
        template: m.templateVersion ? { version: m.templateVersion.version, checksum: m.templateChecksum } : template ? { version: template.version, checksum: template.checksum, pending: true } : null,
        text: draft || !sensitive ? null : decryptField(m.renderedTextEncrypted),
        renderedChecksum: m.renderedChecksum,
        pdf: m.pdfDocument,
        pdfChecksum: m.pdfChecksum,
        signedDocument: m.signedDocument,
        signedChecksum: m.signedChecksum,
        signatureMethod: m.signatureMethod,
        signatureProvider: m.signatureProvider,
        envelopeId: m.envelopeId,
        signingExpiresAt: m.signingExpiresAt,
        issuedAt: m.issuedAt,
        sentAt: m.sentAt,
        viewedAt: m.viewedAt,
        signedAt: m.signedAt,
        declinedAt: m.declinedAt,
        cancelledAt: m.cancelledAt,
        cancelReason: m.cancelReason,
        events: m.events.map((e) => ({ id: e.id, type: e.type, summary: e.summary, actorName: e.actorName, createdAt: e.createdAt })),
        createdAt: m.createdAt,
      },
      readiness: {
        draftProblems: draft ? draftProblems(m, m.parties.length) : [],
        settingsMissing: mandateSettingsMissing(mandatesSettings, false),
        sendMissing: mandateSettingsMissing(mandatesSettings, true),
        templateMissing: draft && !template,
        storageConfigured: documentStore().configured(),
        encryptionConfigured: hasEncryptionKey(),
        provider: provider.getStatus(),
      },
      preview,
      mergeFields: MANDATE_MERGE_FIELDS,
    };
  });

  app.patch("/mandates/:id", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const { id } = request.params as { id: string };
    const m = await loadOwned(actor, id);
    if (m.status !== "DRAFT") throw conflict("Μόνο πρόχειρη εντολή αλλάζει. Για αλλαγές ακυρώστε την και δημιουργήστε αντίγραφο.");
    const input = parseInput(updateSchema, request.body);
    let propertyId: string | null | undefined;
    if (input.propertyReference !== undefined) {
      if (!input.propertyReference) propertyId = null;
      else {
        const p = await db().property.findUnique({ where: { reference: input.propertyReference }, select: { id: true } });
        if (!p) throw badRequest("Δεν βρέθηκε ακίνητο με αυτόν τον κωδικό.", { propertyReference: ["Άγνωστος κωδικός ακινήτου."] });
        propertyId = p.id;
      }
    }
    const parties = input.parties ? await buildParties(MANDATE_PRINCIPAL[m.type]!.role, input.parties) : null;
    assertFeeSaveable(input);
    const supersedes = input.supersedesReference ? await db().mandate.findUnique({ where: { reference: input.supersedesReference.toUpperCase() }, select: { id: true } }) : null;
    if (input.supersedesReference && !supersedes) throw badRequest("Δεν βρέθηκε η εντολή που αντικαθίσταται.", { supersedesReference: ["Άγνωστη εντολή."] });
    await db().$transaction(async (tx) => {
      await tx.mandate.update({
        where: { id },
        data: {
          ...structuredMandateData(input),
          ...(input.supersedesReference !== undefined ? { supersedesMandateId: supersedes?.id ?? null } : {}),
          ...(propertyId !== undefined ? { propertyId } : {}),
          ...(input.startsAt !== undefined ? { startsAt: input.startsAt } : {}),
          ...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}),
          ...(input.terms !== undefined ? { terms: input.terms as Prisma.InputJsonValue } : {}),
        },
      });
      if (parties) {
        await tx.mandateParty.deleteMany({ where: { mandateId: id } });
        await tx.mandate.update({ where: { id }, data: { parties: { create: parties } } });
      }
      if (input.milestones) {
        await tx.paymentMilestone.deleteMany({ where: { mandateId: id } });
        for (const ms of input.milestones) await tx.paymentMilestone.create({ data: { mandateId: id, sequence: ms.sequence, percentage: ms.percentage ?? null, fixedAmount: ms.fixedAmount ?? null, trigger: ms.trigger, description: ms.description, dueDateRule: ms.dueDateRule } });
      }
      await event(tx, id, actor, "UPDATED", "Ενημέρωση πρόχειρης εντολής", { fields: Object.keys(input) });
      await recordDocumentAudit(tx, { ...auditContext(request), type: "MANDATE_UPDATED", entityType: "MANDATE", entityId: id, documentNumber: m.number ?? m.reference, metadata: { fields: Object.keys(input) } });
    });
    await writeAudit({ entity: "MANDATE", entityId: id, action: "update", changes: { fields: Object.keys(input) }, actorId: actor.id, ...meta(request) });
    return { ok: true };
  });

  app.post("/mandates/:id/issue", agent, async (request) => {
    await requireDocPermission(request, "mandates.issue");
    const actor = request.auth!.user as Actor;
    const { id } = request.params as { id: string };
    const base = await loadOwned(actor, id);
    // Simple and exclusive assignments go through the document pipeline (validation, approved
    // template, snapshot, PDF, private storage, audit). Asking again returns the issued document.
    if (base.type !== "VIEWING") {
      const input = parseInput(z.object({ acknowledgeFeeAnomaly: z.string().trim().min(3).max(500).optional() }).default({}), request.body ?? {});
      const outcome = await guarded(() => issueDocument(db(), "MANDATE", id, { ...auditContext(request), acknowledgeFeeAnomaly: input.acknowledgeFeeAnomaly }));
      return { ok: true, ...outcome };
    }
    if (base.status !== "DRAFT") throw conflict("Η εντολή έχει ήδη εκδοθεί.");
    const m = await db().mandate.findUniqueOrThrow({ where: { id }, include: FULL });

    const problems = draftProblems(m, m.parties.length);
    if (problems.length) throw badRequest(`Συμπληρώστε: ${problems.join(", ")}.`);
    const cfg = await settings().config("mandates");
    const missingSettings = mandateSettingsMissing(cfg, false);
    if (missingSettings.length) throw conflict(`Ρυθμίσεις → Ψηφιακές Εντολές: λείπουν ${missingSettings.join(", ")}.`);
    const template = await activeTemplate(m.type, m.locale);
    if (!template) throw conflict(`Δεν υπάρχει ενεργό εγκεκριμένο κείμενο για «${typeLabel(m.type)}» (${m.locale}). Προσθέστε το στις Ρυθμίσεις → Ψηφιακές Εντολές.`);
    if (sha256(template.body) !== template.checksum) throw conflict("Το κείμενο του προτύπου δεν ταιριάζει με το checksum του. Ελέγξτε τις Ρυθμίσεις.");
    if (!hasEncryptionKey()) throw conflict("Η κρυπτογράφηση δεν έχει ρυθμιστεί (PII_ENCRYPTION_KEY).");
    if (!documentStore().configured()) throw conflict("Η αποθήκευση αρχείων (S3) δεν έχει ρυθμιστεί στον server.");
    const clash = await overlappingExclusive(m);
    if (clash) throw conflict(`Υπάρχει ήδη αποκλειστική εντολή ${clash.number ?? clash.reference} για το ίδιο ακίνητο στο ίδιο διάστημα.`);

    // Render with a provisional number first, so a template problem does not burn a number.
    const issuedAt = new Date();
    const values = await mergeValues(m, "0", issuedAt);
    const dry = renderTemplate(template.body, values);
    if (!dry.ok) {
      const parts = [dry.unknown.length ? `άγνωστα πεδία στο πρότυπο: ${dry.unknown.join(", ")}` : "", dry.missing.length ? `λείπουν: ${dry.missing.join(", ")}` : ""].filter(Boolean);
      throw badRequest(`Η εντολή δεν μπορεί να εκδοθεί — ${parts.join("· ")}.`);
    }

    const result = await db().$transaction(async (tx) => {
      const counter = await tx.referenceCounter.upsert({ where: { scope: "mandate-number" }, create: { scope: "mandate-number", nextValue: 2 }, update: { nextValue: { increment: 1 } } });
      const number = formatMandateNumber(String(cfg.numberingPrefix).trim(), Number(cfg.numberingDigits), counter.nextValue - 1);
      const r = renderTemplate(template.body, { ...values, "mandate.number": number });
      if (!r.ok) throw badRequest("Η εντολή δεν μπορεί να εκδοθεί.");
      const textChecksum = sha256(r.text);
      const pdf = await renderMandatePdf({ title: typeLabel(m.type), number, text: r.text, checksum: textChecksum });
        const key = documentKey("pdf");
      await documentStore().put(key, pdf, "application/pdf");
      const doc = await tx.document.create({
        data: {
          title: `${typeLabel(m.type)} ${number}`,
          category: "MANDATE",
          storageKey: key,
          mimeType: "application/pdf",
          byteSize: pdf.length,
          checksum: sha256(pdf),
          containsPersonalData: true,
          propertyId: m.propertyId,
          contactId: m.parties[0]?.contactId ?? null,
          uploadedById: actor.id,
        },
      });
      await tx.mandate.update({
        where: { id },
        data: {
          status: "ISSUED",
          number,
          issuedAt,
          templateVersionId: template.id,
          templateChecksum: template.checksum,
          renderedTextEncrypted: encryptField(r.text),
          renderedChecksum: textChecksum,
          pdfDocumentId: doc.id,
          pdfChecksum: doc.checksum,
        },
      });
      await event(tx, id, actor, "ISSUED", `Εκδόθηκε με αριθμό ${number} (πρότυπο έκδοση ${template.version})`, { number, templateVersion: template.version, pdfChecksum: doc.checksum });
      if (m.sellerLeadId) {
        await tx.sellerLeadEvent.create({ data: { sellerLeadId: m.sellerLeadId, type: "MANDATE", summary: `Εκδόθηκε η εντολή ${number}`, actorId: actor.id, actorName: nameOf(actor) } });
      }
      return { number, pdfChecksum: doc.checksum };
    }, { timeout: 30_000 });
    await writeAudit({ entity: "MANDATE", entityId: id, action: "issue", changes: result, actorId: actor.id, ...meta(request) });
    return { ok: true, ...result };
  });

  app.post("/mandates/:id/send", agent, async (request) => {
    await requireDocPermission(request, "mandates.send");
    const actor = request.auth!.user as Actor;
    const { id } = request.params as { id: string };
    const m = await loadOwned(actor, id);
    if (!canMoveMandate(m.status, "SENT")) throw conflict("Αποστέλλεται μόνο εντολή που έχει εκδοθεί.");
    // Documents issued through the pipeline: the exact issued PDF, storage verified first.
    if (m.storageState !== "NOT_STORED") {
      const r = await guarded(() => sendDocumentForSignature(db(), "MANDATE", id, auditContext(request)));
      if (m.agentId && m.agentId !== actor.id) {
        await notify({ event: "MANDATE_SENT", title: `Εντολή ${m.number}: στάλθηκε για υπογραφή`, entityType: "MANDATE", entityId: id, userIds: [m.agentId], link: `/mandates/${id}` });
      }
      return { ok: true, signingUrls: r.signingUrls, documentChecksum: r.documentChecksum, level: r.level };
    }
    const cfg = await settings().config("mandates");
    const missing = mandateSettingsMissing(cfg, true);
    if (missing.length) throw conflict(`Ρυθμίσεις → Ψηφιακές Εντολές: λείπουν ${missing.join(", ")}.`);
    const provider = await resolveSignatureProvider();
    if (provider.getStatus().state !== "configured") {
      throw conflict("Δεν υπάρχει ενεργός πάροχος ηλεκτρονικής υπογραφής. Μπορείτε να υπογράψετε σε χαρτί και να ανεβάσετε το υπογεγραμμένο αντίγραφο.");
    }
    const full = await db().mandate.findUniqueOrThrow({ where: { id }, include: { parties: { orderBy: { sortOrder: "asc" } }, pdfDocument: true } });
    const pdf = full.pdfDocument ? await documentStore().read(full.pdfDocument.storageKey) : null;
    if (!pdf || sha256(pdf) !== full.pdfChecksum) throw conflict("Το PDF της εντολής δεν βρέθηκε ή δεν ταιριάζει με το checksum του.");
    const expiresAt = new Date(Date.now() + Number(cfg.signingExpiryDays) * 86_400_000);
    const level = String(cfg.signatureLevel) as "SIMPLE" | "ADVANCED" | "QUALIFIED";
    const envelope = await provider.createSigningRequest({
      documentId: full.pdfDocumentId!,
      documentChecksum: full.pdfChecksum!,
      pdf,
      title: `${typeLabel(full.type)} ${full.number}`,
      signers: full.parties.map((p) => ({ name: p.fullName, email: decryptField(p.emailEncrypted), phone: decryptField(p.phoneEncrypted) })),
      level,
      expiresAt,
    });
    await db().$transaction(async (tx) => {
      await tx.mandate.update({
        where: { id },
        data: { status: "SENT", sentAt: new Date(), envelopeId: envelope.envelopeId, signatureProvider: provider.name, signatureLevel: level, signingExpiresAt: expiresAt },
      });
      await event(tx, id, actor, "SENT", `Στάλθηκε για υπογραφή μέσω ${provider.name}`, { envelopeId: envelope.envelopeId });
    });
    await writeAudit({ entity: "MANDATE", entityId: id, action: "send", changes: { provider: provider.name, envelopeId: envelope.envelopeId }, actorId: actor.id, ...meta(request) });
    if (full.agentId && full.agentId !== actor.id) {
      await notify({ event: "MANDATE_SENT", title: `Εντολή ${full.number}: στάλθηκε για υπογραφή`, entityType: "MANDATE", entityId: id, userIds: [full.agentId], link: `/mandates/${id}` });
    }
    return { ok: true, signingUrls: envelope.signingUrls };
  });

  app.post("/mandates/:id/refresh", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const { id } = request.params as { id: string };
    const m = await loadOwned(actor, id);
    if (!m.envelopeId || FINAL.includes(m.status)) return { ok: true, changed: false };
    const provider = await resolveSignatureProvider();
    const status = await provider.getEnvelopeStatus(m.envelopeId);
    return { ok: true, changed: await applySignatureStatus(m.envelopeId, status) };
  });

  app.post("/mandates/:id/signed-copy", agent, async (request) => {
    await requireDocPermission(request, "mandates.send");
    const actor = request.auth!.user as Actor;
    const { id } = request.params as { id: string };
    const m = await loadOwned(actor, id);
    if (!canMoveMandate(m.status, "SIGNED")) throw conflict("Υπογεγραμμένο αντίγραφο καταχωρίζεται μόνο για εντολή που έχει εκδοθεί και δεν έχει κλείσει.");
    // The original issued PDF must still verify before a signed copy is attached to it.
    if (m.storageState !== "NOT_STORED") await guarded(() => loadIssuedPdf(db(), "MANDATE", id));
    const input = parseInput(signedCopySchema, request.body);
    const signedAt = input.signedAt ?? new Date();
    if (signedAt > new Date()) throw badRequest("Η ημερομηνία υπογραφής δεν μπορεί να είναι μελλοντική.");
    if (m.issuedAt && signedAt < new Date(m.issuedAt.toISOString().slice(0, 10))) throw badRequest("Η ημερομηνία υπογραφής είναι πριν την έκδοση.");
    const party = await db().mandateParty.findFirst({ where: { mandateId: id }, orderBy: { sortOrder: "asc" } });

    const doc = await db().$transaction(async (tx) => {
      const d = await confirmUpload(
        actor,
        input.token,
        { title: `${typeLabel(m.type)} ${m.number} (υπογεγραμμένη)`, category: "MANDATE", propertyId: m.propertyId, contactId: party?.contactId ?? null, containsPersonalData: true },
        tx,
      );
      if (d.checksum === m.pdfChecksum) throw badRequest("Το υπογεγραμμένο αντίγραφο δεν μπορεί να είναι το αρχικό μη υπογεγραμμένο PDF.");
      await tx.mandate.update({
        where: { id },
        data: { status: "SIGNED", signedAt, signatureMethod: "PAPER", signatureLevel: "SIMPLE", signedDocumentId: d.id, signedChecksum: d.checksum },
      });
      await recordDocumentAudit(tx, { ...auditContext(request), type: "MANDATE_SIGNED", entityType: "MANDATE", entityId: id, documentNumber: m.number, metadata: { method: "PAPER", level: "SIMPLE", signedCopyChecksum: d.checksum, originalChecksum: m.pdfChecksum, signedAt: signedAt.toISOString().slice(0, 10), uploadedAt: new Date().toISOString() } });
      await tx.mandateParty.updateMany({ where: { mandateId: id, signedAt: null }, data: { signedAt } });
      await event(tx, id, actor, "SIGNED", `Υπογράφηκε σε χαρτί· καταχωρίστηκε το υπογεγραμμένο αντίγραφο`, { checksum: d.checksum });
      if (m.sellerLeadId) {
        await tx.sellerLeadEvent.create({ data: { sellerLeadId: m.sellerLeadId, type: "MANDATE_SIGNED", summary: `Υπογράφηκε η εντολή ${m.number}`, actorId: actor.id, actorName: nameOf(actor) } });
      }
      return d;
    });
    await applyRetention(id);
    await writeAudit({ entity: "MANDATE", entityId: id, action: "signed_copy", changes: { documentId: doc.id, checksum: doc.checksum }, actorId: actor.id, ...meta(request) });
    if (m.agentId && m.agentId !== actor.id) {
      await notify({ event: "MANDATE_SIGNED", title: `Εντολή ${m.number}: υπογράφηκε`, entityType: "MANDATE", entityId: id, userIds: [m.agentId], link: `/mandates/${id}` });
    }
    return { ok: true };
  });

  app.post("/mandates/:id/cancel", agent, async (request) => {
    await requireDocPermission(request, "mandates.cancel");
    const actor = request.auth!.user as Actor;
    const { id } = request.params as { id: string };
    const m = await loadOwned(actor, id);
    if (!canMoveMandate(m.status, "CANCELLED")) throw conflict("Η εντολή δεν μπορεί να ακυρωθεί σε αυτή την κατάσταση.");
    const input = parseInput(cancelSchema, request.body);
    await db().$transaction(async (tx) => {
      await tx.mandate.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: input.reason } });
      await event(tx, id, actor, "CANCELLED", `Ακυρώθηκε: ${input.reason}`);
      await recordDocumentAudit(tx, { ...auditContext(request), type: "MANDATE_CANCELLED", entityType: "MANDATE", entityId: id, documentNumber: m.number ?? m.reference, reason: input.reason, before: { status: m.status }, after: { status: "CANCELLED" } });
    });
    await writeAudit({ entity: "MANDATE", entityId: id, action: "cancel", actorId: actor.id, ...meta(request) });
    return { ok: true };
  });

  app.post("/mandates/:id/duplicate", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const { id } = request.params as { id: string };
    await loadOwned(actor, id);
    const m = await db().mandate.findUniqueOrThrow({ where: { id }, include: { parties: { orderBy: { sortOrder: "asc" } } } });
    const copy = await db().$transaction(async (tx) => {
      const reference = await allocateReference(tx, "mandate", "MND");
      const c = await tx.mandate.create({
        data: {
          reference,
          type: m.type,
          locale: m.locale,
          propertyId: m.propertyId,
          sellerLeadId: m.sellerLeadId,
          startsAt: m.startsAt,
          endsAt: m.endsAt,
          terms: m.terms as Prisma.InputJsonValue,
          agentId: actor.id,
          createdById: actor.id,
          parties: {
            create: m.parties.map(({ role, contactId, fullName, taxIdEncrypted, idNumberEncrypted, addressEncrypted, emailEncrypted, phoneEncrypted, sortOrder }) => ({
              role, contactId, fullName, taxIdEncrypted, idNumberEncrypted, addressEncrypted, emailEncrypted, phoneEncrypted, sortOrder,
            })),
          },
        },
      });
      await event(tx, c.id, actor, "CREATED", `Αντίγραφο της ${m.number ?? m.reference} (πρόχειρη)`);
      return c;
    });
    await writeAudit({ entity: "MANDATE", entityId: copy.id, action: "duplicate", changes: { from: m.reference }, actorId: actor.id, ...meta(request) });
    return { mandate: { id: copy.id, reference: copy.reference } };
  });

  app.post("/mandates/:id/notes", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const { id } = request.params as { id: string };
    await loadOwned(actor, id);
    const input = parseInput(noteSchema, request.body);
    await db().$transaction((tx) => event(tx, id, actor, "NOTE", input.text));
    return { ok: true };
  });

  /**
   * Signature provider callbacks. Public; the adapter verifies the vendor's
   * signature before reporting anything as handled. Without an adapter the
   * endpoint answers 404 and changes nothing.
   */
  app.post("/webhooks/signature", async (request, reply) => {
    const provider = await resolveSignatureProvider();
    const headers = Object.fromEntries(Object.entries(request.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : String(v ?? "")]));
    const result = await provider.handleWebhook(request.body, headers);
    if (!result.handled) return reply.code(404).send({ error: { code: "not_found", message: "Not found." } });
    if (result.envelopeId && result.status) {
      // A mandate's envelope, else a showing's or an extension's.
      if (!(await applySignatureStatus(result.envelopeId, result.status))) await applyDocumentSignatureStatus(db(), result.envelopeId, result.status);
    }
    return { ok: true };
  });
}
