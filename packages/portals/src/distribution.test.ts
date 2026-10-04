import assert from "node:assert/strict";
import { test } from "node:test";

import {
  availableActions,
  buildPublicationPreview,
  capabilitiesFor,
  checkMappings,
  evaluatePublicationRule,
  guardPublicationChange,
  isPublicHttpsUrl,
  NO_CAPABILITIES,
  parseConditions,
  profileFromSettings,
  BASELINE_PROFILE,
  spitogatosAdapter,
  manualAdapter,
  validateForPortal,
  guardConfigFromSettings,
  type MappingEntry,
  type PublicationRule,
} from "./index";
import { makePortalProperty } from "./test-fixtures";

const ALL: PublicationRule = { mode: "ALL_WEBSITE" };

// --- capabilities ---------------------------------------------------------------

test("a catalogue entry with no adapter has no capabilities", () => {
  assert.deepEqual(capabilitiesFor("XML_FEED", null), NO_CAPABILITIES);
});

test("a feed portal pulls and withdraws by omission but cannot delete or push", () => {
  const caps = capabilitiesFor("XML_FEED", spitogatosAdapter);
  assert.equal(caps.pull, true);
  assert.equal(caps.unpublish, true);
  assert.equal(caps.delete, false);
  assert.equal(caps.push, false);
  assert.equal(caps.incrementalSync, false);
});

test("an API transport claims nothing until an adapter declares it", () => {
  const caps = capabilitiesFor("API", { ...spitogatosAdapter, transport: "API" });
  assert.deepEqual(caps, NO_CAPABILITIES);
  const declared = capabilitiesFor("API", { ...spitogatosAdapter, transport: "API", capabilities: { push: true, create: true } });
  assert.equal(declared.push, true);
  assert.equal(declared.delete, false);
});

test("actions follow capabilities and status", () => {
  const feed = capabilitiesFor("XML_FEED", spitogatosAdapter);
  assert.ok(!availableActions(feed, "ACTIVE").includes("delete"), "no delete without provider support");
  assert.ok(!availableActions(feed, "ACTIVE").includes("testConnection"), "no connection test for a pull feed");
  assert.ok(availableActions(feed, "CONFIGURED").includes("syncNow"));
  assert.ok(!availableActions(feed, "NOT_CONFIGURED").includes("syncNow"), "no sync before configuration");
  assert.ok(!availableActions(feed, "DISABLED").includes("syncNow"));
  assert.deepEqual(availableActions(NO_CAPABILITIES, "PLANNED"), ["viewLogs"]);
  const manual = capabilitiesFor("MANUAL", manualAdapter);
  assert.ok(!availableActions(manual, "ACTIVE").includes("syncNow"));
  assert.ok(availableActions({ ...NO_CAPABILITIES, delete: true, push: true }, "ACTIVE").includes("delete"));
});

// --- publication rules ----------------------------------------------------------

test("DO_NOT_PUBLISH and WEBSITE_ONLY override any rule", () => {
  const p = makePortalProperty();
  assert.equal(evaluatePublicationRule(p, [], ALL).selected, true);
  for (const tag of ["DO_NOT_PUBLISH", "WEBSITE_ONLY"]) {
    const v = evaluatePublicationRule(p, [tag], ALL);
    assert.equal(v.selected, false);
    assert.match(v.reasons[0]!, new RegExp(tag));
  }
});

test("mode NONE selects nothing and says why", () => {
  const v = evaluatePublicationRule(makePortalProperty(), [], { mode: "NONE" });
  assert.deepEqual(v, { selected: false, reasons: ["no publication rule"] });
  assert.equal(evaluatePublicationRule(makePortalProperty(), [], null).selected, false);
});

test("BY_TYPE and BY_TAG match on stable codes", () => {
  const p = makePortalProperty({ propertyType: "VILLA" });
  assert.equal(evaluatePublicationRule(p, [], { mode: "BY_TYPE", propertyTypes: ["VILLA"] }).selected, true);
  assert.equal(evaluatePublicationRule(p, [], { mode: "BY_TYPE", propertyTypes: ["APARTMENT"] }).selected, false);
  assert.equal(evaluatePublicationRule(p, [], { mode: "BY_TYPE", propertyTypes: [] }).selected, false);
  assert.equal(evaluatePublicationRule(p, ["EXCLUSIVE"], { mode: "BY_TAG", includeTags: ["EXCLUSIVE"] }).selected, true);
  assert.equal(evaluatePublicationRule(p, [], { mode: "BY_TAG", includeTags: ["EXCLUSIVE"] }).selected, false);
  assert.equal(evaluatePublicationRule(p, ["EXCLUSIVE", "COOPERATION"], { mode: "BY_TAG", includeTags: ["EXCLUSIVE"], excludeTags: ["COOPERATION"] }).selected, false);
});

