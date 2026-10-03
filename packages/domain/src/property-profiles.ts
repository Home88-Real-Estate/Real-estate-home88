/**
 * What a property of each type consists of.
 *
 * One definition drives the CRM form (which fields, labels, units, options),
 * server-side validation (what is required, what is stored, what is ignored)
 * and, later, the public listing and search filters, so "an apartment" or "a
 * plot" is defined in exactly one place.
 *
 * Two kinds of field:
 *  - CORE fields are columns on `properties` (area, bedrooms, floor, ...);
 *    shared, indexed and used by search.
 *  - DETAIL fields are type- or listing-specific attributes (building
 *    coefficient, rooms/beds, loading docks, deposit, ...) stored in the
 *    `details` JSON column and validated here, so new attributes need no
 *    schema change.
 *
 * Required fields are enforced only once a property leaves DRAFT: a draft can
 * be saved incomplete and finished later.
 */

export type PropertyType =
  | "APARTMENT" | "MAISONETTE" | "HOUSE" | "VILLA" | "STUDIO"
  | "OFFICE" | "SHOP" | "WAREHOUSE" | "BUILDING" | "HOTEL" | "INDUSTRIAL"
  | "LAND" | "PLOT" | "PARKING" | "OTHER";

import type { ListingType } from "./property-lifecycle";
export type PropertyCondition = "NEW_BUILD" | "RENOVATED" | "GOOD" | "NEEDS_RENOVATION" | "UNDER_CONSTRUCTION";

export type FieldKind = "int" | "decimal" | "bool" | "select" | "text" | "date";

export type FieldDef = {
  key: string;
  label: string;
  kind: FieldKind;
  unit?: string;
  options?: ReadonlyArray<readonly [string, string]>;
  min?: number;
  max?: number;
  hint?: string;
};

// --- Core fields (columns) --------------------------------------------------

export const HEATING_OPTIONS = [
  ["INDIVIDUAL", "Αυτόνομη"],
  ["CENTRAL", "Κεντρική"],
  ["UNDERFLOOR", "Ενδοδαπέδια"],
  ["HEAT_PUMP", "Αντλία θερμότητας"],
  ["GAS", "Φυσικό αέριο"],
  ["NONE", "Χωρίς θέρμανση"],
  ["NOT_AVAILABLE", "Δεν έχει δηλωθεί"],
] as const;

export const ENERGY_OPTIONS = [
  ["A_PLUS", "Α+"],
  ["A", "Α"],
  ["B", "Β"],
  ["C", "Γ"],
  ["D", "Δ"],
  ["E", "Ε"],
  ["F", "Ζ"],
  ["G", "Η"],
  ["NOT_AVAILABLE", "Δεν έχει εκδοθεί"],
] as const;

export const CONDITION_LABELS: Record<PropertyCondition, string> = {
  NEW_BUILD: "Νεόδμητο",
  RENOVATED: "Ανακαινισμένο",
  GOOD: "Καλή κατάσταση",
  NEEDS_RENOVATION: "Χρήζει ανακαίνισης",
  UNDER_CONSTRUCTION: "Υπό κατασκευή",
};

/** Numeric/select columns. `area` is the main surface of every type. */
export const CORE_FIELDS: Record<string, FieldDef> = {
  area: { key: "area", label: "Εμβαδόν", kind: "decimal", unit: "m²", min: 0, max: 1_000_000 },
  plotArea: { key: "plotArea", label: "Εμβαδόν οικοπέδου", kind: "decimal", unit: "m²", min: 0, max: 10_000_000 },
  builtArea: { key: "builtArea", label: "Δομημένο εμβαδόν", kind: "decimal", unit: "m²", min: 0, max: 1_000_000 },
  bedrooms: { key: "bedrooms", label: "Υπνοδωμάτια", kind: "int", min: 0, max: 50 },
  bathrooms: { key: "bathrooms", label: "Μπάνια", kind: "int", min: 0, max: 50 },
  wc: { key: "wc", label: "WC", kind: "int", min: 0, max: 50 },
  floor: { key: "floor", label: "Όροφος", kind: "int", min: -5, max: 200, hint: "0 = ισόγειο, -1 = υπόγειο" },
  totalFloors: { key: "totalFloors", label: "Σύνολο ορόφων κτιρίου", kind: "int", min: 0, max: 200 },
  yearBuilt: { key: "yearBuilt", label: "Έτος κατασκευής", kind: "int", min: 1800, max: 2100 },
  yearRenovated: { key: "yearRenovated", label: "Έτος ανακαίνισης", kind: "int", min: 1800, max: 2100 },
  heating: { key: "heating", label: "Θέρμανση", kind: "select", options: HEATING_OPTIONS },
  energyClass: { key: "energyClass", label: "Ενεργειακή κλάση", kind: "select", options: ENERGY_OPTIONS },
  parkingSpaces: { key: "parkingSpaces", label: "Θέσεις στάθμευσης", kind: "int", min: 0, max: 1000 },
  balconyArea: { key: "balconyArea", label: "Εμβαδόν μπαλκονιών", kind: "decimal", unit: "m²", min: 0, max: 100_000 },
};

