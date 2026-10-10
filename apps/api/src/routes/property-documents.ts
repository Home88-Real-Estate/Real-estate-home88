/**
 * A property's legal/technical document checklist, and its "passport": one
 * summary of everything the CRM holds about the property, for its workspace.
 *
 * The checklist tracks documents; it never decides whether a property can be
 * sold. Anyone who may edit the property keeps the checklist; only a manager
 * (or above) marks a document verified or rejected, and that review is
 * recorded with who and when.
 *
 * If the database has not been migrated yet (table missing), the checklist
 * answers 503 with a clear message instead of failing the whole page.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { Prisma } from "@home88/database";
import {
  can, completeness, DOCUMENT_ITEM_KINDS, DOCUMENT_ITEM_STATUS_LABELS, DOCUMENT_ITEM_STATUSES, isDocumentKind, kindLabel, PERMISSIONS,
  REVIEW_STATUSES, suggestedDocuments, summarizeChecklist, type DocumentItemStatus,
} from "@home88/domain";

import { writeAudit } from "../lib/audit";
import { forbidden, HttpError, notFound } from "../lib/errors";
import { clientIp, parseInput, userAgent } from "../lib/http";
import { db } from "../lib/prisma";
import { readLocation } from "../lib/property-intake/location";
import { requireRole, roleAtLeast } from "../plugins/auth";
import { documentVisibleTo } from "./documents";

type Actor = { id: string; role: string; firstName: string; lastName: string; email: string };

const UNAVAILABLE = "Η λίστα εγγράφων χρειάζεται ενημέρωση της βάσης δεδομένων (migration 20261022000000_property_document_checklist). Τα υπόλοιπα στοιχεία του ακινήτου λειτουργούν κανονικά.";

/** The table is missing until the migration is applied: say so, do not fail the page. */
export function isMissingTable(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2021" || error.code === "P2022");
}
async function checklistGuard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isMissingTable(error)) throw new HttpError(503, "checklist_unavailable", UNAVAILABLE);
    throw error;
  }
}

const addSchema = z.object({ kind: z.string().refine(isDocumentKind, "Άγνωστο είδος εγγράφου."), label: z.string().trim().max(200).optional() });
const updateSchema = z.object({
  status: z.enum(DOCUMENT_ITEM_STATUSES as [DocumentItemStatus, ...DocumentItemStatus[]]).optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  documentId: z.string().max(40).nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
});

const meta = (request: FastifyRequest) => ({ ipAddress: clientIp(request), userAgent: userAgent(request) });
const nameOf = (u: { firstName: string; lastName: string } | null) => (u ? `${u.firstName} ${u.lastName}`.trim() : null);

async function loadProperty(id: string) {
  const property = await db().property.findUnique({ where: { id }, select: { id: true, agentId: true, createdById: true, listingType: true, propertyType: true, status: true } });
  if (!property) throw notFound("Το ακίνητο δεν βρέθηκε.");
  return property;
}

function itemView(item: { id: string; kind: string; label: string | null; status: string; note: string | null; expiresAt: Date | null; requestedAt: Date | null; reviewedAt: Date | null; updatedAt: Date; document: { id: string; title: string; mimeType: string; createdAt: Date } | null }, reviewer: string | null) {
  return {
    id: item.id,
    kind: item.kind,
    label: item.kind === "OTHER" && item.label ? item.label : kindLabel(item.kind),
    status: item.status,
    statusLabel: DOCUMENT_ITEM_STATUS_LABELS[item.status as DocumentItemStatus] ?? item.status,
    note: item.note,
    expiresAt: item.expiresAt,
    requestedAt: item.requestedAt,
    reviewedAt: item.reviewedAt,
    reviewedBy: reviewer,
    updatedAt: item.updatedAt,
    document: item.document,
  };
}

async function listItems(propertyId: string) {
  const items = await db().propertyDocumentItem.findMany({
    where: { propertyId },
    orderBy: [{ createdAt: "asc" }],
    include: { document: { select: { id: true, title: true, mimeType: true, createdAt: true } } },
  });
  const reviewerIds = [...new Set(items.map((i) => i.reviewedById).filter((x): x is string => Boolean(x)))];
  const reviewers = reviewerIds.length ? await db().user.findMany({ where: { id: { in: reviewerIds } }, select: { id: true, firstName: true, lastName: true } }) : [];
  return items.map((i) => itemView(i, nameOf(reviewers.find((r) => r.id === i.reviewedById) ?? null)));
}

