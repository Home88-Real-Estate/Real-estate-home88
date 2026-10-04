/**
 * Documents (Έγγραφα): private files linked to properties, contacts and
 * transactions, plus the PDFs and signed copies of mandates.
 *
 *  - Upload is direct to storage: the API issues a signed upload URL and a
 *    token binding the key to the user; confirming checks the size, sniffs
 *    the first bytes against the declared type and records a SHA-256.
 *  - Downloads are short-lived signed links, issued after a permission check
 *    and written to the audit log (documents often hold personal data).
 *  - A document that is a mandate's PDF or signed copy cannot be deleted.
 *
 * Visibility: managers and above see every document; others see the ones
 * they uploaded, or that belong to their properties, transactions or mandates.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { Prisma } from "@home88/database";
import { DOCUMENT_CATEGORY_LABELS, DOCUMENT_TYPES, sniffMatches } from "@home88/domain";

import { loadConfig } from "../config";
import { writeAudit } from "../lib/audit";
import { documentKey, documentStore, isDocumentKey, sha256 } from "../lib/document-store";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { clientIp, parseInput, userAgent } from "../lib/http";
import { db } from "../lib/prisma";
import { requireRole, roleAtLeast } from "../plugins/auth";

type Actor = { id: string; role: string; firstName: string; lastName: string; email: string };

const CATEGORIES = ["CONTRACT", "DEED", "ID_VERIFICATION", "TAX", "INSPECTION", "APPRAISAL", "INVOICE", "MANDATE", "OTHER"] as const;
const TOKEN_TTL_MS = 30 * 60 * 1000;

const uploadSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.string().refine((t) => t in DOCUMENT_TYPES, "Επιτρέπονται PDF, JPG, PNG και DOCX."),
  byteSize: z.coerce.number().int().positive(),
});

const optionalId = z.string().max(40).optional().or(z.literal("")).transform((v) => (v ? v : null));
const confirmSchema = z.object({
  token: z.string().min(10).max(600),
  title: z.string().trim().min(1, "Συμπληρώστε τίτλο.").max(200),
  category: z.enum(CATEGORIES).default("OTHER"),
  propertyId: optionalId,
  contactId: optionalId,
  transactionId: optionalId,
  checklistItemId: optionalId,
  containsPersonalData: z.boolean().default(false),
});

const listSchema = z.object({
  propertyId: z.string().max(40).optional(),
  contactId: z.string().max(40).optional(),
  transactionId: z.string().max(40).optional(),
  category: z.enum(CATEGORIES).optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

function secret(): string {
  const s = loadConfig().JWT_SECRET;
  if (!s) throw conflict("Οι μεταφορτώσεις απαιτούν JWT_SECRET στον server.");
  return s;
}

/** `key.userId.expiry.mime.size.hmac` — binds an upload to its uploader and declared file. */
export function signUpload(key: string, userId: string, mimeType: string, byteSize: number, now = Date.now()): string {
  const body = [key, userId, String(now + TOKEN_TTL_MS), Buffer.from(mimeType).toString("base64url"), String(byteSize)].join(".");
  const mac = createHmac("sha256", secret()).update(`document-upload:${body}`).digest("base64url");
  return `${Buffer.from(body).toString("base64url")}.${mac}`;
}

export function verifyUpload(token: string, userId: string, now = Date.now()): { key: string; mimeType: string; byteSize: number } {
  const [bodyB64, mac] = token.split(".");
  if (!bodyB64 || !mac) throw badRequest("Μη έγκυρη μεταφόρτωση.");
  const body = Buffer.from(bodyB64, "base64url").toString();
  const expected = createHmac("sha256", secret()).update(`document-upload:${body}`).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw badRequest("Μη έγκυρη μεταφόρτωση.");
  // The key contains dots (extension), so read the fixed fields from the end.
  const parts = body.split(".");
  const byteSize = Number(parts.pop());
  const mimeType = Buffer.from(parts.pop() ?? "", "base64url").toString();
  const expiry = Number(parts.pop());
  const owner = parts.pop();
  const key = parts.join(".");
  if (owner !== userId) throw forbidden("Η μεταφόρτωση ανήκει σε άλλον χρήστη.");
  if (!(expiry > now)) throw badRequest("Η μεταφόρτωση έληξε. Ανεβάστε ξανά το αρχείο.");
  if (!isDocumentKey(key)) throw badRequest("Μη έγκυρη μεταφόρτωση.");
  return { key, mimeType, byteSize };
}

/**
 * Only processed files are ever listed or downloaded: owner uploads from the
 * public site stay out until the intake pipeline marks them AVAILABLE.
 */
