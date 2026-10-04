/**
 * E-signature providers. The adapter for HOME88's chosen provider (and
 * signature level) is added once HOME88 chooses the provider; until then no
 * signing request can be created, so no client can be sent an untracked
 * mandate. Mandates can still be signed on paper and the signed copy uploaded.
 */

import { settings } from "../settings";
import { ProviderNotConfiguredError, type SignatureProvider } from "./types";

const ADAPTERS: Record<string, () => SignatureProvider> = {};

let override: SignatureProvider | null = null;

/** Test seam: a fake adapter. `null` restores the configured provider. */
export function setSignatureProvider(next: SignatureProvider | null): void {
  override = next;
}

export async function resolveSignatureProvider(): Promise<SignatureProvider> {
  if (override) return override;
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
