/**
 * The contract a real portal integration must satisfy.
 *
 * This is deliberately only a contract. No JamesEdition, Green Acres,
 * Spitogatos, XE or Plot behaviour is encoded here: each provider's endpoints,
 * fields and authentication come from its own documentation and account, and
 * until those are in hand an adapter must not exist. When one does, it
 * implements `PortalProvider`, declares what it really supports in
 * `capabilities`, and is registered; nothing in the CRM's data model changes.
 *
 * Methods a provider does not support are simply absent (and the matching
 * capability is false), so the UI cannot offer them and callers cannot
 * mistake "not implemented" for "succeeded".
 */

import type { PortalCapabilities } from "./capabilities";
import type { PortalErrorCode } from "./retry";
import type { PortalProperty } from "./types";

/** What an operation against a portal returned, already normalised. */
export type ProviderResult =
  | { ok: true; externalId?: string; externalUrl?: string; /** The portal's own acknowledgement, if it gives one. */ acknowledged: boolean }
  | {
      ok: false;
      code: PortalErrorCode;
      /** Safe to show staff: never a credential, token or internal URL. */
      message: string;
      /** For DUPLICATE_LISTING: the id the portal already holds, so the listing can be adopted instead of recreated. */
      externalId?: string;
    };

/**
 * What the caller supplies to one provider call besides the property. Secrets
 * are resolved on the server and handed over here for the duration of the call;
 * an adapter must never log, return or persist them.
 */
export type ProviderCallContext = {
  environment: ProviderEnvironmentName;
  /** Stable for the same account, property and payload, so a retry cannot create a second listing. */
  idempotencyKey: string;
  agencyExternalId?: string | null;
  endpointUrl?: string | null;
  credentials?: Readonly<Record<string, string>>;
};

export type ProviderListing = { externalId: string; externalUrl?: string; state: "LIVE" | "PENDING" | "REJECTED" | "REMOVED" | "UNKNOWN" };

export type ProviderEnvironment = "PRODUCTION" | "SANDBOX";
export type ProviderEnvironmentName = "TEST" | "PRODUCTION";

export interface PortalProvider {
  readonly code: string;
  /** Identifies the provider schema/API version this adapter was written against. */
  readonly schemaVersion: string;
  readonly capabilities: PortalCapabilities;

  /** Proves credentials work using the provider's own supported test call. */
  testConnection?(environment: ProviderEnvironment, ctx?: ProviderCallContext): Promise<ProviderResult>;
  /** Provider-specific checks beyond the generic validation profile. */
  validateProperty?(property: PortalProperty): { errors: string[]; warnings: string[] };
  publishProperty?(property: PortalProperty, ctx?: ProviderCallContext): Promise<ProviderResult>;
  updateProperty?(externalId: string, property: PortalProperty, ctx?: ProviderCallContext): Promise<ProviderResult>;
  unpublishProperty?(externalId: string, ctx?: ProviderCallContext): Promise<ProviderResult>;
  deleteProperty?(externalId: string): Promise<ProviderResult>;
  getListing?(externalId: string): Promise<ProviderListing | null>;
  /** Everything the portal currently has, for reconciliation. */
  listListings?(): Promise<ProviderListing[]>;
}

/**
 * Reports contract violations: a capability claimed without the method behind
 * it, or a method present while its capability is off. Run against every
 * adapter in tests so an adapter cannot overstate what it does.
 */
export function checkProviderContract(provider: PortalProvider): string[] {
  const problems: string[] = [];
  const c = provider.capabilities;
  const pairs: Array<[boolean, keyof PortalProvider, string]> = [
    [c.create, "publishProperty", "create"],
    [c.update, "updateProperty", "update"],
    [c.unpublish, "unpublishProperty", "unpublish"],
    [c.delete, "deleteProperty", "delete"],
  ];
  for (const [claimed, method, name] of pairs) {
    const has = typeof provider[method] === "function";
    if (provider.capabilities.push) {
      if (claimed && !has) problems.push(`claims ${name} but has no ${String(method)}`);
      if (!claimed && has) problems.push(`implements ${String(method)} but does not claim ${name}`);
    }
  }
  if (c.push && typeof provider.testConnection !== "function") problems.push("an API provider must implement testConnection");
  if (!provider.schemaVersion) problems.push("missing schemaVersion");
  return problems;
}
