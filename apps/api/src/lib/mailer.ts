/**
 * Outbound mail.
 *
 * Two rules are enforced here rather than in the calling code, because they
 * must not depend on a caller remembering them:
 *
 *   1. A MARKETING message is refused when the address is in the suppression
 *      list. The suppression table is consulted by the mailer itself, so no
 *      code path can send commercial mail around it.
 *   2. Every send is recorded in EmailLog before it leaves, so "did we email
 *      this person" is answerable even when delivery fails.
 *
 * With no SMTP_HOST the transport is a no-op that writes to stdout: nothing is
 * delivered by accident during development.
 */

import nodemailer, { type Transporter } from "nodemailer";
import type { Prisma } from "@home88/database";
import { loadConfig } from "../config";
import { hashEmail, redactEmail } from "./pii";
import { db } from "./prisma";

export type MailCategory = "TRANSACTIONAL" | "MARKETING";

export type SendMailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  category: MailCategory;
  template?: string;
  consentRecordId?: string | null;
  metadata?: Record<string, unknown>;
};

export type SendMailResult =
  | { ok: true; emailLogId: string; delivered: boolean }
  | { ok: false; emailLogId: string | null; reason: "suppressed" | "no_recipient" };

let transporter: Transporter | null | undefined;

function getTransporter(): Transporter | null {
  if (transporter !== undefined) return transporter;
  const cfg = loadConfig();
  if (!cfg.SMTP_HOST) {
    transporter = null;
    return null;
  }
  transporter = nodemailer.createTransport({
    host: cfg.SMTP_HOST,
    port: cfg.SMTP_PORT,
    secure: cfg.SMTP_PORT === 465,
    auth: cfg.SMTP_USER ? { user: cfg.SMTP_USER, pass: cfg.SMTP_PASSWORD } : undefined,
  });
  return transporter;
}

export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  const cfg = loadConfig();
  const to = input.to.trim();
  if (!to) return { ok: false, emailLogId: null, reason: "no_recipient" };

  if (input.category === "MARKETING") {
    const emailHash = hashEmail(to);
    if (emailHash) {
      const suppressed = await db().emailSuppression.findUnique({ where: { emailHash } });
      if (suppressed) {
        console.warn(
          `[home88:api] marketing mail to ${redactEmail(to)} refused: ${suppressed.reason}`,
        );
        return { ok: false, emailLogId: null, reason: "suppressed" };
      }
    }
  }

  const log = await db().emailLog.create({
    data: {
      toEmail: to,
      subject: input.subject,
      category: input.category,
      template: input.template ?? null,
      consentRecordId: input.consentRecordId ?? null,
      metadata:
        input.metadata === undefined ? undefined : (input.metadata as Prisma.InputJsonValue),
    },
  });

  const transport = getTransporter();
  if (!transport) {
    console.log(
      `[home88:api] (log-only) ${input.category} -> ${redactEmail(to)}: ${input.subject}`,
    );
    return { ok: true, emailLogId: log.id, delivered: false };
  }

  const from = cfg.SMTP_FROM_EMAIL
    ? `"${cfg.SMTP_FROM_NAME}" <${cfg.SMTP_FROM_EMAIL}>`
    : undefined;

  const info = await transport.sendMail({
    from,
    to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });

  await db().emailLog.update({
    where: { id: log.id },
    data: { sentAt: new Date(), providerMessageId: info.messageId ?? null },
  });

  return { ok: true, emailLogId: log.id, delivered: true };
}
