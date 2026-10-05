/**
 * Connections: what each external service the CRM depends on is doing.
 *
 * Read-only. Provider-backed services report how their settings resolved and
 * the last delivery the system recorded; server-side settings report only
 * whether the variable is set (names are shown, values never leave the
 * server). Each row links to the Settings section that configures it, when
 * the signed-in user may open that section.
 */

import type { FastifyInstance } from "fastify";
import {
  PORTAL_CATALOG,
  providerConnectionStatus,
  serverSettingStatus,
  summariseConnections,
  type ConnectionStatus,
  type SettingsSectionKey,
} from "@home88/domain";

import { loadConfig } from "../config";
import { hasEncryptionKey } from "../lib/pii";
import { db } from "../lib/prisma";
import { storageConfigured } from "../lib/storage";
import { unsubscribeAvailable } from "../lib/unsubscribe";
import { requireAuth, requireRole } from "../plugins/auth";
import { resolveEmailProvider } from "../providers/email";
import { resolveSignatureProvider } from "../providers/signature";
import { resolveSmsProvider } from "../providers/sms";
import { aiConfig, settings } from "../settings";
import { portalView } from "./settings";

type Connection = {
  key: string;
  group: "communication" | "portals" | "server";
  name: string;
  purpose: string;
  status: ConnectionStatus;
  /** The vendor chosen in Settings (a name, never a credential). */
  provider: string | null;
  detail: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  /** Environment variables a server-side row depends on (names only). */
  variables?: string[];
  settingsHref: string | null;
};

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const latest = (...dates: Array<Date | null | undefined>) =>
  dates.reduce<Date | null>((a, b) => (b && (!a || b > a) ? b : a), null);

/** Failures that point at the provider, not at the recipient (suppressed, no address). */
const PROVIDER_FAILURE = {
  OR: [{ error: { startsWith: "Σφάλμα αποστολής" } }, { error: { startsWith: "Ο πάροχος" } }, { error: { startsWith: "Δεν παραδόθηκε" } }],
};

async function lastMessage(channel: "EMAIL" | "SMS") {
  const [ok, failed] = await Promise.all([
    db().message.findFirst({ where: { channel, status: "SENT", sentAt: { not: null } }, orderBy: { sentAt: "desc" }, select: { sentAt: true } }),
    db().message.findFirst({ where: { channel, status: "FAILED", ...PROVIDER_FAILURE }, orderBy: { createdAt: "desc" }, select: { createdAt: true, error: true } }),
  ]);
  return { ok: ok?.sentAt ?? null, failedAt: failed?.createdAt ?? null, error: failed?.error ?? null };
}

const PROVIDER_DETAIL: Record<string, string> = {
  not_configured: "Δεν έχει επιλεγεί πάροχος.",
  no_adapter: "Ο πάροχος επιλέχθηκε· η σύνδεση με το σύστημά του δεν έχει υλοποιηθεί ακόμα, οπότε δεν αποστέλλεται τίποτα.",
  environment: "Χρησιμοποιούνται οι ρυθμίσεις SMTP του server (μεταβλητές περιβάλλοντος), όχι των Ρυθμίσεων.",
};

const TRANSPORT: Record<string, string> = { API: "μέσω API", XML_FEED: "ροή XML", CSV_FEED: "ροή CSV", JSON_FEED: "ροή JSON", MANUAL: "χειροκίνητα" };

