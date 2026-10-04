/**
 * CRM-side handling of owner submissions: review workflow, conversion to a
 * property, rejection.
 *
 * Converting never copies a file twice and never publishes anything. Photos are
 * *moved* from the private `submissions/` prefix to the property's own prefix
 * (the only prefix the public bucket policy exposes), their existing rows are
 * re-pointed at the property, and they stay `pending_review` until staff
 * approve them. Documents stay CRM-private; they are only linked to the
 * property so staff can find them.
 */

import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@home88/database";

import { variantStorageKey } from "./imaging";
import type { StoragePort } from "./ports";

export const SUBMISSION_STATUSES = [
  "NEW", "UNDER_REVIEW", "CONTACTED", "VALUATION", "ASSIGNMENT", "PROPERTY_CREATED", "APPROVED", "PUBLISHED", "REJECTED", "ARCHIVED",
] as const;
export type SubmissionStatusValue = (typeof SUBMISSION_STATUSES)[number];

/**
 * PROPERTY_CREATED is reachable only through `convertSubmission`, and
 * PUBLISHED only when the linked property really is public: a status label must
 * never say something the data does not.
 */
const NEXT: Record<SubmissionStatusValue, readonly SubmissionStatusValue[]> = {
  NEW: ["UNDER_REVIEW", "CONTACTED", "REJECTED", "ARCHIVED"],
  UNDER_REVIEW: ["CONTACTED", "VALUATION", "ASSIGNMENT", "REJECTED", "ARCHIVED"],
  CONTACTED: ["UNDER_REVIEW", "VALUATION", "ASSIGNMENT", "REJECTED", "ARCHIVED"],
  VALUATION: ["CONTACTED", "ASSIGNMENT", "REJECTED", "ARCHIVED"],
  ASSIGNMENT: ["VALUATION", "REJECTED", "ARCHIVED"],
  PROPERTY_CREATED: ["APPROVED", "ARCHIVED"],
  APPROVED: ["PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["ARCHIVED"],
  REJECTED: ["UNDER_REVIEW", "ARCHIVED"],
  ARCHIVED: [],
};

export function canTransition(from: SubmissionStatusValue, to: SubmissionStatusValue): boolean {
  return NEXT[from]?.includes(to) ?? false;
}

export class SubmissionError extends Error {
  constructor(readonly code: "NOT_FOUND" | "BAD_TRANSITION" | "ALREADY_CONVERTED" | "NOT_CONVERTIBLE" | "PROPERTY_NOT_FOUND" | "NOT_PUBLIC", message: string) {
    super(message);
    this.name = "SubmissionError";
  }
}

const PUBLIC_CACHE = "public, max-age=31536000, immutable";

function slugFrom(title: string, reference: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9Ͱ-Ͽ]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base ? `${base}-${reference.toLowerCase()}` : reference.toLowerCase();
}

async function allocate(tx: Prisma.TransactionClient, scope: string, prefix: string): Promise<string> {
  const counter = await tx.referenceCounter.upsert({ where: { scope }, create: { scope, nextValue: 2 }, update: { nextValue: { increment: 1 } } });
  return `${prefix}-${String(counter.nextValue - 1).padStart(6, "0")}`;
}