test("conditions narrow the rule and a missing price cannot pass a price floor", () => {
  const rule: PublicationRule = { mode: "ALL_WEBSITE", conditions: { listingTypes: ["SALE"], minPrice: 500000, cities: ["Γλυφάδα"] } };
  const rich = makePortalProperty({ price: 900000, city: "Γλυφάδα" });
  assert.equal(evaluatePublicationRule(rich, [], rule).selected, true);
  const v = evaluatePublicationRule(makePortalProperty({ price: 250000, city: "Καλλιθέα", listingType: "RENT" }), [], rule);
  assert.deepEqual(v.reasons.sort(), ["city not selected", "listing type rent not selected", "price below minimum"].sort());
  assert.equal(evaluatePublicationRule(makePortalProperty({ price: null, priceOnRequest: true, city: "Γλυφάδα" }), [], rule).selected, false);
});

test("parseConditions drops malformed input instead of trusting it", () => {
  assert.equal(parseConditions(null), null);
  assert.equal(parseConditions("x"), null);
  const c = parseConditions({ minPrice: "5", maxPrice: 10, listingTypes: ["SALE", 3], cities: "no" })!;
  assert.equal(c.minPrice, null);
  assert.equal(c.maxPrice, 10);
  assert.deepEqual(c.listingTypes, ["SALE"]);
  assert.equal(c.cities, undefined);
});

// --- validation -----------------------------------------------------------------

test("baseline validation passes a complete property", () => {
  const r = validateForPortal(makePortalProperty(), BASELINE_PROFILE);
  assert.equal(r.valid, true);
  assert.deepEqual(r.errors, []);
});

test("a missing price, description and photo are each reported", () => {
  const r = validateForPortal(
    makePortalProperty({ price: null, descriptionEl: " ", media: [] }),
    BASELINE_PROFILE,
  );
  assert.equal(r.valid, false);
  assert.deepEqual(r.errors.map((e) => e.field).sort(), ["description", "photo", "price"]);
});

test("profiles come from portal settings and differ per portal", () => {
  const strict = profileFromSettings({ validation: { required: ["price", "photo", "city", "virtualTour", "bogus"], maxPhotos: 2 } });
  assert.equal(strict.source, "CONFIGURED");
  assert.deepEqual(strict.required, ["price", "photo", "city", "virtualTour"]);
  const r = validateForPortal(makePortalProperty(), strict);
  assert.deepEqual(r.errors.map((e) => e.field), ["virtualTour"]);
  assert.equal(profileFromSettings(null), BASELINE_PROFILE);
  assert.equal(profileFromSettings({ validation: "nope" }), BASELINE_PROFILE);
});

test("photo limits warn, but unreachable image URLs block", () => {
  const photos = [1, 2, 3].map((n) => ({ kind: "PHOTO" as const, url: `https://cdn.home88.gr/${n}.jpg`, alt: null, sortOrder: n, isPrimary: n === 1 }));
  const limited = profileFromSettings({ validation: { maxPhotos: 2 } });
  const r = validateForPortal(makePortalProperty({ media: photos }), limited);
  assert.equal(r.valid, true);
  assert.equal(r.warnings.some((w) => w.code === "MEDIA_OVER_LIMIT"), true);

  const bad = [{ kind: "PHOTO" as const, url: "http://localhost:3000/a.jpg", alt: null, sortOrder: 0, isPrimary: true }];
  const blocked = validateForPortal(makePortalProperty({ media: bad }), BASELINE_PROFILE);
  assert.equal(blocked.valid, false);
  assert.equal(blocked.errors[0]!.code, "IMAGE_UNAVAILABLE");
  // A photo beyond the limit is never sent, so its URL does not matter.
  const beyond = [photos[0]!, photos[1]!, { ...photos[2]!, url: "http://127.0.0.1/x.jpg" }];
  assert.equal(validateForPortal(makePortalProperty({ media: beyond }), limited).valid, true);
});

