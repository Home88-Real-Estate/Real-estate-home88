/**
 * The portal directory: every destination HOME88 knows about or is
 * investigating, and an honest implementation status for each.
 *
 * A directory entry is NOT an integration. `catalogCode` links an entry to the
 * working portal framework (PORTAL_CATALOG, accounts, adapters); entries without
 * one are research candidates. Facts here come from the product brief and are
 * marked unverified until someone confirms them with the portal; nothing in this
 * file claims an API, a feed specification or Greek-property eligibility that has
 * not been confirmed, and nothing is "connected" without a real successful sync.
 */

export const DISTRIBUTION_STATUSES = ["CATALOG_ONLY", "NEEDS_SPECIFICATION", "AWAITING_ACCOUNT", "READY_FOR_TEST", "CONNECTED", "SYNC_ERROR", "PAUSED", "UNSUPPORTED"] as const;
export type DistributionStatus = (typeof DISTRIBUTION_STATUSES)[number];

export const DISTRIBUTION_STATUS_LABELS: Record<DistributionStatus, string> = {
  CATALOG_ONLY: "Στον κατάλογο",
  NEEDS_SPECIFICATION: "Απαιτούνται προδιαγραφές",
  AWAITING_ACCOUNT: "Αναμένεται λογαριασμός ή σύμβαση",
  READY_FOR_TEST: "Έτοιμο για δοκιμή",
  CONNECTED: "Συνδεδεμένο",
  SYNC_ERROR: "Σφάλμα συγχρονισμού",
  PAUSED: "Σε παύση",
  UNSUPPORTED: "Δεν υποστηρίζεται",
};

export type DistributionMarket = "GR" | "DISTRIBUTION" | "EUROPE" | "MIDDLE_EAST" | "ASIA_PACIFIC" | "AMERICAS" | "AGGREGATOR";
export const DISTRIBUTION_MARKET_LABELS: Record<DistributionMarket, string> = {
  GR: "Ελλάδα",
  DISTRIBUTION: "Διεθνής διανομή",
  EUROPE: "Ευρώπη",
  MIDDLE_EAST: "Μέση Ανατολή",
  ASIA_PACIFIC: "Ασία και Ωκεανία",
  AMERICAS: "Αμερική",
  AGGREGATOR: "Aggregators",
};

export type DeliveryMethod = "API" | "XML_FEED" | "CSV_FEED" | "JSON_FEED" | "PARTNER" | "MANUAL" | "UNKNOWN";
export const DELIVERY_METHOD_LABELS: Record<DeliveryMethod, string> = {
  API: "API",
  XML_FEED: "XML feed",
  CSV_FEED: "CSV feed",
  JSON_FEED: "JSON feed",
  PARTNER: "Μέσω συνεργάτη διανομής",
  MANUAL: "Χειροκίνητα",
  UNKNOWN: "Άγνωστη",
};

export type DirectoryPriority = "A" | "B" | "C" | "INTL_1" | "INTL_2" | "RESEARCH";
export const DIRECTORY_PRIORITY_LABELS: Record<DirectoryPriority, string> = {
  A: "Ελλάδα · προτεραιότητα Α",
  B: "Ελλάδα · προτεραιότητα Β",
  C: "Ελλάδα · προτεραιότητα Γ",
  INTL_1: "Διεθνώς · προτεραιότητα 1",
  INTL_2: "Διεθνώς · προτεραιότητα 2",
  RESEARCH: "Προς διερεύνηση",
};

export type DirectoryEntry = {
  /** Stable directory key. */
  key: string;
  name: string;
  /** ISO country code of the portal's own market, or "INT" for international networks. */
  country: string;
  market: DistributionMarket;
  /** Ownership or syndication group, where known. */
  group?: string;
  priority: DirectoryPriority;
  delivery: DeliveryMethod;
  /** DOCUMENTED = a public specification is known to exist (still not validated by the portal). */
  specification: "DOCUMENTED" | "UNVERIFIED";
  /**
   * How a delivery changes the portal's inventory. FULL_SNAPSHOT: what is absent from the
   * feed may be removed, so an empty or short feed is dangerous. INCREMENTAL: one listing at
   * a time. UNKNOWN until the portal's documentation says otherwise.
   */
  publication: "INCREMENTAL" | "FULL_SNAPSHOT" | "UNKNOWN";
  /** Whether the portal is known to accept listings located in Greece. */
  greece: "YES" | "UNKNOWN";
  /** Link into the working framework (PORTAL_CATALOG code). Absent for research candidates. */
  catalogCode?: string;
  note?: string;
  /** Warnings that must hold before sending anything (e.g. destructive full feeds). */
  caution?: string;
};

