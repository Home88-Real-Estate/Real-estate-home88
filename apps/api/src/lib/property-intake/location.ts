/**
 * Where the property is, as the agent recorded it (GPS on site, a pin on the map
 * or typed coordinates), and how much of that the public may see.
 *
 * The exact point stays in the intake session, which only the agent and the CRM
 * read. The property's own latitude/longitude are what the website and portals
 * show, so they receive only what the chosen visibility allows:
 *  - exact: the point itself;
 *  - approximate: the point snapped to a grid of about 500 m, so the building
 *    cannot be read from it;
 *  - private: nothing (the street address is never published either way).
 */

export type LocationVisibility = "exact" | "approximate" | "private";
export type LocationSource = "gps" | "map" | "manual";
export type IntakeLocation = {
  lat: number;
  lng: number;
  /** Metres, as reported by the device; null when typed or pinned. */
  accuracy: number | null;
  source: LocationSource;
  visibility: LocationVisibility;
  capturedAt: string;
};

/** Grid step in degrees: about 550 m north–south and 440 m east–west in Greece. */
export const APPROXIMATE_STEP = 0.005;

const VISIBILITIES: LocationVisibility[] = ["exact", "approximate", "private"];
const SOURCES: LocationSource[] = ["gps", "map", "manual"];

const round7 = (n: number) => Math.round(n * 1e7) / 1e7;
const snap = (n: number) => round7(Math.round(n / APPROXIMATE_STEP) * APPROXIMATE_STEP);

export function validCoordinates(lat: unknown, lng: unknown): lat is number {
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

/** Defensive read of the stored JSON: anything malformed is no location. */
export function readLocation(raw: unknown): IntakeLocation | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<IntakeLocation>;
  if (!validCoordinates(r.lat, r.lng)) return null;
  return {
    lat: round7(r.lat as number),
    lng: round7(r.lng as number),
    accuracy: typeof r.accuracy === "number" && Number.isFinite(r.accuracy) && r.accuracy >= 0 ? Math.round(r.accuracy) : null,
    source: SOURCES.includes(r.source as LocationSource) ? (r.source as LocationSource) : "manual",
    visibility: VISIBILITIES.includes(r.visibility as LocationVisibility) ? (r.visibility as LocationVisibility) : "approximate",
    capturedAt: typeof r.capturedAt === "string" ? r.capturedAt : new Date(0).toISOString(),
  };
}

/** The coordinates the property record (and so the website and portals) may carry. */
export function publicCoordinates(location: IntakeLocation | null): { latitude: number; longitude: number } | null {
  if (!location || location.visibility === "private") return null;
  if (location.visibility === "exact") return { latitude: round7(location.lat), longitude: round7(location.lng) };
  return { latitude: snap(location.lat), longitude: snap(location.lng) };
}

export const VISIBILITY_LABEL: Record<LocationVisibility, string> = {
  exact: "Ακριβής θέση στον ιστότοπο",
  approximate: "Κατά προσέγγιση (~500 μ.) στον ιστότοπο",
  private: "Μόνο για το γραφείο",
};
