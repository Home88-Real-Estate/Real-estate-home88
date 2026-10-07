/**
 * The HOME88 settings catalogue: every settings section, its fields, who may
 * see or change it, and which values are secrets.
 *
 * One description drives everything: the API builds its validation from it,
 * the CRM renders its forms from it, and the audit trail uses it to decide
 * what must be masked. Adding a field is an edit here plus a database column,
 * never a new hand-written form.
 *
 * Business values are never defaulted here. A default is only given where it
 * restates how the system already behaves (e.g. the 40% match threshold, the
 * 30-minute viewing) or a value HOME88 supplied (its brand colours). Company
 * details, legal data, commission rates, legal texts and credentials start
 * empty until an administrator enters them.
 *
 * This module is imported by client components, so it must never contain a
 * secret value — only the names of secret fields.
 */

import { AI_MODELS, AI_PROVIDERS } from "./ai";
import { zonedTime } from "./date-range";

export type SettingsFieldType =
  | "text"
  | "textarea"
  | "email"
  | "url"
  | "tel"
  | "int"
  | "decimal"
  | "percent"
  | "boolean"
  | "select"
  | "multiselect"
  | "time"
  | "date"
  | "color"
  | "weekdays"
  | "intList"
  | "secret";

export type SettingsOption = { value: string; label: string };

export type SettingsField = {
  key: string;
  label: string;
  type: SettingsFieldType;
  group?: string;
  help?: string;
  placeholder?: string;
  /** Text length limit. */
  max?: number;
  /** Numeric bounds. */
  min?: number;
  maxValue?: number;
  options?: readonly SettingsOption[];
  /** Restates current behaviour or a value HOME88 supplied; never a business guess. */
  default?: string | number | boolean | readonly string[] | readonly number[] | null;
  /**
   * Masked permanently in the audit trail ("changed — value masked"), e.g. tax
   * identifiers. Secrets are always masked; this flags non-secret values too.
   */
  sensitive?: boolean;
  /** Stored now, but the behaviour it controls arrives in a later phase. */
  appliesIn?: string;
  /** Shown but not editable (fixed by the platform). */
  readOnly?: boolean;
};

export type SettingsSectionKey =
  | "company"
  | "legal"
  | "branding"
  | "app"
  | "properties"
  | "contacts"
  | "requests"
  | "commissions"
  | "calendar"
  | "automation"
  | "ai"
  | "notifications"
  | "permissions"
  | "mandates"
  | "email"
  | "sms"
  | "portals"
  | "areas"
  | "security"
  | "privacy"
  | "subscription";

export type SettingsSection = {
  key: SettingsSectionKey;
  title: string;
  description: string;
  navGroup: string;
  /** "form": rendered from `fields`; "custom": has its own screen (matrix, list). */
  kind: "form" | "custom";
  fields: readonly SettingsField[];
  /** Database tables behind the section, for administrators and the audit trail. */
  storage: string;
  /** Credential scope for this section's secret fields. */
  secretScope?: string;
  /** A line explaining what part is not yet in effect, when any. */
  pendingNote?: string;
};

const opt = (value: string, label: string): SettingsOption => ({ value, label });

export const YES_NO_REQUESTS = [opt("NO", "Όχι"), opt("YES", "Ναι"), opt("REQUESTS_ONLY", "Μόνο στις ζητήσεις")] as const;

export const WEEKDAYS = [
  opt("1", "Δευτέρα"),
  opt("2", "Τρίτη"),
  opt("3", "Τετάρτη"),
  opt("4", "Πέμπτη"),
  opt("5", "Παρασκευή"),
  opt("6", "Σάββατο"),
  opt("7", "Κυριακή"),
] as const;

export const WATERMARK_POSITIONS = [
  opt("TOP_LEFT", "Πάνω αριστερά"),
  opt("TOP_CENTER", "Πάνω κέντρο"),
  opt("TOP_RIGHT", "Πάνω δεξιά"),
  opt("CENTER", "Κέντρο"),
  opt("BOTTOM_LEFT", "Κάτω αριστερά"),
  opt("BOTTOM_CENTER", "Κάτω κέντρο"),
  opt("BOTTOM_RIGHT", "Κάτω δεξιά"),
] as const;

export const CONTACT_SOURCES = [
  opt("WEBSITE", "Ιστότοπος"),
  opt("GOOGLE", "Google"),
  opt("FACEBOOK", "Facebook"),
  opt("INSTAGRAM", "Instagram"),
  opt("TIKTOK", "TikTok"),
  opt("PORTAL", "Portal"),
  opt("PHONE", "Τηλέφωνο"),
  opt("EMAIL", "Email"),
  opt("REFERRAL", "Σύσταση"),
  opt("WALK_IN", "Επίσκεψη στο γραφείο"),
  opt("EXISTING_CLIENT", "Υπάρχων πελάτης"),
  opt("OTHER", "Άλλο"),
] as const;

export const CALENDAR_EVENT_CATEGORIES = [
  opt("VIEWING", "Υπόδειξη"),
  opt("MEETING", "Συνάντηση"),
  opt("CALL", "Κλήση"),
  opt("VALUATION", "Εκτίμηση"),
  opt("SIGNING", "Υπογραφή"),
  opt("FOLLOW_UP", "Follow-up"),
  opt("CONTRACT", "Συμβόλαιο"),
  opt("CLOSING", "Κλείσιμο"),
  opt("OTHER", "Άλλο"),
] as const;

export const CALENDAR_EVENT_STATUSES = [
  opt("PLANNED", "Προγραμματισμένο"),
  opt("CONFIRMED", "Επιβεβαιωμένο"),
  opt("COMPLETED", "Ολοκληρώθηκε"),
  opt("CANCELLED", "Ακυρώθηκε"),
  opt("NO_SHOW", "Δεν ήρθε"),
] as const;

export const SIGNATURE_LEVELS = [
  opt("SIMPLE", "Απλή ηλεκτρονική υπογραφή"),
  opt("ADVANCED", "Προηγμένη ηλεκτρονική υπογραφή"),
  opt("QUALIFIED", "Εγκεκριμένη ηλεκτρονική υπογραφή (QES)"),
] as const;

export const MANDATE_TYPES = [
  opt("VIEWING", "Εντολή Υπόδειξης"),
  opt("SIMPLE_ASSIGNMENT", "Απλή Εντολή Ανάθεσης"),
  opt("EXCLUSIVE_ASSIGNMENT", "Αποκλειστική Εντολή Ανάθεσης"),
] as const;

/**
 * Every kind of document that has approved wording: the three mandate types
 * plus the showing (Υπόδειξη) and the extension of a mandate. Only
 * MANDATE_TYPES can be the type of a mandate record.
 */
export const TEMPLATE_TYPES = [
  ...MANDATE_TYPES,
  opt("SHOWING", "Υπόδειξη Ακινήτου"),
  opt("MANDATE_EXTENSION", "Παράταση Εντολής"),
] as const;

export const TEMPLATE_LOCALES = [opt("el", "Ελληνικά"), opt("en", "English")] as const;

