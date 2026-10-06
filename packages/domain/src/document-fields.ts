/**
 * Merge fields available to the approved wording of showing, assignment and
 * extension templates ({{principal.fullName}} …). The wording itself is never
 * written here: it is the lawyer-approved template version.
 */

export const DOCUMENT_MERGE_FIELDS = [
  { key: "document.number", label: "Αριθμός εγγράφου" },
  { key: "document.date", label: "Ημερομηνία έκδοσης" },
  { key: "document.place", label: "Τόπος έκδοσης" },
  { key: "company.legalName", label: "Επωνυμία γραφείου" },
  { key: "company.vatNumber", label: "ΑΦΜ γραφείου" },
  { key: "company.taxOffice", label: "ΔΟΥ γραφείου" },
  { key: "company.gemiNumber", label: "Αρ. ΓΕΜΗ" },
  { key: "company.address", label: "Έδρα γραφείου" },
  { key: "company.phone", label: "Τηλέφωνο γραφείου" },
  { key: "company.email", label: "Email γραφείου" },
  { key: "agent.fullName", label: "Εκπρόσωπος γραφείου" },
  { key: "client.fullName", label: "Ονοματεπώνυμο πελάτη (όλοι)" },
  { key: "client.taxId", label: "ΑΦΜ πελάτη" },
  { key: "client.idNumber", label: "Αρ. ταυτότητας πελάτη" },
  { key: "client.address", label: "Διεύθυνση πελάτη" },
  { key: "client.phone", label: "Τηλέφωνο πελάτη" },
  { key: "client.email", label: "Email πελάτη" },
  { key: "principal.fullName", label: "Ονοματεπώνυμο εντολέα (όλοι)" },
  { key: "principal.taxId", label: "ΑΦΜ εντολέα" },
  { key: "principal.idNumber", label: "Αρ. ταυτότητας εντολέα" },
  { key: "principal.address", label: "Διεύθυνση εντολέα" },
  { key: "principal.phone", label: "Τηλέφωνο εντολέα" },
  { key: "principal.email", label: "Email εντολέα" },
  { key: "property.reference", label: "Κωδικός ακινήτου (πρώτου)" },
  { key: "property.address", label: "Διεύθυνση ακινήτου (πρώτου)" },
  { key: "property.type", label: "Τύπος ακινήτου (πρώτου)" },
  { key: "property.size", label: "Εμβαδόν (m²) (πρώτου)" },
  { key: "property.price", label: "Τιμή (πρώτου)" },
  { key: "properties.references", label: "Κωδικοί όλων των ακινήτων" },
  { key: "term.type", label: "Είδος ανάθεσης" },
  { key: "term.startDate", label: "Έναρξη ισχύος" },
  { key: "term.endDate", label: "Λήξη ισχύος" },
  { key: "term.duration", label: "Διάρκεια" },
  { key: "fee.summary", label: "Αμοιβή (περίληψη)" },
  { key: "fee.payer", label: "Υπόχρεος καταβολής αμοιβής" },
  { key: "fee.vat", label: "Αντιμετώπιση ΦΠΑ" },
  { key: "mandate.number", label: "Αριθμός εντολής (παράταση)" },
  { key: "extension.previousEndDate", label: "Προηγούμενη λήξη (παράταση)" },
  { key: "extension.newEndDate", label: "Νέα λήξη (παράταση)" },
  { key: "extension.reason", label: "Αιτιολογία παράτασης" },
] as const;

export type DocumentMergeKey = (typeof DOCUMENT_MERGE_FIELDS)[number]["key"];
