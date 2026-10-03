/**
 * Owner submissions, staff notifications and the media library.
 *
 * Everything a visitor uploaded is private: photos are shown to staff through
 * short-lived signed URLs minted here, documents only to the assigned agent or a
 * manager and every access is audited. No response ever carries a storage key
 * or a permanent URL.
 */

import { convertSubmission, setSubmissionStatus, SubmissionError, SUBMISSION_STATUSES, type SubmissionStatusValue } from "@home88/intake";
import type { Prisma } from "@home88/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { writeAudit } from "../lib/audit";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { clientIp, parseInput, userAgent } from "../lib/http";
import { intakeStorage } from "../lib/intake-storage";
import { decryptField } from "../lib/pii";
import { db } from "../lib/prisma";
import { requireRole, roleAtLeast } from "../plugins/auth";

type Actor = { id: string; role: string };

/** A manager sees everything; an agent sees what is theirs or still unassigned. */
function submissionScope(actor: Actor): Prisma.PropertySubmissionWhereInput {
  return roleAtLeast(actor.role, "MANAGER") ? {} : { OR: [{ assignedToId: actor.id }, { assignedToId: null }] };
}

function canAccess(actor: Actor, submission: { assignedToId: string | null }): boolean {
  return roleAtLeast(actor.role, "MANAGER") || submission.assignedToId === null || submission.assignedToId === actor.id;
}

/** Private documents are stricter: the assigned agent or a manager, never "anyone unassigned". */
function canOpenDocuments(actor: Actor, submission: { assignedToId: string | null }): boolean {
  return roleAtLeast(actor.role, "MANAGER") || submission.assignedToId === actor.id;
}