export const SUBSCRIPTION_STATUSES = [
  opt("ACTIVE", "Ενεργή"),
  opt("TRIAL", "Δοκιμαστική"),
  opt("PAST_DUE", "Εκκρεμεί πληρωμή"),
  opt("EXPIRED", "Έληξε"),
  opt("CANCELLED", "Ακυρώθηκε"),
] as const;

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    key: "company",
    title: "Εταιρία",
    navGroup: "Εταιρία",
    kind: "form",
    description:
      "Τα στοιχεία που βλέπουν οι πελάτες στον ιστότοπο και στα μηνύματα. Ό,τι μείνει κενό δεν εμφανίζεται πουθενά. Το logo ρυθμίζεται στο Branding.",
    storage: "company_settings · company_social_links · company_profiles",
    fields: [
      { key: "officeName", label: "Όνομα γραφείου", type: "text", max: 120, group: "Βασικά στοιχεία" },
      { key: "legalName", label: "Νομική επωνυμία", type: "text", max: 200, group: "Βασικά στοιχεία", help: "Όπως εμφανίζεται στον ιστότοπο. Τα επίσημα στοιχεία για έγγραφα είναι στα Νομικά & Φορολογικά." },
      { key: "website", label: "Ιστότοπος", type: "url", max: 200, group: "Βασικά στοιχεία", placeholder: "https://" },
      { key: "email", label: "Email επικοινωνίας", type: "email", max: 160, group: "Βασικά στοιχεία" },
      { key: "phone1", label: "Τηλέφωνο 1", type: "tel", max: 30, group: "Τηλέφωνα" },
      { key: "phone2", label: "Τηλέφωνο 2", type: "tel", max: 30, group: "Τηλέφωνα" },
      { key: "mobile", label: "Κινητό", type: "tel", max: 30, group: "Τηλέφωνα" },
      { key: "addressEl", label: "Διεύθυνση (Ελληνικά)", type: "text", max: 200, group: "Διεύθυνση" },
      { key: "addressEn", label: "Διεύθυνση (English)", type: "text", max: 200, group: "Διεύθυνση" },
      { key: "city", label: "Πόλη", type: "text", max: 80, group: "Διεύθυνση" },
      { key: "postalCode", label: "Τ.Κ.", type: "text", max: 10, group: "Διεύθυνση" },
      { key: "country", label: "Χώρα", type: "text", max: 60, group: "Διεύθυνση" },
      { key: "hoursEl", label: "Ωράριο (Ελληνικά)", type: "textarea", max: 300, group: "Ωράριο λειτουργίας" },
      { key: "hoursEn", label: "Ωράριο (English)", type: "textarea", max: 300, group: "Ωράριο λειτουργίας" },
      { key: "profileEl", label: "Προφίλ (Ελληνικά)", type: "textarea", max: 8000, group: "Προφίλ εταιρίας", help: "Εμφανίζεται στη σελίδα «Η εταιρεία»." },
      { key: "profileEn", label: "Προφίλ (English)", type: "textarea", max: 8000, group: "Προφίλ εταιρίας" },
      { key: "socialFacebook", label: "Facebook", type: "url", max: 300, group: "Social media", placeholder: "https://facebook.com/…" },
      { key: "socialInstagram", label: "Instagram", type: "url", max: 300, group: "Social media", placeholder: "https://instagram.com/…" },
      { key: "socialYoutube", label: "YouTube", type: "url", max: 300, group: "Social media" },
      { key: "socialLinkedin", label: "LinkedIn", type: "url", max: 300, group: "Social media" },
      { key: "socialX", label: "X / Twitter", type: "url", max: 300, group: "Social media" },
      { key: "socialPinterest", label: "Pinterest", type: "url", max: 300, group: "Social media" },
      { key: "socialTiktok", label: "TikTok", type: "url", max: 300, group: "Social media" },
    ],
  },
  {
    key: "legal",
    title: "Νομικά & Φορολογικά",
    navGroup: "Εταιρία",
    kind: "form",
    description:
      "Επίσημα στοιχεία για εντολές, συμβάσεις και παραστατικά. Ορατά μόνο σε όσους έχουν σχετικό δικαίωμα. Ο ΑΦΜ και το ΓΕΜΗ δεν καταγράφονται ποτέ στο ιστορικό αλλαγών.",
    storage: "company_legal_details",
    fields: [
      { key: "legalNameEl", label: "Επωνυμία (Ελληνικά)", type: "text", max: 200, group: "Επωνυμία" },
      { key: "legalNameEn", label: "Επωνυμία (English)", type: "text", max: 200, group: "Επωνυμία" },
      { key: "activityEl", label: "Δραστηριότητα (Ελληνικά)", type: "text", max: 200, group: "Επωνυμία" },
      { key: "activityEn", label: "Δραστηριότητα (English)", type: "text", max: 200, group: "Επωνυμία" },
      { key: "vatNumber", label: "ΑΦΜ", type: "text", max: 9, group: "Φορολογικά", sensitive: true, help: "9 ψηφία· ελέγχεται το ψηφίο ελέγχου." },
      { key: "taxOffice", label: "ΔΟΥ", type: "text", max: 80, group: "Φορολογικά" },
      { key: "gemiNumber", label: "ΓΕΜΗ", type: "text", max: 14, group: "Φορολογικά", sensitive: true },
      { key: "kefodeEl", label: "ΚΕΦΟΔΕ (Ελληνικά)", type: "text", max: 120, group: "Φορολογικά" },
      { key: "kefodeEn", label: "ΚΕΦΟΔΕ (English)", type: "text", max: 120, group: "Φορολογικά" },
      { key: "registeredAddressEl", label: "Έδρα (Ελληνικά)", type: "textarea", max: 300, group: "Έδρα", help: "Πλήρης διεύθυνση με πόλη και Τ.Κ." },
      { key: "registeredAddressEn", label: "Έδρα (English)", type: "textarea", max: 300, group: "Έδρα" },
      { key: "phone", label: "Τηλέφωνο", type: "tel", max: 30, group: "Επικοινωνία" },
      { key: "legalEmail", label: "Email νομικής επικοινωνίας", type: "email", max: 160, group: "Επικοινωνία" },
    ],
  },
  {
    key: "branding",
    title: "Branding & Ιστότοπος",
    navGroup: "Εταιρία",
    kind: "form",
    description:
      "Logo, χρώματα και βασικά στοιχεία του ιστότοπου. Τα χρώματα ελέγχονται για αντίθεση, ώστε μια αλλαγή να μην κάνει το site δυσανάγνωστο.",
    storage: "company_branding",
    fields: [
      { key: "logoUrl", label: "Logo", type: "url", max: 500, group: "Logo", help: "Διεύθυνση εικόνας (https://… ή /images/…). SVG ή PNG με διάφανο φόντο." },
      { key: "faviconUrl", label: "Favicon", type: "url", max: 500, group: "Logo" },
      { key: "colorPrimary", label: "Κύριο μπλε", type: "color", group: "Χρώματα", default: "#0B5394" },
      { key: "colorDark", label: "Σκούρο μπλε", type: "color", group: "Χρώματα", default: "#053755" },
      { key: "colorSecondary", label: "Δεύτερο μπλε", type: "color", group: "Χρώματα", default: "#168BBE" },
      { key: "colorBackground", label: "Ανοιχτό φόντο", type: "color", group: "Χρώματα", default: "#F5F8FB" },
      { key: "siteTitle", label: "Τίτλος ιστότοπου", type: "text", max: 70, group: "Ιστότοπος", help: "Εμφανίζεται στις καρτέλες του browser και στη Google." },
      { key: "siteDescription", label: "Περιγραφή ιστότοπου", type: "textarea", max: 300, group: "Ιστότοπος" },
      { key: "defaultLanguage", label: "Προεπιλεγμένη γλώσσα", type: "select", group: "Γλώσσες", options: TEMPLATE_LOCALES, default: "el" },
      { key: "availableLanguages", label: "Διαθέσιμες γλώσσες", type: "multiselect", group: "Γλώσσες", options: TEMPLATE_LOCALES, default: ["el", "en"] },
    ],
  },
  {
    key: "app",
    title: "Εφαρμογή",
    navGroup: "Λειτουργία CRM",
    kind: "form",
    description: "Γενικές επιλογές για αγγελίες, χάρτες, φωτογραφίες και εμφάνιση στοιχείων πελατών.",
    storage: "app_settings",
    secretScope: "maps",
    fields: [
      { key: "listingFooterEl", label: "Κείμενο αγγελιών (Ελληνικά)", type: "textarea", max: 2000, group: "Αγγελίες", help: "Σταθερό κείμενο που προστίθεται στην περιγραφή κάθε αγγελίας.", appliesIn: "Φάση 6" },
      { key: "listingFooterEn", label: "Κείμενο αγγελιών (English)", type: "textarea", max: 2000, group: "Αγγελίες", appliesIn: "Φάση 6" },
      { key: "uppercaseDescriptions", label: "Μετατροπή περιγραφής σε κεφαλαία", type: "boolean", group: "Αγγελίες", default: false, appliesIn: "Φάση 6" },
      { key: "uploadMode", label: "Ανέβασμα φωτογραφιών", type: "select", group: "Φωτογραφίες", options: [opt("BROWSER_OPTIMIZED", "Απευθείας, με αυτόματη έκδοση για web (τρέχουσα λειτουργία)")], default: "BROWSER_OPTIMIZED", readOnly: true, help: "Αντικαθιστά τον «Τύπο ανεβάσματος» του Estate+." },
      { key: "watermarkEnabled", label: "Αυτόματο υδατογράφημα", type: "boolean", group: "Φωτογραφίες", default: false, appliesIn: "Φάση 4" },
      { key: "watermarkPosition", label: "Θέση υδατογραφήματος", type: "select", group: "Φωτογραφίες", options: WATERMARK_POSITIONS, default: "BOTTOM_RIGHT", appliesIn: "Φάση 4" },
      { key: "allowDuplicateContacts", label: "Να επιτρέπονται διπλότυπα στοιχεία επικοινωνίας", type: "boolean", group: "Πελάτες", default: false, appliesIn: "Φάση 2" },
      { key: "showCustomerNames", label: "Ονόματα πελατών στους πίνακες", type: "select", group: "Πελάτες", options: YES_NO_REQUESTS, default: "YES", appliesIn: "Φάση 2" },
      { key: "showContactDetails", label: "Διευθύνσεις και στοιχεία επικοινωνίας στους πίνακες", type: "select", group: "Πελάτες", options: YES_NO_REQUESTS, default: "YES", appliesIn: "Φάση 2" },
      { key: "propertyRefreshDays", label: "Ημέρες για επικαιροποίηση ακινήτων", type: "int", min: 1, maxValue: 730, group: "Επικαιροποίηση", appliesIn: "Φάση 5" },
      { key: "requestRefreshDays", label: "Ημέρες για επικαιροποίηση ζητήσεων", type: "int", min: 1, maxValue: 730, group: "Επικαιροποίηση", appliesIn: "Φάση 5" },
      { key: "mapDefaultLat", label: "Προεπιλεγμένο γεωγρ. πλάτος (latitude)", type: "decimal", min: -90, maxValue: 90, group: "Χάρτης" },
      { key: "mapDefaultLng", label: "Προεπιλεγμένο γεωγρ. μήκος (longitude)", type: "decimal", min: -180, maxValue: 180, group: "Χάρτης" },
      { key: "showExactLocation", label: "Πραγματική θέση ακινήτου στον χάρτη κατά την επεξεργασία", type: "boolean", group: "Χάρτης", default: true },
      { key: "mapsBrowserKey", label: "Κλειδί Google Maps για τον browser", type: "text", max: 200, group: "Χάρτης", help: "Είναι από τη φύση του ορατό στους επισκέπτες. Περιορίστε το στο Google Cloud στα domains σας και μόνο στα Maps APIs." },
      { key: "mapsServerKey", label: "Κλειδί Google για τον server (geocoding)", type: "secret", group: "Χάρτης", help: "Μυστικό: αποθηκεύεται κρυπτογραφημένο και δεν εμφανίζεται ξανά." },
      { key: "timezone", label: "Ζώνη ώρας", type: "select", group: "Τοπικές ρυθμίσεις", options: [opt("Europe/Athens", "Ελλάδα (Europe/Athens)")], default: "Europe/Athens", readOnly: true },
      { key: "currency", label: "Νόμισμα", type: "select", group: "Τοπικές ρυθμίσεις", options: [opt("EUR", "Ευρώ (EUR)")], default: "EUR", readOnly: true },
    ],
  },
  {
    key: "properties",
    title: "Ακίνητα",
    navGroup: "Λειτουργία CRM",
    kind: "custom",
    description:
      "Κανόνες δημοσίευσης, εσωτερικές ετικέτες και τα πεδία κάθε τύπου ακινήτου. Τα πεδία διαφέρουν ανά τύπο και είδος συναλλαγής· δεν υπάρχει μία κοινή λίστα για όλα.",
    storage: "property_settings · property_tags",
    pendingNote: "Η ροή έγκρισης, ο έλεγχος πριν τη δημοσίευση και η επισήμανση ακινήτων με ετικέτες εφαρμόζονται στη Φάση 4.",
    fields: [
      { key: "approvalRequired", label: "Έγκριση από υπεύθυνο πριν τη δημοσίευση", type: "boolean", group: "Δημοσίευση", default: false, appliesIn: "Φάση 4" },
      { key: "minPhotosToPublish", label: "Ελάχιστες φωτογραφίες για δημοσίευση", type: "int", min: 0, maxValue: 100, group: "Δημοσίευση", appliesIn: "Φάση 4" },
      { key: "requireEnglishDescription", label: "Υποχρεωτική αγγλική περιγραφή", type: "boolean", group: "Δημοσίευση", default: false, appliesIn: "Φάση 4" },
      { key: "requireEnergyClass", label: "Υποχρεωτική ενεργειακή κλάση", type: "boolean", group: "Δημοσίευση", default: false, appliesIn: "Φάση 4" },
      { key: "staleAfterDays", label: "Ειδοποίηση για ακίνητο χωρίς ενημέρωση μετά από (ημέρες)", type: "int", min: 1, maxValue: 730, group: "Παρακολούθηση", help: "Δημιουργείται εργασία για τον υπεύθυνο συνεργάτη (Ρυθμίσεις → Αυτοματισμοί). Κενό = ανενεργό." },
    ],
  },
  {
    key: "contacts",
    title: "Επαφές",
    navGroup: "Λειτουργία CRM",
    kind: "form",
    description: "Πηγές επαφών, έλεγχος διπλοτύπων και προτιμήσεις επικοινωνίας.",
    storage: "contact_settings",
    pendingNote: "Ο εντοπισμός διπλοτύπων και οι νέες πηγές εφαρμόζονται στη Φάση 2.",
    fields: [
      { key: "duplicateCheckPhone", label: "Έλεγχος διπλοτύπων με τηλέφωνο", type: "boolean", group: "Διπλότυπα", default: true, appliesIn: "Φάση 2" },
      { key: "duplicateCheckEmail", label: "Έλεγχος διπλοτύπων με email", type: "boolean", group: "Διπλότυπα", default: true, appliesIn: "Φάση 2" },
      { key: "duplicateCheckName", label: "Έλεγχος διπλοτύπων με ονοματεπώνυμο", type: "boolean", group: "Διπλότυπα", default: false, appliesIn: "Φάση 2" },
      { key: "enabledSources", label: "Πηγές επαφών", type: "multiselect", group: "Πηγές", options: CONTACT_SOURCES, default: CONTACT_SOURCES.map((s) => s.value), appliesIn: "Φάση 2" },
      {
        key: "defaultContactMethod",
        label: "Προτιμώμενος τρόπος επικοινωνίας (προεπιλογή)",
        type: "select",
        group: "Επικοινωνία",
        options: [opt("PHONE", "Τηλέφωνο"), opt("EMAIL", "Email"), opt("WHATSAPP", "WhatsApp"), opt("SMS", "SMS"), opt("ANY", "Οποιοσδήποτε")],
        appliesIn: "Φάση 2",
      },
    ],
  },
  {
    key: "requests",
    title: "Ζητήσεις",
    navGroup: "Λειτουργία CRM",
    kind: "form",
    description:
      "Πώς βαθμολογείται ένα ακίνητο απέναντι σε μια ζήτηση. Οι αλλαγές ισχύουν αμέσως στη λίστα «Ακίνητα που ταιριάζουν».",
    storage: "request_settings",
    fields: [
      { key: "minMatchScore", label: "Ελάχιστο ποσοστό ταιριάσματος (%)", type: "int", min: 0, maxValue: 100, group: "Αντιστοίχιση", default: 40 },
      { key: "maxMatches", label: "Μέγιστος αριθμός προτάσεων", type: "int", min: 1, maxValue: 200, group: "Αντιστοίχιση", default: 50 },
      { key: "priceTolerancePct", label: "Ανοχή τιμής πάνω από το μέγιστο (%)", type: "int", min: 0, maxValue: 50, group: "Αντιστοίχιση", default: 5 },
      { key: "sizeTolerancePct", label: "Ανοχή εμβαδού πάνω από το μέγιστο (%)", type: "int", min: 0, maxValue: 50, group: "Αντιστοίχιση", default: 10 },
      { key: "weightArea", label: "Περιοχή", type: "int", min: 0, maxValue: 100, group: "Βάρη κριτηρίων", default: 25 },
      { key: "weightPrice", label: "Τιμή", type: "int", min: 0, maxValue: 100, group: "Βάρη κριτηρίων", default: 30 },
      { key: "weightSize", label: "Εμβαδόν", type: "int", min: 0, maxValue: 100, group: "Βάρη κριτηρίων", default: 15 },
      { key: "weightBedrooms", label: "Υπνοδωμάτια", type: "int", min: 0, maxValue: 100, group: "Βάρη κριτηρίων", default: 10 },
      { key: "weightBathrooms", label: "Μπάνια", type: "int", min: 0, maxValue: 100, group: "Βάρη κριτηρίων", default: 5 },
      { key: "weightFloor", label: "Όροφος", type: "int", min: 0, maxValue: 100, group: "Βάρη κριτηρίων", default: 5 },
      { key: "weightYear", label: "Έτος κατασκευής", type: "int", min: 0, maxValue: 100, group: "Βάρη κριτηρίων", default: 5 },
      { key: "weightFeatures", label: "Παροχές (σύνολο)", type: "int", min: 0, maxValue: 100, group: "Βάρη κριτηρίων", default: 10 },
      { key: "expiryDays", label: "Λήξη ζήτησης μετά από (ημέρες)", type: "int", min: 1, maxValue: 1095, group: "Κύκλος ζωής", appliesIn: "Φάση 5" },
      {
        key: "newMatchAlerts",
        label: "Νέες αντιστοιχίσεις ακινήτων",
        type: "select",
        group: "Κύκλος ζωής",
        options: [opt("MANUAL", "Χωρίς εργασία (ο συνεργάτης ψάχνει μόνος)"), opt("APPROVAL", "Εργασία για τον συνεργάτη να στείλει τις αντιστοιχίσεις")],
        default: "MANUAL",
        help: "Όταν ένα νέο ακίνητο ταιριάζει σε ενεργή ζήτηση. Ο πελάτης δεν λαμβάνει ποτέ μήνυμα αυτόματα· το μήνυμα το στέλνει ο συνεργάτης από την επαφή.",
      },
    ],
  },
  {
    key: "commissions",
    title: "Προμήθειες",
    navGroup: "Λειτουργία CRM",
    kind: "form",
    description:
      "Οι προεπιλεγμένοι κανόνες προμήθειας. Μένουν κενοί μέχρι να τους ορίσει η HOME88· ο υπολογισμός στις συναλλαγές θα τους χρησιμοποιεί.",
    storage: "commission_settings",
    pendingNote: "Ο υπολογισμός προμήθειας στις συναλλαγές έρχεται στη Φάση 4.",
    fields: [
      { key: "saleCommissionPct", label: "Πώληση (%)", type: "percent", group: "Προεπιλογές" },
      { key: "rentCommissionMonths", label: "Ενοικίαση (μήνες μισθώματος)", type: "decimal", min: 0, maxValue: 24, group: "Προεπιλογές" },
      { key: "assignmentCommissionPct", label: "Ανάθεση (%)", type: "percent", group: "Προεπιλογές" },
      { key: "minimumFee", label: "Ελάχιστη αμοιβή (€)", type: "decimal", min: 0, maxValue: 10000000, group: "Προεπιλογές" },
      { key: "buyerSidePct", label: "Πλευρά αγοραστή (%)", type: "percent", group: "Πλευρές" },
      { key: "sellerSidePct", label: "Πλευρά πωλητή (%)", type: "percent", group: "Πλευρές" },
      { key: "agentSharePct", label: "Ποσοστό συνεργάτη (%)", type: "percent", group: "Μοιρασιά", help: "Μαζί με το ποσοστό γραφείου πρέπει να κάνουν 100%." },
      { key: "agencySharePct", label: "Ποσοστό γραφείου (%)", type: "percent", group: "Μοιρασιά" },
      { key: "vatMode", label: "ΦΠΑ στις προμήθειες", type: "select", group: "ΦΠΑ", options: [opt("EXCLUSIVE", "Επιπλέον της προμήθειας"), opt("INCLUSIVE", "Περιλαμβάνεται στην προμήθεια")] },
      { key: "vatRatePct", label: "Συντελεστής ΦΠΑ (%)", type: "percent", group: "ΦΠΑ" },
    ],
  },
  {
    key: "calendar",
    title: "Ημερολόγιο",
    navGroup: "Λειτουργία CRM",
    kind: "form",
    description: "Ωράριο, διάρκειες ραντεβού και κατηγορίες συμβάντων.",
    storage: "calendar_settings",
    fields: [
      { key: "timezone", label: "Ζώνη ώρας", type: "select", group: "Ωράριο", options: [opt("Europe/Athens", "Ελλάδα (Europe/Athens)")], default: "Europe/Athens", readOnly: true },
      { key: "workingDays", label: "Εργάσιμες ημέρες", type: "weekdays", group: "Ωράριο", appliesIn: "Φάση 3" },
      { key: "workdayStart", label: "Έναρξη", type: "time", group: "Ωράριο", appliesIn: "Φάση 3" },
      { key: "workdayEnd", label: "Λήξη", type: "time", group: "Ωράριο", appliesIn: "Φάση 3" },
      { key: "viewingMinutes", label: "Διάρκεια υπόδειξης (λεπτά)", type: "int", min: 10, maxValue: 480, group: "Διάρκειες", default: 30, help: "Προτείνεται στη φόρμα νέου ραντεβού." },
      { key: "defaultAppointmentMinutes", label: "Διάρκεια άλλων ραντεβού (λεπτά)", type: "int", min: 10, maxValue: 480, group: "Διάρκειες", default: 30, appliesIn: "Φάση 3" },
      { key: "reminderMinutesBefore", label: "Υπενθύμιση πριν το ραντεβού (λεπτά)", type: "int", min: 0, maxValue: 10080, group: "Υπενθυμίσεις" },
      { key: "enabledEventCategories", label: "Κατηγορίες συμβάντων", type: "multiselect", group: "Συμβάντα", options: CALENDAR_EVENT_CATEGORIES, default: CALENDAR_EVENT_CATEGORIES.map((c) => c.value), appliesIn: "Φάση 3" },
    ],
  },
  {
    key: "automation",
    title: "Αυτοματισμοί",
    navGroup: "Λειτουργία CRM",
    kind: "form",
    description:
      "Κανόνες που δημιουργούν εργασία για τον υπεύθυνο όταν κάτι μένει χωρίς ενέργεια. Κάθε κανόνας είναι ανενεργός μέχρι να ορίσετε τις ημέρες του. Οι αυτοματισμοί δημιουργούν μόνο εργασίες και ειδοποιήσεις προς το προσωπικό· δεν στέλνουν ποτέ μήνυμα σε πελάτη.",
    storage: "automation_settings",
    fields: [
      { key: "leadStaleDays", label: "Lead χωρίς επικοινωνία (ημέρες)", type: "int", min: 0, maxValue: 365, group: "Κανόνες", help: "Ημέρες από την τελευταία επικοινωνία (ή τη δημιουργία) ενός ανοιχτού lead. Κενό = ανενεργός." },
      { key: "viewingFollowUpDays", label: "Υπόδειξη χωρίς follow-up (ημέρες)", type: "int", min: 0, maxValue: 365, group: "Κανόνες", help: "Ημέρες μετά από ολοκληρωμένη υπόδειξη χωρίς άλλη ενέργεια στο lead. Κενό = ανενεργός." },
      { key: "mandateExpiryDays", label: "Λήξη εντολής (ημέρες πριν)", type: "int", min: 0, maxValue: 365, group: "Κανόνες", help: "Ημέρες πριν τη λήξη υπογεγραμμένης εντολής. Κενό = ανενεργός." },
      { key: "offerExpiryDays", label: "Λήξη προσφοράς (ημέρες πριν)", type: "int", min: 0, maxValue: 365, group: "Κανόνες", help: "Ημέρες πριν τη λήξη προσφοράς που περιμένει απάντηση. Κενό = ανενεργός." },
      { key: "sellerFollowUpOverdueDays", label: "Εκπρόθεσμο follow-up ιδιοκτήτη (ημέρες)", type: "int", min: 0, maxValue: 365, group: "Κανόνες", help: "Ημέρες καθυστέρησης της προγραμματισμένης επικοινωνίας με ιδιοκτήτη (0 = την ίδια μέρα). Κενό = ανενεργός." },
    ],
    pendingNote:
      "Ο κανόνας «ακίνητο χωρίς ενημέρωση» ορίζεται στις Ρυθμίσεις → Ακίνητα (Παρακολούθηση)· οι νέες αντιστοιχίσεις στις Ρυθμίσεις → Ζητήσεις.",
  },
  {
    key: "ai",
    title: "AI βοηθός",
    navGroup: "Λειτουργία CRM",
    kind: "form",
    description:
      "Πρόχειρα κείμενα που ελέγχει ένας άνθρωπος πριν τα χρησιμοποιήσει. Το σύστημα δεν στέλνει, δεν αποθηκεύει και δεν δημοσιεύει τίποτα από μόνο του, και δεν παραδίδει σε εξωτερική υπηρεσία ονόματα, τηλέφωνα, email ή διευθύνσεις πελατών ή ιδιοκτητών. Μένει ανενεργός μέχρι να τον ενεργοποιήσετε.",
    storage: "ai_settings · provider_credentials",
    secretScope: "ai",
    pendingNote:
      "Τα στοιχεία του ακινήτου (χωρίς διεύθυνση) και τα συγκεντρωτικά νούμερα των αναφορών αποστέλλονται στον πάροχο που θα επιλέξετε. Πριν ενεργοποιήσετε, ελέγξτε τη σύμβαση επεξεργασίας δεδομένων με τον πάροχο και ενημερώστε την πολιτική απορρήτου σας.",
    fields: [
      { key: "enabled", label: "Ενεργοποίηση AI βοηθού", type: "boolean", group: "Γενικά", default: false },
      { key: "provider", label: "Πάροχος", type: "select", group: "Πάροχος", options: AI_PROVIDERS },
      { key: "model", label: "Μοντέλο", type: "select", group: "Πάροχος", options: AI_MODELS },
      { key: "apiKey", label: "API key", type: "secret", group: "Διαπιστευτήρια" },
      { key: "allowDescriptions", label: "Πρόχειρη περιγραφή ακινήτου", type: "boolean", group: "Επιτρεπόμενες χρήσεις", default: false, help: "Από τα στοιχεία του ακινήτου, χωρίς στοιχεία ιδιοκτήτη." },
      { key: "allowReportSummaries", label: "Σύνοψη αναφορών", type: "boolean", group: "Επιτρεπόμενες χρήσεις", default: false, help: "Από τα συγκεντρωτικά νούμερα μιας αναφοράς." },
      { key: "hourlyLimitPerUser", label: "Όριο αιτημάτων ανά χρήστη ανά ώρα", type: "int", min: 1, maxValue: 500, group: "Όρια", default: 20, help: "Τεχνικό όριο για έλεγχο κόστους." },
    ],
  },
  {
    key: "notifications",
    title: "Υπενθυμίσεις & Ειδοποιήσεις",
    navGroup: "Λειτουργία CRM",
    kind: "custom",
    description: "Ποιο συμβάν ειδοποιεί από ποιο κανάλι. Email και SMS ενεργοποιούνται μόνο αφού ρυθμιστεί ο αντίστοιχος πάροχος.",
    storage: "notification_settings",
    fields: [],
  },
  {
    key: "permissions",
    title: "Ομάδες & Δικαιώματα",
    navGroup: "Ομάδες & ασφάλεια",
    kind: "custom",
    description: "Ποιος ρόλος βλέπει και αλλάζει κάθε ενότητα ρυθμίσεων. Ο έλεγχος γίνεται στον server, όχι με απόκρυψη κουμπιών.",
    storage: "role_permissions",
    fields: [],
  },
  {
    key: "mandates",
    title: "Ψηφιακές Εντολές",
    navGroup: "Έγγραφα & επικοινωνία",
    kind: "custom",
    description:
      "Αρίθμηση, πάροχος υπογραφής και τα κείμενα των εντολών σε εκδόσεις. Κείμενα δεν δημιουργούνται αυτόματα: προστίθενται μόνο τα κείμενα που έχει εγκρίνει ο δικηγόρος σας.",
    storage: "mandate_settings · mandate_templates · mandate_template_versions",
    secretScope: "signature",
    pendingNote:
      "Οι εντολές εκδίδονται από τη σελίδα Εντολές με το ενεργό κείμενο κάθε τύπου. Η ηλεκτρονική υπογραφή ενεργοποιείται όταν συνδεθεί ο πάροχος που θα επιλέξετε· μέχρι τότε υπογράφονται σε χαρτί και ανεβαίνει το υπογεγραμμένο αντίγραφο.",
    fields: [
      { key: "numberingPrefix", label: "Πρόθεμα αρίθμησης", type: "text", max: 12, group: "Αρίθμηση", placeholder: "π.χ. ΕΝΤ" },
      { key: "numberingDigits", label: "Ψηφία αριθμού", type: "int", min: 1, maxValue: 10, group: "Αρίθμηση" },
      { key: "signatureProvider", label: "Πάροχος υπογραφής", type: "text", max: 80, group: "Υπογραφή" },
      { key: "signatureLevel", label: "Επίπεδο υπογραφής", type: "select", group: "Υπογραφή", options: SIGNATURE_LEVELS },
      { key: "signatureApiUrl", label: "API URL παρόχου", type: "url", max: 300, group: "Υπογραφή" },
      { key: "signatureAccountId", label: "Account ID", type: "text", max: 120, group: "Υπογραφή" },
      { key: "signatureApiKey", label: "API key", type: "secret", group: "Υπογραφή" },
      { key: "signatureWebhookSecret", label: "Webhook secret", type: "secret", group: "Υπογραφή" },
      { key: "signingExpiryDays", label: "Λήξη συνδέσμου υπογραφής (ημέρες)", type: "int", min: 1, maxValue: 365, group: "Κύκλος υπογραφής" },
      { key: "reminderScheduleDays", label: "Υπενθυμίσεις μετά από (ημέρες)", type: "intList", group: "Κύκλος υπογραφής", placeholder: "π.χ. 1, 3, 7", appliesIn: "Φάση 5" },
      { key: "retentionYears", label: "Διατήρηση υπογεγραμμένων (έτη)", type: "int", min: 1, maxValue: 50, group: "Διατήρηση", help: "Ορίζεται μετά από νομικό έλεγχο." },
    ],
  },
  {
    key: "email",
    title: "Email",
    navGroup: "Έγγραφα & επικοινωνία",
    kind: "form",
    description:
      "Ο πάροχος για όλα τα email του συστήματος (επαναφορά κωδικού, προσκλήσεις, ειδοποιήσεις). Οι κωδικοί αποθηκεύονται κρυπτογραφημένοι και δεν εμφανίζονται ξανά.",
    storage: "email_settings · provider_credentials",
    secretScope: "email",
    fields: [
      { key: "mode", label: "Τρόπος αποστολής", type: "select", group: "Πάροχος", options: [opt("SMTP", "SMTP"), opt("API", "Υπηρεσία API")] },
      { key: "apiProvider", label: "Υπηρεσία API", type: "text", max: 80, group: "Πάροχος", help: "Μόνο για «Υπηρεσία API». Ο προσαρμογέας της προστίθεται στη Φάση 6.", appliesIn: "Φάση 6" },
      { key: "smtpHost", label: "SMTP host", type: "text", max: 200, group: "SMTP" },
      { key: "smtpPort", label: "SMTP port", type: "int", min: 1, maxValue: 65535, group: "SMTP" },
      { key: "smtpUsername", label: "SMTP username", type: "text", max: 200, group: "SMTP" },
      { key: "smtpPassword", label: "SMTP password", type: "secret", group: "SMTP" },
      { key: "smtpTls", label: "Χρήση TLS", type: "boolean", group: "SMTP", default: true },
      { key: "apiKey", label: "API key", type: "secret", group: "Πάροχος", appliesIn: "Φάση 6" },
      { key: "fromName", label: "Όνομα αποστολέα", type: "text", max: 120, group: "Αποστολέας" },
      { key: "fromEmail", label: "Email αποστολέα", type: "email", max: 160, group: "Αποστολέας" },
      { key: "replyTo", label: "Reply-to", type: "email", max: 160, group: "Αποστολέας" },
      { key: "disclaimerEl", label: "Μήνυμα disclaimer (Ελληνικά)", type: "textarea", max: 2000, group: "Υποσέλιδο" },
      { key: "disclaimerEn", label: "Μήνυμα disclaimer (English)", type: "textarea", max: 2000, group: "Υποσέλιδο" },
    ],
  },
  {
    key: "sms",
    title: "SMS",
    navGroup: "Έγγραφα & επικοινωνία",
    kind: "form",
    description: "Ο πάροχος SMS για υπενθυμίσεις και μαζικά μηνύματα. Μένει ανενεργό μέχρι να ρυθμιστεί.",
    storage: "sms_settings · provider_credentials",
    secretScope: "sms",
    pendingNote: "Η αποστολή SMS λειτουργεί μόλις επιλέξετε πάροχο και προστεθεί ο προσαρμογέας του. Μέχρι τότε, τα SMS δεν αποστέλλονται.",
    fields: [
      { key: "provider", label: "Πάροχος", type: "text", max: 80, group: "Πάροχος" },
      { key: "senderName", label: "Όνομα αποστολέα", type: "text", max: 11, group: "Πάροχος", help: "Έως 11 λατινικοί χαρακτήρες ή αριθμοί." },
      { key: "accountId", label: "Account ID", type: "text", max: 120, group: "Πάροχος" },
      { key: "apiKey", label: "API key", type: "secret", group: "Διαπιστευτήρια" },
      { key: "apiSecret", label: "API secret", type: "secret", group: "Διαπιστευτήρια" },
    ],
  },
  {
    key: "portals",
    title: "Portals",
    navGroup: "Έγγραφα & επικοινωνία",
    kind: "custom",
    description:
      "Πλαίσιο σύνδεσης με portals ακινήτων. Η λίστα δείχνει όσα υποστηρίζονται· ενεργοποιείτε μόνο όσα χρησιμοποιεί η HOME88.",
    storage: "portals · portal_publication_rules · provider_credentials",
    pendingNote: "Ο αυτόματος συγχρονισμός και οι κανόνες δημοσίευσης εφαρμόζονται στη Φάση 6.",
    fields: [],
  },
  {
    key: "areas",
    title: "Περιοχές",
    navGroup: "Λειτουργία CRM",
    kind: "custom",
    description: "Περιφέρειες, πόλεις, περιοχές και γειτονιές, με ελληνικό και αγγλικό όνομα και αντιστοίχιση στους κωδικούς των portals.",
    storage: "areas · area_external_mappings",
    pendingNote: "Η επιλογή περιοχής από τη λίστα στα ακίνητα και στις ζητήσεις έρχεται στη Φάση 4.",
    fields: [],
  },
  {
    key: "security",
    title: "Ασφάλεια",
    navGroup: "Ομάδες & ασφάλεια",
    kind: "form",
    description:
      "Συνεδρίες, κωδικοί και κλείδωμα λογαριασμών. Το ιστορικό ενεργειών είναι πάντα ενεργό. Κενό πεδίο σημαίνει την τρέχουσα προεπιλογή του συστήματος.",
    storage: "security_settings",
    fields: [
      { key: "sessionTimeoutHours", label: "Λήξη συνεδρίας (ώρες)", type: "int", min: 1, maxValue: 720, group: "Συνεδρίες", help: "Κενό: η τιμή του συστήματος (12 ώρες). Ισχύει για νέες συνδέσεις." },
      { key: "passwordMinLength", label: "Ελάχιστο μήκος κωδικού", type: "int", min: 12, maxValue: 128, group: "Κωδικοί", help: "Τουλάχιστον 12. Ισχύει σε κάθε νέο κωδικό." },
      { key: "maxLoginAttempts", label: "Αποτυχημένες προσπάθειες πριν το κλείδωμα", type: "int", min: 3, maxValue: 50, group: "Κλείδωμα", help: "Κενό: 8." },
      { key: "lockoutMinutes", label: "Διάρκεια κλειδώματος (λεπτά)", type: "int", min: 1, maxValue: 1440, group: "Κλείδωμα", help: "Κενό: 15." },
      {
        key: "mfaPolicy",
        label: "Έλεγχος δύο βημάτων (MFA)",
        type: "select",
        group: "MFA",
        options: [opt("OFF", "Ανενεργός"), opt("OPTIONAL", "Προαιρετικός"), opt("REQUIRED_ADMINS", "Υποχρεωτικός για διαχειριστές"), opt("REQUIRED_ALL", "Υποχρεωτικός για όλους")],
        appliesIn: "Φάση 7",
      },
    ],
  },
  {
    key: "privacy",
    title: "Απόρρητο",
    navGroup: "Ομάδες & ασφάλεια",
    kind: "form",
    description:
      "Επικοινωνία για θέματα προσωπικών δεδομένων, συγκαταθέσεις και χρόνοι διατήρησης. Οι χρόνοι διατήρησης δεν έχουν προεπιλογή: ορίζονται μετά από νομικό έλεγχο.",
    storage: "privacy_settings",
    fields: [
      { key: "privacyEmail", label: "Email για θέματα απορρήτου", type: "email", max: 160, group: "Επικοινωνία", help: "Εμφανίζεται στην Πολιτική απορρήτου και στο υποσέλιδο του site." },
      { key: "dmcaEmail", label: "Email για πνευματικά δικαιώματα", type: "email", max: 160, group: "Επικοινωνία" },
      { key: "analyticsEnabled", label: "Analytics με συγκατάθεση", type: "boolean", group: "Συγκαταθέσεις", default: false, appliesIn: "Φάση 7" },
      { key: "marketingDoubleOptIn", label: "Επιβεβαίωση εγγραφής σε ενημερώσεις (double opt-in)", type: "boolean", group: "Συγκαταθέσεις", default: false, appliesIn: "Φάση 6" },
      { key: "leadRetentionMonths", label: "Leads χωρίς συνεργασία (μήνες)", type: "int", min: 1, maxValue: 240, group: "Διατήρηση δεδομένων", appliesIn: "Φάση 7" },
      { key: "contactRetentionMonths", label: "Ανενεργές επαφές (μήνες)", type: "int", min: 1, maxValue: 240, group: "Διατήρηση δεδομένων", appliesIn: "Φάση 7" },
      { key: "emailLogRetentionMonths", label: "Αρχείο αποστολών (μήνες)", type: "int", min: 1, maxValue: 240, group: "Διατήρηση δεδομένων", appliesIn: "Φάση 7" },
      { key: "auditRetentionMonths", label: "Ιστορικό ενεργειών (μήνες)", type: "int", min: 1, maxValue: 240, group: "Διατήρηση δεδομένων", appliesIn: "Φάση 7" },
    ],
  },
  {
    key: "subscription",
    title: "Συνδρομή",
    navGroup: "Σύστημα",
    kind: "form",
    description: "Το πλάνο και η λήξη της συνδρομής. Η αντίστροφη μέτρηση υπολογίζεται από την ημερομηνία λήξης.",
    storage: "subscription_settings",
    fields: [
      { key: "plan", label: "Πλάνο", type: "text", max: 80, group: "Συνδρομή" },
      { key: "status", label: "Κατάσταση", type: "select", group: "Συνδρομή", options: SUBSCRIPTION_STATUSES },
      { key: "startsAt", label: "Έναρξη", type: "date", group: "Συνδρομή" },
      { key: "expiresAt", label: "Λήξη", type: "date", group: "Συνδρομή" },
      { key: "renewal", label: "Ανανέωση", type: "select", group: "Συνδρομή", options: [opt("AUTO", "Αυτόματη"), opt("MANUAL", "Χειροκίνητη")] },
    ],
  },
];

