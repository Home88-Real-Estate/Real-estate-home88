/**
 * Storage-key and upload rules.
 *
 * Pure and dependency-free (bar a UUID) so the decisions that matter — what
 * MIME types are allowed, how a key is laid out, what kind a file becomes — are
 * unit-tested without touching S3 or the database.
 */

import { randomUUID } from "node:crypto";

export const MEDIA_KINDS = ["PHOTO", "FLOOR_PLAN", "VIDEO", "VIRTUAL_TOUR", "DOCUMENT"] as const;
export type MediaKindValue = (typeof MEDIA_KINDS)[number];

/**
 * MIME types accepted for upload, and the media kind each defaults to. The
 * client may override the kind (a floor plan is an image too) but never the
 * allow-list: an executable renamed to .jpg is rejected by its declared type at
 * this boundary and again by content sniffing where available.
 */
export const ALLOWED_UPLOAD_MIME: Record<string, MediaKindValue> = {
  "image/jpeg": "PHOTO",
  "image/png": "PHOTO",
  "image/webp": "PHOTO",
  "image/avif": "PHOTO",
  "image/gif": "PHOTO",
  "image/svg+xml": "FLOOR_PLAN",
  "application/pdf": "DOCUMENT",
};

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
};

export function isAllowedUpload(mime: string): boolean {
  return Object.prototype.hasOwnProperty.call(ALLOWED_UPLOAD_MIME, mime.toLowerCase());
}

export function kindForMime(mime: string, requested?: string | null): MediaKindValue {
  if (requested && (MEDIA_KINDS as readonly string[]).includes(requested)) {
    return requested as MediaKindValue;
  }
  return ALLOWED_UPLOAD_MIME[mime.toLowerCase()] ?? "DOCUMENT";
}

/** The browser's filename is never trusted for anything but guessing an extension. */
export function extensionFor(mime: string, originalName?: string | null): string {
  const fromMime = EXTENSION_BY_MIME[mime.toLowerCase()];
  if (fromMime) return fromMime;
  const match = /\.([a-z0-9]{1,8})$/i.exec(originalName ?? "");
  return match?.[1]?.toLowerCase() ?? "bin";
}

export function sanitiseFilename(name?: string | null): string | null {
  if (!name) return null;
  const base = name.split(/[\\/]/).pop() ?? name;
  const cleaned = base.replace(/[^\w.\- ]+/g, "_").trim().slice(0, 200);
  return cleaned.length > 0 ? cleaned : null;
}

export type StorageKeyInput = {
  propertyId: string;
  kind: MediaKindValue;
  mime: string;
  originalName?: string | null;
  /** Injectable for deterministic tests. */
  now?: Date;
  id?: string;
};

/**
 * `properties/<id>/<kind>/<yyyy>/<mm>/<uuid>.<ext>`.
 * The date segments keep a bucket browsable and let a lifecycle rule expire
 * old uploads without consulting the database.
 */
export function buildStorageKey(input: StorageKeyInput): string {
  const now = input.now ?? new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const id = input.id ?? randomUUID();
  const ext = extensionFor(input.mime, input.originalName);
  return `properties/${input.propertyId}/${input.kind.toLowerCase()}/${year}/${month}/${id}.${ext}`;
}
