/**
 * Personal-data helpers. Deliberately identical in behaviour to
 * apps/web/src/lib/pii.ts: the website writes the hash that the CRM later looks
 * a person up by, so the two must agree byte-for-byte. The environment is read
 * on each call (not at import) so the value is the one loaded at boot.
 *
 *  - hashing is a stable, peppered, one-way identifier for lookups;
 *  - encryption is a real AES-256-GCM envelope for values kept at rest, and it
 *    fails closed: with no key it returns null instead of storing plaintext.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { normalisePhone } from "@home88/intake";

function pepper(): string {
  return process.env.PII_HASH_PEPPER ?? "";
}

export function normaliseEmail(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.trim().toLowerCase();
}

export function hashEmail(raw: string | null | undefined): string | null {
  const email = normaliseEmail(raw);
  if (!email) return null;
  return createHash("sha256").update(`${pepper()}:${email}`).digest("hex");
}

/** Same formula as the website's, so a contact the public form created is found from the CRM and vice versa. */
export function hashPhone(raw: string | null | undefined): string | null {
  const phone = normalisePhone(raw);
  if (!phone) return null;
  return createHash("sha256").update(`${pepper()}:phone:${phone}`).digest("hex");
}

export function hashSubject(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return null;
  return createHash("sha256").update(`${pepper()}:${v}`).digest("hex");
}

function encryptionKey(): Buffer | null {
  const raw = process.env.PII_ENCRYPTION_KEY ?? "";
  if (!raw) return null;
  try {
    const key = Buffer.from(raw, "base64");
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

export function hasEncryptionKey(): boolean {
  return encryptionKey() !== null;
}

/** Returns `v1:<iv>:<tag>:<ciphertext>` (all base64), or null when no key is set. */
export function encryptField(plaintext: string | null | undefined): string | null {
  const key = encryptionKey();
  if (!key) return null;
  const value = (plaintext ?? "").trim();
  if (!value) return null;

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return ["v1", iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptField(envelope: string | null | undefined): string | null {
  const key = encryptionKey();
  if (!key || !envelope) return null;

  const parts = envelope.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") return null;

  const ivPart = parts[1];
  const tagPart = parts[2];
  const dataPart = parts[3];
  if (!ivPart || !tagPart || !dataPart) return null;

  try {
    const iv = Buffer.from(ivPart, "base64");
    const tag = Buffer.from(tagPart, "base64");
    const ciphertext = Buffer.from(dataPart, "base64");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Constant-time comparison for short opaque values (e.g. a CSRF double-submit). */
export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function redactEmail(raw: string | null | undefined): string {
  const email = normaliseEmail(raw);
  if (!email) return "[none]";
  const at = email.indexOf("@");
  if (at <= 0) return "[redacted]";
  return `${email[0]}***${email.slice(at)}`;
}
