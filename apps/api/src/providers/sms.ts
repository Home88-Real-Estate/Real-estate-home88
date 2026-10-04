/**
 * SMS providers. No vendor adapter is installed yet: until HOME88 chooses a
 * provider, sending is refused with a clear error and nothing is queued. An
 * adapter must verify webhook signatures before reporting anything handled.
 */

import { settings } from "../settings";
import { ProviderNotConfiguredError, type ProviderHealth, type SmsProvider } from "./types";

const ADAPTERS: Record<string, () => SmsProvider> = {};

function notConfigured(provider: string | null, state: ProviderHealth["state"]): SmsProvider {
  return {
    name: provider ?? "none",
    async sendSms() {
      throw new ProviderNotConfiguredError("SMS");
    },
    getStatus() {
      return { state, provider };
    },
    async handleWebhook() {
      return { handled: false };
    },
  };
}

let override: SmsProvider | null = null;

/** Test seam: a fake provider. `null` restores the configured one. */
export function setSmsProvider(next: SmsProvider | null): void {
  override = next;
}

export async function resolveSmsProvider(): Promise<SmsProvider> {
  if (override) return override;
  let provider: string | null = null;
  try {
    const v = await settings().config("sms");
    provider = typeof v.provider === "string" ? v.provider : null;
  } catch {
    provider = null;
  }
  if (!provider) return notConfigured(null, "not_configured");
  const adapter = ADAPTERS[provider.toLowerCase()];
  return adapter ? adapter() : notConfigured(provider, "no_adapter");
}
