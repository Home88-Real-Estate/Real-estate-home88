/**
 * Turns files a visitor uploaded to quarantine into private CRM records.
 *
 * Each file is verified independently, so one bad file never loses the rest:
 *
 *   - the key must belong to this visitor's session (no claiming other objects)
 *   - the stored object must match what was declared (size, type)
 *   - the leading bytes must really be that format (a renamed script is REJECTED
 *     and its object deleted)
 *   - photos are decoded and re-encoded without metadata (GPS never persists),
 *     variants are generated, a checksum is taken
 *   - a valid but undecodable or out-of-range image is QUARANTINED, kept for staff
 *
 * Everything lands PRIVATE: photos as `PropertyMedia` with status
 * `pending_review` and no property, documents as CRM-only `Document` rows.
 * Re-running with the same files is safe: rows are keyed by storage key.
 */

import type { PrismaClient } from "@home88/database";

import {
  checkDeclaration,
  displayFileName,
  isQuarantineKeyFor,
  sniffMime,
  type UploadKind,
  type UploadLimits,
} from "./files";
import { processPhoto, sha256, variantStorageKey } from "./imaging";
import type { StoragePort } from "./ports";
import { findUploadSession } from "./upload-sessions";

export type UploadClaim = { storageKey: string; kind: UploadKind; fileName: string; mimeType: string; byteSize: number };
export type ClaimResult = { accepted: number; quarantined: number; rejected: number; skipped: number };

type Deps = { prisma: PrismaClient; storage: StoragePort; limits: UploadLimits };
type Target = { submissionId: string; contactId: string; token: string; files: UploadClaim[] };

export async function claimUploads(deps: Deps, target: Target): Promise<ClaimResult> {
  const { prisma, storage, limits } = deps;
  const result: ClaimResult = { accepted: 0, quarantined: 0, rejected: 0, skipped: 0 };

  const session = await findUploadSession(prisma, target.token);
  if (!session || (session.submissionId && session.submissionId !== target.submissionId)) {
    result.rejected = target.files.length;
    return result;
  }

  const files = target.files.slice(0, limits.maxPhotos + limits.maxDocuments);
  result.rejected += target.files.length - files.length;

  for (const [index, file] of files.entries()) {
    try {
      const outcome = await claimOne(deps, target, session.prefix, file, index);
      result[outcome] += 1;
    } catch {
      // Storage or database hiccup for this file only. Nothing half-written is
      // left behind (rows are created last), and a retry will pick it up again.
      result.skipped += 1;
    }
  }

  await prisma.intakeUploadSession.update({ where: { id: session.id }, data: { submissionId: target.submissionId } });
  return result;
}