/** Boolean columns. */
export const CORE_FLAGS: Record<string, FieldDef> = {
  parking: { key: "parking", label: "Θέση στάθμευσης", kind: "bool" },
  storage: { key: "storage", label: "Αποθήκη", kind: "bool" },
  balcony: { key: "balcony", label: "Μπαλκόνι", kind: "bool" },
  garden: { key: "garden", label: "Κήπος", kind: "bool" },
  pool: { key: "pool", label: "Πισίνα", kind: "bool" },
  furnished: { key: "furnished", label: "Επιπλωμένο", kind: "bool" },
  petsAllowed: { key: "petsAllowed", label: "Επιτρέπονται κατοικίδια", kind: "bool" },
  seaView: { key: "seaView", label: "Θέα θάλασσα", kind: "bool" },
  hasSolar: { key: "hasSolar", label: "Ηλιακός θερμοσίφωνας", kind: "bool" },
  newConstruction: { key: "newConstruction", label: "Νέα κατασκευή", kind: "bool" },
};

export const CORE_FIELD_KEYS = Object.keys(CORE_FIELDS);
export const CORE_FLAG_KEYS = Object.keys(CORE_FLAGS);

// --- Detail fields (JSON) ----------------------------------------------------

const yesNoUnknown = [
  ["NO", "Όχι"],
  ["PARTIAL", "Μερικώς"],
  ["YES", "Ναι"],
  ["UNKNOWN", "Άγνωστο"],
] as const;

const licence = [
  ["ACTIVE", "Ενεργή άδεια"],
  ["PENDING", "Σε εξέλιξη"],
  ["NONE", "Χωρίς άδεια"],
] as const;

const d = (key: string, label: string, kind: FieldKind, extra: Partial<FieldDef> = {}): FieldDef => ({
  key,
  label,
  kind,
  ...extra,
});
const m2 = { unit: "m²", min: 0, max: 10_000_000 };
const meters = { unit: "m", min: 0, max: 10_000 };
const count = { min: 0, max: 10_000 };
const euro = { unit: "€", min: 0, max: 1_000_000_000 };

