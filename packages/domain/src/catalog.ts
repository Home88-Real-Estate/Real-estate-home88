/**
 * Groupings the dashboard, lists and reports share, so a "residential"
 * property or a "portal" lead means the same thing everywhere.
 */

export const PROPERTY_CATEGORIES = ["RESIDENTIAL", "COMMERCIAL", "LAND", "OTHER"] as const;
export type PropertyCategory = (typeof PROPERTY_CATEGORIES)[number];

/** Property types per category (brief §10: ΚΑΤΟΙΚΙΕΣ / ΕΠΑΓΓΕΛΜΑΤΙΚΑ / ΟΙΚΟΠΕΔΑ-ΓΗ). */
export const CATEGORY_PROPERTY_TYPES: Readonly<Record<PropertyCategory, readonly string[]>> = {
  RESIDENTIAL: ["APARTMENT", "MAISONETTE", "HOUSE", "VILLA", "STUDIO"],
  COMMERCIAL: ["OFFICE", "SHOP", "WAREHOUSE", "BUILDING", "HOTEL", "INDUSTRIAL"],
  LAND: ["LAND", "PLOT"],
  OTHER: ["PARKING", "OTHER"],
};

export function isPropertyCategory(value: string): value is PropertyCategory {
  return (PROPERTY_CATEGORIES as readonly string[]).includes(value);
}

export function categoryOf(propertyType: string): PropertyCategory {
  for (const category of PROPERTY_CATEGORIES) {
    if (CATEGORY_PROPERTY_TYPES[category].includes(propertyType)) return category;
  }
  return "OTHER";
}

/** Where a lead came from, at the level a manager reports on. */
export const LEAD_CHANNELS = ["WEBSITE", "PORTAL", "DIRECT"] as const;
export type LeadChannel = (typeof LEAD_CHANNELS)[number];

export const CHANNEL_LEAD_SOURCES: Readonly<Record<LeadChannel, readonly string[]>> = {
  WEBSITE: ["WEBSITE", "PROPERTY_ENQUIRY"],
  PORTAL: ["SPITOGATOS", "XE_GR", "PORTAL_OTHER"],
  DIRECT: ["PHONE", "WHATSAPP", "EMAIL", "WALK_IN", "REFERRAL", "SOCIAL", "IMPORT", "OTHER"],
};

export function isLeadChannel(value: string): value is LeadChannel {
  return (LEAD_CHANNELS as readonly string[]).includes(value);
}

export function channelOf(source: string): LeadChannel {
  for (const channel of LEAD_CHANNELS) {
    if (CHANNEL_LEAD_SOURCES[channel].includes(source)) return channel;
  }
  return "DIRECT";
}

/** Lead stages in pipeline order; the funnel reads left to right. */
export const LEAD_PIPELINE_STAGES = ["NEW", "CONTACTED", "QUALIFIED", "VIEWING", "OFFER", "WON"] as const;
/** Stages that end a lead without a deal. */
export const LEAD_LOST_STAGES = ["LOST", "NOT_INTERESTED"] as const;
/** Stages in which a lead still needs work. */
export const LEAD_OPEN_STAGES = ["NEW", "CONTACTED", "QUALIFIED", "VIEWING", "OFFER"] as const;
