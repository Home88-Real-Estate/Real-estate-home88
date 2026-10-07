/**
 * Encryption for provider secrets (SMTP passwords, API keys, portal and
 * signature credentials).
 *
 * AES-256-GCM with a fresh 12-byte IV per value. The (scope, field) pair is
 * bound as associated data, so an envelope copied onto another field fails to
 * decrypt instead of quietly becoming that field's secret. The key comes from
 * SETTINGS_ENCRYPTION_KEY in the server environment (32 bytes, base64 or hex)
 * and is read at call time; it is never stored next to the data it protects.
 *
 * Nothing in this module logs, and nothing outside apps/api imports it: the
 * CRM and the website only ever learn whether a secret is configured.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export type SecretEnvelope = { ciphertext: string; iv: string; authTag: string; keyId: string };

/** Marker in the associated data. Also lets a bundle check prove this file never reaches a browser. */
export const SECRET_AAD_PREFIX = "h88-settings-secret-v1";

export class SecretKeyMissingError extends Error {
  constructor() {
    super("SETTINGS_ENCRYPTION_KEY is not configured.");
    this.name = "SecretKeyMissingError";
  }
}

export class SecretUnreadableError extends Error {
  constructor(reason: string) {
    super(`Stored secret cannot be decrypted (${reason}).`);
    this.name = "SecretUnreadableError";
  }
}

export function parseKey(raw: string | undefined | null): Buffer | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const candidates: Buffer[] = [];
  if (/^[0-9a-fA-F]{64}$/.test(value)) candidates.push(Buffer.from(value, "hex"));
  try {
    candidates.push(Buffer.from(value, "base64"));
  } catch {
    // not base64
  }
  return candidates.find((k) => k.length === 32) ?? null;
}

export type KeyState = "missing" | "valid" | "invalid";

/**
 * What the environment actually holds: absent/blank, a usable 32-byte key, or
 * a value that looks configured but cannot be parsed as a key. "invalid" is a
 * misconfiguration worth failing over at startup; "missing" is a legitimate
 * degraded state (the API refuses to read secrets but boots) and is reported
 * separately. The value itself is never returned.
 */
export function parseKeyState(raw: string | undefined | null): KeyState {
  if (parseKey(raw)) return "valid";
  return (raw ?? "").trim() ? "invalid" : "missing";
}

/** Short, non-reversible id of a key, to notice when the key has been rotated. */
export function keyIdOf(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 12);
}

const aad = (scope: string, field: string) => Buffer.from(`${SECRET_AAD_PREFIX}|${scope}|${field}`, "utf8");

export type SecretBox = {
  readonly keyId: string;
  seal(scope: string, field: string, plaintext: string): SecretEnvelope;
  open(scope: string, field: string, envelope: SecretEnvelope): string;
};

export function createSecretBox(key: Buffer): SecretBox {
  if (key.length !== 32) throw new Error("Settings encryption key must be 32 bytes.");
  const keyId = keyIdOf(key);
  return {
    keyId,
    seal(scope, field, plaintext) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(aad(scope, field));
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return {
        ciphertext: ciphertext.toString("base64"),
        iv: iv.toString("base64"),
        authTag: cipher.getAuthTag().toString("base64"),
        keyId,
      };
    },
    open(scope, field, envelope) {
      if (envelope.keyId !== keyId) throw new SecretUnreadableError("written with a different key");
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
        decipher.setAAD(aad(scope, field));
        decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
        return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8");
      } catch {
        throw new SecretUnreadableError("authentication failed");
      }
    },
  };
}

/** The box for the current environment, or null when no valid key is set. */
export function secretBoxFromEnv(env: NodeJS.ProcessEnv = process.env): SecretBox | null {
  const key = parseKey(env.SETTINGS_ENCRYPTION_KEY);
  return key ? createSecretBox(key) : null;
}
