/**
 * PublicLeadIntakeService — the one place a public form becomes CRM records.
 *
 * Every flow (assignment, valuation, buyer request, property enquiry, viewing
 * request, general contact) runs the same pipeline:
 *
 *   age gate → idempotency → validate → resolve contact → record consent →
 *   create lead (+ the flow's own record) → audit → staff notification
 *
 * and then, for flows that carry files, claims the uploads. Nothing here ever
 * creates a Property: an owner's submission is a draft for staff to review.
 *
 * Contacts are matched by normalised email first, then normalised phone, and
 * never merged on a guess: an uncertain match creates a flagged record for a
 * person to decide. A retried POST with the same idempotency key returns the
 * original reference and creates nothing.
 */

import { Prisma, type PrismaClient } from "@home88/database";
import { evaluateAgeGate, type AgeGateInput } from "@home88/validation";

import { sanitiseAttribution, type Attribution, type RawAttribution } from "./attribution";
import { DEFAULT_UPLOAD_LIMITS, type UploadLimits } from "./files";
import { normaliseEmail, normalisePhone } from "./normalise";
import type { PiiPort, StoragePort } from "./ports";
import { claimUploads, type ClaimResult, type UploadClaim } from "./claim-uploads";

export class IntakeValidationError extends Error {
  constructor(readonly fields: Record<string, string[]>) {
    super("Intake input is not valid.");
    this.name = "IntakeValidationError";
  }
}

export type IntakeConfig = {
  policyVersion: string;
  /** Hostnames of the public site itself, so internal navigation is not a referrer. */
  ownHosts?: string[];
  /** Configuration, not business rules: apply the legal/business policy before production. */
  leadRetentionMonths?: number;
  submissionRetentionMonths?: number;
  limits?: UploadLimits;
};

export type IntakeDeps = {
  prisma: PrismaClient;
  pii: PiiPort;
  /** Required only for flows that accept uploads. */
  storage?: StoragePort;
  config: IntakeConfig;
  now?: () => Date;
};

export type Person = {
  firstName: string;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  preferredContactMethod?: "PHONE" | "EMAIL" | "WHATSAPP" | "SMS" | "ANY";
  locale?: string;
};

export type RequestMeta = {
  /** Browser-generated key; the same key never creates a second record. */
  idempotencyKey?: string | null;
  attribution?: RawAttribution | null;
  /**
   * First-party channel label set by the server (never read from the browser),
   * e.g. "AI_ASSISTANT". It names where the enquiry came from, not who the
   * visitor is, so it is recorded without the analytics consent that UTM
   * campaign tags require.
   */
  sourceChannel?: string | null;
  ip: string;
  userAgent: string | null;
};

export type Consent = { marketing?: boolean; analytics?: boolean };

export type Base = {
  person: Person;
  age: AgeGateInput;
  /** Cookie/marketing choices; never inferred from the enquiry itself. */
  consent?: Consent;
  meta: RequestMeta;
};

export type Uploads = { token: string; files: UploadClaim[] };

export type IntakeOutcome =
  | { status: "created" | "replayed"; reference: string; uploads?: ClaimResult }
  | { status: "refused"; reason: string };

type Flow = "assignment" | "valuation" | "buyer_request" | "property_enquiry" | "viewing_request" | "contact";

const FLOW_META: Record<Flow, { leadType: string; role: "BUYER" | "SELLER" | "OTHER"; source: "WEBSITE" | "PROPERTY_ENQUIRY"; notify: { kind: string; title: string } }> = {
  assignment: { leadType: "SELLER_OWNER", role: "SELLER", source: "WEBSITE", notify: { kind: "new_assignment", title: "Νέα ανάθεση ακινήτου" } },
  valuation: { leadType: "SELLER_VALUATION", role: "SELLER", source: "WEBSITE", notify: { kind: "new_valuation", title: "Νέο αίτημα εκτίμησης" } },
  buyer_request: { leadType: "BUYER", role: "BUYER", source: "WEBSITE", notify: { kind: "new_buyer_request", title: "Νέα ζήτηση ακινήτου" } },
  property_enquiry: { leadType: "PROPERTY_ENQUIRY", role: "BUYER", source: "PROPERTY_ENQUIRY", notify: { kind: "new_property_enquiry", title: "Νέα ερώτηση για ακίνητο" } },
  viewing_request: { leadType: "BUYER_VIEWING", role: "BUYER", source: "PROPERTY_ENQUIRY", notify: { kind: "new_viewing_request", title: "Νέο αίτημα επίσκεψης" } },
  contact: { leadType: "GENERAL_INQUIRY", role: "OTHER", source: "WEBSITE", notify: { kind: "new_contact", title: "Νέο μήνυμα επικοινωνίας" } },
};