type Seed = Omit<DirectoryEntry, "key" | "specification" | "greece" | "delivery" | "publication"> & Partial<Pick<DirectoryEntry, "specification" | "greece" | "delivery" | "publication">>;

const gr = (key: string, s: Seed): DirectoryEntry => ({ key, catalogCode: key, specification: "UNVERIFIED", greece: "YES", delivery: "UNKNOWN", publication: "UNKNOWN", ...s });
const intl = (key: string, s: Seed): DirectoryEntry => ({ key, catalogCode: key, specification: "UNVERIFIED", greece: "UNKNOWN", delivery: "UNKNOWN", publication: "UNKNOWN", ...s });

const INDOMIO = "Indomio Group";

export const PORTAL_DIRECTORY: readonly DirectoryEntry[] = [
  // Greece — priority A
  gr("SPITOGATOS", { name: "Spitogatos", country: "GR", market: "GR", group: INDOMIO, priority: "A", delivery: "XML_FEED", catalogCode: "SPITOGATOS" }),
  gr("XE_GR", {
    name: "XE.gr (Χρυσή Ευκαιρία)", country: "GR", market: "GR", priority: "A", delivery: "API", publication: "INCREMENTAL", specification: "DOCUMENTED", catalogCode: "XE_GR",
    note: "Το XE δηλώνει Real Estate API (JWT, δημιουργία, ενημέρωση και διαγραφή ανά αγγελία) με sandbox και πιστοποίηση πριν την παραγωγή. Το υπάρχον adapter του HOME88 χρησιμοποιεί CSV feed· το API δεν έχει υλοποιηθεί ακόμη και απαιτεί εγγραφή CRM και credentials από το XE.",
  }),
  gr("INDOMIO_GR", { name: "Indomio.gr", country: "GR", market: "GR", group: INDOMIO, priority: "A", note: "Να διερευνηθεί αν μία εμπορική σύνδεση καλύπτει όλα τα brands του ομίλου." }),
  gr("SPITI24", { name: "Spiti24", country: "GR", market: "GR", group: INDOMIO, priority: "A" }),
  gr("TOSPITIMOU", { name: "Tospitimou", country: "GR", market: "GR", group: INDOMIO, priority: "A" }),
  gr("PLOT_GR", { name: "Plot.gr", country: "GR", market: "GR", priority: "A", delivery: "API", catalogCode: "PLOT_GR" }),
  // Greece — priority B
  gr("SPITIONLINE", { name: "SpitiOnline.gr", country: "GR", market: "GR", priority: "B" }),
  gr("SPITOULIS", { name: "Spitoulis.gr", country: "GR", market: "GR", priority: "B", delivery: "XML_FEED", catalogCode: "SPITOULIS", note: "Δηλώνει ενσωμάτωση CRM μέσω API και εναλλακτικά feed· να επιβεβαιωθεί." }),
  gr("SPITI360", { name: "Spiti360.gr", country: "GR", market: "GR", priority: "B", delivery: "XML_FEED", catalogCode: "SPITI360" }),
  gr("SPOURGITI", { name: "Spourgiti.com", country: "GR", market: "GR", priority: "B", delivery: "XML_FEED", catalogCode: "SPOURGITI" }),
  gr("E_AKINITA", { name: "E-akinita.gr", country: "GR", market: "GR", priority: "B", delivery: "API", catalogCode: "E_AKINITA" }),
  gr("POLEON", { name: "Poleon.gr", country: "GR", market: "GR", priority: "B", delivery: "JSON_FEED", catalogCode: "POLEON" }),
  // Greece — priority C (operating status and bulk-listing support to be verified)
  gr("IREALESTATE", { name: "IRealEstate.gr", country: "GR", market: "GR", priority: "C" }),
  gr("SPITI_COM", { name: "Spiti.com", country: "GR", market: "GR", priority: "C" }),
  gr("OPENHOUSE", { name: "Openhouse.gr", country: "GR", market: "GR", priority: "C" }),
  gr("NEST", { name: "Nest.com.gr", country: "GR", market: "GR", priority: "C" }),
  gr("OIKOTECK", { name: "Oikoteck.com", country: "GR", market: "GR", priority: "C" }),
  gr("DOMARES", { name: "Domares", country: "GR", market: "GR", priority: "C", delivery: "XML_FEED", catalogCode: "DOMARES" }),
  gr("MYHOMI", { name: "MyHomi.gr", country: "GR", market: "GR", priority: "C", delivery: "XML_FEED", catalogCode: "MYHOMI" }),
  gr("NEOAKINITO", { name: "Neoakinito.gr", country: "GR", market: "GR", priority: "C" }),
  // International distribution
  intl("PROPERSTAR", { name: "Properstar / ListGlobally", country: "INT", market: "DISTRIBUTION", priority: "INTL_1", delivery: "PARTNER", catalogCode: "PROPERSTAR", note: "Δίκτυο διανομής· να ζητηθεί γραπτά ποιες πύλες και χώρες καλύπτονται για γραφείο στην Ελλάδα." }),
  intl("GLOBAL_PROPERTY_NETWORK", { name: "Global Property Network", country: "INT", market: "DISTRIBUTION", priority: "INTL_1", delivery: "PARTNER", note: "Συνεργασία προς διερεύνηση· δεν υπάρχει σύνδεση." }),
  intl("GREEN_ACRES", {
    name: "Green-Acres", country: "FR", market: "DISTRIBUTION", priority: "INTL_1", delivery: "XML_FEED", publication: "FULL_SNAPSHOT", specification: "DOCUMENTED", greece: "UNKNOWN", catalogCode: "GREEN_ACRES",
    caution: "Cancel-and-replace: ακίνητα που λείπουν από το feed αποσύρονται. Απαιτείται προστασία από κενό ή μειωμένο feed.",
  }),
  intl("KYERO", { name: "Kyero", country: "ES", market: "DISTRIBUTION", priority: "INTL_1", delivery: "XML_FEED", publication: "FULL_SNAPSHOT", specification: "DOCUMENTED", note: "Δημοσιευμένη προδιαγραφή XML (με XSD). Πλήρες feed ανά διαφημιστή και σταθερά αναγνωριστικά.", caution: "Ακίνητα που λείπουν από το feed μπορεί να αφαιρεθούν." }),
  intl("JAMESEDITION", { name: "JamesEdition", country: "INT", market: "DISTRIBUTION", priority: "INTL_1", delivery: "XML_FEED", publication: "FULL_SNAPSHOT", specification: "DOCUMENTED", catalogCode: "JAMESEDITION", note: "Δημοσιευμένη προδιαγραφή XML· τα ακίνητα συμφωνούνται με το feed· απαιτούνται σταθερά URL φωτογραφιών." }),
  intl("EUROPEAN_REALESTATE", { name: "European.realestate", country: "INT", market: "DISTRIBUTION", priority: "INTL_1" }),
  intl("LUXURYESTATE", { name: "LuxuryEstate", country: "IT", market: "DISTRIBUTION", priority: "INTL_1" }),
  intl("THEMOVECHANNEL", { name: "TheMoveChannel", country: "INT", market: "DISTRIBUTION", priority: "INTL_2" }),
  intl("APLACEINTHESUN", { name: "A Place in the Sun", country: "GB", market: "DISTRIBUTION", priority: "INTL_2" }),
  intl("TRANIO", { name: "Tranio", country: "INT", market: "DISTRIBUTION", priority: "INTL_2" }),
  // Europe — eligibility for Greek listings and feed terms are unconfirmed
  ...[
    ["RIGHTMOVE", "Rightmove", "GB"], ["ZOOPLA", "Zoopla", "GB"], ["PRIMELOCATION", "PrimeLocation", "GB"],
    ["IDEALISTA", "Idealista", "ES"], ["FOTOCASA", "Fotocasa", "ES"], ["PISOS_COM", "Pisos.com", "ES"],
    ["IMMOBILIARE_IT", "Immobiliare.it", "IT"], ["SELOGER", "SeLoger", "FR"], ["BIENICI", "Bien'ici", "FR"],
    ["IMMOSCOUT24", "ImmobilienScout24", "DE"], ["IMMOWELT", "Immowelt", "DE"], ["IMOVIRTUAL", "Imovirtual", "PT"],
    ["FUNDA", "Funda", "NL"], ["IMMOWEB", "Immoweb", "BE"], ["WILLHABEN", "Willhaben", "AT"], ["HOMEGATE", "Homegate", "CH"],
    ["FINN_NO", "Finn.no", "NO"], ["HEMNET", "Hemnet", "SE"],
  ].map(([k, n, c]) => intl(k!, { name: n!, country: c!, market: "EUROPE", priority: "INTL_2", note: "Εθνικό portal· η αποδοχή αγγελιών για ακίνητα στην Ελλάδα και ο τρόπος παράδοσης δεν έχουν επιβεβαιωθεί." })),
  // Middle East, Asia-Pacific, Americas
  ...[
    ["PROPERTY_FINDER", "Property Finder", "AE", "MIDDLE_EAST"], ["BAYUT", "Bayut", "AE", "MIDDLE_EAST"], ["DUBIZZLE", "Dubizzle", "AE", "MIDDLE_EAST"],
    ["JUWAI_IQI", "Juwai IQI", "CN", "ASIA_PACIFIC"], ["NINETYNINE_ACRES", "99acres", "IN", "ASIA_PACIFIC"], ["MAGICBRICKS", "Magicbricks", "IN", "ASIA_PACIFIC"],
    ["HOUSING_COM", "Housing.com", "IN", "ASIA_PACIFIC"], ["PROPERTYGURU", "PropertyGuru", "SG", "ASIA_PACIFIC"], ["REALESTATE_AU", "realestate.com.au", "AU", "ASIA_PACIFIC"],
    ["DOMAIN_AU", "Domain", "AU", "ASIA_PACIFIC"], ["REALESTATE_NZ", "realestate.co.nz", "NZ", "ASIA_PACIFIC"],
    ["REALTOR_COM", "Realtor.com", "US", "AMERICAS"], ["ZILLOW", "Zillow", "US", "AMERICAS"], ["HOMES_COM", "Homes.com", "US", "AMERICAS"], ["REALTOR_CA", "Realtor.ca", "CA", "AMERICAS"],
  ].map(([k, n, c, m]) => intl(k!, { name: n!, country: c!, market: m as DistributionMarket, priority: "RESEARCH", note: "Υποψήφιο· συχνά απαιτεί τοπικό λογαριασμό μεσίτη ή πρόγραμμα διεθνών αγγελιών." })),
  // Aggregators
  ...[["TROVIT", "Trovit"], ["MITULA", "Mitula"], ["NESTORIA", "Nestoria"], ["NUROA", "Nuroa"]].map(([k, n]) => intl(k!, { name: n!, country: "INT", market: "AGGREGATOR", priority: "RESEARCH", note: "Aggregator· να επιβεβαιωθεί η εμπορική πρόσβαση και το feed." })),
];

