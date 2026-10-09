/**
 * What the public website actually serves, against a real Postgres: the one
 * publication rule across detail, search, featured, recent, counts, areas and the
 * sitemap; approved media only; NOINDEX and PRIVATE; keep-off tags; and that a
 * stored sitemap flag never decides anything. Skipped (not passed) without
 * INTAKE_TEST_DATABASE_URL.
 */

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";

import { hasTestDatabase, publishFixture, resetDatabase, testPrisma, TEST_DATABASE_URL } from "@home88/intake/testing";

const SKIP = hasTestDatabase ? false : "INTAKE_TEST_DATABASE_URL not set";

type Lib = {
  property: typeof import("./property");
  areas: typeof import("./areas");
};

describe("public website publication rule (real Postgres)", { skip: SKIP }, () => {
  let lib: Lib;

  before(async () => {
    // lib/db binds its client at import time, so point it at the scratch database first.
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    lib = { property: await import("./property"), areas: await import("./areas") };
    await testPrisma().$connect();
  });
  after(async () => {
    await testPrisma().$disconnect();
  });
  beforeEach(resetDatabase);

  let n = 0;
  async function make(over: {
    status?: string;
    publication?: Parameters<typeof publishFixture>[1] | null;
    tags?: string[];
    featured?: boolean;
    areaName?: string;
    sitemapIncluded?: boolean;
    media?: Array<{ status: string; lifecycle?: string; kind?: string; isPrimary?: boolean; sortOrder?: number }>;
  } = {}) {
    n += 1;
    const reference = `H88-${String(900000 + n)}`;
    const prisma = testPrisma();
    const property = await prisma.property.create({
      data: {
        reference,
        slug: reference.toLowerCase(),
        listingType: "SALE",
        propertyType: "APARTMENT",
        status: (over.status ?? "ACTIVE") as "ACTIVE",
        titleEl: `Διαμέρισμα ${reference}`,
        descriptionEl: "Φωτεινό διαμέρισμα με θέα.",
        price: 300000,
        area: 90,
        city: "Αθήνα",
        areaName: over.areaName ?? "Γλυφάδα",
        featured: over.featured ?? false,
        publishedAt: new Date(),
        // Things that must never reach a visitor:
        commissionRatePct: 3,
        agentCommissionPct: 1.5,
        address: "Οδός Ιδιωτική 12",
        details: { privateNote: "ΜΥΣΤΙΚΟ-ΣΗΜΕΙΩΣΗ" },
      },
    });
    if (over.publication !== null) {
      const pub = await publishFixture(property, over.publication ?? {});
      if (over.sitemapIncluded !== undefined) await prisma.websitePublication.update({ where: { id: pub.id }, data: { sitemapIncluded: over.sitemapIncluded } });
    }
    for (const code of over.tags ?? []) {
      const tag = await prisma.propertyTag.upsert({ where: { code }, create: { code, labelEl: code }, update: {} });
      await prisma.propertyTagAssignment.create({ data: { propertyId: property.id, tagId: tag.id } });
    }
    let order = 0;
    for (const m of over.media ?? []) {
      order += 1;
      await prisma.propertyMedia.create({
        data: {
          propertyId: property.id,
          storageKey: `properties/${property.id}/m${order}.jpg`,
          mimeType: "image/jpeg",
          byteSize: 100,
          kind: (m.kind ?? "PHOTO") as "PHOTO",
          status: m.status,
          lifecycle: (m.lifecycle ?? "AVAILABLE") as "AVAILABLE",
          isPrimary: m.isPrimary ?? false,
          sortOrder: m.sortOrder ?? order,
        },
      });
    }
    return property;
  }

  const refs = (rows: Array<{ reference: string }>) => rows.map((r) => r.reference).sort();

  it("a live publication on a public property is served everywhere, whatever its stored sitemap flag", async () => {
    const live = await make({ featured: true });
    const outdated = await make({ publication: { status: "OUTDATED" } });
    const pending = await make({ publication: { status: "UPDATE_PENDING" } });
    const underOffer = await make({ status: "UNDER_OFFER" });
    const reserved = await make({ status: "RESERVED" });

    const search = await lib.property.searchProperties("el", {});
    assert.deepEqual(refs(search.data), refs([live, outdated, pending, underOffer, reserved]));
    assert.equal(search.total, 5);
    assert.equal(await lib.property.countPublicProperties(), 5);
    assert.deepEqual(refs(await lib.property.listRecentProperties("el", 20)), refs([live, outdated, pending, underOffer, reserved]));
    assert.deepEqual(refs(await lib.property.listFeaturedProperties("el")), [live.reference]);
    for (const p of [live, outdated, pending, underOffer, reserved]) {
      assert.ok(await lib.property.getPropertyByReference(p.reference, "el"), `${p.reference} detail`);
    }
    assert.deepEqual((await lib.areas.listAreas()).map((a) => [a.name, a.count]), [["Γλυφάδα", 5]]);
  });

  it("existing URLs keep working: the reference, in any case, is the address", async () => {
    const p = await make();
    const lower = await lib.property.getPropertyByReference(p.reference.toLowerCase(), "el");
    assert.equal(lower?.reference, p.reference);
    assert.equal(lower?.slug, p.slug, "the slug is still exposed as before");
  });

  it("unpublished stays unavailable: no publication, UNPUBLISHED, DRAFT, ARCHIVED, deselected", async () => {
    const hidden = [
      await make({ publication: null }),
      await make({ publication: { status: "UNPUBLISHED", enabled: false, visibility: "NOINDEX", noIndex: true } }),
      await make({ publication: { status: "DRAFT", enabled: false, visibility: "NOINDEX", noIndex: true } }),
      await make({ publication: { status: "ARCHIVED", enabled: false } }),
      await make({ publication: { status: "PUBLISHED", enabled: false } }),
    ];
    assert.equal((await lib.property.searchProperties("el", {})).total, 0);
    assert.equal(await lib.property.countPublicProperties(), 0);
    assert.deepEqual(await lib.property.listRecentProperties("el", 20), []);
    assert.deepEqual(await lib.areas.listAreas(), []);
    assert.deepEqual(await lib.property.listSitemapProperties(), []);
    for (const p of hidden) assert.equal(await lib.property.getPropertyByReference(p.reference, "el"), null, p.reference);
  });

  it("a live page on a property that is not public (sold, rented, inactive, draft, archived, deleted) is not shown", async () => {
    for (const status of ["SOLD", "RENTED", "INACTIVE", "DRAFT", "ARCHIVED", "DELETED"]) {
      const p = await make({ status });
      assert.equal(await lib.property.getPropertyByReference(p.reference, "el"), null, status);
    }
    assert.equal((await lib.property.searchProperties("el", {})).total, 0);
    assert.deepEqual(await lib.property.listSitemapProperties(), []);
  });

  it("NOINDEX is reachable by its link but never listed, counted or in the sitemap; PRIVATE is not served at all", async () => {
    const noindex = await make({ publication: { visibility: "NOINDEX", noIndex: true } });
    const privateOne = await make({ publication: { visibility: "PRIVATE" } });
    const flagged = await make({ publication: { visibility: "PUBLIC", noIndex: true } });

    const detail = await lib.property.getPropertyByReference(noindex.reference, "el");
    assert.ok(detail, "a NOINDEX page is served to anyone with the link");
    assert.equal(detail.indexable, false, "and carries robots noindex");
    assert.equal(await lib.property.getPropertyByReference(privateOne.reference, "el"), null);
    assert.equal((await lib.property.getPropertyByReference(flagged.reference, "el"))?.indexable, false, "PUBLIC but noIndex is served, not indexable");

    const listed = (await lib.property.searchProperties("el", {})).data.map((p) => p.reference);
    assert.deepEqual(listed, [flagged.reference], "only PUBLIC visibility is listed");
    assert.deepEqual(await lib.property.listSitemapProperties(), [], "no NOINDEX/PRIVATE/noIndex page is in the sitemap");
  });

  it("a keep-off tag hides a live page at once, even before the publication state is touched; WEBSITE_ONLY does not", async () => {
    const dnp = await make({ tags: ["DO_NOT_PUBLISH"] });
    const portalOnly = await make({ tags: ["PORTAL_ONLY"] });
    const websiteOnly = await make({ tags: ["WEBSITE_ONLY"] });
    assert.equal(await lib.property.getPropertyByReference(dnp.reference, "el"), null);
    assert.equal(await lib.property.getPropertyByReference(portalOnly.reference, "el"), null);
    assert.ok(await lib.property.getPropertyByReference(websiteOnly.reference, "el"));
    assert.deepEqual(refs((await lib.property.searchProperties("el", {})).data), [websiteOnly.reference]);
    assert.deepEqual((await lib.property.listSitemapProperties()).map((p) => p.reference), [websiteOnly.reference]);
  });

  it("approved media only: pending, rejected, quarantined, uploading and documents never appear", async () => {
    const p = await make({
      media: [
        { status: "approved", isPrimary: false, sortOrder: 2 },
        { status: "published", isPrimary: true, sortOrder: 3 },
        { status: "pending_review", sortOrder: 1 },
        { status: "rejected", sortOrder: 1 },
        { status: "approved", lifecycle: "QUARANTINED" },
        { status: "approved", lifecycle: "UPLOADING" },
        { status: "approved", lifecycle: "DELETED" },
        { status: "approved", kind: "DOCUMENT" },
      ],
    });
    const detail = await lib.property.getPropertyByReference(p.reference, "el");
    assert.ok(detail);
    assert.equal(detail.images.length, 2, "only the two approved/published photos");
    assert.equal(detail.imageCount, 2);
    assert.ok(detail.primaryImage?.endsWith("/m2.jpg"), "the primary approved photo leads");
    assert.deepEqual(detail.images.map((i) => i.url.split("/").pop()), ["m2.jpg", "m1.jpg"]);
    const card = (await lib.property.searchProperties("el", {})).data[0]!;
    assert.equal(card.imageCount, 2);
  });

  it("the public response carries no owner, notes, commission, address detail or private data", async () => {
    const p = await make({ media: [{ status: "pending_review" }] });
    const detail = await lib.property.getPropertyByReference(p.reference, "el");
    const json = JSON.stringify(detail);
    for (const secret of ["ΜΥΣΤΙΚΟ-ΣΗΜΕΙΩΣΗ", "Οδός Ιδιωτική", "commission", "ownerId", "agentId", "createdById", "pending_review", "m1.jpg"]) {
      assert.ok(!json.includes(secret), `${secret} must not be public`);
    }
  });

  it("the sitemap is derived from state: a stored flag never adds or removes a page", async () => {
    const eligible = await make({ sitemapIncluded: false });
    const flaggedButNoindex = await make({ publication: { visibility: "NOINDEX", noIndex: true }, sitemapIncluded: true });
    const flaggedButTagged = await make({ tags: ["DO_NOT_PUBLISH"], sitemapIncluded: true });
    const flaggedButSold = await make({ status: "SOLD", sitemapIncluded: true });
    const flaggedButUnpublished = await make({ publication: { status: "UNPUBLISHED", enabled: false }, sitemapIncluded: true });
    const entries = await lib.property.listSitemapProperties();
    assert.deepEqual(entries.map((e) => e.reference), [eligible.reference]);
    assert.ok(entries[0]!.lastModified instanceof Date);
    void [flaggedButNoindex, flaggedButTagged, flaggedButSold, flaggedButUnpublished];
  });

  it("search filters still work on top of the rule", async () => {
    await make({ areaName: "Βούλα" });
    await make({ areaName: "Γλυφάδα" });
    await make({ areaName: "Γλυφάδα", publication: null });
    const glyfada = await lib.property.searchProperties("el", { areaName: "Γλυφάδα" });
    assert.equal(glyfada.total, 1);
    assert.equal((await lib.property.searchProperties("el", { maxPrice: 100 })).total, 0);
    assert.deepEqual((await lib.areas.listAreas()).map((a) => a.name).sort(), ["Βούλα", "Γλυφάδα"]);
  });
});