export const DETAIL_FIELDS: Record<string, FieldDef> = Object.fromEntries(
  [
    // Residential
    d("livingRooms", "Σαλόνια", "int", count),
    d("kitchens", "Κουζίνες", "int", count),
    d("masterBedrooms", "Master υπνοδωμάτια", "int", count),
    d("orientation", "Προσανατολισμός", "select", {
      options: [
        ["N", "Βόρειος"], ["NE", "Βορειοανατολικός"], ["E", "Ανατολικός"], ["SE", "Νοτιοανατολικός"],
        ["S", "Νότιος"], ["SW", "Νοτιοδυτικός"], ["W", "Δυτικός"], ["NW", "Βορειοδυτικός"],
      ],
    }),
    d("view", "Θέα", "select", {
      options: [["SEA", "Θάλασσα"], ["MOUNTAIN", "Βουνό"], ["CITY", "Πόλη"], ["OPEN", "Ανοιχτή"], ["NONE", "Χωρίς θέα"]],
    }),
    d("commonCharges", "Κοινόχρηστα", "decimal", { unit: "€/μήνα", min: 0, max: 100_000 }),
    d("levels", "Επίπεδα", "int", { min: 1, max: 20 }),
    d("lowerLevelArea", "Εμβαδόν κάτω επιπέδου", "decimal", m2),
    d("upperLevelArea", "Εμβαδόν άνω επιπέδου", "decimal", m2),
    d("elevator", "Ανελκυστήρας", "bool"),
    d("fireplace", "Τζάκι", "bool"),
    d("airConditioning", "Κλιματισμός", "bool"),
    d("securityDoor", "Πόρτα ασφαλείας", "bool"),
    d("doubleGlazing", "Διπλά τζάμια", "bool"),
    d("awnings", "Τέντες", "bool"),
    d("intercom", "Θυροτηλέφωνο", "bool"),
    d("naturalGas", "Φυσικό αέριο", "bool"),
    d("nightTariff", "Νυχτερινό ρεύμα", "bool"),
    d("photovoltaic", "Φωτοβολταϊκά", "bool"),
    d("internalStaircase", "Εσωτερική σκάλα", "bool"),
    d("privateEntrance", "Ανεξάρτητη είσοδος", "bool"),
    d("roofTerrace", "Ταράτσα / δώμα", "bool"),
    d("attic", "Σοφίτα", "bool"),
    d("garage", "Γκαράζ", "bool"),
    d("guestHouse", "Ξενώνας", "bool"),
    d("bbq", "BBQ", "bool"),
    d("outdoorKitchen", "Εξωτερική κουζίνα", "bool"),
    d("securitySystem", "Σύστημα ασφαλείας", "bool"),
    d("smartHome", "Smart home", "bool"),
    d("fencing", "Περίφραξη", "bool"),
    d("verandas", "Βεράντες", "bool"),
    d("mountainView", "Θέα βουνό", "bool"),
    // Villa
    d("poolType", "Τύπος πισίνας", "select", {
      options: [["OUTDOOR", "Εξωτερική"], ["INDOOR", "Εσωτερική"], ["INFINITY", "Infinity"]],
    }),
    d("poolArea", "Εμβαδόν πισίνας", "decimal", m2),
    d("poolHeating", "Θερμαινόμενη πισίνα", "bool"),
    d("staffRoom", "Δωμάτιο προσωπικού", "bool"),
    d("outdoorEntertaining", "Χώρος υποδοχής εξωτερικός", "bool"),
    // Office
    d("meetingRooms", "Αίθουσες συσκέψεων", "int", count),
    d("privateOffices", "Ιδιωτικά γραφεία", "int", count),
    d("openPlan", "Ενιαίος χώρος (open plan)", "bool"),
    d("reception", "Υποδοχή / reception", "bool"),
    d("serverRoom", "Server room", "bool"),
    d("kitchenette", "Κουζίνα / kitchenette", "bool"),
    d("accessControl", "Έλεγχος πρόσβασης", "bool"),
    d("fireAlarm", "Πυρανίχνευση", "bool"),
    d("fiberInternet", "Οπτική ίνα", "bool"),
    d("naturalLight", "Φυσικός φωτισμός", "bool"),
    d("fitOut", "Διαμόρφωση", "select", {
      options: [["FITTED", "Διαμορφωμένο"], ["PARTIAL", "Μερικώς διαμορφωμένο"], ["SHELL", "Κέλυφος"]],
    }),
    // Retail
    d("groundFloorArea", "Εμβαδόν ισογείου", "decimal", m2),
    d("basementArea", "Εμβαδόν υπογείου", "decimal", m2),
    d("mezzanineArea", "Εμβαδόν παταριού", "decimal", m2),
    d("frontage", "Πρόσοψη", "decimal", meters),
    d("ceilingHeight", "Ύψος οροφής", "decimal", { unit: "m", min: 0, max: 100 }),
    d("shopWindow", "Βιτρίνα", "bool"),
    d("cornerProperty", "Γωνιακό", "bool"),
    d("pedestrianStreet", "Σε πεζόδρομο", "bool"),
    d("loadingAccess", "Πρόσβαση φορτοεκφόρτωσης", "bool"),
    d("securityShutter", "Ρολά ασφαλείας", "bool"),
    d("alarm", "Συναγερμός", "bool"),
    d("fireProtection", "Πυροπροστασία", "bool"),
    d("threePhase", "Τριφασικό ρεύμα", "bool"),
    d("foodUse", "Κατάλληλο για εστίαση", "bool"),
    d("outdoorSeating", "Δυνατότητα τραπεζοκαθισμάτων", "bool"),
    // Warehouse / industrial
    d("loadingDocks", "Ράμπες φόρτωσης", "int", count),
    d("truckAccess", "Πρόσβαση φορτηγών", "bool"),
    d("ramp", "Ράμπα", "bool"),
    d("rollerDoor", "Ρολό εισόδου", "bool"),
    d("officeArea", "Εμβαδόν γραφείων", "decimal", m2),
    d("productionArea", "Εμβαδόν παραγωγής", "decimal", m2),
    d("warehouseArea", "Εμβαδόν αποθήκης", "decimal", m2),
    d("industrialPower", "Βιομηχανικό ρεύμα", "bool"),
    d("crane", "Γερανογέφυρα", "bool"),
    d("heavyMachinery", "Κατάλληλο για βαρύ εξοπλισμό", "bool"),
    d("yard", "Αύλειος χώρος", "bool"),
    d("accessHours", "Ώρες πρόσβασης", "text"),
    d("currentUse", "Τρέχουσα χρήση", "text"),
    d("zoning", "Χρήση γης / χαρακτηρισμός", "text"),
    d("licensingStatus", "Αδειοδότηση", "select", { options: licence }),
    // Building
    d("units", "Σύνολο μονάδων", "int", count),
    d("residentialUnits", "Κατοικίες", "int", count),
    d("commercialUnits", "Επαγγελματικοί χώροι", "int", count),
    d("officeUnits", "Γραφεία", "int", count),
    d("retailUnits", "Καταστήματα", "int", count),
    d("storageUnits", "Αποθήκες", "int", count),
    d("basement", "Υπόγειο", "bool"),
    d("rooftop", "Δώμα", "bool"),
    d("occupancy", "Μίσθωση", "select", {
      options: [["VACANT", "Κενό"], ["PARTLY", "Μερικώς μισθωμένο"], ["OCCUPIED", "Πλήρως μισθωμένο"]],
    }),
    d("tenants", "Αριθμός μισθωτών", "int", count),
    d("annualRentalIncome", "Ετήσιο μίσθωμα", "decimal", euro),
    d("developmentPotential", "Δυνατότητα αξιοποίησης", "text"),
    // Hotel
    d("rooms", "Δωμάτια", "int", count),
    d("beds", "Κλίνες", "int", count),
    d("suites", "Σουίτες", "int", count),
    d("starRating", "Κατηγορία", "select", {
      options: [["1", "1★"], ["2", "2★"], ["3", "3★"], ["4", "4★"], ["5", "5★"]],
    }),
    d("operatingStatus", "Λειτουργία", "select", {
      options: [
        ["OPERATING", "Σε λειτουργία"],
        ["SEASONAL", "Εποχική λειτουργία"],
        ["CLOSED", "Εκτός λειτουργίας"],
        ["UNDER_DEVELOPMENT", "Υπό ανάπτυξη"],
      ],
    }),
    d("restaurant", "Εστιατόριο", "bool"),
    d("bar", "Μπαρ", "bool"),
    d("spa", "Spa", "bool"),
    d("gym", "Γυμναστήριο", "bool"),
    d("conferenceFacilities", "Αίθουσες συνεδρίων", "bool"),
    d("laundry", "Πλυντήριο / λινοθήκη", "bool"),
    d("annualRevenue", "Ετήσιος τζίρος", "decimal", { ...euro, hint: "Μόνο αν ο ιδιοκτήτης επιτρέπει να κοινοποιηθεί." }),
    d("annualOperatingExpenses", "Ετήσια λειτουργικά έξοδα", "decimal", {
      ...euro,
      hint: "Μόνο αν ο ιδιοκτήτης επιτρέπει να κοινοποιηθούν.",
    }),
    d("seasonality", "Περίοδος λειτουργίας", "text"),
    // Land
    d("depth", "Βάθος", "decimal", meters),
    d("buildingCoefficient", "Συντελεστής δόμησης (Σ.Δ.)", "decimal", { min: 0, max: 10 }),
    d("coverageRatio", "Κάλυψη", "decimal", { unit: "%", min: 0, max: 100 }),
    d("maxHeight", "Μέγιστο ύψος", "decimal", { unit: "m", min: 0, max: 500 }),
    d("buildableArea", "Δομήσιμο εμβαδόν", "decimal", m2),
    d("planStatus", "Πολεοδομικό καθεστώς", "select", {
      options: [["INSIDE", "Εντός σχεδίου"], ["SETTLEMENT", "Εντός οικισμού"], ["OUTSIDE", "Εκτός σχεδίου"]],
    }),
    d("landUse", "Χαρακτηρισμός", "select", {
      options: [
        ["BUILDABLE", "Οικοδομήσιμο"],
        ["AGRICULTURAL", "Αγροτεμάχιο"],
        ["DEVELOPABLE", "Προς αξιοποίηση"],
        ["OTHER", "Άλλο"],
      ],
    }),
    d("topography", "Μορφολογία", "select", {
      options: [["FLAT", "Επίπεδο"], ["SLOPED", "Επικλινές"], ["MIXED", "Μικτό"]],
    }),
    d("forestClassification", "Δασικός χαρακτηρισμός", "select", { options: yesNoUnknown }),
    d("roadAccess", "Πρόσβαση από δρόμο", "bool"),
    d("water", "Νερό", "bool"),
    d("electricity", "Ρεύμα", "bool"),
    d("sewer", "Αποχέτευση", "bool"),
    d("irrigation", "Άρδευση", "bool"),
    d("cadastre", "ΚΑΕΚ (κτηματολόγιο)", "text"),
    d("permitInfo", "Άδεια δόμησης / πληροφορίες", "text"),
    // Parking
    d("parkingType", "Τύπος θέσης", "select", {
      options: [["OPEN", "Υπαίθρια"], ["UNDERGROUND", "Υπόγεια"], ["GARAGE", "Κλειστό γκαράζ"], ["PILOTIS", "Πυλωτή"]],
    }),
    d("parkingNumber", "Αριθμός θέσης", "text"),
    d("covered", "Στεγασμένη", "bool"),
    d("evCharging", "Φόρτιση ηλεκτρικού οχήματος", "bool"),
    d("automaticGate", "Αυτόματη πόρτα", "bool"),
    d("usage", "Χρήση", "select", { options: [["PRIVATE", "Αποκλειστική"], ["SHARED", "Κοινόχρηστη"]] }),
    // Other
    d("customCharacteristics", "Ιδιαίτερα χαρακτηριστικά", "text"),
    // Listing: rent
    d("deposit", "Εγγύηση", "decimal", euro),
    d("minRentalMonths", "Ελάχιστη διάρκεια μίσθωσης", "int", { unit: "μήνες", min: 0, max: 600 }),
    d("availableFrom", "Διαθέσιμο από", "date"),
    // Listing: assignment
    d("valuation", "Εσωτερική εκτίμηση", "decimal", { ...euro, hint: "Εσωτερικό στοιχείο, δεν δημοσιεύεται." }),
    d("assignmentType", "Είδος ανάθεσης", "select", {
      options: [["EXCLUSIVE", "Αποκλειστική"], ["NON_EXCLUSIVE", "Μη αποκλειστική"]],
    }),
    d("assignmentStart", "Έναρξη ανάθεσης", "date"),
    d("assignmentEnd", "Λήξη ανάθεσης", "date"),
  ].map((f) => [f.key, f]),
);

