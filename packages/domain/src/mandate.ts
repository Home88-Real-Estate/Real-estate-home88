/**
 * Digital mandates (Ψηφιακές Εντολές).
 *
 * The legal text is never written here. It is the lawyer-approved template
 * version stored in Settings → Ψηφιακές Εντολές; this module only defines the
 * data fields a template may reference ({{owner.fullName}} …), renders a
 * template with them, and the mandate lifecycle.
 *
 * Rendering is strict: an unknown {{field}} is a template error (a typo would
 * otherwise print literally into a legal document) and an empty value is
 * reported as missing, so a mandate is never issued with blanks.
 */

import { DOCUMENT_MERGE_FIELDS } from "./document-fields";

export const MANDATE_STATUSES = ["DRAFT", "ISSUED", "SENT", "VIEWED", "SIGNED", "DECLINED", "EXPIRED", "CANCELLED"] as const;
export type MandateStatus = (typeof MANDATE_STATUSES)[number];

export const MANDATE_STATUS_LABELS: Record<MandateStatus | "ACTIVE" | "ENDED", string> = {
  DRAFT: "Πρόχειρη",
  ISSUED: "Έτοιμη για υπογραφή",
  SENT: "Στάλθηκε",
  VIEWED: "Ανοίχτηκε",
  SIGNED: "Υπογράφηκε",
  DECLINED: "Απορρίφθηκε",
  EXPIRED: "Έληξε ο σύνδεσμος",
  CANCELLED: "Ακυρώθηκε",
  ACTIVE: "Σε ισχύ",
  ENDED: "Έληξε η διάρκεια",
};

/** Allowed moves. SIGNED, DECLINED, EXPIRED and CANCELLED are final. */
const NEXT: Record<MandateStatus, MandateStatus[]> = {
  DRAFT: ["ISSUED", "CANCELLED"],
  ISSUED: ["SENT", "SIGNED", "CANCELLED"],
  SENT: ["VIEWED", "SIGNED", "DECLINED", "EXPIRED", "CANCELLED"],
  VIEWED: ["SIGNED", "DECLINED", "EXPIRED", "CANCELLED"],
  SIGNED: [],
  DECLINED: [],
  EXPIRED: [],
  CANCELLED: [],
};

export function canMoveMandate(from: string, to: string): boolean {
  return (NEXT[from as MandateStatus] ?? []).includes(to as MandateStatus);
}

/** A signed mandate is "in force" until its end date, then "ended"; never stored. */
export function mandateDisplayStatus(status: string, endsAt: Date | string | null, now = new Date()): string {
  if (status !== "SIGNED") return status;
  if (endsAt && new Date(endsAt) < now) return "ENDED";
  return "ACTIVE";
}

/** Who signs each mandate type. A viewing mandate is signed by the client; assignments by the owner(s). */
export const MANDATE_PRINCIPAL: Record<string, { role: "OWNER" | "CLIENT"; label: string; needsProperty: boolean; needsTerm: boolean }> = {
  VIEWING: { role: "CLIENT", label: "Ενδιαφερόμενος", needsProperty: true, needsTerm: false },
  SIMPLE_ASSIGNMENT: { role: "OWNER", label: "Ιδιοκτήτης", needsProperty: true, needsTerm: true },
  EXCLUSIVE_ASSIGNMENT: { role: "OWNER", label: "Ιδιοκτήτης", needsProperty: true, needsTerm: true },
};

// ---------------------------------------------------------------------------
// Merge fields
// ---------------------------------------------------------------------------

/**
 * The fields a template may use. Labels are what the Settings screen lists
 * for the lawyer; values come from the mandate, its parties, the property,
 * the agent and Settings → Στοιχεία εταιρείας / Νομικά στοιχεία.
 */
export const MANDATE_MERGE_FIELDS = [
  { key: "mandate.number", label: "Αριθμός εντολής" },
  { key: "mandate.date", label: "Ημερομηνία έκδοσης" },
  { key: "mandate.startDate", label: "Έναρξη ισχύος" },
  { key: "mandate.endDate", label: "Λήξη ισχύος" },
  { key: "agency.legalName", label: "Επωνυμία γραφείου" },
  { key: "agency.vatNumber", label: "ΑΦΜ γραφείου" },
  { key: "agency.taxOffice", label: "ΔΟΥ γραφείου" },
  { key: "agency.gemiNumber", label: "Αρ. ΓΕΜΗ" },
  { key: "agency.address", label: "Έδρα γραφείου" },
  { key: "agency.phone", label: "Τηλέφωνο γραφείου" },
  { key: "agency.email", label: "Email γραφείου" },
  { key: "agent.fullName", label: "Συνεργάτης" },
  { key: "principal.fullName", label: "Ονοματεπώνυμο εντολέα (όλοι οι εντολείς)" },
  { key: "principal.taxId", label: "ΑΦΜ εντολέα" },
  { key: "principal.idNumber", label: "Αρ. ταυτότητας εντολέα" },
  { key: "principal.address", label: "Διεύθυνση εντολέα" },
  { key: "principal.phone", label: "Τηλέφωνο εντολέα" },
  { key: "principal.email", label: "Email εντολέα" },
  { key: "property.reference", label: "Κωδικός ακινήτου" },
  { key: "property.type", label: "Τύπος ακινήτου" },
  { key: "property.address", label: "Διεύθυνση ακινήτου" },
  { key: "property.area", label: "Περιοχή ακινήτου" },
  { key: "property.size", label: "Εμβαδόν (m²)" },
  { key: "property.floor", label: "Όροφος" },
  { key: "property.cadastralCode", label: "ΚΑΕΚ" },
  { key: "terms.price", label: "Τιμή (€)" },
  { key: "terms.commission", label: "Αμοιβή γραφείου" },
  { key: "terms.viewingDate", label: "Ημερομηνία υπόδειξης" },
  { key: "terms.special", label: "Ειδικοί όροι" },
] as const;