const listQuery = z.object({
  status: z.enum(SUBMISSION_STATUSES as unknown as [string, ...string[]]).optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const patchBody = z
  .object({
    status: z.enum(SUBMISSION_STATUSES as unknown as [string, ...string[]]).optional(),
    assignedToId: z.string().min(1).nullable().optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .strict();

const convertBody = z
  .object({
    mode: z.enum(["create", "link"]),
    propertyId: z.string().min(1).optional(),
    agentId: z.string().min(1).nullable().optional(),
    overrides: z
      .object({
        titleEl: z.string().trim().min(1).max(200).optional(),
        descriptionEl: z.string().trim().min(1).max(8000).optional(),
        price: z.number().nonnegative().nullable().optional(),
        area: z.number().nonnegative().nullable().optional(),
        bedrooms: z.number().int().nonnegative().nullable().optional(),
        city: z.string().trim().max(120).nullable().optional(),
        neighborhood: z.string().trim().max(120).nullable().optional(),
      })
      .strict()
      .optional(),
    mediaIds: z.array(z.string().min(1)).max(100).optional(),
  })
  .strict();

const mediaQuery = z.object({
  kind: z.enum(["PHOTO", "FLOOR_PLAN", "DOCUMENT"]).optional(),
  lifecycle: z.enum(["UPLOADING", "PROCESSING", "AVAILABLE", "QUARANTINED", "REJECTED", "DELETED"]).optional(),
  source: z.enum(["AGENT_UPLOAD", "OWNER_SUBMISSION", "IMPORT", "PORTAL", "MIGRATION", "OTHER"]).optional(),
  attached: z.enum(["yes", "no"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

function mapSubmissionError(error: unknown): never {
  if (error instanceof SubmissionError) {
    if (error.code === "NOT_FOUND" || error.code === "PROPERTY_NOT_FOUND") throw notFound(error.message);
    throw conflict(error.message);
  }
  throw error;
}

export async function submissionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/submissions", { preHandler: requireRole("AGENT") }, async (request) => {
    const actor = request.auth!.user;
    const q = parseInput(listQuery, request.query);
    const where: Prisma.PropertySubmissionWhereInput = {
      AND: [
        submissionScope(actor),
        q.status ? { status: q.status as SubmissionStatusValue } : {},
        q.q ? { OR: [{ reference: { contains: q.q.toUpperCase() } }, { titleEl: { contains: q.q, mode: "insensitive" } }, { city: { contains: q.q, mode: "insensitive" } }] } : {},
      ],
    };
    const [total, rows] = await Promise.all([
      db().propertySubmission.count({ where }),
      db().propertySubmission.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        include: {
          contact: { select: { reference: true, firstName: true, lastName: true } },
          assignedTo: { select: { id: true, firstName: true, lastName: true } },
          media: { select: { kind: true, lifecycle: true } },
          _count: { select: { documents: true } },
        },
      }),
    ]);
    return {
      total,
      page: q.page,
      data: rows.map((s) => ({
        id: s.id,
        reference: s.reference,
        kind: s.kind,
        status: s.status,
        owner: s.contact ? `${s.contact.firstName} ${s.contact.lastName}`.trim() : null,
        contactReference: s.contact?.reference ?? null,
        titleEl: s.titleEl,
        listingType: s.listingType,
        propertyType: s.propertyType,
        city: s.city,
        price: s.price === null ? null : Number(s.price),
        photos: s.media.filter((m) => m.kind === "PHOTO" && m.lifecycle === "AVAILABLE").length,
        heldPhotos: s.media.filter((m) => m.lifecycle === "QUARANTINED" || m.lifecycle === "REJECTED").length,
        documents: s._count.documents,
        assignedTo: s.assignedTo ? { id: s.assignedTo.id, name: `${s.assignedTo.firstName} ${s.assignedTo.lastName}`.trim() } : null,
        propertyId: s.propertyId,
        createdAt: s.createdAt.toISOString(),
      })),
    };
  });

  app.get("/submissions/:id", { preHandler: requireRole("AGENT") }, async (request) => {
    const actor = request.auth!.user;
    const { id } = request.params as { id: string };
    const s = await db().propertySubmission.findUnique({
      where: { id },
      include: {
        contact: true,
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        media: { orderBy: { sortOrder: "asc" } },
        documents: { orderBy: { createdAt: "asc" } },
        lead: { select: { reference: true, type: true, sourceChannel: true, landingPage: true, referrerHost: true, createdAt: true } },
      },
    });
    if (!s || !canAccess(actor, s)) throw notFound("Η υποβολή δεν βρέθηκε.");
    const documentsVisible = canOpenDocuments(actor, s);
    return {
      submission: {
        id: s.id,
        reference: s.reference,
        kind: s.kind,
        status: s.status,
        titleEl: s.titleEl,
        descriptionEl: s.descriptionEl,
        listingType: s.listingType,
        propertyType: s.propertyType,
        price: s.price === null ? null : Number(s.price),
        area: s.area === null ? null : Number(s.area),
        bedrooms: s.bedrooms,
        city: s.city,
        neighborhood: s.neighborhood,
        reviewNotes: s.reviewNotes,
        rejectedReason: s.rejectedReason,
        propertyId: s.propertyId,
        assignedTo: s.assignedTo ? { id: s.assignedTo.id, name: `${s.assignedTo.firstName} ${s.assignedTo.lastName}`.trim() } : null,
        createdAt: s.createdAt.toISOString(),
        lead: s.lead,
        contact: s.contact
          ? {
              id: s.contact.id,
              reference: s.contact.reference,
              name: `${s.contact.firstName} ${s.contact.lastName}`.trim(),
              email: decryptField(s.contact.emailEncrypted),
              phone: decryptField(s.contact.phoneEncrypted),
            }
          : null,
        // No storage keys and no URLs here: a thumbnail is fetched through the signed-URL endpoint below.
        photos: s.media.map((m) => ({
          id: m.id,
          lifecycle: m.lifecycle,
          status: m.status,
          note: m.processingNote,
          width: m.width,
          height: m.height,
          byteSize: m.byteSize,
          fileName: m.originalName,
          attached: m.propertyId !== null,
        })),
        documents: documentsVisible
          ? s.documents.map((d) => ({ id: d.id, title: d.title, lifecycle: d.lifecycle, mimeType: d.mimeType, byteSize: d.byteSize, note: d.processingNote }))
          : [],
        documentsHidden: !documentsVisible && s.documents.length > 0,
      },
    };
  });

  /** A staff-only, five-minute view of one submitted photo. */
  app.get("/submissions/:id/photos/:mediaId/url", { preHandler: requireRole("AGENT") }, async (request) => {
    const actor = request.auth!.user;
    const { id, mediaId } = request.params as { id: string; mediaId: string };
    const sub = await db().propertySubmission.findUnique({ where: { id }, select: { assignedToId: true } });
    if (!sub || !canAccess(actor, sub)) throw notFound("Η υποβολή δεν βρέθηκε.");
    const media = await db().propertyMedia.findFirst({ where: { id: mediaId, submissionId: id } });
    if (!media || media.lifecycle === "REJECTED" || media.lifecycle === "DELETED") throw notFound("Το αρχείο δεν βρέθηκε.");
    const variant = (request.query as { variant?: string }).variant;
    const key = variant === "thumbnail" && media.thumbnailKey ? media.thumbnailKey : variant === "preview" && media.previewKey ? media.previewKey : media.storageKey;
    return { url: await intakeStorage().signedGetUrl(key, 300), expiresInSeconds: 300 };
  });

  /** Private documents: stricter than photos, audited, and short-lived. */
  app.get("/submissions/:id/documents/:docId/url", { preHandler: requireRole("AGENT") }, async (request) => {
    const actor = request.auth!.user;
    const { id, docId } = request.params as { id: string; docId: string };
    const sub = await db().propertySubmission.findUnique({ where: { id }, select: { assignedToId: true } });
    if (!sub || !canAccess(actor, sub)) throw notFound("Η υποβολή δεν βρέθηκε.");
    if (!canOpenDocuments(actor, sub)) throw forbidden("Τα έγγραφα είναι διαθέσιμα στον ανατεθειμένο σύμβουλο ή σε υπεύθυνο.");
    const doc = await db().document.findFirst({ where: { id: docId, submissionId: id } });
    if (!doc || doc.lifecycle !== "AVAILABLE") throw notFound("Το έγγραφο δεν βρέθηκε.");
    await writeAudit({
      entity: "DOCUMENT",
      entityId: doc.id,
      action: "document.access",
      actorId: actor.id,
      ipAddress: clientIp(request),
      userAgent: userAgent(request),
      changes: { submissionId: id },
    });
    return { url: await intakeStorage().signedGetUrl(doc.storageKey, 120), expiresInSeconds: 120 };
  });

  app.patch("/submissions/:id", { preHandler: requireRole("AGENT") }, async (request) => {
    const actor = request.auth!.user;
    const { id } = request.params as { id: string };
    const body = parseInput(patchBody, request.body);
    const sub = await db().propertySubmission.findUnique({ where: { id }, select: { assignedToId: true } });
    if (!sub || !canAccess(actor, sub)) throw notFound("Η υποβολή δεν βρέθηκε.");
    // An agent may take an unassigned submission for themselves; handing it to someone else is a manager's call.
    if (body.assignedToId !== undefined && !roleAtLeast(actor.role, "MANAGER") && body.assignedToId !== actor.id && body.assignedToId !== null) {
      throw forbidden("Μόνο ένας υπεύθυνος μπορεί να αναθέσει σε άλλον σύμβουλο.");
    }
    try {
      const updated = body.status
        ? await setSubmissionStatus(db(), { submissionId: id, to: body.status as SubmissionStatusValue, actorId: actor.id, note: body.note ?? null, assignedToId: body.assignedToId })
        : await db().propertySubmission.update({ where: { id }, data: { ...(body.assignedToId !== undefined ? { assignedToId: body.assignedToId } : {}), ...(body.note ? { reviewNotes: body.note } : {}) } });
      return { submission: { id: updated.id, status: updated.status, assignedToId: updated.assignedToId } };
    } catch (error) {
      return mapSubmissionError(error);
    }
  });

  app.post("/submissions/:id/convert", { preHandler: requireRole("AGENT") }, async (request, reply) => {
    const actor = request.auth!.user;
    const { id } = request.params as { id: string };
    const body = parseInput(convertBody, request.body);
    const sub = await db().propertySubmission.findUnique({ where: { id }, select: { assignedToId: true } });
    if (!sub || !canAccess(actor, sub)) throw notFound("Η υποβολή δεν βρέθηκε.");
    if (body.mode === "link" && !body.propertyId) throw badRequest("Επιλέξτε το ακίνητο με το οποίο θα συνδεθεί.");
    try {
      const out = await convertSubmission(
        { prisma: db(), storage: intakeStorage() },
        {
          submissionId: id,
          actorId: actor.id,
          mode: body.mode === "link" ? { type: "link", propertyId: body.propertyId! } : { type: "create", overrides: body.overrides, agentId: body.agentId },
          mediaIds: body.mediaIds,
        },
      );
      reply.code(201);
      return { propertyId: out.propertyId, reference: out.reference, attachedPhotos: out.attachedPhotos };
    } catch (error) {
      return mapSubmissionError(error);
    }
  });

  // --- staff notifications ----------------------------------------------------

  app.get("/notifications", { preHandler: requireRole("AGENT") }, async (request) => {
    const actor = request.auth!.user;
    const unreadOnly = (request.query as { unread?: string }).unread === "1";
    const where: Prisma.CrmNotificationWhereInput = { OR: [{ userId: actor.id }, { userId: null }], ...(unreadOnly ? { readAt: null } : {}) };
    const [unread, rows] = await Promise.all([
      db().crmNotification.count({ where: { OR: [{ userId: actor.id }, { userId: null }], readAt: null } }),
      db().crmNotification.findMany({ where, orderBy: { createdAt: "desc" }, take: 50 }),
    ]);
    return { unread, data: rows.map((n) => ({ id: n.id, kind: n.kind, title: n.title, entityType: n.entityType, entityId: n.entityId, read: n.readAt !== null, createdAt: n.createdAt.toISOString() })) };
  });

  app.post("/notifications/read", { preHandler: requireRole("AGENT") }, async (request) => {
    const actor = request.auth!.user;
    const body = parseInput(z.object({ ids: z.array(z.string().min(1)).max(100).optional() }).strict(), request.body ?? {});
    const result = await db().crmNotification.updateMany({
      where: { OR: [{ userId: actor.id }, { userId: null }], readAt: null, ...(body.ids ? { id: { in: body.ids } } : {}) },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  });

  // --- media library ----------------------------------------------------------

  app.get("/media", { preHandler: requireRole("AGENT") }, async (request) => {
    const actor = request.auth!.user;
    const q = parseInput(mediaQuery, request.query);
    const manager = roleAtLeast(actor.role, "MANAGER");
    const scope: Prisma.PropertyMediaWhereInput = manager
      ? {}
      : { OR: [{ property: { agentId: actor.id } }, { submission: { OR: [{ assignedToId: actor.id }, { assignedToId: null }] } }] };
    const where: Prisma.PropertyMediaWhereInput = {
      AND: [
        scope,
        q.kind ? { kind: q.kind } : { kind: { not: "DOCUMENT" } },
        q.lifecycle ? { lifecycle: q.lifecycle } : {},
        q.source ? { source: q.source } : {},
        q.attached === "yes" ? { propertyId: { not: null } } : q.attached === "no" ? { propertyId: null } : {},
      ],
    };
    const [total, rows] = await Promise.all([
      db().propertyMedia.count({ where }),
      db().propertyMedia.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        include: { property: { select: { reference: true } }, submission: { select: { reference: true } } },
      }),
    ]);
    return {
      total,
      page: q.page,
      data: rows.map((m) => ({
        id: m.id,
        kind: m.kind,
        fileName: m.originalName,
        lifecycle: m.lifecycle,
        status: m.status,
        source: m.source,
        note: m.processingNote,
        width: m.width,
        height: m.height,
        byteSize: m.byteSize,
        propertyReference: m.property?.reference ?? null,
        propertyId: m.propertyId,
        submissionReference: m.submission?.reference ?? null,
        submissionId: m.submissionId,
        isPrimary: m.isPrimary,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  });
}
