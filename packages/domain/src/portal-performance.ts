/**
 * Measured portal performance, from HOME88's own records only.
 *
 * Sources that exist: leads attributed to a portal or the website (with their
 * viewings, offers and closed transactions), and the publication event history,
 * which says how long each listing was live. Sources that do not: portal views,
 * clicks and cost. Those are reported as unavailable, never as zero.
 *
 * Rates are per listing-week (enquiries from a portal that carries 500 listings
 * are not comparable to one that carries 5), are shown only above a minimum
 * exposure, and always carry their sample and window. Nothing here says a portal
 * caused a sale: attribution is the lead's recorded source.
 */

export const PERFORMANCE_CHANNELS = ["WEBSITE", "SPITOGATOS", "XE_GR", "PORTAL_OTHER"] as const;

/** Minimum listing-weeks of exposure before a rate is shown. Below it the numbers are counts only. */
export const MIN_LISTING_WEEKS = 20;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const UNAVAILABLE_METRICS = [
  "Προβολές αγγελίας στο portal",
  "Κλικ και επαφές μέσα στο portal",
  "Κόστος ανά επαφή (δεν υπάρχουν επιβεβαιωμένα κόστη καταχώρησης)",
] as const;

const LIVE_PORTAL = ["PUBLISHED", "OUTDATED", "IN_FEED"];
const LIVE_WEBSITE = ["PUBLISHED", "OUTDATED", "UPDATE_PENDING"];

export type ExposureEvent = {
  propertyId: string;
  listingType: string;
  /** Portal code, or "WEBSITE". */
  channel: string;
  createdAt: Date;
  /** State after the event: the portal's or the website's. */
  state: string | null;
};

/**
 * Listing-weeks live per (channel, listing type) inside the window, from the
 * event history. An interval opens when a state becomes live and closes when it
 * stops being live (or at the window end). `observedFrom` is the first event we
 * hold: exposure before it is unknown, so the effective window starts there.
 */
export function computeExposure(events: readonly ExposureEvent[], window: { from: Date; to: Date }): { weeks: Map<string, number>; observedFrom: Date | null } {
  const sorted = [...events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const observedFrom = sorted[0]?.createdAt ?? null;
  const start = observedFrom && observedFrom > window.from ? observedFrom : window.from;
  const open = new Map<string, { since: Date; listingType: string; channel: string }>();
  const ms = new Map<string, number>();
  const add = (channel: string, listingType: string, from: Date, to: Date) => {
    const a = Math.max(from.getTime(), start.getTime());
    const b = Math.min(to.getTime(), window.to.getTime());
    if (b > a) ms.set(`${channel}|${listingType}`, (ms.get(`${channel}|${listingType}`) ?? 0) + (b - a));
  };
  for (const e of sorted) {
    if (e.state === null) continue; // an event that records no state change (validate, preview) says nothing about exposure
    const key = `${e.channel}|${e.propertyId}`;
    const live = (e.channel === "WEBSITE" ? LIVE_WEBSITE : LIVE_PORTAL).includes(e.state);
    const cur = open.get(key);
    if (live && !cur) open.set(key, { since: e.createdAt, listingType: e.listingType, channel: e.channel });
    else if (!live && cur) { add(cur.channel, cur.listingType, cur.since, e.createdAt); open.delete(key); }
  }
  for (const cur of open.values()) add(cur.channel, cur.listingType, cur.since, window.to);
  return { weeks: new Map([...ms].map(([k, v]) => [k, v / WEEK_MS])), observedFrom };
}

export type LeadOutcome = {
  channel: string;
  listingType: string;
  status: string;
  viewings: number;
  offers: number;
  closed: number;
};

export type PerformanceRow = {
  channel: string;
  listingType: string;
  listingWeeks: number;
  enquiries: number;
  qualified: number;
  viewings: number;
  offers: number;
  closedTransactions: number;
  /** Enquiries per listing-week; null when exposure is below the minimum or unknown. */
  enquiriesPerListingWeek: number | null;
  qualifiedPerListingWeek: number | null;
  /** Why a rate is absent. */
  note: string | null;
};

const QUALIFIED = ["QUALIFIED", "VIEWING", "OFFER", "WON"];

export function buildPerformance(outcomes: readonly LeadOutcome[], weeks: ReadonlyMap<string, number>): PerformanceRow[] {
  const rows = new Map<string, PerformanceRow>();
  const row = (channel: string, listingType: string): PerformanceRow => {
    const k = `${channel}|${listingType}`;
    let r = rows.get(k);
    if (!r) { r = { channel, listingType, listingWeeks: weeks.get(k) ?? 0, enquiries: 0, qualified: 0, viewings: 0, offers: 0, closedTransactions: 0, enquiriesPerListingWeek: null, qualifiedPerListingWeek: null, note: null }; rows.set(k, r); }
    return r;
  };
  for (const k of weeks.keys()) { const [c, t] = k.split("|"); row(c!, t!); }
  for (const o of outcomes) {
    const r = row(o.channel, o.listingType);
    r.enquiries += 1;
    if (QUALIFIED.includes(o.status)) r.qualified += 1;
    r.viewings += o.viewings;
    r.offers += o.offers;
    r.closedTransactions += o.closed;
  }
  for (const r of rows.values()) {
    r.listingWeeks = Math.round(r.listingWeeks * 10) / 10;
    if (r.channel === "PORTAL_OTHER") r.note = "Επαφές από «άλλο portal»: δεν αποδίδονται σε συγκεκριμένο portal, άρα δεν υπολογίζεται ρυθμός.";
    else if (r.listingWeeks === 0) r.note = "Δεν υπάρχουν δεδομένα έκθεσης (αγγελίες που δημοσιεύθηκαν πριν την καταγραφή ιστορικού δεν μετρούν).";
    else if (r.listingWeeks < MIN_LISTING_WEEKS) r.note = `Ανεπαρκές δείγμα: ${r.listingWeeks} εβδομάδες έκθεσης (ελάχιστο ${MIN_LISTING_WEEKS}). Εμφανίζονται μόνο πλήθη.`;
    else {
      r.enquiriesPerListingWeek = Math.round((r.enquiries / r.listingWeeks) * 100) / 100;
      r.qualifiedPerListingWeek = Math.round((r.qualified / r.listingWeeks) * 100) / 100;
    }
  }
  const order = (c: string) => PERFORMANCE_CHANNELS.indexOf(c as never);
  return [...rows.values()].sort((a, b) => order(a.channel) - order(b.channel) || a.listingType.localeCompare(b.listingType));
}
