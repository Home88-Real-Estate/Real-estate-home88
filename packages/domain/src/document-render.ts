/**
 * Rendering the six document variants (showing, simple assignment, exclusive
 * assignment; Greek and English) and the extension addendum.
 *
 * What is printed comes from two places that never mix:
 *
 *  - the STRUCTURE (parties, property table, fee, term, permissions, signature
 *    blocks) is built here from the issuance snapshot. Each document kind has
 *    its own builder, so a showing never prints an owner's marketing permissions
 *    and a simple assignment never prints an exclusive end-date section;
 *  - the LEGAL CLAUSES are the approved template version's text with merge
 *    fields filled in. No legal wording is written in this file.
 *
 * Everything is pure: the same snapshot and template always give the same
 * blocks, text and checksum, and the PDF is laid out from the blocks.
 */

import { DOCUMENT_MERGE_FIELDS } from "./document-fields";
import { detectLegacyLegalFlags } from "./legacy-templates";

export const DOCUMENT_KINDS = ["SHOWING", "SIMPLE_ASSIGNMENT", "EXCLUSIVE_ASSIGNMENT", "MANDATE_EXTENSION"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export type DocumentLanguage = "el" | "en";

/** The six issued variants, e.g. SIMPLE_ASSIGNMENT_EL. Extensions are an addendum, not a variant. */
export const DOCUMENT_VARIANTS = [
  "SHOWING_EL", "SHOWING_EN",
  "SIMPLE_ASSIGNMENT_EL", "SIMPLE_ASSIGNMENT_EN",
  "EXCLUSIVE_ASSIGNMENT_EL", "EXCLUSIVE_ASSIGNMENT_EN",
] as const;
export type DocumentVariant = (typeof DOCUMENT_VARIANTS)[number];

/**
 * Which variant a document is, from its document type, mandate type and
 * language. Deterministic and total: anything else is an error, never a fallback.
 */
export function resolveVariant(input: { documentType: "SHOWING" | "MANDATE"; mandateType?: string | null; language: string }): DocumentVariant {
  const lang = input.language === "el" ? "EL" : input.language === "en" ? "EN" : null;
  if (!lang) throw new RangeError(`Unsupported document language: ${input.language}`);
  const base =
    input.documentType === "SHOWING"
      ? "SHOWING"
      : input.mandateType === "SIMPLE_ASSIGNMENT" || input.mandateType === "EXCLUSIVE_ASSIGNMENT"
        ? input.mandateType
        : null;
  if (!base) throw new RangeError(`No document variant for mandate type: ${input.mandateType ?? "none"}`);
  return `${base}_${lang}` as DocumentVariant;
}

// ---------------------------------------------------------------------------
// The snapshot a document is rendered from
// ---------------------------------------------------------------------------

export type SnapshotParty = {
  role: string;
  fullName: string;
  taxId?: string | null;
  taxOffice?: string | null;
  idNumber?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  /** The capacity in which they hold the property or sign (owner, co-owner, attorney-in-fact…). */
  capacity?: string | null;
  sharePercent?: number | null;
  representativeCapacity?: string | null;
  authorityReference?: string | null;
  isSignatory: boolean;
};

export type SnapshotProperty = {
  code: string;
  address: string | null;
  description: string | null;
  transactionType: string;
  propertyType?: string | null;
  areaSqm?: number | null;
  price?: number | null;
  currency: string;
  /** The fee for this property (showings), fixed at issue. */
  fee?: { net: number; vat: number; gross: number } | null;
};

export type SnapshotFee = {
  payer?: string | null;
  method?: string | null;
  basis?: string | null;
  percentage?: number | null;
  fixedAmount?: number | null;
  currency: string;
  vatTreatment?: string | null;
  vatRate?: number | null;
  paymentTrigger?: string | null;
  amounts?: { net: number; vat: number; gross: number } | null;
  milestones: Array<{ sequence: number; percentage?: number | null; fixedAmount?: number | null; trigger?: string | null; description?: string | null }>;
};

export type SnapshotCompany = {
  legalName: string | null;
  vatNumber: string | null;
  taxOffice: string | null;
  gemiNumber: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  place: string | null;
};

export type DocumentSnapshot = {
  kind: DocumentKind;
  language: DocumentLanguage;
  number: string;
  /** Date of issue, YYYY-MM-DD. */
  issuedOn: string;
  verificationCode: string | null;
  company: SnapshotCompany;
  /** The person who prepared/issued it, as the company's representative. */
  representativeName: string | null;
  parties: SnapshotParty[];
  properties: SnapshotProperty[];
  fee: SnapshotFee | null;
  term?: {
    startDate: string | null;
    endDate: string | null;
    durationType: "INDEFINITE" | "FIXED_TERM" | null;
    duration: { months: number; days: number; totalDays: number } | null;
    /** Explicit exceptions to the exclusivity (only ever rendered in an exclusive assignment). */
    exceptions: string[];
  };
  permissions?: Record<string, boolean | null>;
  defects?: { known: boolean | null; description: string | null; confirmed: boolean | null };
  cooperation?: { brokerCooperationAllowed: boolean | null };
  dualRepresentationConsent?: boolean | null;
  specialTerms?: string | null;
  /** For an extension: the mandate it extends. */
  extension?: { mandateNumber: string; mandateType: string; startDate: string | null; previousEndDate: string; newEndDate: string; reason: string | null };
  template: { version: number; checksum: string };
};

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

type Dict = Record<string, string>;

const EL: Dict = {
  "title.SHOWING": "ΕΝΤΟΛΗ ΥΠΟΔΕΙΞΗΣ ΑΚΙΝΗΤΟΥ",
  "title.SIMPLE_ASSIGNMENT": "ΕΝΤΟΛΗ ΑΝΑΘΕΣΗΣ ΑΚΙΝΗΤΟΥ",
  "title.EXCLUSIVE_ASSIGNMENT": "ΕΝΤΟΛΗ ΑΝΑΘΕΣΗΣ ΑΚΙΝΗΤΟΥ",
  "title.MANDATE_EXTENSION": "ΠΑΡΑΤΑΣΗ ΕΝΤΟΛΗΣ ΑΝΑΘΕΣΗΣ ΑΚΙΝΗΤΟΥ",
  "assignmentType": "Είδος ανάθεσης",
  "type.SIMPLE_ASSIGNMENT": "Απλή ανάθεση",
  "type.EXCLUSIVE_ASSIGNMENT": "Αποκλειστική ανάθεση",
  "number": "Αριθμός εγγράφου",
  "issued": "Ημερομηνία έκδοσης",
  "place": "Τόπος έκδοσης",
  "verification": "Κωδικός επαλήθευσης",
  "company": "Γραφείο",
  "legalName": "Επωνυμία",
  "vat": "ΑΦΜ",
  "taxOffice": "ΔΟΥ",
  "gemi": "ΓΕΜΗ",
  "address": "Έδρα",
  "phone": "Τηλέφωνο",
  "email": "Email",
  "section.client": "Στοιχεία πελάτη",
  "section.principal": "Στοιχεία εντολέα",
  "section.properties": "Ακίνητα",
  "section.property": "Ακίνητο",
  "section.term": "Διάρκεια",
  "section.fee": "Αμοιβή",
  "section.payment": "Όροι πληρωμής",
  "section.permissions": "Άδειες προβολής και προώθησης",
  "section.defects": "Δήλωση για ελαττώματα",
  "section.cooperation": "Συνεργασία",
  "section.special": "Ειδικοί όροι",
  "section.clauses": "Όροι",
  "section.extension": "Παράταση",
  "section.signatures": "Υπογραφές",
  "fullName": "Ονοματεπώνυμο",
  "taxId": "ΑΦΜ",
  "idNumber": "Αρ. ταυτότητας",
  "capacity": "Ιδιότητα",
  "share": "Ποσοστό",
  "authority": "Εξουσιοδότηση",
  "role.BUYER": "Αγοραστής",
  "role.TENANT": "Μισθωτής",
  "role.JOINT_BUYER": "Συν-αγοραστής",
  "role.SPOUSE": "Σύζυγος",
  "role.COMPANY_REPRESENTATIVE": "Εκπρόσωπος εταιρείας",
  "role.ATTORNEY_IN_FACT": "Πληρεξούσιος",
  "role.AUTHORIZED_REPRESENTATIVE": "Εξουσιοδοτημένος εκπρόσωπος",
  "role.OTHER": "Άλλος",
  "role.OWNER": "Ιδιοκτήτης",
  "role.CO_OWNER": "Συνιδιοκτήτης",
  "role.USUFRUCTUARY": "Επικαρπωτής",
  "role.BARE_OWNER": "Ψιλός κύριος",
  "role.LEGAL_REPRESENTATIVE": "Νόμιμος εκπρόσωπος",
  "role.CLIENT": "Ενδιαφερόμενος",
  "col.code": "Κωδικός",
  "col.address": "Διεύθυνση",
  "col.description": "Περιγραφή",
  "col.type": "Συναλλαγή",
  "col.price": "Τιμή",
  "col.fee": "Αμοιβή",
  "col.size": "Εμβαδόν",
  "col.ptype": "Τύπος",
  "addressLine": "Διεύθυνση",
  "tx.SALE": "Πώληση",
  "tx.RENT": "Μίσθωση",
  "tx.ASSIGNMENT": "Ανάθεση",
  "ptype.APARTMENT": "Διαμέρισμα", "ptype.MAISONETTE": "Μεζονέτα", "ptype.HOUSE": "Μονοκατοικία", "ptype.VILLA": "Βίλα", "ptype.STUDIO": "Στούντιο",
  "ptype.OFFICE": "Γραφείο", "ptype.SHOP": "Κατάστημα", "ptype.WAREHOUSE": "Αποθήκη", "ptype.BUILDING": "Κτίριο", "ptype.HOTEL": "Ξενοδοχείο",
  "ptype.LAND": "Γη", "ptype.PLOT": "Οικόπεδο", "ptype.PARKING": "Parking", "ptype.INDUSTRIAL": "Βιομηχανικό", "ptype.OTHER": "Άλλο",
  "start": "Έναρξη",
  "end": "Λήξη",
  "duration": "Διάρκεια",
  "durationIndefinite": "Αορίστου χρόνου",
  "durationFixed": "Ορισμένου χρόνου",
  "from": "από",
  "to": "έως",
  "months": "μήνες",
  "days": "ημέρες",
  "month": "μήνας",
  "day": "ημέρα",
  "exceptions": "Εξαιρέσεις από την αποκλειστικότητα",
  "payer": "Υπόχρεος καταβολής",
  "feeMethod": "Τρόπος υπολογισμού",
  "feeBasis": "Βάση υπολογισμού",
  "vatTreatment": "ΦΠΑ",
  "net": "Αμοιβή χωρίς ΦΠΑ",
  "vatAmount": "ΦΠΑ",
  "gross": "Σύνολο με ΦΠΑ",
  "trigger": "Καταβολή",
  "milestone": "Δόση",
  "of": "επί",
  "payer.OWNER": "Ιδιοκτήτης", "payer.BUYER": "Αγοραστής", "payer.TENANT": "Μισθωτής", "payer.LANDLORD": "Εκμισθωτής", "payer.BOTH_PARTIES": "Αμφότεροι οι συμβαλλόμενοι", "payer.OTHER": "Άλλος",
  "method.PERCENTAGE": "Ποσοστό", "method.FIXED_AMOUNT": "Κατ' αποκοπή ποσό", "method.CUSTOM": "Ειδική συμφωνία", "method.NEGOTIATED_LATER": "Θα συμφωνηθεί αργότερα",
  "basis.ASKING_PRICE": "ζητούμενη τιμή", "basis.FINAL_SALE_PRICE": "τελική τιμή πώλησης", "basis.MONTHLY_RENT": "μηνιαίο μίσθωμα", "basis.ANNUAL_RENT": "ετήσιο μίσθωμα", "basis.CONTRACT_VALUE": "αξία της σύμβασης", "basis.OTHER": "άλλη βάση",
  "vat.PLUS_VAT": "Πλέον ΦΠΑ", "vat.VAT_INCLUDED": "Περιλαμβάνεται ΦΠΑ", "vat.VAT_EXEMPT": "Απαλλάσσεται από ΦΠΑ", "vat.NOT_APPLICABLE": "Δεν εφαρμόζεται ΦΠΑ",
  "trigger.RESERVATION": "κατά την κράτηση", "trigger.PRELIMINARY_AGREEMENT": "κατά την υπογραφή προσυμφώνου", "trigger.FINAL_CONTRACT": "κατά την υπογραφή οριστικού συμβολαίου",
  "trigger.LEASE_SIGNING": "κατά την υπογραφή μισθωτηρίου", "trigger.INSTALLMENTS": "σε δόσεις", "trigger.CUSTOM": "όπως ειδικά συμφωνήθηκε",
  "yes": "Ναι", "no": "Όχι", "unanswered": "Δεν δηλώθηκε",
  "perm.photoPermission": "Φωτογράφηση και δημοσίευση φωτογραφιών",
  "perm.videoPermission": "Βίντεο",
  "perm.floorplanPermission": "Κάτοψη",
  "perm.signboardPermission": "Πινακίδα στο ακίνητο",
  "perm.portalPublicationPermission": "Δημοσίευση σε ιστοσελίδες αγγελιών (portals)",
  "perm.socialMediaPermission": "Δημοσίευση σε μέσα κοινωνικής δικτύωσης",
  "perm.cooperatingBrokerPermission": "Κοινοποίηση σε συνεργαζόμενους μεσίτες",
  "defects.none": "Ο εντολέας δηλώνει ότι το ακίνητο δεν έχει γνωστά ελαττώματα.",
  "defects.known": "Ο εντολέας δηλώνει ότι το ακίνητο έχει τα εξής γνωστά ελαττώματα",
  "brokerCooperation": "Συνεργασία με άλλους μεσίτες",
  "dualRepresentation": "Συναίνεση ενέργειας και για τον αντισυμβαλλόμενο",
  "extension.mandate": "Εντολή που παρατείνεται",
  "extension.type": "Είδος εντολής",
  "extension.start": "Έναρξη εντολής",
  "extension.previous": "Προηγούμενη λήξη",
  "extension.new": "Νέα λήξη",
  "extension.reason": "Αιτιολογία",
  "sig.client": "Ο ΠΕΛΑΤΗΣ",
  "sig.principal": "Ο ΕΝΤΟΛΕΑΣ",
  "sig.broker": "Ο ΜΕΣΙΤΗΣ",
  "sig.line": "(Υπογραφή)",
  "sig.representative": "Εκπρόσωπος",
  "page": "Σελίδα",
  "pageOf": "από",
  "template": "Πρότυπο",
  "version": "έκδοση",
};

const EN: Dict = {
  "title.SHOWING": "PROPERTY SHOWING MANDATE",
  "title.SIMPLE_ASSIGNMENT": "PROPERTY ASSIGNMENT MANDATE",
  "title.EXCLUSIVE_ASSIGNMENT": "PROPERTY ASSIGNMENT MANDATE",
  "title.MANDATE_EXTENSION": "EXTENSION OF PROPERTY ASSIGNMENT MANDATE",
  "assignmentType": "Type of assignment",
  "type.SIMPLE_ASSIGNMENT": "Simple assignment",
  "type.EXCLUSIVE_ASSIGNMENT": "Exclusive assignment",
  "number": "Document number",
  "issued": "Date of issue",
  "place": "Place of issue",
  "verification": "Verification code",
  "company": "Agency",
  "legalName": "Legal name",
  "vat": "VAT no.",
  "taxOffice": "Tax office",
  "gemi": "GEMI",
  "address": "Registered address",
  "phone": "Telephone",
  "email": "Email",
  "section.client": "Client details",
  "section.principal": "Principal details",
  "section.properties": "Properties",
  "section.property": "Property",
  "section.term": "Term",
  "section.fee": "Fee",
  "section.payment": "Payment terms",
  "section.permissions": "Viewing and promotion permissions",
  "section.defects": "Declaration on defects",
  "section.cooperation": "Cooperation",
  "section.special": "Special terms",
  "section.clauses": "Terms",
  "section.extension": "Extension",
  "section.signatures": "Signatures",
  "fullName": "Full name",
  "taxId": "Tax ID (AFM)",
  "idNumber": "ID number",
  "capacity": "Capacity",
  "share": "Share",
  "authority": "Authority",
  "role.BUYER": "Buyer",
  "role.TENANT": "Tenant",
  "role.JOINT_BUYER": "Joint buyer",
  "role.SPOUSE": "Spouse",
  "role.COMPANY_REPRESENTATIVE": "Company representative",
  "role.ATTORNEY_IN_FACT": "Attorney-in-fact",
  "role.AUTHORIZED_REPRESENTATIVE": "Authorised representative",
  "role.OTHER": "Other",
  "role.OWNER": "Owner",
  "role.CO_OWNER": "Co-owner",
  "role.USUFRUCTUARY": "Usufructuary",
  "role.BARE_OWNER": "Bare owner",
  "role.LEGAL_REPRESENTATIVE": "Legal representative",
  "role.CLIENT": "Client",
  "col.code": "Code",
  "col.address": "Address",
  "col.description": "Description",
  "col.type": "Transaction",
  "col.price": "Price",
  "col.fee": "Fee",
  "col.size": "Area",
  "col.ptype": "Type",
  "addressLine": "Address",
  "tx.SALE": "Sale",
  "tx.RENT": "Lease",
  "tx.ASSIGNMENT": "Assignment",
  "ptype.APARTMENT": "Apartment", "ptype.MAISONETTE": "Maisonette", "ptype.HOUSE": "House", "ptype.VILLA": "Villa", "ptype.STUDIO": "Studio",
  "ptype.OFFICE": "Office", "ptype.SHOP": "Shop", "ptype.WAREHOUSE": "Warehouse", "ptype.BUILDING": "Building", "ptype.HOTEL": "Hotel",
  "ptype.LAND": "Land", "ptype.PLOT": "Plot", "ptype.PARKING": "Parking", "ptype.INDUSTRIAL": "Industrial", "ptype.OTHER": "Other",
  "start": "Start",
  "end": "End",
  "duration": "Duration",
  "durationIndefinite": "Indefinite term",
  "durationFixed": "Fixed term",
  "from": "from",
  "to": "to",
  "months": "months",
  "days": "days",
  "month": "month",
  "day": "day",
  "exceptions": "Exceptions to exclusivity",
  "payer": "Payable by",
  "feeMethod": "Calculation",
  "feeBasis": "Basis",
  "vatTreatment": "VAT",
  "net": "Fee excluding VAT",
  "vatAmount": "VAT",
  "gross": "Total including VAT",
  "trigger": "Payable",
  "milestone": "Instalment",
  "of": "of",
  "payer.OWNER": "Owner", "payer.BUYER": "Buyer", "payer.TENANT": "Tenant", "payer.LANDLORD": "Landlord", "payer.BOTH_PARTIES": "Both parties", "payer.OTHER": "Other",
  "method.PERCENTAGE": "Percentage", "method.FIXED_AMOUNT": "Lump sum", "method.CUSTOM": "Special agreement", "method.NEGOTIATED_LATER": "To be agreed later",
  "basis.ASKING_PRICE": "asking price", "basis.FINAL_SALE_PRICE": "final sale price", "basis.MONTHLY_RENT": "monthly rent", "basis.ANNUAL_RENT": "annual rent", "basis.CONTRACT_VALUE": "contract value", "basis.OTHER": "other basis",
  "vat.PLUS_VAT": "Plus VAT", "vat.VAT_INCLUDED": "VAT included", "vat.VAT_EXEMPT": "VAT exempt", "vat.NOT_APPLICABLE": "VAT not applicable",
  "trigger.RESERVATION": "on reservation", "trigger.PRELIMINARY_AGREEMENT": "on signing the preliminary agreement", "trigger.FINAL_CONTRACT": "on signing the final contract",
  "trigger.LEASE_SIGNING": "on signing the lease", "trigger.INSTALLMENTS": "in instalments", "trigger.CUSTOM": "as specially agreed",
  "yes": "Yes", "no": "No", "unanswered": "Not stated",
  "perm.photoPermission": "Photography and publication of photographs",
  "perm.videoPermission": "Video",
  "perm.floorplanPermission": "Floor plan",
  "perm.signboardPermission": "Sign on the property",
  "perm.portalPublicationPermission": "Publication on listing portals",
  "perm.socialMediaPermission": "Publication on social media",
  "perm.cooperatingBrokerPermission": "Disclosure to cooperating brokers",
  "defects.none": "The principal declares that the property has no known defects.",
  "defects.known": "The principal declares that the property has the following known defects",
  "brokerCooperation": "Cooperation with other brokers",
  "dualRepresentation": "Consent to act for the counterparty as well",
  "extension.mandate": "Mandate being extended",
  "extension.type": "Type of mandate",
  "extension.start": "Mandate start",
  "extension.previous": "Previous end date",
  "extension.new": "New end date",
  "extension.reason": "Reason",
  "sig.client": "THE CLIENT",
  "sig.principal": "THE PRINCIPAL",
  "sig.broker": "THE BROKER",
  "sig.line": "(Signature)",
  "sig.representative": "Representative",
  "page": "Page",
  "pageOf": "of",
  "template": "Template",
  "version": "version",
};

export const LABELS: Record<DocumentLanguage, Dict> = { el: EL, en: EN };
const L = (lang: DocumentLanguage, key: string, fallback?: string) => LABELS[lang][key] ?? fallback ?? key;

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** YYYY-MM-DD → 06/10/2026, with no time-zone arithmetic (a date is not a moment). */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

export function formatMoney(amount: number, currency: string, lang: DocumentLanguage): string {
  return new Intl.NumberFormat(lang === "en" ? "en-GB" : "el-GR", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}

const pct = (n: number, lang: DocumentLanguage) => `${new Intl.NumberFormat(lang === "en" ? "en-GB" : "el-GR", { maximumFractionDigits: 4 }).format(n)}%`;
const present = (v: string | null | undefined): v is string => typeof v === "string" && v.trim() !== "";

function formatDuration(d: { months: number; days: number }, lang: DocumentLanguage): string {
  const parts: string[] = [];
  if (d.months > 0) parts.push(`${d.months} ${d.months === 1 ? L(lang, "month") : L(lang, "months")}`);
  if (d.days > 0 || parts.length === 0) parts.push(`${d.days} ${d.days === 1 ? L(lang, "day") : L(lang, "days")}`);
  return parts.join(lang === "en" ? " and " : " και ");
}

/** The fee in one sentence, e.g. "Ποσοστό 2% επί τελική τιμή πώλησης, πλέον ΦΠΑ 24%". */
export function feeSummary(fee: SnapshotFee | null, lang: DocumentLanguage): string {
  if (!fee || !fee.method) return "";
  const l = (k: string) => L(lang, k);
  let core = "";
  if (fee.method === "PERCENTAGE" && fee.percentage != null) {
    core = `${l("method.PERCENTAGE")} ${pct(fee.percentage, lang)}${fee.basis ? ` ${l("of")} ${l(`basis.${fee.basis}`)}` : ""}`;
  } else if (fee.method === "FIXED_AMOUNT" && fee.fixedAmount != null) {
    core = `${l("method.FIXED_AMOUNT")} ${formatMoney(fee.fixedAmount, fee.currency, lang)}`;
  } else {
    core = l(`method.${fee.method}`);
  }
  const vat = fee.vatTreatment
    ? `${l(`vat.${fee.vatTreatment}`)}${(fee.vatTreatment === "PLUS_VAT" || fee.vatTreatment === "VAT_INCLUDED") && fee.vatRate != null ? ` ${pct(fee.vatRate, lang)}` : ""}`
    : "";
  return [core, vat].filter(Boolean).join(", ");
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export type Block =
  | { t: "title"; text: string }
  | { t: "subtitle"; text: string }
  | { t: "section"; text: string }
  | { t: "kv"; rows: Array<[string, string]> }
  | { t: "table"; header: string[]; rows: string[][]; widths: number[] }
  | { t: "para"; text: string }
  | { t: "clauses"; text: string }
  | { t: "signatures"; boxes: Array<{ role: string; name: string; detail: string | null }> };

export function blocksToText(blocks: Block[]): string {
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.t) {
      case "title":
      case "subtitle":
      case "section":
        out.push(b.text);
        break;
      case "kv":
        for (const [k, v] of b.rows) out.push(`${k}: ${v}`);
        break;
      case "table":
        out.push(b.header.join(" | "));
        for (const r of b.rows) out.push(r.join(" | "));
        break;
      case "para":
      case "clauses":
        out.push(b.text);
        break;
      case "signatures":
        for (const s of b.boxes) out.push(`${s.role} — ${s.name}${s.detail ? ` (${s.detail})` : ""}`);
        break;
    }
    out.push("");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function partyKv(p: SnapshotParty, lang: DocumentLanguage): Array<[string, string]> {
  const l = (k: string) => L(lang, k);
  const role = l(`role.${p.capacity ?? p.role}`);
  const rows: Array<[string, string]> = [[l("fullName"), p.fullName]];
  if (role) rows.unshift([l("capacity"), role]);
  if (p.sharePercent != null) rows.push([l("share"), pct(p.sharePercent, lang)]);
  if (present(p.taxId)) rows.push([l("taxId"), p.taxId]);
  if (present(p.taxOffice)) rows.push([l("taxOffice"), p.taxOffice]);
  if (present(p.idNumber)) rows.push([l("idNumber"), p.idNumber]);
  if (present(p.address)) rows.push([l("addressLine"), p.address]);
  if (present(p.phone)) rows.push([l("phone"), p.phone]);
  if (present(p.email)) rows.push([l("email"), p.email]);
  if (p.representativeCapacity) rows.push([l("authority"), `${l(`role.${p.representativeCapacity}`)}${present(p.authorityReference) ? ` — ${p.authorityReference}` : ""}`]);
  return rows;
}

function headerBlocks(s: DocumentSnapshot): Block[] {
  const lang = s.language;
  const l = (k: string) => L(lang, k);
  const c = s.company;
  const company: Array<[string, string]> = [];
  if (present(c.legalName)) company.push([l("legalName"), c.legalName]);
  if (present(c.vatNumber)) company.push([l("vat"), c.vatNumber]);
  if (present(c.taxOffice)) company.push([l("taxOffice"), c.taxOffice]);
  if (present(c.gemiNumber)) company.push([l("gemi"), c.gemiNumber]);
  if (present(c.address)) company.push([l("address"), c.address]);
  if (present(c.phone)) company.push([l("phone"), c.phone]);
  if (present(c.email)) company.push([l("email"), c.email]);

  const meta: Array<[string, string]> = [[l("number"), s.number], [l("issued"), formatDate(s.issuedOn)]];
  if (present(c.place)) meta.push([l("place"), c.place]);
  if (s.verificationCode) meta.push([l("verification"), s.verificationCode]);

  return [
    { t: "section", text: l("company") },
    { t: "kv", rows: company },
    { t: "title", text: l(`title.${s.kind}`) },
    ...(s.kind === "SIMPLE_ASSIGNMENT" || s.kind === "EXCLUSIVE_ASSIGNMENT" ? [{ t: "subtitle", text: `${l("assignmentType")}: ${l(`type.${s.kind}`)}` } as Block] : []),
    { t: "kv", rows: meta },
  ];
}

function propertyBlocks(s: DocumentSnapshot): Block[] {
  const lang = s.language;
  const l = (k: string) => L(lang, k);
  if (s.kind === "SHOWING") {
    const header = [l("col.code"), l("col.address"), l("col.description"), l("col.type"), l("col.price"), l("col.fee")];
    const rows = s.properties.map((p) => [
      p.code,
      p.address ?? "",
      p.description ?? "",
      l(`tx.${p.transactionType}`),
      p.price != null ? formatMoney(p.price, p.currency, lang) : "",
      p.fee ? `${formatMoney(p.fee.net, p.currency, lang)} + ${formatMoney(p.fee.vat, p.currency, lang)} = ${formatMoney(p.fee.gross, p.currency, lang)}` : "",
    ]);
    return [{ t: "section", text: l("section.properties") }, { t: "table", header, rows, widths: [0.13, 0.23, 0.26, 0.1, 0.12, 0.16] }];
  }
  // Assignments describe the one property being assigned.
  const blocks: Block[] = [];
  for (const p of s.properties) {
    const rows: Array<[string, string]> = [[l("col.code"), p.code], [l("addressLine"), p.address ?? ""]];
    if (p.propertyType) rows.push([l("col.ptype"), L(lang, `ptype.${p.propertyType}`, p.propertyType)]);
    if (p.areaSqm != null) rows.push([l("col.size"), `${p.areaSqm} m²`]);
    rows.push([l("col.type"), l(`tx.${p.transactionType}`)]);
    if (p.price != null) rows.push([l("col.price"), formatMoney(p.price, p.currency, lang)]);
    if (present(p.description)) rows.push([l("col.description"), p.description]);
    blocks.push({ t: "section", text: l("section.property") }, { t: "kv", rows });
  }
  return blocks;
}

function feeBlocks(s: DocumentSnapshot): Block[] {
  const fee = s.fee;
  if (!fee) return [];
  const lang = s.language;
  const l = (k: string) => L(lang, k);
  const rows: Array<[string, string]> = [];
  if (fee.payer) rows.push([l("payer"), l(`payer.${fee.payer}`)]);
  rows.push([l("feeMethod"), feeSummary(fee, lang)]);
  if (fee.amounts) {
    rows.push([l("net"), formatMoney(fee.amounts.net, fee.currency, lang)]);
    if (fee.vatTreatment === "PLUS_VAT" || fee.vatTreatment === "VAT_INCLUDED") rows.push([l("vatAmount"), formatMoney(fee.amounts.vat, fee.currency, lang)]);
    rows.push([l("gross"), formatMoney(fee.amounts.gross, fee.currency, lang)]);
  }
  if (fee.paymentTrigger) rows.push([l("trigger"), l(`trigger.${fee.paymentTrigger}`)]);
  const blocks: Block[] = [{ t: "section", text: l("section.fee") }, { t: "kv", rows }];
  if (fee.milestones.length > 0) {
    blocks.push({ t: "section", text: l("section.payment") });
    blocks.push({
      t: "table",
      header: [l("milestone"), l("col.fee"), l("trigger")],
      rows: fee.milestones.map((m) => [
        String(m.sequence),
        m.percentage != null ? pct(m.percentage, lang) : m.fixedAmount != null ? formatMoney(m.fixedAmount, fee.currency, lang) : "",
        [m.trigger ? l(`trigger.${m.trigger}`) : "", m.description ?? ""].filter(Boolean).join(" — "),
      ]),
      widths: [0.14, 0.26, 0.6],
    });
  }
  return blocks;
}

const PERMISSION_ORDER = ["photoPermission", "videoPermission", "floorplanPermission", "signboardPermission", "portalPublicationPermission", "socialMediaPermission", "cooperatingBrokerPermission"];

function assignmentBlocks(s: DocumentSnapshot): Block[] {
  const lang = s.language;
  const l = (k: string) => L(lang, k);
  const blocks: Block[] = [];
  const term = s.term;
  if (term) {
    const rows: Array<[string, string]> = [[l("start"), formatDate(term.startDate)]];
    if (s.kind === "EXCLUSIVE_ASSIGNMENT") {
      rows.push([l("end"), formatDate(term.endDate)]);
      if (term.duration) rows.push([l("duration"), formatDuration(term.duration, lang)]);
    } else if (term.durationType === "FIXED_TERM") {
      rows.push([l("duration"), `${l("durationFixed")}, ${l("from")} ${formatDate(term.startDate)} ${l("to")} ${formatDate(term.endDate)}`]);
      if (term.duration) rows.push([l("end"), formatDate(term.endDate)]);
    } else {
      rows.push([l("duration"), l("durationIndefinite")]);
    }
    blocks.push({ t: "section", text: l("section.term") }, { t: "kv", rows });
    // Exceptions only ever belong to an exclusive assignment.
    if (s.kind === "EXCLUSIVE_ASSIGNMENT" && term.exceptions.length > 0) {
      blocks.push({ t: "section", text: l("exceptions") }, { t: "para", text: term.exceptions.map((e) => `• ${e}`).join("\n") });
    }
  }
  return blocks;
}

function ownerTermsBlocks(s: DocumentSnapshot): Block[] {
  const lang = s.language;
  const l = (k: string) => L(lang, k);
  const blocks: Block[] = [];
  const yn = (v: boolean | null | undefined) => (v === true ? l("yes") : v === false ? l("no") : l("unanswered"));
  if (s.permissions) {
    blocks.push({ t: "section", text: l("section.permissions") }, { t: "kv", rows: PERMISSION_ORDER.filter((k) => k in s.permissions!).map((k): [string, string] => [l(`perm.${k}`), yn(s.permissions![k])]) });
  }
  if (s.defects) {
    const text = s.defects.known === true ? `${l("defects.known")}: ${s.defects.description ?? ""}` : l("defects.none");
    blocks.push({ t: "section", text: l("section.defects") }, { t: "para", text });
  }
  const coop: Array<[string, string]> = [];
  if (s.cooperation) coop.push([l("brokerCooperation"), yn(s.cooperation.brokerCooperationAllowed)]);
  if (s.dualRepresentationConsent != null) coop.push([l("dualRepresentation"), yn(s.dualRepresentationConsent)]);
  if (coop.length > 0) blocks.push({ t: "section", text: l("section.cooperation") }, { t: "kv", rows: coop });
  if (present(s.specialTerms)) blocks.push({ t: "section", text: l("section.special") }, { t: "para", text: s.specialTerms });
  return blocks;
}

function signatureBlock(s: DocumentSnapshot): Block {
  const lang = s.language;
  const l = (k: string) => L(lang, k);
  const side = s.kind === "SHOWING" ? l("sig.client") : l("sig.principal");
  const boxes = s.parties
    .filter((p) => p.isSignatory)
    .map((p) => ({
      role: side,
      name: p.fullName,
      detail: p.representativeCapacity ? l(`role.${p.representativeCapacity}`) : p.capacity && s.kind !== "SHOWING" ? l(`role.${p.capacity}`) : null,
    }));
  boxes.push({
    role: l("sig.broker"),
    name: [s.company.legalName, s.representativeName ? `${l("sig.representative")}: ${s.representativeName}` : null].filter(Boolean).join(" — "),
    detail: null,
  });
  return { t: "signatures", boxes };
}

/**
 * The document, block by block. `clauses` is the approved wording after merge
 * fields were filled in; it is placed once, between the data and the signatures.
 */
export function buildDocumentBlocks(s: DocumentSnapshot, clauses: string): Block[] {
  const lang = s.language;
  const l = (k: string) => L(lang, k);
  const blocks: Block[] = [...headerBlocks(s)];

  if (s.kind === "SHOWING") {
    blocks.push({ t: "section", text: l("section.client") });
    for (const p of s.parties) blocks.push({ t: "kv", rows: partyKv({ ...p, capacity: null }, lang) });
    blocks.push(...propertyBlocks(s), ...feeBlocks(s));
    if (s.dualRepresentationConsent != null) {
      blocks.push({ t: "section", text: l("section.cooperation") }, { t: "kv", rows: [[l("dualRepresentation"), s.dualRepresentationConsent ? l("yes") : l("no")]] });
    }
  } else if (s.kind === "MANDATE_EXTENSION") {
    const x = s.extension!;
    blocks.push({ t: "section", text: l("section.principal") });
    for (const p of s.parties) blocks.push({ t: "kv", rows: partyKv(p, lang) });
    const rows: Array<[string, string]> = [
      [l("extension.mandate"), x.mandateNumber],
      [l("extension.type"), l(`type.${x.mandateType}`)],
    ];
    if (x.startDate) rows.push([l("extension.start"), formatDate(x.startDate)]);
    rows.push([l("extension.previous"), formatDate(x.previousEndDate)], [l("extension.new"), formatDate(x.newEndDate)]);
    if (present(x.reason)) rows.push([l("extension.reason"), x.reason]);
    blocks.push({ t: "section", text: l("section.extension") }, { t: "kv", rows });
    blocks.push(...propertyBlocks({ ...s, kind: "SIMPLE_ASSIGNMENT" }));
  } else {
    blocks.push({ t: "section", text: l("section.principal") });
    for (const p of s.parties) blocks.push({ t: "kv", rows: partyKv(p, lang) });
    blocks.push(...propertyBlocks(s), ...assignmentBlocks(s), ...feeBlocks(s), ...ownerTermsBlocks(s));
  }

  if (clauses.trim()) blocks.push({ t: "section", text: l("section.clauses") }, { t: "clauses", text: clauses.trim() });
  blocks.push({ t: "section", text: l("section.signatures") }, signatureBlock(s));
  return blocks;
}

// ---------------------------------------------------------------------------
// Approved wording: merge fields
// ---------------------------------------------------------------------------

const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)*)\s*\}\}/g;
const KNOWN = new Set<string>(DOCUMENT_MERGE_FIELDS.map((f) => f.key));
const FIELD_LABEL: Record<string, string> = Object.fromEntries(DOCUMENT_MERGE_FIELDS.map((f) => [f.key, f.label]));

