/**
 * Vendor-neutral provider contracts.
 *
 * The CRM talks to these interfaces only. Which vendor sits behind each one
 * is a setting (Settings → Email / SMS / Ψηφιακές Εντολές / Portals), so
 * changing provider later is configuration plus one adapter, never a rewrite
 * of the code that sends a reminder or a mandate.
 *
 * Credentials reach an adapter on the server only, from the settings service;
 * no adapter logs them or returns them.
 */

export type ProviderState =
  /** Settings complete; the adapter will send. */
  | "configured"
  /** Using the server environment's settings (fallback). */
  | "environment"
  /** Settings present but the vendor adapter is not available yet. */
  | "no_adapter"
  /** Nothing is sent. */
  | "not_configured";

export type ProviderHealth = { state: ProviderState; provider: string | null; detail?: string };

export type WebhookResult = { handled: boolean; status?: string };

export class ProviderNotConfiguredError extends Error {
  constructor(kind: string) {
    super(`${kind} provider is not configured.`);
    this.name = "ProviderNotConfiguredError";
  }
}

// --- Email ---------------------------------------------------------------------

export type OutboundEmail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string | null;
};

export type EmailSendResult = { delivered: boolean; providerMessageId: string | null };

export interface EmailProvider {
  readonly name: string;
  send(message: OutboundEmail): Promise<EmailSendResult>;
  getStatus(): ProviderHealth;
  handleWebhook(payload: unknown, headers: Record<string, string>): Promise<WebhookResult>;
}

// --- SMS -----------------------------------------------------------------------

export type OutboundSms = {
  to: string;
  text: string;
  /** What the message is about, kept with the delivery record. */
  kind: "REMINDER" | "VIEWING" | "MANDATE" | "MARKETING" | "OTHER";
  related?: { contactId?: string; propertyId?: string; mandateId?: string; viewingId?: string };
};

export type SmsSendResult = { accepted: boolean; providerMessageId: string | null };

export interface SmsProvider {
  readonly name: string;
  sendSms(message: OutboundSms): Promise<SmsSendResult>;
  getStatus(): ProviderHealth;
  handleWebhook(payload: unknown, headers: Record<string, string>): Promise<WebhookResult>;
}

// --- E-signature ---------------------------------------------------------------

export type SigningRequest = {
  documentId: string;
  /** SHA-256 of the exact PDF being signed. */
  documentChecksum: string;
  title: string;
  signers: Array<{ name: string; email: string | null; phone: string | null }>;
  level: "SIMPLE" | "ADVANCED" | "QUALIFIED";
  expiresAt: Date;
};

export type SigningEnvelope = { envelopeId: string; signingUrls: Array<{ signer: number; url: string }> };

export interface SignatureProvider {
  readonly name: string;
  createSigningRequest(request: SigningRequest): Promise<SigningEnvelope>;
  getEnvelopeStatus(envelopeId: string): Promise<"SENT" | "VIEWED" | "SIGNED" | "DECLINED" | "EXPIRED">;
  getStatus(): ProviderHealth;
  handleWebhook(payload: unknown, headers: Record<string, string>): Promise<WebhookResult>;
}

// --- Portals -------------------------------------------------------------------

export interface PortalProvider {
  readonly code: string;
  readonly name: string;
  readonly transport: "API" | "XML_FEED" | "CSV_FEED" | "JSON_FEED" | "MANUAL";
  /** True when a listing adapter exists in @home88/portals. */
  readonly hasAdapter: boolean;
  /** Fields that must be filled before the portal can be enabled. */
  missing(values: Record<string, unknown>, secretsConfigured: Record<string, boolean>): string[];
}
