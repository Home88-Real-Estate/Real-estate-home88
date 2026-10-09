/**
 * The assistant's tools against a real Postgres: real property visibility and
 * the real intake service. Skipped (not passed) without INTAKE_TEST_DATABASE_URL.
 */

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { hasTestDatabase, makeService, publishFixture, resetDatabase, testPrisma, TEST_DATABASE_URL } from "@home88/intake/testing";

import { executeTool, type ToolContext, type ToolDeps } from "./tools";

const SKIP = hasTestDatabase ? false : "INTAKE_TEST_DATABASE_URL not set";

describe("assistant tools (real Postgres)", { skip: SKIP }, () => {
  let deps: ToolDeps;

  before(async () => {
    // lib/db binds its client at import time, so point it at the scratch database first.
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const { searchProperties, getPropertyByReference } = await import("../property");
    const { service } = makeService({ now: () => new Date("2026-10-05T10:00:00Z") });
    deps = {
      searchProperties,
      getProperty: getPropertyByReference,
      intake: () => service,
      company: async () => { throw new Error("not used"); },
      rateLimit: () => ({ ok: true }),
    };
    await testPrisma().$connect();
  });
  after(async () => { await testPrisma().$disconnect(); });

  beforeEach(async () => {
    await resetDatabase();
    const prisma = testPrisma();
    const common = { listingType: "SALE" as const, propertyType: "APARTMENT" as const, descriptionEl: "Φωτεινό διαμέρισμα.", price: 450000, area: 105, bedrooms: 3, city: "Αθήνα", areaName: "Γλυφάδα" };
    // A visitor-visible page is a live publication; the others are unpublished, or live on a property that is not public.
    const make = async (reference: string, status: "ACTIVE" | "DRAFT" | "SOLD" | "UNDER_OFFER", titleEl: string, published: boolean, extra: { price?: number } = {}) => {
      const property = await prisma.property.create({ data: { ...common, ...extra, reference, slug: reference.toLowerCase(), status, titleEl } });
      if (published) await publishFixture(property);
    };
    await make("H88-000001", "ACTIVE", "Δημοσιευμένο στη Γλυφάδα", true);
    await make("H88-000002", "DRAFT", "Πρόχειρο στη Γλυφάδα", false);
    await make("H88-000003", "SOLD", "Πουλημένο στη Γλυφάδα", true);
    await make("H88-000004", "UNDER_OFFER", "Υπό προσφορά στη Γλυφάδα", true, { price: 700000 });
  });

  const ctx = (session = "session-aaaaaaaa", over: Partial<ToolContext> = {}): ToolContext => ({
    locale: "el", sessionId: session, ip: "203.0.113.50", userAgent: "test", currentProperty: null, landingPage: "/property/H88-000001", deps, ...over,
  });
  const adult = { firstName: "Μαρία", lastName: "Παπαδοπούλου", email: "Maria@Example.com", dateOfBirth: "1985-06-15", ageConfirmed: true, processingConfirmed: true };
  const counts = async () => { const p = testPrisma(); return { contacts: await p.contact.count(), leads: await p.lead.count(), viewingRequests: await p.viewingRequest.count(), requests: await p.buyerRequest.count() }; };

  it("search returns only public listings and never drafts or sold properties", async () => {
    const out = await executeTool("search_properties", { location: "Γλυφάδα" }, ctx());
    const refs = (out.cards ?? []).map((c) => c.reference).sort();
    assert.deepEqual(refs, ["H88-000001", "H88-000004"]);
    const under = (out.result.properties as Array<{ reference: string; availability: string }>).find((p) => p.reference === "H88-000004")!;
    assert.match(under.availability, /Under offer/);
  });

  it("an impossible price matches nothing, so nothing can be invented", async () => {
    const out = await executeTool("search_properties", { minPrice: 999_999_999 }, ctx());
    assert.equal(out.result.totalMatches, 0);
    assert.deepEqual(out.cards, []);
  });

  it("details: public property is returned; draft and sold look the same as unknown", async () => {
    assert.equal((await executeTool("get_property_details", { reference: "H88-000001" }, ctx())).ok, true);
    for (const reference of ["H88-000002", "H88-000003", "H88-000777"]) {
      const out = await executeTool("get_property_details", { reference }, ctx());
      assert.equal(out.result.code, "NOT_FOUND_OR_NOT_PUBLIC", reference);
    }
  });

  it("lead creation: contact + property lead, attributed to the AI assistant, date of birth not stored", async () => {
    const out = await executeTool("create_property_inquiry", { ...adult, reference: "H88-000001", message: "Είμαι ενδιαφερόμενη." }, ctx());
    assert.equal(out.ok, true, JSON.stringify(out.result));
    assert.equal(out.action?.kind, "property_inquiry");

    const prisma = testPrisma();
    const lead = await prisma.lead.findFirstOrThrow({ include: { property: true } });
    assert.equal(lead.type, "PROPERTY_ENQUIRY");
    assert.equal(lead.sourceChannel, "AI_ASSISTANT");
    assert.equal(lead.property?.reference, "H88-000001");
    assert.ok(lead.ageVerifiedAt);
    assert.match(lead.message ?? "", /^\[AI Assistant\]/);
    assert.ok(!JSON.stringify(lead).includes("1985-06-15"));
    assert.ok(await prisma.crmNotification.count() > 0, "an agent notification is created");
  });

  it("repeating the same request in the same chat is idempotent: one lead, same reference", async () => {
    const first = await executeTool("create_property_inquiry", { ...adult, reference: "H88-000001" }, ctx());
    const again = await executeTool("create_property_inquiry", { ...adult, reference: "H88-000001" }, ctx());
    assert.equal(again.result.duplicate, true);
    assert.equal(again.result.reference, first.result.reference);
    assert.equal((await counts()).leads, 1);
  });

  it("the same person in another chat reuses the contact (deduplicated by email)", async () => {
    await executeTool("create_property_inquiry", { ...adult, reference: "H88-000001" }, ctx("session-aaaaaaaa"));
    await executeTool("create_property_inquiry", { ...adult, email: "maria@example.com", reference: "H88-000004" }, ctx("session-bbbbbbbb"));
    const c = await counts();
    assert.equal(c.contacts, 1);
    assert.equal(c.leads, 2);
  });

  // The age gate reads the real clock, so the boundary dates are computed from today (a fixed
  // date silently turned a refused minor into an adult the day after it was written).
  const eighteenYearsAgo = (dayOffset: number) => {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - 18);
    d.setUTCDate(d.getUTCDate() + dayOffset);
    return d.toISOString().slice(0, 10);
  };

  it("under 18, missing or invalid date of birth, or no age confirmation: refused and nothing is written", async () => {
    const attempts: Array<Record<string, unknown>> = [
      { ...adult, dateOfBirth: "2012-01-01" },
      { ...adult, dateOfBirth: eighteenYearsAgo(1) }, // turns 18 tomorrow
      { ...adult, dateOfBirth: "" },
      { ...adult, dateOfBirth: undefined },
      { ...adult, dateOfBirth: "2000-02-31" },
      { ...adult, dateOfBirth: "2099-01-01" },
      { ...adult, ageConfirmed: false },
    ];
    for (const a of attempts) {
      const out = await executeTool("create_property_inquiry", { ...a, reference: "H88-000001" }, ctx());
      assert.equal(out.ok, false, JSON.stringify(a));
      assert.equal(out.action, undefined);
    }
    assert.deepEqual(await counts(), { contacts: 0, leads: 0, viewingRequests: 0, requests: 0 });
    const under = await executeTool("create_property_inquiry", { ...adult, dateOfBirth: "2012-01-01", reference: "H88-000001" }, ctx());
    assert.equal(under.result.code, "AGE_REQUIREMENT");
    assert.match(String(under.result.message), /18/);
    assert.ok(!String(under.result.message).includes("2012"));
  });

  it("someone exactly 18 today is accepted", async () => {
    const out = await executeTool("create_property_inquiry", { ...adult, dateOfBirth: eighteenYearsAgo(0), reference: "H88-000001" }, ctx());
    assert.equal(out.ok, true, JSON.stringify(out.result));
  });

  it("an enquiry or viewing request for a property that is not public is refused and writes nothing", async () => {
    for (const reference of ["H88-000002", "H88-000003", "H88-000777"]) {
      for (const tool of ["create_property_inquiry", "create_viewing_request"]) {
        const out = await executeTool(tool, { ...adult, reference }, ctx());
        assert.equal(out.result.code, "NOT_FOUND_OR_NOT_PUBLIC", `${tool} ${reference}`);
      }
    }
    assert.deepEqual(await counts(), { contacts: 0, leads: 0, viewingRequests: 0, requests: 0 });
  });

  it("an enquiry needs a way to reach the visitor", async () => {
    const out = await executeTool("create_property_inquiry", { ...adult, email: undefined, reference: "H88-000001" }, ctx());
    assert.equal(out.result.code, "INVALID_INPUT");
  });

  it("viewing request: stored as a REQUEST, never as a confirmed viewing", async () => {
    const out = await executeTool("create_viewing_request", { ...adult, reference: "H88-000001", preferredStart: "2026-10-12T17:00:00Z" }, ctx());
    assert.equal(out.ok, true, JSON.stringify(out.result));
    const vr = await testPrisma().viewingRequest.findFirstOrThrow();
    assert.equal(vr.status, "REQUESTED");
    assert.equal(await testPrisma().viewing.count(), 0);
    const past = await executeTool("create_viewing_request", { ...adult, email: "other@example.com", reference: "H88-000001", preferredStart: "2020-01-01T10:00:00Z" }, ctx("session-cccccccc"));
    assert.equal(past.ok, false);
  });

  it("the property context supplies the reference when the visitor says 'this property'", async () => {
    const out = await executeTool("create_viewing_request", { ...adult }, ctx("session-dddddddd", { currentProperty: { reference: "H88-000001" } }));
    assert.equal(out.ok, true, JSON.stringify(out.result));
  });

  it("buyer request: contact + buyer lead + a persistent request with the criteria", async () => {
    const out = await executeTool(
      "create_buyer_request",
      { ...adult, listingType: "SALE", propertyTypes: ["APARTMENT"], areas: ["Γλυφάδα"], maxPrice: 500000, minBedrooms: 2, notes: "Για κατοικία." },
      ctx(),
    );
    assert.equal(out.ok, true, JSON.stringify(out.result));
    const r = await testPrisma().buyerRequest.findFirstOrThrow();
    assert.equal(r.listingType, "SALE");
    assert.deepEqual(r.areas, ["Γλυφάδα"]);
    assert.equal(Number(r.maxPrice), 500000);
    const lead = await testPrisma().lead.findFirstOrThrow();
    assert.equal(lead.type, "BUYER");
    assert.equal(lead.sourceChannel, "AI_ASSISTANT");
  });
});