/** The value of every merge field, from the snapshot only. Empty means "not applicable here". */
export function mergeValues(s: DocumentSnapshot): Record<string, string> {
  const lang = s.language;
  const l = (k: string) => L(lang, k);
  const first = s.properties[0];
  const join = (f: (p: SnapshotParty) => string | null | undefined) => s.parties.map(f).filter(present).join("; ");
  const isShowing = s.kind === "SHOWING";
  const people = {
    fullName: join((p) => p.fullName),
    taxId: join((p) => p.taxId),
    idNumber: join((p) => p.idNumber),
    address: join((p) => p.address),
    phone: join((p) => p.phone),
    email: join((p) => p.email),
  };
  const t = s.term;
  const x = s.extension;
  const kindLabel = s.kind === "SIMPLE_ASSIGNMENT" || s.kind === "EXCLUSIVE_ASSIGNMENT" ? l(`type.${s.kind}`) : x ? l(`type.${x.mandateType}`) : "";
  const duration =
    t?.durationType === "INDEFINITE" ? l("durationIndefinite") : t?.duration ? formatDuration(t.duration, lang) : "";
  return {
    "document.number": s.number,
    "document.date": formatDate(s.issuedOn),
    "document.place": s.company.place ?? "",
    "company.legalName": s.company.legalName ?? "",
    "company.vatNumber": s.company.vatNumber ?? "",
    "company.taxOffice": s.company.taxOffice ?? "",
    "company.gemiNumber": s.company.gemiNumber ?? "",
    "company.address": s.company.address ?? "",
    "company.phone": s.company.phone ?? "",
    "company.email": s.company.email ?? "",
    "agent.fullName": s.representativeName ?? "",
    "client.fullName": isShowing ? people.fullName : "",
    "client.taxId": isShowing ? people.taxId : "",
    "client.idNumber": isShowing ? people.idNumber : "",
    "client.address": isShowing ? people.address : "",
    "client.phone": isShowing ? people.phone : "",
    "client.email": isShowing ? people.email : "",
    "principal.fullName": isShowing ? "" : people.fullName,
    "principal.taxId": isShowing ? "" : people.taxId,
    "principal.idNumber": isShowing ? "" : people.idNumber,
    "principal.address": isShowing ? "" : people.address,
    "principal.phone": isShowing ? "" : people.phone,
    "principal.email": isShowing ? "" : people.email,
    "property.reference": first?.code ?? "",
    "property.address": first?.address ?? "",
    "property.type": first?.propertyType ? L(lang, `ptype.${first.propertyType}`, first.propertyType) : "",
    "property.size": first?.areaSqm != null ? String(first.areaSqm) : "",
    "property.price": first?.price != null ? formatMoney(first.price, first.currency, lang) : "",
    "properties.references": s.properties.map((p) => p.code).join(", "),
    "term.type": kindLabel,
    "term.startDate": formatDate(t?.startDate ?? x?.startDate),
    "term.endDate": s.kind === "EXCLUSIVE_ASSIGNMENT" || t?.durationType === "FIXED_TERM" ? formatDate(t?.endDate) : "",
    "term.duration": duration,
    "fee.summary": feeSummary(s.fee, lang),
    "fee.payer": s.fee?.payer ? l(`payer.${s.fee.payer}`) : "",
    "fee.vat": s.fee?.vatTreatment ? l(`vat.${s.fee.vatTreatment}`) : "",
    "mandate.number": x?.mandateNumber ?? "",
    "extension.previousEndDate": formatDate(x?.previousEndDate),
    "extension.newEndDate": formatDate(x?.newEndDate),
    "extension.reason": x?.reason ?? "",
  };
}