export async function connectionRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/connections", { preHandler: requireRole("MANAGER") }, async (request) => {
    const user = request.auth!.user;
    const visible = new Set(
      (await settings().visible({ id: user.id, role: user.role, name: user.email })).map((s) => s.key as SettingsSectionKey),
    );
    const link = (section: SettingsSectionKey, href: string) => (visible.has(section) ? href : null);
    const cfg = loadConfig();
    const rows: Connection[] = [];

    // --- Communication ---------------------------------------------------------

    const email = (await resolveEmailProvider()).getStatus();
    const emailSent = await db().emailLog.findFirst({ where: { sentAt: { not: null } }, orderBy: { sentAt: "desc" }, select: { sentAt: true } });
    const emailMsg = await lastMessage("EMAIL");
    const emailOk = latest(emailSent?.sentAt, emailMsg.ok);
    rows.push({
      key: "email",
      group: "communication",
      name: "Email",
      purpose: "Μηνύματα προς πελάτες, ειδοποιήσεις, προσκλήσεις και επαναφορά κωδικού.",
      status: providerConnectionStatus({ state: email.state, lastSuccessAt: emailOk, lastErrorAt: emailMsg.failedAt }),
      provider: email.provider,
      detail: email.state === "not_configured" ? "Τα email καταγράφονται αλλά δεν αποστέλλονται." : (PROVIDER_DETAIL[email.state] ?? null),
      lastSuccessAt: iso(emailOk),
      lastError: emailMsg.error,
      lastErrorAt: iso(emailMsg.failedAt),
      settingsHref: link("email", "/settings/email"),
    });

    const sms = (await resolveSmsProvider()).getStatus();
    const smsMsg = await lastMessage("SMS");
    rows.push({
      key: "sms",
      group: "communication",
      name: "SMS",
      purpose: "SMS προς πελάτες και ειδοποιήσεις συνεργατών· απεγγραφή με απάντηση STOP.",
      status: providerConnectionStatus({ state: sms.state, lastSuccessAt: smsMsg.ok, lastErrorAt: smsMsg.failedAt }),
      provider: sms.provider,
      detail: PROVIDER_DETAIL[sms.state] ?? null,
      lastSuccessAt: iso(smsMsg.ok),
      lastError: smsMsg.error,
      lastErrorAt: iso(smsMsg.failedAt),
      settingsHref: link("sms", "/settings/sms"),
    });

    const signature = (await resolveSignatureProvider()).getStatus();
    const signed = await db().mandate.findFirst({ where: { envelopeId: { not: null }, signedAt: { not: null } }, orderBy: { signedAt: "desc" }, select: { signedAt: true } });
    rows.push({
      key: "signature",
      group: "communication",
      name: "Ψηφιακή υπογραφή",
      purpose: "Αποστολή εντολών για ηλεκτρονική υπογραφή και ενημέρωση της κατάστασής τους.",
      status: providerConnectionStatus({ state: signature.state, lastSuccessAt: signed?.signedAt }),
      provider: signature.provider,
      detail:
        signature.state === "configured"
          ? null
          : `${PROVIDER_DETAIL[signature.state] ?? ""} Οι εντολές μπορούν να υπογραφούν σε χαρτί και να ανέβει το υπογεγραμμένο αντίγραφο.`.trim(),
      lastSuccessAt: iso(signed?.signedAt),
      lastError: null,
      lastErrorAt: null,
      settingsHref: link("mandates", "/settings/mandates"),
    });

    const ai = await aiConfig();
    const [aiOk, aiFailed] = await Promise.all([
      db().aiRequest.findFirst({ where: { status: "OK" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      db().aiRequest.findFirst({ where: { status: "FAILED", error: { not: "refused" } }, orderBy: { createdAt: "desc" }, select: { createdAt: true, error: true } }),
    ]);
    const aiReady = Boolean(ai.provider && ai.model && ai.hasKey);
    let aiStatus = providerConnectionStatus({ state: aiReady ? "configured" : "not_configured", lastSuccessAt: aiOk?.createdAt, lastErrorAt: aiFailed?.createdAt });
    if (aiReady && !ai.enabled) aiStatus = "DISABLED";
    rows.push({
      key: "ai",
      group: "communication",
      name: "AI βοηθός",
      purpose: "Πρόχειρες περιγραφές ακινήτων και συνόψεις αναφορών, που ελέγχει πάντα ένας άνθρωπος.",
      status: aiStatus,
      provider: ai.provider ? `${ai.provider}${ai.model ? ` · ${ai.model}` : ""}` : null,
      detail: aiStatus === "DISABLED" ? "Ο πάροχος έχει ρυθμιστεί αλλά ο AI βοηθός είναι απενεργοποιημένος." : aiReady ? null : "Δεν έχει επιλεγεί πάροχος, μοντέλο και API key.",
      lastSuccessAt: iso(aiOk?.createdAt),
      lastError: aiFailed?.error ?? null,
      lastErrorAt: iso(aiFailed?.createdAt),
      settingsHref: link("ai", "/settings/ai"),
    });

    // --- Portals -----------------------------------------------------------------

    for (const entry of PORTAL_CATALOG) {
      const v = await portalView(entry.code, false);
      const row = await db().portal.findUnique({ where: { code: entry.code }, select: { lastErrorAt: true } });
      rows.push({
        key: `portal:${v.code}`,
        group: "portals",
        name: v.name,
        purpose: `Δημοσίευση ακινήτων · ${TRANSPORT[v.transport] ?? v.transport}.`,
        status: v.integrationStatus as ConnectionStatus,
        provider: null,
        detail:
          v.integrationStatus === "PLANNED"
            ? "Υποστηρίζεται στον κατάλογο· η σύνδεση δεν έχει υλοποιηθεί ακόμα."
            : v.missing.length > 0
              ? `Λείπουν: ${v.missing.join(", ")}.`
              : null,
        lastSuccessAt: v.lastSuccessAt,
        lastError: v.lastError,
        lastErrorAt: iso(row?.lastErrorAt),
        settingsHref: link("portals", `/settings/portals/${v.code}`),
      });
    }

    // --- Server settings (hosting environment) -------------------------------------

    const [task, viewing] = await Promise.all([
      db().task.findFirst({ where: { dueNotifiedAt: { not: null } }, orderBy: { dueNotifiedAt: "desc" }, select: { dueNotifiedAt: true } }),
      db().viewing.findFirst({ where: { reminderSentAt: { not: null } }, orderBy: { reminderSentAt: "desc" }, select: { reminderSentAt: true } }),
    ]);
    const cronRan = latest(task?.dueNotifiedAt, viewing?.reminderSentAt);
    const server: Array<Omit<Connection, "group" | "provider" | "lastError" | "lastErrorAt" | "settingsHref">> = [
      {
        key: "storage",
        name: "Αποθήκευση αρχείων",
        purpose: "Φωτογραφίες ακινήτων, έγγραφα και υπογεγραμμένες εντολές.",
        status: serverSettingStatus(storageConfigured(cfg)),
        detail: storageConfigured(cfg) ? null : "Χωρίς αυτό δεν ανεβαίνουν φωτογραφίες και έγγραφα.",
        lastSuccessAt: null,
        variables: ["S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET"],
      },
      {
        key: "pii",
        name: "Κρυπτογράφηση στοιχείων πελατών",
        purpose: "Τα email, τηλέφωνα και στοιχεία ταυτότητας αποθηκεύονται κρυπτογραφημένα.",
        status: serverSettingStatus(hasEncryptionKey()),
        detail: hasEncryptionKey() ? null : "Χωρίς το κλειδί δεν αποθηκεύονται ούτε διαβάζονται στοιχεία επικοινωνίας πελατών.",
        lastSuccessAt: null,
        variables: ["PII_ENCRYPTION_KEY"],
      },
      {
        key: "reminders",
        name: "Αυτόματες υπενθυμίσεις",
        purpose: "Ειδοποιήσεις για εργασίες που λήγουν και ραντεβού που πλησιάζουν.",
        status: serverSettingStatus(Boolean(cfg.CRON_SECRET), cronRan),
        detail: cfg.CRON_SECRET
          ? cronRan
            ? null
            : "Το κλειδί υπάρχει· δεν έχει καταγραφεί ακόμα εκτέλεση. Ελέγξτε ότι ο χρονοπρογραμματιστής καλεί το /crm/api/cron/reminders."
          : "Χωρίς το κλειδί ο χρονοπρογραμματιστής δεν μπορεί να καλέσει τις υπενθυμίσεις.",
        lastSuccessAt: iso(cronRan),
        variables: ["CRON_SECRET"],
      },
      {
        key: "unsubscribe",
        name: "Σύνδεσμος διαγραφής",
        purpose: "Ο σύνδεσμος απεγγραφής που μπαίνει σε κάθε email προώθησης.",
        status: serverSettingStatus(unsubscribeAvailable()),
        detail: unsubscribeAvailable() ? "Πρέπει να έχει την ίδια τιμή στον ιστότοπο και στο CRM." : "Χωρίς αυτό δεν στέλνονται email προώθησης.",
        lastSuccessAt: null,
        variables: ["UNSUBSCRIBE_SECRET"],
      },
    ];
    for (const s of server) rows.push({ ...s, group: "server", provider: null, lastError: null, lastErrorAt: null, settingsHref: null });

    return { data: rows, summary: summariseConnections(rows.map((r) => r.status)) };
  });
}
