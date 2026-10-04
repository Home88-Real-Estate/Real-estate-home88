/**
 * Client communications and staff notifications.
 *
 * Message wording is HOME88's: templates are written in the CRM, never
 * shipped with the system. This module defines the fields a template may use,
 * renders them strictly (unknown fields are template errors, empty values are
 * reported), and the rules every send obeys:
 *
 *  - SERVICE messages are about the client's own enquiry, viewing, offer or
 *    mandate. MARKETING messages need a current marketing consent, are never
 *    sent to a suppressed address or an SMS opt-out, and carry an unsubscribe
 *    link.
 *  - Greek text cannot be sent in the GSM 7-bit alphabet, so an SMS with Greek
 *    lowercase letters is UCS-2: 70 characters per message, 67 per part.
 */

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const MESSAGE_CHANNELS = ["EMAIL", "SMS"] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

export const MESSAGE_PURPOSES = ["SERVICE", "MARKETING"] as const;
export type MessagePurpose = (typeof MESSAGE_PURPOSES)[number];
export const MESSAGE_PURPOSE_LABELS: Record<MessagePurpose, string> = {
  SERVICE: "Εξυπηρέτηση (για το αίτημα του πελάτη)",
  MARKETING: "Προώθηση (απαιτεί συγκατάθεση)",
};

export const MESSAGE_STATUS_LABELS: Record<string, string> = {
  SENT: "Στάλθηκε",
  LOGGED: "Καταγράφηκε (χωρίς πάροχο)",
  FAILED: "Απέτυχε",
  BLOCKED: "Δεν επιτρέπεται",
};

export const MESSAGE_MERGE_FIELDS = [
  { key: "contact.firstName", label: "Όνομα πελάτη" },
  { key: "contact.lastName", label: "Επώνυμο πελάτη" },
  { key: "contact.fullName", label: "Ονοματεπώνυμο πελάτη" },
  { key: "agent.fullName", label: "Συνεργάτης" },
  { key: "agent.phone", label: "Τηλέφωνο συνεργάτη" },
  { key: "agent.email", label: "Email συνεργάτη" },
  { key: "agency.name", label: "Γραφείο" },
  { key: "agency.phone", label: "Τηλέφωνο γραφείου" },
  { key: "property.reference", label: "Κωδικός ακινήτου" },
  { key: "property.title", label: "Τίτλος ακινήτου" },
  { key: "property.price", label: "Τιμή ακινήτου" },
  { key: "property.url", label: "Σύνδεσμος ακινήτου στον ιστότοπο" },
  { key: "viewing.date", label: "Ημερομηνία ραντεβού" },
  { key: "viewing.time", label: "Ώρα ραντεβού" },
] as const;

const KNOWN = new Set<string>(MESSAGE_MERGE_FIELDS.map((f) => f.key));
const LABEL: Record<string, string> = Object.fromEntries(MESSAGE_MERGE_FIELDS.map((f) => [f.key, f.label]));
const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)*)\s*\}\}/g;

export function messageTemplateProblems(text: string): { unknown: string[]; unclosed: boolean } {
  const unknown = [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]!))].filter((k) => !KNOWN.has(k));
  const unclosed = /\{\{|\}\}/.test(text.replace(PLACEHOLDER, ""));
  return { unknown, unclosed };
}

export type MessageRender = { ok: true; text: string } | { ok: false; missing: string[]; unknown: string[]; preview: string };

/** Fill a template with plain-text values; empty values are reported, never sent as blanks. */
export function renderMessage(text: string, values: Partial<Record<string, string | null | undefined>>): MessageRender {
  const { unknown, unclosed } = messageTemplateProblems(text);
  const missing = new Set<string>();
  const preview = text.replace(PLACEHOLDER, (_m, key: string) => {
    const v = (values[key] ?? "").toString().trim();
    if (!v && KNOWN.has(key)) missing.add(LABEL[key]!);
    return v || `«${LABEL[key] ?? key}»`;
  });
  if (unknown.length || unclosed || missing.size) {
    return { ok: false, missing: [...missing], unknown: unclosed ? [...unknown, "{{ χωρίς κλείσιμο }}"] : unknown, preview };
  }
  return { ok: true, text: preview };
}

// ---------------------------------------------------------------------------
// Phone numbers and SMS
// ---------------------------------------------------------------------------

/**
 * A phone number as E.164, or null. National Greek numbers (10 digits starting
 * 2 or 69) get +30; numbers already in international form are kept.
 */
