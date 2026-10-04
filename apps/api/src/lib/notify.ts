/**
 * Staff notifications.
 *
 * One entry point for every event the CRM raises (new lead, signed mandate,
 * task due…). Which channels fire is the matrix in Settings → Υπενθυμίσεις &
 * Ειδοποιήσεις: in-CRM notices are on by default, email and SMS only when
 * switched on. A notification never carries client contact details, only what
 * happened and a link into the CRM.
 *
 * Notifying never fails the action that caused it: problems are logged by
 * name and swallowed.
 */

import { defaultNotificationEnabled, enabledChannels, isGreekMobile, normalisePhone, type NotificationEvent } from "@home88/domain";

import { loadConfig } from "../config";
import { resolveSmsProvider } from "../providers/sms";
import { ProviderNotConfiguredError } from "../providers/types";
import { sendMail } from "./mailer";
import { db } from "./prisma";

export type NotifyInput = {
  event: NotificationEvent;
  title: string;
  entityType: string;
  entityId: string;
  /** Users to tell. Empty or all-null: the managers (and an office-wide in-CRM notice). */
  userIds?: Array<string | null | undefined>;
  /** CRM path to open, e.g. /mandates/<id>. */
  link?: string;
};

export type NotifyResult = { channels: string[]; crm: number; email: number; sms: number };

const crmLink = (path?: string) => {
  if (!path) return null;
  const cfg = loadConfig();
  const base = cfg.CRM_BASE_PATH.replace(/\/+$/, "");
  return `${cfg.CRM_URL.replace(/\/+$/, "")}${base}${path}`;
};

export async function notify(input: NotifyInput): Promise<NotifyResult> {
  const result: NotifyResult = { channels: [], crm: 0, email: 0, sms: 0 };
  try {
    const stored = await db().notificationSetting.findMany({ where: { event: input.event } });
    const channels = enabledChannels(input.event, stored, defaultNotificationEnabled);
    result.channels = channels;
    if (channels.length === 0) return result;

    const ids = [...new Set((input.userIds ?? []).filter((x): x is string => !!x))];
    const users = ids.length
      ? await db().user.findMany({ where: { id: { in: ids }, status: "ACTIVE" }, select: { id: true, email: true, phone: true } })
      : await db().user.findMany({ where: { role: { in: ["MANAGER", "ADMIN", "SUPER_ADMIN"] }, status: "ACTIVE" }, select: { id: true, email: true, phone: true } });

    if (channels.includes("CRM")) {
      const rows = ids.length ? users.map((u) => u.id) : [null];
      await db().crmNotification.createMany({
        data: rows.map((userId) => ({ kind: input.event, title: input.title, entityType: input.entityType, entityId: input.entityId, userId })),
      });
      result.crm = rows.length;
    }

    const link = crmLink(input.link);
    if (channels.includes("EMAIL")) {
      for (const u of users) {
        const sent = await sendMail({
          to: u.email,
          subject: input.title,
          text: [input.title, link ? `\n${link}` : ""].join(""),
          category: "TRANSACTIONAL",
          template: `notify:${input.event}`,
          metadata: { entityType: input.entityType, entityId: input.entityId },
        });
        if (sent.ok) result.email += 1;
      }
    }

    if (channels.includes("SMS")) {
      const provider = await resolveSmsProvider();
      for (const u of users) {
        const to = normalisePhone(u.phone);
        if (!isGreekMobile(to)) continue;
        try {
          await provider.sendSms({ to: to!, text: input.title.slice(0, 300), kind: input.event === "TASK_DUE" || input.event === "REMINDER" ? "REMINDER" : "OTHER" });
          result.sms += 1;
        } catch (error) {
          if (error instanceof ProviderNotConfiguredError) break;
          throw error;
        }
      }
    }
  } catch (error) {
    console.warn(`[home88:notify] ${input.event} not fully delivered (${error instanceof Error ? error.name : "Error"})`);
  }
  return result;
}