export type ClauseResult = { ok: true; text: string; fields: string[] } | { ok: false; unknown: string[]; missing: string[]; unclosed: boolean };

/**
 * Fills the approved wording. Strict, like every legal document here: an
 * unknown field, an unclosed brace or a field with no value for this document
 * fails the render rather than printing a blank or a literal {{…}}.
 */
export function renderClauses(body: string, values: Record<string, string>): ClauseResult {
  const fields: string[] = [];
  for (const m of body.matchAll(PLACEHOLDER)) if (!fields.includes(m[1]!)) fields.push(m[1]!);
  const unknown = fields.filter((f) => !KNOWN.has(f));
  const unclosed = /\{\{|\}\}/.test(body.replace(PLACEHOLDER, ""));
  const missing = fields.filter((f) => KNOWN.has(f) && !(values[f] ?? "").trim()).map((f) => FIELD_LABEL[f] ?? f);
  if (unknown.length > 0 || unclosed || missing.length > 0) return { ok: false, unknown, missing, unclosed };
  return { ok: true, text: body.replace(PLACEHOLDER, (_m, key: string) => values[key]!.trim()), fields };
}

// ---------------------------------------------------------------------------
// Content safety
// ---------------------------------------------------------------------------

/** "αποκλειστική" / "exclusive", unless the author negated it (μη αποκλειστική, non-exclusive, not exclusive). */
export function mentionsExclusive(text: string): boolean {
  for (const m of text.matchAll(/αποκλειστικ[\p{L}]*|exclusiv[\p{L}]*/giu)) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 6), m.index ?? 0).toLowerCase();
    if (!/(?:μη[\s-]|non[\s-]|not\s)$/.test(before)) return true;
  }
  return false;
}

