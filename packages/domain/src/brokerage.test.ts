import assert from "node:assert/strict";
import { test } from "node:test";

import {
  calculateDuration,
  calculateFee,
  canMoveShowing,
  detectCommissionAnomalies,
  detectLegacyLegalFlags,
  effectiveEndDate,
  EXCLUSIVE_CONFLICT_MESSAGE,
  formatShowingNumber,
  LEGACY_ESTATE_PLUS_TEMPLATES,
  parseShowingNumber,
  validateCommission,
  validateExclusiveConflict,
  validateMandate,
  validateOwnership,
  validatePaymentMilestones,
  validateShowing,
  type FeeTerms,
  type MandateValidationInput,
  type PartyFacts,
  type ShowingValidationInput,
  type TemplateCheck,
} from "./index";

const codes = (r: { blockingIssues: { code: string }[]; warnings: { code: string }[] }) => ({ blocking: r.blockingIssues.map((i) => i.code), warnings: r.warnings.map((i) => i.code) });

const goodFee: FeeTerms = { payer: "OWNER", method: "PERCENTAGE", basis: "FINAL_SALE_PRICE", percentage: 2, currency: "EUR", vatTreatment: "PLUS_VAT", vatRate: 24 };
const goodTemplate: TemplateCheck = { found: true, active: true, checksumValid: true };
const party = (over: Partial<PartyFacts> = {}): PartyFacts => ({ fullName: "Μαρία Παπαδοπούλου", isSignatory: true, hasTaxId: true, hasIdNumber: true, hasTaxOffice: true, hasAddress: true, hasPhone: true, hasEmail: true, identityVerified: true, ...over });

// ---- fees ------------------------------------------------------------------

test("fee percentage and fixed amount: calculated in cents, VAT plus / included / none", () => {
  assert.deepEqual(calculateFee(goodFee, 250_000), { net: 5000, vat: 1200, gross: 6200, currency: "EUR" });
  assert.deepEqual(calculateFee({ ...goodFee, method: "FIXED_AMOUNT", percentage: null, fixedAmount: 3000 }), { net: 3000, vat: 720, gross: 3720, currency: "EUR" });
  // VAT included: 6,200 gross contains 1,200 VAT at 24 %.
  assert.deepEqual(calculateFee({ ...goodFee, method: "FIXED_AMOUNT", percentage: null, fixedAmount: 6200, vatTreatment: "VAT_INCLUDED" }), { net: 5000, vat: 1200, gross: 6200, currency: "EUR" });
  assert.deepEqual(calculateFee({ ...goodFee, vatTreatment: "VAT_EXEMPT", vatRate: null }, 100_000), { net: 2000, vat: 0, gross: 2000, currency: "EUR" });
  // 2.5 % of 333.33 stays exact in cents.
  assert.equal(calculateFee({ ...goodFee, percentage: 2.5, vatTreatment: "NOT_APPLICABLE", vatRate: null }, 333.33)?.net, 8.33);
});

test("fee calculation never guesses: unknown VAT rate, base or method gives null", () => {
  assert.equal(calculateFee({ ...goodFee, vatRate: null }, 100_000), null);
  assert.equal(calculateFee({ ...goodFee, vatRate: null }, 100_000, 24)?.vat, 480, "the configured rate is used when the document has none");
  assert.equal(calculateFee(goodFee, null), null);
  assert.equal(calculateFee({ ...goodFee, method: "NEGOTIATED_LATER" }, 100_000), null);
  assert.equal(calculateFee({ ...goodFee, method: "CUSTOM" }, 100_000), null);
});

test("commission validation: bounds, one method at a time, VAT rate only where VAT applies", () => {
  assert.equal(validateCommission(goodFee).status, "READY");
  assert.ok(codes(validateCommission({ ...goodFee, percentage: 120 })).blocking.includes("FEE_PERCENTAGE_INVALID"));
  assert.ok(codes(validateCommission({ ...goodFee, percentage: -1 })).blocking.includes("FEE_PERCENTAGE_INVALID"));
  assert.ok(codes(validateCommission({ ...goodFee, method: "FIXED_AMOUNT", percentage: null, fixedAmount: -5 })).blocking.includes("FEE_FIXED_AMOUNT_INVALID"));
  assert.ok(codes(validateCommission({ ...goodFee, fixedAmount: 100 })).blocking.includes("FEE_METHOD_AMBIGUOUS"));
  assert.ok(codes(validateCommission({ ...goodFee, vatTreatment: "VAT_EXEMPT" })).blocking.includes("VAT_RATE_NOT_APPLICABLE"));
  assert.ok(codes(validateCommission({ ...goodFee, currency: "euro" })).blocking.includes("FEE_CURRENCY_INVALID"));
});

