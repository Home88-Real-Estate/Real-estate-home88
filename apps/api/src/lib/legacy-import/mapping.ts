/**
 * Explicit, schema-driven mappings from an observed legacy CSV header to a
 * small allowlist of HOME88 fields. This module only normalises in memory:
 * it never writes contacts, properties or plaintext source values.
 */

import { propertyUpsertSchema } from "@home88/validation";
import { z } from "zod";

export const LEGACY_IMPORT_MAPPING_VERSION = "h88-estate-plus-map-v1";

export const LEGACY_IMPORT_TARGET_TYPES = ["CONTACT", "PROPERTY"] as const;
export type LegacyImportTargetType = (typeof LEGACY_IMPORT_TARGET_TYPES)[number];

export const LEGACY_IMPORT_TRANSFORMS = [
  "TEXT",
  "EMAIL",
  "INTEGER",
  "NUMBER_DOT",
  "NUMBER_COMMA",
  "BOOLEAN_MAP",
  "ENUM_MAP",
] as const;
export type LegacyImportTransform = (typeof LEGACY_IMPORT_TRANSFORMS)[number];

type FieldKind = "text" | "email" | "integer" | "number" | "boolean" | "enum";
type MappingFieldDefinition = {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  allowedValues?: readonly string[];
  maxLength?: number;
};

const CONTACT_FIELDS: readonly MappingFieldDefinition[] = [
  { key: "firstName", label: "Όνομα", kind: "text", maxLength: 100 },
  { key: "lastName", label: "Επώνυμο", kind: "text", maxLength: 100 },
  { key: "company", label: "Εταιρεία", kind: "text", maxLength: 200 },
  { key: "email", label: "Email", kind: "email", maxLength: 200 },
  { key: "phone", label: "Τηλέφωνο", kind: "text", maxLength: 40 },
  { key: "mobile", label: "Κινητό", kind: "text", maxLength: 40 },
  { key: "workPhone", label: "Επαγγελματικό τηλέφωνο", kind: "text", maxLength: 40 },
  { key: "city", label: "Πόλη", kind: "text", maxLength: 100 },
  { key: "postalCode", label: "Ταχυδρομικός κώδικας", kind: "text", maxLength: 20 },
  { key: "taxId", label: "ΑΦΜ", kind: "text", maxLength: 30 },
  { key: "address", label: "Διεύθυνση", kind: "text", maxLength: 300 },
  { key: "preferredLocale", label: "Γλώσσα επικοινωνίας", kind: "enum", allowedValues: ["el", "en"] },
  {
    key: "preferredContactMethod",
    label: "Προτιμώμενος τρόπος επικοινωνίας",
    kind: "enum",
    allowedValues: ["ANY", "EMAIL", "PHONE", "SMS", "WHATSAPP"],
  },
] as const;

