/**
 * Decides what the first-administrator bootstrap may do, given what already
 * exists. Kept free of I/O so every branch is unit-tested; the script in
 * scripts/create-admin.ts only gathers the facts and applies the plan.
 *
 * Invariants:
 *  - one person is one staff record: lookups go by identity-provider UID first,
 *    then by email, and a UID/email pair that points at two different records
 *    (or a record already linked to another UID) is refused, never merged;
 *  - an existing SUPER_ADMIN is reused, never recreated or overwritten;
 *  - a second SUPER_ADMIN is created only with an explicit --force;
 *  - an existing lower-role account is promoted only with an explicit --promote.
 */

export type BootstrapUser = {
  id: string;
  email: string;
  role: string;
  authUid: string | null;
};

export type BootstrapFacts = {
  email: string;
  authUid: string | null;
  /** The user whose email matches, if any. */
  byEmail: BootstrapUser | null;
  /** The user already linked to authUid, if any. */
  byAuthUid: BootstrapUser | null;
  /** Any SUPER_ADMIN other than the matched user, if one exists. */
  otherSuperAdmin: { email: string } | null;
  force: boolean;
  promote: boolean;
};

export type BootstrapPlan =
  | { kind: "create"; linkAuthUid: string | null }
  | { kind: "noop"; userId: string; linkAuthUid: string | null }
  | { kind: "promote"; userId: string; fromRole: string; linkAuthUid: string | null }
  | { kind: "refuse"; reason: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAuthUid(value: string): boolean {
  return UUID.test(value);
}

export function planAdminBootstrap(facts: BootstrapFacts): BootstrapPlan {
  const { byEmail, byAuthUid, authUid } = facts;

  if (byEmail && byAuthUid && byEmail.id !== byAuthUid.id) {
    return {
      kind: "refuse",
      reason:
        `The UID is already linked to ${byAuthUid.email}, but ${facts.email} is a different ` +
        "staff record. Resolve this by hand; nothing was changed.",
    };
  }

  const existing = byAuthUid ?? byEmail;

  if (existing) {
    if (existing.email !== facts.email) {
      return {
        kind: "refuse",
        reason: `The UID belongs to ${existing.email}, not ${facts.email}. Nothing was changed.`,
      };
    }
    if (authUid && existing.authUid && existing.authUid !== authUid) {
      return {
        kind: "refuse",
        reason: `${facts.email} is already linked to a different UID. Nothing was changed.`,
      };
    }
    const linkAuthUid = authUid && !existing.authUid ? authUid : null;

    if (existing.role === "SUPER_ADMIN") {
      return { kind: "noop", userId: existing.id, linkAuthUid };
    }
    if (!facts.promote) {
      return {
        kind: "refuse",
        reason:
          `${facts.email} already exists as ${existing.role}. Re-run with --promote to make ` +
          "that account the SUPER_ADMIN.",
      };
    }
    if (facts.otherSuperAdmin && !facts.force) {
      return {
        kind: "refuse",
        reason:
          `A SUPER_ADMIN already exists (${facts.otherSuperAdmin.email}). ` +
          "Re-run with --force only if a second one is intended.",
      };
    }
    return { kind: "promote", userId: existing.id, fromRole: existing.role, linkAuthUid };
  }

  if (facts.otherSuperAdmin && !facts.force) {
    return {
      kind: "refuse",
      reason:
        `A SUPER_ADMIN already exists (${facts.otherSuperAdmin.email}). ` +
        "Refusing to create another. Re-run with --force only if that is intended.",
    };
  }
  return { kind: "create", linkAuthUid: authUid };
}
