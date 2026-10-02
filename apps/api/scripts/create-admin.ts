/**
 * One-time first-administrator bootstrap.
 *
 * Use this ONLY to create the very first SUPER_ADMIN on a fresh database, or
 * after a deliberate reset. It refuses to run when a SUPER_ADMIN already exists
 * (pass --force to override) and never invents or prints a password: the
 * operator supplies ADMIN_PASSWORD through the environment, the value is hashed
 * with the same scrypt routine as normal auth, and the plaintext is not stored
 * anywhere. Afterwards the administrator can change their own password from the
 * CRM security page, and further staff are added through the invitation flow.
 *
 *   DATABASE_URL=... ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='...' npm run admin:create
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { db, disconnectDb } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/passwords";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(resolve(repoRoot, ".env"));
loadEnvFile(resolve(here, "..", ".env"));

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  return value;
}

async function main(): Promise<void> {
  requireEnv("DATABASE_URL");

  const email = (process.env.ADMIN_EMAIL ?? process.env.SEED_ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (!email) {
    throw new Error("ADMIN_EMAIL is not set. It must be the first administrator's own address.");
  }
  const password = requireEnv("ADMIN_PASSWORD");
  const rounds = Number(process.env.PASSWORD_HASH_ROUNDS ?? 12);
  const firstName = process.env.ADMIN_FIRST_NAME ?? "HOME88";
  const lastName = process.env.ADMIN_LAST_NAME ?? "Admin";
  const force = process.argv.includes("--force");

  const prisma = db();

  const existingAdmin = await prisma.user.findFirst({
    where: { role: "SUPER_ADMIN" },
    select: { email: true },
  });
  if (existingAdmin && !force) {
    throw new Error(
      `A SUPER_ADMIN already exists (${existingAdmin.email}). ` +
        "Refusing to create another. Re-run with --force only if that is intended.",
    );
  }

  const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existingUser) {
    throw new Error(`A user with email ${email} already exists.`);
  }

  await prisma.user.create({
    data: {
      email,
      passwordHash: hashPassword(password, rounds),
      firstName,
      lastName,
      role: "SUPER_ADMIN",
      status: "ACTIVE",
    },
  });

  console.log(`Created SUPER_ADMIN ${email}.`);
  console.log("The password came from ADMIN_PASSWORD and was stored only as a hash.");
  console.log("Sign in at the CRM and change it from the security page.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDb();
  });
