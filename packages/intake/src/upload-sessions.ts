/**
 * Anonymous upload sessions.
 *
 * A visitor with no account needs somewhere safe to put photos before the form
 * is submitted. The server hands out an unguessable token; only its hash is
 * stored. Every signed URL is issued against a session, which is where quotas
 * (files, bytes) are enforced atomically, and the quarantine key prefix is a
 * second random value so an object path reveals nothing about the token.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PrismaClient } from "@home88/database";

import {
  checkDeclaration,
  quarantineKey,
  type Declaration,
  type FileIssue,
  type UploadLimits,
} from "./files";
import type { StoragePort } from "./ports";

export const SESSION_TTL_MS = 6 * 60 * 60 * 1000;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export class UploadRefused extends Error {
  constructor(readonly code: FileIssue["code"] | "SESSION_INVALID" | "QUOTA_FILES" | "QUOTA_BYTES", message: string) {
    super(message);
    this.name = "UploadRefused";
  }
}

export async function createUploadSession(prisma: PrismaClient, now: Date = new Date()) {
  const token = randomBytes(32).toString("base64url");
  const prefix = randomBytes(16).toString("hex");
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await prisma.intakeUploadSession.create({ data: { tokenHash: hashToken(token), prefix, expiresAt } });
  return { token, expiresAt };
}

export async function findUploadSession(prisma: PrismaClient, token: string, now: Date = new Date()) {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const session = await prisma.intakeUploadSession.findUnique({ where: { tokenHash: hashToken(token) } });
  return session && session.expiresAt > now ? session : null;
}

/**
 * Validates one declared file against type, name and size rules, reserves its
 * share of the session's quota in a single conditional UPDATE (so parallel
 * requests cannot overshoot), and returns a signed upload URL.
 */
export async function presignUpload(
  deps: { prisma: PrismaClient; storage: StoragePort; limits: UploadLimits; now?: Date },
  token: string,
  declared: Declaration,
) {
  const { prisma, storage, limits } = deps;
  const session = await findUploadSession(prisma, token, deps.now);
  if (!session || session.submissionId) throw new UploadRefused("SESSION_INVALID", "Η συνεδρία μεταφόρτωσης έληξε. Ανανεώστε τη σελίδα.");

  const issue = checkDeclaration(declared, limits);
  if (issue) throw new UploadRefused(issue.code, issue.message);

  const isPhoto = declared.kind === "PHOTO";
  const reserved = await prisma.intakeUploadSession.updateMany({
    where: {
      id: session.id,
      submissionId: null,
      ...(isPhoto ? { photoCount: { lt: limits.maxPhotos } } : { documentCount: { lt: limits.maxDocuments } }),
      byteTotal: { lte: BigInt(limits.maxTotalBytes - declared.byteSize) },
    },
    data: {
      ...(isPhoto ? { photoCount: { increment: 1 } } : { documentCount: { increment: 1 } }),
      byteTotal: { increment: BigInt(declared.byteSize) },
    },
  });
  if (reserved.count === 0) {
    const overBytes = Number(session.byteTotal) + declared.byteSize > limits.maxTotalBytes;
    throw new UploadRefused(overBytes ? "QUOTA_BYTES" : "QUOTA_FILES", overBytes ? "Έχετε φτάσει το συνολικό όριο μεγέθους αρχείων." : "Έχετε φτάσει το όριο αρχείων.");
  }

  const mime = declared.mimeType.split(";")[0]!.trim().toLowerCase();
  const storageKey = quarantineKey(session.prefix, randomUUID(), mime);
  const upload = await storage.presignPut(storageKey, mime, declared.byteSize);
  return { storageKey, upload };
}