const addMonths = (date: Date, months: number) => {
  const d = new Date(date.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
};

async function allocate(tx: Prisma.TransactionClient, scope: string, prefix: string, width = 6): Promise<string> {
  const counter = await tx.referenceCounter.upsert({
    where: { scope },
    create: { scope, nextValue: 2 },
    update: { nextValue: { increment: 1 } },
    select: { nextValue: true },
  });
  return `${prefix}-${String(counter.nextValue - 1).padStart(width, "0")}`;
}

const text = (value: string | null | undefined, max: number) => {
  const cleaned = (value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁠﻿]/g, "").trim();
  return cleaned.length > 0 ? cleaned.slice(0, max) : null;
};

function validatePerson(person: Person): { email: string | null; phone: string | null } {
  const fields: Record<string, string[]> = {};
  if (!text(person.firstName, 80)) fields.firstName = ["Συμπληρώστε το όνομά σας."];
  const email = normaliseEmail(person.email);
  const phone = normalisePhone(person.phone);
  if (person.email && !email) fields.email = ["Μη έγκυρη διεύθυνση email."];
  if (person.phone && !phone) fields.phone = ["Μη έγκυρος αριθμός τηλεφώνου."];
  if (!email && !phone && !fields.email && !fields.phone) fields.email = ["Δώστε email ή τηλέφωνο για να επικοινωνήσουμε."];
  if (Object.keys(fields).length > 0) throw new IntakeValidationError(fields);
  return { email, phone };
}

type Common = {
  contactId: string;
  contactReference: string;
  attribution: Attribution;
  consentRecordId: string | null;
  suppressed: boolean;
  email: string | null;
  phone: string | null;
  possibleDuplicate: boolean;
};

type Built = { reference: string; leadId: string; leadReference: string; entityType: string; entityId: string; extra?: Record<string, unknown>; claim?: { submissionId: string; contactId: string } };

export class PublicLeadIntakeService {
  private readonly now: () => Date;
  private readonly limits: UploadLimits;

  constructor(private readonly deps: IntakeDeps) {
    this.now = deps.now ?? (() => new Date());
    this.limits = deps.config.limits ?? DEFAULT_UPLOAD_LIMITS;
  }

  // --- public flows ------------------------------------------------------------

  async createAssignmentSubmission(input: Base & { property: PropertyDraft; uploads?: Uploads }): Promise<IntakeOutcome> {
    return this.submission("assignment", input);
  }

  async createValuationRequest(input: Base & { property: PropertyDraft; uploads?: Uploads }): Promise<IntakeOutcome> {
    return this.submission("valuation", input);
  }

  async createBuyerRequest(input: Base & { request: BuyerCriteria }): Promise<IntakeOutcome> {
    const c = validateCriteria(input.request);
    return this.execute("buyer_request", input, async (tx, common) => {
      const reference = await allocate(tx, "request", "ZHT");
      const request = await tx.buyerRequest.create({
        data: {
          reference,
          listingType: c.listingType,
          propertyTypes: c.propertyTypes,
          areas: c.areas,
          minPrice: c.minPrice,
          maxPrice: c.maxPrice,
          minArea: c.minArea,
          maxArea: c.maxArea,
          minBedrooms: c.minBedrooms,
          minBathrooms: c.minBathrooms,
          minFloor: c.minFloor,
          minYearBuilt: c.minYearBuilt,
          features: c.features,
          notes: c.notes,
          clientName: fullName(input.person),
          clientEmail: common.email,
          clientPhone: common.phone,
          contactId: common.contactId,
        },
        select: { id: true, reference: true },
      });
      const lead = await this.createLead(tx, input, common, "buyer_request", {
        message: c.notes,
        budgetMin: c.minPrice,
        budgetMax: c.maxPrice,
        buyerRequestId: request.id,
      });
      return { reference: lead.reference, leadId: lead.id, leadReference: lead.reference, entityType: "REQUEST", entityId: request.id, extra: { request: request.reference } };
    });
  }

