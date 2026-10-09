/**
 * Website publication rules.
 *
 * WebsitePublication.status is the authoritative website state.
 * Property.publishedOnWebsite is a compatibility field that the publication
 * service derives from it (see `legacyPublishedFlag`); nothing else writes it.
 *
 * These pure functions are the tested source of truth for the machines that
 * must not drift:
 *   - the public-eligibility rule (`publicWebsiteWhere`) used by the website's
 *     queries, the sitemap and the enquiry gate;
 *   - the approved-media rule (`isPublicMedia`) used by every public response;
 *   - readiness (`evaluateWebsiteReadiness`), the server-side verdict the CRM
 *     panel shows and publish enforces;
 *   - lifecycle (`websiteStateForProperty`), what a change of the property's own
 *     status does to its publication;
 *   - backfill (`backfillWebsiteState`), which the migration mirrors;
 *   - sitemap eligibility (`websiteSitemapEligible`), derived, never trusted.
 */

import { isPublicStatus, PUBLIC_PROPERTY_STATUSES } from "./property-lifecycle";
import { listingProfileFor } from "./property-profiles";

/**
 * A publication in one of these states is on the public website. OUTDATED and
 * UPDATE_PENDING mean "live, but the stored hash is behind the content": the
 * page reads the property live, so the visitor sees current content either way.
 */
export const LIVE_WEBSITE_STATUSES = ["PUBLISHED", "OUTDATED", "UPDATE_PENDING"] as const;
export type LiveWebsiteStatus = (typeof LIVE_WEBSITE_STATUSES)[number];

export function isLiveWebsiteStatus(status: string): status is LiveWebsiteStatus {
  return (LIVE_WEBSITE_STATUSES as readonly string[]).includes(status);
}

/** A property is live on the public website when its publication is live and selected. */
export function isWebsiteLive(status: string, enabled: boolean): boolean {
  return enabled && isLiveWebsiteStatus(status);
}

/**
 * The compatibility flag, derived and never independently written: true exactly
 * when the publication is live. (Whether the property's own status is public is a
 * second, separate gate that every public reader applies.)
 */
export function legacyPublishedFlag(status: string, enabled: boolean): boolean {
  return isWebsiteLive(status, enabled);
}

/** Tags that keep a property off the public website. WEBSITE_ONLY only restricts portals. */
export const WEBSITE_BLOCKING_TAGS = ["DO_NOT_PUBLISH", "PORTAL_ONLY"] as const;

export const WEBSITE_TAG_REASONS: Readonly<Record<string, string>> = {
  DO_NOT_PUBLISH: "Το ακίνητο έχει σημανθεί «Να μην δημοσιευθεί πουθενά».",
  PORTAL_ONLY: "Το ακίνητο έχει σημανθεί «Μόνο σε portals» και δεν δημοσιεύεται στον ιστότοπο.",
};

export type PublicWebsiteWhere = {
  status: { in: Array<(typeof PUBLIC_PROPERTY_STATUSES)[number]> };
  websitePublication: {
    is: {
      enabled: true;
      status: { in: LiveWebsiteStatus[] };
      visibility: "PUBLIC" | { in: Array<"PUBLIC" | "NOINDEX"> };
    };
  };
  tagAssignments: { none: { tag: { code: { in: string[] } } } };
};

/**
 * THE rule for "this property is on the public website". The website's search,
 * featured, recent and area queries, its detail page, its sitemap and the
 * enquiry gate all take their `where` from here, so they cannot disagree.
 *
 *  - the property's own status is public (ACTIVE / UNDER_OFFER / RESERVED);
 *  - its publication is selected and live;
 *  - it carries no tag that keeps it off the website;
 *  - `listed: true` (search, featured, recent, areas, counts) additionally needs
 *    PUBLIC visibility; the detail page also serves NOINDEX (a direct link that
 *    search engines are told to skip). PRIVATE is never served.
 *
 * A property with no publication row is simply not published.
 */
