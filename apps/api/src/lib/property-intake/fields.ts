/**
 * Which fields the assistant may capture, and how a value is checked.
 *
 * The allowlist is derived from the same property profiles the CRM form and
 * the API validation use (`@home88/domain`), so "what an apartment has" is
 * defined once. The model never names a database column: it proposes a key
 * from this list, and anything else is dropped.
 */

import {
  CORE_FLAGS,
  CORE_FIELDS,
  DETAIL_FIELDS,
  applicableDetailKeys,
  fieldLabel,
  listingProfileFor,
  profileFor,
  type FieldKind,
} from "@home88/domain";

export const LISTING_TYPES = [
  ["SALE", "Πώληση", "Sale"],
  ["RENT", "Ενοικίαση", "Rent"],
  ["ASSIGNMENT", "Ανάθεση", "Assignment"],
] as const;

export const PROPERTY_TYPES = [
  ["APARTMENT", "Διαμέρισμα", "Apartment"],
  ["STUDIO", "Στούντιο", "Studio"],
  ["MAISONETTE", "Μεζονέτα", "Maisonette"],
  ["HOUSE", "Μονοκατοικία", "House"],
  ["VILLA", "Βίλα", "Villa"],
  ["OFFICE", "Γραφείο", "Office"],
  ["SHOP", "Κατάστημα", "Shop"],
  ["WAREHOUSE", "Αποθήκη", "Warehouse"],
  ["BUILDING", "Κτίριο", "Building"],
  ["HOTEL", "Ξενοδοχείο", "Hotel"],
  ["INDUSTRIAL", "Βιομηχανικό", "Industrial"],
  ["LAND", "Γη", "Land"],
  ["PLOT", "Οικόπεδο", "Plot"],
  ["PARKING", "Parking", "Parking"],
  ["OTHER", "Άλλο", "Other"],
] as const;

const CONDITIONS = [
  ["NEW_BUILD", "Νεόδμητο", "New build"],
  ["RENOVATED", "Ανακαινισμένο", "Renovated"],
  ["GOOD", "Καλή κατάσταση", "Good condition"],
  ["NEEDS_RENOVATION", "Χρήζει ανακαίνισης", "Needs renovation"],
  ["UNDER_CONSTRUCTION", "Υπό κατασκευή", "Under construction"],
] as const;

/** English names for the fields most often asked about; others fall back to a readable form of the key. */
const EN_LABELS: Record<string, string> = {
  area: "area", plotArea: "plot area", builtArea: "built area", bedrooms: "bedrooms", bathrooms: "bathrooms",
  wc: "WCs", floor: "floor", totalFloors: "total floors in the building", yearBuilt: "year of construction",
  yearRenovated: "year of renovation", heating: "heating", energyClass: "energy class", parkingSpaces: "parking spaces",
  balconyArea: "balcony area", parking: "parking", storage: "storage room", balcony: "balcony", garden: "garden",
  pool: "swimming pool", furnished: "furnished", petsAllowed: "pets allowed", seaView: "sea view",
  hasSolar: "solar water heater", newConstruction: "new construction", price: "asking price", monthlyRent: "monthly rent",
  priceOnRequest: "price on request", region: "region", city: "city or municipality", areaName: "area",
  neighborhood: "neighbourhood", address: "address", postalCode: "postal code", titleEl: "Greek title",
  titleEn: "English title", descriptionEl: "Greek description", descriptionEn: "English description",
  listingType: "listing type", propertyType: "property type", condition: "condition", elevator: "elevator",
  airConditioning: "air conditioning", fireplace: "fireplace", commonCharges: "monthly common charges", deposit: "deposit",
  livingRooms: "living rooms", kitchens: "kitchens", orientation: "orientation", view: "view",
};