  async createPropertyInquiry(input: Base & { propertyReference: string; message?: string | null }): Promise<IntakeOutcome> {
    return this.execute("property_enquiry", input, async (tx, common) => {
      const property = await this.requireProperty(tx, input.propertyReference);
      const lead = await this.createLead(tx, input, common, "property_enquiry", { message: text(input.message, 4000), propertyId: property.id });
      return { reference: lead.reference, leadId: lead.id, leadReference: lead.reference, entityType: "LEAD", entityId: lead.id, extra: { property: property.reference } };
    });
  }

  async createViewingRequest(input: Base & { propertyReference: string; preferredStart?: string | null; message?: string | null }): Promise<IntakeOutcome> {
    const preferredStart = this.parsePreferredStart(input.preferredStart);
    return this.execute("viewing_request", input, async (tx, common) => {
      const property = await this.requireProperty(tx, input.propertyReference);
      const lead = await this.createLead(tx, input, common, "viewing_request", { message: text(input.message, 2000), propertyId: property.id });
      const reference = await allocate(tx, "viewing_request", "VR");
      // A request, never a viewing: an agent confirms it, which creates the Viewing.
      const vr = await tx.viewingRequest.create({
        data: { reference, propertyId: property.id, contactId: common.contactId, leadId: lead.id, preferredStart, note: text(input.message, 2000), status: "REQUESTED" },
        select: { id: true, reference: true },
      });
      return { reference: vr.reference, leadId: lead.id, leadReference: lead.reference, entityType: "VIEWING_REQUEST", entityId: vr.id, extra: { property: property.reference } };
    });
  }

  async createContactInquiry(input: Base & { subject?: string | null; message: string }): Promise<IntakeOutcome> {
    const message = text(input.message, 4000);
    if (!message) throw new IntakeValidationError({ message: ["Γράψτε το μήνυμά σας."] });
    const subject = text(input.subject, 200);
    return this.execute("contact", input, async (tx, common) => {
      const lead = await this.createLead(tx, input, common, "contact", { message: subject ? `Θέμα: ${subject}\n\n${message}` : message });
      return { reference: lead.reference, leadId: lead.id, leadReference: lead.reference, entityType: "LEAD", entityId: lead.id };
    });
  }

  // --- shared pipeline ---------------------------------------------------------

  private async submission(flow: "assignment" | "valuation", input: Base & { property: PropertyDraft; uploads?: Uploads }): Promise<IntakeOutcome> {
    const draft = validateDraft(input.property);
    return this.execute(
      flow,
      input,
      async (tx, common) => {
        const now = this.now();
        const lead = await this.createLead(tx, input, common, flow, { message: draftSummary(flow, draft) });
        const year = now.getUTCFullYear();
        const reference = await allocate(tx, `submission:${year}`, `SUB-${year}`);
        const submission = await tx.propertySubmission.create({
          data: {
            reference,
            kind: flow === "valuation" ? "VALUATION" : "ASSIGNMENT",
            status: "NEW",
            contactId: common.contactId,
            leadId: lead.id,
            ...draft,
            retentionExpiresAt: addMonths(now, this.deps.config.submissionRetentionMonths ?? 12),
          },
          select: { id: true, reference: true },
        });
        return {
          reference: submission.reference,
          leadId: lead.id,
          leadReference: lead.reference,
          entityType: "SUBMISSION",
          entityId: submission.id,
          extra: { submission: submission.reference },
          claim: { submissionId: submission.id, contactId: common.contactId },
        };
      },
      input.uploads,
    );
  }

