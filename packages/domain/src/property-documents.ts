/**
 * The legal and technical document checklist of a property.
 *
 * This is document TRACKING, not legal advice: which papers are usually
 * gathered for a listing or a transaction in Greece depends on the property,
 * the transaction and the case, and a lawyer and an engineer decide what a
 * given case needs. The suggestions below are a starting point the office can
 * change here in one place; every item can be marked "not required".
 *
 * Statuses are explicit and separate from the property's own data: a complete
 * checklist never means a property is legally transferable, and only a
 * manager (or above) can mark a document as verified or rejected.
 */

export type DocumentItemKind =
  | "TITLE_DEED" | "PRIOR_TITLES" | "CADASTRE" | "TOPOGRAPHIC" | "BUILDING_PERMIT" | "ENGINEER_CERT"
  | "BUILDING_ID" | "ENERGY_CERT" | "TAX" | "MANDATE" | "LEASE" | "OTHER";

export type DocumentItemStatus = "NOT_REQUIRED" | "PENDING" | "REQUESTED" | "UPLOADED" | "IN_REVIEW" | "VERIFIED" | "REJECTED" | "EXPIRED";

export const DOCUMENT_ITEM_KINDS: ReadonlyArray<{ kind: DocumentItemKind; label: string; category: string }> = [
  { kind: "TITLE_DEED", label: "Τίτλος ιδιοκτησίας (συμβόλαιο)", category: "DEED" },
  { kind: "PRIOR_TITLES", label: "Προηγούμενοι τίτλοι κτήσης", category: "DEED" },
  { kind: "CADASTRE", label: "Κτηματολόγιο / ΚΑΕΚ", category: "DEED" },
  { kind: "TOPOGRAPHIC", label: "Τοπογραφικό διάγραμμα", category: "INSPECTION" },
  { kind: "BUILDING_PERMIT", label: "Οικοδομική άδεια και σχέδια", category: "INSPECTION" },
  { kind: "ENGINEER_CERT", label: "Βεβαίωση μηχανικού", category: "INSPECTION" },
  { kind: "BUILDING_ID", label: "Ηλεκτρονική Ταυτότητα Κτιρίου", category: "INSPECTION" },
  { kind: "ENERGY_CERT", label: "Πιστοποιητικό Ενεργειακής Απόδοσης (ΠΕΑ)", category: "INSPECTION" },
  { kind: "TAX", label: "Φορολογικά (π.χ. Ε9, ΕΝΦΙΑ)", category: "TAX" },
  { kind: "MANDATE", label: "Εντολή ανάθεσης", category: "CONTRACT" },
  { kind: "LEASE", label: "Μισθωτήριο / έγγραφα μίσθωσης", category: "CONTRACT" },
  { kind: "OTHER", label: "Άλλο έγγραφο", category: "OTHER" },
];

export const DOCUMENT_ITEM_STATUS_LABELS: Record<DocumentItemStatus, string> = {
  NOT_REQUIRED: "Δεν απαιτείται",
  PENDING: "Εκκρεμεί",
  REQUESTED: "Ζητήθηκε",
  UPLOADED: "Ανέβηκε",
  IN_REVIEW: "Υπό έλεγχο",
  VERIFIED: "Επαληθεύτηκε",
  REJECTED: "Απορρίφθηκε",
  EXPIRED: "Έληξε",
};

export const DOCUMENT_ITEM_STATUSES = Object.keys(DOCUMENT_ITEM_STATUS_LABELS) as DocumentItemStatus[];
/** Only a manager (or above) sets these: they are a review, not a data entry. */
export const REVIEW_STATUSES: DocumentItemStatus[] = ["VERIFIED", "REJECTED"];

export const kindLabel = (kind: string): string => DOCUMENT_ITEM_KINDS.find((k) => k.kind === kind)?.label ?? kind;
export const isDocumentKind = (kind: string): kind is DocumentItemKind => DOCUMENT_ITEM_KINDS.some((k) => k.kind === kind);
export const isDocumentStatus = (s: string): s is DocumentItemStatus => s in DOCUMENT_ITEM_STATUS_LABELS;

const LAND = new Set(["LAND", "PLOT"]);
const NO_ENERGY = new Set(["LAND", "PLOT", "PARKING"]);

/**
 * What is usually gathered for this kind of listing ("usual"), and what is often useful ("sometimes").
 * A suggestion only: the agent adds, removes or marks items "not required" case by case.
 */
export function suggestedDocuments(listingType: string, propertyType: string): Array<{ kind: DocumentItemKind; level: "usual" | "sometimes" }> {
  const building = !LAND.has(propertyType) && propertyType !== "PARKING";
  const out: Array<{ kind: DocumentItemKind; level: "usual" | "sometimes" }> = [];
  const add = (kind: DocumentItemKind, level: "usual" | "sometimes") => out.push({ kind, level });
  if (listingType === "RENT") {
    if (!NO_ENERGY.has(propertyType)) add("ENERGY_CERT", "usual");
    add("MANDATE", "usual");
    add("TITLE_DEED", "sometimes");
    add("LEASE", "sometimes");
    add("TAX", "sometimes");
    return out;
  }
  add("TITLE_DEED", "usual");
  add("CADASTRE", "usual");
  add("MANDATE", "usual");
  add("TAX", "usual");
  if (LAND.has(propertyType)) add("TOPOGRAPHIC", "usual");
  if (building) {
    add("ENERGY_CERT", "usual");
    add("ENGINEER_CERT", "usual");
    add("BUILDING_PERMIT", "usual");
    add("TOPOGRAPHIC", "sometimes");
    add("BUILDING_ID", "sometimes");
  }
  add("PRIOR_TITLES", "sometimes");
  return out;
}

export type ChecklistSummary = { total: number; required: number; done: number; verified: number; waiting: number; problems: number };

/** Counts for the passport. "done" = a document is there (uploaded or further); "verified" only after a manager's review. */
export function summarizeChecklist(items: ReadonlyArray<{ status: string }>): ChecklistSummary {
  const required = items.filter((i) => i.status !== "NOT_REQUIRED");
  return {
    total: items.length,
    required: required.length,
    done: required.filter((i) => ["UPLOADED", "IN_REVIEW", "VERIFIED"].includes(i.status)).length,
    verified: required.filter((i) => i.status === "VERIFIED").length,
    waiting: required.filter((i) => ["PENDING", "REQUESTED"].includes(i.status)).length,
    problems: required.filter((i) => ["REJECTED", "EXPIRED"].includes(i.status)).length,
  };
}