/** The simple / indefinite alternative, in either language. */
export function mentionsSimpleOrIndefinite(text: string): boolean {
  return /απλ[ήηή]ς?\s+ανάθεση|αορίστου|simple\s+assignment|indefinite/i.test(text);
}

const ASSIGNMENT_WORDS = /ανάθεσ|assignment|\bowner\b|ιδιοκτήτ/i;

export type ContentProblem = { code: string; message: string };

/**
 * Checks an approved template's wording against the document kind it is for:
 * no unresolved choices or blanks, and no clause that belongs to another kind.
 * This is a safeguard behind counsel's approval, not a substitute for it.
 */
export function checkTemplateContent(kind: DocumentKind, body: string): ContentProblem[] {
  const problems: ContentProblem[] = [];
  const flags = detectLegacyLegalFlags(body);
  const flagged: Array<[string, string]> = [
    ["MIXED_SIMPLE_EXCLUSIVE", "Το κείμενο περιέχει όρους απλής και αποκλειστικής ανάθεσης μαζί."],
    ["DURATION_ALTERNATIVE", "Το κείμενο περιέχει την εναλλακτική «αορίστου/ορισμένου χρόνου»."],
    ["UNFILLED_PLACEHOLDERS", "Το κείμενο περιέχει κενά πεδία (…… / ......)."],
    ["FEE_AMOUNT_UNRESOLVED", "Το κείμενο αφήνει κενό το ποσό ή το ποσοστό της αμοιβής."],
  ];
  for (const [code, message] of flagged) if (flags.includes(code as never)) problems.push({ code, message });

  if (kind === "SIMPLE_ASSIGNMENT" && mentionsExclusive(body)) problems.push({ code: "EXCLUSIVE_WORDING_IN_SIMPLE", message: "Το κείμενο της απλής ανάθεσης αναφέρει όρους αποκλειστικότητας." });
  if (kind === "EXCLUSIVE_ASSIGNMENT" && mentionsSimpleOrIndefinite(body)) problems.push({ code: "SIMPLE_WORDING_IN_EXCLUSIVE", message: "Το κείμενο της αποκλειστικής ανάθεσης αναφέρει απλή ανάθεση ή αόριστη διάρκεια." });
  if (kind === "SHOWING" && (mentionsExclusive(body) || ASSIGNMENT_WORDS.test(body))) problems.push({ code: "ASSIGNMENT_WORDING_IN_SHOWING", message: "Το κείμενο της υπόδειξης αναφέρει όρους ανάθεσης ή αποκλειστικότητας." });
  return problems;
}

