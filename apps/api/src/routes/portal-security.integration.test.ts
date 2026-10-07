/**
 * Security regression for the portal foundation, on a real Postgres:
 *  - database roles (anon / authenticated) cannot touch the portal tables, and the migration's own
 *    revoke block does what it says;
 *  - every route enforces its permission server-side for each role (the database denying rows is
 *    not what protects the API);
 *  - TEST and PRODUCTION never mix, whatever the request body claims;
 *  - credentials never leave the server: not in responses, logs, audit, snapshots or events, and
 *    rotation forces a new connection test;
 *  - portal photo links are narrow, expiring and rate-limited.
 * `fetch` is trapped throughout: no outbound request is allowed.
 *
 *   TEST_DATABASE_URL=postgresql://… npx tsx --test src/routes/portal-security.integration.test.ts
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const url = process.env.TEST_DATABASE_URL;

function png(): Buffer {
  const b = Buffer.alloc(33);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(0x0d0a1a0a, 4);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(4, 16);
  b.writeUInt32BE(3, 20);
  return b;
}

test("portal security: roles, authorization matrix, environments, credentials, media links", { skip: !url && "TEST_DATABASE_URL not set" }, async () => {
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

  const realFetch = globalThis.fetch;
  const outbound: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    outbound.push(String(input));
    throw new Error("outbound request blocked in test");
  }) as typeof fetch;

  // Everything the process writes while the test runs, to prove no secret reaches a log.
  const written: string[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => { written.push(String(chunk)); return (origOut as (...a: unknown[]) => boolean)(chunk, ...rest); }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => { written.push(String(chunk)); return (origErr as (...a: unknown[]) => boolean)(chunk, ...rest); }) as typeof process.stderr.write;

  const { handleApiRequest } = await import("../handler");
  const { db } = await import("../lib/prisma");
  const { hashPassword } = await import("../lib/passwords");
  const { resetConfig } = await import("../config");
  const { storageClient, resetStorageClient } = await import("../lib/storage");
  const { resetRateLimits } = await import("../lib/rate-limit");
  const accounts = await import("../lib/portal-accounts");
  const { portalMediaUrl } = await import("../lib/portal-media");
  resetConfig();
  resetStorageClient();
  resetRateLimits();

  const bucket = new Map<string, { body: Buffer; type: string }>();
  const sc = storageClient() as unknown as { send: (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => Promise<unknown> };
  sc.send = async (cmd) => {
    const obj = bucket.get(String(cmd.input.Key));
    if (cmd.constructor.name === "GetObjectCommand" && obj) return { Body: { transformToByteArray: async () => new Uint8Array(obj.body) }, ContentType: obj.type };
    throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
  };

  const run = randomBytes(4).toString("hex");
  const password = "Integration-Test-Password-123";
  const hash = hashPassword(password, 10);
  const mk = (role: string, tag: string) => db().user.create({ data: { email: `${tag}-${run}@test.invalid`, firstName: tag, lastName: "Sec", role: role as never, passwordHash: hash } });
  const [agent, other, viewer, manager, admin, superAdmin] = await Promise.all([mk("AGENT", "sagent"), mk("AGENT", "sother"), mk("VIEWER", "sviewer"), mk("MANAGER", "smanager"), mk("ADMIN", "sadmin"), mk("SUPER_ADMIN", "ssuper")]);
  async function login(email: string) {
    const res = await handleApiRequest(new Request("http://crm.test/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }));
    assert.equal(res.status, 200, `login ${email}`);
    return res.headers.get("set-cookie")!.split(";")[0]!;
  }
  const [agentC, otherC, viewerC, managerC, adminC, superC] = await Promise.all([login(agent.email), login(other.email), login(viewer.email), login(manager.email), login(admin.email), login(superAdmin.email)]);

  const SELF = "https://crm.home88.test";
  const responses: string[] = [];
  const call = async (cookie: string | null, method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}) => {
    const h: Record<string, string> = { host: new URL(SELF).host, "x-forwarded-host": new URL(SELF).host, "x-forwarded-proto": "https", origin: SELF, ...extraHeaders };
    if (body !== undefined) h["content-type"] = "application/json";
    if (cookie) h.cookie = cookie;
    const res = await handleApiRequest(new Request(`http://crm.test/api${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }));
    const raw = Buffer.from(await res.arrayBuffer());
    const text = raw.toString("utf8");
    if (!path.startsWith("/portal-media/")) responses.push(text);
    let json: any = {};
    try { json = JSON.parse(text); } catch { /* binary */ }
    return { status: res.status, body: json, raw, text, headers: res.headers };
  };

  const xe = await db().portal.upsert({ where: { code: "XE_GR" }, create: { code: "XE_GR", name: "Χρυσή Ευκαιρία", transport: "API", enabled: false }, update: {} });
  const sp = await db().portal.upsert({ where: { code: "SPITOGATOS" }, create: { code: "SPITOGATOS", name: "Spitogatos", transport: "XML_FEED", enabled: false }, update: {} });
  for (const p of [xe, sp]) await db().portalPublicationRule.upsert({ where: { portalId: p.id }, create: { portalId: p.id, mode: "ALL_WEBSITE" }, update: { mode: "ALL_WEBSITE" } });
  const mkProperty = async (tag: string, owner = agent.id) => {
    const prop = await db().property.create({ data: { reference: `PS${tag}-${run.toUpperCase()}`, slug: `ps${tag}-${run}`, listingType: "SALE", propertyType: "APARTMENT", titleEl: "Ακίνητο ασφαλείας", descriptionEl: "Όμορφο διαμέρισμα με θέα, ανακαινισμένο, σε πολύ καλή θέση και κοντά σε όλες τις υπηρεσίες.", price: 100000, area: 70, bedrooms: 2, bathrooms: 1, city: "Αθήνα", region: "Αττική", address: "Οδός 3", status: "ACTIVE", publishedOnWebsite: true, agentId: owner, createdById: owner, latitude: 37.9, longitude: 23.7, yearBuilt: 2001, energyClass: "B" } });
    const key = `properties/${prop.id}/ph-${tag}-${run}.png`;
    const photo = await db().propertyMedia.create({ data: { propertyId: prop.id, kind: "PHOTO", storageKey: key, originalName: "p.png", mimeType: "image/png", byteSize: 33, status: "approved", isPrimary: true, sortOrder: 0 } });
    bucket.set(key, { body: png(), type: "image/png" });
    return { prop, photo, key };
  };
  const A = await mkProperty("A");
  const B = await mkProperty("B");

  // =====================================================================================================================
  // 1. Database roles: the migration's revoke block, and the absence of any policy
  // =====================================================================================================================
  const sqlFile = readFileSync(join(fileURLToPath(new URL(".", import.meta.url)), "../../../../packages/database/prisma/migrations/20261019000000_portal_accounts/migration.sql"), "utf8");
  const revokeBlock = sqlFile.slice(sqlFile.indexOf("DO $$"));
  assert.ok(revokeBlock.includes("REVOKE ALL ON TABLE"), "the migration revokes public-role access");

  const roleSuffix = run;
  const anonRole = `h88t_anon_${roleSuffix}`;
  const authRole = `h88t_auth_${roleSuffix}`;
  const tables = ["portal_accounts", "portal_sync_runs", "portal_listings", "portal_sync_logs", "provider_credentials"];
  await db().$executeRawUnsafe(`CREATE ROLE ${anonRole} NOLOGIN`);
  await db().$executeRawUnsafe(`CREATE ROLE ${authRole} NOLOGIN`);
  await db().$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${anonRole}, ${authRole}`);
  try {
    // Simulate a Supabase-style default grant, then run the migration's own revoke block (role names substituted).
    for (const t of ["portal_accounts", "portal_sync_runs"]) await db().$executeRawUnsafe(`GRANT ALL ON TABLE ${t} TO ${anonRole}, ${authRole}`);
    assert.equal((await db().$queryRawUnsafe<Array<{ ok: boolean }>>(`select has_table_privilege('${anonRole}', 'portal_accounts', 'SELECT') as ok`))[0]!.ok, true, "precondition: the simulated grant exists");
    await db().$executeRawUnsafe(revokeBlock.replace(/'anon'/g, `'${anonRole}'`).replace(/'authenticated'/g, `'${authRole}'`).replace(/FROM anon/g, `FROM ${anonRole}`).replace(/FROM authenticated/g, `FROM ${authRole}`));

    for (const t of ["portal_accounts", "portal_sync_runs"]) {
      const rls = await db().$queryRawUnsafe<Array<{ relrowsecurity: boolean }>>(`select relrowsecurity from pg_class where relname = '${t}' and relkind = 'r'`);
      assert.equal(rls[0]!.relrowsecurity, true, `${t} has RLS enabled`);
      const policies = await db().$queryRawUnsafe<Array<{ n: bigint }>>(`select count(*) as n from pg_policies where tablename = '${t}'`);
      assert.equal(Number(policies[0]!.n), 0, `${t} has no policy: default deny`);
    }
    // Exercise real statements as each role.
    for (const role of [anonRole, authRole]) {
      for (const t of tables) {
        for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
          const r = await db().$queryRawUnsafe<Array<{ ok: boolean }>>(`select has_table_privilege('${role}', 'public.${t}', '${priv}') as ok`);
          assert.equal(r[0]!.ok, false, `${role} has no ${priv} on ${t}`);
        }
      }
    }
    await db().$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${anonRole}`);
      await assert.rejects(tx.$queryRawUnsafe(`select * from portal_accounts`), /permission denied/i, "anon cannot read accounts");
    });
    await db().$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${authRole}`);
      await assert.rejects(tx.$executeRawUnsafe(`insert into portal_sync_runs (id, "portalId", operation, "startedAt") values ('x', '${xe.id}', 'PUBLISH', now())`), /permission denied/i, "authenticated cannot write runs");
    });
  } finally {
    await db().$executeRawUnsafe(`REASSIGN OWNED BY ${anonRole}, ${authRole} TO CURRENT_USER`).catch(() => undefined);
    await db().$executeRawUnsafe(`DROP OWNED BY ${anonRole}, ${authRole}`).catch(() => undefined);
    await db().$executeRawUnsafe(`DROP ROLE IF EXISTS ${anonRole}`).catch(() => undefined);
    await db().$executeRawUnsafe(`DROP ROLE IF EXISTS ${authRole}`).catch(() => undefined);
  }

  // =====================================================================================================================
  // 2. Authorization matrix (server-side, per role)
  // =====================================================================================================================
  const mkAccount = async (cookie: string, env: "TEST" | "PRODUCTION", name: string, code = "XE_GR") => {
    const r = await call(cookie, "POST", `/portals/${code}/accounts`, { accountName: `${name} ${run}`, environment: env });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.account.id as string;
  };
  const roles: Array<[string, string | null]> = [["anon", null], ["viewer", viewerC], ["agent", agentC], ["manager", managerC], ["admin", adminC], ["super", superC]];
  const listStatus = Object.fromEntries(await Promise.all(roles.map(async ([n, c]) => [n, (await call(c, "GET", "/portal-accounts")).status] as const)));
  assert.deepEqual(listStatus, { anon: 401, viewer: 403, agent: 200, manager: 200, admin: 200, super: 200 }, "listing accounts");

  const createStatus = Object.fromEntries(await Promise.all(roles.map(async ([n, c], i) => [n, (await call(c, "POST", "/portals/XE_GR/accounts", { accountName: `M${i} ${run}`, environment: "TEST" })).status] as const)));
  assert.deepEqual(createStatus, { anon: 401, viewer: 403, agent: 403, manager: 403, admin: 201, super: 201 }, "creating a TEST account");
  const prodCreate = Object.fromEntries(await Promise.all(roles.map(async ([n, c], i) => [n, (await call(c, "POST", "/portals/XE_GR/accounts", { accountName: `P${i} ${run}`, environment: "PRODUCTION" })).status] as const)));
  assert.deepEqual(prodCreate, { anon: 401, viewer: 403, agent: 403, manager: 403, admin: 403, super: 201 }, "creating a PRODUCTION account is Super Admin only");

  const testId = await mkAccount(adminC, "TEST", "Main");
  const prodId = (await db().portalAccount.findFirstOrThrow({ where: { environment: "PRODUCTION", accountName: { endsWith: run } } })).id;
  const credStatus = Object.fromEntries(await Promise.all(roles.map(async ([n, c]) => [n, (await call(c, "PUT", `/portal-accounts/${testId}/credentials`, { secrets: { apiKey: `placeholder-${n}-0000000000` } })).status] as const)));
  assert.deepEqual(credStatus, { anon: 401, viewer: 403, agent: 403, manager: 403, admin: 200, super: 200 }, "credentials");
  assert.equal((await call(adminC, "PUT", `/portal-accounts/${prodId}/credentials`, { secrets: { apiKey: "placeholder-admin-prod-000" } })).status, 403, "production credentials: Super Admin only");
  assert.equal((await call(adminC, "PATCH", `/portal-accounts/${prodId}`, { enabled: true })).status, 403, "an admin cannot activate a production account");
  assert.equal((await call(superC, "PATCH", `/portal-accounts/${prodId}`, { enabled: true })).status, 409, "even a Super Admin needs a successful connection test first");
  const testStatus = Object.fromEntries(await Promise.all(roles.map(async ([n, c]) => [n, (await call(c, "POST", `/portal-accounts/${testId}/test`, { environment: "TEST" })).status] as const)));
  assert.deepEqual(testStatus, { anon: 401, viewer: 403, agent: 403, manager: 403, admin: 200, super: 200 }, "connection test");
  assert.equal((await call(adminC, "PATCH", `/portal-accounts/${testId}`, { enabled: true })).status, 200);

  const opStatus = async (cookie: string | null, name: string, propertyId: string) => (await call(cookie, "POST", `/properties/${propertyId}/portals/XE_GR/${name}`, { accountId: testId, environment: "TEST" })).status;
  assert.equal(await opStatus(null, "preview", A.prop.id), 401);
  assert.equal(await opStatus(viewerC, "preview", A.prop.id), 403, "a viewer does nothing");
  assert.equal(await opStatus(agentC, "preview", A.prop.id), 200);
  assert.equal(await opStatus(otherC, "preview", A.prop.id), 200, "any agent may preview");
  for (const op of ["publish", "update", "unpublish", "retry"]) {
    assert.equal(await opStatus(otherC, op, A.prop.id), 403, `an agent who does not manage the property cannot ${op}`);
  }
  assert.equal(await opStatus(agentC, "publish", A.prop.id), 200, "the assigned agent may publish");
  assert.equal(await opStatus(agentC, "unpublish", A.prop.id), 403, "an agent may not withdraw");
  assert.equal(await opStatus(managerC, "unpublish", A.prop.id), 200, "a manager may");
  assert.equal(await opStatus(managerC, "publish", B.prop.id), 200, "a manager may publish any property");
  assert.equal((await call(otherC, "GET", `/properties/${A.prop.id}/portals/XE_GR/logs`)).status, 200, "history is readable by agents");
  assert.equal((await call(viewerC, "GET", `/properties/${A.prop.id}/portals/XE_GR/logs`)).status, 403);
  assert.equal((await call(null, "GET", "/portal-sync-runs")).status, 401);

  // Portal-account identity is never taken from the request.
  const spitAcct = await mkAccount(adminC, "TEST", "Other portal", "SPITOGATOS");
  assert.equal((await call(agentC, "POST", `/properties/${A.prop.id}/portals/XE_GR/preview`, { accountId: spitAcct, environment: "TEST" })).status, 404, "an account of another portal is not reachable through this one");
  assert.equal((await call(agentC, "POST", `/properties/${A.prop.id}/portals/XE_GR/preview`, { accountId: "nope", environment: "TEST" })).status, 404);

  // =====================================================================================================================
  // 3. TEST / PRODUCTION: the account row decides, the body can only agree with it
  // =====================================================================================================================
  const spy = (await import("@home88/portals")).createMockProvider("XE_GR");
  const calls: string[] = [];
  for (const m of ["publishProperty", "updateProperty", "unpublishProperty"] as const) {
    const orig = (spy as any)[m];
    (spy as any)[m] = async (...a: unknown[]) => { calls.push(`${m}:${(a[a.length - 1] as { environment: string }).environment}`); return orig(...a); };
  }
  accounts.registerRealPortalProvider(spy);
  await db().portalAccount.update({ where: { id: prodId }, data: { enabled: true, status: "ACTIVE", lastConnectionTestStatus: "OK" } });
  const envOps = ["preview", "publish", "update", "unpublish", "retry"];
  for (const op of envOps) {
    assert.equal((await call(managerC, "POST", `/properties/${B.prop.id}/portals/XE_GR/${op}`, { accountId: prodId, environment: "TEST" })).status, 409, `PRODUCTION account, TEST requested, ${op}`);
    assert.equal((await call(managerC, "POST", `/properties/${B.prop.id}/portals/XE_GR/${op}`, { accountId: testId, environment: "PRODUCTION" })).status, 409, `TEST account, PRODUCTION requested, ${op}`);
    assert.equal((await call(managerC, "POST", `/properties/${B.prop.id}/portals/XE_GR/${op}`, { accountId: testId })).status, 422, `${op} without an environment`);
  }
  assert.equal((await call(adminC, "POST", `/portal-accounts/${prodId}/test`, { environment: "TEST" })).status, 409);
  assert.equal((await call(adminC, "POST", `/portal-accounts/${testId}/test`, { environment: "PRODUCTION" })).status, 409);
  assert.deepEqual(calls, [], "no provider call happened on a mismatched request");
  // The matching request is the only one that reaches a provider, with the account's own environment.
  await db().portalListing.updateMany({ where: { propertyId: B.prop.id }, data: { state: "REMOVED", externalId: null } });
  assert.equal((await call(managerC, "POST", `/properties/${B.prop.id}/portals/XE_GR/publish`, { accountId: prodId, environment: "PRODUCTION" })).status, 200);
  assert.deepEqual(calls, ["publishProperty:PRODUCTION"]);
  accounts.clearRealPortalProviders();
  await db().portalAccount.update({ where: { id: prodId }, data: { enabled: false, status: "CONFIGURED" } });
  assert.equal((await call(managerC, "POST", `/properties/${B.prop.id}/portals/XE_GR/update`, { accountId: prodId, environment: "PRODUCTION" })).status, 409, "with no real provider a production account does nothing: no fallback to the mock");
  assert.equal((await db().portalAccount.findUniqueOrThrow({ where: { id: testId } })).environment, "TEST", "environment is immutable data on the account");
  assert.equal((await call(adminC, "PATCH", `/portal-accounts/${testId}`, { environment: "PRODUCTION" })).status, 422, "an account cannot be re-pointed at production");

  // =====================================================================================================================
  // 4. Credentials: never out, and rotation forces a new test
  // =====================================================================================================================
  const SECRET = `sk-test-${randomBytes(14).toString("hex")}`;
  const NEWSECRET = `sk-test-${randomBytes(14).toString("hex")}`;
  const stamp = written.length;
  const put = await call(adminC, "PUT", `/portal-accounts/${testId}/credentials`, { secrets: { apiKey: SECRET } });
  assert.equal(put.status, 200);
  assert.equal(put.body.account.credentials.apiKey.masked, `********${SECRET.slice(-4)}`);
  assert.equal(put.body.account.enabled, false, "new credentials switch the account off");
  assert.equal(put.body.account.status, "CONFIGURED");
  assert.equal(put.body.account.lastConnectionTestStatus, null, "and the old connection test no longer counts");
  assert.equal((await call(adminC, "PATCH", `/portal-accounts/${testId}`, { enabled: true })).status, 409, "enabling needs a new successful test");
  assert.equal((await call(agentC, "POST", `/properties/${A.prop.id}/portals/XE_GR/preview`, { accountId: testId, environment: "TEST" })).status, 200, "a preview needs no active account");
  assert.equal(await opStatus(managerC, "update", A.prop.id), 409, "an inactive account performs no operation");
  assert.equal((await call(adminC, "POST", `/portal-accounts/${testId}/test`, { environment: "TEST" })).status, 200);
  assert.equal((await call(adminC, "PATCH", `/portal-accounts/${testId}`, { enabled: true })).status, 200);
  // Rotation replaces the value: only the new one is held.
  assert.equal((await call(adminC, "PUT", `/portal-accounts/${testId}/credentials`, { secrets: { apiKey: NEWSECRET } })).status, 200);
  assert.deepEqual(await accounts.readCredentials(testId), { apiKey: NEWSECRET }, "the old value is gone");
  assert.equal((await db().portalAccount.findUniqueOrThrow({ where: { id: testId } })).enabled, false);
  // A production account is not switched on by a credential change.
  await db().portalAccount.update({ where: { id: prodId }, data: { enabled: true, status: "ACTIVE", lastConnectionTestStatus: "OK" } });
  assert.equal((await call(superC, "PUT", `/portal-accounts/${prodId}/credentials`, { secrets: { apiKey: "placeholder-prod-rotate-000" } })).status, 200);
  const prodRow = await db().portalAccount.findUniqueOrThrow({ where: { id: prodId } });
  assert.deepEqual([prodRow.enabled, prodRow.status, prodRow.lastConnectionTestStatus], [false, "CONFIGURED", null], "production stays off after a credential change");
  // The credential store is reachable only through a trusted account row.
  assert.deepEqual(await accounts.readCredentials("not-an-account"), {});

  // Error paths and operations with the new credential, then scan everything.
  assert.equal((await call(adminC, "POST", `/portal-accounts/${testId}/test`, { environment: "TEST" })).status, 200);
  await call(adminC, "PATCH", `/portal-accounts/${testId}`, { enabled: true });
  await call(adminC, "PATCH", `/portal-accounts/${testId}`, { mockMode: "authentication_failure" });
  await db().propertyMedia.update({ where: { id: A.photo.id }, data: { byteSize: 33 } });
  await db().portalListing.updateMany({ where: { propertyId: A.prop.id }, data: { state: "REMOVED", externalId: null } });
  const failing = await call(managerC, "POST", `/properties/${A.prop.id}/portals/XE_GR/publish`, { accountId: testId, environment: "TEST" });
  assert.equal(failing.status, 502);
  await call(adminC, "POST", `/portal-accounts/${testId}/test`, { environment: "TEST" });
  await call(adminC, "PATCH", `/portal-accounts/${testId}`, { mockMode: null });
  await call(adminC, "POST", `/portal-accounts/${testId}/test`, { environment: "TEST" });
  await call(adminC, "PATCH", `/portal-accounts/${testId}`, { enabled: true });
  assert.equal((await call(managerC, "POST", `/properties/${A.prop.id}/portals/XE_GR/publish`, { accountId: testId, environment: "TEST" })).status, 200);
  for (const path of ["/portal-accounts", `/properties/${A.prop.id}/portals`, `/properties/${A.prop.id}/portals/XE_GR/logs`, "/portal-sync-runs"]) {
    for (const c of [agentC, managerC, adminC, superC]) await call(c, "GET", path);
  }

  const everything = [
    ["API responses", responses.join("\n")],
    ["process logs", written.slice(stamp).join("\n")],
    ["portal_sync_logs", JSON.stringify(await db().portalSyncLog.findMany())],
    ["portal_sync_runs", JSON.stringify(await db().portalSyncRun.findMany())],
    ["portal_listings (snapshots, errors)", JSON.stringify(await db().portalListing.findMany())],
    ["portal_accounts", JSON.stringify(await db().portalAccount.findMany())],
    ["audit_logs", JSON.stringify(await db().auditLog.findMany({ where: { OR: [{ entity: "PORTAL" }, { entity: "PORTAL_LISTING" }] } }))],
  ] as const;
  for (const [where, text] of everything) {
    for (const s of [SECRET, NEWSECRET, "placeholder-admin-0000000000", "placeholder-super-0000000000", "placeholder-prod-rotate-000"]) assert.equal(text.includes(s), false, `${where} must not contain a credential`);
  }
  const auditText = everything[6][1];
  assert.equal(auditText.includes("portal-account:"), false, "audit does not carry the secret scope reference");
  assert.equal(/ciphertext|authTag|"iv"/.test(auditText + everything[5][1] + everything[0][1]), false, "no sealed envelope fields anywhere");
  const sealed = await db().providerCredential.findMany({ where: { scope: `portal-account:${testId}` } });
  assert.equal(sealed.length, 1);
  assert.equal(JSON.stringify(sealed).includes(NEWSECRET), false, "stored sealed");

  // =====================================================================================================================
  // 5. Media links
  // =====================================================================================================================
  const path = (u: string) => new URL(u).pathname.replace(/^\/crm\/api/, "").replace(/^\/api/, "");
  const url1 = portalMediaUrl({ propertyId: A.prop.id, mediaId: A.photo.id, portalCode: "XE_GR" });
  const ok = await call(null, "GET", path(url1));
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.raw, png());
  const headerText = JSON.stringify([...ok.headers.entries()]);
  assert.equal(headerText.includes(A.key) || headerText.includes("properties/"), false, "no storage key in the response headers");
  assert.equal(headerText.includes(NEWSECRET), false);

  // Narrow scope: every mismatch is the same 404 with the same body.
  const refusals = [
    portalMediaUrl({ propertyId: B.prop.id, mediaId: A.photo.id, portalCode: "XE_GR" }), // photo of another property
    portalMediaUrl({ propertyId: A.prop.id, mediaId: B.photo.id, portalCode: "XE_GR" }), // another photo, same property id
    portalMediaUrl({ propertyId: A.prop.id, mediaId: A.photo.id, portalCode: "SPITOGATOS" }), // a portal with no listing for it
    portalMediaUrl({ propertyId: A.prop.id, mediaId: "nonexistent", portalCode: "XE_GR" }), // no such media
    portalMediaUrl({ propertyId: A.prop.id, mediaId: A.photo.id, portalCode: "XE_GR" }, { ttlSeconds: 1, now: new Date(Date.now() - 120_000) }), // expired
  ].map(path);
  refusals.push(`/portal-media/${path(url1).split("/").pop()!.slice(0, -2)}xx`); // tampered
  refusals.push("/portal-media/garbage", "/portal-media/", "/portal-media/..%2F..%2Fetc%2Fpasswd", "/portal-media/../../x", `${path(url1)}/extra`, `${path(url1)}/..`);
  let bodies = new Set<string>();
  for (const r of refusals) {
    const res = await call(null, "GET", r);
    assert.equal(res.status, 404, r);
    bodies.add(res.text.replace(/\s/g, ""));
  }
  assert.equal(bodies.size, 1, "all refusals look identical: the route does not say why");
  // Another property's token cannot be redirected: the signed claims cannot be edited.
  const [claimsB64, sig] = path(url1).split("/").pop()!.split(".") as [string, string];
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(claimsB64, "base64url").toString()), p: B.prop.id })).toString("base64url");
  assert.equal((await call(null, "GET", `/portal-media/${forged}.${sig}`)).status, 404, "editing the property in a token breaks its signature");
  // Not approved any more, or in a rejected state.
  for (const status of ["pending_review", "rejected"]) {
    await db().propertyMedia.update({ where: { id: A.photo.id }, data: { status } });
    assert.equal((await call(null, "GET", path(url1))).status, 404, status);
  }
  await db().propertyMedia.update({ where: { id: A.photo.id }, data: { status: "approved" } });
  // Read only.
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const res = await call(null, method, path(url1), method === "DELETE" ? undefined : {});
    assert.ok(res.status >= 400 && res.status < 500, `${method} is refused (${res.status})`);
    assert.equal(bucket.has(A.key), true, "and nothing was deleted");
  }
  // The bucket is private: nothing here made a public URL.
  assert.equal(url1.includes("test-bucket") || url1.includes("s3.test"), false);

  // Abuse: repeated bad links from one client are throttled; a valid token is capped per minute.
  resetRateLimits();
  let throttled = 0;
  for (let i = 0; i < 70; i++) if ((await call(null, "GET", `/portal-media/bad${i}`)).status === 429) throttled++;
  assert.ok(throttled > 0, "failed attempts are rate-limited per client");
  resetRateLimits();
  let tokenLimited = 0;
  for (let i = 0; i < 35; i++) if ((await call(null, "GET", path(url1))).status === 429) tokenLimited++;
  assert.ok(tokenLimited > 0, "a single token cannot be fetched without limit");
  resetRateLimits();

  // =====================================================================================================================
  // 6. Nothing automatic, nothing outbound
  // =====================================================================================================================
  assert.deepEqual(outbound, [], "no request left the process");
  assert.equal(await db().portalSyncRun.count({ where: { trigger: { in: ["CRON", "PROPERTY_SAVE", "BULK_ACTION"] } , createdById: { in: [agent.id, manager.id, admin.id, superAdmin.id] } } }), 0);

  process.stdout.write = origOut;
  process.stderr.write = origErr;
  globalThis.fetch = realFetch;
  await db().$disconnect();
});