// --- Profiles -----------------------------------------------------------------

export type PropertyProfile = {
  /** Section title for the type-specific fields. */
  title: string;
  /** Core numeric/select columns shown, in order. */
  core: string[];
  /** Label overrides for core fields (e.g. "Εμβαδόν γης"). */
  labels?: Partial<Record<string, string>>;
  /** Detail (non-boolean) fields shown, in order. */
  details: string[];
  /** Boolean features: core flags and detail booleans. */
  features: string[];
  /** Required once the property is no longer a draft. */
  required: string[];
  /** Worth filling for a complete listing (completeness score). */
  recommended: string[];
  /** Allowed conditions; null hides the field (e.g. land). */
  conditions: PropertyCondition[] | null;
};

const ALL_CONDITIONS: PropertyCondition[] = ["NEW_BUILD", "RENOVATED", "GOOD", "NEEDS_RENOVATION", "UNDER_CONSTRUCTION"];

const RESIDENTIAL_FEATURES = [
  "parking", "storage", "balcony", "garden", "pool", "furnished", "petsAllowed", "seaView", "hasSolar",
  "newConstruction", "elevator", "fireplace", "airConditioning", "securityDoor", "doubleGlazing", "awnings",
  "intercom", "naturalGas", "nightTariff", "photovoltaic",
];