export async function propertyDocumentRoutes(app: FastifyInstance): Promise<void> {
  const agent = { preHandler: requireRole("AGENT") };

  app.get("/properties/:id/document-checklist", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const { id } = request.params as { id: string };
    const property = await loadProperty(id);
    const items = await checklistGuard(() => listItems(id));
    const present = new Set(items.map((i) => i.kind));
    return {
      items,
      summary: summarizeChecklist(items),
      suggested: suggestedDocuments(property.listingType, property.propertyType).filter((s) => !present.has(s.kind)).map((s) => ({ ...s, label: kindLabel(s.kind) })),
      kinds: DOCUMENT_ITEM_KINDS.map((k) => ({ kind: k.kind, label: k.label, category: k.category })),
      statuses: DOCUMENT_ITEM_STATUSES.map((s) => ({ value: s, label: DOCUMENT_ITEM_STATUS_LABELS[s], review: REVIEW_STATUSES.includes(s) })),
      canEdit: can(actor, PERMISSIONS.PROPERTY_UPDATE, property),
      canReview: roleAtLeast(actor.role, "MANAGER"),
    };
  });

  /** Adds one item; a standard kind that is already listed is returned as it is (adding twice is harmless). */
  app.post("/properties/:id/document-checklist", agent, async (request, reply) => {
    const actor = request.auth!.user as Actor;
    const { id } = request.params as { id: string };
    const property = await loadProperty(id);
    if (!can(actor, PERMISSIONS.PROPERTY_UPDATE, property)) throw forbidden("Δεν μπορείτε να αλλάξετε αυτό το ακίνητο.");
    const input = parseInput(addSchema, request.body);
    const item = await checklistGuard(async () => {
      if (input.kind !== "OTHER") {
        const existing = await db().propertyDocumentItem.findFirst({ where: { propertyId: id, kind: input.kind } });
        if (existing) return existing;
      }
      return db().propertyDocumentItem.create({ data: { propertyId: id, kind: input.kind, label: input.kind === "OTHER" ? input.label || "Άλλο έγγραφο" : null, updatedById: actor.id } });
    });
    await writeAudit({ entity: "PROPERTY", entityId: id, action: "document_item_add", actorId: actor.id, changes: { kind: item.kind }, ...meta(request) });
    reply.code(201);
    return { items: await listItems(id) };
  });

  /** Adds every "usually needed" document the suggestion lists and the checklist does not have yet. */
  app.post("/properties/:id/document-checklist/suggested", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const { id } = request.params as { id: string };
    const property = await loadProperty(id);
    if (!can(actor, PERMISSIONS.PROPERTY_UPDATE, property)) throw forbidden("Δεν μπορείτε να αλλάξετε αυτό το ακίνητο.");
    const added = await checklistGuard(async () => {
      const present = new Set((await db().propertyDocumentItem.findMany({ where: { propertyId: id }, select: { kind: true } })).map((i) => i.kind));
      const todo = suggestedDocuments(property.listingType, property.propertyType).filter((s) => s.level === "usual" && !present.has(s.kind));
      if (todo.length) await db().propertyDocumentItem.createMany({ data: todo.map((s) => ({ propertyId: id, kind: s.kind, updatedById: actor.id })) });
      return todo.map((s) => s.kind);
    });
    if (added.length) await writeAudit({ entity: "PROPERTY", entityId: id, action: "document_items_suggested", actorId: actor.id, changes: { kinds: added }, ...meta(request) });
    return { items: await listItems(id), added };
  });

  app.patch("/properties/:id/document-checklist/:itemId", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const { id, itemId } = request.params as { id: string; itemId: string };
    const property = await loadProperty(id);
    if (!can(actor, PERMISSIONS.PROPERTY_UPDATE, property) && !roleAtLeast(actor.role, "MANAGER")) throw forbidden("Δεν μπορείτε να αλλάξετε αυτό το ακίνητο.");
    const input = parseInput(updateSchema, request.body);
    const manager = roleAtLeast(actor.role, "MANAGER");
    const before = await checklistGuard(() => db().propertyDocumentItem.findFirst({ where: { id: itemId, propertyId: id } }));
    if (!before) throw notFound("Το έγγραφο της λίστας δεν βρέθηκε.");

    const data: Prisma.PropertyDocumentItemUncheckedUpdateInput = { updatedById: actor.id };
    if (input.note !== undefined) data.note = input.note || null;
    if (input.expiresAt !== undefined) data.expiresAt = input.expiresAt;
    if (input.documentId !== undefined) {
      if (input.documentId) {
        // Only a document of this property that the agent may see.
        const doc = await db().document.findFirst({ where: { AND: [{ id: input.documentId, propertyId: id }, documentVisibleTo(actor)] }, select: { id: true } });
        if (!doc) throw new HttpError(422, "document_not_found", "Το έγγραφο δεν ανήκει σε αυτό το ακίνητο.");
      }
      data.documentId = input.documentId;
    }
    const nextStatus = input.status ?? (input.documentId && ["PENDING", "REQUESTED"].includes(before.status) ? "UPLOADED" : undefined);
    if (nextStatus && nextStatus !== before.status) {
      if (REVIEW_STATUSES.includes(nextStatus) && !manager) throw forbidden("Μόνο υπεύθυνος γραφείου (ή διαχειριστής) σημειώνει ένα έγγραφο ως επαληθευμένο ή απορριφθέν.");
      if (REVIEW_STATUSES.includes(before.status as DocumentItemStatus) && !manager) throw forbidden("Ένα ελεγμένο έγγραφο αλλάζει μόνο από υπεύθυνο γραφείου.");
      const hasDocument = input.documentId !== undefined ? Boolean(input.documentId) : Boolean(before.documentId);
      if (["UPLOADED", "IN_REVIEW", "VERIFIED"].includes(nextStatus) && !hasDocument) throw new HttpError(422, "document_required", "Ανεβάστε πρώτα το έγγραφο.");
      data.status = nextStatus;
      if (nextStatus === "REQUESTED") data.requestedAt = new Date();
      if (REVIEW_STATUSES.includes(nextStatus)) {
        data.reviewedById = actor.id;
        data.reviewedAt = new Date();
      }
    }
    await checklistGuard(() => db().propertyDocumentItem.update({ where: { id: itemId }, data }));
    await writeAudit({
      entity: "PROPERTY", entityId: id, action: "document_item_update", actorId: actor.id, ...meta(request),
      changes: { kind: before.kind, ...(data.status ? { status: { from: before.status, to: data.status } } : {}), ...(input.documentId !== undefined ? { documentLinked: Boolean(input.documentId) } : {}) },
    });
    return { items: await listItems(id) };
  });

  app.delete("/properties/:id/document-checklist/:itemId", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const { id, itemId } = request.params as { id: string; itemId: string };
    const property = await loadProperty(id);
    if (!can(actor, PERMISSIONS.PROPERTY_UPDATE, property)) throw forbidden("Δεν μπορείτε να αλλάξετε αυτό το ακίνητο.");
    const item = await checklistGuard(() => db().propertyDocumentItem.findFirst({ where: { id: itemId, propertyId: id } }));
    if (!item) throw notFound("Το έγγραφο της λίστας δεν βρέθηκε.");
    if (REVIEW_STATUSES.includes(item.status as DocumentItemStatus) && !roleAtLeast(actor.role, "MANAGER")) throw forbidden("Ένα ελεγμένο έγγραφο αφαιρείται μόνο από υπεύθυνο γραφείου.");
    // The document itself stays in Έγγραφα; only the checklist entry goes.
    await db().propertyDocumentItem.delete({ where: { id: itemId } });
    await writeAudit({ entity: "PROPERTY", entityId: id, action: "document_item_remove", actorId: actor.id, changes: { kind: item.kind }, ...meta(request) });
    return { items: await listItems(id) };
  });

  /**
   * Everything the property's workspace summarises, scoped like the lists it links to: leads are office-wide,
   * viewings, offers and mandates are the agent's own unless the actor is a manager, documents follow their own
   * visibility. Owners appear by name and reference only.
   */
  app.get("/properties/:id/passport", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const { id } = request.params as { id: string };
    const property = await db().property.findUnique({ where: { id } });
    if (!property) throw notFound("Το ακίνητο δεν βρέθηκε.");
    const manager = roleAtLeast(actor.role, "MANAGER");
    const now = new Date();

    const [owners, leadCount, leads, viewingCount, viewings, offerCount, offers, mandates, documentCount, media, intake, publication, portals, activity] = await Promise.all([
      db().propertyOwner.findMany({ where: { propertyId: id }, include: { contact: { select: { id: true, reference: true, firstName: true, lastName: true, company: true } } }, orderBy: [{ isPrimaryContact: "desc" }, { createdAt: "asc" }] }),
      db().lead.count({ where: { propertyId: id } }),
      db().lead.findMany({ where: { propertyId: id }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, reference: true, firstName: true, lastName: true, status: true, createdAt: true } }),
      db().viewing.count({ where: { propertyId: id, ...(manager ? {} : { agentId: actor.id }) } }),
      db().viewing.findMany({ where: { propertyId: id, ...(manager ? {} : { agentId: actor.id }) }, orderBy: { startsAt: "desc" }, take: 5, select: { id: true, clientName: true, startsAt: true, status: true } }),
      db().offer.count({ where: { propertyId: id, ...(manager ? {} : { agentId: actor.id }) } }),
      db().offer.findMany({ where: { propertyId: id, ...(manager ? {} : { agentId: actor.id }) }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, reference: true, amount: true, status: true, createdAt: true, transactionId: true } }),
      db().mandate.findMany({ where: { propertyId: id, ...(manager ? {} : { OR: [{ agentId: actor.id }, { createdById: actor.id }] }) }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, reference: true, number: true, type: true, status: true, startsAt: true, endsAt: true } }),
      db().document.count({ where: { AND: [{ propertyId: id }, documentVisibleTo(actor)] } }),
      db().propertyMedia.groupBy({ by: ["status"], where: { propertyId: id, lifecycle: "AVAILABLE" }, _count: { _all: true } }),
      db().propertyIntakeSession.findFirst({ where: { propertyId: id }, select: { id: true, userId: true, createdAt: true, state: true } }),
      db().websitePublication.findUnique({ where: { propertyId: id }, select: { status: true, enabled: true, visibility: true, lastPublishedAt: true } }),
      db().portalListing.groupBy({ by: ["state"], where: { propertyId: id }, _count: { _all: true } }),
      db().auditLog.findMany({ where: { entity: "PROPERTY", entityId: id }, orderBy: { createdAt: "desc" }, take: 15, select: { id: true, action: true, createdAt: true, actor: { select: { firstName: true, lastName: true } } } }),
    ]);

    let checklist: { available: true; summary: ReturnType<typeof summarizeChecklist> } | { available: false; message: string };
    try {
      checklist = { available: true, summary: summarizeChecklist(await db().propertyDocumentItem.findMany({ where: { propertyId: id }, select: { status: true } })) };
    } catch (error) {
      if (!isMissingTable(error)) throw error;
      checklist = { available: false, message: UNAVAILABLE };
    }

    const values = { ...(property as unknown as Record<string, unknown>), ...((property.details as Record<string, unknown> | null) ?? {}) };
    const filled = completeness(values);
    const mediaCount = (status: string) => media.find((m) => m.status === status)?._count._all ?? 0;
    // The exact point the agent recorded stays for the office; only the intake's own author or a manager sees it.
    const location = intake && (intake.userId === actor.id || manager) ? readLocation((intake.state as { location?: unknown } | null)?.location) : null;

    return {
      completeness: filled,
      owners: owners.map((o) => ({ id: o.id, contactId: o.contact.id, reference: o.contact.reference, name: `${o.contact.firstName} ${o.contact.lastName}`.trim() || o.contact.company || o.contact.reference, capacity: o.capacity, isPrimaryContact: o.isPrimaryContact })),
      leads: { count: leadCount, latest: leads.map((l) => ({ id: l.id, reference: l.reference, name: `${l.firstName ?? ""} ${l.lastName ?? ""}`.trim() || l.reference, status: l.status, createdAt: l.createdAt })) },
      viewings: { count: viewingCount, scope: manager ? "all" : "mine", upcoming: viewings.filter((v) => v.startsAt >= now).length, latest: viewings },
      offers: { count: offerCount, scope: manager ? "all" : "mine", latest: offers.map((o) => ({ ...o, amount: Number(o.amount) })) },
      mandates: { scope: manager ? "all" : "mine", items: mandates, signed: mandates.some((m) => m.status === "SIGNED" && (!m.endsAt || m.endsAt >= now)) },
      documents: { count: documentCount },
      checklist,
      // "approved" and "published" photos are both cleared for the public (same rule as the website's isPublicMedia).
      media: { approved: mediaCount("approved") + mediaCount("published"), pending: mediaCount("pending_review"), rejected: mediaCount("rejected"), total: media.reduce((a, m) => a + m._count._all, 0) },
      intake: intake ? { sessionId: intake.id, createdAt: intake.createdAt, location } : null,
      publication: { website: publication, onWebsite: property.publishedOnWebsite, portals: portals.map((p) => ({ state: p.state, count: p._count._all })) },
      activity: activity.map((a) => ({ id: a.id, action: a.action, createdAt: a.createdAt, actor: nameOf(a.actor) })),
    };
  });
}