  private async execute(flow: Flow, base: Base, build: (tx: Prisma.TransactionClient, common: Common) => Promise<Built>, uploads?: Uploads): Promise<IntakeOutcome> {
    const { prisma } = this.deps;

    // Age gate first, before the database is touched: a refusal writes nothing.
    const decision = evaluateAgeGate(base.age);
    if (!decision.eligible) return { status: "refused", reason: decision.reason };

    const contactFacts = validatePerson(base.person);
    const key = cleanKey(base.meta.idempotencyKey);

    if (key) {
      const replay = await this.replay(key, uploads);
      if (replay) return replay;
    }

    try {
      const built = await prisma.$transaction(async (tx) => {
        const common = await this.resolveCommon(tx, flow, base, contactFacts);
        const result = await build(tx, common);

        if (key) await tx.intakeReceipt.create({ data: { idempotencyKey: key, flow, reference: result.reference } });

        await tx.auditLog.create({
          data: {
            entity: "LEAD",
            entityId: result.leadId,
            action: `INTAKE_${flow.toUpperCase()}`,
            changes: {
              flow,
              leadType: FLOW_META[flow].leadType,
              source: common.attribution.sourceChannel ?? "website",
              landingPage: common.attribution.landingPage,
              ageGateMethod: decision.method,
              possibleDuplicate: common.possibleDuplicate,
              ...(result.extra ?? {}),
            },
            ipAddress: base.meta.ip === "unknown" ? null : base.meta.ip,
            userAgent: base.meta.userAgent,
          },
        });
        const meta = FLOW_META[flow];
        await tx.crmNotification.create({
          data: { kind: meta.notify.kind, title: meta.notify.title, entityType: result.entityType, entityId: result.entityId },
        });
        return { result, common };
      });

      let claimed: ClaimResult | undefined;
      if (built.result.claim && uploads) claimed = await this.claim(built.result.claim, uploads, built.common);
      return { status: "created", reference: built.result.reference, ...(claimed ? { uploads: claimed } : {}) };
    } catch (error) {
      // Two identical POSTs raced: the loser's transaction rolled back on the
      // unique receipt key, so the winner's reference is returned.
      if (key && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const replay = await this.replay(key, uploads);
        if (replay) return replay;
      }
      throw error;
    }
  }

  /** Same key, same answer; also finishes any upload claim a crashed first attempt left behind. */
  private async replay(key: string, uploads?: Uploads): Promise<IntakeOutcome | null> {
    const receipt = await this.deps.prisma.intakeReceipt.findUnique({ where: { idempotencyKey: key } });
    if (!receipt) return null;
    let claimed: ClaimResult | undefined;
    if (uploads && receipt.reference.startsWith("SUB-")) {
      const submission = await this.deps.prisma.propertySubmission.findUnique({ where: { reference: receipt.reference }, select: { id: true, contactId: true } });
      if (submission?.contactId) claimed = await this.claim({ submissionId: submission.id, contactId: submission.contactId }, uploads, null);
    }
    return { status: "replayed", reference: receipt.reference, ...(claimed ? { uploads: claimed } : {}) };
  }

  private async claim(target: { submissionId: string; contactId: string }, uploads: Uploads, _common: Common | null): Promise<ClaimResult | undefined> {
    if (!this.deps.storage) return undefined;
    return claimUploads(
      { prisma: this.deps.prisma, storage: this.deps.storage, limits: this.limits },
      { ...target, token: uploads.token, files: uploads.files },
    );
  }

  private async requireProperty(tx: Prisma.TransactionClient, reference: string) {
    const property = await tx.property.findUnique({ where: { reference: reference.trim().toUpperCase() }, select: { id: true, reference: true } });
    if (!property) throw new IntakeValidationError({ propertyReference: ["Το ακίνητο δεν βρέθηκε."] });
    return property;
  }

  private parsePreferredStart(raw: string | null | undefined): Date | null {
    if (!raw) return null;
    const date = new Date(raw);
    const now = this.now().getTime();
    if (Number.isNaN(date.getTime()) || date.getTime() < now - 60_000 || date.getTime() > now + 366 * 24 * 3600_000) {
      throw new IntakeValidationError({ preferredStart: ["Επιλέξτε μια μελλοντική ημερομηνία εντός του επόμενου έτους."] });
    }
    return date;
  }

  // --- contact, consent, lead --------------------------------------------------