function readableEn(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

export type FieldSpec = {
  key: string;
  kind: FieldKind;
  labelEl: string;
  labelEn: string;
  options?: ReadonlyArray<{ value: string; labelEl: string; labelEn?: string }>;
  min?: number;
  max?: number;
  unit?: string;
  /** Where it ends up: a property column, or the `details` JSON. */
  where: "column" | "detail";
  /** Text fields only: the longest accepted value. */
  maxLength?: number;
};

const text = (key: string, labelEl: string, maxLength: number): FieldSpec => ({
  key, kind: "text", labelEl, labelEn: EN_LABELS[key] ?? readableEn(key), where: "column", maxLength,
});

const select = (key: string, labelEl: string, rows: ReadonlyArray<readonly [string, string, string]>): FieldSpec => ({
  key, kind: "select", labelEl, labelEn: EN_LABELS[key] ?? readableEn(key), where: "column",
  options: rows.map(([value, labelEl, labelEn]) => ({ value, labelEl, labelEn })),
});

const money = (key: string, labelEl: string): FieldSpec => ({
  key, kind: "decimal", labelEl, labelEn: EN_LABELS[key] ?? readableEn(key), where: "column", unit: "€", min: 0, max: 1_000_000_000,
});

function fromDef(key: string, type: string, where: "column" | "detail"): FieldSpec | null {
  const def = CORE_FIELDS[key] ?? CORE_FLAGS[key] ?? DETAIL_FIELDS[key];
  if (!def) return null;
  return {
    key,
    kind: def.kind,
    labelEl: fieldLabel(type, key),
    labelEn: EN_LABELS[key] ?? readableEn(key),
    options: def.options?.map(([value, labelEl]) => ({ value, labelEl })),
    min: def.min,
    max: def.max,
    unit: def.unit,
    where,
    maxLength: def.kind === "text" ? 2000 : undefined,
  };
}

/** The conversation's first two facts; every other field depends on them. */
export const ROOT_SPECS: FieldSpec[] = [
  select("listingType", "Είδος αγγελίας", LISTING_TYPES),
  select("propertyType", "Τύπος ακινήτου", PROPERTY_TYPES),
];

/**
 * Every field that may be captured for this listing and property type, in the
 * order a visit naturally covers them. Coordinates are deliberately absent: the
 * assistant never invents (or transcribes) a position.
 */
export function allowedFields(listingType: string | undefined, propertyType: string | undefined): FieldSpec[] {
  const type = propertyType ?? "OTHER";
  const listing = listingType ?? "SALE";
  const profile = profileFor(type);
  const priceField = listingProfileFor(listing).priceField;

  const specs: FieldSpec[] = [...ROOT_SPECS];
  specs.push(priceField === "price" ? money("price", fieldLabelOr("Τιμή", listing)) : money("monthlyRent", "Μηνιαίο μίσθωμα"));
  specs.push({ key: "priceOnRequest", kind: "bool", labelEl: "Τιμή κατόπιν επικοινωνίας", labelEn: EN_LABELS.priceOnRequest!, where: "column" });
  if (profile.conditions) {
    const allowed = new Set<string>(profile.conditions);
    specs.push(select("condition", "Κατάσταση ακινήτου", CONDITIONS.filter(([v]) => allowed.has(v))));
  }
  specs.push(text("region", "Περιφέρεια", 120), text("city", "Πόλη / Δήμος", 120), text("areaName", "Περιοχή", 120),
    text("neighborhood", "Γειτονιά", 120), text("address", "Διεύθυνση", 300), text("postalCode", "Τ.Κ.", 20));

  for (const key of profile.core) {
    const spec = fromDef(key, type, "column");
    if (spec) specs.push(spec);
  }
  for (const key of profile.features) {
    const spec = fromDef(key, type, key in CORE_FLAGS ? "column" : "detail");
    if (spec) specs.push(spec);
  }
  for (const key of applicableDetailKeys(type, listing)) {
    if (specs.some((s) => s.key === key)) continue;
    const spec = fromDef(key, type, "detail");
    if (spec) specs.push(spec);
  }
  specs.push(text("titleEl", "Τίτλος (ελληνικά)", 200), text("titleEn", "Τίτλος (αγγλικά)", 200),
    text("descriptionEl", "Περιγραφή (ελληνικά)", 20000), text("descriptionEn", "Περιγραφή (αγγλικά)", 20000));
  return specs;
}

function fieldLabelOr(fallback: string, listing: string): string {
  return listingProfileFor(listing).priceLabel || fallback;
}

export type CoerceResult = { ok: true; value: string | number | boolean } | { ok: false; reason: string };

const TRUE_WORDS = new Set(["true", "yes", "y", "1", "ναι", "έχει", "υπάρχει"]);
const FALSE_WORDS = new Set(["false", "no", "n", "0", "όχι", "δεν έχει", "δεν υπάρχει"]);

/** Checks one proposed value against its field definition. Never guesses: anything doubtful is refused. */
export function coerceValue(spec: FieldSpec, raw: unknown): CoerceResult {
  if (raw === null || raw === undefined || raw === "") return { ok: false, reason: "empty" };
  switch (spec.kind) {
    case "bool": {
      if (typeof raw === "boolean") return { ok: true, value: raw };
      const word = String(raw).trim().toLowerCase();
      if (TRUE_WORDS.has(word)) return { ok: true, value: true };
      if (FALSE_WORDS.has(word)) return { ok: true, value: false };
      return { ok: false, reason: "not_a_boolean" };
    }
    case "int":
    case "decimal": {
      const n = typeof raw === "number" ? raw : Number(String(raw).trim().replace(/\s/g, "").replace(",", "."));
      if (!Number.isFinite(n)) return { ok: false, reason: "not_a_number" };
      if (spec.kind === "int" && !Number.isInteger(n)) return { ok: false, reason: "not_an_integer" };
      if (spec.min != null && n < spec.min) return { ok: false, reason: "below_min" };
      if (spec.max != null && n > spec.max) return { ok: false, reason: "above_max" };
      return { ok: true, value: n };
    }
    case "select": {
      const v = String(raw).trim();
      return spec.options?.some((o) => o.value === v) ? { ok: true, value: v } : { ok: false, reason: "not_an_option" };
    }
    case "date": {
      const v = String(raw).trim();
      return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? { ok: true, value: v } : { ok: false, reason: "not_a_date" };
    }
    default: {
      const v = String(raw).trim();
      if (!v) return { ok: false, reason: "empty" };
      if (spec.maxLength && v.length > spec.maxLength) return { ok: false, reason: "too_long" };
      return { ok: true, value: v };
    }
  }
}

export function specByKey(specs: FieldSpec[], key: string): FieldSpec | undefined {
  return specs.find((s) => s.key === key);
}