export function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return null;
  if (trimmed.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.startsWith("00")) return digits.length - 2 >= 8 && digits.length - 2 <= 15 ? `+${digits.slice(2)}` : null;
  if (digits.length === 10 && /^(2|69)/.test(digits)) return `+30${digits}`;
  if (digits.length === 12 && digits.startsWith("30")) return `+${digits}`;
  return null;
}

/** True for Greek mobile numbers (+30 69…), the only ones that receive SMS. */
export function isGreekMobile(e164: string | null): boolean {
  return !!e164 && /^\+3069\d{8}$/.test(e164);
}

const GSM7 = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà".split(""),
);
const GSM7_EXT = new Set("^{}\\[~]|€".split(""));

/** Encoding and number of parts an SMS will be billed as. */
export function smsSegments(text: string): { encoding: "GSM-7" | "UCS-2"; length: number; segments: number; perSegment: number } {
  const chars = [...text];
  const gsm = chars.every((c) => GSM7.has(c) || GSM7_EXT.has(c));
  if (gsm) {
    const length = chars.reduce((n, c) => n + (GSM7_EXT.has(c) ? 2 : 1), 0);
    const perSegment = length <= 160 ? 160 : 153;
    return { encoding: "GSM-7", length, segments: Math.max(1, Math.ceil(length / perSegment)), perSegment };
  }
  const length = chars.length;
  const perSegment = length <= 70 ? 70 : 67;
  return { encoding: "UCS-2", length, segments: Math.max(1, Math.ceil(length / perSegment)), perSegment };
}

/** Inbound replies that mean "stop sending me SMS". */
export function isStopKeyword(text: string): boolean {
  const t = text.trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return ["STOP", "STOPALL", "UNSUBSCRIBE", "ΣΤΟΠ", "ΔΙΑΓΡΑΦΗ"].includes(t);
}

// ---------------------------------------------------------------------------
// Sending rules
// ---------------------------------------------------------------------------

export type SendCheckInput = {
  channel: MessageChannel;
  purpose: MessagePurpose;
  hasAddress: boolean;
  marketingConsent: boolean;
  suppressed: boolean;
  smsOptedOut: boolean;
  marketingOptedOut: boolean;
  unsubscribeAvailable: boolean;
};

/** Why a message may not be sent, or null when it may. */
export function sendBlockedReason(i: SendCheckInput): string | null {
  if (!i.hasAddress) return i.channel === "EMAIL" ? "Η επαφή δεν έχει email." : "Η επαφή δεν έχει κινητό τηλέφωνο.";
  if (i.channel === "SMS" && i.smsOptedOut) return "Ο πελάτης ζήτησε να μη λαμβάνει SMS.";
  if (i.purpose === "MARKETING") {
    if (i.marketingOptedOut || i.suppressed) return "Ο πελάτης έχει διαγραφεί από τις ενημερώσεις.";
    if (!i.marketingConsent) return "Δεν υπάρχει συγκατάθεση για ενημερώσεις προώθησης.";
    if (i.channel === "EMAIL" && !i.unsubscribeAvailable) return "Λείπει το UNSUBSCRIBE_SECRET: δεν μπορεί να μπει σύνδεσμος διαγραφής.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Staff notifications
// ---------------------------------------------------------------------------

/** Events the CRM raises; the keys match Settings → Υπενθυμίσεις & Ειδοποιήσεις. */
export type NotificationEvent =
  | "LEAD_NEW"
  | "REQUEST_NEW"
  | "PROPERTY_NEW"
  | "MATCH_NEW"
  | "VIEWING"
  | "REMINDER"
  | "MANDATE_SENT"
  | "MANDATE_VIEWED"
  | "MANDATE_SIGNED"
  | "MANDATE_EXPIRED"
  | "OFFER"
  | "TRANSACTION"
  | "TASK_DUE"
  | "PORTAL_FAILED";

/** Channels that are on for an event, given the stored matrix and the defaults. */
export function enabledChannels(
  event: string,
  stored: Array<{ event: string; channel: string; enabled: boolean }>,
  defaults: (channel: string) => boolean,
): Array<"CRM" | "EMAIL" | "SMS"> {
  return (["CRM", "EMAIL", "SMS"] as const).filter((ch) => {
    const row = stored.find((r) => r.event === event && r.channel === ch);
    return row ? row.enabled : defaults(ch);
  });
}

/** Items due between now and `horizonMinutes` from now that have not been announced yet. */
export function dueWindow(now: Date, horizonMinutes: number): { from: Date; to: Date } {
  return { from: new Date(now.getTime() - 24 * 3_600_000), to: new Date(now.getTime() + horizonMinutes * 60_000) };
}
