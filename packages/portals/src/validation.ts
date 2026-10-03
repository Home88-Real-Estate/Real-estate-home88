/**
 * Portal-specific validation.
 *
 * A profile lists what a portal needs. The baseline below is only what every
 * feed this repository generates already relies on; it is not a claim about any
 * provider's contract. Requirements a provider confirms are added through
 * `Portal.settings.validation` (see `profileFromSettings`) rather than guessed
 * here, so a profile can differ per portal without touching code.
 */

import { sortMedia } from "./media";
import type { PortalProperty } from "./types";

export type RequiredField =
  | "title"
  | "description"
  | "price"
  | "photo"
  | "propertyType"
  | "city"
  | "area"
  | "bedrooms"
  | "energyClass"
  | "coordinates"
  | "englishTitle"
  | "englishDescription"
  | "virtualTour";

export const REQUIRED_FIELD_LABELS: Record<RequiredField, string> = {
  title: "Τίτλος",
  description: "Περιγραφή",
  price: "Τιμή",
  photo: "Κύρια φωτογραφία",
  propertyType: "Τύπος ακινήτου",
  city: "Πόλη",
  area: "Εμβαδόν",
  bedrooms: "Υπνοδωμάτια",
  energyClass: "Ενεργειακή κλάση",
  coordinates: "Συντεταγμένες",
  englishTitle: "Τίτλος στα αγγλικά",
  englishDescription: "Περιγραφή στα αγγλικά",
  virtualTour: "Virtual tour",
};

export type ValidationProfile = {
  required: RequiredField[];
  /** Soft requirements: reported as warnings, they do not block publication. */
  recommended: RequiredField[];
  minPhotos: number;
  maxPhotos: number | null;
  maxTitleLength: number | null;
  maxDescriptionLength: number | null;
  /** Where the profile came from, so the UI never presents a guess as a contract. */
  source: "BASELINE" | "CONFIGURED";
};

export const BASELINE_PROFILE: ValidationProfile = {
  required: ["title", "description", "price", "photo", "propertyType"],
  recommended: ["city", "area"],
  minPhotos: 1,
  maxPhotos: null,
  maxTitleLength: null,
  maxDescriptionLength: null,
  source: "BASELINE",
};

const FIELD_KEYS = new Set(Object.keys(REQUIRED_FIELD_LABELS));

function fieldList(value: unknown, fallback: RequiredField[]): RequiredField[] {
  if (!Array.isArray(value)) return fallback;
  return value.filter((v): v is RequiredField => typeof v === "string" && FIELD_KEYS.has(v));
}

function limit(value: unknown, fallback: number | null): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

/** Reads `settings.validation`; anything absent keeps the baseline. */
export function profileFromSettings(settings: Record<string, unknown> | null | undefined): ValidationProfile {
  const raw = settings?.validation;
  // `requirePhoto: false` predates profiles; honour it so existing portals keep working.
  const photoOptional = settings?.requirePhoto === false;
  if (!raw || typeof raw !== "object") {
    return photoOptional
      ? { ...BASELINE_PROFILE, required: BASELINE_PROFILE.required.filter((f) => f !== "photo"), minPhotos: 0, source: "CONFIGURED" }
      : BASELINE_PROFILE;
  }
  const v = raw as Record<string, unknown>;
  return {
    required: fieldList(v.required, BASELINE_PROFILE.required).filter((f) => !(photoOptional && f === "photo")),
    recommended: fieldList(v.recommended, BASELINE_PROFILE.recommended),
    minPhotos: photoOptional ? 0 : (limit(v.minPhotos, BASELINE_PROFILE.minPhotos) ?? BASELINE_PROFILE.minPhotos),
    maxPhotos: limit(v.maxPhotos, null),
    maxTitleLength: limit(v.maxTitleLength, null),
    maxDescriptionLength: limit(v.maxDescriptionLength, null),
    source: "CONFIGURED",
  };
}