test("commission validation: a complete fee is required to issue, a draft may omit it", () => {
  const empty = validateCommission({}, {}, { requireComplete: true });
  for (const c of ["FEE_PAYER_MISSING", "FEE_METHOD_MISSING", "FEE_CURRENCY_MISSING", "VAT_TREATMENT_MISSING"]) assert.ok(codes(empty).blocking.includes(c), c);
  const draft = validateCommission({}, {}, { requireComplete: false });
  assert.equal(draft.status, "READY");
  assert.equal(draft.draftSaveable, true);
  // …but an impossible value is never acceptable, even in a draft.
  assert.equal(validateCommission({ percentage: 150 }, {}, { requireComplete: false }).draftSaveable, false);
});

test("VAT: no rate in the document or Settings blocks; the Settings rate satisfies it", () => {
  assert.ok(codes(validateCommission({ ...goodFee, vatRate: null })).blocking.includes("VAT_RATE_UNCONFIGURED"));
  assert.equal(validateCommission({ ...goodFee, vatRate: null }, { configuredVatRatePct: 24 }).status, "READY");
});

test("payment milestones: percentages must total 100, one amount each, no mixing", () => {
  assert.deepEqual(validatePaymentMilestones([{ sequence: 1, percentage: 50 }, { sequence: 2, percentage: 50 }]), []);
  assert.deepEqual(validatePaymentMilestones([{ sequence: 1, percentage: 33.33 }, { sequence: 2, percentage: 33.33 }, { sequence: 3, percentage: 33.34 }]), []);
  assert.equal(validatePaymentMilestones([{ sequence: 1, percentage: 50 }, { sequence: 2, percentage: 40 }])[0]!.code, "MILESTONE_PERCENTAGE_TOTAL");
  assert.equal(validatePaymentMilestones([{ sequence: 1, percentage: 50, fixedAmount: 10 }])[0]!.code, "MILESTONE_AMOUNT_AMBIGUOUS");
  assert.equal(validatePaymentMilestones([{ sequence: 1 }])[0]!.code, "MILESTONE_AMOUNT_AMBIGUOUS");
  assert.equal(validatePaymentMilestones([{ sequence: 1, percentage: 50 }, { sequence: 1, percentage: 50 }])[0]!.code, "MILESTONE_SEQUENCE_DUPLICATE");
  assert.equal(validatePaymentMilestones([{ sequence: 1, percentage: 50 }, { sequence: 2, fixedAmount: 500 }])[0]!.code, "MILESTONE_MIXED");
  assert.equal(validatePaymentMilestones([{ sequence: 1, fixedAmount: 1000 }, { sequence: 2, fixedAmount: 1500 }], { feeMethod: "FIXED_AMOUNT", fixedFee: 3000 })[0]!.code, "MILESTONE_AMOUNT_TOTAL");
  assert.deepEqual(validatePaymentMilestones([{ sequence: 1, fixedAmount: 1000 }, { sequence: 2, fixedAmount: 2000 }], { feeMethod: "FIXED_AMOUNT", fixedFee: 3000 }), []);
});

test("commission anomaly: fee equal to the property price is flagged, never changed", () => {
  const terms: FeeTerms = { ...goodFee, method: "FIXED_AMOUNT", percentage: null, fixedAmount: 14_600, vatTreatment: "PLUS_VAT" };
  const a = detectCommissionAnomalies(terms, { propertyPrice: 14_600 });
  assert.equal(a[0]!.code, "COMMISSION_ANOMALY");
  assert.equal(a[0]!.reason, "EQUALS_PRICE");
  assert.match(a[0]!.message, /ισούται με την τιμή/);
  assert.equal(terms.fixedAmount, 14_600);
});