export const SETTINGS_SECTION_KEYS = SETTINGS_SECTIONS.map((s) => s.key);

export function settingsSection(key: string): SettingsSection | undefined {
  return SETTINGS_SECTIONS.find((s) => s.key === key);
}

export function secretFieldKeys(section: SettingsSection): string[] {
  return section.fields.filter((f) => f.type === "secret").map((f) => f.key);
}

/** Fields stored as plain columns (everything except secrets and read-only display fields). */
export function storedFields(section: SettingsSection): SettingsField[] {
  return section.fields.filter((f) => f.type !== "secret");
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

export type SettingsAction = "view" | "manage";

export function settingsPermission(section: SettingsSectionKey | "audit", action: SettingsAction): string {
  return `settings.${section}.${action}`;
}

export const SETTINGS_AUDIT_VIEW = settingsPermission("audit", "view");

export type PermissionDef = { code: string; label: string; group: string };

/** Who may do what with showings, mandates and their documents. Decided on the server, never by hiding a button. */
export const DOCUMENT_PERMISSIONS: readonly PermissionDef[] = [
  { code: "showings.create", label: "Υποδείξεις: δημιουργία πρόχειρης", group: "Έγγραφα & εντολές" },
  { code: "showings.read", label: "Υποδείξεις: προβολή", group: "Έγγραφα & εντολές" },
  { code: "showings.update_draft", label: "Υποδείξεις: επεξεργασία πρόχειρης", group: "Έγγραφα & εντολές" },
  { code: "showings.issue", label: "Υποδείξεις: έκδοση", group: "Έγγραφα & εντολές" },
  { code: "showings.send", label: "Υποδείξεις: αποστολή για υπογραφή", group: "Έγγραφα & εντολές" },
  { code: "showings.cancel", label: "Υποδείξεις: ακύρωση", group: "Έγγραφα & εντολές" },
  { code: "showings.replace", label: "Υποδείξεις: αντικατάσταση", group: "Έγγραφα & εντολές" },
  { code: "showings.download_pdf", label: "Υποδείξεις: λήψη PDF", group: "Έγγραφα & εντολές" },
  { code: "showings.view_sensitive_data", label: "Υποδείξεις: πλήρη στοιχεία ταυτότητας", group: "Έγγραφα & εντολές" },
  { code: "mandates.issue", label: "Εντολές: έκδοση", group: "Έγγραφα & εντολές" },
  { code: "mandates.send", label: "Εντολές: αποστολή για υπογραφή", group: "Έγγραφα & εντολές" },
  { code: "mandates.cancel", label: "Εντολές: ακύρωση", group: "Έγγραφα & εντολές" },
  { code: "mandates.replace", label: "Εντολές: αντικατάσταση", group: "Έγγραφα & εντολές" },
  { code: "mandates.extend", label: "Εντολές: παράταση", group: "Έγγραφα & εντολές" },
  { code: "mandates.download_pdf", label: "Εντολές: λήψη PDF", group: "Έγγραφα & εντολές" },
  { code: "mandates.override_conflict", label: "Εντολές: έγκριση σύγκρουσης αποκλειστικών", group: "Έγγραφα & εντολές" },
  { code: "mandates.view_sensitive_data", label: "Εντολές: πλήρη στοιχεία ταυτότητας", group: "Έγγραφα & εντολές" },
  { code: "templates.read", label: "Πρότυπα εγγράφων: προβολή", group: "Έγγραφα & εντολές" },
  { code: "templates.create_draft", label: "Πρότυπα εγγράφων: νέα πρόχειρη έκδοση", group: "Έγγραφα & εντολές" },
  { code: "templates.submit_for_legal_review", label: "Πρότυπα εγγράφων: υποβολή για νομικό έλεγχο", group: "Έγγραφα & εντολές" },
  { code: "templates.approve_legal_version", label: "Πρότυπα εγγράφων: νομική έγκριση (και ένδειξη «νομικός εγκρίνων» στον χρήστη)", group: "Έγγραφα & εντολές" },
  { code: "templates.activate", label: "Πρότυπα εγγράφων: ενεργοποίηση εγκεκριμένης έκδοσης", group: "Έγγραφα & εντολές" },
  { code: "contacts.export", label: "Επαφές: εξαγωγή CSV (χωρίς στοιχεία ταυτότητας)", group: "Επαφές" },
  { code: "contacts.export_sensitive", label: "Επαφές: εξαγωγή και με ευαίσθητα στοιχεία (ΑΦΜ, διεύθυνση)", group: "Επαφές" },
  { code: "contacts.bulk_assign", label: "Επαφές: μαζική ανάθεση σε διαχειριστή", group: "Επαφές" },
  { code: "contacts.bulk_update", label: "Επαφές: μαζική αλλαγή κατάστασης και συναινέσεων", group: "Επαφές" },
] as const;

export const SETTINGS_PERMISSIONS: readonly PermissionDef[] = [
  ...SETTINGS_SECTIONS.flatMap((s) => [
    { code: settingsPermission(s.key, "view"), label: `Προβολή: ${s.title}`, group: s.navGroup },
    { code: settingsPermission(s.key, "manage"), label: `Αλλαγή: ${s.title}`, group: s.navGroup },
  ]),
  { code: SETTINGS_AUDIT_VIEW, label: "Προβολή ιστορικού αλλαγών ρυθμίσεων", group: "Σύστημα" },
  ...DOCUMENT_PERMISSIONS,
];

/**
 * Held by SUPER_ADMIN only and never grantable: whoever can change permissions,
 * security policy or the subscription could otherwise raise their own access.
 */
export const RESERVED_PERMISSIONS: ReadonlySet<string> = new Set([
  settingsPermission("permissions", "manage"),
  settingsPermission("security", "manage"),
  settingsPermission("subscription", "manage"),
]);

const grant = (keys: SettingsSectionKey[], action: SettingsAction) => keys.map((k) => settingsPermission(k, action));

const ADMIN_MANAGE: SettingsSectionKey[] = [
  "company", "legal", "branding", "app", "properties", "contacts", "requests", "commissions",
  "calendar", "automation", "ai", "notifications", "mandates", "email", "sms", "portals", "areas", "privacy",
];

/**
 * Document permissions by role. Agents prepare drafts and download what they
 * may see; managers review, issue, send, cancel, replace and extend; template
 * drafting and activation sit with administrators. Legal approval of wording is
 * granted to no role by default: it also needs the user to be marked a legal
 * approver, which only a Super Admin can do.
 */
const AGENT_DOCUMENTS = [
  "showings.create", "showings.read", "showings.update_draft", "showings.download_pdf",
  "mandates.download_pdf", "templates.read",
  // An agent only ever sees their own records, and must read the identity data they are entering.
  "showings.view_sensitive_data", "mandates.view_sensitive_data",
];
const MANAGER_DOCUMENTS = [
  ...AGENT_DOCUMENTS,
  "showings.issue", "showings.send", "showings.cancel", "showings.replace",
  "mandates.issue", "mandates.send", "mandates.cancel", "mandates.replace", "mandates.extend",
  "mandates.override_conflict",
  "contacts.export", "contacts.bulk_assign", "contacts.bulk_update",
];
const ADMIN_DOCUMENTS = [...MANAGER_DOCUMENTS, "contacts.export_sensitive", "templates.create_draft", "templates.submit_for_legal_review", "templates.activate"];

/** Defaults per role; SUPER_ADMIN always holds every permission. Overrides live in role_permissions. */
export const DEFAULT_SETTINGS_GRANTS: Readonly<Record<string, readonly string[]>> = {
  ADMIN: [
    ...grant(ADMIN_MANAGE, "view"),
    ...grant(ADMIN_MANAGE, "manage"),
    ...grant(["permissions", "security", "subscription"], "view"),
    SETTINGS_AUDIT_VIEW,
    ...ADMIN_DOCUMENTS,
  ],
  MANAGER: [
    ...grant(["company", "branding", "app", "properties", "contacts", "requests", "calendar", "automation", "notifications", "areas"], "view"),
    ...grant(["requests", "calendar", "areas"], "manage"),
    ...MANAGER_DOCUMENTS,
  ],
  MARKETING: grant(["company", "branding"], "view"),
  AGENT: AGENT_DOCUMENTS,
  VIEWER: [],
};

/** Which sections an administrator needs filled before the public site can show them. */
export const PUBLIC_COMPANY_FIELDS: ReadonlyArray<{ section: SettingsSectionKey; key: string }> = [
  { section: "company", key: "officeName" },
  { section: "company", key: "email" },
  { section: "company", key: "phone1" },
  { section: "company", key: "addressEl" },
  { section: "company", key: "hoursEl" },
  { section: "privacy", key: "privacyEmail" },
];

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const NOTIFICATION_CHANNELS = [opt("CRM", "Μέσα στο CRM"), opt("EMAIL", "Email"), opt("SMS", "SMS")] as const;

export const NOTIFICATION_EVENTS = [
  opt("LEAD_NEW", "Νέο lead"),
  opt("REQUEST_NEW", "Νέα ζήτηση"),
  opt("PROPERTY_NEW", "Νέο ακίνητο"),
  opt("MATCH_NEW", "Ακίνητο που ταιριάζει σε ζήτηση"),
  opt("VIEWING", "Υπόδειξη / ραντεβού"),
  opt("REMINDER", "Υπενθύμιση"),
  opt("MANDATE_SENT", "Εντολή στάλθηκε"),
  opt("MANDATE_VIEWED", "Εντολή ανοίχτηκε"),
  opt("MANDATE_SIGNED", "Εντολή υπογράφηκε"),
  opt("MANDATE_EXPIRED", "Εντολή έληξε"),
  opt("OFFER", "Προσφορά"),
  opt("TRANSACTION", "Συναλλαγή"),
  opt("TASK_DUE", "Εργασία προς λήξη"),
  opt("PORTAL_FAILED", "Αποτυχία δημοσίευσης σε portal"),
] as const;

/** In-CRM notices are on by default; email and SMS stay off until switched on. */
export function defaultNotificationEnabled(channel: string): boolean {
  return channel === "CRM";
}

// ---------------------------------------------------------------------------
// Property tags (replacing the free-text Estate+ categories)
// ---------------------------------------------------------------------------

export const TAG_COLORS = [
  opt("blue", "Μπλε"),
  opt("green", "Πράσινο"),
  opt("amber", "Πορτοκαλί"),
  opt("red", "Κόκκινο"),
  opt("violet", "Μωβ"),
  opt("slate", "Γκρι"),
] as const;

/** Stable codes with Greek labels; the seed migration inserts these as system tags. */
export const SYSTEM_PROPERTY_TAGS: ReadonlyArray<{ code: string; labelEl: string; labelEn: string; color: string; legacy: string[] }> = [
  { code: "DO_NOT_CALL", labelEl: "Δεν καλούμε", labelEn: "Do not call", color: "red", legacy: ["Δεν καλούμε"] },
  { code: "OWNER_CONTACT", labelEl: "Να καλέσουμε τον ιδιοκτήτη", labelEn: "Call the owner", color: "amber", legacy: [] },
  { code: "CONTACTED", labelEl: "Πήραμε τηλ. και είναι διαθέσιμο", labelEn: "Contacted — available", color: "green", legacy: ["Πήραμε τηλ. και είναι διαθέσιμο"] },
  { code: "NO_ANSWER", labelEl: "Πήραμε δεν απάντησε", labelEn: "No answer", color: "amber", legacy: ["Πήραμε δεν απάντησε"] },
  { code: "WRONG_PHONE", labelEl: "Έχει λάθος τηλ", labelEn: "Wrong phone", color: "red", legacy: ["Έχει λάθος τηλ"] },
  { code: "DO_NOT_PUBLISH", labelEl: "Να μην δημοσιευθεί πουθενά", labelEn: "Do not publish", color: "red", legacy: ["Να μην δημοσιευθεί πουθενά"] },
  { code: "EXCLUSIVE", labelEl: "Αποκλειστική Ανάθεση", labelEn: "Exclusive mandate", color: "violet", legacy: ["Αποκλειστική Ανάθεση"] },
  { code: "WEBSITE_ONLY", labelEl: "Μόνο site μας", labelEn: "Website only", color: "blue", legacy: ["Μόνο site μας"] },
  { code: "PORTAL_ONLY", labelEl: "Μόνο σε portals", labelEn: "Portals only", color: "blue", legacy: [] },
  { code: "COOPERATION", labelEl: "Συνεργασία", labelEn: "Co-broker", color: "slate", legacy: ["Συνεργασία"] },
  { code: "DEVELOPER", labelEl: "Κατασκευαστής", labelEn: "Developer", color: "slate", legacy: ["Κατασκευαστής"] },
  { code: "ANTIPAROCHI", labelEl: "Αντιπαροχή / Δίνεται και Αντιπαροχή", labelEn: "Land-for-flats exchange", color: "slate", legacy: ["Αντιπαροχή / Δίνεται και Αντιπαροχή"] },
  { code: "REVIEW_NOTES", labelEl: "Να κοιτάξουμε σημειώσεις!!", labelEn: "Review notes", color: "amber", legacy: ["Να κοιτάξουμε σημειώσεις!!"] },
  { code: "SITE", labelEl: "Site", labelEn: "Site", color: "blue", legacy: ["Site"] },
  { code: "PHONE_EFTHYMIS", labelEl: "Τηλ Ευθύμης", labelEn: "Efthymis phone", color: "slate", legacy: ["Τηλ Ευθύμης"] },
  { code: "GOLDEN_DEAL", labelEl: "Χρυσή Ευκαιρία", labelEn: "Golden opportunity", color: "amber", legacy: ["Χρυσή Ευκαιρία"] },
];

// ---------------------------------------------------------------------------
// Areas
// ---------------------------------------------------------------------------

export const AREA_LEVELS = [
  opt("REGION", "Περιφέρεια / Νομός"),
  opt("CITY", "Πόλη / Δήμος"),
  opt("AREA", "Περιοχή"),
  opt("NEIGHBORHOOD", "Γειτονιά"),
] as const;

export type AreaLevel = "REGION" | "CITY" | "AREA" | "NEIGHBORHOOD";

/** The level a child must have, given its parent's. REGION has no parent. */
export function childLevel(parent: AreaLevel | null): AreaLevel | null {
  if (parent === null) return "REGION";
  if (parent === "REGION") return "CITY";
  if (parent === "CITY") return "AREA";
  if (parent === "AREA") return "NEIGHBORHOOD";
  return null;
}

/** Greek → Latin for URL slugs (ELOT 743, simplified). */
export function slugify(text: string): string {
  const map: Record<string, string> = {
    α: "a", β: "v", γ: "g", δ: "d", ε: "e", ζ: "z", η: "i", θ: "th", ι: "i", κ: "k", λ: "l", μ: "m",
    ν: "n", ξ: "x", ο: "o", π: "p", ρ: "r", σ: "s", ς: "s", τ: "t", υ: "y", φ: "f", χ: "ch", ψ: "ps", ω: "o",
  };
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split("")
    .map((c) => map[c] ?? c)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// ---------------------------------------------------------------------------
// Portals
// ---------------------------------------------------------------------------

export type PortalField = {
  key: string;
  label: string;
  type: "text" | "email" | "tel" | "url" | "select" | "secret";
  options?: readonly SettingsOption[];
  help?: string;
};

export type PortalCatalogEntry = {
  code: string;
  name: string;
  transport: "API" | "XML_FEED" | "CSV_FEED" | "JSON_FEED" | "MANUAL";
  fields: readonly PortalField[];
  /** Setup guide published by the portal or the previous provider. */
  guideUrl?: string;
  note?: string;
};

/**
 * Portals the framework supports. Listing one here says nothing about whether
 * HOME88 has an account with it: every portal starts disabled and unconfigured.
 */
export const PORTAL_CATALOG: readonly PortalCatalogEntry[] = [
  {
    code: "SPITOGATOS",
    name: "Spitogatos",
    transport: "XML_FEED",
    fields: [
      { key: "brokerId", label: "Broker ID", type: "text" },
      { key: "username", label: "Όνομα χρήστη", type: "text" },
      { key: "appKey", label: "App key", type: "secret" },
      { key: "password", label: "Κωδικός", type: "secret" },
    ],
  },
  {
    code: "XE_GR",
    name: "Χρυσή Ευκαιρία",
    transport: "CSV_FEED",
    fields: [
      { key: "accountId", label: "Account ID", type: "text" },
      { key: "profileId", label: "Profile ID", type: "text" },
      { key: "officeEmail", label: "Email γραφείου", type: "email" },
      { key: "officePhone", label: "Τηλέφωνο γραφείου", type: "tel" },
      { key: "officePhone2", label: "2ο τηλέφωνο γραφείου", type: "tel" },
      { key: "antiparochiAs", label: "Ακίνητα αντιπαροχής ως", type: "select", options: [opt("ANTIPAROCHI", "Αντιπαροχή"), opt("SALE", "Πώληση")] },
    ],
  },
  {
    code: "JAMESEDITION",
    name: "JamesEdition",
    transport: "XML_FEED",
    fields: [
      { key: "officeName", label: "Όνομα γραφείου", type: "text" },
      { key: "agentFirstName", label: "Όνομα συνεργάτη", type: "text" },
      { key: "agentLastName", label: "Επώνυμο συνεργάτη", type: "text" },
      { key: "city", label: "Πόλη", type: "text" },
      { key: "address", label: "Διεύθυνση", type: "text" },
      { key: "postalCode", label: "Τ.Κ.", type: "text" },
      { key: "phone", label: "Τηλέφωνο", type: "tel" },
      { key: "jamesEditionId", label: "Αναγνωριστικό JamesEdition", type: "text", help: "Αφήστε κενό αν δεν διαθέτετε." },
    ],
  },
  {
    code: "PLOT_GR",
    name: "Plot.gr",
    transport: "API",
    fields: [
      { key: "email", label: "Email", type: "email" },
      { key: "password", label: "Κωδικός", type: "secret" },
    ],
  },
  { code: "SPOURGITI", name: "Spourgiti", transport: "XML_FEED", fields: [{ key: "brokerId", label: "Broker ID", type: "text" }] },
  { code: "E_AKINITA", name: "E-akinita", transport: "API", fields: [{ key: "key", label: "Key", type: "secret" }] },
  { code: "PROPERSTAR", name: "ProperStar", transport: "XML_FEED", fields: [] },
  { code: "GREEN_ACRES", name: "Green Acres", transport: "XML_FEED", fields: [] },
  { code: "SPITOULIS", name: "Spitoulis", transport: "XML_FEED", fields: [] },
  { code: "MYHOMI", name: "MyHomi", transport: "XML_FEED", fields: [] },
  { code: "DOMARES", name: "Domares", transport: "XML_FEED", fields: [] },
  { code: "SPITI360", name: "Spiti360.gr", transport: "XML_FEED", fields: [], note: "Στέλνετε στο portal το URL της ροής XML." },
  { code: "POLEON", name: "Poleon.gr", transport: "JSON_FEED", fields: [], note: "Εισάγετε το URL της ροής JSON στον λογαριασμό σας στο portal." },
  { code: "CUSTOM_XML", name: "Άλλη ροή XML", transport: "XML_FEED", fields: [{ key: "label", label: "Περιγραφή", type: "text" }] },
  { code: "CUSTOM_JSON", name: "Άλλη ροή JSON", transport: "JSON_FEED", fields: [{ key: "label", label: "Περιγραφή", type: "text" }] },
];

export function portalCatalogEntry(code: string): PortalCatalogEntry | undefined {
  return PORTAL_CATALOG.find((p) => p.code === code.toUpperCase());
}

export type ProviderVerification = {
  /** Nothing is "VERIFIED" until someone has checked the provider's current contract and tested against it. */
  status: "PROVIDER_CONFIRMATION_REQUIRED" | "VERIFIED";
  note: string;
};

const CONFIRMATION_DEFAULT =
  "Δεν έχει επιβεβαιωθεί η τρέχουσα τεκμηρίωση και η πρόσβαση του παρόχου. Επιβεβαιώστε με το portal πριν την ενεργοποίηση.";

/**
 * What has actually been checked against each provider. Adding an entry here
 * with status VERIFIED is a claim that the current documentation was read and a
 * test publication was accepted; leave it out until that is true.
 */
export const PORTAL_VERIFICATION_NOTES: Record<string, string> = {
  JAMESEDITION:
    "Η JamesEdition δημοσιεύει προδιαγραφή XML ροής (feed guidelines) και διαβάζει τη ροή περίπου τρεις φορές την ημέρα· η προδιαγραφή δεν ήταν προσβάσιμη κατά την ανάπτυξη, οπότε δεν υπάρχει ακόμη προσαρμογέας. Οι αλλαγές δεν είναι άμεσες.",
  GREEN_ACRES:
    "Δεν βρέθηκε δημόσια προδιαγραφή. Οι σημειώσεις ενσωμάτωσης αναφέρουν XML μέσω FTP ή HTTP και μοντέλο «cancel and replace» (ό,τι λείπει από τη ροή αφαιρείται)· ζητήστε την τρέχουσα προδιαγραφή από την Green Acres.",
  PLOT_GR:
    "Οι σημειώσεις ενσωμάτωσης αναφέρουν ότι το API v1 έχει λήξει (Απρίλιος 2026)· χρησιμοποιήστε μόνο την τρέχουσα έκδοση, αφού επιβεβαιωθεί από την τεκμηρίωση του παρόχου.",
};

export function portalVerification(code: string): ProviderVerification {
  return { status: "PROVIDER_CONFIRMATION_REQUIRED", note: PORTAL_VERIFICATION_NOTES[code.toUpperCase()] ?? CONFIRMATION_DEFAULT };
}

export const PORTAL_STATUS_LABELS: Record<string, string> = {
  PLANNED: "Σε προγραμματισμό",
  NOT_CONFIGURED: "Δεν έχει ρυθμιστεί",
  CONFIGURED: "Ρυθμίστηκε",
  CONNECTED: "Συνδεδεμένο",
  ERROR: "Σφάλμα",
  DISABLED: "Ανενεργό",
};

export const PUBLICATION_RULE_MODES = [
  opt("ALL_WEBSITE", "Όλα τα ακίνητα του ιστότοπου"),
  opt("NONE", "Κανένα"),
  opt("BY_TYPE", "Ανά τύπο ακινήτου"),
  opt("BY_TAG", "Ανά ετικέτα"),
] as const;

/**
 * Status shown for a portal or provider, derived from stored facts only. An
 * error newer than the last success wins; nothing is "connected" until a sync
 * has actually succeeded.
 */
export function portalStatus(input: {
  configured: boolean;
  enabled: boolean;
  lastSuccessAt?: Date | string | null;
  lastErrorAt?: Date | string | null;
}): "NOT_CONFIGURED" | "CONFIGURED" | "CONNECTED" | "ERROR" | "DISABLED" {
  if (!input.configured) return "NOT_CONFIGURED";
  if (!input.enabled) return "DISABLED";
  const ok = input.lastSuccessAt ? new Date(input.lastSuccessAt).getTime() : 0;
  const err = input.lastErrorAt ? new Date(input.lastErrorAt).getTime() : 0;
  if (err > ok) return "ERROR";
  if (ok > 0) return "CONNECTED";
  return "CONFIGURED";
}

// ---------------------------------------------------------------------------
// Subscription
// ---------------------------------------------------------------------------

export type Countdown = { expired: boolean; days: number; hours: number; minutes: number };

/** Time left until `expiresAt` (end of that day when a date-only value is given). */
export function subscriptionCountdown(expiresAt: string | Date | null | undefined, now: Date = new Date()): Countdown | null {
  if (!expiresAt) return null;
  const dateOnly = typeof expiresAt === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiresAt) : null;
  // A date-only expiry runs to the end of that day in Athens, wherever the code runs.
  const end = dateOnly
    ? new Date(zonedTime(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]) + 1, 0, 0).getTime() - 1000)
    : new Date(expiresAt);
  if (Number.isNaN(end.getTime())) return null;
  const ms = end.getTime() - now.getTime();
  if (ms <= 0) return { expired: true, days: 0, hours: 0, minutes: 0 };
  const minutes = Math.floor(ms / 60000);
  return { expired: false, days: Math.floor(minutes / 1440), hours: Math.floor((minutes % 1440) / 60), minutes: minutes % 60 };
}