export type ValidationIssue = { code: string; field: RequiredField | "media" | "length" | "mapping"; message: string };

export type ValidationResult = {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

/** A portal fetches images over HTTP; it cannot reach localhost, a private host or a relative path. */
export function isPublicHttpsUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return false;
  }
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return false;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
      return false;
    }
  }
  return true;
}

function presence(property: PortalProperty, field: RequiredField): boolean {
  switch (field) {
    case "title":
      return property.titleEl.trim().length > 0;
    case "description":
      return property.descriptionEl.trim().length > 0;
    case "price":
      return property.priceOnRequest || (property.price !== null && property.price > 0);
    case "photo":
      return property.media.some((m) => m.kind === "PHOTO" && m.url.length > 0);
    case "propertyType":
      return property.propertyType.length > 0;
    case "city":
      return Boolean(property.city?.trim());
    case "area":
      return property.area !== null && property.area > 0;
    case "bedrooms":
      return property.bedrooms !== null;
    case "energyClass":
      return property.energyClass.length > 0 && property.energyClass !== "UNKNOWN" && property.energyClass !== "NOT_AVAILABLE";
    case "coordinates":
      return property.latitude !== null && property.longitude !== null;
    case "englishTitle":
      return Boolean(property.titleEn?.trim());
    case "englishDescription":
      return Boolean(property.descriptionEn?.trim());
    case "virtualTour":
      return Boolean(property.virtualTourUrl) || property.media.some((m) => m.kind === "VIRTUAL_TOUR");
  }
}

export function validateForPortal(property: PortalProperty, profile: ValidationProfile): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  for (const field of profile.required) {
    if (!presence(property, field)) {
      errors.push({ code: "MISSING_REQUIRED_FIELD", field, message: `Λείπει: ${REQUIRED_FIELD_LABELS[field]}` });
    }
  }
  for (const field of profile.recommended) {
    if (!profile.required.includes(field) && !presence(property, field)) {
      warnings.push({ code: "MISSING_RECOMMENDED_FIELD", field, message: `Προτείνεται: ${REQUIRED_FIELD_LABELS[field]}` });
    }
  }

  const photos = sortMedia(property.media).filter((m) => m.kind === "PHOTO");
  if (photos.length > 0 && photos.length < profile.minPhotos) {
    errors.push({ code: "MISSING_REQUIRED_FIELD", field: "media", message: `Απαιτούνται τουλάχιστον ${profile.minPhotos} φωτογραφίες` });
  }
  if (profile.maxPhotos !== null && photos.length > profile.maxPhotos) {
    warnings.push({ code: "MEDIA_OVER_LIMIT", field: "media", message: `Οι φωτογραφίες (${photos.length}) υπερβαίνουν το όριο ${profile.maxPhotos}· θα σταλούν οι πρώτες ${profile.maxPhotos}` });
  }
  // Only the photos that would actually be sent need to be reachable.
  const sent = profile.maxPhotos === null ? photos : photos.slice(0, profile.maxPhotos);
  if (sent.some((m) => !isPublicHttpsUrl(m.url))) {
    errors.push({ code: "IMAGE_UNAVAILABLE", field: "media", message: "Οι φωτογραφίες δεν έχουν δημόσιο HTTPS URL" });
  }

  if (profile.maxTitleLength !== null && property.titleEl.length > profile.maxTitleLength) {
    errors.push({ code: "FIELD_TOO_LONG", field: "length", message: `Ο τίτλος υπερβαίνει τους ${profile.maxTitleLength} χαρακτήρες` });
  }
  if (profile.maxDescriptionLength !== null && property.descriptionEl.length > profile.maxDescriptionLength) {
    errors.push({ code: "FIELD_TOO_LONG", field: "length", message: `Η περιγραφή υπερβαίνει τους ${profile.maxDescriptionLength} χαρακτήρες` });
  }

  return { valid: errors.length === 0, errors, warnings };
}