const APARTMENT: PropertyProfile = {
  title: "Χαρακτηριστικά κατοικίας",
  core: ["area", "bedrooms", "bathrooms", "wc", "floor", "totalFloors", "yearBuilt", "yearRenovated", "heating", "energyClass", "parkingSpaces", "balconyArea"],
  details: ["livingRooms", "kitchens", "masterBedrooms", "orientation", "view", "commonCharges"],
  features: RESIDENTIAL_FEATURES,
  required: ["area"],
  recommended: ["bedrooms", "bathrooms", "floor", "yearBuilt", "heating", "energyClass"],
  conditions: ALL_CONDITIONS,
};

const MAISONETTE: PropertyProfile = {
  ...APARTMENT,
  title: "Χαρακτηριστικά μεζονέτας",
  core: ["area", "plotArea", "bedrooms", "bathrooms", "wc", "floor", "totalFloors", "yearBuilt", "yearRenovated", "heating", "energyClass", "parkingSpaces", "balconyArea"],
  labels: { floor: "Όροφος εισόδου" },
  details: ["levels", "lowerLevelArea", "upperLevelArea", "livingRooms", "kitchens", "masterBedrooms", "orientation", "view", "commonCharges"],
  features: [...RESIDENTIAL_FEATURES, "internalStaircase", "privateEntrance", "roofTerrace", "attic"],
  recommended: ["levels", "bedrooms", "bathrooms", "yearBuilt", "heating", "energyClass"],
};

const HOUSE_FEATURES = [
  "garden", "pool", "parking", "storage", "balcony", "furnished", "petsAllowed", "seaView", "hasSolar",
  "newConstruction", "garage", "guestHouse", "bbq", "outdoorKitchen", "securitySystem", "smartHome",
  "photovoltaic", "fireplace", "airConditioning", "verandas", "roofTerrace", "fencing", "privateEntrance",
  "mountainView",
];

const HOUSE: PropertyProfile = {
  title: "Χαρακτηριστικά μονοκατοικίας",
  core: ["area", "plotArea", "builtArea", "bedrooms", "bathrooms", "wc", "yearBuilt", "yearRenovated", "heating", "energyClass", "parkingSpaces"],
  labels: { area: "Εμβαδόν κατοικίας" },
  details: ["levels", "livingRooms", "kitchens", "masterBedrooms", "orientation", "view"],
  features: HOUSE_FEATURES,
  required: ["area"],
  recommended: ["plotArea", "bedrooms", "bathrooms", "levels", "yearBuilt", "energyClass"],
  conditions: ALL_CONDITIONS,
};

const VILLA: PropertyProfile = {
  ...HOUSE,
  title: "Χαρακτηριστικά βίλας",
  details: [...HOUSE.details, "poolType", "poolArea"],
  features: [...HOUSE_FEATURES, "poolHeating", "staffRoom", "outdoorEntertaining"],
};

const OFFICE: PropertyProfile = {
  title: "Χαρακτηριστικά γραφείου",
  core: ["area", "floor", "totalFloors", "bathrooms", "wc", "yearBuilt", "yearRenovated", "heating", "energyClass", "parkingSpaces"],
  labels: { bathrooms: "Λουτρά / WC" },
  details: ["meetingRooms", "privateOffices", "fitOut", "commonCharges"],
  features: [
    "parking", "storage", "balcony", "furnished", "openPlan", "reception", "serverRoom", "kitchenette",
    "airConditioning", "elevator", "accessControl", "securitySystem", "fireAlarm", "fiberInternet", "naturalLight",
  ],
  required: ["area"],
  recommended: ["floor", "yearBuilt", "energyClass", "fitOut"],
  conditions: ALL_CONDITIONS,
};

const SHOP: PropertyProfile = {
  title: "Χαρακτηριστικά καταστήματος",
  core: ["area", "plotArea", "floor", "wc", "yearBuilt", "yearRenovated", "heating", "energyClass", "parkingSpaces"],
  details: ["groundFloorArea", "basementArea", "mezzanineArea", "frontage", "ceilingHeight", "commonCharges"],
  features: [
    "shopWindow", "cornerProperty", "pedestrianStreet", "loadingAccess", "storage", "kitchenette", "parking",
    "alarm", "securityShutter", "fireProtection", "threePhase", "airConditioning", "foodUse", "outdoorSeating",
  ],
  required: ["area"],
  recommended: ["groundFloorArea", "frontage", "energyClass"],
  conditions: ALL_CONDITIONS,
};