/**
 * The last check on the finished text, whatever the template said: nothing
 * unresolved, nothing from the other kind.
 */
export function scanFinalText(kind: DocumentKind, text: string): ContentProblem[] {
  const problems: ContentProblem[] = [];
  if (/αορίστου\s*\/\s*ορισμένου|indefinite\s*\/\s*(?:definite|fixed)/i.test(text)) problems.push({ code: "DURATION_ALTERNATIVE", message: "Το έγγραφο περιέχει την εναλλακτική «αορίστου/ορισμένου χρόνου»." });
  if (/απλή\s*\/\s*αποκλειστική|αποκλειστική\s*\/\s*απλή|simple\s*\/\s*exclusive|exclusive\s*\/\s*simple/i.test(text)) problems.push({ code: "TYPE_ALTERNATIVE", message: "Το έγγραφο περιέχει την εναλλακτική «απλή/αποκλειστική»." });
  if (/…{2,}|\.{4,}|_{3,}/.test(text)) problems.push({ code: "BLANK_PLACEHOLDER", message: "Το έγγραφο περιέχει κενό πεδίο." });
  if (/\{\{|\}\}/.test(text)) problems.push({ code: "UNRESOLVED_FIELD", message: "Το έγγραφο περιέχει πεδίο που δεν συμπληρώθηκε." });
  if (/\b(?:undefined|null|NaN)\b/.test(text)) problems.push({ code: "BROKEN_VALUE", message: "Το έγγραφο περιέχει μη έγκυρη τιμή." });
  if (kind === "SIMPLE_ASSIGNMENT" && mentionsExclusive(text)) problems.push({ code: "EXCLUSIVE_IN_SIMPLE", message: "Η απλή ανάθεση περιέχει όρους αποκλειστικότητας." });
  if (kind === "EXCLUSIVE_ASSIGNMENT" && mentionsSimpleOrIndefinite(text)) problems.push({ code: "SIMPLE_IN_EXCLUSIVE", message: "Η αποκλειστική ανάθεση περιέχει όρους απλής ανάθεσης ή αόριστης διάρκειας." });
  return problems;
}

/** Footer line shared by the text and the PDF: template version and checksum prefix. */
export function templateReference(s: Pick<DocumentSnapshot, "language" | "template">): string {
  return `${L(s.language, "template")} ${L(s.language, "version")} ${s.template.version} · ${s.template.checksum.slice(0, 12)}`;
}

export function pageLabel(lang: DocumentLanguage, page: number, total: number): string {
  return `${L(lang, "page")} ${page} ${L(lang, "pageOf")} ${total}`;
}