test("commission anomaly: other suspicious shapes", () => {
  const reasons = (t: FeeTerms, price: number | null) => detectCommissionAnomalies(t, { propertyPrice: price }).map((a) => a.reason);
  assert.deepEqual(reasons({ method: "PERCENTAGE", percentage: 2700 }, 100_000), ["PERCENTAGE_LOOKS_LIKE_AMOUNT"]);
  assert.deepEqual(reasons({ method: "PERCENTAGE", percentage: 100 }, 100_000), ["EQUALS_PRICE"]);
  assert.deepEqual(reasons({ method: "PERCENTAGE", percentage: 15 }, 100_000), ["EXCEEDS_THRESHOLD"]);
  assert.deepEqual(reasons({ method: "FIXED_AMOUNT", fixedAmount: 40_000 }, 100_000), ["EXCEEDS_THRESHOLD"]);
  assert.deepEqual(reasons({ method: "FIXED_AMOUNT", fixedAmount: 2 }, 250_000), ["AMOUNT_LOOKS_LIKE_PERCENTAGE"]);
  assert.deepEqual(reasons({ method: "FIXED_AMOUNT", fixedAmount: 0, paymentTrigger: "FINAL_CONTRACT" }, 250_000), ["ZERO_WITH_SCHEDULE"]);
  assert.deepEqual(reasons({ method: "PERCENTAGE", percentage: 2 }, 250_000), []);
  assert.deepEqual(reasons({ method: "FIXED_AMOUNT", fixedAmount: 5000 }, null), []);
});

test("commission anomaly: a warning by default; blocks until acknowledged when the office chooses", () => {
  const terms: FeeTerms = { ...goodFee, method: "FIXED_AMOUNT", percentage: null, fixedAmount: 14_600, vatRate: 24 };
  assert.deepEqual(codes(validateCommission(terms, { propertyPrice: 14_600 })), { blocking: [], warnings: ["COMMISSION_ANOMALY"] });
  assert.deepEqual(codes(validateCommission(terms, { propertyPrice: 14_600, blockAnomalies: true })).blocking, ["COMMISSION_ANOMALY"]);
  const ack = validateCommission({ ...terms, anomalyOverrideReason: "Συμφωνία για ολόκληρο το ποσό" }, { propertyPrice: 14_600, blockAnomalies: true });
  assert.deepEqual(codes(ack), { blocking: [], warnings: ["COMMISSION_ANOMALY"] });
  assert.match(ack.warnings[0]!.message, /αποδοχή/);
});

// ---- duration, extensions, conflicts ------------------------------------------------

test("duration is calculated from the dates, inclusive", () => {
  assert.deepEqual(calculateDuration("2026-01-01", "2026-06-30"), { totalDays: 181, months: 6, days: 0 });
  assert.deepEqual(calculateDuration("2026-01-15", "2026-03-10"), { totalDays: 55, months: 1, days: 24 });
  assert.equal(calculateDuration("2026-02-01", "2026-01-31"), null);
  assert.equal(calculateDuration("2026-02-01", "2026-02-01")?.totalDays, 1);
});

test("effective end date: the mandate's end moves only with issued or signed extensions", () => {
  const end = effectiveEndDate("2026-06-30", [
    { status: "DRAFT", newEndDate: "2027-12-31" },
    { status: "CANCELLED", newEndDate: "2027-11-30" },
    { status: "SIGNED", newEndDate: "2026-09-30" },
    { status: "ISSUED", newEndDate: "2026-12-31" },
  ]);
  assert.equal(end?.toISOString().slice(0, 10), "2026-12-31");
  assert.equal(effectiveEndDate("2026-06-30", [])?.toISOString().slice(0, 10), "2026-06-30");
  assert.equal(effectiveEndDate(null, []), null);
});

const excl = (id: string, status: string, startsAt: string, endsAt: string, extra: object = {}) => ({ id, label: `ΕΑ-${id}`, type: "EXCLUSIVE_ASSIGNMENT", status, startsAt, endsAt, ...extra });
const cand = { id: "new", type: "EXCLUSIVE_ASSIGNMENT", startsAt: "2026-07-01", endsAt: "2026-12-31" };

test("exclusive conflict: overlapping live mandates block; the message is the required one", () => {
  const r = validateExclusiveConflict(cand, [excl("a", "SIGNED", "2026-01-01", "2026-07-01")]);
  assert.equal(r.blockingIssues[0]!.code, "EXCLUSIVE_CONFLICT");
  assert.ok(r.blockingIssues[0]!.message.startsWith(EXCLUSIVE_CONFLICT_MESSAGE));
  assert.equal(validateExclusiveConflict(cand, [excl("a", "SIGNED", "2026-01-01", "2026-06-30")], { now: new Date("2026-01-01") }).blockingIssues.length, 0, "adjacent, not overlapping");
});