const WAREHOUSE: PropertyProfile = {
  title: "Χαρακτηριστικά αποθήκης",
  core: ["area", "builtArea", "plotArea", "floor", "wc", "yearBuilt", "yearRenovated", "parkingSpaces"],
  details: ["ceilingHeight", "loadingDocks", "officeArea", "accessHours"],
  features: ["parking", "truckAccess", "ramp", "rollerDoor", "loadingAccess", "industrialPower", "fireProtection", "securitySystem"],
  required: ["area"],
  recommended: ["ceilingHeight", "floor"],
  conditions: ALL_CONDITIONS,
};

const BUILDING: PropertyProfile = {
  title: "Χαρακτηριστικά κτιρίου",
  core: ["area", "plotArea", "totalFloors", "yearBuilt", "yearRenovated", "energyClass", "parkingSpaces"],
  labels: { area: "Συνολικό εμβαδόν κτιρίου", totalFloors: "Όροφοι" },
  details: [
    "units", "residentialUnits", "commercialUnits", "officeUnits", "retailUnits", "storageUnits", "occupancy",
    "tenants", "annualRentalIncome", "currentUse", "developmentPotential",
  ],
  features: ["elevator", "basement", "rooftop", "parking"],
  required: ["area"],
  recommended: ["plotArea", "totalFloors", "units", "yearBuilt"],
  conditions: ALL_CONDITIONS,
};

const HOTEL: PropertyProfile = {
  title: "Στοιχεία ξενοδοχείου",
  core: ["area", "plotArea", "totalFloors", "yearBuilt", "yearRenovated", "energyClass", "parkingSpaces"],
  labels: { area: "Δομημένο εμβαδόν", totalFloors: "Όροφοι" },
  details: [
    "rooms", "beds", "suites", "starRating", "operatingStatus", "licensingStatus", "seasonality",
    "annualRevenue", "annualOperatingExpenses", "developmentPotential",
  ],
  features: [
    "reception", "pool", "restaurant", "bar", "spa", "gym", "parking", "conferenceFacilities", "kitchenette",
    "laundry", "storage", "seaView", "elevator",
  ],
  required: ["area", "rooms"],
  recommended: ["beds", "starRating", "operatingStatus", "plotArea"],
  conditions: ALL_CONDITIONS,
};

const INDUSTRIAL: PropertyProfile = {
  title: "Χαρακτηριστικά βιομηχανικού ακινήτου",
  core: ["area", "plotArea", "floor", "totalFloors", "yearBuilt", "yearRenovated", "energyClass", "parkingSpaces"],
  labels: { area: "Δομημένο εμβαδόν" },
  details: ["productionArea", "warehouseArea", "officeArea", "ceilingHeight", "loadingDocks", "currentUse", "zoning", "licensingStatus"],
  features: [
    "truckAccess", "industrialPower", "threePhase", "crane", "heavyMachinery", "fireProtection", "yard",
    "parking", "securitySystem", "naturalGas",
  ],
  required: ["area"],
  recommended: ["plotArea", "ceilingHeight", "zoning"],
  conditions: ALL_CONDITIONS,
};

const LAND: PropertyProfile = {
  title: "Χαρακτηριστικά γης",
  core: ["area"],
  labels: { area: "Εμβαδόν γης" },
  details: ["landUse", "planStatus", "frontage", "depth", "topography", "forestClassification", "cadastre"],
  features: ["roadAccess", "cornerProperty", "water", "electricity", "sewer", "irrigation", "seaView", "mountainView", "fencing"],
  required: ["area"],
  recommended: ["landUse", "planStatus", "frontage"],
  conditions: null,
};

const PLOT: PropertyProfile = {
  ...LAND,
  title: "Χαρακτηριστικά οικοπέδου",
  labels: { area: "Εμβαδόν οικοπέδου" },
  details: [
    "planStatus", "landUse", "buildingCoefficient", "coverageRatio", "maxHeight", "buildableArea", "frontage",
    "depth", "topography", "cadastre", "permitInfo",
  ],
  recommended: ["planStatus", "buildingCoefficient", "coverageRatio", "frontage"],
};

const PARKING: PropertyProfile = {
  title: "Στοιχεία θέσης στάθμευσης",
  core: ["area", "floor"],
  details: ["parkingType", "parkingNumber", "usage"],
  features: ["covered", "evCharging", "securitySystem", "accessControl", "automaticGate"],
  required: ["parkingType"],
  recommended: ["area", "floor"],
  conditions: ["NEW_BUILD", "GOOD", "NEEDS_RENOVATION", "UNDER_CONSTRUCTION"],
};

const OTHER: PropertyProfile = {
  title: "Χαρακτηριστικά ακινήτου",
  core: ["area", "builtArea", "plotArea", "yearBuilt", "yearRenovated"],
  details: ["customCharacteristics"],
  features: ["parking", "storage", "seaView"],
  required: [],
  recommended: ["area"],
  conditions: ALL_CONDITIONS,
};

export const PROPERTY_PROFILES: Record<PropertyType, PropertyProfile> = {
  APARTMENT,
  STUDIO: { ...APARTMENT, title: "Χαρακτηριστικά στούντιο" },
  MAISONETTE,
  HOUSE,
  VILLA,
  OFFICE,
  SHOP,
  WAREHOUSE,
  BUILDING,
  HOTEL,
  INDUSTRIAL,
  LAND,
  PLOT,
  PARKING,
  OTHER,
};

// --- Listing type (pricing) ---------------------------------------------------