export function publicWebsiteWhere(options: { listed?: boolean } = {}): PublicWebsiteWhere {
  return {
    status: { in: [...PUBLIC_PROPERTY_STATUSES] },
    websitePublication: {
      is: {
        enabled: true,
        status: { in: [...LIVE_WEBSITE_STATUSES] },
        visibility: options.listed ? "PUBLIC" : { in: ["PUBLIC", "NOINDEX"] },
      },
    },
    tagAssignments: { none: { tag: { code: { in: [...WEBSITE_BLOCKING_TAGS] } } } },
  };
}

// --- Media -----------------------------------------------------------------------------------------

export const PUBLIC_MEDIA_STATUSES = ["approved", "published"] as const;

/**
 * Whether a media row may appear in a public response: approved by staff, usable
 * (not uploading, quarantined, rejected or deleted), and not a document. Every
 * public mapper and the CRM preview use this one definition.
 */
export function isPublicMedia(media: { status: string; lifecycle?: string | null; kind: string }): boolean {
  return (
    (PUBLIC_MEDIA_STATUSES as readonly string[]).includes(media.status) &&
    (media.lifecycle ?? "AVAILABLE") === "AVAILABLE" &&
    media.kind !== "DOCUMENT"
  );
}

// --- Public representation -----------------------------------------------------------------------

/**
 * The property fields the public website may show. The web app's Prisma selects
 * must stay inside this list (a test enforces it), and the content hash and the
 * CRM preview are built from exactly these.
 *
 * Never here: owner or contact identity, tax or ID data, internal notes,
 * commission, legal files, agent contact details, credentials, private storage
 * keys, audit data.
 */
export const PUBLIC_PROPERTY_FIELDS = [
  "reference", "slug", "listingType", "propertyType", "status", "titleEl", "titleEn", "descriptionEl", "descriptionEn",
  "city", "areaName", "neighborhood", "price", "priceOnRequest", "monthlyRent", "area", "plotArea", "bedrooms", "bathrooms",
  "floor", "totalFloors", "yearBuilt", "yearRenovated", "condition", "heating", "energyClass", "newConstruction", "featured",
  "parking", "storage", "balcony", "garden", "pool", "furnished", "petsAllowed", "seaView", "hasSolar",
  "latitude", "longitude", "videoUrl", "virtualTourUrl",
] as const;

/** Fields that must never reach a public response, whatever else changes. */
export const FORBIDDEN_PUBLIC_FIELDS = [
  "ownerId", "agentId", "createdById", "updatedById", "internalNotes", "notes", "commissionRatePct", "agentCommissionPct",
  "commissionAmount", "details", "address", "postalCode", "ownerName", "ownerPhone", "ownerEmail", "taxId",
] as const;

export type PublicPropertySource = Record<string, unknown>;

export type PublicMediaSource = {
  id?: string;
  status: string;
  lifecycle?: string | null;
  kind: string;
  isPrimary: boolean;
  sortOrder: number;
  altEl?: string | null;
  altEn?: string | null;
  storageKey?: string;
};

/**
 * The public representation of a property: allow-listed fields plus the approved
 * media in display order. Deterministic, so its hash only changes when something
 * a visitor can see changes. Media is identified by id and order, never by a
 * storage key or URL.
 */
export function publicWebsiteView(property: PublicPropertySource, media: readonly PublicMediaSource[]) {
  const fields: Record<string, unknown> = {};
  for (const key of PUBLIC_PROPERTY_FIELDS) {
    const value = property[key];
    if (value === undefined || value === null) fields[key] = null;
    // Prisma Decimals (price, area, coordinates) become their exact decimal string so the hash is stable.
    else if (typeof value === "object" && !(value instanceof Date)) fields[key] = String(value);
    else fields[key] = value;
  }
  const photos = media
    .filter(isPublicMedia)
    .slice()
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.sortOrder - b.sortOrder)
    .map((m) => ({ id: m.id ?? null, kind: m.kind, primary: m.isPrimary, altEl: m.altEl ?? null, altEn: m.altEn ?? null }));
  return { fields, media: photos };
}

// --- Readiness -------------------------------------------------------------------------------------

export type WebsiteRules = {
  minPhotosToPublish?: number | null;
  requireEnglishDescription?: boolean | null;
  requireEnergyClass?: boolean | null;
};