test("exclusive conflict: cancelled, expired, declined, draft and superseded mandates do not block", () => {
  for (const status of ["CANCELLED", "EXPIRED", "DECLINED", "DRAFT"]) {
    assert.equal(validateExclusiveConflict(cand, [excl("a", status, "2026-01-01", "2026-12-31")]).blockingIssues.length, 0, status);
  }
  assert.equal(validateExclusiveConflict(cand, [excl("a", "SIGNED", "2026-01-01", "2026-12-31", { supersededByLive: true })]).blockingIssues.length, 0);
  assert.equal(validateExclusiveConflict(cand, [{ ...excl("a", "SIGNED", "2026-01-01", "2026-12-31"), type: "SIMPLE_ASSIGNMENT" }]).blockingIssues.length, 0);
  assert.equal(validateExclusiveConflict({ ...cand, type: "SIMPLE_ASSIGNMENT" }, [excl("a", "SIGNED", "2026-01-01", "2026-12-31")]).blockingIssues.length, 0, "simple mandates never conflict");
});

test("exclusive conflict: an extension counts, a pending one is named, a draft one is ignored", () => {
  const ended = excl("a", "SIGNED", "2026-01-01", "2026-06-30");
  assert.equal(validateExclusiveConflict(cand, [ended]).blockingIssues.length, 0);
  const extended = validateExclusiveConflict(cand, [{ ...ended, extensions: [{ status: "SIGNED", newEndDate: "2026-08-31" }] }]);
  assert.equal(extended.blockingIssues[0]!.reason, "OVERLAP");
  const pending = validateExclusiveConflict(cand, [{ ...ended, extensions: [{ status: "ISSUED", newEndDate: "2026-08-31" }] }]);
  assert.equal(pending.blockingIssues[0]!.reason, "PENDING_EXTENSION");
  assert.equal(validateExclusiveConflict(cand, [{ ...ended, extensions: [{ status: "DRAFT", newEndDate: "2026-08-31" }] }]).blockingIssues.length, 0);
});

test("exclusive conflict: a manager's recorded override downgrades it to a warning; a reasonless one does not", () => {
  const others = [excl("a", "SIGNED", "2026-01-01", "2026-12-31")];
  const ok = validateExclusiveConflict(cand, others, { overrides: [{ conflictingMandateId: "a", reason: "Ο ιδιοκτήτης συμφώνησε εγγράφως" }] });
  assert.deepEqual(codes(ok), { blocking: [], warnings: ["EXCLUSIVE_CONFLICT_OVERRIDDEN"] });
  assert.equal(validateExclusiveConflict(cand, others, { overrides: [{ conflictingMandateId: "a", reason: "  " }] }).blockingIssues.length, 1);
});

test("an exclusive mandate expiring soon is a warning for the new one", () => {
  const r = validateExclusiveConflict({ ...cand, startsAt: "2026-12-01", endsAt: "2027-05-31" }, [excl("a", "SIGNED", "2026-01-01", "2026-10-20")], { now: new Date("2026-10-06") });
  assert.deepEqual(codes(r), { blocking: [], warnings: ["EXCLUSIVE_EXPIRING_SOON"] });
});

// ---- ownership -----------------------------------------------------------------------

const owner = (contactId: string, pct: number | null, over: object = {}) => ({ contactId, capacity: "CO_OWNER", ownershipPercentage: pct, isSignatory: true, ...over });

test("ownership: shares of 100 % are fine; a short total is a warning; over 100 % blocks", () => {
  assert.deepEqual(codes(validateOwnership([owner("a", 50), owner("b", 50)])), { blocking: [], warnings: [] });
  assert.deepEqual(codes(validateOwnership([owner("a", 33.33), owner("b", 33.33), owner("c", 33.34)])), { blocking: [], warnings: [] });
  assert.deepEqual(codes(validateOwnership([owner("a", 50), owner("b", 30)])), { blocking: [], warnings: ["OWNERSHIP_UNDER_100"] });
  assert.deepEqual(codes(validateOwnership([owner("a", 60), owner("b", 50)])).blocking, ["OWNERSHIP_OVER_100"]);
  assert.deepEqual(codes(validateOwnership([owner("a", 50), owner("b", null)])).warnings, ["OWNERSHIP_SHARES_INCOMPLETE"]);
  // One owner with no stated share is not assumed to hold 100 %, and is not an error.
  assert.deepEqual(codes(validateOwnership([owner("a", null, { capacity: "OWNER" })])), { blocking: [], warnings: [] });
});