const PROPERTY_FIELDS: readonly MappingFieldDefinition[] = [
  { key: "listingType", label: "Τύπος συναλλαγής", kind: "enum", required: true, allowedValues: ["SALE", "RENT", "ANTIPAROXI", "SALE_ANTIPAROXI", "ASSIGNMENT"] },
  { key: "propertyType", label: "Τύπος ακινήτου", kind: "enum", required: true, allowedValues: ["APARTMENT", "MAISONETTE", "HOUSE", "VILLA", "STUDIO", "OFFICE", "SHOP", "WAREHOUSE", "BUILDING", "HOTEL", "LAND", "PLOT", "PARKING", "INDUSTRIAL", "OTHER"] },
  { key: "condition", label: "Κατάσταση", kind: "enum", allowedValues: ["NEW_BUILD", "RENOVATED", "GOOD", "NEEDS_RENOVATION", "UNDER_CONSTRUCTION"] },
  { key: "titleEl", label: "Τίτλος (Ελληνικά)", kind: "text", maxLength: 200 },
  { key: "titleEn", label: "Τίτλος (Αγγλικά)", kind: "text", maxLength: 200 },
  { key: "descriptionEl", label: "Περιγραφή (Ελληνικά)", kind: "text", required: true, maxLength: 20_000 },
  { key: "descriptionEn", label: "Περιγραφή (Αγγλικά)", kind: "text", maxLength: 20_000 },
  { key: "price", label: "Τιμή πώλησης", kind: "number" },
  { key: "monthlyRent", label: "Μηνιαίο μίσθωμα", kind: "number" },
  { key: "priceOnRequest", label: "Τιμή κατόπιν επικοινωνίας", kind: "boolean" },
  { key: "area", label: "Εμβαδόν", kind: "number" },
  { key: "plotArea", label: "Εμβαδόν οικοπέδου", kind: "number" },
  { key: "builtArea", label: "Δομημένο εμβαδόν", kind: "number" },
  { key: "bedrooms", label: "Υπνοδωμάτια", kind: "integer" },
  { key: "bathrooms", label: "Μπάνια", kind: "integer" },
  { key: "wc", label: "WC", kind: "integer" },
  { key: "floor", label: "Όροφος", kind: "integer" },
  { key: "totalFloors", label: "Σύνολο ορόφων", kind: "integer" },
  { key: "yearBuilt", label: "Έτος κατασκευής", kind: "integer" },
  { key: "yearRenovated", label: "Έτος ανακαίνισης", kind: "integer" },
  { key: "heating", label: "Θέρμανση", kind: "enum", allowedValues: ["CENTRAL", "INDIVIDUAL", "UNDERFLOOR", "HEAT_PUMP", "GAS", "NONE", "NOT_AVAILABLE"] },
  { key: "energyClass", label: "Ενεργειακή κλάση", kind: "enum", allowedValues: ["A_PLUS", "A", "B", "C", "D", "E", "F", "G", "NOT_AVAILABLE"] },
  { key: "hasSolar", label: "Ηλιακός θερμοσίφωνας", kind: "boolean" },
  { key: "parking", label: "Parking", kind: "boolean" },
  { key: "parkingSpaces", label: "Θέσεις parking", kind: "integer" },
  { key: "storage", label: "Αποθήκη", kind: "boolean" },
  { key: "balcony", label: "Μπαλκόνι", kind: "boolean" },
  { key: "balconyArea", label: "Εμβαδόν μπαλκονιού", kind: "number" },
  { key: "garden", label: "Κήπος", kind: "boolean" },
  { key: "pool", label: "Πισίνα", kind: "boolean" },
  { key: "furnished", label: "Επιπλωμένο", kind: "boolean" },
  { key: "petsAllowed", label: "Επιτρέπονται κατοικίδια", kind: "boolean" },
  { key: "seaView", label: "Θέα θάλασσα", kind: "boolean" },
  { key: "newConstruction", label: "Νέα κατασκευή", kind: "boolean" },
  { key: "region", label: "Περιφέρεια", kind: "text", maxLength: 120 },
  { key: "city", label: "Πόλη", kind: "text", maxLength: 120 },
  { key: "areaName", label: "Περιοχή", kind: "text", maxLength: 120 },
  { key: "neighborhood", label: "Γειτονιά", kind: "text", maxLength: 120 },
  { key: "address", label: "Διεύθυνση", kind: "text", maxLength: 300 },
  { key: "postalCode", label: "Ταχυδρομικός κώδικας", kind: "text", maxLength: 20 },
  { key: "latitude", label: "Γεωγραφικό πλάτος", kind: "number" },
  { key: "longitude", label: "Γεωγραφικό μήκος", kind: "number" },
  { key: "videoUrl", label: "Σύνδεσμος video", kind: "text", maxLength: 500 },
  { key: "virtualTourUrl", label: "Virtual tour", kind: "text", maxLength: 500 },
  { key: "featured", label: "Προτεινόμενο", kind: "boolean" },
  { key: "commissionRatePct", label: "Προμήθεια γραφείου (%)", kind: "number" },
  { key: "agentCommissionPct", label: "Προμήθεια συνεργάτη (%)", kind: "number" },
] as const;

const FIELDS: Record<LegacyImportTargetType, readonly MappingFieldDefinition[]> = {
  CONTACT: CONTACT_FIELDS,
  PROPERTY: PROPERTY_FIELDS,
};