export type ListingProfile = {
  /** Which price column applies, with its label. */
  priceField: "price" | "monthlyRent";
  priceLabel: string;
  details: string[];
  recommended: string[];
};

export const LISTING_PROFILES: Record<ListingType, ListingProfile> = {
  SALE: { priceField: "price", priceLabel: "Τιμή πώλησης", details: [], recommended: [] },
  RENT: {
    priceField: "monthlyRent",
    priceLabel: "Μηνιαίο μίσθωμα",
    details: ["deposit", "commonCharges", "minRentalMonths", "availableFrom"],
    recommended: ["deposit"],
  },
  ASSIGNMENT: {
    priceField: "price",
    priceLabel: "Ζητούμενη τιμή",
    details: ["assignmentType", "assignmentStart", "assignmentEnd", "valuation"],
    recommended: ["assignmentType", "assignmentEnd"],
  },
};

export function profileFor(type: string | undefined | null): PropertyProfile {
  return PROPERTY_PROFILES[(type ?? "") as PropertyType] ?? OTHER;
}

export function listingProfileFor(listing: string | undefined | null): ListingProfile {
  return LISTING_PROFILES[(listing ?? "") as ListingType] ?? LISTING_PROFILES.SALE;
}

export function fieldDef(key: string): FieldDef | undefined {
  return CORE_FIELDS[key] ?? CORE_FLAGS[key] ?? DETAIL_FIELDS[key];
}

/** Label of a field for a given type (type-specific override first). */
export function fieldLabel(type: string | undefined | null, key: string): string {
  return profileFor(type).labels?.[key] ?? fieldDef(key)?.label ?? key;
}

/** Detail keys (any kind) that apply to this type + listing. */
export function applicableDetailKeys(type: string, listing: string): string[] {
  const profile = profileFor(type);
  const keys = new Set<string>([
    ...profile.details,
    ...profile.features.filter((key) => key in DETAIL_FIELDS),
    ...listingProfileFor(listing).details,
  ]);
  return [...keys];
}

// --- Normalisation and validation (server and client) ------------------------

export type ProfileIssue = { path: string; message: string };

type Record_ = Record<string, unknown>;

function coerceDetail(def: FieldDef, raw: unknown): { value?: unknown; error?: string } {
  if (raw === undefined || raw === null || raw === "") return {};
  switch (def.kind) {
    case "bool":
      return { value: raw === true || raw === "true" || raw === "on" || raw === "1" };
    case "int":
    case "decimal": {
      const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
      if (!Number.isFinite(n) || (def.kind === "int" && !Number.isInteger(n))) {
        return { error: def.kind === "int" ? "Δώστε έναν ακέραιο αριθμό." : "Δώστε έναν αριθμό." };
      }
      if (def.min != null && n < def.min) return { error: `Η ελάχιστη τιμή είναι ${def.min}.` };
      if (def.max != null && n > def.max) return { error: `Η μέγιστη τιμή είναι ${def.max}.` };
      return { value: n };
    }
    case "select": {
      const v = String(raw);
      return def.options?.some(([value]) => value === v) ? { value: v } : { error: "Μη έγκυρη επιλογή." };
    }
    case "date": {
      const v = String(raw);
      return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))
        ? { value: v }
        : { error: "Δώστε ημερομηνία (ΕΕΕΕ-ΜΜ-ΗΗ)." };
    }
    default: {
      const v = String(raw).trim();
      return v.length > 2000 ? { error: "Έως 2000 χαρακτήρες." } : v ? { value: v } : {};
    }
  }
}

/**
 * The stored shape of a property for its type and listing:
 *  - details keep only applicable keys, coerced to their type (others dropped);
 *  - core columns that do not apply to the type are cleared (null / false), so
 *    e.g. a plot never carries bedrooms;
 *  - the condition is kept only if allowed for the type.
 * Returns the cleaned values plus field-level issues for invalid details.
 */
export function normalizeForProfile(input: Record_): { values: Record_; issues: ProfileIssue[] } {
  const type = String(input.propertyType ?? "OTHER");
  const listing = String(input.listingType ?? "SALE");
  const profile = profileFor(type);
  const issues: ProfileIssue[] = [];
  const values: Record_ = { ...input };

  for (const key of CORE_FIELD_KEYS) {
    if (profile.core.includes(key)) continue;
    if (key === "heating" || key === "energyClass") values[key] = "NOT_AVAILABLE";
    else values[key] = null;
  }
  for (const key of CORE_FLAG_KEYS) {
    if (!profile.features.includes(key)) values[key] = false;
  }
  if (profile.conditions === null) values.condition = "GOOD";
  else if (input.condition && !profile.conditions.includes(input.condition as PropertyCondition)) {
    issues.push({ path: "condition", message: "Η κατάσταση αυτή δεν ισχύει για αυτόν τον τύπο ακινήτου." });
  }

  const listingProfile = listingProfileFor(listing);
  if (listingProfile.priceField === "price") values.monthlyRent = null;
  else values.price = null;

  const rawDetails = (input.details && typeof input.details === "object" ? input.details : {}) as Record_;
  const details: Record_ = {};
  for (const key of applicableDetailKeys(type, listing)) {
    const def = DETAIL_FIELDS[key];
    if (!def) continue;
    const { value, error } = coerceDetail(def, rawDetails[key]);
    if (error) issues.push({ path: `details.${key}`, message: error });
    else if (value !== undefined && !(def.kind === "bool" && value === false)) details[key] = value;
  }
  values.details = details;

  return { values, issues };
}

