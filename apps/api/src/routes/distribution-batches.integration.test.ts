/**
 * Bulk portal distribution through the real API and a real Postgres: planning,
 * durable batches, claiming and concurrency, partial failure and retry, stale
 * locks, cancellation, permissions, server-side selection, and the workspace
 * table. Portals are the in-process mock; `fetch` is trapped so any outbound
 * request fails the run. Runs only with TEST_DATABASE_URL.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";

const url = process.env.TEST_DATABASE_URL;

describe("bulk portal distribution (real Postgres)", { skip: !url && "TEST_DATABASE_URL not set" }, () => {
  let db: typeof import("../lib/prisma").db;
  let call: (cookie: string | null, method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }>;
  let c: Record<"agent" | "other" | "manager" | "viewer" | "admin", string>;
  let owner = "";
  let otherId = "";
  let accountId = "";
  let xeId = "";
  const run = randomBytes(4).toString("hex");
  const realFetch = globalThis.fetch;
  const blocked: string[] = [];

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
    process.env.SITE_URL = "https://home88.test";
    delete process.env.WEBSITE_REVALIDATE_SECRET;
    globalThis.fetch = (async (input: unknown) => { blocked.push(String(input)); throw new Error("outbound request blocked in test"); }) as typeof fetch;

    const { handleApiRequest } = await import("../handler");
    db = (await import("../lib/prisma")).db;
    const { hashPassword } = await import("../lib/passwords");
    (await import("../config")).resetConfig();
    const password = "Integration-Test-Password-123";
    const hash = hashPassword(password, 10);
    const mk = (role: string, tag: string) => db().user.create({ data: { email: `bb${tag}-${run}@test.invalid`, firstName: tag, lastName: "T", role: role as never, passwordHash: hash } });
    const [agent, other, manager, viewer, admin] = await Promise.all([mk("AGENT", "agent"), mk("AGENT", "other"), mk("MANAGER", "manager"), mk("VIEWER", "viewer"), mk("ADMIN", "admin")]);
    owner = agent.id;
    otherId = other.id;
    const SELF = "https://crm.home88.test";
    const headers = (cookie: string | null, json: boolean): Record<string, string> => ({ host: new URL(SELF).host, "x-forwarded-host": new URL(SELF).host, "x-forwarded-proto": "https", origin: SELF, ...(json ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) });
    const login = async (email: string) => {
      const res = await handleApiRequest(new Request("http://crm.test/api/auth/login", { method: "POST", headers: headers(null, true), body: JSON.stringify({ email, password }) }));
      assert.equal(res.status, 200, email);
      return res.headers.get("set-cookie")!.split(";")[0]!;
    };
    const cookies = await Promise.all([agent, other, manager, viewer, admin].map((u) => login(u.email)));
    c = { agent: cookies[0]!, other: cookies[1]!, manager: cookies[2]!, viewer: cookies[3]!, admin: cookies[4]! };
    call = async (cookie, method, path, body) => {
      const res = await handleApiRequest(new Request(`http://crm.test/api${path}`, { method, headers: headers(cookie, body !== undefined), body: body === undefined ? undefined : JSON.stringify(body) }));
      let json: any = {};
      try { json = JSON.parse(Buffer.from(await res.arrayBuffer()).toString("utf8")); } catch { /* empty */ }
      return { status: res.status, body: json };
    };

    const xe = await db().portal.upsert({ where: { code: "XE_GR" }, create: { code: "XE_GR", name: "Χρυσή Ευκαιρία", transport: "API", enabled: false }, update: {} });
    xeId = xe.id;
    await db().portalPublicationRule.upsert({ where: { portalId: xe.id }, create: { portalId: xe.id, mode: "ALL_WEBSITE" }, update: { mode: "ALL_WEBSITE" } });
    const created = await call(c.admin, "POST", "/portals/XE_GR/accounts", { accountName: `BB ${run}`, environment: "TEST", agencyExternalId: "AG-BB" });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    accountId = created.body.account.id;
    assert.equal((await call(c.admin, "POST", `/portal-accounts/${accountId}/test`, { environment: "TEST" })).status, 200);
    assert.equal((await call(c.admin, "PATCH", `/portal-accounts/${accountId}`, { enabled: true })).status, 200);
  });

  after(async () => {
    globalThis.fetch = realFetch;
    await db().$disconnect();
  });

  let seq = 0;
  const base = (parseInt(run, 16) % 700000) + 100000;
  async function make(over: Record<string, unknown> = {}, agentId = owner) {
    seq += 1;
    const ref = `H88-${String(base + seq * 11)}`;
    const p = await db().property.create({
      data: {
        reference: ref, slug: `bb-${run}-${seq}`, listingType: "SALE", propertyType: "APARTMENT", titleEl: `Διαμέρισμα ${ref}`, titleEn: "Apartment",
        descriptionEl: "Όμορφο διαμέρισμα με θέα, ανακαινισμένο, σε πολύ καλή θέση και κοντά σε όλες τις υπηρεσίες.", descriptionEn: "A lovely renovated apartment with a view close to all services.",
        price: 150000, area: 80, bedrooms: 2, bathrooms: 1, city: `Πόλη${run}`, region: "Αττική", address: "Οδός 1", status: "ACTIVE", agentId, createdById: agentId, latitude: 37.98, longitude: 23.72, yearBuilt: 2000, energyClass: "B", ...over,
      } as never,
    });
    await db().propertyMedia.create({ data: { propertyId: p.id, kind: "PHOTO", storageKey: `properties/${p.id}/p.png`, originalName: "p.png", mimeType: "image/png", byteSize: 33, status: "approved", isPrimary: true, sortOrder: 0 } });
    return p;
  }
  const XE = () => ({ code: "XE_GR", accountId, environment: "TEST" as const });
  const plan = (cookie: string, op: string, ids: string[], extra: Record<string, unknown> = {}) => call(cookie, "POST", "/distribution/plan", { operation: op, selection: { ids }, portals: [XE()], ...extra });
  const create = (cookie: string, op: string, ids: string[], extra: Record<string, unknown> = {}) => call(cookie, "POST", "/distribution/batches", { operation: op, selection: { ids }, portals: [XE()], ...extra });
  const drain = async (cookie: string, id: string, max = 30) => {
    let state: any;
    for (let i = 0; i < max; i++) {
      state = (await call(cookie, "POST", `/distribution/batches/${id}/process`)).body;
      if (state.status === "COMPLETED" || state.status === "CANCELLED") return state;
    }
    return state;
  };
  const listing = (propertyId: string) => db().portalListing.findUnique({ where: { portalId_propertyId: { portalId: xeId, propertyId } } });

  it("planning judges every property for every portal, changes nothing, and groups identical blockers", async () => {
    const a = await make();
    const b = await make();
    const foreign = await make({}, otherId); // not the agent's property
    const noDesc = await make({ descriptionEl: "", price: null });
    const before = await db().portalListing.count({ where: { propertyId: { in: [a.id, b.id, foreign.id, noDesc.id] } } });
    const res = await plan(c.agent, "publish", [a.id, b.id, foreign.id, noDesc.id]);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.summary, { ready: 2, blocked: 2 });
    const byProp = new Map<string, any>(res.body.items.map((i: any) => [i.propertyId, i]));
    assert.ok(byProp.get(foreign.id).blockers.some((x: string) => x.includes("δικαίωμα επεξεργασίας")));
    assert.ok(byProp.get(noDesc.id).blockers.length > 0);
    assert.equal(res.body.readyPreview.length, 2);
    assert.ok(res.body.readyPreview.every((i: any) => i.mock === true), "mock account is labelled");
    assert.ok(res.body.blockerGroups.length >= 1 && res.body.blockerGroups.every((g: any) => g.count >= 1));
    assert.equal(await db().portalListing.count({ where: { propertyId: { in: [a.id, b.id, foreign.id, noDesc.id] } } }), before, "planning creates nothing");
    assert.equal(await db().portalDistributionBatch.count({ where: { createdById: owner } }), 0, "and no batch");
  });

  it("a batch is durable, idempotent and runs through the real portal service: nothing is sent at creation", async () => {
    const props = await Promise.all([make(), make(), make(), make(), make(), make()]);
    const ids = props.map((p) => p.id);
    const key = `key-${run}-1`;
    const created = await create(c.agent, "publish", ids, { idempotencyKey: key });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.deepEqual(created.body.summary, { ready: 6, blocked: 0 });
    for (const id of ids) assert.equal(await listing(id), null, "queued is not published");
    const again = await create(c.agent, "publish", ids, { idempotencyKey: key });
    assert.deepEqual([again.status, again.body.id, again.body.reused], [200, created.body.id, true], "a double click is one batch");
    assert.equal(await db().portalDistributionBatch.count({ where: { idempotencyKey: key } }), 1);
    assert.equal((await call(c.other, "GET", `/distribution/batches/${created.body.id}`)).status, 403, "another agent cannot read it");

    const first = (await call(c.agent, "POST", `/distribution/batches/${created.body.id}/process`)).body;
    assert.equal(first.counts.SUCCEEDED, 4, "a few items per call");
    assert.equal(first.status, "RUNNING");
    assert.ok(first.progress > 0 && first.progress < 1);
    const done = await drain(c.agent, created.body.id);
    assert.equal(done.status, "COMPLETED");
    assert.deepEqual([done.counts.SUCCEEDED, done.counts.FAILED, done.counts.QUEUED], [6, 0, 0]);
    for (const p of props) {
      assert.equal((await listing(p.id))?.state, "PUBLISHED");
      const pub = await db().websitePublication.findUnique({ where: { propertyId: p.id } });
      assert.ok(!pub || pub.status !== "PUBLISHED", "the website is untouched");
    }
    assert.ok(done.items.every((i: any) => i.mock && i.externalId?.startsWith("mock-") && i.attempts === 1));
    assert.equal(await db().auditLog.count({ where: { entity: "PORTAL", entityId: created.body.id, action: "portal_batch_created" } }), 1);
    const events = await db().channelPublicationEvent.count({ where: { propertyId: { in: ids }, channelType: "PORTAL", action: "PUBLISH" } });
    assert.equal(events, 6, "every item left a unified publication event");
    assert.deepEqual(blocked, []);
  });

  it("two workers on one batch never run an item twice", async () => {
    const props = await Promise.all([make(), make(), make(), make(), make()]);
    const created = await create(c.agent, "publish", props.map((p) => p.id));
    await Promise.all([
      call(c.agent, "POST", `/distribution/batches/${created.body.id}/process`),
      call(c.agent, "POST", `/distribution/batches/${created.body.id}/process`),
      call(c.agent, "POST", `/distribution/batches/${created.body.id}/process`),
    ]);
    const done = await drain(c.agent, created.body.id);
    assert.equal(done.counts.SUCCEEDED, 5);
    const items = await db().portalDistributionItem.findMany({ where: { batchId: created.body.id } });
    assert.ok(items.every((i) => i.attempts === 1), "each item was attempted once");
    for (const p of props) assert.equal(await db().portalListing.count({ where: { propertyId: p.id, portalId: xeId } }), 1);
  });

  it("partial failure is reported per item; retry re-queues only the failed and never repeats the succeeded", async () => {
    const props = await Promise.all([make(), make(), make()]);
    const created = await create(c.agent, "publish", props.map((p) => p.id));
    assert.equal((await call(c.admin, "PATCH", `/portal-accounts/${accountId}`, { mockMode: "temporary_failure" })).status, 200);
    const failed = await drain(c.agent, created.body.id);
    assert.equal(failed.status, "COMPLETED", "a finished batch with failures is still reported as finished");
    assert.deepEqual([failed.counts.FAILED, failed.counts.SUCCEEDED], [3, 0]);
    assert.ok(failed.items.every((i: any) => i.errorCode && i.message && i.attempts === 1));

    await call(c.admin, "PATCH", `/portal-accounts/${accountId}`, { mockMode: null });
    // One of them is fixed by hand through the ordinary button first.
    assert.equal((await call(c.agent, "POST", `/properties/${props[0]!.id}/portals/XE_GR/retry`, { accountId, environment: "TEST" })).status, 200);
    const retried = await call(c.agent, "POST", `/distribution/batches/${created.body.id}/retry`);
    assert.equal(retried.status, 200, JSON.stringify(retried.body));
    assert.equal(retried.body.counts.QUEUED, 3);
    const done = await drain(c.agent, created.body.id);
    // The one fixed by hand is already published: re-running it is refused, honestly, not repeated.
    assert.deepEqual([done.counts.SUCCEEDED, done.counts.FAILED], [2, 1], done.items.map((i: any) => `${i.status}:${i.message}`).join("|"));
    const fixed = done.items.find((i: any) => i.propertyId === props[0]!.id);
    assert.equal(fixed.status, "FAILED");
    assert.ok(/δημοσιευμέν/i.test(fixed.message ?? ""), fixed.message);
    for (const p of props) assert.equal(await db().portalListing.count({ where: { propertyId: p.id, portalId: xeId } }), 1, "no duplicate listing");

    // Retries are bounded: the item that cannot succeed stops being re-queued after its last attempt.
    await call(c.agent, "POST", `/distribution/batches/${created.body.id}/retry`);
    await drain(c.agent, created.body.id);
    const bounded = await call(c.agent, "POST", `/distribution/batches/${created.body.id}/retry`);
    assert.equal(bounded.body.counts.QUEUED, 0);
    assert.equal(bounded.body.counts.SUCCEEDED, 2, "the succeeded items were never run again");
    assert.ok(bounded.body.items.filter((i: any) => i.status === "SUCCEEDED").every((i: any) => i.attempts === 2), "attempts: one failure, one success");
  });

  it("an item whose worker died is reclaimed; one that keeps dying fails with a clear reason", async () => {
    const [p1, p2] = await Promise.all([make(), make()]);
    const created = await create(c.agent, "publish", [p1.id, p2.id]);
    const items = await db().portalDistributionItem.findMany({ where: { batchId: created.body.id }, orderBy: { propertyId: "asc" } });
    const old = new Date(Date.now() - 10 * 60 * 1000);
    await db().portalDistributionItem.update({ where: { id: items[0]!.id }, data: { status: "RUNNING", lockedAt: old, attempts: 1 } });
    await db().portalDistributionItem.update({ where: { id: items[1]!.id }, data: { status: "RUNNING", lockedAt: old, attempts: 3 } });
    const done = await drain(c.agent, created.body.id);
    const byId = new Map<string, any>(done.items.map((i: any) => [i.id, i]));
    assert.deepEqual([byId.get(items[0]!.id).status, byId.get(items[0]!.id).attempts], ["SUCCEEDED", 2]);
    assert.deepEqual([byId.get(items[1]!.id).status, byId.get(items[1]!.id).errorCode], ["FAILED", "worker_lost"]);
    assert.equal(done.status, "COMPLETED");
  });

  it("cancel stops queued work and leaves finished work alone", async () => {
    const props = await Promise.all([make(), make(), make(), make(), make(), make()]);
    const created = await create(c.agent, "publish", props.map((p) => p.id));
    await call(c.agent, "POST", `/distribution/batches/${created.body.id}/process`); // 4 run
    const cancelled = await call(c.agent, "POST", `/distribution/batches/${created.body.id}/cancel`);
    assert.equal(cancelled.status, 200);
    assert.deepEqual([cancelled.body.status, cancelled.body.counts.SUCCEEDED, cancelled.body.counts.CANCELLED], ["CANCELLED", 4, 2]);
    const after = await call(c.agent, "POST", `/distribution/batches/${created.body.id}/process`);
    assert.equal(after.body.counts.SUCCEEDED, 4, "a cancelled batch does nothing more");
    assert.equal((await call(c.other, "POST", `/distribution/batches/${created.body.id}/cancel`)).status, 403);
    assert.equal((await call(c.agent, "POST", `/distribution/batches/${created.body.id}/retry`)).status, 400);
  });

  it("permissions: viewers are refused, unpublish needs a manager, items run with the creator's own rights", async () => {
    const p = await make();
    assert.equal((await plan(c.viewer, "publish", [p.id])).status, 403);
    assert.equal((await plan(c.agent, "unpublish", [p.id])).status, 403, "agents may not withdraw from portals");
    // An agent bulk-publishing someone else's property: blocked at planning, and never runs.
    const foreign = await make({}, otherId);
    const attempt = await create(c.agent, "publish", [foreign.id]);
    assert.equal(attempt.status, 400, "nothing ready, so no batch");
    assert.equal(await db().portalDistributionBatch.count({ where: { selection: { path: ["properties"], equals: 1 }, createdById: owner, items: { some: { propertyId: foreign.id } } } }), 0);
    // A manager may publish anyone's property and withdraw it again in bulk, and sees other people's batches.
    const mine = await create(c.manager, "publish", [foreign.id, p.id]);
    assert.equal(mine.status, 201, JSON.stringify(mine.body));
    assert.equal((await drain(c.manager, mine.body.id)).counts.SUCCEEDED, 2);
    const down = await create(c.manager, "unpublish", [foreign.id, p.id]);
    assert.equal((await drain(c.manager, down.body.id)).counts.SUCCEEDED, 2);
    assert.equal((await listing(p.id))?.state, "REMOVED");
    assert.equal((await call(c.manager, "GET", `/distribution/batches/${created0(mine)}`)).status, 200);
    const mineList = await call(c.agent, "GET", "/distribution/batches");
    assert.ok(mineList.body.data.every((b: any) => b.mine), "an agent lists only their own batches");
    assert.ok((await call(c.manager, "GET", "/distribution/batches")).body.data.length >= mineList.body.data.length);
    function created0(r: { body: any }) { return r.body.id; }
  });

  it("selection happens on the server: a filter resolves to ids, rows can be excluded, the cap holds", async () => {
    const city = `Επιλογή${run}`;
    const props = await Promise.all([make({ city }), make({ city }), make({ city }), make({ city: "Αλλού" })]);
    const filtered = await call(c.agent, "POST", "/distribution/plan", { operation: "publish", selection: { filter: { city } }, portals: [XE()] });
    assert.equal(filtered.status, 200, JSON.stringify(filtered.body));
    assert.deepEqual([filtered.body.propertyCount, filtered.body.matched, filtered.body.summary.ready], [3, 3, 3]);
    const excl = await call(c.agent, "POST", "/distribution/plan", { operation: "publish", selection: { filter: { city }, exclude: [props[0]!.id] }, portals: [XE()] });
    assert.equal(excl.body.propertyCount, 2);
    assert.equal((await call(c.agent, "POST", "/distribution/plan", { operation: "publish", selection: { ids: [props[0]!.id], filter: { city } }, portals: [XE()] })).status, 422, "ids or filter, not both");
    const tooMany = await call(c.agent, "POST", "/distribution/plan", { operation: "publish", selection: { ids: Array.from({ length: 501 }, (_, i) => `x${i}`) }, portals: [XE()] });
    assert.equal(tooMany.status, 422);
    assert.equal((await call(c.agent, "POST", "/distribution/plan", { operation: "publish", selection: { ids: [props[0]!.id] }, portals: [{ code: "XE_GR", accountId: "nope", environment: "TEST" }] })).body.summary.blocked, 1, "an unknown account blocks, it does not run");
  });

  it("the workspace table filters, paginates and summarises portals on the server", async () => {
    const city = `Πίνακας${run}`;
    const props = await Promise.all(Array.from({ length: 5 }, () => make({ city })));
    const done = await create(c.agent, "publish", [props[0]!.id, props[1]!.id]);
    await drain(c.agent, done.body.id);
    const page1 = await call(c.agent, "GET", `/distribution/properties?city=${encodeURIComponent(city)}&limit=2&page=1`);
    assert.equal(page1.status, 200, JSON.stringify(page1.body));
    assert.deepEqual([page1.body.total, page1.body.data.length, page1.body.maxBatch], [5, 2, 500]);
    const page3 = await call(c.agent, "GET", `/distribution/properties?city=${encodeURIComponent(city)}&limit=2&page=3`);
    assert.equal(page3.body.data.length, 1);
    const seen = new Set([...page1.body.data, ...(await call(c.agent, "GET", `/distribution/properties?city=${encodeURIComponent(city)}&limit=2&page=2`)).body.data, ...page3.body.data].map((r: any) => r.id));
    assert.equal(seen.size, 5, "stable order: every row exactly once across pages");
    const published = await call(c.agent, "GET", `/distribution/properties?city=${encodeURIComponent(city)}&portalState=PUBLISHED`);
    assert.equal(published.body.total, 2);
    assert.ok(published.body.data.every((r: any) => r.portals.published === 1));
    assert.equal((await call(c.agent, "GET", `/distribution/properties?city=${encodeURIComponent(city)}&portalState=NONE`)).body.total, 3);
    const row = page1.body.data[0];
    assert.deepEqual(Object.keys(row).sort(), ["agent", "areaName", "city", "id", "listingType", "portals", "price", "priceOnRequest", "propertyType", "reference", "status", "title", "website"]);
    assert.equal((await call(c.viewer, "GET", "/distribution/properties")).status, 403);
  });

  it("a bulk withdrawal that looks like a mistake is held until a person explicitly confirms it", async () => {
    const portal = await db().portal.findUniqueOrThrow({ where: { id: xeId } });
    const original = portal.settings;
    try {
      // Make the guard sensitive so a small withdrawal trips it regardless of how many listings other tests left.
      await db().portal.update({ where: { id: xeId }, data: { settings: { ...((original ?? {}) as object), publicationGuard: { maxDropPercent: 0.01, minPreviousForPercent: 1 } } } });
      const props = await Promise.all([make(), make()]);
      const ids = props.map((p) => p.id);
      const up = await create(c.manager, "publish", ids);
      assert.equal((await drain(c.manager, up.body.id)).counts.SUCCEEDED, 2);
      assert.deepEqual((await plan(c.manager, "publish", [(await make()).id])).body.guards, [], "publishing never trips the removal guard");

      const held = await plan(c.manager, "unpublish", ids);
      assert.equal(held.status, 200, JSON.stringify(held.body));
      assert.deepEqual(held.body.summary, { ready: 0, blocked: 2 });
      assert.equal(held.body.guards.length, 1);
      assert.deepEqual([held.body.guards[0].portalCode, held.body.guards[0].removing, held.body.guards[0].confirmed], ["XE_GR", 2, false]);
      assert.ok(held.body.guards[0].message.includes("επιβεβαίωση"));
      assert.ok(held.body.items.every((i: any) => i.blockers[0].includes("επιβεβαίωση")));
      assert.equal((await create(c.manager, "unpublish", ids)).status, 400, "no batch is created while the guard holds everything");
      for (const id of ids) assert.equal((await listing(id))?.state, "PUBLISHED", "nothing was withdrawn");

      const confirmed = await plan(c.manager, "unpublish", ids, { confirmMassRemoval: true });
      assert.deepEqual([confirmed.body.summary.ready, confirmed.body.guards[0].confirmed], [2, true]);
      const down = await create(c.manager, "unpublish", ids, { confirmMassRemoval: true });
      assert.equal(down.status, 201, JSON.stringify(down.body));
      assert.equal((await drain(c.manager, down.body.id)).counts.SUCCEEDED, 2);
      for (const id of ids) assert.equal((await listing(id))?.state, "REMOVED");
      const audit = await db().auditLog.findFirst({ where: { entity: "PORTAL", entityId: down.body.id, action: "portal_batch_created" } });
      assert.ok(JSON.stringify(audit?.changes).includes("massRemovalConfirmed"), "the confirmation is on the record");
      assert.equal((await plan(c.agent, "unpublish", ids, { confirmMassRemoval: true })).status, 403, "confirming does not grant the right to withdraw");
    } finally {
      await db().portal.update({ where: { id: xeId }, data: { settings: (original ?? {}) as never } });
    }
  });

  it("nothing external was contacted", () => {
    assert.deepEqual(blocked, []);
  });
});
