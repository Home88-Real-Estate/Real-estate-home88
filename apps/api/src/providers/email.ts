/**
 * Email providers.
 *
 * Resolution order, decided at send time:
 *   1. SMTP entered in Settings → Email (credentials decrypted on the server);
 *   2. SMTP_* variables in the server environment (the original setup);
 *   3. log-only: nothing is delivered, and the log line carries no recipient
 *      address, link or token.
 */

import { createHash } from "node:crypto";
import nodemailer, { type Transporter } from "nodemailer";
import { loadConfig } from "../config";
import { smtpFromSettings, type SmtpSettings } from "../settings";
import type { EmailProvider, EmailSendResult, OutboundEmail, ProviderHealth } from "./types";

type SmtpProviderConfig = SmtpSettings & { source: "settings" | "environment" };

const transports = new Map<string, Transporter>();

function transportFor(cfg: SmtpProviderConfig): Transporter {
  // Keyed by a digest so a changed password builds a new transport; the map
  // never holds the password as a key.
  const key = createHash("sha256").update(JSON.stringify(cfg)).digest("hex");
  let transport = transports.get(key);
  if (!transport) {
    transports.clear();
    transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      requireTLS: cfg.tls && cfg.port !== 465,
      auth: cfg.username ? { user: cfg.username, pass: cfg.password ?? "" } : undefined,
    });
    transports.set(key, transport);
  }
  return transport;
}

export function createSmtpEmailProvider(cfg: SmtpProviderConfig): EmailProvider {
  return {
    name: cfg.source === "settings" ? "SMTP" : "SMTP (περιβάλλον)",
    async send(message: OutboundEmail): Promise<EmailSendResult> {
      const from = !cfg.fromEmail
        ? undefined
        : cfg.fromName
          ? `"${cfg.fromName.replace(/"/g, "")}" <${cfg.fromEmail}>`
          : cfg.fromEmail;
      const info = await transportFor(cfg).sendMail({
        from,
        to: message.to,
        replyTo: message.replyTo ?? cfg.replyTo ?? undefined,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      return { delivered: true, providerMessageId: info.messageId ?? null };
    },
    getStatus(): ProviderHealth {
      return { state: cfg.source === "settings" ? "configured" : "environment", provider: "SMTP" };
    },
    async handleWebhook() {
      return { handled: false };
    },
  };
}

export const logOnlyEmailProvider: EmailProvider = {
  name: "log-only",
  // The mailer logs the undelivered message (category, redacted recipient, subject).
  async send() {
    return { delivered: false, providerMessageId: null };
  },
  getStatus() {
    return { state: "not_configured", provider: null };
  },
  async handleWebhook() {
    return { handled: false };
  },
};

function smtpFromEnvironment(): SmtpProviderConfig | null {
  const cfg = loadConfig();
  if (!cfg.SMTP_HOST) return null;
  return {
    source: "environment",
    host: cfg.SMTP_HOST,
    port: cfg.SMTP_PORT,
    username: cfg.SMTP_USER || null,
    password: cfg.SMTP_PASSWORD || null,
    tls: true,
    fromName: cfg.SMTP_FROM_NAME || null,
    fromEmail: cfg.SMTP_FROM_EMAIL,
    replyTo: null,
  };
}

export async function resolveEmailProvider(): Promise<EmailProvider> {
  const fromSettings = await smtpFromSettings();
  if (fromSettings) return createSmtpEmailProvider({ ...fromSettings, source: "settings" });
  const fromEnv = smtpFromEnvironment();
  if (fromEnv) return createSmtpEmailProvider(fromEnv);
  return logOnlyEmailProvider;
}