export async function setSubmissionStatus(
  prisma: PrismaClient,
  input: { submissionId: string; to: SubmissionStatusValue; actorId: string; note?: string | null; assignedToId?: string | null },
) {
  const current = await prisma.propertySubmission.findUnique({ where: { id: input.submissionId }, include: { property: { select: { status: true, publishedOnWebsite: true } } } });
  if (!current) throw new SubmissionError("NOT_FOUND", "Η υποβολή δεν βρέθηκε.");
  if (current.status !== input.to) {
    if (input.to === "PROPERTY_CREATED") throw new SubmissionError("BAD_TRANSITION", "Το ακίνητο δημιουργείται μέσω μετατροπής της υποβολής.");
    if (!canTransition(current.status, input.to)) throw new SubmissionError("BAD_TRANSITION", `Δεν επιτρέπεται η μετάβαση ${current.status} → ${input.to}.`);
    if (input.to === "PUBLISHED" && !(current.property?.publishedOnWebsite && current.property.status === "ACTIVE")) {
      throw new SubmissionError("NOT_PUBLIC", "Το ακίνητο δεν είναι δημοσιευμένο στον ιστότοπο.");
    }
  }
  return prisma.$transaction(async (tx) => {
    const updated = await tx.propertySubmission.update({
      where: { id: input.submissionId },
      data: {
        status: input.to,
        ...(input.to === "REJECTED" ? { rejectedReason: input.note ?? null } : {}),
        ...(input.note && input.to !== "REJECTED" ? { reviewNotes: input.note } : {}),
        ...(input.assignedToId !== undefined ? { assignedToId: input.assignedToId } : {}),
      },
    });
    await tx.auditLog.create({
      data: { entity: "PROPERTY", entityId: current.propertyId ?? updated.id, action: "submission.status", actorId: input.actorId, changes: { submission: updated.reference, from: current.status, to: input.to } },
    });
    return updated;
  });
}

export type ConvertInput = {
  submissionId: string;
  actorId: string;
  mode: { type: "create"; overrides?: Partial<{ titleEl: string; descriptionEl: string; price: number | null; area: number | null; bedrooms: number | null; city: string | null; neighborhood: string | null }>; agentId?: string | null } | { type: "link"; propertyId: string };
  /** Photos to attach; defaults to every available photo. Never documents. */
  mediaIds?: string[];
};

