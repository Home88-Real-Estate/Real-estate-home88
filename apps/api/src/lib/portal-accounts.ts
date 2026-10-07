/**
 * Portal accounts: the agency's connections to a portal, one per portal and
 * environment (a TEST account and a PRODUCTION account are separate rows).
 *
 * Credentials are sealed with the settings encryption key into
 * provider_credentials under the scope "portal-account:<id>", exactly as portal
 * and provider settings already are. The account row keeps only whether each
 * value is set, when it last changed and a four-character hint for the masked
 * display. Nothing here returns, logs or audits a secret value.
 */

import { portalCatalogEntry } from "@home88/domain";
import { credentialHint, getAdapter, isMockMode, createMockProvider, summariseCredential, type CredentialSummary, type PortalProvider } from "@home88/portals";
import type { PortalAccount, Portal } from "@home88/database";
import { conflict } from "./errors";
import { db } from "./prisma";
import { secretBoxFromEnv, SecretUnreadableError } from "../settings/secret-box";

export const accountScope = (accountId: string) => `portal-account:${accountId}`;

export type SecretFieldDef = { key: string; label: string };

/** The secret fields the portal's catalogue entry declares; a generic API key when it declares none. */
export function accountSecretFields(portalCode: string): SecretFieldDef[] {
  const fields = (portalCatalogEntry(portalCode)?.fields ?? []).filter((f) => f.type === "secret").map((f) => ({ key: f.key, label: f.label }));
  return fields.length > 0 ? fields : [{ key: "apiKey", label: "API key" }];
}

type Hints = Record<string, string | null>;
const hintsOf = (account: Pick<PortalAccount, "credentialHints">): Hints => ((account.credentialHints ?? {}) as Hints) ?? {};

export type PortalAccountView = {
  id: string;
  portalCode: string;
  portalName: string;
  accountName: string;
  agencyExternalId: string | null;
  endpointUrl: string | null;
  environment: "TEST" | "PRODUCTION";
  status: string;
  enabled: boolean;
  /** TEST accounts on a portal without a verified contract run against the mock provider. */
  providerKind: "mock" | "none" | "real";
  /** Only meaningful on TEST accounts using the mock provider. */
  mockMode: string | null;
  credentials: Record<string, CredentialSummary & { label: string }>;
  credentialRotatedAt: string | null;
  lastConnectionTestAt: string | null;
  lastConnectionTestStatus: string | null;
  lastSuccessfulSyncAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  updatedAt: string;
};

export async function accountView(account: PortalAccount & { portal: Pick<Portal, "code" | "name" | "transport"> }, showErrors = true): Promise<PortalAccountView> {
  const meta = await db().providerCredential.findMany({ where: { scope: accountScope(account.id) }, select: { field: true, updatedAt: true } });
  const hints = hintsOf(account);
  const credentials: PortalAccountView["credentials"] = {};
  for (const f of accountSecretFields(account.portal.code)) {
    const m = meta.find((x) => x.field === f.key);
    credentials[f.key] = { ...summariseCredential(hints[f.key], m?.updatedAt), label: f.label };
  }
  const resolved = resolvePortalProvider(account.portal, account);
  return {
    id: account.id,
    portalCode: account.portal.code,
    portalName: account.portal.name,
    accountName: account.accountName,
    agencyExternalId: account.agencyExternalId,
    endpointUrl: account.endpointUrl,
    environment: account.environment,
    status: account.status,
    enabled: account.enabled,
    providerKind: resolved ? (resolved.mock ? "mock" : "real") : "none",
    mockMode: account.environment === "TEST" && typeof (account.settings as Record<string, unknown> | null)?.mockMode === "string" ? String((account.settings as Record<string, unknown>).mockMode) : null,
    credentials,
    credentialRotatedAt: account.credentialRotatedAt?.toISOString() ?? null,
    lastConnectionTestAt: account.lastConnectionTestAt?.toISOString() ?? null,
    lastConnectionTestStatus: account.lastConnectionTestStatus,
    lastSuccessfulSyncAt: account.lastSuccessfulSyncAt?.toISOString() ?? null,
    lastErrorCode: account.lastErrorCode,
    // The portal's own wording stays with those allowed to read it.
    lastErrorMessage: showErrors ? account.lastErrorMessage : account.lastErrorCode ? "Η τελευταία ενέργεια απέτυχε." : null,
    updatedAt: account.updatedAt.toISOString(),
  };
}

