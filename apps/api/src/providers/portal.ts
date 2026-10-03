/**
 * Portal providers: the catalogue entry (what a portal needs) joined with the
 * listing adapter in @home88/portals, when one exists. Listing a portal here
 * does not mean HOME88 uses it; each starts disabled until configured.
 */

import { PORTAL_CATALOG, portalCatalogEntry } from "@home88/domain";
import { getAdapter } from "@home88/portals";
import type { PortalProvider } from "./types";

export function portalProvider(code: string): PortalProvider | null {
  const entry = portalCatalogEntry(code);
  if (!entry) return null;
  return {
    code: entry.code,
    name: entry.name,
    transport: entry.transport,
    hasAdapter: Boolean(getAdapter(entry.code)),
    missing(values, secretsConfigured) {
      return entry.fields
        .filter((f) => f.key !== "jamesEditionId" && f.key !== "label" && f.key !== "officePhone2")
        .filter((f) => (f.type === "secret" ? !secretsConfigured[f.key] : !values[f.key]))
        .map((f) => f.label);
    },
  };
}

export function portalProviders(): PortalProvider[] {
  return PORTAL_CATALOG.map((p) => portalProvider(p.code)!).filter(Boolean);
}
