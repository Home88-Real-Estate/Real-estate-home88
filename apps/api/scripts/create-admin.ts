/**
 * First-administrator bootstrap.
 *
 * Makes ADMIN_EMAIL the CRM's SUPER_ADMIN without ever creating a duplicate:
 *  - looks the person up by identity-provider UID (ADMIN_AUTH_UID, e.g. the
 *    Supabase Auth user id) and by email, and reuses a matching record;
 *  - an existing SUPER_ADMIN is left as is (the UID is linked if missing), so
 *    re-running is harmless;
 *  - refuses to add a second SUPER_ADMIN (--force overrides) and refuses to
 *    raise an existing lower-role account (--promote overrides).
 *
 * Password: never invented, printed or hard-coded. With no ADMIN_PASSWORD the
 * account is created without one; it cannot sign in until its owner sets a
 * password through <CRM>/crm/forgot-password (delivered by email, so SMTP must
 * be configured on the API). ADMIN_PASSWORD, if given, must meet the password
 * policy and is stored only as a scrypt hash.
 *
 *   DATABASE_URL=... ADMIN_EMAIL=you@example.com ADMIN_AUTH_UID=<uuid> npm run admin:create
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { passwordSchema } from "@home88/validation";

import { isAuthUid, planAdminBootstrap } from "../src/lib/admin-bootstrap";
import { writeAudit } from "../src/lib/audit";
import { hashPassword } from "../src/lib/passwords";
import { db, disconnectDb } from "../src/lib/prisma";

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

const USER_FIELDS = { id: true, email: true, role: true, authUid: true } as const;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
  }

  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (!email) {
    throw new Error("ADMIN_EMAIL is not set. It must be the first administrator's own address.");
  }
  const authUid = (process.env.ADMIN_AUTH_UID ?? "").trim().toLowerCase() || null;
  if (authUid && !isAuthUid(authUid)) {
    throw new Error("ADMIN_AUTH_UID must be the identity provider's user id (a UUID).");
  }

  let passwordHash: string | null = null;
  const password = process.env.ADMIN_PASSWORD;
  if (password) {
    const checked = passwordSchema.safeParse(password);
    if (!checked.success) {
      throw new Error("ADMIN_PASSWORD does not meet the password policy (it was not printed).");
    }
    passwordHash = hashPassword(password, Number(process.env.PASSWORD_HASH_ROUNDS ?? 12));
  }

  const prisma = db();
  const [byEmail, byAuthUid] = await Promise.all([
    prisma.user.findUnique({ where: { email }, select: USER_FIELDS }),
    authUid ? prisma.user.findUnique({ where: { authUid }, select: USER_FIELDS }) : null,
  ]);
  const matchedId = byAuthUid?.id ?? byEmail?.id;
  const otherSuperAdmin = await prisma.user.findFirst({
    where: { role: "SUPER_ADMIN", ...(matchedId ? { id: { not: matchedId } } : {}) },
    select: { email: true },
  });

  const plan = planAdminBootstrap({
    email,
    authUid,
    byEmail,
    byAuthUid,
    otherSuperAdmin,
    force: process.argv.includes("--force"),
    promote: process.argv.includes("--promote"),
  });

  switch (plan.kind) {
    case "refuse":
      throw new Error(plan.reason);

    case "noop":
      if (plan.linkAuthUid) {
        await prisma.$transaction(async (tx) => {
          await tx.user.update({ where: { id: plan.userId }, data: { authUid: plan.linkAuthUid } });
          await writeAudit(
            { entity: "USER", entityId: plan.userId, action: "ADMIN_BOOTSTRAP_LINK_UID" },
            tx,
          );
        });
        console.log(`${email} is already the SUPER_ADMIN; linked it to the identity-provider UID.`);
      } else {
        console.log(`${email} is already the SUPER_ADMIN. Nothing to do.`);
      }
      break;

    case "promote":
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: plan.userId },
          data: {
            role: "SUPER_ADMIN",
            ...(plan.linkAuthUid ? { authUid: plan.linkAuthUid } : {}),
          },
        });
        await writeAudit(
          {
            entity: "USER",
            entityId: plan.userId,
            action: "ADMIN_BOOTSTRAP_PROMOTE",
            changes: { role: { from: plan.fromRole, to: "SUPER_ADMIN" } },
          },
          tx,
        );
      });
      console.log(`Promoted ${email} from ${plan.fromRole} to SUPER_ADMIN.`);
      break;

    case "create": {
      await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email,
            passwordHash,
            authUid: plan.linkAuthUid,
            firstName: process.env.ADMIN_FIRST_NAME ?? "HOME88",
            lastName: process.env.ADMIN_LAST_NAME ?? "Admin",
            role: "SUPER_ADMIN",
            status: "ACTIVE",
          },
          select: { id: true },
        });
        await writeAudit({ entity: "USER", entityId: user.id, action: "ADMIN_BOOTSTRAP_CREATE" }, tx);
      });
      console.log(`Created SUPER_ADMIN ${email}${plan.linkAuthUid ? " (linked to its UID)" : ""}.`);
      break;
    }
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { passwordHash: true } });
  if (user && !user.passwordHash) {
    const crm = `${process.env.NEXT_PUBLIC_CRM_URL ?? "<CRM origin>"}${process.env.CRM_BASE_PATH ?? "/crm"}`;
    console.log(
      `No password is set yet. Choose one at ${crm}/forgot-password; the link is emailed ` +
        "to the address above (requires SMTP on the API).",
    );
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDb();
  });
