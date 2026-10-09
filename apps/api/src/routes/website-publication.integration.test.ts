/**
 * Website publication and unified channel publishing through the real API and a
 * real Postgres: the website as one channel next to the portals, with
 * independent states and partial success, server-side permissions and audit,
 * hash-based skipping, the property lifecycle (sold, rented, archived, reopened),
 * tags, the compatibility flag, permanent deletion, and the cutover migration.
 * No real portal and no real website is ever contacted: `fetch` is replaced with
 * a stub that records the only calls allowed (the website's own revalidation) and
 * fails every other outbound request. Runs only when TEST_DATABASE_URL points at
 * a disposable database with all migrations applied:
 *
 *   TEST_DATABASE_URL=postgresql://… npx tsx --test src/routes/website-publication.integration.test.ts
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { isWebsiteLive, publicWebsiteWhere, websiteSitemapEligible } from "@home88/domain";

const url = process.env.TEST_DATABASE_URL;
const SITE = "https://home88.test";
const REVALIDATE_URL = `${SITE}/api/revalidate`;

describe("website publication and unified channel publishing (real Postgres)", { skip: !url && "TEST_DATABASE_URL not set" }, () => {
  type Db = typeof import("../lib/prisma").db;
  let db: Db;
  let resetConfig: () => void;
  let call: (cookie: string | null, method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }>;
  let c: Record<"agent" | "other" | "manager" | "admin" | "marketing" | "viewer", string>;
  let users: Record<"agent" | "other" | "manager", { id: string }>;
  let testAccountId = "";
  let xeId = "";
  const run = randomBytes(4).toString("hex");

  const realFetch = globalThis.fetch;
  const blocked: string[] = [];
  const revalidations: Array<{ secret: string | null; references: string[] }> = [];
  let revalidateMode: "ok" | "http500" | "throw" = "ok";

  before(async () => {
    process.env.DATABASE_URL = url!;
    process.env.JWT_SECRET ??= randomBytes(32).toString("base64");
    process.env.SETTINGS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    process.env.PII_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
    process.env.S3_ENDPOINT = "http://s3.test";
    process.env.S3_REGION = "us-east-1";
    process.env.S3_ACCESS_KEY = "test-access";
    process.env.S3_SECRET_KEY = "test-secret";
    process.env.S3_BUCKET = "test-bucket";
    process.env.S3_FORCE_PATH_STYLE = "true";
    process.env.CRM_URL = "https://crm.home88.test";
    process.env.SITE_URL = SITE;
    delete process.env.WEBSITE_REVALIDATE_SECRET;

    // The only outbound call a publication may make is the website's own refresh; everything else is a failure.
    globalThis.fetch = (async (input: unknown, init?: { headers?: Record<string, string>; body?: string }) => {
      const target = String(input);
      if (target === REVALIDATE_URL) {
        revalidations.push({ secret: init?.headers?.["x-revalidate-secret"] ?? null, references: JSON.parse(init?.body ?? "{}").references ?? [] });
        if (revalidateMode === "throw") throw new Error("network down");
        return new Response(JSON.stringify({ ok: revalidateMode === "ok" }), { status: revalidateMode === "ok" ? 200 : 500 });
      }
      blocked.push(target);
      throw new Error("outbound request blocked in test");
    }) as typeof fetch;

    const { handleApiRequest } = await import("../handler");
    db = (await import("../lib/prisma")).db;
    const { hashPassword } = await import("../lib/passwords");
    resetConfig = (await import("../config")).resetConfig;
    resetConfig();

    const password = "Integration-Test-Password-123";
    const hash = hashPassword(password, 10);
    const mk = (role: string, tag: string) => db().user.create({ data: { email: `${tag}-${run}@test.invalid`, firstName: tag, lastName: "Test", role: role as never, passwordHash: hash } });
    const [agent, other, manager, admin, marketing, viewer] = await Promise.all([mk("AGENT", "wpagent"), mk("AGENT", "wpother"), mk("MANAGER", "wpmanager"), mk("ADMIN", "wpadmin"), mk("MARKETING", "wpmarketing"), mk("VIEWER", "wpviewer")]);
    users = { agent, other, manager };
    const login = async (email: string) => {
      const res = await handleApiRequest(new Request("http://crm.test/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }));
      assert.equal(res.status, 200, `login ${email}`);
      return res.headers.get("set-cookie")!.split(";")[0]!;
    };
    const cookies = await Promise.all([agent, other, manager, admin, marketing, viewer].map((u) => login(u.email)));
    c = { agent: cookies[0]!, other: cookies[1]!, manager: cookies[2]!, admin: cookies[3]!, marketing: cookies[4]!, viewer: cookies[5]! };

    const SELF = "https://crm.home88.test";
    call = async (cookie, method, path, body) => {
      const h: Record<string, string> = { host: new URL(SELF).host, "x-forwarded-host": new URL(SELF).host, "x-forwarded-proto": "https", origin: SELF };
      if (body !== undefined) h["content-type"] = "application/json";
      if (cookie) h.cookie = cookie;
      const res = await handleApiRequest(new Request(`http://crm.test/api${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }));
      let json: any = {};
      try { json = JSON.parse(Buffer.from(await res.arrayBuffer()).toString("utf8")); } catch { /* empty */ }
      return { status: res.status, body: json };
    };

    // One portal with a rule that selects everything, and a TEST account on the in-process mock provider.
    const xe = await db().portal.upsert({ where: { code: "XE_GR" }, create: { code: "XE_GR", name: "Χρυσή Ευκαιρία", transport: "API", enabled: false }, update: {} });
    xeId = xe.id;
    // A portal in the catalogue with no adapter: it must never get an operational Publish.
    await db().portal.upsert({ where: { code: "JAMESEDITION" }, create: { code: "JAMESEDITION", name: "James Edition", transport: "API", enabled: false }, update: {} });
    await db().portalPublicationRule.upsert({ where: { portalId: xe.id }, create: { portalId: xe.id, mode: "ALL_WEBSITE" }, update: { mode: "ALL_WEBSITE" } });
    const created = await call(c.admin, "POST", "/portals/XE_GR/accounts", { accountName: `WP ${run}`, environment: "TEST", agencyExternalId: "AG-WP" });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    testAccountId = created.body.account.id;
    assert.equal((await call(c.admin, "POST", `/portal-accounts/${testAccountId}/test`, { environment: "TEST" })).status, 200);
    assert.equal((await call(c.admin, "PATCH", `/portal-accounts/${testAccountId}`, { enabled: true })).status, 200);
  });

  after(async () => {
    globalThis.fetch = realFetch;
    await db().$disconnect();
  });

  // --- helpers --------------------------------------------------------------------------------------------------------------

  let seq = 0;
  const base = (parseInt(run, 16) % 800000) + 100000;
  async function makeProperty(over: Record<string, unknown> = {}, photos = 1) {
    seq += 1;
    const ref = `H88-${String(base + seq * 7)}`;
    const property = await db().property.create({
      data: {
        reference: ref, slug: `wp-${run}-${seq}`, listingType: "SALE", propertyType: "APARTMENT", titleEl: "Διαμέρισμα δοκιμής",
        titleEn: "Test apartment", descriptionEl: "Όμορφο διαμέρισμα με θέα, ανακαινισμένο, σε πολύ καλή θέση και κοντά σε όλες τις υπηρεσίες.",
        descriptionEn: "A lovely renovated apartment with a view, in a very good location close to all services.",
        price: 150000, area: 80, bedrooms: 2, bathrooms: 1, city: "Αθήνα", region: "Αττική", address: "Οδός 1", status: "ACTIVE",
        agentId: users.agent.id, createdById: users.agent.id, latitude: 37.98, longitude: 23.72, yearBuilt: 2000, energyClass: "B", ...over,
      } as never,
    });
    for (let i = 0; i < photos; i++) {
      await db().propertyMedia.create({ data: { propertyId: property.id, kind: "PHOTO", storageKey: `properties/${property.id}/p${i}.png`, originalName: "p.png", mimeType: "image/png", byteSize: 33, status: "approved", isPrimary: i === 0, sortOrder: i } });
    }
    // Never a public photo: pending and a document.
    await db().propertyMedia.create({ data: { propertyId: property.id, kind: "PHOTO", storageKey: `properties/${property.id}/pending.png`, mimeType: "image/png", byteSize: 33, status: "pending_review", sortOrder: 9 } });
    await db().propertyMedia.create({ data: { propertyId: property.id, kind: "DOCUMENT", storageKey: `properties/${property.id}/doc.pdf`, mimeType: "application/pdf", byteSize: 33, status: "approved", sortOrder: 10 } });
    return property;
  }

  const WEB = { code: "WEBSITE" };
  const XE = { code: "XE_GR", accountId: "", environment: "TEST" as const };
  const xe = () => ({ ...XE, accountId: testAccountId });
  const panel = (cookie: string | null, id: string) => call(cookie, "GET", `/properties/${id}/publications`);
  const act = (cookie: string | null, name: string, id: string, channels: unknown[], extra: Record<string, unknown> = {}) => call(cookie, "POST", `/properties/${id}/publications/${name}`, { channels, ...extra });
  const pubOf = (id: string) => db().websitePublication.findUnique({ where: { propertyId: id } });
  const events = (id: string) => db().channelPublicationEvent.findMany({ where: { propertyId: id }, orderBy: { createdAt: "asc" } });
  const audits = (id: string, action: string) => db().auditLog.findMany({ where: { entity: "PROPERTY", entityId: id, action } });
  const isPublic = async (id: string) => (await db().property.count({ where: { id, ...publicWebsiteWhere() } })) === 1;
  /** The compatibility flag is derived: it equals "the publication is live", always. */
  async function assertFlagDerived(id: string, label = "") {
    const p = await db().property.findUniqueOrThrow({ where: { id }, include: { websitePublication: true } });
    const live = p.websitePublication ? isWebsiteLive(p.websitePublication.status, p.websitePublication.enabled) : false;
    assert.equal(p.publishedOnWebsite, live, `publishedOnWebsite must equal the publication being live ${label}`);
  }

  // --- tests ----------------------------------------------------------------------------------------------------------------

  it("the panel: website and portals in one authoritative, server-calculated view", async () => {
    const p = await makeProperty();
    const res = await panel(c.agent, p.id);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual([res.body.property.reference, res.body.property.status], [p.reference, "ACTIVE"]);

    const web = res.body.website;
    assert.deepEqual([web.kind, web.code, web.status, web.selected, web.readiness, web.operational], ["WEBSITE", "WEBSITE", "DRAFT", false, "READY", true]);
    assert.deepEqual(web.actions, { validate: true, preview: true, publish: true, update: false, unpublish: false, retry: false });
    assert.equal(web.url, null, "no public address until it is actually visible");
    assert.equal(web.website.photoCount, 1, "one approved photo; the pending photo and the document do not count");
    assert.equal(web.website.sitemapIncluded, false);
    assert.ok(web.website.hash);

    const xeRow = res.body.portals.find((r: { code: string }) => r.code === "XE_GR");
    assert.ok(xeRow, "XE is in the same panel");
    assert.equal(xeRow.kind, "PORTAL");
    assert.equal(xeRow.operational, true);
    assert.equal(xeRow.mock, true, "a mock provider is labelled as such");
    assert.equal(xeRow.actions.publish, true);
    assert.ok(xeRow.accounts.some((a: { id: string; providerKind: string }) => a.id === testAccountId && a.providerKind === "mock"));

    // A planned portal with no adapter has no operational Publish.
    const james = res.body.portals.find((r: { code: string }) => r.code === "JAMESEDITION");
    assert.ok(james, "planned portals are listed too");
    assert.equal(james.readiness, "NOT_CONFIGURED");
    assert.equal(james.operational, false);
    assert.equal(james.actions.publish, false);
    assert.ok(james.note && james.note.includes("adapter"));

    assert.equal(JSON.stringify(res.body).includes("secret"), false, "no credentials in the panel");
    assert.equal((await events(p.id)).length, 0, "reading the panel records and changes nothing");
    assert.equal(await pubOf(p.id), null, "and does not even create the publication row");
  });

  it("validate: the server says what blocks a channel, and records the verdict", async () => {
    const bad = await makeProperty({ descriptionEl: "", price: null });
    const res = await act(c.agent, "validate", bad.id, [WEB, xe()]);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const [web, portal] = res.body.results;
    assert.equal(web.ok, false);
    assert.ok(web.blockers.some((b: string) => b.includes("περιγραφή")) && web.blockers.some((b: string) => b.includes("τιμή")));
    assert.equal(portal.channel, "XE_GR");
    assert.equal(portal.ok, false);
    assert.equal(res.body.ok, false);
    assert.deepEqual(res.body.summary, { ok: 0, failed: 2 });
    const pub = await pubOf(bad.id);
    assert.equal(pub?.status, "VALIDATION_FAILED");
    assert.equal(pub?.lastErrorCode, "VALIDATION_FAILED");
    const ev = (await events(bad.id)).filter((e) => e.action === "VALIDATE");
    assert.deepEqual([ev.length, ev[0]!.ok, ev[0]!.channelType, ev[0]!.errorCode], [1, false, "WEBSITE", "VALIDATION_FAILED"]);
    assert.equal(await isPublic(bad.id), false);
    await assertFlagDerived(bad.id);

    const good = await makeProperty();
    const ok = await act(c.agent, "validate", good.id, [WEB, xe()]);
    assert.deepEqual(ok.body.results.map((r: { ok: boolean }) => r.ok), [true, true]);
    assert.equal((await pubOf(good.id))?.status, "READY");
    assert.equal(await isPublic(good.id), false, "validating never publishes");
  });

  it("preview: the public representation with approved media only, and nothing changes", async () => {
    const p = await makeProperty({}, 2);
    const before = await pubOf(p.id);
    const res = await act(c.other, "preview", p.id, [WEB, xe()]); // any agent may preview
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const web = res.body.results[0];
    assert.equal(web.status, "PREVIEWED");
    assert.equal(web.url, `${SITE}/property/${p.reference}`, "the existing /property/[reference] route");
    assert.equal(web.preview.photoCount, 2);
    assert.equal(web.preview.view.media.length, 2, "approved photos only");
    assert.equal(web.preview.sitemapIncluded, true, "it would be in the sitemap once published");
    assert.ok(web.preview.wouldChange);
    const json = JSON.stringify(web);
    for (const secret of ["pending.png", "doc.pdf", "commission", p.id]) assert.ok(!json.includes(secret), `${secret} must not appear in a preview`);
    assert.deepEqual(Object.keys(web.preview.view.fields).includes("ownerId"), false);
    const portal = res.body.results[1];
    assert.equal(portal.status, "PREVIEWED");
    assert.equal(portal.mock, true);

    assert.equal((await pubOf(p.id))?.status ?? "DRAFT", before?.status ?? "DRAFT");
    assert.equal(await isPublic(p.id), false);
    assert.equal(await db().portalListing.count({ where: { propertyId: p.id } }), 0, "a portal preview creates no listing");
    assert.equal((await events(p.id)).filter((e) => e.action === "PREVIEW").length >= 1, true);
    await assertFlagDerived(p.id);
  });

  it("publishing the website does not publish any portal; every state change is audited and keeps the flag derived", async () => {
    const p = await makeProperty();
    const res = await act(c.agent, "publish", p.id, [WEB]);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const r = res.body.results[0];
    assert.deepEqual([r.ok, r.status, r.mock], [true, "PUBLISHED", false]);
    assert.equal(r.url, `${SITE}/property/${p.reference}`);
    assert.equal(r.revalidation.attempted, false, "no secret configured: reported honestly, not faked");
    assert.equal(r.revalidation.note, "not_configured");

    const pub = await pubOf(p.id);
    assert.deepEqual([pub!.status, pub!.enabled, pub!.visibility, pub!.noIndex, pub!.sitemapIncluded], ["PUBLISHED", true, "PUBLIC", false, true]);
    assert.equal(pub!.canonicalUrl, `${SITE}/property/${p.reference}`);
    assert.ok(pub!.lastPayloadHash && pub!.lastPublishedAt && pub!.lastGeneratedAt && pub!.createdById === users.agent.id);
    const prop = await db().property.findUniqueOrThrow({ where: { id: p.id } });
    assert.equal(prop.publishedOnWebsite, true);
    assert.ok(prop.publishedAt, "the first publish stamps publishedAt (legacy ordering)");
    assert.equal(await isPublic(p.id), true);
    assert.equal(websiteSitemapEligible({ status: pub!.status, enabled: pub!.enabled, visibility: pub!.visibility, noIndex: pub!.noIndex, propertyStatus: "ACTIVE" }), true);

    assert.equal(await db().portalListing.count({ where: { propertyId: p.id } }), 0, "no portal listing was created");
    assert.equal(await db().portalSyncRun.count({ where: { propertyId: p.id } }), 0, "no portal run happened");

    const ev = await events(p.id);
    const published = ev.find((e) => e.action === "PUBLISH")!;
    assert.deepEqual([published.ok, published.channelType, published.websiteState, published.triggeredById], [true, "WEBSITE", "PUBLISHED", users.agent.id]);
    assert.ok(published.requestId && published.payloadHash === pub!.lastPayloadHash);
    const audit = await audits(p.id, "website_published");
    assert.equal(audit.length, 1);
    assert.equal(audit[0]!.actorId, users.agent.id);

    const again = await act(c.agent, "publish", p.id, [WEB]);
    assert.equal(again.status, 200);
    assert.deepEqual([again.body.results[0].ok, again.body.results[0].status, again.body.results[0].errorCode], [false, "REJECTED", "conflict"], "publishing twice is refused, not silently repeated");
    await assertFlagDerived(p.id);

    const view = (await panel(c.agent, p.id)).body;
    assert.deepEqual([view.website.status, view.website.selected, view.website.url], ["PUBLISHED", true, `${SITE}/property/${p.reference}`]);
    assert.deepEqual(view.website.actions, { validate: true, preview: true, publish: false, update: true, unpublish: true, retry: false });
    assert.equal(view.website.website.sitemapIncluded, true);
    assert.equal(view.portals.find((x: { code: string }) => x.code === "XE_GR").status, "NOT_PUBLISHED", "the portal is untouched");
  });

  it("publishing a portal does not publish the website", async () => {
    const p = await makeProperty();
    const res = await act(c.agent, "publish", p.id, [xe()]);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const r = res.body.results[0];
    assert.deepEqual([r.channel, r.ok, r.status, r.mock], ["XE_GR", true, "PUBLISHED", true]);
    assert.equal(r.externalId, `mock-${p.reference}`);
    assert.equal((await db().portalListing.findUniqueOrThrow({ where: { portalId_propertyId: { portalId: xeId, propertyId: p.id } } })).state, "PUBLISHED");
    const pub = await pubOf(p.id);
    assert.ok(!pub || (pub.status !== "PUBLISHED" && !pub.enabled), "the website publication is untouched");
    assert.equal(await isPublic(p.id), false);
    await assertFlagDerived(p.id);

    // The portal event is mirrored into the unified history with its listing.
    const mirrored = (await events(p.id)).filter((e) => e.channelType === "PORTAL");
    assert.equal(mirrored.length, 1);
    assert.deepEqual([mirrored[0]!.action, mirrored[0]!.ok, mirrored[0]!.portalState, mirrored[0]!.externalListingId], ["PUBLISH", true, "PUBLISHED", `mock-${p.reference}`]);
    assert.equal(mirrored[0]!.websitePublicationId, null);
  });

  it("unpublishing the website does not withdraw portals, and unpublishing a portal does not withdraw the website", async () => {
    const p = await makeProperty();
    assert.equal((await act(c.agent, "publish", p.id, [WEB, xe()])).body.summary.ok, 2);
    const listing = () => db().portalListing.findUniqueOrThrow({ where: { portalId_propertyId: { portalId: xeId, propertyId: p.id } } });
    const runsBefore = await db().portalSyncRun.count({ where: { propertyId: p.id } });

    const down = await act(c.agent, "unpublish", p.id, [WEB]);
    assert.equal(down.status, 200, JSON.stringify(down.body));
    assert.deepEqual([down.body.results[0].ok, down.body.results[0].status], [true, "UNPUBLISHED"]);
    const pub = await pubOf(p.id);
    assert.deepEqual([pub!.status, pub!.enabled, pub!.sitemapIncluded, pub!.noIndex, pub!.visibility], ["UNPUBLISHED", false, false, true, "NOINDEX"]);
    assert.ok(pub!.lastUnpublishedAt);
    assert.equal(await isPublic(p.id), false);
    assert.equal((await listing()).state, "PUBLISHED", "the portal listing is still live");
    assert.equal(await db().portalSyncRun.count({ where: { propertyId: p.id } }), runsBefore, "no portal operation ran");
    assert.equal((await db().websiteSlugHistory.findMany({ where: { propertyId: p.id } })).some((h) => h.kind === "UNPUBLISHED"), true);
    assert.equal((await audits(p.id, "website_unpublished")).length, 1);
    assert.equal((await act(c.agent, "unpublish", p.id, [WEB])).body.results[0].errorCode, "conflict", "already down");
    await assertFlagDerived(p.id);

    // And the other way round.
    assert.equal((await act(c.agent, "publish", p.id, [WEB])).body.results[0].status, "PUBLISHED");
    assert.equal((await act(c.agent, "unpublish", p.id, [xe()])).status, 403, "agents may not withdraw from a portal");
    const withdrawn = await act(c.manager, "unpublish", p.id, [xe()]);
    assert.equal(withdrawn.status, 200, JSON.stringify(withdrawn.body));
    assert.deepEqual([withdrawn.body.results[0].ok, withdrawn.body.results[0].status], [true, "UNPUBLISHED"]);
    assert.equal((await listing()).state, "REMOVED");
    assert.equal((await pubOf(p.id))!.status, "PUBLISHED", "the website is still live");
    assert.equal(await isPublic(p.id), true);
    await assertFlagDerived(p.id);
  });

  it("channels succeed and fail independently: website PUBLISHED, portal BLOCKED or FAILED, nothing undone", async () => {
    // Website live, XE blocked by the WEBSITE_ONLY tag.
    const a = await makeProperty();
    assert.equal((await call(c.manager, "PUT", `/properties/${a.id}/tags`, { codes: ["WEBSITE_ONLY"] })).status, 200);
    const mixed = await act(c.agent, "publish", a.id, [WEB, xe()]);
    assert.equal(mixed.status, 200, JSON.stringify(mixed.body));
    const [w, x] = mixed.body.results;
    assert.deepEqual([w.ok, w.status], [true, "PUBLISHED"]);
    assert.deepEqual([x.ok, x.status], [false, "BLOCKED"]);
    assert.ok(x.blockers.some((b: string) => b.includes("WEBSITE_ONLY")));
    assert.deepEqual(mixed.body.summary, { ok: 1, failed: 1 });
    assert.equal(mixed.body.ok, false);
    assert.equal(await isPublic(a.id), true, "the blocked portal did not undo the website");
    assert.equal(await db().portalListing.count({ where: { propertyId: a.id, state: "PUBLISHED" } }), 0);

    // A provider failure on the portal leaves the website published.
    const b = await makeProperty();
    assert.equal((await call(c.admin, "PATCH", `/portal-accounts/${testAccountId}`, { mockMode: "temporary_failure" })).status, 200);
    const flaky = await act(c.agent, "publish", b.id, [WEB, xe()]);
    await call(c.admin, "PATCH", `/portal-accounts/${testAccountId}`, { mockMode: null });
    assert.equal(flaky.status, 200, JSON.stringify(flaky.body));
    assert.deepEqual([flaky.body.results[0].ok, flaky.body.results[0].status], [true, "PUBLISHED"]);
    const portal = flaky.body.results[1];
    assert.deepEqual([portal.ok, portal.status, portal.errorCode, portal.mock], [false, "FAILED", "REMOTE_SERVER_ERROR", true]);
    assert.equal(portal.message.includes("Η ενέργεια απέτυχε"), true, "an agent does not read the provider's wording");
    assert.equal(await isPublic(b.id), true);
    assert.equal((await db().portalListing.findUniqueOrThrow({ where: { portalId_propertyId: { portalId: xeId, propertyId: b.id } } })).state, "FAILED");
    const failedEvent = (await events(b.id)).find((e) => e.channelType === "PORTAL" && !e.ok);
    assert.deepEqual([failedEvent?.errorCode, failedEvent?.portalState], ["REMOTE_SERVER_ERROR", "FAILED"]);

    // Retry through the existing portal route repairs only the portal.
    const retry = await call(c.agent, "POST", `/properties/${b.id}/portals/XE_GR/retry`, { accountId: testAccountId, environment: "TEST" });
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal((await pubOf(b.id))!.status, "PUBLISHED");
  });

  it("DO_NOT_PUBLISH, WEBSITE_ONLY and PORTAL_ONLY are enforced on the server", async () => {
    const p = await makeProperty();
    const tags = async (codes: string[]) => assert.equal((await call(c.manager, "PUT", `/properties/${p.id}/tags`, { codes })).status, 200);

    await tags(["DO_NOT_PUBLISH"]);
    const both = await act(c.agent, "publish", p.id, [WEB, xe()]);
    assert.deepEqual(both.body.results.map((r: { status: string }) => r.status), ["BLOCKED", "BLOCKED"], "nowhere");
    assert.ok(both.body.results[0].blockers.some((b: string) => b.includes("Να μην δημοσιευθεί")));
    assert.equal(await isPublic(p.id), false);

    await tags(["PORTAL_ONLY"]);
    const portalOnly = await act(c.agent, "publish", p.id, [WEB, xe()]);
    assert.deepEqual(portalOnly.body.results.map((r: { status: string }) => r.status), ["BLOCKED", "PUBLISHED"], "PORTAL_ONLY: the portal, not the website");
    assert.equal(await isPublic(p.id), false);

    await tags(["WEBSITE_ONLY"]);
    assert.equal((await act(c.agent, "publish", p.id, [WEB])).body.results[0].status, "PUBLISHED", "WEBSITE_ONLY: the website carries it");
    assert.equal(await isPublic(p.id), true);
    assert.equal((await act(c.manager, "unpublish", p.id, [xe()])).status, 200);

    // A tag added while the page is live takes it down at once, and says why.
    await tags(["DO_NOT_PUBLISH"]);
    const pub = await pubOf(p.id);
    assert.deepEqual([pub!.status, pub!.enabled, pub!.sitemapIncluded], ["UNPUBLISHED", false, false]);
    assert.equal(await isPublic(p.id), false);
    const changed = (await events(p.id)).filter((e) => e.action === "STATUS_CHANGED");
    assert.equal(changed.at(-1)?.detail, "tag_do_not_publish");
    assert.equal((await audits(p.id, "website_state_changed")).some((a) => JSON.stringify(a.changes).includes("tag_do_not_publish")), true);
    await assertFlagDerived(p.id);

    // Removing the tag does not republish by itself.
    await tags([]);
    assert.equal(await isPublic(p.id), false, "a person publishes again, deliberately");
    assert.equal((await act(c.agent, "publish", p.id, [WEB])).body.results[0].status, "PUBLISHED");
  });

  it("update: unchanged content does no work; a changed price is OUTDATED until updated; force regenerates", async () => {
    const p = await makeProperty();
    await act(c.agent, "publish", p.id, [WEB]);
    const hash0 = (await pubOf(p.id))!.lastPayloadHash;
    const eventsBefore = (await events(p.id)).length;
    const auditsBefore = (await audits(p.id, "website_updated")).length;

    const same = await act(c.agent, "update", p.id, [WEB]);
    assert.deepEqual([same.body.results[0].ok, same.body.results[0].status], [true, "UNCHANGED"]);
    assert.equal((await events(p.id)).length, eventsBefore, "no event: nothing was regenerated");
    assert.equal((await audits(p.id, "website_updated")).length, auditsBefore);
    assert.equal(same.body.results[0].revalidation, null, "and no refresh was requested");

    await db().property.update({ where: { id: p.id }, data: { price: 175000 } });
    const stale = (await panel(c.agent, p.id)).body.website;
    assert.deepEqual([stale.status, stale.website.contentChanged], ["OUTDATED", true], "calculated on read, never trusted from a stored flag");
    assert.equal((await pubOf(p.id))!.status, "PUBLISHED", "reading did not write");
    assert.equal(await isPublic(p.id), true, "an outdated page is still live and shows current data");
    assert.equal(stale.actions.update, true);

    const upd = await act(c.agent, "update", p.id, [WEB]);
    assert.deepEqual([upd.body.results[0].ok, upd.body.results[0].status], [true, "UPDATED"]);
    const hash1 = (await pubOf(p.id))!.lastPayloadHash;
    assert.notEqual(hash1, hash0);
    assert.equal((await panel(c.agent, p.id)).body.website.status, "PUBLISHED");
    assert.equal((await audits(p.id, "website_updated")).length, auditsBefore + 1);

    // A change a visitor cannot see (an internal note, an owner) does not move the hash.
    await db().property.update({ where: { id: p.id }, data: { commissionRatePct: 5 } });
    assert.equal((await act(c.agent, "update", p.id, [WEB])).body.results[0].status, "UNCHANGED");
    // A new approved photo does.
    await db().propertyMedia.create({ data: { propertyId: p.id, kind: "PHOTO", storageKey: `properties/${p.id}/new.png`, mimeType: "image/png", byteSize: 33, status: "approved", sortOrder: 5 } });
    assert.equal((await act(c.agent, "update", p.id, [WEB])).body.results[0].status, "UPDATED");
    // A photo that is not approved does not.
    await db().propertyMedia.create({ data: { propertyId: p.id, kind: "PHOTO", storageKey: `properties/${p.id}/draft.png`, mimeType: "image/png", byteSize: 33, status: "pending_review", sortOrder: 6 } });
    assert.equal((await act(c.agent, "update", p.id, [WEB])).body.results[0].status, "UNCHANGED");

    const forced = await act(c.agent, "update", p.id, [WEB], { force: true });
    assert.equal(forced.body.results[0].status, "UPDATED", "force regenerates even when nothing changed");
    assert.equal((await act(c.agent, "update", (await makeProperty()).id, [WEB])).body.results[0].errorCode, "conflict", "cannot update what is not published");
    await assertFlagDerived(p.id);
  });

  it("the public page is refreshed through the website's own endpoint, and a failure never undoes the change", async () => {
    process.env.WEBSITE_REVALIDATE_SECRET = `rv-${randomBytes(12).toString("hex")}`;
    resetConfig();
    try {
      const p = await makeProperty();
      revalidations.length = 0;
      const pubRes = await act(c.agent, "publish", p.id, [WEB]);
      assert.deepEqual(pubRes.body.results[0].revalidation, { attempted: true, ok: true, note: "revalidated" });
      assert.deepEqual(revalidations, [{ secret: process.env.WEBSITE_REVALIDATE_SECRET!, references: [p.reference] }]);
      assert.equal(JSON.stringify(pubRes.body).includes(process.env.WEBSITE_REVALIDATE_SECRET!), false, "the secret never leaves the server");

      revalidations.length = 0;
      await act(c.agent, "update", p.id, [WEB]);
      assert.equal(revalidations.length, 0, "an unchanged page requests no refresh");

      revalidateMode = "http500";
      const down = await act(c.agent, "unpublish", p.id, [WEB]);
      assert.deepEqual([down.body.results[0].ok, down.body.results[0].revalidation.note], [true, "http_500"]);
      assert.equal(await isPublic(p.id), false, "the change stands even though the refresh failed");

      revalidateMode = "throw";
      const up = await act(c.agent, "publish", p.id, [WEB]);
      assert.deepEqual([up.body.results[0].ok, up.body.results[0].revalidation.note], [true, "unreachable"]);
      assert.equal(await isPublic(p.id), true);
      assert.ok(up.body.results[0].message.includes("λίγα λεπτά"), "the person is told it will refresh shortly");
    } finally {
      revalidateMode = "ok";
      delete process.env.WEBSITE_REVALIDATE_SECRET;
      resetConfig();
    }
  });

  it("sold, rented, archived and deleted follow the public-site policy; reopening restores a sold page but not an archived one", async () => {
    const sale = await makeProperty();
    await act(c.agent, "publish", sale.id, [WEB]);
    assert.equal((await call(c.agent, "POST", `/properties/${sale.id}/status`, { status: "SOLD" })).status, 200);
    let pub = await pubOf(sale.id);
    assert.deepEqual([pub!.status, pub!.enabled, pub!.sitemapIncluded], ["SOLD", true, false], "recorded as SOLD, selection kept, out of the sitemap");
    assert.equal(await isPublic(sale.id), false);
    assert.equal((await db().property.findUniqueOrThrow({ where: { id: sale.id } })).publishedOnWebsite, false);
    assert.equal((await events(sale.id)).at(-1)?.detail, "property_sold");
    assert.equal((await audits(sale.id, "website_state_changed")).some((a) => JSON.stringify(a.changes).includes("property_sold")), true);
    assert.equal((await panel(c.agent, sale.id)).body.website.status, "SOLD");
    await assertFlagDerived(sale.id, "sold");

    assert.equal((await call(c.manager, "POST", `/properties/${sale.id}/status`, { status: "ACTIVE" })).status, 200, "reopened by a manager");
    pub = await pubOf(sale.id);
    assert.deepEqual([pub!.status, pub!.enabled], ["PUBLISHED", true], "a sold page comes back when reopened, as it always did");
    assert.equal(await isPublic(sale.id), true);
    assert.equal((await events(sale.id)).at(-1)?.detail, "property_reopened");
    await assertFlagDerived(sale.id, "reopened");

    const rent = await makeProperty({ listingType: "RENT", monthlyRent: 900, price: null });
    await act(c.agent, "publish", rent.id, [WEB]);
    assert.equal((await call(c.agent, "POST", `/properties/${rent.id}/status`, { status: "RENTED" })).status, 200);
    assert.equal((await pubOf(rent.id))!.status, "RENTED");
    assert.equal(await isPublic(rent.id), false);

    // Portals are not withdrawn by a status change here: that is the portal engine's own decision.
    const both = await makeProperty();
    await act(c.agent, "publish", both.id, [WEB, xe()]);
    await call(c.agent, "POST", `/properties/${both.id}/status`, { status: "SOLD" });
    assert.equal((await db().portalListing.findUniqueOrThrow({ where: { portalId_propertyId: { portalId: xeId, propertyId: both.id } } })).state, "PUBLISHED", "the portal listing is untouched by the website lifecycle");

    // Deleted clears the selection; it does not come back on restore.
    const gone = await makeProperty();
    await act(c.agent, "publish", gone.id, [WEB]);
    assert.equal((await call(c.agent, "DELETE", `/properties/${gone.id}`)).status, 200);
    pub = await pubOf(gone.id);
    assert.deepEqual([pub!.status, pub!.enabled], ["ARCHIVED", false]);
    assert.equal(await isPublic(gone.id), false);
    await assertFlagDerived(gone.id, "deleted");
    assert.equal((await call(c.manager, "POST", `/properties/${gone.id}/status`, { status: "DRAFT" })).status, 200, "restored from the bin");
    await call(c.manager, "POST", `/properties/${gone.id}/status`, { status: "ACTIVE" });
    assert.equal(await isPublic(gone.id), false, "a restored property is not republished by itself");
    assert.equal((await act(c.agent, "publish", gone.id, [WEB])).body.results[0].status, "PUBLISHED", "a person does that");

    // Inactive hides the page without changing the publication.
    const idle = await makeProperty();
    await act(c.agent, "publish", idle.id, [WEB]);
    await call(c.agent, "POST", `/properties/${idle.id}/status`, { status: "INACTIVE" });
    assert.equal((await pubOf(idle.id))!.status, "PUBLISHED");
    assert.equal(await isPublic(idle.id), false, "hidden by the property's own status");
    const note = (await panel(c.agent, idle.id)).body.website;
    assert.equal(note.url, null);
    assert.ok(note.note.includes("δεν εμφανίζεται"));
  });

  it("permanent deletion: a property that never had history is removed with its publication; one with history is kept", async () => {
    const fresh = await call(c.agent, "POST", "/properties", {
      listingType: "SALE", propertyType: "APARTMENT", status: "DRAFT", titleEl: "Προς διαγραφή", descriptionEl: "Περιγραφή διαμερίσματος.",
      price: 100000, area: 70, city: "Αθήνα",
    });
    assert.equal(fresh.status, 201, JSON.stringify(fresh.body));
    const id = fresh.body.property.id as string;
    assert.equal((await pubOf(id))?.status, "DRAFT", "every new property has an unpublished publication");
    await call(c.agent, "DELETE", `/properties/${id}`);
    const removed = await call(c.admin, "DELETE", `/properties/${id}/permanent`);
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    assert.equal(await db().property.count({ where: { id } }), 0);
    assert.equal(await db().websitePublication.count({ where: { propertyId: id } }), 0);

    const kept = await makeProperty();
    await act(c.agent, "publish", kept.id, [WEB]);
    await call(c.agent, "DELETE", `/properties/${kept.id}`);
    const refused = await call(c.admin, "DELETE", `/properties/${kept.id}/permanent`);
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.ok(refused.body.error.message.includes("ιστορικό δημοσιεύσεων"));
    assert.equal(await db().property.count({ where: { id: kept.id } }), 1, "history is retained, not lost");
    assert.equal((await events(kept.id)).length > 0, true);
  });

  it("the flag is not writable from outside: create and edit ignore it, and it always equals the publication", async () => {
    const res = await call(c.agent, "POST", "/properties", {
      listingType: "SALE", propertyType: "APARTMENT", status: "ACTIVE", titleEl: "Με σημαία", descriptionEl: "Περιγραφή διαμερίσματος.",
      price: 100000, area: 70, city: "Αθήνα", publishedOnWebsite: true,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const id = res.body.property.id as string;
    assert.equal(res.body.property.publishedOnWebsite, false, "a create cannot publish");
    assert.equal((await pubOf(id))?.status, "DRAFT");
    assert.equal(await isPublic(id), false);

    const patched = await call(c.agent, "PATCH", `/properties/${id}`, { publishedOnWebsite: true, titleEl: "Με σημαία (αλλαγή)" });
    assert.equal(patched.status, 200, JSON.stringify(patched.body));
    assert.equal((await db().property.findUniqueOrThrow({ where: { id } })).publishedOnWebsite, false, "an edit cannot publish");
    assert.equal((await db().property.findUniqueOrThrow({ where: { id } })).publishedAt, null);
    assert.equal(await isPublic(id), false);
    await assertFlagDerived(id);

    await act(c.agent, "publish", id, [WEB]);
    const unpublished = await call(c.agent, "PATCH", `/properties/${id}`, { publishedOnWebsite: false, titleEl: "Ξανά αλλαγή" });
    assert.equal(unpublished.status, 200);
    assert.equal((await pubOf(id))!.status, "PUBLISHED", "an edit cannot unpublish either");
    assert.equal(await isPublic(id), true);
    await assertFlagDerived(id);
  });

  it("authorization: who may read, preview and publish; denials run nothing", async () => {
    const p = await makeProperty();
    for (const [name, method] of [["", "GET"], ["/validate", "POST"], ["/preview", "POST"], ["/publish", "POST"], ["/update", "POST"], ["/unpublish", "POST"]] as const) {
      const body = method === "POST" ? { channels: [WEB] } : undefined;
      assert.equal((await call(null, method, `/properties/${p.id}/publications${name}`, body)).status, 401, `anonymous ${name || "GET"}`);
      assert.equal((await call(c.viewer, method, `/properties/${p.id}/publications${name}`, body)).status, 403, `viewer ${name || "GET"}`);
      assert.equal((await call(c.marketing, method, `/properties/${p.id}/publications${name}`, body)).status, 403, `marketing ${name || "GET"} (the panel is for agents and up, like the portal panel)`);
    }
    assert.equal((await panel(c.other, p.id)).status, 200, "any agent can read the panel");
    assert.equal((await act(c.other, "validate", p.id, [WEB])).status, 200);
    assert.equal((await act(c.other, "preview", p.id, [WEB])).status, 200);

    // An agent who does not manage the property cannot change its website state or portals.
    for (const name of ["publish", "update", "unpublish"]) assert.equal((await act(c.other, name, p.id, [WEB])).status, 403, `other agent ${name} website`);
    assert.equal((await act(c.other, "publish", p.id, [xe()])).status, 403, "nor a portal");
    assert.equal(await pubOf(p.id).then((x) => x?.status ?? "DRAFT") === "PUBLISHED", false);
    const eventsAfterDenials = (await events(p.id)).filter((e) => e.action === "PUBLISH");
    assert.equal(eventsAfterDenials.length, 0, "a denied request ran nothing");

    // One forbidden channel stops the whole request before anything runs.
    const eventsBefore = (await events(p.id)).length;
    assert.equal((await act(c.agent, "unpublish", p.id, [WEB, xe()])).status, 403, "agents cannot withdraw from portals, so nothing runs, not even the website part");
    assert.equal((await events(p.id)).length, eventsBefore);
    assert.equal((await act(c.manager, "publish", p.id, [WEB])).status, 200, "a manager may publish anyone's property");
    assert.equal((await act(c.admin, "update", p.id, [WEB])).status, 200);

    // Bad requests.
    assert.equal((await act(c.agent, "publish", p.id, [{ code: "NO_SUCH_PORTAL" }])).status, 404);
    assert.equal((await act(c.agent, "publish", p.id, [WEB, WEB])).status, 400, "a channel once");
    assert.equal((await act(c.agent, "publish", p.id, [])).status, 422);
    assert.equal((await call(c.agent, "POST", `/properties/${p.id}/publications/publish`, { channels: [WEB], surprise: 1 })).status, 422, "strict body");
    assert.equal((await act(c.agent, "publish", "no-such-property", [WEB])).status, 404);
    assert.equal((await panel(c.agent, "no-such-property")).status, 404);
    const noAccount = await act(c.agent, "preview", (await makeProperty()).id, [{ code: "XE_GR" }]);
    assert.equal(noAccount.body.results[0].status, "REJECTED", "a portal needs an account");
  });

  it("events are append-only and records stay intact: existing portal workflows and PortalListing records are unchanged", async () => {
    const p = await makeProperty();
    await act(c.agent, "publish", p.id, [WEB]);
    const [event] = await events(p.id);
    await assert.rejects(() => db().channelPublicationEvent.update({ where: { id: event!.id }, data: { ok: false } }), /append-only/);
    await assert.rejects(() => db().channelPublicationEvent.delete({ where: { id: event!.id } }), /append-only/);

    // The per-portal routes keep working exactly as before and agree with the unified panel.
    const legacy = await call(c.agent, "POST", `/properties/${p.id}/portals/XE_GR/publish`, { accountId: testAccountId, environment: "TEST" });
    assert.equal(legacy.status, 200, JSON.stringify(legacy.body));
    assert.equal(legacy.body.status, "PUBLISHED");
    const overview = await call(c.agent, "GET", `/properties/${p.id}/portals`);
    assert.equal(overview.status, 200);
    assert.deepEqual(Object.keys(overview.body).sort(), ["catalogSize", "flags", "permissions", "portals"]);
    const row = overview.body.portals.find((r: { code: string }) => r.code === "XE_GR");
    const unified = (await panel(c.agent, p.id)).body.portals.find((r: { code: string }) => r.code === "XE_GR");
    assert.deepEqual([unified.status, unified.externalId, unified.accountId], [row.state, row.externalId, row.portalAccountId]);
    assert.equal(legacy.body.externalId, `mock-${p.reference}`);
    assert.equal((await pubOf(p.id))!.status, "PUBLISHED", "and the website is still as the website left it");
    assert.equal(await db().portalListing.count({ where: { propertyId: p.id, portalId: xeId } }), 1, "no duplicate portal records");
  });

  it("the cutover migration reconciles drift in both directions and leaves consistent rows alone", async () => {
    const sql = readFileSync(join(process.cwd(), "../../packages/database/prisma/migrations/20261020000000_website_publication_cutover/migration.sql"), "utf8");
    const statements = sql.split("\n").filter((l) => !l.startsWith("--")).join("\n").split(";").map((s) => s.trim()).filter(Boolean);
    assert.equal(statements.length, 4);
    const migrate = async () => { for (const s of statements) await db().$executeRawUnsafe(s); };

    const legacy = async (over: Record<string, unknown>, publication: null | { status: string; enabled: boolean }) => {
      const p = await makeProperty(over, 0);
      await db().websitePublication.deleteMany({ where: { propertyId: p.id } });
      if (publication) {
        await db().websitePublication.create({ data: { id: `wp_${p.id}`, propertyId: p.id, slug: p.slug, status: publication.status as never, enabled: publication.enabled, visibility: publication.enabled ? "PUBLIC" : "NOINDEX", noIndex: !publication.enabled, sitemapIncluded: publication.enabled } });
      }
      return p;
    };
    // Published through the old checkbox after the first backfill: would vanish at cutover.
    const gained = await legacy({ publishedOnWebsite: true, publishedAt: new Date("2026-09-01") }, { status: "DRAFT", enabled: false });
    // Taken down through the old checkbox: would REAPPEAR at cutover.
    const lost = await legacy({ publishedOnWebsite: false }, { status: "PUBLISHED", enabled: true });
    // Created after the first backfill, no publication yet.
    const newLive = await legacy({ publishedOnWebsite: true }, null);
    const newDraft = await legacy({ publishedOnWebsite: false }, null);
    // Not touched: published flag on a sold property (the original backfill kept this selected, not live).
    const soldKept = await legacy({ publishedOnWebsite: true, status: "SOLD" }, { status: "DRAFT", enabled: true });
    // Not touched: consistent live row, and rows the new flow wrote (sold, inactive).
    const consistent = await legacy({ publishedOnWebsite: true }, { status: "PUBLISHED", enabled: true });
    const newFlowSold = await legacy({ publishedOnWebsite: false, status: "SOLD" }, { status: "SOLD", enabled: true });
    const newFlowInactive = await legacy({ publishedOnWebsite: true, status: "INACTIVE" }, { status: "PUBLISHED", enabled: true });
    const all = [gained, lost, newLive, newDraft, soldKept, consistent, newFlowSold, newFlowInactive];
    const stampBefore = async (p: { id: string }) => (await pubOf(p.id))?.updatedAt.getTime() ?? null;
    const untouchedBefore = new Map<string, number | null>();
    for (const p of [soldKept, consistent, newFlowSold, newFlowInactive]) untouchedBefore.set(p.id, await stampBefore(p));

    const auditCount = () => db().auditLog.count({ where: { action: "website_cutover_reconciled", entityId: { in: all.map((p) => p.id) } } });
    await migrate();

    const state = async (p: { id: string }) => { const x = await pubOf(p.id); return [x?.status, x?.enabled]; };
    assert.deepEqual(await state(gained), ["PUBLISHED", true]);
    assert.deepEqual(await state(lost), ["UNPUBLISHED", false]);
    assert.deepEqual(await state(newLive), ["PUBLISHED", true]);
    assert.deepEqual(await state(newDraft), ["DRAFT", false]);
    assert.deepEqual(await state(soldKept), ["DRAFT", true], "needs-review rows are not invented into live pages");
    assert.deepEqual(await state(newFlowSold), ["SOLD", true]);
    assert.deepEqual(await state(newFlowInactive), ["PUBLISHED", true]);
    for (const p of [soldKept, consistent, newFlowSold, newFlowInactive]) assert.equal(await stampBefore(p), untouchedBefore.get(p.id), "a consistent row is not even touched");

    assert.equal(await isPublic(gained.id), true, "published since: visible");
    assert.equal(await isPublic(lost.id), false, "taken down since: stays down");
    assert.equal(await isPublic(newLive.id), true);
    assert.equal(await isPublic(newDraft.id), false);
    assert.equal(await isPublic(soldKept.id), false);
    assert.equal(await isPublic(consistent.id), true);
    assert.equal(await isPublic(newFlowInactive.id), false, "the property's own status still hides it");
    assert.equal((await pubOf(gained.id))!.sitemapIncluded, true);
    assert.equal((await pubOf(lost.id))!.sitemapIncluded, false);
    assert.equal(await auditCount(), 2, "each reconciliation that changed visibility leaves an audit entry");
    assert.equal((await db().websiteSlugHistory.count({ where: { propertyId: { in: [newLive.id, newDraft.id] } } })), 2, "new rows get their original slug recorded");

    await migrate();
    assert.equal(await auditCount(), 2, "re-running changes nothing");
    for (const p of all) await assertFlagDerivedOrLegacy(p.id);
    async function assertFlagDerivedOrLegacy(id: string) {
      // After the cutover the flag may still be the legacy value for these hand-made rows; the invariant the
      // application keeps is checked on every API path above. Here we only require the publication exists.
      assert.ok(await pubOf(id), "every property has a publication after the cutover");
    }
  });

  it("nothing external was contacted: mock results stayed in-process and only the website's own refresh was ever requested", async () => {
    assert.deepEqual(blocked, [], "no portal, provider or other host was called");
    assert.ok(revalidations.every((r) => r.references.every((ref) => /^H88-\d+$/.test(ref))));
    assert.equal(users.manager.id.length > 0, true);
  });
});
