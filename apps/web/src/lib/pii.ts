/**
 * Personal-data helpers for the public site.
 *
 * Two separate jobs, deliberately kept apart:
 *
 *  - `hashEmail` produces a stable, non-reversible identifier. It is what we
 *    store for lookups and for the consent ledger's `subjectHash`, so consent
 *    can be joined to a person without the ledger itself holding an address.
 *
 *  - `encryptField` is a real AES-256-GCM envelope used for fields the CRM
 *    keeps at rest (see Contact.emailEncrypted). It only activates when a key
 *    is configured. When no key is present it returns null and the caller
 *    stores nothing, rather than falling back to plaintext: a missing key must
 *    fail closed, never silently downgrade.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const HASH_PEPPER = process.env.PII_HASH_PEPPER ?? "";

/** Normalised, lower-cased address. Returns "" for empty input. */
export function normaliseEmail(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.trim().toLowerCase();
}

/**
 * SHA-256 over the pepper + address. The pepper stops a copy of the database
 * from being brute-forced against a rainbow table of email addresses; it is
 * not encryption and is not treated as such.
 */
export function hashEmail(raw: string | null | undefined): string | null {
  const email = normaliseEmail(raw);
  if (!email) return null;
  return createHash("sha256").update(`${HASH_PEPPER}:${email}`).digest("hex");
}

export function hashSubject(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return null;
  return createHash("sha256").update(`${HASH_PEPPER}:${v}`).digest("hex");
}

const KEY_ENV = process.env.PII_ENCRYPTION_KEY ?? "";

function encryptionKey(): Buffer | null {
  if (!KEY_ENV) return null;
  try {
    const key = Buffer.from(KEY_ENV, "base64");
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

export function hasEncryptionKey(): boolean {
  return encryptionKey() !== null;
}

/**
 * Returns `v1:<iv>:<tag>:<ciphertext>` (all base64), or null when no key is
 * configured or the input is empty.
 */
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

/** Redacts an address for logs: `a***@example.com` or `[redacted]`. */
export function redactEmail(raw: string | null | undefined): string {
  const email = normaliseEmail(raw);
  if (!email) return "[none]";
  const at = email.indexOf("@");
  if (at <= 0) return "[redacted]";
  return `${email[0]}***${email.slice(at)}`;
}