test("ownership: usufruct and bare ownership are separate rights", () => {
  const r = validateOwnership([owner("a", 100, { capacity: "USUFRUCTUARY" }), owner("b", 100, { capacity: "BARE_OWNER" })]);
  assert.deepEqual(codes(r), { blocking: [], warnings: [] });
});

test("ownership: someone who ended before today is not an owner", () => {
  const r = validateOwnership([owner("a", 50, { validTo: "2020-01-01" }), owner("b", 100)], { on: new Date("2026-10-06") });
  assert.deepEqual(codes(r), { blocking: [], warnings: [] });
  assert.deepEqual(codes(validateOwnership([owner("a", 100, { validTo: "2020-01-01" })], { on: new Date("2026-10-06") })).blocking, ["OWNER_MISSING"]);
});

test("ownership: signatories, representatives and authority", () => {
  assert.deepEqual(codes(validateOwnership([owner("a", 100, { isSignatory: false })])).blocking, ["SIGNATORY_MISSING"]);
  // Two owners, only one signs: blocked unless authority or a manager's reason exists.
  const partial = [owner("a", 50), owner("b", 50, { isSignatory: false })];
  assert.deepEqual(codes(validateOwnership(partial)).blocking, ["OWNER_NOT_SIGNING"]);
  assert.deepEqual(codes(validateOwnership(partial, { partialSigningOverrideReason: "Πληρεξούσιο στον σύζυγο" })), { blocking: [], warnings: ["PARTIAL_SIGNING_OVERRIDDEN"] });
  const attorney = { contactId: "r", capacity: "ATTORNEY_IN_FACT", isSignatory: true, hasAuthority: true };
  assert.deepEqual(codes(validateOwnership([owner("a", 100, { isSignatory: false }), attorney])), { blocking: [], warnings: ["OWNER_REPRESENTED"] });
  assert.deepEqual(codes(validateOwnership([owner("a", 100, { isSignatory: false }), { ...attorney, hasAuthority: false }])).blocking.includes("OWNER_AUTHORITY_MISSING"), true);
});

// ---- mandate -------------------------------------------------------------------------

const permissions = { photoPermission: true, videoPermission: true, floorplanPermission: true, signboardPermission: true, portalPublicationPermission: true, socialMediaPermission: true, cooperatingBrokerPermission: true, brokerCooperationAllowed: true };
const mandate = (over: Partial<MandateValidationInput> = {}): MandateValidationInput => ({
  type: "EXCLUSIVE_ASSIGNMENT", language: "el", durationType: "FIXED_TERM", startDate: "2026-11-01", endDate: "2027-04-30", hasProperty: true,
  property: { hasAddress: true, price: 250_000 }, parties: [party()], owners: [owner("a", 100, { capacity: "OWNER" })], fee: goodFee,
  knownDefects: false, defectsDisclosureConfirmed: true, permissions, template: { ...goodTemplate, type: "EXCLUSIVE_ASSIGNMENT", locale: "el" }, companyMissing: [], maxExclusiveMonths: 12, ...over,
});

test("a complete exclusive mandate is ready", () => {
  assert.equal(validateMandate(mandate()).status, "READY");
});

test("exclusive mandate: dates are mandatory, ordered and within the configured maximum", () => {
  assert.ok(codes(validateMandate(mandate({ endDate: null }))).blocking.includes("END_DATE_MISSING"));
  assert.ok(codes(validateMandate(mandate({ startDate: null }))).blocking.includes("START_DATE_MISSING"));
  assert.ok(codes(validateMandate(mandate({ endDate: "2026-10-01" }))).blocking.includes("END_BEFORE_START"));
  assert.equal(validateMandate(mandate({ endDate: "2026-10-01" })).draftSaveable, false, "an impossible date range cannot even be saved");
  assert.ok(codes(validateMandate(mandate({ durationType: "INDEFINITE" }))).blocking.includes("EXCLUSIVE_DURATION_INVALID"));
  assert.ok(codes(validateMandate(mandate({ endDate: "2028-01-31" }))).blocking.includes("EXCLUSIVE_TOO_LONG"));
  assert.ok(!codes(validateMandate(mandate({ endDate: "2027-10-31" }))).blocking.includes("EXCLUSIVE_TOO_LONG"), "exactly the maximum is allowed");
});

