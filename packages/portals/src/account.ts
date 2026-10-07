/**
 * Pure rules for portal accounts: how a credential is shown, and which
 * environment an account may act on.
 *
 * Nothing here touches a secret store. The API seals values with the settings
 * encryption key and keeps only a short, non-reversible hint (the last four
 * characters of a long value) for the masked display.
 */

export type PortalEnvironment = "TEST" | "PRODUCTION";

/** Values shorter than this reveal too much of themselves to show any tail. */
const MIN_LENGTH_FOR_HINT = 12;

/** Last four characters of a long secret, or null when even that would give too much away. */
export function credentialHint(value: string): string | null {
  const v = value.trim();
  return v.length >= MIN_LENGTH_FOR_HINT ? v.slice(-4) : null;
}

/** "********abcd" when a hint exists, otherwise a bare mask. Never derived from the secret at display time. */
export function maskedCredential(hint: string | null | undefined): string {
  return hint ? `********${hint}` : "********";
}

export type CredentialSummary = { configured: boolean; masked: string | null; changedAt: string | null };

export function summariseCredential(hint: string | null | undefined, changedAt: Date | null | undefined): CredentialSummary {
  if (!changedAt) return { configured: false, masked: null, changedAt: null };
  return { configured: true, masked: maskedCredential(hint), changedAt: changedAt.toISOString() };
}

export function isEnvironment(value: unknown): value is PortalEnvironment {
  return value === "TEST" || value === "PRODUCTION";
}

/**
 * An account may act only on the environment it was created for, and a request
 * must name the environment it expects. A caller that thinks it is working on
 * TEST while the account is PRODUCTION is refused instead of publishing live.
 */
export function checkEnvironment(account: PortalEnvironment, requested: PortalEnvironment | null | undefined): { ok: true } | { ok: false; reason: string } {
  if (!requested) return { ok: false, reason: "Δεν έχει οριστεί περιβάλλον (TEST ή PRODUCTION)." };
  if (requested !== account) return { ok: false, reason: `Ο λογαριασμός είναι ${account}, όχι ${requested}.` };
  return { ok: true };
}