  private async resolveCommon(tx: Prisma.TransactionClient, flow: Flow, base: Base, facts: { email: string | null; phone: string | null }): Promise<Common> {
    const { pii, config } = this.deps;
    const now = this.now();
    const { person } = base;
    const emailHash = pii.hashEmail(facts.email);
    const phoneHash = pii.hashPhone(facts.phone);
    const lastName = text(person.lastName, 80) ?? "";
    const role = FLOW_META[flow].role;

    const suppressed = emailHash ? await tx.emailSuppression.findUnique({ where: { emailHash }, select: { id: true } }) : null;

    const byEmail = emailHash ? await tx.contact.findFirst({ where: { emailHash }, select: { id: true, reference: true, lastName: true, roles: true, phoneHash: true, emailHash: true } }) : null;
    const byPhone = phoneHash ? await tx.contact.findFirst({ where: { phoneHash }, select: { id: true, reference: true, lastName: true, roles: true, phoneHash: true, emailHash: true } }) : null;

    let contact = byEmail;
    let possibleDuplicate = false;
    if (byEmail && byPhone && byEmail.id !== byPhone.id) {
      // Email says one person, phone says another. Email wins; a person decides.
      possibleDuplicate = true;
    } else if (!byEmail && byPhone) {
      const sameFamily = !lastName || !byPhone.lastName || lastName.toLowerCase() === byPhone.lastName.toLowerCase();
      if (sameFamily) contact = byPhone;
      else possibleDuplicate = true; // a shared number: do not guess, create and flag
    }

    if (contact) {
      const data: Prisma.ContactUpdateInput = {};
      // "OTHER" is only a placeholder for a contact whose purpose was unknown; a real role replaces it.
      if (role !== "OTHER" && !contact.roles.includes(role)) data.roles = [...contact.roles.filter((r) => r !== "OTHER"), role];
      if (!contact.phoneHash && phoneHash) Object.assign(data, { phoneHash, phoneEncrypted: pii.encrypt(facts.phone) });
      if (!contact.emailHash && emailHash) Object.assign(data, { emailHash, emailEncrypted: pii.encrypt(facts.email) });
      if (Object.keys(data).length > 0) await tx.contact.update({ where: { id: contact.id }, data });
    } else {
      const created = await tx.contact.create({
        data: {
          reference: await allocate(tx, "contact", "C"),
          firstName: text(person.firstName, 80)!,
          lastName,
          roles: [role],
          preferredContactMethod: person.preferredContactMethod ?? "ANY",
          preferredLocale: person.locale ?? "el",
          emailHash,
          emailEncrypted: pii.encrypt(facts.email),
          phoneHash,
          phoneEncrypted: pii.encrypt(facts.phone),
          retentionExpiresAt: addMonths(now, config.leadRetentionMonths ?? 24),
        },
        select: { id: true, reference: true, lastName: true, roles: true, phoneHash: true, emailHash: true },
      });
      contact = created;
    }

    if (possibleDuplicate) {
      const other = byEmail && byPhone && byEmail.id !== byPhone.id ? byPhone : byPhone;
      await tx.crmNotification.create({
        data: {
          kind: "possible_duplicate",
          title: "Πιθανό διπλότυπο επαφής",
          entityType: "CONTACT",
          entityId: contact.id,
        },
      });
      await tx.auditLog.create({
        data: {
          entity: "CONTACT",
          entityId: contact.id,
          action: "POSSIBLE_DUPLICATE",
          changes: { contact: contact.reference, other: other?.reference ?? null, matchedOn: byEmail ? "email" : "phone" },
          ipAddress: base.meta.ip === "unknown" ? null : base.meta.ip,
          userAgent: base.meta.userAgent,
        },
      });
    }

    // Two separate records: the enquiry is handled on its own footing, and
    // marketing is recorded only from the visitor's explicit choice.
    const subjectHash = pii.hashSubject(facts.email ?? facts.phone);
    let consentRecordId: string | null = null;
    if (subjectHash) {
      const common = {
        subjectHash,
        email: facts.email,
        policyVersion: config.policyVersion,
        source: `website:${flow}`,
        ipAddress: base.meta.ip === "unknown" ? null : base.meta.ip,
        userAgent: base.meta.userAgent,
      };
      await tx.consentRecord.create({
        data: { ...common, purpose: flow === "property_enquiry" || flow === "viewing_request" ? "PROPERTY_ENQUIRY" : "NECESSARY", granted: true, grantedAt: now },
      });
      if (base.consent) {
        const marketing = await tx.consentRecord.create({
          data: { ...common, purpose: "MARKETING", granted: base.consent.marketing === true, grantedAt: base.consent.marketing ? now : null, revokedAt: base.consent.marketing ? null : now },
          select: { id: true },
        });
        consentRecordId = marketing.id;
      }
    }

    return {
      contactId: contact.id,
      contactReference: contact.reference,
      attribution: (() => {
        const a = sanitiseAttribution(base.meta.attribution, { allowCampaign: base.consent?.analytics === true, ownHosts: config.ownHosts });
        return base.meta.sourceChannel ? { ...a, sourceChannel: base.meta.sourceChannel.slice(0, 40) } : a;
      })(),
      consentRecordId,
      suppressed: Boolean(suppressed),
      email: facts.email,
      phone: facts.phone,
      possibleDuplicate,
    };
  }