test("exclusive mandate: with no configured maximum none is invented, and the gap is reported", () => {
  const r = validateMandate(mandate({ maxExclusiveMonths: null, endDate: "2035-12-31" }));
  assert.ok(!codes(r).blocking.includes("EXCLUSIVE_TOO_LONG"));
  assert.ok(codes(r).warnings.includes("EXCLUSIVE_MAX_NOT_CONFIGURED"));
});

test("simple mandate: indefinite needs no end; fixed term needs one; the two cannot contradict", () => {
  const simple = (o: Partial<MandateValidationInput>) => mandate({ type: "SIMPLE_ASSIGNMENT", template: { ...goodTemplate, type: "SIMPLE_ASSIGNMENT", locale: "el" }, ...o });
  assert.equal(validateMandate(simple({ durationType: "INDEFINITE", endDate: null })).status, "READY");
  assert.ok(codes(validateMandate(simple({ durationType: "FIXED_TERM", endDate: null }))).blocking.includes("END_DATE_MISSING"));
  assert.equal(validateMandate(simple({ durationType: "FIXED_TERM", endDate: "2027-01-31" })).status, "READY");
  assert.ok(codes(validateMandate(simple({ durationType: null, endDate: null }))).blocking.includes("DURATION_TYPE_MISSING"));
  assert.ok(codes(validateMandate(simple({ durationType: "INDEFINITE", endDate: "2027-01-31" }))).blocking.includes("INDEFINITE_WITH_END_DATE"));
  assert.ok(codes(validateMandate(simple({ startDate: null }))).blocking.includes("START_DATE_MISSING"));
  // A simple mandate has no maximum and no exclusive warning.
  assert.ok(!codes(validateMandate(simple({ durationType: "FIXED_TERM", endDate: "2035-01-31" }))).warnings.includes("EXCLUSIVE_MAX_NOT_CONFIGURED"));
});

test("mandate: declarations and permissions must be answered, not defaulted", () => {
  const r = validateMandate(mandate({ knownDefects: null, defectsDisclosureConfirmed: null, permissions: { ...permissions, videoPermission: null, brokerCooperationAllowed: null } }));
  assert.deepEqual(codes(r).blocking.filter((c) => c.startsWith("DEFECTS") || c.startsWith("PERMISSION")).sort(), ["DEFECTS_DISCLOSURE_UNCONFIRMED", "DEFECTS_UNANSWERED", "PERMISSION_UNANSWERED", "PERMISSION_UNANSWERED"]);
  assert.ok(codes(validateMandate(mandate({ knownDefects: true, defectsDescription: " " }))).blocking.includes("DEFECTS_DESCRIPTION_MISSING"));
  assert.equal(validateMandate(mandate({ knownDefects: true, defectsDescription: "Υγρασία στο υπόγειο" })).status, "READY");
  const denied = validateMandate(mandate({ permissions: { ...permissions, photoPermission: false } }));
  assert.deepEqual(codes(denied), { blocking: [], warnings: ["PERMISSION_NOT_GRANTED"] });
});

test("mandate: missing type, property, address, template, company data and signatory block issuing", () => {
  const r = validateMandate(mandate({ type: "", hasProperty: false, property: { hasAddress: false }, parties: [], template: null, companyMissing: ["ΑΦΜ", "ΔΟΥ"] }));
  for (const c of ["MANDATE_TYPE_MISSING", "PROPERTY_MISSING", "PROPERTY_ADDRESS_MISSING", "PARTY_MISSING", "TEMPLATE_MISSING", "COMPANY_DATA_MISSING"]) assert.ok(codes(r).blocking.includes(c), c);
  assert.equal(codes(r).blocking.filter((c) => c === "COMPANY_DATA_MISSING").length, 2);
});