/** What the live system knows about one portal's connection. */
export type LiveConnection = {
  hasAdapter: boolean;
  /** Existing integration status from Settings → Portals. */
  status: "PLANNED" | "NOT_CONFIGURED" | "CONFIGURED" | "CONNECTED" | "ERROR" | "DISABLED";
};

/**
 * One honest status. A research candidate never exceeds CATALOG_ONLY /
 * NEEDS_SPECIFICATION; CONNECTED comes only from a framework status that is
 * itself derived from a successful synchronisation.
 */
export function distributionStatus(entry: DirectoryEntry, live: LiveConnection | null): DistributionStatus {
  if (!entry.catalogCode || !live || !live.hasAdapter) return entry.specification === "DOCUMENTED" ? "CATALOG_ONLY" : "NEEDS_SPECIFICATION";
  switch (live.status) {
    case "CONNECTED": return "CONNECTED";
    case "ERROR": return "SYNC_ERROR";
    case "DISABLED": return "PAUSED";
    case "CONFIGURED": return "READY_FOR_TEST";
    default: return "AWAITING_ACCOUNT";
  }
}

export const PUBLICATION_MODE_LABELS: Record<DirectoryEntry["publication"], string> = {
  INCREMENTAL: "ανά αγγελία",
  FULL_SNAPSHOT: "πλήρες feed (ό,τι λείπει μπορεί να αφαιρεθεί)",
  UNKNOWN: "άγνωστος τρόπος ενημέρωσης",
};

