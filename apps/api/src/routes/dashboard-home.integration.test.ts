/**
 * The data behind the redesigned home page, against a real Postgres: headline totals with
 * comparison and trend, the daily series, the activity feed (what may appear, and for whom) and
 * the global search. Runs only with TEST_DATABASE_URL.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";

const url = process.env.TEST_DATABASE_URL;

describe("home page data (real Postgres)", { skip: !url && "TEST_DATABASE_URL not set" }, () => {
  let db: typeof import("../lib/prisma").db;
  let get: (cookie: string | null, path: string) => Promise<{ status: number; body: any }>;
  let c: Record<"agent" | "other" | "manager" | "viewer", string>;
  let agentId = "";
  let otherId = "";
  const run = randomBytes(4).toString("hex");

  before(async () => {
    process.env.DATABASE_URL = url!;
    process.env.JWT_SECRET ??= randomBytes(32).toString("base64");
    process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
    process.env.PII_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
    process.env.CRM_URL = "https://crm.home88.test";
    const { handleApiRequest } = await import("../handler");
    db = (await import("../lib/prisma")).db;
    const { hashPassword } = await import("../lib/passwords");
    (await import("../config")).resetConfig();
    const password = "Integration-Test-Password-123";
    const hash = hashPassword(password, 10);
    const mk = (role: string, tag: string) => db().user.create({ data: { email: `home-${tag}-${run}@test.invalid`, firstName: tag, lastName: "Home", role: role as never, passwordHash: hash } });
    const [agent, other, manager, viewer] = await Promise.all([mk("AGENT", "agent"), mk("AGENT", "other"), mk("MANAGER", "manager"), mk("VIEWER", "viewer")]);
    agentId = agent.id;
    otherId = other.id;
    const SELF = "https://crm.home88.test";
    const headers = (cookie: string | null): Record<string, string> => ({ host: new URL(SELF).host, "x-forwarded-host": new URL(SELF).host, "x-forwarded-proto": "https", origin: SELF, ...(cookie ? { cookie } : {}) });
    const login = async (email: string) => {
      const res = await handleApiRequest(new Request("http://crm.test/api/auth/login", { method: "POST", headers: { ...headers(null), "content-type": "application/json" }, body: JSON.stringify({ email, password }) }));
      assert.equal(res.status, 200, email);
      return res.headers.get("set-cookie")!.split(";")[0]!;
    };
    c = { agent: await login(agent.email), other: await login(other.email), manager: await login(manager.email), viewer: await login(viewer.email) };
    get = async (cookie, path) => {
      const res = await handleApiRequest(new Request(`http://crm.test/api${path}`, { headers: headers(cookie) }));
      return { status: res.status, body: JSON.parse(Buffer.from(await res.arrayBuffer()).toString("utf8") || "{}") };
    };
  });
  after(async () => { await db().$disconnect(); });

  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

  it("overview: totals, change against the previous 30 days, and a six-month trend, per scope", async () => {
    const before = await get(c.agent, "/dashboard/overview");
    assert.equal(before.status, 200, JSON.stringify(before.body));
    assert.equal(before.body.scope, "mine", "agents see their own work");
    assert.equal(before.body.months.length, 6);
    for (const k of ["properties", "contacts", "requests", "showings"]) {
      assert.equal(before.body.kpis[k].trend.length, 6, k);
      assert.ok(Number.isInteger(before.body.kpis[k].total) && Number.isInteger(before.body.kpis[k].flow.value) && Number.isInteger(before.body.kpis[k].flow.previous), k);
    }
    // Two contacts of mine created recently, one two months ago, and someone else's.
    const mkContact = (assigned: string, createdAt: Date, tag: string) => db().contact.create({ data: { reference: `C-${run}-${tag}`, firstName: "Επαφή", lastName: tag, roles: ["BUYER"], assignedToId: assigned, createdAt } as never });
    await mkContact(agentId, daysAgo(2), "a");
    await mkContact(agentId, daysAgo(10), "b");
    await mkContact(agentId, daysAgo(40), "c"); // the previous period
    await mkContact(otherId, daysAgo(3), "d");
    const after_ = await get(c.agent, "/dashboard/overview");
    const d = (k: string, f: (x: any) => number) => f(after_.body.kpis[k]) - f(before.body.kpis[k]);
    assert.equal(d("contacts", (x) => x.total), 3, "only my contacts count in my scope");
    assert.equal(d("contacts", (x) => x.flow.value), 2, "two new in the last 30 days");
    assert.equal(d("contacts", (x) => x.flow.previous), 1, "one in the 30 days before");
    assert.equal(after_.body.kpis.contacts.trend.reduce((a: number, b: number) => a + b, 0) - before.body.kpis.contacts.trend.reduce((a: number, b: number) => a + b, 0), 3);
    const mgr = await get(c.manager, "/dashboard/overview");
    assert.equal(mgr.body.scope, "all");
    assert.ok(mgr.body.kpis.contacts.total >= after_.body.kpis.contacts.total + 1, "the whole agency includes the other agent's contact");
    assert.equal((await get(c.agent, "/dashboard/overview?scope=all")).body.scope, "mine", "an agent cannot widen their scope");
    assert.equal((await get(c.viewer, "/dashboard/overview")).status, 403);
    assert.equal((await get(null, "/dashboard/overview")).status, 401);
  });

  it("series: daily counts for 7, 30 or 90 days, zeros included, nothing else accepted", async () => {
    for (const days of [7, 30, 90]) {
      const r = await get(c.agent, `/dashboard/series?days=${days}`);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.days.length, days);
      assert.deepEqual(r.body.series.map((s: any) => s.key), ["leads", "contacts", "requests", "viewings"]);
      assert.ok(r.body.series.every((s: any) => s.values.length === days && s.total === s.values.reduce((a: number, b: number) => a + b, 0)));
    }
    const r = await get(c.agent, "/dashboard/series?days=30");
    assert.ok(r.body.series.find((s: any) => s.key === "contacts").total >= 2, "the contacts created above fall inside 30 days");
    assert.equal((await get(c.agent, "/dashboard/series?days=45")).status, 422);
  });

  it("activity: plain sentences for real CRM events, only what the person may see, never audit noise", async () => {
    const contact = await db().contact.create({ data: { reference: `C-${run}-act`, firstName: "Ελένη", lastName: `Δραστηριότητα${run}`, roles: ["BUYER"], assignedToId: agentId } as never });
    await db().auditLog.createMany({
      data: [
        { entity: "CONTACT", entityId: contact.id, action: "create", actorId: agentId },
        { entity: "CONTACT", entityId: contact.id, action: "create", actorId: otherId },
        { entity: "SETTINGS", entityId: "x", action: "create", actorId: agentId },
        { entity: "USER", entityId: agentId, action: "login", actorId: agentId },
      ],
    });
    const mine = await get(c.agent, "/dashboard/activity");
    assert.equal(mine.status, 200, JSON.stringify(mine.body));
    assert.equal(mine.body.scope, "mine");
    assert.ok(mine.body.data.length <= 8);
    const forContact = mine.body.data.filter((e: any) => e.label === `Ελένη Δραστηριότητα${run}`);
    assert.equal(forContact.length, 1, "an agent sees their own action only");
    assert.deepEqual([forContact[0].text, forContact[0].href, forContact[0].actor], ["Νέα επαφή καταχωρήθηκε", `/contacts/${contact.id}`, "agent Home"]);
    assert.ok(mine.body.data.every((e: any) => ["CONTACT", "LEAD", "PROPERTY", "VIEWING", "REQUEST", "OFFER", "MANDATE", "TRANSACTION"].includes(e.entity)), "settings, security and login events never appear");
    const all = await get(c.manager, "/dashboard/activity");
    assert.equal(all.body.scope, "all");
    assert.equal(all.body.data.filter((e: any) => e.label === `Ελένη Δραστηριότητα${run}`).length, 2, "a manager sees everyone's");
    assert.ok(all.body.data.every((e: any) => !JSON.stringify(e).includes("changes")), "no audit payloads leave the server");
  });

  it("search: one box over properties, contacts, requests, mandates and showings", async () => {
    const ref = `H88-${900000 + Math.floor(Math.random() * 90000)}`;
    const p = await db().property.create({ data: { reference: ref, slug: `srch-${run}`, listingType: "SALE", propertyType: "APARTMENT", titleEl: `Μεζονέτα Αναζήτησης ${run}`, descriptionEl: "Περιγραφή.", city: "Γλυφάδα", status: "ACTIVE", agentId, createdById: agentId } as never });
    const byTitle = await get(c.agent, `/search?q=${encodeURIComponent(`Αναζήτησης ${run}`)}`);
    assert.equal(byTitle.status, 200, JSON.stringify(byTitle.body));
    const hit = byTitle.body.results.find((r: any) => r.type === "PROPERTY");
    assert.deepEqual([hit.id, hit.href], [p.id, `/properties/${p.id}`]);
    assert.equal((await get(c.agent, `/search?q=${ref}`)).body.results.some((r: any) => r.id === p.id), true, "by reference");
    const people = await get(c.agent, "/search?q=" + encodeURIComponent(`Δραστηριότητα${run}`));
    assert.ok(people.body.results.some((r: any) => r.type === "CONTACT" && r.title === `Ελένη Δραστηριότητα${run}`));
    assert.ok(people.body.results.filter((r: any) => r.type === "CONTACT").length <= 5, "bounded per type");
    assert.ok(!JSON.stringify(people.body).match(/@|\+30/), "no email or phone in results");
    assert.equal((await get(c.agent, "/search?q=a")).status, 422, "at least two characters");
    assert.equal((await get(c.viewer, "/search?q=ab")).status, 403);
    assert.equal((await get(null, "/search?q=ab")).status, 401);
    await db().property.update({ where: { id: p.id }, data: { status: "DELETED" } });
    assert.equal((await get(c.agent, `/search?q=${ref}`)).body.results.some((r: any) => r.id === p.id), false, "deleted properties are not offered");
  });
});
