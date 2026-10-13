/**
 * Distribution insights: actionable queues (counts that open the affected
 * properties) and measured performance by destination. Everything is read from
 * HOME88's own records; nothing is estimated, and what cannot be measured is
 * listed as unavailable.
 */

import {
  PUBLIC_PROPERTY_STATUSES,
  UNAVAILABLE_METRICS,
  buildPerformance,
  channelOf,
  computeExposure,
  type ExposureEvent,
  type LeadOutcome,
} from "@home88/domain";
import type { Prisma } from "@prisma/client";

import { db } from "./prisma";

/** A table the running code expects but the database has not been migrated to yet (Prisma P2021). */
export function isMissingTable(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2021";
}

/** Counts a table that may not exist yet: null means "unavailable", never zero. */
async function countIfAvailable(run: () => Promise<number>): Promise<number | null> {
  try {
    return await run();
  } catch (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
}

const LIVE_LISTING = ["PUBLISHED", "OUTDATED", "IN_FEED"] as const;
const PHOTO = { kind: "PHOTO" as const, status: { in: ["approved", "published"] } };
const LEAD_CAP = 20000;
const EVENT_CAP = 100000;

/** The property filters the queues use, shared with the workspace so a count and its list always agree. */
export function missingWhere(kind: string): Prisma.PropertyWhereInput | null {
  switch (kind) {
    case "photos": return { media: { none: PHOTO } };
    case "english": return { OR: [{ titleEn: null }, { titleEn: "" }, { descriptionEn: null }, { descriptionEn: "" }] };
    case "price": return { price: null, priceOnRequest: false };
    default: return null;
  }
}

const onMarket: Prisma.PropertyWhereInput = { status: { in: [...PUBLIC_PROPERTY_STATUSES] } };

export type Queue = { key: string; label: string; count: number | null; href: string | null; hint: string };

export async function loadQueues(): Promise<Queue[]> {
  const week = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [noPortal, issues, photos, english, price, failedItems, openBatches] = await Promise.all([
    db().property.count({ where: { AND: [onMarket, { portalListings: { none: { state: { in: [...LIVE_LISTING] } } } }] } }),
    db().property.count({ where: { portalListings: { some: { OR: [{ state: "FAILED" }, { needsReview: true }] } } } }),
    db().property.count({ where: { AND: [onMarket, missingWhere("photos")!] } }),
    db().property.count({ where: { AND: [onMarket, missingWhere("english")!] } }),
    db().property.count({ where: { AND: [onMarket, missingWhere("price")!] } }),
    countIfAvailable(() => db().portalDistributionItem.count({ where: { status: "FAILED", finishedAt: { gte: week } } })),
    countIfAvailable(() => db().portalDistributionBatch.count({ where: { status: { in: ["QUEUED", "RUNNING"] } } })),
  ]);
  return [
    { key: "no-portal", label: "Στην αγορά, σε κανένα portal", count: noPortal, href: "/distribution/properties?statusGroup=PUBLIC&portalState=NONE", hint: "Ακίνητα στην αγορά χωρίς δημοσιευμένη αγγελία σε portal." },
    { key: "portal-issues", label: "Σφάλμα ή έλεγχος σε portal", count: issues, href: "/distribution/properties?portalState=ISSUES", hint: "Αγγελίες που απέτυχαν ή περιμένουν έλεγχο." },
    { key: "missing-photos", label: "Στην αγορά χωρίς εγκεκριμένη φωτογραφία", count: photos, href: "/distribution/properties?statusGroup=PUBLIC&missing=photos", hint: "Χωρίς φωτογραφία δεν μπορούν να σταλούν σε portals." },
    { key: "missing-english", label: "Στην αγορά χωρίς αγγλικό τίτλο ή περιγραφή", count: english, href: "/distribution/properties?statusGroup=PUBLIC&missing=english", hint: "Χρειάζεται για portals εξωτερικού." },
    { key: "missing-price", label: "Στην αγορά χωρίς τιμή", count: price, href: "/distribution/properties?statusGroup=PUBLIC&missing=price", hint: "Η τιμή είναι υποχρεωτική στα περισσότερα portals." },
    { key: "failed-items", label: "Αποτυχημένες μαζικές ενέργειες (7 ημέρες)", count: failedItems, href: null, hint: "Ανοίξτε την αντίστοιχη μαζική ενέργεια για επανάληψη." },
    { key: "open-batches", label: "Μαζικές ενέργειες σε εξέλιξη", count: openBatches, href: null, hint: "Προχωρούν όσο η σελίδα διανομής είναι ανοιχτή." },
  ];
}

export async function loadPerformance(days: number) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

  const rawEvents = await db().channelPublicationEvent.findMany({
    where: { createdAt: { lte: to }, OR: [{ channelType: "WEBSITE" }, { channelType: "PORTAL", portalId: { not: null } }] },
    orderBy: { createdAt: "asc" },
    take: EVENT_CAP,
    select: { propertyId: true, channelType: true, createdAt: true, websiteState: true, portalState: true, ok: true, action: true, portal: { select: { code: true } }, property: { select: { listingType: true } } },
  });
  const events: ExposureEvent[] = rawEvents
    // Validate and preview record no change in what is live.
    .filter((e) => e.action !== "VALIDATE" && e.action !== "PREVIEW" && e.action !== "PREPARE")
    .map((e) => ({
      propertyId: e.propertyId,
      listingType: e.property.listingType,
      channel: e.channelType === "WEBSITE" ? "WEBSITE" : e.portal!.code,
      createdAt: e.createdAt,
      state: e.channelType === "WEBSITE" ? e.websiteState : e.portalState,
    }));
  const exposure = computeExposure(events, { from, to });

  const leads = await db().lead.findMany({
    where: { createdAt: { gte: from, lte: to }, propertyId: { not: null } },
    take: LEAD_CAP,
    orderBy: { createdAt: "desc" },
    select: {
      id: true, source: true, status: true, sourcePortalId: true, propertyId: true,
      property: { select: { listingType: true } },
      viewings: { where: { status: "COMPLETED" }, select: { id: true } },
      offers: { select: { id: true } },
      transactions: { where: { status: "CLOSED" }, select: { id: true } },
    },
  });
  const portalCodes = new Map((await db().portal.findMany({ select: { id: true, code: true } })).map((p) => [p.id, p.code]));
  const propertyTypes = new Map((await db().property.findMany({ where: { id: { in: [...new Set(leads.map((l) => l.propertyId!))] } }, select: { id: true, listingType: true } })).map((p) => [p.id, p.listingType]));
  const outcomes: LeadOutcome[] = leads.map((l) => {
    // A recorded portal is the precise source; otherwise the lead's source decides, as the CRM reports it.
    const recorded = l.sourcePortalId ? portalCodes.get(l.sourcePortalId) : undefined;
    const channel = recorded && ["XE_GR", "SPITOGATOS"].includes(recorded) ? recorded : channelOf(l.source) === "WEBSITE" ? "WEBSITE" : l.source === "SPITOGATOS" || l.source === "XE_GR" || l.source === "PORTAL_OTHER" ? l.source : recorded ? "PORTAL_OTHER" : "DIRECT";
    return { channel, listingType: propertyTypes.get(l.propertyId!) ?? "SALE", status: l.status, viewings: l.viewings.length, offers: l.offers.length, closed: l.transactions.length };
  }).filter((o) => o.channel !== "DIRECT"); // phone, walk-ins and so on are not distribution channels

  return {
    window: { from: from.toISOString(), to: to.toISOString(), days },
    observedFrom: exposure.observedFrom?.toISOString() ?? null,
    rows: buildPerformance(outcomes, exposure.weeks),
    sample: { leads: leads.length, leadCap: LEAD_CAP, truncated: leads.length >= LEAD_CAP, events: rawEvents.length, eventCap: EVENT_CAP },
    unavailable: UNAVAILABLE_METRICS,
    definitions: {
      enquiries: "Επαφές (leads) με ακίνητο, που δημιουργήθηκαν στο διάστημα, με πηγή το portal ή τον ιστότοπο.",
      qualified: "Επαφές που έφτασαν σε κατάσταση «Αξιολογημένος» ή πιο πέρα (προβολή, προσφορά, κερδισμένο).",
      viewings: "Ολοκληρωμένες υποδείξεις των επαφών αυτών.",
      offers: "Προσφορές που συνδέονται με τις επαφές αυτές.",
      closedTransactions: "Συναλλαγές σε κατάσταση «Κλεισμένη» που συνδέονται με τις επαφές αυτές.",
      listingWeeks: "Εβδομάδες που οι αγγελίες ήταν ζωντανές, από το ιστορικό δημοσιεύσεων.",
      attribution: "Η πηγή είναι αυτή που καταγράφηκε στην επαφή. Δεν αποδεικνύει ότι το portal προκάλεσε το αποτέλεσμα.",
    },
  };
}
