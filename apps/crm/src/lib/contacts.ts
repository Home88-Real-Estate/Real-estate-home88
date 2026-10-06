/** Labels and small helpers shared by the contact and showing screens. */

export const CONTACT_ROLE_LABEL: Record<string, string> = {
  BUYER: "Αγοραστής",
  SELLER: "Πωλητής",
  LANDLORD: "Εκμισθωτής",
  TENANT: "Μισθωτής",
  OTHER: "Άλλο",
};

export const CONTACT_STATUS_LABEL: Record<string, string> = { ACTIVE: "Ενεργή", INACTIVE: "Ανενεργή" };
export const CONTACT_STATUS_CLASS: Record<string, string> = { ACTIVE: "badge badge--ok", INACTIVE: "badge badge--muted" };

export const PREFERRED_METHOD_LABEL: Record<string, string> = { ANY: "Οποιοδήποτε", EMAIL: "Email", PHONE: "Τηλέφωνο", SMS: "SMS", WHATSAPP: "WhatsApp" };

export const LISTING_LABEL: Record<string, string> = { SALE: "Πώληση", RENT: "Ενοικίαση" };

export const PROPERTY_RELATION_LABEL: Record<string, string> = {
  OWNER: "Ιδιοκτήτης",
  CO_OWNER: "Συνιδιοκτήτης",
  BUYER: "Αγοραστής",
  TENANT: "Μισθωτής",
  INTERESTED: "Ενδιαφερόμενος",
};

export const TIMELINE_LABEL: Record<string, string> = {
  showing: "Υπόδειξη",
  reminder: "Υπενθύμιση",
  request: "Ζήτηση",
  viewing: "Ραντεβού",
  offer: "Προσφορά",
  message: "Μήνυμα",
  mandate: "Εντολή",
  property: "Ακίνητο",
  lead: "Lead",
  contact: "Επαφή",
};

/** Query string without empty values, for links that keep the active filters. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
}

export type DirectoryUser = { id: string; name: string };

/**
 * Tab registry. A tab with `ready: false` is a module that does not exist yet (calls, relationships):
 * it is not rendered, so nobody sees a placeholder for something that cannot be used.
 */
export const CONTACT_TABS = [
  { key: "details", label: "Στοιχεία", ready: true },
  { key: "properties", label: "Ακίνητα", ready: true },
  { key: "requests", label: "Ζητήσεις", ready: true },
  { key: "showings", label: "Υποδείξεις", ready: true },
  { key: "reminders", label: "Υπενθυμίσεις", ready: true },
  { key: "calls", label: "Κλήσεις", ready: false },
  { key: "relations", label: "Συσχετίσεις", ready: false },
  { key: "history", label: "Ιστορικό", ready: true },
  { key: "mandates", label: "Εντολές", ready: true },
  { key: "documents", label: "Έγγραφα", ready: true },
] as const;


// Fee-term options for the showing document. These are form labels only; the wording of the document
// itself comes from the approved template, and no default amount or rate is ever filled in.
export const FEE_PAYER_LABEL: Record<string, string> = { OWNER: "Ιδιοκτήτης", BUYER: "Αγοραστής", TENANT: "Μισθωτής", LANDLORD: "Εκμισθωτής", BOTH_PARTIES: "Αμφότεροι", OTHER: "Άλλος" };
export const FEE_METHOD_LABEL: Record<string, string> = { PERCENTAGE: "Ποσοστό", FIXED_AMOUNT: "Σταθερό ποσό", CUSTOM: "Ειδική συμφωνία", NEGOTIATED_LATER: "Θα συμφωνηθεί αργότερα" };
export const FEE_BASIS_LABEL: Record<string, string> = { ASKING_PRICE: "Τιμή προσφοράς", FINAL_SALE_PRICE: "Τελική τιμή πώλησης", MONTHLY_RENT: "Μηνιαίο μίσθωμα", ANNUAL_RENT: "Ετήσιο μίσθωμα", CONTRACT_VALUE: "Αξία συμβολαίου", OTHER: "Άλλη" };
export const VAT_TREATMENT_LABEL: Record<string, string> = { PLUS_VAT: "Πλέον ΦΠΑ", VAT_INCLUDED: "Συμπεριλαμβάνεται ΦΠΑ", VAT_EXEMPT: "Απαλλάσσεται", NOT_APPLICABLE: "Δεν εφαρμόζεται" };
export const PAYMENT_TRIGGER_LABEL: Record<string, string> = { RESERVATION: "Κράτηση", PRELIMINARY_AGREEMENT: "Προσύμφωνο", FINAL_CONTRACT: "Οριστικό συμβόλαιο", LEASE_SIGNING: "Υπογραφή μίσθωσης", INSTALLMENTS: "Δόσεις", CUSTOM: "Άλλο" };