export type WebsiteReadinessInput = {
  propertyStatus: string;
  tagCodes: readonly string[];
  listingType: string;
  titleEl: string | null;
  titleEn: string | null;
  descriptionEl: string | null;
  descriptionEn: string | null;
  price: unknown;
  monthlyRent: unknown;
  priceOnRequest: boolean;
  energyClass: string | null;
  publicPhotoCount: number;
  rules?: WebsiteRules;
};

export type WebsiteReadiness = { outcome: "READY" | "BLOCKED"; blockers: string[]; warnings: string[] };

const blank = (v: string | null | undefined) => !v || v.trim().length === 0;
const positive = (v: unknown) => {
  const n = Number(String(v ?? ""));
  return Number.isFinite(n) && n > 0;
};

/**
 * The server's verdict on whether the property can go on the website now. The
 * office's own publication settings (minimum photos, English description, energy
 * class) apply when configured; their absence adds no rule of its own.
 */
export function evaluateWebsiteReadiness(input: WebsiteReadinessInput): WebsiteReadiness {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const rules = input.rules ?? {};

  if (!isPublicStatus(input.propertyStatus)) {
    blockers.push("Το ακίνητο πρέπει να είναι Ενεργό, Υπό προσφορά ή Δεσμευμένο για να εμφανιστεί στον ιστότοπο.");
  }
  for (const code of WEBSITE_BLOCKING_TAGS) {
    if (input.tagCodes.includes(code)) blockers.push(WEBSITE_TAG_REASONS[code]!);
  }
  if (blank(input.titleEl)) blockers.push("Λείπει ο τίτλος (ελληνικά).");
  if (blank(input.descriptionEl)) blockers.push("Λείπει η περιγραφή (ελληνικά).");

  const priceField = listingProfileFor(input.listingType).priceField;
  if (!input.priceOnRequest && !positive(priceField === "monthlyRent" ? input.monthlyRent : input.price)) {
    blockers.push(priceField === "monthlyRent" ? "Λείπει το μηνιαίο μίσθωμα (ή «Τιμή κατόπιν αιτήματος»)." : "Λείπει η τιμή (ή «Τιμή κατόπιν αιτήματος»).");
  }

  const minPhotos = Math.max(0, Math.floor(Number(rules.minPhotosToPublish ?? 0)) || 0);
  if (minPhotos > 0 && input.publicPhotoCount < minPhotos) {
    blockers.push(`Απαιτούνται τουλάχιστον ${minPhotos} εγκεκριμένες φωτογραφίες (υπάρχουν ${input.publicPhotoCount}).`);
  } else if (input.publicPhotoCount === 0) {
    warnings.push("Δεν υπάρχει εγκεκριμένη φωτογραφία· η σελίδα θα εμφανιστεί χωρίς εικόνα.");
  }

  const englishMissing = blank(input.titleEn) || blank(input.descriptionEn);
  if (englishMissing) {
    if (rules.requireEnglishDescription) blockers.push("Απαιτείται αγγλικός τίτλος και περιγραφή.");
    else warnings.push("Λείπει ο αγγλικός τίτλος ή η περιγραφή.");
  }
  if (!input.energyClass || input.energyClass === "NOT_AVAILABLE") {
    if (rules.requireEnergyClass) blockers.push("Απαιτείται ενεργειακή κλάση.");
    else warnings.push("Δεν έχει δηλωθεί ενεργειακή κλάση.");
  }

  return { outcome: blockers.length === 0 ? "READY" : "BLOCKED", blockers, warnings };
}

// --- Lifecycle ----------------------------------------------------------------------------------------

export const WEBSITE_OPERATIONS = ["VALIDATE", "PREVIEW", "PUBLISH", "UPDATE", "UNPUBLISH"] as const;
export type WebsiteOperation = (typeof WEBSITE_OPERATIONS)[number];

/** What the panel may offer for the website, from its state alone (permissions are applied separately). */
export function websiteActionsFor(status: string, enabled: boolean): Record<"validate" | "preview" | "publish" | "update" | "unpublish", boolean> {
  const live = isWebsiteLive(status, enabled);
  return {
    validate: true,
    preview: true,
    publish: !live,
    update: live,
    unpublish: live || status === "PAUSED" || status === "FAILED",
  };
}