test("only public https hosts count as reachable by a portal", () => {
  for (const ok of ["https://cdn.home88.gr/a.jpg", "https://8.8.8.8/a.jpg", "https://172.32.0.1/a.jpg"]) {
    assert.equal(isPublicHttpsUrl(ok), true, ok);
  }
  for (const bad of [
    "http://cdn.home88.gr/a.jpg",
    "/media/a.jpg",
    "https://localhost/a.jpg",
    "https://app.localhost/a.jpg",
    "https://127.0.0.1/a.jpg",
    "https://10.1.2.3/a.jpg",
    "https://172.16.0.1/a.jpg",
    "https://192.168.1.1/a.jpg",
    "https://169.254.169.254/latest",
    "https://[::1]/a.jpg",
    "https://db.internal/a.jpg",
    "",
  ]) {
    assert.equal(isPublicHttpsUrl(bad), false, bad);
  }
});

// --- mapping --------------------------------------------------------------------

const TYPES: MappingEntry[] = [
  { kind: "TYPE", internalCode: "APARTMENT", status: "MAPPED", externalValue: "apartment" },
  { kind: "TYPE", internalCode: "HOTEL", status: "UNSUPPORTED", externalValue: null },
  { kind: "FEATURE", internalCode: "PARKING", status: "MAPPED", externalValue: "parking" },
];

test("with no mappings configured nothing is judged", () => {
  assert.deepEqual(checkMappings(makePortalProperty(), []), { configured: false, errors: [], warnings: [] });
});

test("an unmapped or unsupported type is an error, never a guess", () => {
  assert.equal(checkMappings(makePortalProperty(), TYPES).errors.length, 0);
  assert.equal(checkMappings(makePortalProperty({ propertyType: "VILLA" }), TYPES).errors[0]!.code, "UNSUPPORTED_PROPERTY_TYPE");
  assert.match(checkMappings(makePortalProperty({ propertyType: "HOTEL" }), TYPES).errors[0]!.message, /δεν υποστηρίζει/);
  const noValue = TYPES.map((e) => (e.internalCode === "APARTMENT" ? { ...e, externalValue: null } : e));
  assert.equal(checkMappings(makePortalProperty(), noValue).errors.length, 1);
});

test("a feature the portal cannot carry is named, not silently dropped", () => {
  const p = makePortalProperty({ parking: true, storage: true, balcony: false, petsAllowed: false, hasSolar: false });
  const warnings = checkMappings(p, TYPES).warnings;
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!.message, /Αποθήκη/);
});

// --- safety ---------------------------------------------------------------------

test("a large drop is blocked", () => {
  const v = guardPublicationChange(412, 38);
  assert.equal(v.blocked, true);
  assert.equal(v.kind, "DROP");
  assert.match(v.message!, /412 → 38/);
});

test("an empty feed is blocked, with or without a baseline, even for a small book", () => {
  assert.equal(guardPublicationChange(5, 0).blocked, true);
  assert.equal(guardPublicationChange(null, 0).blocked, true);
  assert.equal(guardPublicationChange(0, 0).blocked, false, "nothing to protect");
});

test("ordinary change passes; first publication has no baseline to compare", () => {
  assert.equal(guardPublicationChange(100, 80).blocked, false);
  assert.equal(guardPublicationChange(100, 70).blocked, false, "exactly at the limit");
  assert.equal(guardPublicationChange(100, 69).blocked, true);
  assert.equal(guardPublicationChange(null, 400).blocked, false);
  assert.equal(guardPublicationChange(8, 3).blocked, false, "small book may swing");
});

test("a surge warns without blocking", () => {
  const v = guardPublicationChange(100, 250);
  assert.equal(v.blocked, false);
  assert.equal(v.surge, true);
});

test("guard thresholds are configurable and sanitised", () => {
  const cfg = guardConfigFromSettings({ publicationGuard: { maxDropPercent: 10, surgePercent: "x" } });
  assert.equal(cfg.maxDropPercent, 10);
  assert.equal(cfg.surgePercent, 100);
  assert.equal(guardPublicationChange(100, 85, cfg).blocked, true);
  assert.equal(guardConfigFromSettings({ publicationGuard: { maxDropPercent: 500 } }).maxDropPercent, 100);
});

// --- preview --------------------------------------------------------------------

function candidates() {
  return [
    { property: makePortalProperty({ reference: "H88-1" }), tagCodes: [] },
    { property: makePortalProperty({ reference: "H88-2", price: null }), tagCodes: [] },
    { property: makePortalProperty({ reference: "H88-3", media: [] }), tagCodes: [] },
    { property: makePortalProperty({ reference: "H88-4" }), tagCodes: ["DO_NOT_PUBLISH"] },
    { property: makePortalProperty({ reference: "H88-5", status: "SOLD" }), tagCodes: [] },
    { property: makePortalProperty({ reference: "H88-6", listingType: "ASSIGNMENT" }), tagCodes: [] },
  ];
}

