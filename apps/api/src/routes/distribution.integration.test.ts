/**
 * The portal directory endpoint against a real Postgres: every destination with an
 * honest status, filters, access, and no secrets. Runs only with TEST_DATABASE_URL.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";

const url = process.env.TEST_DATABASE_URL;

describe("portal directory (real Postgres)", { skip: !url && "TEST_DATABASE_URL not set" }, () => {
  let db: typeof import("../lib/prisma").db;
  let get: (cookie: string | null, path: string) => Promise<{ status: number; body: any }>;
  let agent = "";
  let viewer = "";
  const run = randomBytes(4).toString("hex");

  before(async () => {
    process.env.DATABASE_URL = url!;
    process.env.JWT_SECRET ??= randomBytes(32).toString("base64");
    process.env.SETTINGS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    process.env.PII_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
    process.env.CRM_URL = "https://crm.home88.test";
    const { handleApiRequest } = await import("../handler");
    db = (await import("../lib/prisma")).db;
    const { hashPassword } = await import("../lib/passwords");
    (await import("../config")).resetConfig();
    const password = "Integration-Test-Password-123";
    const hash = hashPassword(password, 10);
    const mk = (role: string) => db().user.create({ data: { email: `dist-${role.toLowerCase()}-${run}@test.invalid`, firstName: "D", lastName: role, role: role as never, passwordHash: hash } });
    const [a, v] = await Promise.all([mk("AGENT"), mk("VIEWER")]);
    const SELF = "https://crm.home88.test";
    const headers = (cookie: string | null): Record<string, string> => ({ host: new URL(SELF).host, "x-forwarded-host": new URL(SELF).host, "x-forwarded-proto": "https", origin: SELF, ...(cookie ? { cookie } : {}) });
    const login = async (email: string) => {
      const res = await handleApiRequest(new Request("http://crm.test/api/auth/login", { method: "POST", headers: { ...headers(null), "content-type": "application/json" }, body: JSON.stringify({ email, password }) }));
      assert.equal(res.status, 200);
      return res.headers.get("set-cookie")!.split(";")[0]!;
    };
    agent = await login(a.email);
    viewer = await login(v.email);
    get = async (cookie, path) => {
      const res = await handleApiRequest(new Request(`http://crm.test/api${path}`, { headers: headers(cookie) }));
      return { status: res.status, body: JSON.parse(Buffer.from(await res.arrayBuffer()).toString("utf8") || "{}") };
    };
  });
  after(async () => { await db().$disconnect(); });

  it("lists every destination; nothing is connected without a successful sync; no secrets", async () => {
    const res = await get(agent, "/distribution/portals");
    assert.equal(res.status, 200);
    assert.ok(res.body.total >= 60, "Greek, international and aggregator destinations");
    const byKey = new Map<string, any>(res.body.data.map((r: any) => [r.key, r]));
    for (const k of ["SPITOGATOS", "XE_GR", "INDOMIO_GR", "KYERO", "GREEN_ACRES", "RIGHTMOVE", "TROVIT"]) assert.ok(byKey.has(k), k);
    assert.equal(res.body.counts.CONNECTED, 0, "a fresh database has no connected portal");
    // Research candidates have no live block; framework portals do, and expose no credential field.
    assert.equal(byKey.get("RIGHTMOVE").live, null);
    assert.equal(byKey.get("RIGHTMOVE").status, "NEEDS_SPECIFICATION");
    assert.equal(byKey.get("KYERO").status, "CATALOG_ONLY");
    assert.ok(["AWAITING_ACCOUNT", "READY_FOR_TEST", "PAUSED", "CATALOG_ONLY"].includes(byKey.get("SPITOGATOS").status));
    assert.deepEqual(Object.keys(byKey.get("SPITOGATOS").live).sort(), ["enabled", "lastError", "lastSuccessAt"]);
    assert.ok(!/password|appKey|token/i.test(JSON.stringify(res.body)));
    const sum = Object.values(res.body.counts as Record<string, number>).reduce((x, y) => x + y, 0);
    assert.equal(sum, res.body.total);
  });

  it("filters server-side and ignores unknown status values", async () => {
    const greek = await get(agent, "/distribution/portals?country=GR&priority=A");
    assert.equal(greek.body.data.length, 6);
    assert.ok(greek.body.data.every((r: any) => r.country === "GR" && r.priority === "A"));
    assert.equal(greek.body.total > greek.body.data.length, true, "total stays the unfiltered size");
    const grp = await get(agent, `/distribution/portals?group=${encodeURIComponent("Indomio Group")}`);
    assert.equal(grp.body.data.length, 4);
    assert.equal((await get(agent, "/distribution/portals?q=kyero")).body.data.length, 1);
    assert.equal((await get(agent, "/distribution/portals?status=BOGUS")).body.data.length, greek.body.total);
  });

  it("recommendations: explainable rules over verified facts, performance unavailable, nothing invented", async () => {
    const a = await db().user.findFirstOrThrow({ where: { email: { startsWith: "dist-agent" } } });
    const mk = (over: Record<string, unknown>) => db().property.create({ data: { reference: `H88-${String(700000 + Math.floor(Math.random() * 99999))}`, slug: `rec-${run}-${Math.random().toString(36).slice(2, 8)}`, listingType: "SALE", propertyType: "APARTMENT", titleEl: "Διαμέρισμα", descriptionEl: "Περιγραφή διαμερίσματος.", price: 100000, area: 70, city: "Αθήνα", status: "ACTIVE", agentId: a.id, createdById: a.id, ...over } as never });
    const bare = await mk({ titleEn: null, descriptionEn: null });
    const rich = await mk({ titleEn: "Apartment", descriptionEn: "A lovely apartment close to everything." });
    await db().propertyMedia.create({ data: { propertyId: rich.id, kind: "PHOTO", storageKey: `properties/${rich.id}/p.png`, mimeType: "image/png", byteSize: 33, status: "approved", isPrimary: true, sortOrder: 0 } });
    await db().propertyMedia.create({ data: { propertyId: rich.id, kind: "PHOTO", storageKey: `properties/${rich.id}/pending.png`, mimeType: "image/png", byteSize: 33, status: "pending_review", sortOrder: 1 } });

    const r1 = await get(agent, `/properties/${rich.id}/recommendations`);
    assert.equal(r1.status, 200, JSON.stringify(r1.body));
    assert.deepEqual([r1.body.basis, r1.body.performance], ["RULES", "UNAVAILABLE"]);
    const byKey = new Map<string, any>(r1.body.data.map((x: any) => [x.key, x]));
    assert.equal(r1.body.data.length, byKey.size);
    assert.ok(r1.body.data.every((x: any) => x.performance === "UNAVAILABLE" && x.basis === "RULES"));
    assert.ok(byKey.get("SPITI24").matches.includes("1 εγκεκριμένες φωτογραφίες"), "only the approved photo counts");
    assert.equal(byKey.get("KYERO").fit, "POSSIBLE", "unconfirmed Greek acceptance is never strong");
    assert.notEqual(byKey.get("GREEN_ACRES").fit, "STRONG");
    assert.equal(byKey.get("RIGHTMOVE").fit, "LOW");
    const order = ["STRONG", "POSSIBLE", "NEEDS_INFO", "LOW", "NOT_ELIGIBLE"];
    for (let i = 1; i < r1.body.data.length; i++) assert.ok(order.indexOf(r1.body.data[i - 1].fit) <= order.indexOf(r1.body.data[i].fit), "best fits first");
    assert.equal(Object.values(r1.body.counts as Record<string, number>).reduce((x, y) => x + y, 0), r1.body.data.length);

    const r2 = await get(agent, `/properties/${bare.id}/recommendations`);
    const bare2 = new Map<string, any>(r2.body.data.map((x: any) => [x.key, x]));
    assert.equal(bare2.get("SPITI24").fit, "NEEDS_INFO", "no approved photo");
    assert.ok(bare2.get("SPITI24").constraints.includes("Δεν υπάρχει εγκεκριμένη φωτογραφία."));
    assert.ok(bare2.get("KYERO").constraints.some((c: string) => c.includes("αγγλικός")), "foreign destinations need English");
    assert.equal((await get(agent, "/properties/no-such/recommendations")).status, 404);
    assert.equal((await get(viewer, `/properties/${rich.id}/recommendations`)).status, 403);
    assert.equal((await get(null, `/properties/${rich.id}/recommendations`)).status, 401);
  });

  it("needs a signed-in agent or above", async () => {
    assert.equal((await get(null, "/distribution/portals")).status, 401);
    assert.equal((await get(viewer, "/distribution/portals")).status, 403);
  });
});