export type WebsiteStateChange = { status: string; enabled: boolean; reason: string } | null;

/**
 * What a change of the property's own status does to its publication. The
 * current public-site policy is preserved: only ACTIVE, UNDER_OFFER and RESERVED
 * are public, so
 *   - SOLD / RENTED take a live page down (the publication records SOLD / RENTED
 *     and keeps its selection, so reopening brings the page back as it always did);
 *   - ARCHIVED / DELETED take it down and clear the selection (as before);
 *   - reopening to a public status restores a page that was taken down only by
 *     SOLD / RENTED, or that the backfill carried over as selected;
 *   - everything else (INACTIVE, DRAFT, moves between public statuses) changes
 *     nothing: the public gate hides what it must.
 * Returns null when nothing changes.
 */
export function websiteStateForProperty(current: { status: string; enabled: boolean }, newPropertyStatus: string, blocked: boolean): WebsiteStateChange {
  const live = isWebsiteLive(current.status, current.enabled);

  if (newPropertyStatus === "SOLD" || newPropertyStatus === "RENTED") {
    return live ? { status: newPropertyStatus, enabled: current.enabled, reason: `property_${newPropertyStatus.toLowerCase()}` } : null;
  }
  if (newPropertyStatus === "ARCHIVED" || newPropertyStatus === "DELETED") {
    if (current.status === "ARCHIVED" && !current.enabled) return null;
    if (!live && !current.enabled) return null;
    return { status: "ARCHIVED", enabled: false, reason: `property_${newPropertyStatus.toLowerCase()}` };
  }
  if (isPublicStatus(newPropertyStatus)) {
    const restorable = current.enabled && (current.status === "SOLD" || current.status === "RENTED" || current.status === "DRAFT");
    if (restorable && !blocked) return { status: "PUBLISHED", enabled: true, reason: "property_reopened" };
  }
  return null;
}

/** What adding a blocking tag does to a live page: it comes down (and stays selected = false). */
export function websiteStateForTags(current: { status: string; enabled: boolean }, tagCodes: readonly string[]): WebsiteStateChange {
  const blockedBy = WEBSITE_BLOCKING_TAGS.find((code) => tagCodes.includes(code));
  if (!blockedBy) return null;
  if (!isWebsiteLive(current.status, current.enabled)) return null;
  return { status: "UNPUBLISHED", enabled: false, reason: `tag_${blockedBy.toLowerCase()}` };
}

// --- Backfill and sitemap ------------------------------------------------------------------------------

/**
 * The backfill rule: map a legacy Property row onto a WebsitePublication.
 *
 * - published AND public property status → PUBLISHED (the page stays live).
 * - published but NOT a public property status → DRAFT with enabled retained:
 *   do NOT invent a public page the current system considers non-public. Such
 *   rows are flagged needsReview, never silently published.
 * - not published → DRAFT, disabled.
 */
export function backfillWebsiteState(publishedOnWebsite: boolean, propertyStatus: string) {
  const publicEligible = publishedOnWebsite && isPublicStatus(propertyStatus);
  return {
    status: publicEligible ? "PUBLISHED" : "DRAFT",
    enabled: publishedOnWebsite,
    noIndex: !publicEligible,
    sitemapIncluded: publicEligible,
    visibility: publicEligible ? "PUBLIC" : "NOINDEX",
    needsReview: publishedOnWebsite && !isPublicStatus(propertyStatus),
  };
}

/**
 * Server-derived sitemap inclusion. Every input must be satisfied, and it is
 * recomputed from the publication's state: the stored `sitemapIncluded` column
 * is a cache the service keeps for display, never read to decide.
 */
export function websiteSitemapEligible(input: {
  status: string;
  enabled: boolean;
  visibility: string;
  noIndex: boolean;
  propertyStatus: string;
  tagCodes?: readonly string[];
}): boolean {
  return (
    isWebsiteLive(input.status, input.enabled) &&
    input.visibility === "PUBLIC" &&
    !input.noIndex &&
    isPublicStatus(input.propertyStatus) &&
    !(input.tagCodes ?? []).some((code) => (WEBSITE_BLOCKING_TAGS as readonly string[]).includes(code))
  );
}