export type DirectoryFilter = {
  q?: string;
  country?: string;
  market?: string;
  method?: string;
  status?: string;
  priority?: string;
  group?: string;
};

export type DirectoryRow = DirectoryEntry & { status: DistributionStatus; live: { lastSuccessAt: string | null; lastError: string | null; enabled: boolean; /** Account details have been recorded (they wait for the integration when none exists). */ configured: boolean } | null };

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export function filterDirectory(rows: readonly DirectoryRow[], f: DirectoryFilter): DirectoryRow[] {
  const q = f.q ? norm(f.q.trim()) : "";
  return rows.filter(
    (r) =>
      (!q || norm(`${r.name} ${r.key} ${r.group ?? ""}`).includes(q)) &&
      (!f.country || r.country === f.country) &&
      (!f.market || r.market === f.market) &&
      (!f.method || r.delivery === f.method) &&
      (!f.status || r.status === f.status) &&
      (!f.priority || r.priority === f.priority) &&
      (!f.group || r.group === f.group),
  );
}

export function countByStatus(rows: readonly DirectoryRow[]): Record<DistributionStatus, number> {
  const out = Object.fromEntries(DISTRIBUTION_STATUSES.map((s) => [s, 0])) as Record<DistributionStatus, number>;
  for (const r of rows) out[r.status] += 1;
  return out;
}
