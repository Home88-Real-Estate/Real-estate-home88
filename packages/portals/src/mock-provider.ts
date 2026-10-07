/**
 * A portal provider that never leaves the process.
 *
 * It exercises the whole manual lifecycle (preview, publish, update, unpublish,
 * retry, every error class) without a portal account or a network call, which
 * is what lets the foundation be tested before any real contract exists. A
 * TEST account on a portal that has an adapter uses it; a PRODUCTION account
 * never does, so a mock result can never be mistaken for a live listing.
 *
 * Listing ids are derived from the property reference, so repeating a publish
 * (a retry after a timeout, say) lands on the same id instead of a second one.
 */

import { NO_CAPABILITIES, type PortalCapabilities } from "./capabilities";
import type { PortalProvider, ProviderCallContext, ProviderListing, ProviderResult } from "./provider-contract";
import type { PortalProperty } from "./types";

export const MOCK_MODES = [
  "success",
  "validation_error",
  "temporary_failure",
  "authentication_failure",
  "rate_limit",
  "duplicate",
  "timeout",
] as const;

export type MockMode = (typeof MOCK_MODES)[number];

export function isMockMode(value: unknown): value is MockMode {
  return typeof value === "string" && (MOCK_MODES as readonly string[]).includes(value);
}

export const MOCK_CAPABILITIES: PortalCapabilities = {
  ...NO_CAPABILITIES,
  push: true,
  create: true,
  update: true,
  unpublish: true,
  images: true,
  dryRun: true,
};

export const mockExternalId = (reference: string) => `mock-${reference}`;

function failure(mode: MockMode, externalId: string): ProviderResult | null {
  switch (mode) {
    case "validation_error":
      return { ok: false, code: "MISSING_REQUIRED_FIELD", message: "Το mock portal απέρριψε την αγγελία: λείπει υποχρεωτικό πεδίο." };
    case "temporary_failure":
      return { ok: false, code: "REMOTE_SERVER_ERROR", message: "Το mock portal είχε προσωρινό σφάλμα." };
    case "authentication_failure":
      return { ok: false, code: "INVALID_CREDENTIALS", message: "Το mock portal δεν δέχτηκε τα διαπιστευτήρια." };
    case "rate_limit":
      return { ok: false, code: "RATE_LIMITED", message: "Το mock portal περιόρισε τον ρυθμό αιτημάτων." };
    case "timeout":
      return { ok: false, code: "REMOTE_TIMEOUT", message: "Το mock portal δεν απάντησε εγκαίρως." };
    case "duplicate":
      return { ok: false, code: "DUPLICATE_LISTING", message: "Η αγγελία υπάρχει ήδη στο mock portal.", externalId };
    default:
      return null;
  }
}

export function createMockProvider(code: string, mode: MockMode = "success"): PortalProvider {
  return {
    code,
    schemaVersion: "mock-1",
    capabilities: MOCK_CAPABILITIES,

    async testConnection(): Promise<ProviderResult> {
      if (mode === "authentication_failure") return failure(mode, "")!;
      if (mode === "timeout" || mode === "temporary_failure") return failure(mode, "")!;
      return { ok: true, acknowledged: true };
    },

    validateProperty(_property: PortalProperty) {
      return mode === "validation_error"
        ? { errors: ["Το mock portal απαιτεί ένα πεδίο που λείπει."], warnings: [] }
        : { errors: [], warnings: [] };
    },

    async publishProperty(property: PortalProperty, _ctx?: ProviderCallContext): Promise<ProviderResult> {
      const id = mockExternalId(property.reference);
      return failure(mode, id) ?? { ok: true, externalId: id, externalUrl: `https://mock.portal.invalid/listing/${id}`, acknowledged: true };
    },

    async updateProperty(externalId: string, _property: PortalProperty, _ctx?: ProviderCallContext): Promise<ProviderResult> {
      return failure(mode === "duplicate" ? "success" : mode, externalId) ?? { ok: true, externalId, externalUrl: `https://mock.portal.invalid/listing/${externalId}`, acknowledged: true };
    },

    async unpublishProperty(externalId: string, _ctx?: ProviderCallContext): Promise<ProviderResult> {
      return failure(mode === "duplicate" ? "success" : mode, externalId) ?? { ok: true, externalId, acknowledged: true };
    },

    async getListing(externalId: string): Promise<ProviderListing | null> {
      return { externalId, state: "LIVE" };
    },
  };
}
