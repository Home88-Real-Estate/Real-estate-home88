/**
 * Property media: upload, metadata, moderation and ordering.
 *
 * Uploads go straight from the browser to object storage: the API issues a
 * signed PUT URL for a key it chooses, then records the file when the browser
 * confirms, after checking the stored object. File bytes never pass through an
 * API request (Vercel functions accept at most 4.5 MB).
 *
 * Nothing lands in a public-serving state on arrival: every row is created
 * `pending_review`, and only a MANAGER can promote it. That is what stops an
 * unvetted photo reaching the website or a portal feed between upload and review.
 */

import type { FastifyInstance } from "fastify";
import type { PropertyMedia } from "@home88/database";
import { can, PERMISSIONS } from "@home88/domain";
import {
  mediaConfirmSchema,
  mediaReorderSchema,
  mediaStatusChangeSchema,
  mediaUpdateSchema,
  mediaUploadRequestSchema,
} from "@home88/validation";
import { loadConfig } from "../config";
import { writeAudit } from "../lib/audit";
import {
  isIssuedKey,
  mustSniff,
  VARIANT_MAX_BYTES,
  VARIANT_MIME,
  VARIANTS,
  variantKey,
} from "../lib/direct-upload";
import { HttpError, badRequest, forbidden, notFound } from "../lib/errors";
import { clientIp, parseInput, userAgent } from "../lib/http";
import { imageDimensions } from "../lib/image-size";
import {
  buildStorageKey,
  isAllowedUpload,
  kindForMime,
  sanitiseFilename,
} from "../lib/media-key";
import { db } from "../lib/prisma";
import {
  deleteObject,
  headObject,
  mediaUrlFor,
  presignPut,
  readObjectStart,
  storageConfigured,
} from "../lib/storage";
import { requireRole } from "../plugins/auth";

/** Enough of a file to read image dimensions even behind large EXIF blocks. */
const SNIFF_BYTES = 256 * 1024;

export type MediaDto = {
  id: string;
  kind: string;
  storageKey: string;
  originalName: string | null;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  altEl: string | null;
  altEn: string | null;
  sortOrder: number;
  isPrimary: boolean;
  status: string;
  createdAt: string;
  url: string;
  previewUrl: string | null;
  thumbnailUrl: string | null;
};

async function toMediaDto(row: PropertyMedia): Promise<MediaDto> {
  return {
    id: row.id,
    kind: row.kind,
    storageKey: row.storageKey,
    originalName: row.originalName,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    width: row.width,
    height: row.height,
    altEl: row.altEl,
    altEn: row.altEn,
    sortOrder: row.sortOrder,
    isPrimary: row.isPrimary,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    url: await mediaUrlFor(row.storageKey, row.status),
    previewUrl: row.previewKey ? await mediaUrlFor(row.previewKey, row.status) : null,
    thumbnailUrl: row.thumbnailKey ? await mediaUrlFor(row.thumbnailKey, row.status) : null,
  };
}

/** After an upload or a delete there must still be exactly one primary item. */
async function ensurePrimary(propertyId: string): Promise<void> {
  const media = await db().propertyMedia.findMany({
    where: { propertyId },
    orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
  });
  if (media.some((item) => item.isPrimary)) return;

  const candidate = media.find((item) => item.kind === "PHOTO") ?? media[0];
  if (candidate) {
    await db().propertyMedia.update({ where: { id: candidate.id }, data: { isPrimary: true } });
  }
}

/** The property must exist and the actor must be allowed to change it. */
async function requireEditableProperty(id: string, actor: { id: string; role: string }): Promise<void> {
  const property = await db().property.findUnique({
    where: { id },
    select: { id: true, agentId: true, createdById: true },
  });
  if (!property) throw notFound("Το ακίνητο δεν βρέθηκε.");
  if (!can(actor, PERMISSIONS.PROPERTY_UPDATE, property)) {
    throw forbidden("Μόνο ο ανατεθειμένος σύμβουλος, ο δημιουργός ή ένας υπεύθυνος μπορεί να προσθέσει αρχεία εδώ.");
  }
}

function requireStorage(): void {
  if (!storageConfigured(loadConfig())) {
    throw new HttpError(503, "storage_unavailable", "Object storage is not configured.");
  }
}