  private async createLead(
    tx: Prisma.TransactionClient,
    base: Base,
    common: Common,
    flow: Flow,
    extra: { message?: string | null; budgetMin?: number | null; budgetMax?: number | null; propertyId?: string; buyerRequestId?: string },
  ) {
    const now = this.now();
    const a = common.attribution;
    return tx.lead.create({
      data: {
        reference: await allocate(tx, "lead", "H88"),
        firstName: text(base.person.firstName, 80)!,
        lastName: text(base.person.lastName, 80),
        email: common.email,
        phone: common.phone,
        message: extra.message ?? null,
        status: "NEW",
        type: FLOW_META[flow].leadType as never,
        source: FLOW_META[flow].source,
        sourceChannel: a.sourceChannel,
        sourceUrl: a.landingPage,
        landingPage: a.landingPage,
        referrerHost: a.referrerHost,
        utmSource: a.utmSource,
        utmMedium: a.utmMedium,
        utmCampaign: a.utmCampaign,
        preferredContactMethod: base.person.preferredContactMethod ?? "ANY",
        locale: base.person.locale ?? "el",
        budgetMin: extra.budgetMin ?? null,
        budgetMax: extra.budgetMax ?? null,
        propertyId: extra.propertyId ?? null,
        buyerRequestId: extra.buyerRequestId ?? null,
        contactId: common.contactId,
        consentRecordId: common.consentRecordId,
        marketingOptOutAt: common.suppressed ? now : null,
        retentionExpiresAt: addMonths(now, this.deps.config.leadRetentionMonths ?? 24),
        ageVerifiedAt: now,
        ageVerificationFail: false,
        // No assignedToId: a new public lead is UNASSIGNED until routing or a manager decides.
      },
      select: { id: true, reference: true },
    });
  }
}

// --- input shapes and their validation ---------------------------------------

export type PropertyDraft = {
  titleEl: string;
  descriptionEl: string;
  listingType: "SALE" | "RENT" | "ASSIGNMENT";
  propertyType: string;
  price?: number | null;
  area?: number | null;
  bedrooms?: number | null;
  city?: string | null;
  neighborhood?: string | null;
};

export type BuyerCriteria = {
  listingType: "SALE" | "RENT";
  propertyTypes?: string[];
  areas?: string[];
  minPrice?: number | null;
  maxPrice?: number | null;
  minArea?: number | null;
  maxArea?: number | null;
  minBedrooms?: number | null;
  minBathrooms?: number | null;
  minFloor?: number | null;
  minYearBuilt?: number | null;
  features?: string[];
  notes?: string | null;
};

const PROPERTY_TYPES = ["APARTMENT", "MAISONETTE", "HOUSE", "VILLA", "STUDIO", "OFFICE", "SHOP", "WAREHOUSE", "BUILDING", "HOTEL", "LAND", "PLOT", "PARKING", "INDUSTRIAL", "OTHER"];

function nonNeg(value: number | null | undefined, field: string, fields: Record<string, string[]>, max = 1e10): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0 || value > max) {
    fields[field] = ["Μη έγκυρη τιμή."];
    return null;
  }
  return value;
}