export function documentVisibleTo(actor: Actor): Prisma.DocumentWhereInput {
  if (roleAtLeast(actor.role, "MANAGER")) return { lifecycle: "AVAILABLE" };
  return {
    lifecycle: "AVAILABLE",
    OR: [
      { uploadedById: actor.id },
      { property: { agentId: actor.id } },
      { transaction: { OR: [{ agentId: actor.id }, { createdById: actor.id }] } },
      { mandatePdfOf: { agentId: actor.id } },
      { mandateSignedOf: { agentId: actor.id } },
    ],
  };
}

function meta(request: FastifyRequest) {
  return { ipAddress: clientIp(request), userAgent: userAgent(request) };
}

function requireStore() {
  const store = documentStore();
  if (!store.configured()) throw conflict("Η αποθήκευση αρχείων (S3) δεν έχει ρυθμιστεί στον server.");
  return store;
}

/**
 * Check an uploaded object against its token and store it as a Document.
 * Shared by plain uploads and mandate signed copies.
 */
export async function confirmUpload(
  actor: Actor,
  token: string,
  data: Omit<Prisma.DocumentUncheckedCreateInput, "storageKey" | "mimeType" | "byteSize" | "checksum" | "uploadedById">,
  tx: Prisma.TransactionClient = db(),
) {
  const store = requireStore();
  const { key, mimeType, byteSize } = verifyUpload(token, actor.id);
  const head = await store.head(key);
  if (!head) throw badRequest("Το αρχείο δεν ανέβηκε. Δοκιμάστε ξανά.");
  if (head.byteSize !== byteSize) throw badRequest("Το μέγεθος του αρχείου δεν ταιριάζει με αυτό που δηλώθηκε.");
  const body = await store.read(key);
  if (!body || !sniffMatches(mimeType, body.subarray(0, 8))) {
    throw badRequest("Το περιεχόμενο του αρχείου δεν αντιστοιχεί στον τύπο του.");
  }
  if (await tx.document.findFirst({ where: { storageKey: key }, select: { id: true } })) throw conflict("Το αρχείο έχει ήδη καταχωριστεί.");
  return tx.document.create({
    data: { ...data, storageKey: key, mimeType, byteSize, checksum: sha256(body), uploadedById: actor.id },
  });
}

