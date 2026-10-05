/**
 * AI assistance: drafting text for a person to review.
 *
 * Three rules shape everything here:
 *  1. Nothing personal leaves the system. Prompts are built from an allow-list
 *     of property facts and aggregate numbers, and free text typed by a user is
 *     refused if it contains an email address, phone number or IBAN.
 *  2. The output is a draft. It is shown to the person, never saved, sent or
 *     published by the system.
 *  3. Which provider and model, whether it is on at all, and which uses are
 *     allowed are HOME88's decisions in Settings → AI; the platform ships none.
 */

export const AI_FEATURES = [
  { key: "PROPERTY_DESCRIPTION", field: "allowDescriptions", label: "Πρόχειρη περιγραφή ακινήτου", help: "Από τα στοιχεία του ακινήτου, χωρίς στοιχεία ιδιοκτήτη ή πελάτη." },
  { key: "REPORT_SUMMARY", field: "allowReportSummaries", label: "Σύνοψη αναφοράς", help: "Από τα συγκεντρωτικά νούμερα μιας αναφοράς, χωρίς ονόματα πελατών." },
] as const;

export type AiFeatureKey = (typeof AI_FEATURES)[number]["key"];

export const AI_PROVIDERS = [{ value: "anthropic", label: "Anthropic (Claude)" }] as const;

export const AI_MODELS = [
  { value: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
  { value: "claude-opus-5-5", label: "Claude Opus 5.5" },
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
] as const;

export function isAiFeature(value: string): value is AiFeatureKey {
  return AI_FEATURES.some((f) => f.key === value);
}

// ---------------------------------------------------------------------------
// Personal data guard
// ---------------------------------------------------------------------------

export type PersonalDataKind = "email" | "phone" | "iban";

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const IBAN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,4})?\b/;
const PHONE_RUN = /(?:\+|00)?\d(?:[\d\s().-]{6,}\d)/g;

/** Kinds of personal data found in free text. Conservative: a false alarm only asks the user to rephrase. */
export function findPersonalData(text: string): PersonalDataKind[] {
  const found = new Set<PersonalDataKind>();
  if (EMAIL.test(text)) found.add("email");
  if (IBAN.test(text.toUpperCase())) found.add("iban");
  for (const run of text.match(PHONE_RUN) ?? []) {
    // A price such as 1.250.000 has dots between groups of three; a phone does not.
    if (/^\d{1,3}(?:\.\d{3})+$/.test(run.trim())) continue;
    const digits = run.replace(/\D/g, "");
    const international = /^(?:\+|00)/.test(run.trim());
    if (digits.length >= 10 && digits.length <= 15 && (international || /^(?:69\d{8}|2\d{9})$/.test(digits))) found.add("phone");
  }
  return [...found];
}

export const PERSONAL_DATA_LABELS: Record<PersonalDataKind, string> = { email: "διεύθυνση email", phone: "τηλέφωνο", iban: "IBAN" };

export function personalDataMessage(kinds: PersonalDataKind[]): string {
  return `Το κείμενο περιέχει ${kinds.map((k) => PERSONAL_DATA_LABELS[k]).join(", ")}. Αφαιρέστε το· δεν στέλνονται προσωπικά στοιχεία σε εξωτερική υπηρεσία AI.`;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

/** The only property fields a prompt may carry. Address, coordinates, owner and agent never appear. */
export const PROPERTY_FACT_FIELDS = [
  "listingType", "propertyType", "condition", "price", "monthlyRent", "area", "plotArea", "bedrooms", "bathrooms",
  "floor", "totalFloors", "yearBuilt", "yearRenovated", "heating", "energyClass", "region", "city", "areaName", "neighborhood",
  "parking", "storage", "balcony", "garden", "pool", "furnished", "petsAllowed", "seaView", "newConstruction", "hasSolar",
] as const;

export type PropertyFacts = Partial<Record<(typeof PROPERTY_FACT_FIELDS)[number], string | number | boolean | null>>;

/** Keep allow-listed, non-empty facts; everything else is dropped silently. */
export function pickPropertyFacts(source: Record<string, unknown>): PropertyFacts {
  const out: PropertyFacts = {};
  for (const key of PROPERTY_FACT_FIELDS) {
    const v = source[key];
    if (v === null || v === undefined || v === "" || v === false || v === "NOT_AVAILABLE") continue;
    if (typeof v === "number" || typeof v === "boolean") out[key] = v;
    else if (typeof v === "string") out[key] = v;
    else if (typeof v === "object" && typeof (v as { toString(): string }).toString === "function") {
      const n = Number((v as { toString(): string }).toString());
      if (Number.isFinite(n)) out[key] = n;
    }
  }
  return out;
}

const SYSTEM_RULES = [
  "Γράφεις για ένα ελληνικό γραφείο μεσιτείας ακινήτων.",
  "Χρησιμοποίησε ΜΟΝΟ τα στοιχεία που δίνονται. Μην επινοήσεις χαρακτηριστικά, αποστάσεις, τιμές ή υπηρεσίες που δεν αναφέρονται.",
  "Μην αναφέρεις προσωπικά στοιχεία, ονόματα ή στοιχεία επικοινωνίας.",
  "Μην κάνεις νομικές ή οικονομικές υποσχέσεις και μην περιγράφεις τους ενδιαφερόμενους με βάση εθνικότητα, θρησκεία, φύλο, οικογενειακή κατάσταση ή ηλικία.",
  "Επίστρεψε μόνο το κείμενο, χωρίς σχόλια, τίτλους ή markdown.",
].join(" ");

export type AiPrompt = { system: string; user: string; maxTokens: number };

export function buildDescriptionPrompt(facts: PropertyFacts, locale: "el" | "en", notes?: string | null): AiPrompt {
  const lines = Object.entries(facts).map(([k, v]) => `- ${k}: ${v}`);
  const extra = notes?.trim() ? `\nΕπιπλέον οδηγίες από τον συνεργάτη: ${notes.trim()}` : "";
  return {
    system: SYSTEM_RULES,
    user: `Γράψε πρόχειρη περιγραφή αγγελίας ${locale === "el" ? "στα ελληνικά" : "in English"}, 80 έως 160 λέξεις, σε ουδέτερο επαγγελματικό ύφος.\nΣτοιχεία ακινήτου:\n${lines.join("\n")}${extra}`,
    maxTokens: 600,
  };
}

export type ReportDigest = { title: string; period: string; scope: string; metrics: Array<{ label: string; value: string | number | null }> };

export function buildReportSummaryPrompt(report: ReportDigest): AiPrompt {
  const lines = report.metrics.map((m) => `- ${m.label}: ${m.value ?? "—"}`);
  return {
    system: SYSTEM_RULES,
    user: `Γράψε σύντομη σύνοψη 3 έως 5 προτάσεων στα ελληνικά για την αναφορά «${report.title}» (${report.period}, ${report.scope}). Σχολίασε μόνο ό,τι φαίνεται στα νούμερα και μην κάνεις προβλέψεις.\n${lines.join("\n")}`,
    maxTokens: 400,
  };
}

/** Provider output as plain text, bounded. */
export function cleanAiText(raw: string, maxChars = 4000): string {
  return raw.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, maxChars);
}
