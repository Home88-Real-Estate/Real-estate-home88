/**
 * E-signature providers. The adapter for HOME88's chosen provider (and
 * signature level) is added in Phase 5; until then no signing request can be
 * created, so no client can be sent an unsigned or untracked mandate.
 */

import { settings } from "../settings";
import { ProviderNotConfiguredError, type SignatureProvider } from "./types";

const ADAPTERS: Record<string, () => SignatureProvider> = {};

export async function resolveSignatureProvider(): Promise<SignatureProvider> {
  let provider: string | null = null;
  try {
    const v = await settings().config("mandates");
    provider = typeof v.signatureProvider === "string" ? v.signatureProvider : null;
  } catch {
    provider = null;
  }
  const adapter = provider ? ADAPTERS[provider.toLowerCase()] : undefined;
  if (adapter) return adapter();
  return {
    name: provider ?? "none",
    async createSigningRequest() {
      throw new ProviderNotConfiguredError("Signature");
    },
    async getEnvelopeStatus() {
      throw new ProviderNotConfiguredError("Signature");
    },
    getStatus() {
      return { state: provider ? "no_adapter" : "not_configured", provider };
    },
    async handleWebhook() {
      return { handled: false };
    },
  };
}