export type MandateMergeKey = (typeof MANDATE_MERGE_FIELDS)[number]["key"];
const KNOWN = new Set<string>([...MANDATE_MERGE_FIELDS, ...DOCUMENT_MERGE_FIELDS].map((f) => f.key));
const LABEL: Record<string, string> = Object.fromEntries([...DOCUMENT_MERGE_FIELDS, ...MANDATE_MERGE_FIELDS].map((f) => [f.key, f.label]));

const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)*)\s*\}\}/g;

/** The distinct fields a template uses, in order of first appearance. */
export function templateFields(body: string): string[] {
  const seen: string[] = [];
  for (const m of body.matchAll(PLACEHOLDER)) if (!seen.includes(m[1]!)) seen.push(m[1]!);
  return seen;
}

/** Template problems that must be fixed in Settings before it can be used. */
export function validateTemplate(body: string): { unknown: string[]; unclosed: boolean } {
  const unknown = templateFields(body).filter((k) => !KNOWN.has(k));
  // Anything that still looks like a placeholder after the valid ones are removed.
  const unclosed = /\{\{|\}\}/.test(body.replace(PLACEHOLDER, ""));
  return { unknown, unclosed };
}

export type RenderResult =
  | { ok: true; text: string; fields: string[] }
  | { ok: false; unknown: string[]; missing: string[]; preview: string };

/**
 * Fill a template. Values are inserted as plain text. With `allowMissing`
 * the preview shows «…» for empty fields; otherwise empty fields fail.
 */
export function renderTemplate(body: string, values: Partial<Record<string, string | null | undefined>>): RenderResult {
  const { unknown, unclosed } = validateTemplate(body);
  const fields = templateFields(body);
  const missing = fields.filter((k) => KNOWN.has(k) && !(values[k] ?? "").toString().trim()).map((k) => LABEL[k] ?? k);
  const preview = body.replace(PLACEHOLDER, (_m, key: string) => {
    const v = (values[key] ?? "").toString().trim();
    return v || `«${LABEL[key] ?? key}»`;
  });
  if (unknown.length > 0 || unclosed || missing.length > 0) {
    return { ok: false, unknown: unclosed ? [...unknown, "{{ χωρίς κλείσιμο }}"] : unknown, missing, preview };
  }
  return { ok: true, text: preview, fields };
}

/** Official number from Settings → Ψηφιακές Εντολές: prefix + zero-padded sequence. */
export function formatMandateNumber(prefix: string, digits: number, sequence: number): string {
  return `${prefix}-${String(sequence).padStart(Math.max(1, digits), "0")}`;
}

/** Settings required before mandates can be issued or sent for signature. */
export function mandateSettingsMissing(
  v: { numberingPrefix?: unknown; numberingDigits?: unknown; signingExpiryDays?: unknown; signatureProvider?: unknown; signatureLevel?: unknown },
  forSending: boolean,
): string[] {
  const missing: string[] = [];
  if (!(typeof v.numberingPrefix === "string" && v.numberingPrefix.trim())) missing.push("Πρόθεμα αρίθμησης");
  if (!(typeof v.numberingDigits === "number" && v.numberingDigits > 0)) missing.push("Ψηφία αριθμού");
  if (forSending) {
    if (!(typeof v.signatureProvider === "string" && v.signatureProvider.trim())) missing.push("Πάροχος υπογραφής");
    if (!(typeof v.signatureLevel === "string" && v.signatureLevel.trim())) missing.push("Επίπεδο υπογραφής");
    if (!(typeof v.signingExpiryDays === "number" && v.signingExpiryDays > 0)) missing.push("Λήξη συνδέσμου υπογραφής");
  }
  return missing;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const DOCUMENT_CATEGORY_LABELS: Record<string, string> = {
  CONTRACT: "Συμβόλαιο",
  DEED: "Τίτλος ιδιοκτησίας",
  ID_VERIFICATION: "Ταυτοποίηση",
  TAX: "Φορολογικό",
  INSPECTION: "Έλεγχος / πιστοποιητικό",
  APPRAISAL: "Εκτίμηση",
  INVOICE: "Παραστατικό",
  MANDATE: "Εντολή",
  OTHER: "Άλλο",
};

/** File types accepted for documents, by declared type and the bytes they must start with. */
export const DOCUMENT_TYPES: Record<string, { ext: string; magic: number[][] }> = {
  "application/pdf": { ext: "pdf", magic: [[0x25, 0x50, 0x44, 0x46]] },
  "image/jpeg": { ext: "jpg", magic: [[0xff, 0xd8, 0xff]] },
  "image/png": { ext: "png", magic: [[0x89, 0x50, 0x4e, 0x47]] },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { ext: "docx", magic: [[0x50, 0x4b, 0x03, 0x04]] },
};

/** True when the first bytes match the declared type. */
export function sniffMatches(mimeType: string, head: Uint8Array): boolean {
  const t = DOCUMENT_TYPES[mimeType];
  if (!t) return false;
  return t.magic.some((sig) => sig.every((b, i) => head[i] === b));
}
