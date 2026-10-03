/**
 * Portal taxonomy mapping.
 *
 * A portal's categories and features are its own. Mappings are stored per portal
 * (`portal_mappings`) and consulted here; nothing about a particular portal's
 * vocabulary lives in property code. A property whose type has no mapping is
 * reported, never published under a guessed category, and a feature the portal
 * cannot carry is named in a warning rather than silently dropped.
 */

import type { PortalProperty } from "./types";
import type { ValidationIssue } from "./validation";

export type MappingKind = "TYPE" | "FEATURE";
/** `TRANSFORM` means the value is carried, but only after the adapter rewrites it. */
export type MappingStatus = "MAPPED" | "UNSUPPORTED" | "TRANSFORM";

export type MappingEntry = {
  kind: MappingKind;
  internalCode: string;
  status: MappingStatus;
  externalValue: string | null;
};

/** Stable feature codes, one per boolean on the canonical property. */
export const FEATURE_FLAGS = {
  PARKING: "parking",
  STORAGE: "storage",
  BALCONY: "balcony",
  GARDEN: "garden",
  POOL: "pool",
  FURNISHED: "furnished",
  PETS_ALLOWED: "petsAllowed",
  SEA_VIEW: "seaView",
  NEW_CONSTRUCTION: "newConstruction",
  SOLAR: "hasSolar",
} as const satisfies Record<string, keyof PortalProperty>;

export type FeatureCode = keyof typeof FEATURE_FLAGS;

export const FEATURE_LABELS: Record<FeatureCode, string> = {
  PARKING: "Parking",
  STORAGE: "Αποθήκη",
  BALCONY: "Μπαλκόνι",
  GARDEN: "Κήπος",
  POOL: "Πισίνα",
  FURNISHED: "Επιπλωμένο",
  PETS_ALLOWED: "Κατοικίδια",
  SEA_VIEW: "Θέα θάλασσα",
  NEW_CONSTRUCTION: "Νέα κατασκευή",
  SOLAR: "Ηλιακός",
};

export function propertyFeatureCodes(property: PortalProperty): FeatureCode[] {
  return (Object.keys(FEATURE_FLAGS) as FeatureCode[]).filter((code) => property[FEATURE_FLAGS[code]] === true);
}

export type MappingCheck = {
  /** False when the portal has no mappings at all; nothing is judged then. */
  configured: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

export function checkMappings(property: PortalProperty, entries: readonly MappingEntry[]): MappingCheck {
  if (entries.length === 0) return { configured: false, errors: [], warnings: [] };

  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const type = entries.find((e) => e.kind === "TYPE" && e.internalCode === property.propertyType);
  if (!type) {
    errors.push({ code: "UNSUPPORTED_PROPERTY_TYPE", field: "mapping", message: `Δεν υπάρχει αντιστοίχιση κατηγορίας για «${property.propertyType}»` });
  } else if (type.status === "UNSUPPORTED") {
    errors.push({ code: "UNSUPPORTED_PROPERTY_TYPE", field: "mapping", message: `Το portal δεν υποστηρίζει την κατηγορία «${property.propertyType}»` });
  } else if (!type.externalValue) {
    errors.push({ code: "UNSUPPORTED_PROPERTY_TYPE", field: "mapping", message: `Η αντιστοίχιση για «${property.propertyType}» δεν έχει τιμή portal` });
  }

  for (const code of propertyFeatureCodes(property)) {
    const entry = entries.find((e) => e.kind === "FEATURE" && e.internalCode === code);
    if (!entry || entry.status === "UNSUPPORTED" || !entry.externalValue) {
      warnings.push({
        code: "FEATURE_NOT_PUBLISHED",
        field: "mapping",
        message: `Το χαρακτηριστικό «${FEATURE_LABELS[code]}» δεν θα δημοσιευτεί στο portal`,
      });
    }
  }

  return { configured: true, errors, warnings };
}

/** Types and features with no entry yet, for the mapping screen. */
export function unmappedCodes(
  entries: readonly MappingEntry[],
  propertyTypes: readonly string[],
): { types: string[]; features: FeatureCode[] } {
  const has = (kind: MappingKind, code: string) => entries.some((e) => e.kind === kind && e.internalCode === code);
  return {
    types: propertyTypes.filter((t) => !has("TYPE", t)),
    features: (Object.keys(FEATURE_FLAGS) as FeatureCode[]).filter((f) => !has("FEATURE", f)),
  };
}