test("preview separates ready, cannot-publish and not-selected, with reasons", () => {
  const r = buildPublicationPreview({
    candidates: candidates(),
    adapter: spitogatosAdapter,
    rule: ALL,
    profile: BASELINE_PROFILE,
    mappings: [],
    allowAssignment: false,
    previousCount: null,
  });
  assert.equal(r.total, 6);
  assert.equal(r.ready, 1);
  assert.equal(r.blocked, 2);
  assert.equal(r.notSelected, 3);
  assert.equal(r.selected, 3);
  assert.equal(r.expectedCount, 1);
  assert.equal(r.mappingConfigured, false);
  assert.equal(r.guard.blocked, false);

  const byRef = Object.fromEntries(r.items.map((i) => [i.reference, i]));
  assert.equal(byRef["H88-1"]!.outcome, "READY");
  assert.deepEqual(byRef["H88-2"]!.reasons, ["Λείπει: Τιμή"]);
  assert.deepEqual(byRef["H88-3"]!.reasons, ["Λείπει: Κύρια φωτογραφία"]);
  assert.equal(byRef["H88-4"]!.outcome, "NOT_SELECTED");
  assert.deepEqual(byRef["H88-5"]!.reasons, ["status sold"]);
  assert.deepEqual(byRef["H88-6"]!.reasons, ["assignment listings are not carried"]);
  assert.ok(r.reasonCounts.every((c) => c.count >= 1));
});

test("preview blocks publication when the set would collapse", () => {
  const r = buildPublicationPreview({
    candidates: candidates(),
    adapter: spitogatosAdapter,
    rule: ALL,
    profile: BASELINE_PROFILE,
    mappings: [],
    allowAssignment: true,
    previousCount: 412,
  });
  assert.equal(r.guard.blocked, true);
  assert.equal(r.guard.kind, "DROP");
});

test("preview applies mappings once configured", () => {
  const r = buildPublicationPreview({
    candidates: [{ property: makePortalProperty({ reference: "H88-9", propertyType: "VILLA" }), tagCodes: [] }],
    adapter: spitogatosAdapter,
    rule: ALL,
    profile: BASELINE_PROFILE,
    mappings: TYPES,
    allowAssignment: true,
    previousCount: null,
  });
  assert.equal(r.mappingConfigured, true);
  assert.equal(r.items[0]!.outcome, "BLOCKED");
  assert.equal(r.items[0]!.errors[0]!.code, "UNSUPPORTED_PROPERTY_TYPE");
});

test("an empty candidate set is refused rather than published", () => {
  const r = buildPublicationPreview({ candidates: [], rule: ALL, profile: BASELINE_PROFILE, mappings: [], allowAssignment: true, previousCount: null });
  assert.equal(r.guard.blocked, true);
  assert.equal(r.guard.kind, "EMPTY");
});

test("legacy requirePhoto:false still lets a photo-less listing through", () => {
  const profile = profileFromSettings({ requirePhoto: false });
  assert.equal(validateForPortal(makePortalProperty({ media: [] }), profile).valid, true);
  assert.equal(validateForPortal(makePortalProperty({ media: [] }), BASELINE_PROFILE).valid, false);
});

// --- provider contract ---------------------------------------------------------

import { checkProviderContract, type PortalProvider } from "./index";

test("a provider that claims what it does not implement is caught", () => {
  const base: PortalProvider = { code: "FAKE", schemaVersion: "1", capabilities: { ...NO_CAPABILITIES, push: true, create: true, update: true } };
  const problems = checkProviderContract({ ...base, testConnection: async () => ({ ok: true, acknowledged: true }) });
  assert.deepEqual(problems.sort(), ["claims create but has no publishProperty", "claims update but has no updateProperty"]);
  assert.deepEqual(
    checkProviderContract({
      ...base,
      testConnection: async () => ({ ok: true, acknowledged: true }),
      publishProperty: async () => ({ ok: true, acknowledged: false }),
      updateProperty: async () => ({ ok: true, acknowledged: false }),
    }),
    [],
  );
  assert.ok(checkProviderContract({ ...base, capabilities: { ...NO_CAPABILITIES, push: true } }).includes("an API provider must implement testConnection"));
  assert.ok(checkProviderContract({ ...base, schemaVersion: "" }).includes("missing schemaVersion"));
});