function isFilled(values: Record_, key: string): boolean {
  const details = (values.details ?? {}) as Record_;
  const v = key in DETAIL_FIELDS && !(key in CORE_FIELDS) && !(key in CORE_FLAGS) ? details[key] : values[key];
  if (v === undefined || v === null || v === "") return false;
  if (v === "NOT_AVAILABLE") return false;
  return true;
}

/** Required-field issues; only for properties that are not drafts. */
export function requiredIssues(values: Record_): ProfileIssue[] {
  if (values.status === "DRAFT") return [];
  const type = String(values.propertyType ?? "OTHER");
  const listing = listingProfileFor(String(values.listingType ?? "SALE"));
  const issues: ProfileIssue[] = [];
  for (const key of profileFor(type).required) {
    if (!isFilled(values, key)) {
      const path = key in DETAIL_FIELDS && !(key in CORE_FIELDS) ? `details.${key}` : key;
      issues.push({ path, message: `Συμπληρώστε: ${fieldLabel(type, key)}.` });
    }
  }
  if (!values.priceOnRequest && !isFilled(values, listing.priceField)) {
    issues.push({ path: listing.priceField, message: `Συμπληρώστε ${listing.priceLabel.toLowerCase()} ή επιλέξτε «Τιμή κατόπιν επικοινωνίας».` });
  }
  return issues;
}

export type Completeness = { percent: number; missing: string[] };

/**
 * How complete a listing is for its type: required + recommended fields,
 * location, descriptions and price. Missing items are named in Greek.
 */
export function completeness(values: Record_): Completeness {
  const type = String(values.propertyType ?? "OTHER");
  const profile = profileFor(type);
  const listing = listingProfileFor(String(values.listingType ?? "SALE"));
  const checks: Array<[string, boolean]> = [
    ["Τίτλος", isFilled(values, "titleEl")],
    ["Περιγραφή", isFilled(values, "descriptionEl")],
    [listing.priceLabel, Boolean(values.priceOnRequest) || isFilled(values, listing.priceField)],
    ["Περιοχή", isFilled(values, "areaName") || isFilled(values, "city")],
    ...[...new Set([...profile.required, ...profile.recommended, ...listing.recommended])].map(
      (key) => [fieldLabel(type, key), isFilled(values, key)] as [string, boolean],
    ),
  ];
  const done = checks.filter(([, ok]) => ok).length;
  return {
    percent: Math.round((done / checks.length) * 100),
    missing: checks.filter(([, ok]) => !ok).map(([label]) => label),
  };
}

// --- Display ------------------------------------------------------------------

const NUMBER_EL = new Intl.NumberFormat("el-GR", { maximumFractionDigits: 2 });

/** Human-readable value of a field ("95 m²", "Αυτόνομη", "Ναι"), or null if empty. */
export function displayValue(key: string, value: unknown): string | null {
  const def = fieldDef(key);
  if (value === undefined || value === null || value === "" || value === "NOT_AVAILABLE") return null;
  if (!def) return String(value);
  switch (def.kind) {
    case "bool":
      return value === true || value === "true" ? "Ναι" : null;
    case "int":
    case "decimal": {
      const n = Number(value);
      if (!Number.isFinite(n)) return null;
      const formatted = def.unit === "€" ? `${NUMBER_EL.format(n)} €` : NUMBER_EL.format(n);
      return def.unit && def.unit !== "€" ? `${formatted} ${def.unit}` : formatted;
    }
    case "select":
      return def.options?.find(([v]) => v === String(value))?.[1] ?? String(value);
    case "date": {
      const [y, m, d] = String(value).split("-");
      return y && m && d ? `${d}/${m}/${y}` : String(value);
    }
    default:
      return String(value);
  }
}

/**
 * The filled-in characteristics of a property, in its profile's order, as
 * [label, value] pairs: the core fields, then the type's details. Empty and
 * not-applicable fields are left out, so nothing irrelevant is shown.
 */
export function describeProperty(property: Record<string, unknown>): {
  characteristics: Array<[string, string]>;
  pricing: Array<[string, string]>;
  features: string[];
} {
  const type = String(property.propertyType ?? "OTHER");
  const profile = profileFor(type);
  const listing = listingProfileFor(String(property.listingType ?? "SALE"));
  const details = (property.details && typeof property.details === "object" ? property.details : {}) as Record<string, unknown>;
  const valueOf = (key: string) => (key in CORE_FIELDS || key in CORE_FLAGS ? property[key] : details[key]);

  const pairs = (keys: string[]) =>
    keys.flatMap((key) => {
      const shown = displayValue(key, valueOf(key));
      return shown === null ? [] : [[fieldLabel(type, key), shown] as [string, string]];
    });

  return {
    characteristics: pairs([...profile.core, ...profile.details.filter((key) => !listing.details.includes(key))]),
    pricing: pairs(listing.details),
    features: profile.features.filter((key) => displayValue(key, valueOf(key)) !== null).map((key) => fieldLabel(type, key)),
  };
}