export async function documentRoutes(app: FastifyInstance): Promise<void> {
  const agent = { preHandler: requireRole("AGENT") };

  app.get("/documents", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const q = parseInput(listSchema, request.query);
    const where: Prisma.DocumentWhereInput = {
      AND: [
        documentVisibleTo(actor),
        q.propertyId ? { propertyId: q.propertyId } : {},
        q.contactId ? { contactId: q.contactId } : {},
        q.transactionId ? { transactionId: q.transactionId } : {},
        q.category ? { category: q.category } : {},
        q.q ? { title: { contains: q.q, mode: "insensitive" } } : {},
      ],
    };
    const take = 25;
    const [rows, total] = await Promise.all([
      db().document.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take,
        skip: (q.page - 1) * take,
        include: {
          property: { select: { id: true, reference: true } },
          contact: { select: { id: true, reference: true, firstName: true, lastName: true } },
          transaction: { select: { id: true, reference: true } },
          mandatePdfOf: { select: { id: true, reference: true } },
          mandateSignedOf: { select: { id: true, reference: true } },
        },
      }),
      db().document.count({ where }),
    ]);
    return {
      data: rows.map((d) => ({
        id: d.id,
        title: d.title,
        category: d.category,
        categoryLabel: DOCUMENT_CATEGORY_LABELS[d.category] ?? d.category,
        mimeType: d.mimeType,
        byteSize: d.byteSize,
        checksum: d.checksum,
        containsPersonalData: d.containsPersonalData,
        property: d.property,
        contact: d.contact ? { id: d.contact.id, reference: d.contact.reference, name: `${d.contact.firstName} ${d.contact.lastName}`.trim() } : null,
        transaction: d.transaction,
        mandate: d.mandatePdfOf ?? d.mandateSignedOf,
        locked: !!(d.mandatePdfOf || d.mandateSignedOf),
        createdAt: d.createdAt,
      })),
      canDelete: roleAtLeast(actor.role, "MANAGER"),
      storageConfigured: documentStore().configured(),
      pagination: { page: q.page, limit: take, total, pages: Math.max(1, Math.ceil(total / take)) },
    };
  });

  app.post("/documents/uploads", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const input = parseInput(uploadSchema, request.body);
    const max = loadConfig().MAX_UPLOAD_BYTES;
    if (input.byteSize > max) throw badRequest(`Το αρχείο ξεπερνά το όριο των ${Math.floor(max / 1_048_576)} MB.`);
    const store = requireStore();
    const key = documentKey(DOCUMENT_TYPES[input.mimeType]!.ext);
    const upload = await store.presignPut(key, input.mimeType, input.byteSize);
    return { token: signUpload(key, actor.id, input.mimeType, input.byteSize), upload };
  });

  app.post("/documents", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const input = parseInput(confirmSchema, request.body);
    const manager = roleAtLeast(actor.role, "MANAGER");

    // Links must exist and be the agent's own (or any, for managers).
    if (input.propertyId) {
      const p = await db().property.findUnique({ where: { id: input.propertyId }, select: { agentId: true } });
      if (!p) throw badRequest("Το ακίνητο δεν βρέθηκε.");
    }
    if (input.contactId && !(await db().contact.findUnique({ where: { id: input.contactId }, select: { id: true } }))) throw badRequest("Η επαφή δεν βρέθηκε.");
    let checklistItemId: string | null = null;
    if (input.transactionId) {
      const t = await db().transaction.findUnique({ where: { id: input.transactionId }, select: { agentId: true, createdById: true, status: true } });
      if (!t || (!manager && t.agentId !== actor.id && t.createdById !== actor.id)) throw badRequest("Η συναλλαγή δεν βρέθηκε.");
      if (input.checklistItemId) {
        const item = await db().transactionChecklistItem.findFirst({ where: { id: input.checklistItemId, transactionId: input.transactionId } });
        if (!item) throw badRequest("Το στοιχείο λίστας δεν βρέθηκε.");
        checklistItemId = item.id;
      }
    }

    const doc = await db().$transaction(async (tx) => {
      const d = await confirmUpload(
        actor,
        input.token,
        {
          title: input.title,
          category: input.category,
          propertyId: input.propertyId,
          contactId: input.contactId,
          transactionId: input.transactionId,
          containsPersonalData: input.containsPersonalData || input.category === "ID_VERIFICATION",
        },
        tx,
      );
      if (checklistItemId && input.transactionId) {
        const item = await tx.transactionChecklistItem.update({
          where: { id: checklistItemId },
          data: { documentId: d.id, status: "RECEIVED", updatedById: actor.id },
        });
        await tx.transactionEvent.create({
          data: {
            transactionId: input.transactionId,
            type: "DOCUMENT_STATUS",
            summary: `«${item.label}»: παραλήφθηκε (${d.title})`,
            actorId: actor.id,
            actorName: `${actor.firstName} ${actor.lastName}`.trim() || actor.email,
          },
        });
      }
      return d;
    });
    await writeAudit({ entity: "DOCUMENT", entityId: doc.id, action: "upload", changes: { category: doc.category, byteSize: doc.byteSize, checksum: doc.checksum }, actorId: actor.id, ...meta(request) });
    return { document: { id: doc.id, checksum: doc.checksum } };
  });

  app.get("/documents/:id/download", agent, async (request) => {
    const actor = request.auth!.user as Actor;
    const { id } = request.params as { id: string };
    const doc = await db().document.findFirst({ where: { AND: [{ id }, documentVisibleTo(actor)] } });
    if (!doc) throw notFound("Το έγγραφο δεν βρέθηκε.");
    const store = requireStore();
    const ext = DOCUMENT_TYPES[doc.mimeType]?.ext ?? "bin";
    const url = await store.signedGet(doc.storageKey, `${doc.title}.${ext}`, 120);
    await writeAudit({ entity: "DOCUMENT", entityId: doc.id, action: "download", actorId: actor.id, ...meta(request) });
    return { url, expiresInSeconds: 120 };
  });

  app.delete("/documents/:id", { preHandler: requireRole("MANAGER") }, async (request) => {
    const actor = request.auth!.user as Actor;
    const { id } = request.params as { id: string };
    const doc = await db().document.findUnique({ where: { id }, include: { mandatePdfOf: { select: { id: true } }, mandateSignedOf: { select: { id: true } } } });
    if (!doc) throw notFound("Το έγγραφο δεν βρέθηκε.");
    if (doc.mandatePdfOf || doc.mandateSignedOf) throw conflict("Το έγγραφο ανήκει σε εντολή και δεν διαγράφεται.");
    if (doc.submissionId) throw conflict("Το έγγραφο ανήκει σε υποβολή ιδιοκτήτη· διαχειρίζεται από τον έλεγχο υποβολών.");
    try {
      await db().document.delete({ where: { id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") throw conflict("Το έγγραφο χρησιμοποιείται και δεν διαγράφεται.");
      throw error;
    }
    // The database row is the record; the object goes after it. A failure here
    // leaves an unreferenced private object, never a dangling record.
    await documentStore()
      .remove(doc.storageKey)
      .catch((error: unknown) => console.warn(`[home88:documents] object not removed (${error instanceof Error ? error.name : "Error"})`));
    await writeAudit({ entity: "DOCUMENT", entityId: id, action: "delete", changes: { title: doc.title, checksum: doc.checksum }, actorId: actor.id, ...meta(request) });
    return { ok: true };
  });
}