test("mandate: the template must match the mandate's type and language and be approved", () => {
  assert.ok(codes(validateMandate(mandate({ template: { ...goodTemplate, type: "SIMPLE_ASSIGNMENT", locale: "el" } }))).blocking.includes("TEMPLATE_TYPE_MISMATCH"));
  assert.ok(codes(validateMandate(mandate({ language: "en" }))).blocking.includes("TEMPLATE_LANGUAGE_MISMATCH"));
  assert.ok(codes(validateMandate(mandate({ template: { ...goodTemplate, active: false, type: "EXCLUSIVE_ASSIGNMENT", locale: "el" } }))).blocking.includes("TEMPLATE_NOT_ACTIVE"));
  assert.ok(codes(validateMandate(mandate({ template: { ...goodTemplate, checksumValid: false, type: "EXCLUSIVE_ASSIGNMENT", locale: "el" } }))).blocking.includes("TEMPLATE_CHECKSUM_INVALID"));
  assert.ok(codes(validateMandate(mandate({ template: { ...goodTemplate, requiresLegalReview: true, legalApproved: false, type: "EXCLUSIVE_ASSIGNMENT", locale: "el" } }))).blocking.includes("TEMPLATE_LEGAL_APPROVAL_MISSING"));
});

test("mandate: the fee-equals-price anomaly surfaces as a warning", () => {
  const r = validateMandate(mandate({ fee: { ...goodFee, method: "FIXED_AMOUNT", percentage: null, fixedAmount: 250_000 } }));
  assert.deepEqual(codes(r), { blocking: [], warnings: ["COMMISSION_ANOMALY"] });
  assert.equal(r.status, "WARNING");
});

// ---- showing ---------------------------------------------------------------------------

const showing = (over: Partial<ShowingValidationInput> = {}): ShowingValidationInput => ({
  language: "el", parties: [party()], properties: [{ propertyId: "p1", code: "H88-000001", hasSnapshot: true, hasAddress: true, price: 250_000 }], fee: goodFee,
  template: { ...goodTemplate, type: "SHOWING", locale: "el" }, companyMissing: [], hasResponsibleUser: true, ...over,
});

test("a complete showing is ready", () => {
  assert.equal(validateShowing(showing()).status, "READY");
});

test("showing: needs a client, a property with a snapshot and an address", () => {
  const r = validateShowing(showing({ parties: [], properties: [] }));
  assert.deepEqual(codes(r).blocking.slice(0, 2), ["PROPERTY_MISSING", "PARTY_MISSING"]);
  assert.ok(codes(validateShowing(showing({ properties: [{ propertyId: "p1", code: "H88-000001", hasSnapshot: false, hasAddress: false }] }))).blocking.includes("PROPERTY_SNAPSHOT_MISSING"));
  assert.ok(codes(validateShowing(showing({ properties: [{ propertyId: "p1", code: "H88-000001", hasSnapshot: true, hasAddress: false }] }))).blocking.includes("PROPERTY_ADDRESS_MISSING"));
  const dup = validateShowing(showing({ properties: [{ propertyId: "p1", hasSnapshot: true, hasAddress: true }, { propertyId: "p1", hasSnapshot: true, hasAddress: true }] }));
  assert.equal(dup.draftSaveable, false);
});

test("showing: several properties are allowed; the fee anomaly check applies to a single listed price", () => {
  const two = showing({ properties: [{ propertyId: "p1", hasSnapshot: true, hasAddress: true, price: 100_000 }, { propertyId: "p2", hasSnapshot: true, hasAddress: true, price: 200_000 }] });
  assert.equal(validateShowing(two).status, "READY");
  const fixed = { ...goodFee, method: "FIXED_AMOUNT" as const, percentage: null, fixedAmount: 250_000 };
  assert.ok(codes(validateShowing(showing({ fee: fixed }))).warnings.includes("COMMISSION_ANOMALY"));
});

test("showing: identity of the client before issuing", () => {
  const r = validateShowing(showing({ parties: [party({ hasTaxId: false, hasIdNumber: false, hasAddress: false, hasPhone: false, hasEmail: false, hasTaxOffice: false, identityVerified: false })] }));
  for (const c of ["PARTY_TAX_ID_MISSING", "PARTY_ID_MISSING", "PARTY_ADDRESS_MISSING", "PARTY_CONTACT_MISSING"]) assert.ok(codes(r).blocking.includes(c), c);
  assert.deepEqual(codes(r).warnings, ["PARTY_TAX_OFFICE_MISSING", "PARTY_IDENTITY_UNVERIFIED"]);
  assert.equal(r.draftSaveable, true, "a draft may stay incomplete");
  assert.ok(codes(validateShowing(showing({ parties: [party({ role: "ATTORNEY_IN_FACT", representativeCapacity: "ATTORNEY_IN_FACT", hasAuthority: false })] }))).blocking.includes("REPRESENTATIVE_AUTHORITY_MISSING"));
});

