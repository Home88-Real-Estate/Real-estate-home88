/** Shared helpers for server actions and their forms. */

export type ActionState = {
  ok: boolean;
  message?: string;
  fields?: Record<string, string[]>;
};

export const idleState: ActionState = { ok: false };

/** Non-empty, trimmed form value, or undefined so it is omitted from the payload. */
export function str(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function bool(formData: FormData, key: string): boolean {
  return formData.get(key) !== null;
}

const PROPERTY_STRING_FIELDS = [
  "reference",
  "listingType",
  "propertyType",
  "status",
  "condition",
  "heating",
  "energyClass",
  "titleEl",
  "titleEn",
  "descriptionEl",
  "descriptionEn",
  "region",
  "city",
  "areaName",
  "neighborhood",
  "address",
  "postalCode",
  "videoUrl",
  "virtualTourUrl",
] as const;

/**
 * Numbers are sent as strings: the API's zod schemas coerce numeric strings, and
 * sending an empty string as null would fight the `optional()` unions. An empty
 * input is simply omitted, leaving the server default or previous value in place.
 */
const PROPERTY_NUMBER_FIELDS = [
  "price",
  "monthlyRent",
  "area",
  "plotArea",
  "builtArea",
  "balconyArea",
  "bedrooms",
  "bathrooms",
  "wc",
  "floor",
  "totalFloors",
  "yearBuilt",
  "yearRenovated",
  "parkingSpaces",
  "latitude",
  "longitude",
  "commissionRatePct",
  "agentCommissionPct",
] as const;

const PROPERTY_BOOL_FIELDS = [
  "priceOnRequest",
  "hasSolar",
  "parking",
  "storage",
  "balcony",
  "garden",
  "pool",
  "furnished",
  "petsAllowed",
  "seaView",
  "newConstruction",
  "publishedOnWebsite",
  "featured",
] as const;

/** Builds the JSON payload for POST/PATCH /api/properties from a form. */
export function readPropertyForm(formData: FormData): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  for (const field of PROPERTY_STRING_FIELDS) {
    const value = str(formData, field);
    if (value !== undefined) payload[field] = value;
  }
  for (const field of PROPERTY_NUMBER_FIELDS) {
    const value = str(formData, field);
    if (value !== undefined) payload[field] = value;
  }
  for (const field of PROPERTY_BOOL_FIELDS) {
    payload[field] = bool(formData, field);
  }

  return payload;
}