export async function convertSubmission(deps: { prisma: PrismaClient; storage: StoragePort; now?: () => Date }, input: ConvertInput) {
  const { prisma, storage } = deps;
  const now = (deps.now ?? (() => new Date()))();

  const submission = await prisma.propertySubmission.findUnique({ where: { id: input.submissionId }, include: { media: true, documents: true } });
  if (!submission) throw new SubmissionError("NOT_FOUND", "Η υποβολή δεν βρέθηκε.");
  if (submission.propertyId) throw new SubmissionError("ALREADY_CONVERTED", "Η υποβολή έχει ήδη συνδεθεί με ακίνητο.");
  if (["REJECTED", "ARCHIVED"].includes(submission.status)) throw new SubmissionError("NOT_CONVERTIBLE", "Η υποβολή έχει απορριφθεί ή αρχειοθετηθεί.");

  if (input.mode.type === "link") {
    const exists = await prisma.property.findUnique({ where: { id: input.mode.propertyId }, select: { id: true } });
    if (!exists) throw new SubmissionError("PROPERTY_NOT_FOUND", "Το ακίνητο δεν βρέθηκε.");
  }

  // Only photos that finished processing and belong to this submission, never a document.
  const photos = submission.media
    .filter((m) => m.kind === "PHOTO" && m.lifecycle === "AVAILABLE" && !m.propertyId)
    .filter((m) => !input.mediaIds || input.mediaIds.includes(m.id))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  // The property id is needed for the new keys, so it is chosen before anything moves.
  let propertyId = input.mode.type === "link" ? input.mode.propertyId : null;
  let reference: string | null = null;

  // Move first, commit second, delete last: a failure leaves the originals usable.
  const moves: Array<{ id: string; storageKey: string; previewKey: string | null; thumbnailKey: string | null; sources: string[] }> = [];
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");

  let result: { propertyId: string; reference: string | null };
  try {
    result = await prisma.$transaction(async (tx) => {
    if (input.mode.type === "create") {
      const o = input.mode.overrides ?? {};
      reference = await allocate(tx, "property", "H88");
      const titleEl = o.titleEl ?? submission.titleEl;
      const created = await tx.property.create({
        data: {
          reference,
          slug: slugFrom(titleEl, reference),
          listingType: submission.listingType,
          propertyType: submission.propertyType,
          status: "DRAFT",
          titleEl,
          descriptionEl: o.descriptionEl ?? submission.descriptionEl,
          price: o.price !== undefined ? o.price : submission.price,
          area: o.area !== undefined ? o.area : submission.area,
          bedrooms: o.bedrooms !== undefined ? o.bedrooms : submission.bedrooms,
          city: o.city !== undefined ? o.city : submission.city,
          neighborhood: o.neighborhood !== undefined ? o.neighborhood : submission.neighborhood,
          publishedOnWebsite: false,
          ownerId: submission.contactId,
          agentId: input.mode.agentId ?? input.actorId,
          createdById: input.actorId,
        },
        select: { id: true, reference: true },
      });
      propertyId = created.id;
      await tx.propertyStatusHistory.create({ data: { propertyId, fromStatus: null, toStatus: "DRAFT", actorId: input.actorId } });
    }

    const targetId = propertyId!;
    const last = await tx.propertyMedia.aggregate({ where: { propertyId: targetId }, _max: { sortOrder: true } });
    let order = (last._max.sortOrder ?? -1) + 1;

    for (const photo of photos) {
      const ext = photo.storageKey.match(/\.([a-z0-9]{1,8})$/i)?.[1] ?? "jpg";
      const newKey = `properties/${targetId}/photo/${yyyy}/${mm}/${randomUUID()}.${ext}`;
      const sources = [photo.storageKey];
      await storage.copy(photo.storageKey, newKey, { cacheControl: PUBLIC_CACHE });
      let previewKey: string | null = null;
      let thumbnailKey: string | null = null;
      for (const variant of ["thumbnail", "card", "medium", "large"] as const) {
        const from = variantStorageKey(photo.storageKey, variant);
        const to = variantStorageKey(newKey, variant);
        // A variant that never made it (older row) is skipped, not fatal.
        if (await storage.head(from)) {
          await storage.copy(from, to, { cacheControl: PUBLIC_CACHE });
          sources.push(from);
          if (variant === "medium") previewKey = to;
          if (variant === "thumbnail") thumbnailKey = to;
        }
      }
      moves.push({ id: photo.id, storageKey: newKey, previewKey, thumbnailKey, sources });
      await tx.propertyMedia.update({
        where: { id: photo.id },
        data: { propertyId: targetId, storageKey: newKey, previewKey, thumbnailKey, sortOrder: order++, isPrimary: false, status: "pending_review" },
      });
    }

    // Documents stay private; linking only lets staff find them from the property.
    await tx.document.updateMany({ where: { submissionId: submission.id, lifecycle: "AVAILABLE", propertyId: null }, data: { propertyId: targetId } });

    await tx.propertySubmission.update({
      where: { id: submission.id },
      data: { propertyId: targetId, status: "PROPERTY_CREATED" },
    });
    await tx.auditLog.create({
      data: {
        entity: "PROPERTY",
        entityId: targetId,
        action: input.mode.type === "create" ? "submission.convert" : "submission.link",
        actorId: input.actorId,
        changes: { submission: submission.reference, reference, photos: moves.length, mode: input.mode.type },
      },
    });
    return { propertyId: targetId, reference };
    }, { timeout: 120_000, maxWait: 10_000 });
  } catch (error) {
    // The rows were not updated, so the quarantine originals are still the real
    // files. Remove the copies made for this attempt rather than leave orphans.
    for (const move of moves) {
      for (const key of [move.storageKey, ...(["thumbnail", "card", "medium", "large"] as const).map((v) => variantStorageKey(move.storageKey, v))]) {
        await storage.delete(key).catch(() => undefined);
      }
    }
    throw error;
  }

  // The rows now point at the new keys; only now are the quarantine copies removed.
  for (const move of moves) for (const key of move.sources) await storage.delete(key).catch(() => undefined);

  return { ...result, attachedPhotos: moves.length };
}