test("showing: fee, payer, VAT, dual-representation answer, template and company data", () => {
  const r = validateShowing(showing({ fee: {}, templateRequiresDualConsent: true, dualRepresentationConsent: null, template: null, companyMissing: ["ΑΦΜ"] }));
  for (const c of ["FEE_PAYER_MISSING", "VAT_TREATMENT_MISSING", "DUAL_REPRESENTATION_UNANSWERED", "TEMPLATE_MISSING", "COMPANY_DATA_MISSING"]) assert.ok(codes(r).blocking.includes(c), c);
  assert.equal(validateShowing(showing({ feeApplicable: false, fee: {} })).status, "READY", "no fee, no fee fields");
  assert.equal(validateShowing(showing({ templateRequiresDualConsent: true, dualRepresentationConsent: false })).status, "READY", "an explicit 'no' is an answer");
});

test("showing lifecycle matches the database trigger", () => {
  assert.ok(canMoveShowing("DRAFT", "READY_FOR_ISSUANCE"));
  assert.ok(!canMoveShowing("DRAFT", "ISSUED"), "a draft is made ready first");
  assert.ok(canMoveShowing("READY_FOR_ISSUANCE", "ISSUED"));
  assert.ok(canMoveShowing("READY_FOR_ISSUANCE", "DRAFT"));
  assert.ok(canMoveShowing("ISSUED", "SIGNED"), "paper signature");
  assert.ok(!canMoveShowing("ISSUED", "DRAFT"));
  for (const final of ["SIGNED", "DECLINED", "EXPIRED", "CANCELLED"]) assert.ok(!canMoveShowing(final, "DRAFT") && !canMoveShowing(final, "SENT"), final);
});

test("showing numbers: ΥΠ-YYYY-NNNNNN", () => {
  assert.equal(formatShowingNumber(2026, 251), "ΥΠ-2026-000251");
  assert.deepEqual(parseShowingNumber("ΥΠ-2026-000251"), { year: 2026, sequence: 251 });
  assert.equal(parseShowingNumber("MND-000251"), null);
  assert.throws(() => formatShowingNumber(2026, 0));
  assert.throws(() => formatShowingNumber(2026, 1_000_000));
});

// ---- legacy legal text ---------------------------------------------------------------------

test("legacy Estate+ wording is kept verbatim and flagged for review", () => {
  assert.equal(LEGACY_ESTATE_PLUS_TEMPLATES.length, 6);
  const by = (type: string, locale: string) => LEGACY_ESTATE_PLUS_TEMPLATES.find((t) => t.type === type && t.locale === locale)!;

  const showingGr = detectLegacyLegalFlags(by("SHOWING", "el").body);
  assert.deepEqual(showingGr, ["LAW_2472_1997", "COURT_JURISDICTION", "CIVIL_CODE_707_WAIVER", "LAW_4072_2012", "PD_248_1993", "DUAL_REPRESENTATION"]);

  const assignGr = detectLegacyLegalFlags(by("SIMPLE_ASSIGNMENT", "el").body);
  for (const f of ["RETENTION_10_YEARS", "LAW_4072_2012", "MIXED_SIMPLE_EXCLUSIVE", "DURATION_ALTERNATIVE", "FEE_AMOUNT_UNRESOLVED", "UNFILLED_PLACEHOLDERS"]) assert.ok(assignGr.includes(f as never), f);
  // The old system printed the same text for simple and exclusive.
  assert.equal(by("SIMPLE_ASSIGNMENT", "el").body, by("EXCLUSIVE_ASSIGNMENT", "el").body);

  assert.ok(detectLegacyLegalFlags(by("SHOWING", "en").body).includes("LAW_2472_1997"));
  assert.ok(detectLegacyLegalFlags(by("EXCLUSIVE_ASSIGNMENT", "en").body).includes("TEXT_TRUNCATED"), "the supplied English exclusive text is cut off mid-sentence");
  assert.deepEqual(detectLegacyLegalFlags("Καθαρό κείμενο χωρίς παραπομπές."), []);
});
