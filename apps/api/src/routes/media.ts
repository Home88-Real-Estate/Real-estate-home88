/**
 * Property media: upload, metadata, moderation and ordering.
 *
 * Uploads are multipart and streamed one file at a time. Nothing lands in a
 * public-serving state on arrival: every row is created `pending_review`, and
 * only a MANAGER can promote it. That is what stops an unvetted photo reaching
 * the website or a portal feed between upload and review.
 */

import type { FastifyInstance } from "fastify";
import type { MultipartFile } from "@fastify/multipart";
import type { PropertyMedia } from "@home88/database";
import {
  mediaReorderSchema,
  mediaStatusChangeSchema,
  mediaUpdateSchema,
} from "@home88/validation";
import { loadConfig } from "../config";
import { writeAudit } from "../lib/audit";
import { HttpError, badRequest, notFound } from "../lib/errors";
import { clientIp, parseInput, userAgent } from "../lib/http";
import { imageDimensions } from "../lib/image-size";
import {
  buildStorageKey,
  isAllowedUpload,
  kindForMime,
  sanitiseFilename,
} from "../lib/media-key";
import { db } from "../lib/prisma";
import { deleteObject, mediaUrlFor, putObject, storageConfigured } from "../lib/storage";
import { requireRole } from "../plugins/auth";

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

async function requireProperty(id: string): Promise<void> {
  const property = await db().property.findUnique({ where: { id }, select: { id: true } });
  if (!property) throw notFound("Property not found.");
}

function nullIfBlank(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

  app.post("/properties/:id/media", { preHandler: requireRole("AGENT") }, async (request, reply) => {
    const actor = request.auth!.user;
    const { id } = request.params as { id: string };
    const cfg = loadConfig();

    if (!storageConfigured(cfg)) {
      throw new HttpError(503, "storage_unavailable", "Object storage is not configured.");
    }
    await requireProperty(id);
    if (!request.isMultipart()) throw badRequest("Expected a multipart upload.");

    let kindOverride: string | undefined;
    let altEl: string | undefined;
    let altEn: string | undefined;
    const created: PropertyMedia[] = [];

    for await (const part of request.parts()) {
      if (part.type === "field") {
        const value = typeof part.value === "string" ? part.value : undefined;
        if (part.fieldname === "kind") kindOverride = value;
        else if (part.fieldname === "altEl") altEl = value;
        else if (part.fieldname === "altEn") altEn = value;
        continue;
      }

      const file = part as MultipartFile;
      const mime = (file.mimetype || "").split(";")[0]!.trim().toLowerCase();
      if (!isAllowedUpload(mime)) {
        await file.toBuffer().catch(() => undefined);
        throw badRequest(`Unsupported file type: ${file.mimetype || "unknown"}.`);
      }

      const buffer = await file.toBuffer();
      if (buffer.byteLength === 0) continue;
      if (buffer.byteLength > cfg.MAX_UPLOAD_BYTES) {
        throw new HttpError(413, "file_too_large", "File exceeds the upload limit.");
      }

      const kind = kindForMime(mime, kindOverride);
      const dimensions = kind === "DOCUMENT" ? null : imageDimensions(buffer);
      const storageKey = buildStorageKey({
        propertyId: id,
        kind,
        mime,
        originalName: file.filename,
      });

      await putObject(storageKey, buffer, mime);

      const row = await db().propertyMedia.create({
        data: {
          propertyId: id,
          kind,
          storageKey,
          originalName: sanitiseFilename(file.filename),
          mimeType: mime,
          byteSize: buffer.byteLength,
          width: dimensions?.width ?? null,
          height: dimensions?.height ?? null,
          altEl: nullIfBlank(altEl) ?? null,
          altEn: nullIfBlank(altEn) ?? null,
          status: "pending_review",
        },
      });

      await writeAudit({
        entity: "PROPERTY",
        entityId: id,
        action: "media.upload",
        actorId: actor.id,
        ipAddress: clientIp(request),
        userAgent: userAgent(request),
        changes: { mediaId: row.id, kind, storageKey, mime, byteSize: buffer.byteLength },
      });

      created.push(row);
    }

    if (created.length === 0) throw badRequest("No files were uploaded.");
    await ensurePrimary(id);

    const media = await db().propertyMedia.findMany({
      where: { id: { in: created.map((row) => row.id) } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });

    reply.code(201);
    return { media: await Promise.all(media.map(toMediaDto)) };
  });

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
      if (!existing) throw notFound("Media not found.");

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
        throw badRequest("One or more media ids do not belong to this property.");
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
      if (!existing) throw notFound("Media not found.");

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
      if (!existing) throw notFound("Media not found.");

      try {
        await deleteObject(existing.storageKey);
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