const mappingFieldSchema = z.object({
  sourceHeader: z.string().trim().min(1).max(200),
  targetField: z.string().trim().min(1).max(80),
  transform: z.enum(LEGACY_IMPORT_TRANSFORMS),
  valueMap: z.record(z.string(), z.string()).optional(),
  trueValues: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  falseValues: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
}).strict();

export const legacyImportMappingSchema = z.object({
  targetType: z.enum(LEGACY_IMPORT_TARGET_TYPES),
  fields: z.array(mappingFieldSchema).min(1).max(80),
}).strict();

export type LegacyImportMappingField = z.infer<typeof mappingFieldSchema>;
export type LegacyImportMapping = z.infer<typeof legacyImportMappingSchema>;

export type LegacyMappingIssue = {
  code: string;
  field?: string;
  sourceHeader?: string;
  message: string;
};

export type LegacyMappedRow = {
  record: Record<string, unknown>;
  issues: LegacyMappingIssue[];
};

export class LegacyMappingConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegacyMappingConfigurationError";
  }
}

function normalizeToken(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .trim()
    .toLocaleLowerCase("el-GR")
    .replace(/ς/g, "σ");
}

function fieldDefinition(targetType: LegacyImportTargetType, key: string): MappingFieldDefinition | undefined {
  return FIELDS[targetType].find((field) => field.key === key);
}

function transformCompatible(kind: FieldKind, transform: LegacyImportTransform): boolean {
  switch (kind) {
    case "text": return transform === "TEXT";
    case "email": return transform === "EMAIL";
    case "integer": return transform === "INTEGER";
    case "number": return transform === "NUMBER_DOT" || transform === "NUMBER_COMMA";
    case "boolean": return transform === "BOOLEAN_MAP";
    case "enum": return transform === "ENUM_MAP";
  }
}

/** Validate a saved mapping against the actual headers from this staged file. */
export function validateLegacyImportMapping(input: unknown, headers: readonly string[]): LegacyImportMapping {
  const parsed = legacyImportMappingSchema.safeParse(input);
  if (!parsed.success) {
    throw new LegacyMappingConfigurationError("Η αντιστοίχιση περιέχει μη έγκυρα πεδία ή μετατροπές.");
  }

  const mapping = parsed.data;
  const seenHeaders = new Set<string>();
  const seenTargets = new Set<string>();

  for (const field of mapping.fields) {
    if (!headers.includes(field.sourceHeader)) {
      throw new LegacyMappingConfigurationError("Η στήλη «" + field.sourceHeader + "» δεν υπάρχει στο αρχείο.");
    }
    if (seenHeaders.has(field.sourceHeader)) {
      throw new LegacyMappingConfigurationError("Η στήλη «" + field.sourceHeader + "» έχει αντιστοιχιστεί περισσότερες από μία φορές.");
    }
    if (seenTargets.has(field.targetField)) {
      throw new LegacyMappingConfigurationError("Το πεδίο «" + field.targetField + "» έχει αντιστοιχιστεί περισσότερες από μία φορές.");
    }
    seenHeaders.add(field.sourceHeader);
    seenTargets.add(field.targetField);

    const definition = fieldDefinition(mapping.targetType, field.targetField);
    if (!definition) {
      throw new LegacyMappingConfigurationError("Το πεδίο «" + field.targetField + "» δεν υποστηρίζεται για αυτή την κατηγορία εγγραφής.");
    }
    if (!transformCompatible(definition.kind, field.transform)) {
      throw new LegacyMappingConfigurationError("Η μετατροπή για το πεδίο «" + field.targetField + "» δεν είναι συμβατή.");
    }

    if (field.transform === "ENUM_MAP") {
      if (!field.valueMap || Object.keys(field.valueMap).length === 0 || field.trueValues || field.falseValues) {
        throw new LegacyMappingConfigurationError("Ορίστε ρητή αντιστοίχιση τιμών για το πεδίο «" + field.targetField + "».");
      }
      const allowed = new Set(definition.allowedValues ?? []);
      const sourceKeys = new Set<string>();
      for (const [sourceValue, targetValue] of Object.entries(field.valueMap)) {
        const token = normalizeToken(sourceValue);
        if (!token || sourceKeys.has(token) || !allowed.has(targetValue)) {
          throw new LegacyMappingConfigurationError("Η αντιστοίχιση τιμών για το πεδίο «" + field.targetField + "» δεν είναι έγκυρη.");
        }
        sourceKeys.add(token);
      }
    } else if (field.transform === "BOOLEAN_MAP") {
      if (!field.trueValues?.length || !field.falseValues?.length || field.valueMap) {
        throw new LegacyMappingConfigurationError("Ορίστε ξεχωριστές τιμές ΝΑΙ και ΟΧΙ για το πεδίο «" + field.targetField + "».");
      }
      const truthy = new Set(field.trueValues.map(normalizeToken));
      const falsy = new Set(field.falseValues.map(normalizeToken));
      if (truthy.has("") || falsy.has("") || [...truthy].some((token) => falsy.has(token))) {
        throw new LegacyMappingConfigurationError("Οι τιμές ΝΑΙ και ΟΧΙ για το πεδίο «" + field.targetField + "» πρέπει να είναι διαφορετικές.");
      }
    } else if (field.valueMap || field.trueValues || field.falseValues) {
      throw new LegacyMappingConfigurationError("Οι πρόσθετες αντιστοιχίσεις τιμών δεν εφαρμόζονται σε αυτόν τον τύπο μετατροπής.");
    }
  }

  if (mapping.targetType === "CONTACT") {
    if (!seenTargets.has("firstName") && !seenTargets.has("lastName") && !seenTargets.has("company")) {
      throw new LegacyMappingConfigurationError("Για επαφή αντιστοιχίστε τουλάχιστον ένα από τα όνομα, επώνυμο ή εταιρεία.");
    }
  } else {
    for (const required of ["listingType", "propertyType", "descriptionEl"]) {
      if (!seenTargets.has(required)) {
        throw new LegacyMappingConfigurationError("Για ακίνητο απαιτείται αντιστοίχιση του πεδίου «" + required + "».");
      }
    }
  }

  return mapping;
}