async function claimOne(deps: Deps, target: Target, prefix: string, file: UploadClaim, index: number): Promise<keyof ClaimResult> {
  const { prisma, storage, limits } = deps;
  const mime = file.mimeType.split(";")[0]!.trim().toLowerCase();

  // Another visitor's object, a traversal attempt or a forged key is simply not ours to touch.
  if (!isQuarantineKeyFor(file.storageKey, prefix)) return "rejected";

  const [media, doc] = await Promise.all([
    prisma.propertyMedia.findUnique({ where: { storageKey: file.storageKey }, select: { id: true } }),
    prisma.document.findFirst({ where: { storageKey: file.storageKey }, select: { id: true } }),
  ]);
  if (media || doc) return "skipped"; // already claimed: a retry

  const declared = { kind: file.kind, mimeType: mime, fileName: file.fileName, byteSize: file.byteSize };
  const issue = checkDeclaration(declared, limits);
  const head = await storage.head(file.storageKey);
  if (!head) return "rejected"; // the browser never finished the upload
  if (issue || head.byteSize <= 0 || head.byteSize > file.byteSize || head.contentType.split(";")[0]!.trim().toLowerCase() !== mime) {
    await storage.delete(file.storageKey).catch(() => undefined);
    return "rejected";
  }

  const body = await storage.read(file.storageKey);
  const actual = sniffMime(body.subarray(0, 16));
  if (actual !== mime) {
    // Declared one thing, is another: never keep it, never process it.
    await storage.delete(file.storageKey).catch(() => undefined);
    await recordQuarantine(prisma, target, file, mime, head.byteSize, index, "REJECTED", "content does not match the declared type", sha256(body));
    return "rejected";
  }

  if (file.kind === "DOCUMENT") {
    await prisma.document.create({
      data: {
        contactId: target.contactId,
        submissionId: target.submissionId,
        title: displayFileName(file.fileName),
        category: "OTHER",
        storageKey: file.storageKey,
        mimeType: mime,
        byteSize: head.byteSize,
        checksum: sha256(body),
        originalName: displayFileName(file.fileName),
        containsPersonalData: true,
        source: "OWNER_SUBMISSION",
        lifecycle: "AVAILABLE",
      },
    });
    return "accepted";
  }

  const processed = await processPhoto(body, limits);
  if (!processed.ok) {
    await recordQuarantine(prisma, target, file, mime, head.byteSize, index, "QUARANTINED", processed.reason, processed.checksum);
    return "quarantined";
  }

  const duplicate = await prisma.propertyMedia.findFirst({
    where: { submissionId: target.submissionId, checksum: processed.checksum },
    select: { id: true },
  });

  // Replace the upload with the sanitised master, then store the variants. Rows
  // are written last, so a failure above leaves the original object in place
  // for a retry rather than a row pointing at nothing.
  await storage.put(file.storageKey, processed.master.body, processed.master.mimeType);
  const keys = {
    thumbnail: variantStorageKey(file.storageKey, "thumbnail"),
    card: variantStorageKey(file.storageKey, "card"),
    medium: variantStorageKey(file.storageKey, "medium"),
    large: variantStorageKey(file.storageKey, "large"),
  };
  for (const name of Object.keys(keys) as Array<keyof typeof keys>) await storage.put(keys[name], processed.variants[name], "image/webp");

  await prisma.propertyMedia.create({
    data: {
      propertyId: null,
      submissionId: target.submissionId,
      uploadedByContactId: target.contactId,
      kind: "PHOTO",
      storageKey: file.storageKey,
      previewKey: keys.medium,
      thumbnailKey: keys.thumbnail,
      originalName: displayFileName(file.fileName),
      mimeType: processed.master.mimeType,
      byteSize: processed.master.body.length,
      width: processed.width,
      height: processed.height,
      sortOrder: index,
      isPrimary: false,
      status: "pending_review",
      source: "OWNER_SUBMISSION",
      lifecycle: "AVAILABLE",
      checksum: processed.checksum,
      processingNote: duplicate ? "Πιθανό διπλότυπο φωτογραφίας" : null,
    },
  });
  return "accepted";
}

/** Keeps a trace of a refused or held file, without the file when it was unsafe. */
async function recordQuarantine(
  prisma: PrismaClient,
  target: Target,
  file: UploadClaim,
  mime: string,
  byteSize: number,
  index: number,
  lifecycle: "QUARANTINED" | "REJECTED",
  note: string,
  checksum: string,
): Promise<void> {
  if (file.kind === "DOCUMENT") {
    await prisma.document.create({
      data: {
        contactId: target.contactId,
        submissionId: target.submissionId,
        title: displayFileName(file.fileName),
        category: "OTHER",
        storageKey: file.storageKey,
        mimeType: mime,
        byteSize,
        checksum,
        originalName: displayFileName(file.fileName),
        containsPersonalData: true,
        source: "OWNER_SUBMISSION",
        lifecycle,
        processingNote: note,
      },
    });
    return;
  }
  await prisma.propertyMedia.create({
    data: {
      propertyId: null,
      submissionId: target.submissionId,
      uploadedByContactId: target.contactId,
      kind: "PHOTO",
      storageKey: file.storageKey,
      originalName: displayFileName(file.fileName),
      mimeType: mime,
      byteSize,
      sortOrder: index,
      status: "pending_review",
      source: "OWNER_SUBMISSION",
      lifecycle,
      checksum,
      processingNote: note,
    },
  });
}
