import assert from "node:assert/strict";
import { test } from "node:test";

import {
  categoryOf,
  channelOf,
  CHANNEL_LEAD_SOURCES,
  CATEGORY_PROPERTY_TYPES,
  lastMonths,
  localDay,
  resolveRange,
  zonedTime,
} from "./index";

const iso = (d: Date) => d.toISOString();

test("every property type and lead source belongs to exactly one group", () => {
  const types = Object.values(CATEGORY_PROPERTY_TYPES).flat();
  assert.equal(new Set(types).size, types.length);
  const sources = Object.values(CHANNEL_LEAD_SOURCES).flat();
  assert.equal(new Set(sources).size, sources.length);
  assert.equal(categoryOf("VILLA"), "RESIDENTIAL");
  assert.equal(categoryOf("SHOP"), "COMMERCIAL");
  assert.equal(categoryOf("PLOT"), "LAND");
  assert.equal(categoryOf("SOMETHING_NEW"), "OTHER");
  assert.equal(channelOf("PROPERTY_ENQUIRY"), "WEBSITE");
  assert.equal(channelOf("XE_GR"), "PORTAL");
  assert.equal(channelOf("PHONE"), "DIRECT");
});

test("Athens local midnight in summer (UTC+3) and winter (UTC+2)", () => {
  assert.equal(iso(zonedTime(2026, 10, 2)), "2026-10-01T21:00:00.000Z");
  assert.equal(iso(zonedTime(2026, 1, 15)), "2026-01-14T22:00:00.000Z");
  // Rolls over: month 0 is December of the previous year.
  assert.equal(iso(zonedTime(2026, 0, 1)), "2025-11-30T22:00:00.000Z");
});

test("presets start at the local start of their period and end now", () => {
  const now = new Date("2026-10-02T09:30:00Z"); // Friday, 12:30 in Athens
  assert.equal(iso(resolveRange({ key: "today" }, now).from), "2026-10-01T21:00:00.000Z");
  assert.equal(iso(resolveRange({ key: "week" }, now).from), "2026-09-27T21:00:00.000Z"); // Mon 28 Sep
  assert.equal(iso(resolveRange({ key: "month" }, now).from), "2026-09-30T21:00:00.000Z");
  assert.equal(iso(resolveRange({ key: "quarter" }, now).from), "2026-09-30T21:00:00.000Z");
  assert.equal(iso(resolveRange({ key: "year" }, now).from), "2025-12-31T22:00:00.000Z");
  assert.equal(iso(resolveRange({ key: "month" }, now).to), iso(now));
});

test("the previous period is the same length, immediately before", () => {
  const now = new Date("2026-10-02T09:30:00Z");
  const range = resolveRange({ key: "week" }, now);
  assert.equal(range.previousTo.getTime(), range.from.getTime());
  assert.equal(range.to.getTime() - range.from.getTime(), range.previousTo.getTime() - range.previousFrom.getTime());
});

test("a week that spans the spring DST change still starts at local Monday midnight", () => {
  const now = new Date("2026-03-29T12:00:00Z"); // Sunday, after clocks went forward
  assert.equal(iso(resolveRange({ key: "week" }, now).from), "2026-03-22T22:00:00.000Z");
  assert.equal(iso(resolveRange({ key: "today" }, now).from), "2026-03-28T22:00:00.000Z");
});

test("custom ranges cover whole local days, inclusive", () => {
  const now = new Date("2026-10-02T09:30:00Z");
  const range = resolveRange({ key: "custom", from: "2026-09-01", to: "2026-09-30" }, now);
  assert.equal(range.key, "custom");
  assert.equal(iso(range.from), "2026-08-31T21:00:00.000Z");
  assert.equal(iso(range.to), "2026-09-30T21:00:00.000Z");
});

test("invalid input falls back to the current month", () => {
  const now = new Date("2026-10-02T09:30:00Z");
  for (const input of [
    { key: "nonsense" },
    { key: "custom", from: "2026-02-30", to: "2026-03-01" },
    { key: "custom", from: "2026-09-30", to: "2026-09-01" },
    { key: "custom", from: "2010-01-01", to: "2026-01-01" },
    {},
  ]) {
    const range = resolveRange(input, now);
    assert.equal(range.key, "month", JSON.stringify(input));
  }
});

test("twelve month buckets end with the current month and tile without gaps", () => {
  const months = lastMonths(new Date("2026-10-02T09:30:00Z"));
  assert.equal(months.length, 12);
  assert.equal(months[0]!.key, "2025-11");
  assert.equal(months[11]!.key, "2026-10");
  for (let i = 1; i < months.length; i += 1) {
    assert.equal(months[i]!.from.getTime(), months[i - 1]!.to.getTime());
  }
  // March 2026 starts in winter time, April in summer time.
  const march = months.find((m) => m.key === "2026-03")!;
  assert.equal(iso(march.from), "2026-02-28T22:00:00.000Z");
  assert.equal(iso(march.to), "2026-03-31T21:00:00.000Z");
});

test("local day boundaries", () => {
  const day = localDay(new Date("2026-10-02T22:30:00Z")); // 01:30 on 3 Oct in Athens
  assert.equal(iso(day.from), "2026-10-02T21:00:00.000Z");
  assert.equal(iso(day.to), "2026-10-03T21:00:00.000Z");
});

test("datetime-local values are read as Athens time, both ways", async () => {
  const { parseLocalDateTime, toLocalDateTimeInput } = await import("./date-range");
  // Summer (UTC+3) and winter (UTC+2).
  assert.equal(parseLocalDateTime("2026-07-15T10:30")!.toISOString(), "2026-07-15T07:30:00.000Z");
  assert.equal(parseLocalDateTime("2026-12-15T10:30")!.toISOString(), "2026-12-15T08:30:00.000Z");
  assert.equal(toLocalDateTimeInput(new Date("2026-12-15T08:30:00Z")), "2026-12-15T10:30");
  assert.equal(parseLocalDateTime("15/12/2026 10:30"), null);
  assert.equal(parseLocalDateTime("2026-13-01T10:00"), null);
});