function parseNumber(value: string, transform: "NUMBER_DOT" | "NUMBER_COMMA"): number | undefined {
  const text = value.trim();
  if (!text) return undefined;

  if (transform === "NUMBER_DOT") {
    if (!/^[+-]?\d+(?:\.\d+)?$/.test(text)) return undefined;
    const result = Number(text);
    return Number.isFinite(result) ? result : undefined;
  }

  // Explicit European format: dot thousands separator, comma decimal separator.
  if (!/^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/.test(text)) return undefined;
  const result = Number(text.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(result) ? result : undefined;
}

function convertValue(
  value: string,
  field: LegacyImportMappingField,
): { value?: unknown; issue?: LegacyMappingIssue } {
  const raw = value.trim();
  if (!raw) return {};

  switch (field.transform) {
    case "TEXT":
      return { value: raw };
    case "EMAIL": {
      const normalized = raw.toLocaleLowerCase("en-US");
      if (normalized.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
        return { issue: { code: "INVALID_EMAIL", field: field.targetField, sourceHeader: field.sourceHeader, message: "Η τιμή δεν είναι έγκυρη διεύθυνση email." } };
      }
      return { value: normalized };
    }
    case "INTEGER": {
      if (!/^[+-]?\d+$/.test(raw)) {
        return { issue: { code: "INVALID_INTEGER", field: field.targetField, sourceHeader: field.sourceHeader, message: "Η τιμή πρέπει να είναι ακέραιος αριθμός." } };
      }
      const numeric = Number(raw);
      if (!Number.isSafeInteger(numeric)) {
        return { issue: { code: "INVALID_INTEGER", field: field.targetField, sourceHeader: field.sourceHeader, message: "Ο ακέραιος αριθμός είναι εκτός ορίων." } };
      }
      return { value: numeric };
    }
    case "NUMBER_DOT":
    case "NUMBER_COMMA": {
      const numeric = parseNumber(raw, field.transform);
      if (numeric === undefined) {
        return { issue: { code: "INVALID_NUMBER", field: field.targetField, sourceHeader: field.sourceHeader, message: "Η αριθμητική τιμή δεν ακολουθεί τη δηλωμένη μορφή." } };
      }
      return { value: numeric };
    }
    case "BOOLEAN_MAP": {
      const token = normalizeToken(raw);
      const trueValues = new Set((field.trueValues ?? []).map(normalizeToken));
      const falseValues = new Set((field.falseValues ?? []).map(normalizeToken));
      if (trueValues.has(token)) return { value: true };
      if (falseValues.has(token)) return { value: false };
      return { issue: { code: "UNMAPPED_BOOLEAN", field: field.targetField, sourceHeader: field.sourceHeader, message: "Η τιμή δεν περιλαμβάνεται στις δηλωμένες τιμές ΝΑΙ ή ΟΧΙ." } };
    }
    case "ENUM_MAP": {
      const token = normalizeToken(raw);
      const entry = Object.entries(field.valueMap ?? []).find(([key]) => normalizeToken(key) === token);
      if (!entry) {
        return { issue: { code: "UNMAPPED_ENUM", field: field.targetField, sourceHeader: field.sourceHeader, message: "Η τιμή δεν έχει αντιστοιχιστεί σε επιτρεπόμενη τιμή HOME88." } };
      }
      return { value: entry[1] };
    }
  }
}

/** Convert one encrypted source row's plaintext values into a validated preview object. */
export function mapLegacyImportRow(
  mapping: LegacyImportMapping,
  headers: readonly string[],
  values: readonly string[],
): LegacyMappedRow {
  const record: Record<string, unknown> = {};
  const issues: LegacyMappingIssue[] = [];

  for (const field of mapping.fields) {
    const index = headers.indexOf(field.sourceHeader);
    if (index < 0) {
      issues.push({ code: "SOURCE_HEADER_MISSING", field: field.targetField, sourceHeader: field.sourceHeader, message: "Η αρχική στήλη δεν υπάρχει πλέον στην παρτίδα." });
      continue;
    }
    const result = convertValue(values[index] ?? "", field);
    if (result.issue) issues.push(result.issue);
    else if (result.value !== undefined) record[field.targetField] = result.value;
  }

  if (mapping.targetType === "CONTACT") {
    if (![record.firstName, record.lastName, record.company].some((value) => typeof value === "string" && value.trim().length > 0)) {
      issues.push({ code: "CONTACT_IDENTITY_MISSING", message: "Απαιτείται όνομα, επώνυμο ή εταιρεία." });
    }
    for (const key of ["firstName", "lastName", "company", "phone", "mobile", "workPhone", "city", "postalCode", "taxId", "address"] as const) {
      const value = record[key];
      const definition = CONTACT_FIELDS.find((field) => field.key === key);
      if (typeof value === "string" && definition?.maxLength && value.length > definition.maxLength) {
        issues.push({ code: "TEXT_TOO_LONG", field: key, message: "Το κείμενο ξεπερνά το επιτρεπόμενο μήκος." });
      }
    }
  } else {
    const checked = propertyUpsertSchema.safeParse(record);
    if (!checked.success) {
      for (const issue of checked.error.issues) {
        issues.push({
          code: "PROPERTY_VALIDATION_FAILED",
          field: issue.path.length ? issue.path.join(".") : undefined,
          message: issue.message,
        });
      }
    } else {
      // Preview always describes a safe draft. Status, publication flags,
      // owner links, reference and agent assignments are deliberately not mappable.
      record.status = "DRAFT";
    }
  }

  return { record, issues };
}

export function legacyImportMappingOptions(targetType: LegacyImportTargetType) {
  return {
    targetType,
    mappingVersion: LEGACY_IMPORT_MAPPING_VERSION,
    fields: FIELDS[targetType].map((field) => ({
      key: field.key,
      label: field.label,
      kind: field.kind,
      required: Boolean(field.required),
      allowedValues: field.allowedValues ?? [],
    })),
  };
}