function nullIfBlank(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** A variant PUT: JPEG only; its size is checked when the upload is confirmed. */
async function presignVariant(key: string) {
  return presignPut(key, VARIANT_MIME);
}

/** A variant is recorded only if it exists, is a JPEG and is within the cap. */
async function verifiedVariant(key: string): Promise<string | null> {
  const stored = await headObject(key).catch(() => null);
  if (!stored) return null;
  const ok =
    stored.contentType.split(";")[0]!.trim().toLowerCase() === VARIANT_MIME &&
    stored.byteSize > 0 &&
    stored.byteSize <= VARIANT_MAX_BYTES;
  if (!ok) {
    await deleteObject(key).catch(() => undefined);
    return null;
  }
  return key;
}

export async function mediaRoutes(app: FastifyInstance): Promise<void> {
  app.get("/properties/:id/media", { preHandler: requireRole("AGENT") }, async (request) => {
    const { id } = request.params as { id: string };
    const rows = await db().propertyMedia.findMany({
      where: { propertyId: id },
      orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return { media: await Promise.all(rows.map(toMediaDto)) };
  });

  /** Step 1: a signed URL to PUT the file (and its variants) straight to storage. */
  app.post(
    "/properties/:id/media/uploads",
    { preHandler: requireRole("AGENT") },
    async (request, reply) => {
      const actor = request.auth!.user;
      const { id } = request.params as { id: string };
      const cfg = loadConfig();
      requireStorage();
      await requireEditableProperty(id, actor);

      const input = parseInput(mediaUploadRequestSchema, request.body);
      const mime = input.mimeType.split(";")[0]!.trim();
      if (!isAllowedUpload(mime)) throw badRequest(`Unsupported file type: ${mime || "unknown"}.`);
      if (input.byteSize > cfg.MAX_UPLOAD_BYTES) {
        throw new HttpError(413, "file_too_large", "File exceeds the upload limit.");
      }

      const kind = kindForMime(mime, input.kind);
      const storageKey = buildStorageKey({ propertyId: id, kind, mime, originalName: input.fileName });
      const upload = await presignPut(storageKey, mime, input.byteSize);

      // Variants are made by the browser after this call, so their size is
      // not known yet: they are checked against VARIANT_MAX_BYTES on confirm.
      const variants: Record<string, { storageKey: string; url: string; headers: Record<string, string> }> =
        {};
      if (input.withVariants && kind === "PHOTO") {
        for (const variant of VARIANTS) {
          const key = variantKey(storageKey, variant);
          variants[variant] = { storageKey: key, ...(await presignVariant(key)) };
        }
      }

      reply.code(201);
      return { storageKey, upload, variants, maxBytes: cfg.MAX_UPLOAD_BYTES };
    },
  );

  /**
   * Step 2: record an uploaded file. Idempotent per key, so a retried confirm
   * (flaky mobile network) returns the existing row instead of a duplicate.
   */
  app.post(
    "/properties/:id/media/confirm",
    { preHandler: requireRole("AGENT") },
    async (request, reply) => {
      const actor = request.auth!.user;
      const { id } = request.params as { id: string };
      const cfg = loadConfig();
      requireStorage();
      await requireEditableProperty(id, actor);

      const input = parseInput(mediaConfirmSchema, request.body);
      if (!isIssuedKey(input.storageKey, id)) throw badRequest("Άγνωστο αρχείο μεταφόρτωσης.");

      const existing = await db().propertyMedia.findUnique({ where: { storageKey: input.storageKey } });
      if (existing) {
        if (existing.propertyId !== id) throw badRequest("Άγνωστο αρχείο μεταφόρτωσης.");
        return { media: await toMediaDto(existing), duplicate: true };
      }

      const stored = await headObject(input.storageKey);
      if (!stored) throw badRequest("Η μεταφόρτωση του αρχείου δεν ολοκληρώθηκε.");
      const mime = stored.contentType.split(";")[0]!.trim().toLowerCase();
      if (!isAllowedUpload(mime) || stored.byteSize === 0 || stored.byteSize > cfg.MAX_UPLOAD_BYTES) {
        await deleteObject(input.storageKey).catch(() => undefined);
        throw badRequest("Το αρχείο απορρίφθηκε.");
      }

      const kind = kindForMime(mime, input.kind);
      let dimensions: { width: number; height: number } | null = null;
      if (kind !== "DOCUMENT" && mime.startsWith("image/")) {
        dimensions = imageDimensions(await readObjectStart(input.storageKey, SNIFF_BYTES));
        // The declared type must match the bytes: a renamed file is removed.
        if (!dimensions && mustSniff(mime)) {
          await deleteObject(input.storageKey).catch(() => undefined);
          throw badRequest("Το αρχείο δεν είναι έγκυρη εικόνα.");
        }
      }

      const previewKey = input.hasPreview
        ? await verifiedVariant(variantKey(input.storageKey, "preview"))
        : null;
      const thumbnailKey = input.hasThumbnail
        ? await verifiedVariant(variantKey(input.storageKey, "thumbnail"))
        : null;

      const row = await db().$transaction(async (tx) => {
        const created = await tx.propertyMedia.create({
          data: {
            propertyId: id,
            kind,
            storageKey: input.storageKey,
            previewKey,
            thumbnailKey,
            originalName: sanitiseFilename(input.fileName),
            mimeType: mime,
            byteSize: stored.byteSize,
            width: dimensions?.width ?? null,
            height: dimensions?.height ?? null,
            altEl: nullIfBlank(input.altEl) ?? null,
            altEn: nullIfBlank(input.altEn) ?? null,
            status: "pending_review",
          },
        });
        await writeAudit(
          {
            entity: "PROPERTY",
            entityId: id,
            action: "media.upload",
            actorId: actor.id,
            ipAddress: clientIp(request),
            userAgent: userAgent(request),
            changes: { mediaId: created.id, kind, storageKey: input.storageKey, mime, byteSize: stored.byteSize },
          },
          tx,
        );
        return created;
      });

      await ensurePrimary(id);
      const fresh = await db().propertyMedia.findUniqueOrThrow({ where: { id: row.id } });
      reply.code(201);
      return { media: await toMediaDto(fresh), duplicate: false };
    },
  );

  app.patch(
    "/properties/:id/media/:mediaId",
    { preHandler: requireRole("AGENT") },
    async (request) => {
      const actor = request.auth!.user;
      const { id, mediaId } = request.params as { id: string; mediaId: string };
      const input = parseInput(mediaUpdateSchema, request.body);

      const existing = await db().propertyMedia.findFirst({
        where: { id: mediaId, propertyId: id },
      });
      if (!existing) throw notFound("Το αρχείο δεν βρέθηκε.");

      const updated = await db().$transaction(async (tx) => {
        if (input.isPrimary === true) {
          await tx.propertyMedia.updateMany({
            where: { propertyId: id, isPrimary: true, NOT: { id: mediaId } },
            data: { isPrimary: false },
          });
        }

        const row = await tx.propertyMedia.update({
          where: { id: mediaId },
          data: {
            kind: input.kind,
            altEl: nullIfBlank(input.altEl),
            altEn: nullIfBlank(input.altEn),
            sortOrder: input.isPrimary === true && input.sortOrder === undefined ? 0 : input.sortOrder,
            isPrimary: input.isPrimary,
          },
        });

        await writeAudit(
          {
            entity: "PROPERTY",
            entityId: id,
            action: "media.update",
            actorId: actor.id,
            ipAddress: clientIp(request),
            userAgent: userAgent(request),
            changes: { mediaId, fields: Object.keys(input) },
          },
          tx,
        );

        return row;
      });

      return { media: await toMediaDto(updated) };
    },
  );

  app.post(
    "/properties/:id/media/reorder",
    { preHandler: requireRole("AGENT") },
    async (request) => {
      const actor = request.auth!.user;
      const { id } = request.params as { id: string };
      const input = parseInput(mediaReorderSchema, request.body);

      const existing = await db().propertyMedia.findMany({
        where: { propertyId: id },
        select: { id: true },
      });
      const owned = new Set(existing.map((row) => row.id));
      if (input.ids.some((mediaId) => !owned.has(mediaId))) {
        throw badRequest("Κάποια αρχεία δεν ανήκουν σε αυτό το ακίνητο.");
      }

      await db().$transaction(
        input.ids.map((mediaId, index) =>
          db().propertyMedia.update({ where: { id: mediaId }, data: { sortOrder: index } }),
        ),
      );

      await writeAudit({
        entity: "PROPERTY",
        entityId: id,
        action: "media.reorder",
        actorId: actor.id,
        ipAddress: clientIp(request),
        userAgent: userAgent(request),
        changes: { order: input.ids },
      });

      return { ok: true };
    },
  );

  app.post(
    "/properties/:id/media/:mediaId/status",
    { preHandler: requireRole("MANAGER") },
    async (request) => {
      const actor = request.auth!.user;
      const { id, mediaId } = request.params as { id: string; mediaId: string };
      const input = parseInput(mediaStatusChangeSchema, request.body);

      const existing = await db().propertyMedia.findFirst({
        where: { id: mediaId, propertyId: id },
      });
      if (!existing) throw notFound("Το αρχείο δεν βρέθηκε.");

      const updated = await db().propertyMedia.update({
        where: { id: mediaId },
        data: { status: input.status },
      });

      await writeAudit({
        entity: "PROPERTY",
        entityId: id,
        action: `media.${input.status}`,
        actorId: actor.id,
        ipAddress: clientIp(request),
        userAgent: userAgent(request),
        changes: {
          mediaId,
          from: existing.status,
          to: input.status,
          reason: input.reason ?? null,
        },
      });

      return { media: await toMediaDto(updated) };
    },
  );

  app.delete(
    "/properties/:id/media/:mediaId",
    { preHandler: requireRole("AGENT") },
    async (request) => {
      const actor = request.auth!.user;
      const { id, mediaId } = request.params as { id: string; mediaId: string };

      const existing = await db().propertyMedia.findFirst({
        where: { id: mediaId, propertyId: id },
      });
      if (!existing) throw notFound("Το αρχείο δεν βρέθηκε.");

      try {
        for (const key of [existing.storageKey, existing.previewKey, existing.thumbnailKey]) {
          if (key) await deleteObject(key);
        }
      } catch (error) {
        // The row is the source of truth; an orphaned object is reclaimable by
        // a lifecycle rule, so a storage hiccup must not block the delete.
        request.log.warn({ err: error, key: existing.storageKey }, "media object delete failed");
      }

      await db().$transaction(async (tx) => {
        await tx.propertyMedia.delete({ where: { id: mediaId } });
        await writeAudit(
          {
            entity: "PROPERTY",
            entityId: id,
            action: "media.delete",
            actorId: actor.id,
            ipAddress: clientIp(request),
            userAgent: userAgent(request),
            changes: { mediaId, storageKey: existing.storageKey },
          },
          tx,
        );
      });

      if (existing.isPrimary) await ensurePrimary(id);

      return { ok: true };
    },
  );
}