/** Seals and stores new values, removes cleared ones, and refreshes the hints. Returns the changed field names. */
export async function storeCredentials(account: PortalAccount, portalCode: string, secrets: Record<string, string>, clear: string[], actorId: string): Promise<string[]> {
  const allowed = new Set(accountSecretFields(portalCode).map((f) => f.key));
  const puts = Object.entries(secrets).filter(([, v]) => v.length > 0);
  for (const [field] of puts) if (!allowed.has(field)) throw conflict(`Άγνωστο πεδίο διαπιστευτηρίων: ${field}.`);
  const clears = clear.filter((f) => allowed.has(f) && !(f in secrets));

  if (puts.length === 0 && clears.length === 0) return [];
  const box = secretBoxFromEnv();
  if (puts.length > 0 && !box) throw conflict("Δεν έχει ρυθμιστεί κλειδί κρυπτογράφησης (SETTINGS_ENCRYPTION_KEY)· τα διαπιστευτήρια δεν μπορούν να αποθηκευτούν.");

  const scope = accountScope(account.id);
  const hints = { ...hintsOf(account) };
  await db().$transaction(async (tx) => {
    for (const [field, value] of puts) {
      const envelope = box!.seal(scope, field, value);
      await tx.providerCredential.upsert({
        where: { scope_field: { scope, field } },
        create: { scope, field, ...envelope, updatedById: actorId },
        update: { ...envelope, updatedById: actorId },
      });
      hints[field] = credentialHint(value);
    }
    if (clears.length > 0) {
      await tx.providerCredential.deleteMany({ where: { scope, field: { in: clears } } });
      for (const f of clears) delete hints[f];
    }
    await tx.portalAccount.update({ where: { id: account.id }, data: { credentialHints: hints, credentialRotatedAt: new Date(), updatedById: actorId } });
  });
  return [...puts.map(([f]) => f), ...clears];
}

/** Decrypted values for one provider call. Server-side only: never returned by a route, never logged. */
export async function readCredentials(accountId: string): Promise<Record<string, string>> {
  const rows = await db().providerCredential.findMany({ where: { scope: accountScope(accountId) } });
  if (rows.length === 0) return {};
  const box = secretBoxFromEnv();
  if (!box) return {};
  const out: Record<string, string> = {};
  for (const row of rows) {
    try {
      out[row.field] = box.open(accountScope(accountId), row.field, { ciphertext: row.ciphertext, iv: row.iv, authTag: row.authTag, keyId: row.keyId });
    } catch (error) {
      if (!(error instanceof SecretUnreadableError)) throw error;
    }
  }
  return out;
}

// --- Providers ------------------------------------------------------------------

/**
 * Real provider adapters register here once a portal's official contract is
 * in hand. None exists today, so a PRODUCTION account has no provider and
 * cannot publish; a mock result can never pass for a live listing.
 */
const realProviders = new Map<string, PortalProvider>();
export const registerRealPortalProvider = (provider: PortalProvider) => realProviders.set(provider.code.toUpperCase(), provider);
export const clearRealPortalProviders = () => realProviders.clear();

export type ResolvedProvider = { provider: PortalProvider; mock: boolean };

export function resolvePortalProvider(
  portal: Pick<Portal, "code" | "transport">,
  account: Pick<PortalAccount, "environment" | "settings">,
): ResolvedProvider | null {
  const real = realProviders.get(portal.code.toUpperCase());
  if (account.environment === "PRODUCTION") return real ? { provider: real, mock: false } : null;

  // TEST: a real sandbox provider when one exists, otherwise the in-process mock,
  // and only for a portal that has an adapter in this repository.
  if (real) return { provider: real, mock: false };
  const adapter = getAdapter(portal.code);
  if (!adapter || adapter.transport === "MANUAL") return null;
  const rawMode = ((account.settings ?? {}) as Record<string, unknown>).mockMode;
  return { provider: createMockProvider(portal.code, isMockMode(rawMode) ? rawMode : "success"), mock: true };
}
