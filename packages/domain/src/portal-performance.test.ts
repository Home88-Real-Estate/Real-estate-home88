import assert from "node:assert/strict";
import { test } from "node:test";

import { MIN_LISTING_WEEKS, buildPerformance, computeExposure, type ExposureEvent, type LeadOutcome } from "./portal-performance";

const d = (s: string) => new Date(s);
const ev = (propertyId: string, channel: string, at: string, state: string | null, listingType = "SALE"): ExposureEvent => ({ propertyId, listingType, channel, createdAt: d(at), state });
const WINDOW = { from: d("2026-01-01"), to: d("2026-04-01") }; // 90 days

test("exposure counts only the time a listing was live, per channel and listing type", () => {
  const { weeks, observedFrom } = computeExposure(
    [
      ev("p1", "XE_GR", "2026-01-01T00:00:00Z", "PUBLISHED"),
      ev("p1", "XE_GR", "2026-01-15T00:00:00Z", "REMOVED"), // 2 weeks
      ev("p2", "XE_GR", "2026-03-18T00:00:00Z", "PUBLISHED"), // still live: 2 weeks to the window end
      ev("p1", "SPITOGATOS", "2026-02-01T00:00:00Z", "PUBLISHED", "RENT"), // 8.57 weeks to the end
      ev("p1", "XE_GR", "2026-02-02T00:00:00Z", null), // a preview records no state
    ],
    WINDOW,
  );
  assert.equal(observedFrom?.toISOString(), "2026-01-01T00:00:00.000Z");
  assert.ok(Math.abs(weeks.get("XE_GR|SALE")! - 4) < 0.01);
  assert.ok(Math.abs(weeks.get("SPITOGATOS|RENT")! - 8.43) < 0.1);
});

test("exposure before the first recorded event is unknown, so the window starts there", () => {
  const { weeks } = computeExposure([ev("p1", "XE_GR", "2026-03-01T00:00:00Z", "PUBLISHED")], WINDOW);
  assert.ok(Math.abs(weeks.get("XE_GR|SALE")! - 4.43) < 0.1, "30 days, not 90");
});

test("a failed state stops the clock and the website uses its own live states", () => {
  const { weeks } = computeExposure(
    [ev("p1", "XE_GR", "2026-01-01T00:00:00Z", "PUBLISHED"), ev("p1", "XE_GR", "2026-01-08T00:00:00Z", "FAILED"), ev("p1", "WEBSITE", "2026-01-01T00:00:00Z", "UPDATE_PENDING"), ev("p1", "WEBSITE", "2026-01-22T00:00:00Z", "UNPUBLISHED")],
    WINDOW,
  );
  assert.ok(Math.abs(weeks.get("XE_GR|SALE")! - 1) < 0.01);
  assert.ok(Math.abs(weeks.get("WEBSITE|SALE")! - 3) < 0.01);
});

const outcome = (channel: string, status: string, extra: Partial<LeadOutcome> = {}): LeadOutcome => ({ channel, listingType: "SALE", status, viewings: 0, offers: 0, closed: 0, ...extra });

test("rates need a minimum exposure; below it only counts show, with the reason", () => {
  const rows = buildPerformance([outcome("XE_GR", "NEW"), outcome("XE_GR", "VIEWING", { viewings: 1 })], new Map([["XE_GR|SALE", MIN_LISTING_WEEKS - 1]]));
  const r = rows[0]!;
  assert.deepEqual([r.enquiries, r.qualified, r.viewings], [2, 1, 1]);
  assert.equal(r.enquiriesPerListingWeek, null);
  assert.match(r.note ?? "", /Ανεπαρκές δείγμα/);
});

test("with enough exposure the rate is per listing-week, and zero enquiries is a real zero", () => {
  const rows = buildPerformance([outcome("XE_GR", "WON", { offers: 1, closed: 1 }), outcome("XE_GR", "NEW")], new Map([["XE_GR|SALE", 40], ["SPITOGATOS|SALE", 40]]));
  const xe = rows.find((r) => r.channel === "XE_GR")!;
  assert.deepEqual([xe.enquiriesPerListingWeek, xe.qualifiedPerListingWeek, xe.closedTransactions], [0.05, 0.03, 1]);
  const sp = rows.find((r) => r.channel === "SPITOGATOS")!;
  assert.deepEqual([sp.enquiries, sp.enquiriesPerListingWeek], [0, 0], "measured exposure with no enquiries is a measured zero");
});

test("enquiries with no exposure data are not turned into a rate; 'other portal' is never a rate", () => {
  const rows = buildPerformance([outcome("XE_GR", "NEW"), outcome("PORTAL_OTHER", "NEW")], new Map([["PORTAL_OTHER|SALE", 100]]));
  assert.equal(rows.find((r) => r.channel === "XE_GR")!.enquiriesPerListingWeek, null);
  assert.match(rows.find((r) => r.channel === "XE_GR")!.note ?? "", /δεδομένα έκθεσης/);
  assert.equal(rows.find((r) => r.channel === "PORTAL_OTHER")!.enquiriesPerListingWeek, null);
});