function validateDraft(d: PropertyDraft) {
  const fields: Record<string, string[]> = {};
  const titleEl = text(d.titleEl, 200);
  const descriptionEl = text(d.descriptionEl, 8000);
  if (!titleEl) fields.titleEl = ["Συμπληρώστε έναν τίτλο."];
  if (!descriptionEl) fields.descriptionEl = ["Συμπληρώστε μια περιγραφή."];
  if (!["SALE", "RENT", "ASSIGNMENT"].includes(d.listingType)) fields.listingType = ["Επιλέξτε πώληση, ενοικίαση ή ανάθεση."];
  if (!PROPERTY_TYPES.includes(d.propertyType)) fields.propertyType = ["Επιλέξτε τύπο ακινήτου."];
  const price = nonNeg(d.price, "price", fields);
  const area = nonNeg(d.area, "area", fields, 1e7);
  const bedrooms = nonNeg(d.bedrooms, "bedrooms", fields, 50);
  if (Object.keys(fields).length > 0) throw new IntakeValidationError(fields);
  return {
    titleEl: titleEl!,
    descriptionEl: descriptionEl!,
    listingType: d.listingType,
    propertyType: d.propertyType as never,
    price,
    area,
    bedrooms: bedrooms === null ? null : Math.trunc(bedrooms),
    city: text(d.city, 120),
    neighborhood: text(d.neighborhood, 120),
  };
}

function validateCriteria(c: BuyerCriteria) {
  const fields: Record<string, string[]> = {};
  if (c.listingType !== "SALE" && c.listingType !== "RENT") fields.listingType = ["Επιλέξτε αγορά ή ενοικίαση."];
  const propertyTypes = (c.propertyTypes ?? []).filter((t) => PROPERTY_TYPES.includes(t));
  const minPrice = nonNeg(c.minPrice, "minPrice", fields);
  const maxPrice = nonNeg(c.maxPrice, "maxPrice", fields);
  const minArea = nonNeg(c.minArea, "minArea", fields, 1e7);
  const maxArea = nonNeg(c.maxArea, "maxArea", fields, 1e7);
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) fields.maxPrice = ["Ο μέγιστος προϋπολογισμός είναι μικρότερος από τον ελάχιστο."];
  if (minArea !== null && maxArea !== null && minArea > maxArea) fields.maxArea = ["Το μέγιστο εμβαδόν είναι μικρότερο από το ελάχιστο."];
  const int = (v: number | null | undefined, name: string, max: number) => {
    const n = nonNeg(v, name, fields, max);
    return n === null ? null : Math.trunc(n);
  };
  const out = {
    listingType: c.listingType,
    propertyTypes: propertyTypes as never[],
    areas: (c.areas ?? []).map((a) => text(a, 120)).filter((a): a is string => Boolean(a)).slice(0, 20),
    minPrice,
    maxPrice,
    minArea,
    maxArea,
    minBedrooms: int(c.minBedrooms, "minBedrooms", 50),
    minBathrooms: int(c.minBathrooms, "minBathrooms", 50),
    minFloor: int(c.minFloor, "minFloor", 200),
    minYearBuilt: int(c.minYearBuilt, "minYearBuilt", 2200),
    features: (c.features ?? []).filter((f) => /^[a-zA-Z][a-zA-Z0-9_]{1,40}$/.test(f)).slice(0, 30),
    notes: text(c.notes, 4000),
  };
  if (Object.keys(fields).length > 0) throw new IntakeValidationError(fields);
  return out;
}

function draftSummary(flow: "assignment" | "valuation", d: ReturnType<typeof validateDraft>): string {
  return [
    `${flow === "valuation" ? "Αίτημα εκτίμησης" : "Ανάθεση ακινήτου"}: ${d.titleEl}`,
    `Τύπος: ${d.listingType} / ${d.propertyType}`,
    d.city ? `Περιοχή: ${d.city}${d.neighborhood ? `, ${d.neighborhood}` : ""}` : null,
    d.price !== null ? `Επιθυμητή τιμή: ${d.price} €` : null,
    d.area !== null ? `Εμβαδόν: ${d.area} τ.μ.` : null,
    d.bedrooms !== null ? `Υπνοδωμάτια: ${d.bedrooms}` : null,
    "",
    d.descriptionEl,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

const fullName = (p: Person) => [text(p.firstName, 80), text(p.lastName, 80)].filter(Boolean).join(" ");

function cleanKey(key: string | null | undefined): string | null {
  return key && /^[A-Za-z0-9_-]{8,100}$/.test(key) ? key : null;
}
