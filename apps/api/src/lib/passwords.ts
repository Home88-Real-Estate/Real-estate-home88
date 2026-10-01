/**
 * Password hashing with scrypt (Node built-in; no native build step).
 *
 * The stored format is self-describing — `scrypt$N$salt$hash` — so the cost
 * parameter can be raised later and old hashes still verify. `maxmem` is raised
 * to accommodate the highest permitted N: the default 32 MB ceiling would make
 * a high cost throw rather than fail open.
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEYLEN = 64;
const MAXMEM = 256 * 1024 * 1024;

export function hashPassword(password: string, rounds: number): string {
  const n = 2 ** rounds;
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, KEYLEN, { N: n, r: 8, p: 1, maxmem: MAXMEM });
  return ["scrypt", String(n), salt.toString("base64"), derived.toString("base64")].join("$");
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;

  const n = Number(parts[1]);
  const saltPart = parts[2];
  const hashPart = parts[3];
  if (!Number.isInteger(n) || n < 1024 || !saltPart || !hashPart) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltPart, "base64");
    expected = Buffer.from(hashPart, "base64");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length !== KEYLEN) return false;

  const derived = scryptSync(password, salt, KEYLEN, { N: n, r: 8, p: 1, maxmem: MAXMEM });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
