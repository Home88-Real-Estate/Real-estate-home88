/**
 * Portal foundation through the real API and a real Postgres: accounts and
 * TEST/PRODUCTION isolation, sealed credentials with masked display,
 * permissions, and the manual preview/publish/update/unpublish/retry lifecycle
 * against the in-process mock provider. The media bucket is an in-memory stub
 * and `fetch` is replaced with a trap, so any outbound call fails the test.
 * Runs only when TEST_DATABASE_URL points at a disposable database:
 *
 *   TEST_DATABASE_URL=postgresql://… npx tsx --test src/routes/portal-accounts.integration.test.ts
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
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

test("portal foundation: accounts, credentials, permissions, manual lifecycle, media delivery", { skip: !url && "TEST_DATABASE_URL not set" }, async () => {
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

  // No real portal may ever be contacted by this suite.
  const realFetch = globalThis.fetch;
  const outbound: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    outbound.push(String(input));
    throw new Error("outbound request blocked in test");
  }) as typeof fetch;

  const { handleApiRequest } = await import("../handler");
  const { db } = await import("../lib/prisma");
  const { hashPassword } = await import("../lib/passwords");
  const { resetConfig } = await import("../config");
  const { storageClient, resetStorageClient } = await import("../lib/storage");
  const { settings } = await import("../settings");
  resetConfig();
  resetStorageClient();

  const bucket = new Map<string, { body: Buffer; type: string }>();
  const c = storageClient() as unknown as { send: (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => Promise<unknown> };
  c.send = async (cmd) => {
    const obj = bucket.get(String(cmd.input.Key));
    if (cmd.constructor.name === "GetObjectCommand") {
      if (!obj) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
      return { Body: { transformToByteArray: async () => new Uint8Array(obj.body) }, ContentType: obj.type };
    }
    throw new Error(`unexpected ${cmd.constructor.name}`);
  };

  const run = randomBytes(4).toString("hex");
  const password = "Integration-Test-Password-123";
  const hash = hashPassword(password, 10);
  const mk = (role: string, tag: string) => db().user.create({ data: { email: `${tag}-${run}@test.invalid`, firstName: tag, lastName: "Test", role: role as never, passwordHash: hash } });
  const [agent, other, manager, admin, superAdmin] = await Promise.all([mk("AGENT", "pfagent"), mk("AGENT", "pfother"), mk("MANAGER", "pfmanager"), mk("ADMIN", "pfadmin"), mk("SUPER_ADMIN", "pfsuper")]);
  async function login(email: string) {
    const res = await handleApiRequest(new Request("http://crm.test/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }));
    assert.equal(res.status, 200, `login ${email}`);
    return res.headers.get("set-cookie")!.split(";")[0]!;
  }
  const [agentC, otherC, managerC, adminC, superC] = await Promise.all([login(agent.email), login(other.email), login(manager.email), login(admin.email), login(superAdmin.email)]);

  const SELF = "https://crm.home88.test";
  const call = async (cookie: string | null, method: string, path: string, body?: unknown) => {
    const h: Record<string, string> = { host: new URL(SELF).host, "x-forwarded-host": new URL(SELF).host, "x-forwarded-proto": "https", origin: SELF };
    if (body !== undefined) h["content-type"] = "application/json";
    if (cookie) h.cookie = cookie;
    const res = await handleApiRequest(new Request(`http://crm.test/api${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }));
    const buf = Buffer.from(await res.arrayBuffer());
    let json: any = {};
    try { json = JSON.parse(buf.toString("utf8")); } catch { /* binary */ }
    return { status: res.status, body: json, raw: buf, headers: res.headers };
  };

  // A portal publishing rule so the property is selected, and a complete property with an approved photo.
  const xe = await db().portal.upsert({ where: { code: "XE_GR" }, create: { code: "XE_GR", name: "Χρυσή Ευκαιρία", transport: "API", enabled: false }, update: {} });
  await db().portalPublicationRule.upsert({ where: { portalId: xe.id }, create: { portalId: xe.id, mode: "ALL_WEBSITE" }, update: { mode: "ALL_WEBSITE" } });
  const ref = `PF-${run.toUpperCase()}`;
  const property = await db().property.create({
    data: {
      reference: ref, slug: `pf-${run}`, listingType: "SALE", propertyType: "APARTMENT", titleEl: "Διαμέρισμα δοκιμής", descriptionEl: "Όμορφο διαμέρισμα με θέα, ανακαινισμένο, σε πολύ καλή θέση και κοντά σε όλες τις υπηρεσίες.",
      price: 150000, area: 80, bedrooms: 2, bathrooms: 1, city: "Αθήνα", region: "Αττική", address: "Οδός 1", status: "ACTIVE", publishedOnWebsite: true, agentId: agent.id, createdById: agent.id,
      latitude: 37.98, longitude: 23.72, yearBuilt: 2000, energyClass: "B",
    },
  });
  const photoKey = `properties/${property.id}/photo-${run}.png`;
  const photo = await db().propertyMedia.create({ data: { propertyId: property.id, kind: "PHOTO", storageKey: photoKey, originalName: "p.png", mimeType: "image/png", byteSize: 33, status: "approved", isPrimary: true, sortOrder: 0 } });
  const pending = await db().propertyMedia.create({ data: { propertyId: property.id, kind: "PHOTO", storageKey: `properties/${property.id}/pending-${run}.png`, originalName: "q.png", mimeType: "image/png", byteSize: 33, status: "pending_review", sortOrder: 1 } });
  bucket.set(photoKey, { body: png(), type: "image/png" });
  bucket.set(pending.storageKey, { body: png(), type: "image/png" });

  // ---- Permissions -----------------------------------------------------------------------------------------------------------------
  assert.equal((await call(null, "GET", "/portal-accounts")).status, 401, "anonymous");
  assert.equal((await call(agentC, "POST", "/portals/XE_GR/accounts", { accountName: `Test ${run}`, environment: "TEST" })).status, 403, "an agent cannot configure accounts");
  assert.equal((await call(managerC, "POST", "/portals/XE_GR/accounts", { accountName: `Mgr ${run}`, environment: "TEST" })).status, 403, "managers publish but do not configure portal accounts");
  assert.equal((await call(adminC, "POST", "/portals/XE_GR/accounts", { accountName: `Prod ${run}`, environment: "PRODUCTION" })).status, 403, "only a Super Admin creates a production account");
  assert.equal((await call(adminC, "POST", "/portals/NO_SUCH/accounts", { accountName: "x1", environment: "TEST" })).status, 404);
  assert.equal((await call(adminC, "POST", "/portals/XE_GR/accounts", { accountName: `Bad ${run}`, environment: "TEST", endpointUrl: "http://127.0.0.1/x" })).status, 400, "no private or plain-http endpoint");
  assert.equal((await call(adminC, "POST", "/portals/XE_GR/accounts", { accountName: `Bad ${run}`, environment: "TEST" , surprise: 1 })).status, 422, "strict body");

  // ---- Accounts: explicit environment, sealed credentials, masked display ----------------------------------------------------
  const created = await call(adminC, "POST", "/portals/XE_GR/accounts", { accountName: `Test ${run}`, environment: "TEST", agencyExternalId: "AG-1" });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const testId = created.body.account.id as string;
  assert.equal(created.body.account.environment, "TEST");
  assert.equal(created.body.account.enabled, false);
  assert.equal(created.body.account.providerKind, "mock", "a TEST account on a portal with an adapter uses the mock");
  assert.equal((await call(adminC, "POST", "/portals/XE_GR/accounts", { accountName: `Test ${run}`, environment: "TEST" })).status, 409, "duplicate name and environment");

  const prod = await call(superC, "POST", "/portals/XE_GR/accounts", { accountName: `Prod ${run}`, environment: "PRODUCTION" });
  assert.equal(prod.status, 201, JSON.stringify(prod.body));
  const prodId = prod.body.account.id as string;
  assert.equal(prod.body.account.providerKind, "none", "a production account has no provider: no real adapter exists");

  const SECRET = `sk-live-${randomBytes(12).toString("hex")}`;
  assert.equal((await call(managerC, "PUT", `/portal-accounts/${testId}/credentials`, { secrets: { apiKey: SECRET } })).status, 403, "managers cannot manage credentials");
  const put = await call(adminC, "PUT", `/portal-accounts/${testId}/credentials`, { secrets: { apiKey: SECRET } });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const cred = put.body.account.credentials.apiKey;
  assert.deepEqual([cred.configured, cred.masked], [true, `********${SECRET.slice(-4)}`]);
  assert.ok(cred.changedAt);
  assert.ok(put.body.account.credentialRotatedAt, "rotation metadata");
  assert.equal(JSON.stringify(put.body).includes(SECRET), false, "the secret is not echoed");
  const listed = await call(agentC, "GET", "/portal-accounts");
  assert.equal(listed.status, 200);
  assert.equal(JSON.stringify(listed.body).includes(SECRET), false, "nor listed");
  const stored = await db().providerCredential.findMany({ where: { scope: `portal-account:${testId}` } });
  assert.equal(stored.length, 1);
  assert.equal(JSON.stringify(stored).includes(SECRET), false, "stored sealed, not in plaintext");
  const acct = await db().portalAccount.findUniqueOrThrow({ where: { id: testId } });
  assert.equal(JSON.stringify(acct).includes(SECRET), false, "not on the account row either");
  assert.equal((await call(adminC, "PUT", `/portal-accounts/${testId}/credentials`, { secrets: { nonsense: "x" } })).status, 409, "unknown credential field");
  // Rotation: a new value changes the hint and the rotation time.
  const first = (await db().portalAccount.findUniqueOrThrow({ where: { id: testId } })).credentialRotatedAt!;
  await new Promise((r) => setTimeout(r, 15));
  const SECRET2 = `sk-live-${randomBytes(12).toString("hex")}`;
  const rot = await call(adminC, "PUT", `/portal-accounts/${testId}/credentials`, { secrets: { apiKey: SECRET2 } });
  assert.equal(rot.body.account.credentials.apiKey.masked, `********${SECRET2.slice(-4)}`);
  assert.ok((await db().portalAccount.findUniqueOrThrow({ where: { id: testId } })).credentialRotatedAt!.getTime() > first.getTime());
  assert.equal((await call(adminC, "PUT", `/portal-accounts/${prodId}/credentials`, { secrets: { apiKey: SECRET2 } })).status, 403, "production credentials need a Super Admin");

  // ---- Connection test and enabling ---------------------------------------------------------------------------------------------
  assert.equal((await call(agentC, "POST", `/portal-accounts/${testId}/test`, { environment: "TEST" })).status, 403);
  assert.equal((await call(adminC, "POST", `/portal-accounts/${testId}/test`, {})).status, 422, "the environment must be named");
  const mismatch = await call(adminC, "POST", `/portal-accounts/${testId}/test`, { environment: "PRODUCTION" });
  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.body.error.code, "environment_mismatch", "a TEST account is never used as production");
  assert.equal((await call(adminC, "PATCH", `/portal-accounts/${testId}`, { enabled: true })).status, 409, "no enabling before a successful connection test");
  const tested = await call(adminC, "POST", `/portal-accounts/${testId}/test`, { environment: "TEST" });
  assert.equal(tested.status, 200, JSON.stringify(tested.body));
  assert.deepEqual([tested.body.ok, tested.body.mock], [true, true]);
  assert.equal((await call(adminC, "PATCH", `/portal-accounts/${testId}`, { enabled: true })).status, 200);
  const noProdTest = await call(superC, "POST", `/portal-accounts/${prodId}/test`, { environment: "PRODUCTION" });
  assert.equal(noProdTest.status, 409);
  assert.equal(noProdTest.body.error.code, "no_adapter", "no real adapter: production cannot be tested or used");
  assert.equal((await call(adminC, "PATCH", `/portal-accounts/${testId}`, { mockMode: "rate_limit" })).status, 200);
  assert.equal((await call(superC, "PATCH", `/portal-accounts/${prodId}`, { mockMode: "success" })).status, 409, "mock mode is for TEST accounts only");
  await call(adminC, "PATCH", `/portal-accounts/${testId}`, { mockMode: null });

  // ---- Preview, publish -------------------------------------------------------------------------------------------------------------
  const op = (cookie: string | null, name: string, accountId = testId, environment = "TEST", id = property.id) => call(cookie, "POST", `/properties/${id}/portals/XE_GR/${name}`, { accountId, environment });

  assert.equal((await op(null, "preview")).status, 401);
  const preview = await op(otherC, "preview");
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.status, "PREVIEWED");
  assert.equal(preview.body.outcome, "READY");
  assert.equal(preview.body.mock, true);
  assert.equal(preview.body.mediaCount, 1, "only the approved photo counts");
  assert.equal((await db().portalListing.count({ where: { propertyId: property.id } })), 0, "a preview changes nothing");
  assert.equal(JSON.stringify(preview.body).includes(SECRET2), false);

  assert.equal((await op(otherC, "publish")).status, 403, "an agent who does not manage the property cannot publish it");
  assert.equal((await op(agentC, "publish", testId, "PRODUCTION")).status, 409, "environment mismatch is refused");
  assert.equal((await op(agentC, "publish", prodId, "PRODUCTION")).status, 409, "production has no adapter");
  assert.equal((await call(agentC, "POST", `/properties/${property.id}/portals/NOPE/publish`, { accountId: testId, environment: "TEST" })).status, 404);

  const pub = await op(agentC, "publish");
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  assert.equal(pub.body.status, "PUBLISHED");
  assert.equal(pub.body.externalId, `mock-${ref}`);
  assert.equal(pub.body.mock, true);
  let listing = await db().portalListing.findUniqueOrThrow({ where: { portalId_propertyId: { portalId: xe.id, propertyId: property.id } } });
  assert.deepEqual([listing.state, listing.portalAccountId, listing.lastAction, listing.lastActionById], ["PUBLISHED", testId, "PUBLISH", agent.id]);
  assert.ok(listing.lastPayloadHash && listing.lastSuccessfulSyncAt && listing.payloadSnapshot);
  assert.equal(JSON.stringify(listing.payloadSnapshot).includes(SECRET2), false, "no credential in the payload snapshot");
  assert.equal((await op(agentC, "publish")).status, 409, "publishing twice is refused (use update)");

  // Run record and detailed log.
  const runRow = await db().portalSyncRun.findUniqueOrThrow({ where: { id: pub.body.runId } });
  assert.deepEqual([runRow.status, runRow.operation, runRow.trigger, runRow.createdCount, runRow.failedCount, runRow.totalListings, runRow.createdById], ["SUCCEEDED", "PUBLISH", "MANUAL", 1, 0, 1, agent.id]);
  assert.ok(runRow.finishedAt);
  const logRow = await db().portalSyncLog.findFirstOrThrow({ where: { syncRunId: runRow.id } });
  assert.deepEqual([logRow.ok, logRow.action, logRow.actorId], [true, "PUBLISH", agent.id]);

  // ---- Update: unchanged payload sends nothing ---------------------------------------------------------------------------------
  const same = await op(agentC, "update");
  assert.equal(same.body.status, "UNCHANGED", "same content, no update");
  assert.equal((await db().portalSyncLog.count({ where: { portalListingId: listing.id } })), 1, "no extra provider call was logged");
  await db().property.update({ where: { id: property.id }, data: { price: 155000 } });
  const upd = await op(agentC, "update");
  assert.equal(upd.body.status, "UPDATED", JSON.stringify(upd.body));
  const afterUpdate = await db().portalListing.findUniqueOrThrow({ where: { id: listing.id } });
  assert.notEqual(afterUpdate.lastPayloadHash, listing.lastPayloadHash);
  assert.equal(afterUpdate.externalId, listing.externalId, "an update never creates a second listing");

  // ---- Failure modes, retry, duplicates -----------------------------------------------------------------------------------------
  await call(adminC, "PATCH", `/portal-accounts/${testId}`, { mockMode: "temporary_failure" });
  await db().property.update({ where: { id: property.id }, data: { price: 156000 } });
  const failed = await op(agentC, "update");
  assert.equal(failed.status, 200, "a portal failure is an outcome, not a server fault");
  assert.equal(failed.body.status, "FAILED");
  assert.equal(failed.body.errorCode, "REMOTE_SERVER_ERROR");
  assert.equal(failed.body.needsReview, false, "a transient error is retried, not parked");
  assert.ok(failed.body.nextRetryAt);
  listing = await db().portalListing.findUniqueOrThrow({ where: { id: listing.id } });
  assert.deepEqual([listing.state, listing.retryCount, listing.lastErrorCode, listing.externalId], ["FAILED", 1, "REMOTE_SERVER_ERROR", `mock-${ref}`]);
  const failedRun = await db().portalSyncRun.findUniqueOrThrow({ where: { id: failed.body.runId } });
  assert.deepEqual([failedRun.status, failedRun.failedCount], ["FAILED", 1]);

  assert.equal((await op(agentC, "retry")).body.status, "FAILED", "the mock is still failing: a failed retry stays failed");
  assert.equal((await db().portalListing.findUniqueOrThrow({ where: { id: listing.id } })).retryCount, 2);
  await call(adminC, "PATCH", `/portal-accounts/${testId}`, { mockMode: null });
  const retried = await op(agentC, "retry");
  assert.equal(retried.status, 200, JSON.stringify(retried.body));
  assert.equal(retried.body.status, "UPDATED", "retry repeats what failed (an update), on the same listing");
  assert.equal(await db().portalListing.count({ where: { propertyId: property.id, portalId: xe.id } }), 1, "no duplicate listing");
  assert.equal((await op(agentC, "retry")).status, 409, "nothing left to retry");
  assert.equal((await db().portalSyncRun.findUniqueOrThrow({ where: { id: retried.body.runId } })).trigger, "RETRY");

  await call(adminC, "PATCH", `/portal-accounts/${testId}`, { mockMode: "authentication_failure" });
  await db().property.update({ where: { id: property.id }, data: { price: 157000 } });
  const auth = await op(agentC, "update");
  assert.equal(auth.body.errorCode, "INVALID_CREDENTIALS");
  assert.equal(auth.body.needsReview, true, "a permanent error is parked for a person");
  const errored = await db().portalAccount.findUniqueOrThrow({ where: { id: testId } });
  assert.equal(errored.status, "ERROR", "bad credentials put the account in error");
  assert.equal((await op(agentC, "update")).status, 409, "an account in error does nothing until its connection is tested again");
  await call(adminC, "PATCH", `/portal-accounts/${testId}`, { mockMode: null });
  assert.equal((await call(adminC, "POST", `/portal-accounts/${testId}/test`, { environment: "TEST" })).status, 200);
  assert.equal((await db().portalAccount.findUniqueOrThrow({ where: { id: testId } })).status, "ACTIVE", "a successful test clears the error");

  // Duplicate on publish adopts the portal's own listing instead of creating another.
  const prop2 = await db().property.create({ data: { reference: `PG-${run.toUpperCase()}`, slug: `pg-${run}`, listingType: "SALE", propertyType: "APARTMENT", titleEl: "Δεύτερο", descriptionEl: "Όμορφο διαμέρισμα με θέα, ανακαινισμένο, σε πολύ καλή θέση και κοντά σε όλες τις υπηρεσίες.", price: 90000, area: 60, bedrooms: 1, bathrooms: 1, city: "Αθήνα", region: "Αττική", address: "Οδός 2", status: "ACTIVE", publishedOnWebsite: true, agentId: agent.id, createdById: agent.id, latitude: 37.9, longitude: 23.7, yearBuilt: 1990, energyClass: "C" } });
  await db().propertyMedia.create({ data: { propertyId: prop2.id, kind: "PHOTO", storageKey: `properties/${prop2.id}/a.png`, originalName: "a.png", mimeType: "image/png", byteSize: 33, status: "approved", isPrimary: true, sortOrder: 0 } });
  await call(adminC, "PATCH", `/portal-accounts/${testId}`, { mockMode: "duplicate" });
  const dup = await op(agentC, "publish", testId, "TEST", prop2.id);
  assert.equal(dup.body.status, "PUBLISHED", JSON.stringify(dup.body));
  assert.equal(dup.body.adopted, true);
  assert.equal(dup.body.externalId, `mock-PG-${run.toUpperCase()}`);
  await call(adminC, "PATCH", `/portal-accounts/${testId}`, { mockMode: null });

  // ---- Unpublish ---------------------------------------------------------------------------------------------------------------------------
  assert.equal((await op(agentC, "unpublish")).status, 403, "agents may not withdraw");
  const unp = await op(managerC, "unpublish");
  assert.equal(unp.body.status, "UNPUBLISHED", JSON.stringify(unp.body));
  assert.equal((await db().portalListing.findUniqueOrThrow({ where: { id: listing.id } })).state, "REMOVED");
  assert.equal((await db().portalSyncRun.findUniqueOrThrow({ where: { id: unp.body.runId } })).withdrawnCount, 1);
  assert.equal((await op(managerC, "unpublish")).status, 409, "already withdrawn");

  // ---- Publication rules keep their say --------------------------------------------------------------------------------------------------
  const tags = async (codes: string[]) => assert.equal((await call(managerC, "PUT", `/properties/${property.id}/tags`, { codes })).status, 200);
  for (const code of ["DO_NOT_PUBLISH", "WEBSITE_ONLY"]) {
    await tags([code]);
    const blocked = await op(agentC, "publish");
    assert.equal(blocked.body.status, "BLOCKED", code);
    assert.ok(blocked.body.reasons.some((r: string) => r.includes(code)), `reason names ${code}`);
    assert.equal((await db().portalListing.findUniqueOrThrow({ where: { id: listing.id } })).state, "REMOVED", "a blocked attempt does not touch the listing");
  }
  await tags(["PORTAL_ONLY"]);
  assert.equal((await op(agentC, "publish")).status, 200, "PORTAL_ONLY does not stop a portal");
  await tags([]);

  // ---- A planned portal has nothing to publish with --------------------------------------------------------------------------------------------
  const jamesAcct = await call(adminC, "POST", "/portals/JAMESEDITION/accounts", { accountName: `J ${run}`, environment: "TEST" });
  assert.equal(jamesAcct.status, 201);
  assert.equal(jamesAcct.body.account.providerKind, "none");
  const planned = await call(agentC, "POST", `/properties/${property.id}/portals/JAMESEDITION/publish`, { accountId: jamesAcct.body.account.id, environment: "TEST" });
  assert.equal(planned.status, 409);
  assert.equal(planned.body.error.message, "Δεν υπάρχει ακόμη adapter για αυτό το portal.");

  // ---- Listing view, logs, history -----------------------------------------------------------------------------------------------------------------
  const view = await call(agentC, "GET", `/properties/${property.id}/portals`);
  const xeRow = view.body.portals.find((p: any) => p.code === "XE_GR");
  assert.equal(xeRow.hasAdapter, true);
  assert.equal(xeRow.accounts.length >= 2, true);
  assert.equal(xeRow.lastActionBy, "pfagent Test");
  assert.equal(JSON.stringify(view.body).includes(SECRET2), false);
  const jRow = view.body.portals.find((p: any) => p.code === "JAMESEDITION");
  assert.equal(jRow.hasAdapter, false);
  const logs = await call(agentC, "GET", `/properties/${property.id}/portals/XE_GR/logs`);
  assert.equal(logs.status, 200);
  assert.ok(logs.body.logs.length >= 5);
  assert.ok(logs.body.logs.some((l: any) => l.actor === "pfagent Test"));
  const agentView = logs.body.logs.find((l: any) => !l.ok);
  assert.equal(agentView.detail, "Η ενέργεια απέτυχε.", "an agent does not read the provider's wording");
  const mgrLogs = await call(managerC, "GET", `/properties/${property.id}/portals/XE_GR/logs`);
  assert.ok(mgrLogs.body.logs.find((l: any) => !l.ok).detail.length > 10, "a manager does");
  const runs = await call(managerC, "GET", `/portal-sync-runs?property=${property.id}`);
  assert.ok(runs.body.runs.length >= 8);

  // ---- Photo delivery: private, scoped, expiring ---------------------------------------------------------------------------------------------------
  const { portalMediaUrl } = await import("../lib/portal-media");
  const path = (u: string) => new URL(u).pathname.replace(/^\/crm\/api/, "").replace(/^\/api/, "");
  const goodUrl = portalMediaUrl({ propertyId: property.id, mediaId: photo.id, portalCode: "XE_GR" });
  assert.ok(goodUrl.startsWith("https://crm.home88.test/"), "on the CRM's own origin");
  assert.ok(!goodUrl.includes(photoKey) && !goodUrl.includes("properties/"), "no storage key in the link");
  const got = await call(null, "GET", path(goodUrl));
  assert.equal(got.status, 200, "no session needed: the token is the authority");
  assert.deepEqual(got.raw, png());
  assert.equal(got.headers.get("cache-control"), "private, max-age=300");
  assert.equal(got.headers.get("x-content-type-options"), "nosniff");
  // Unapproved media, another property's media, an unknown portal's token, a tampered or expired token.
  assert.equal((await call(null, "GET", path(portalMediaUrl({ propertyId: property.id, mediaId: pending.id, portalCode: "XE_GR" })))).status, 404, "pending media is never delivered");
  assert.equal((await call(null, "GET", path(portalMediaUrl({ propertyId: prop2.id, mediaId: photo.id, portalCode: "XE_GR" })))).status, 404, "media of another property");
  assert.equal((await call(null, "GET", path(portalMediaUrl({ propertyId: property.id, mediaId: photo.id, portalCode: "SPITOGATOS" })))).status, 404, "a portal with no listing for this property");
  assert.equal((await call(null, "GET", path(portalMediaUrl({ propertyId: property.id, mediaId: photo.id, portalCode: "XE_GR" }, { ttlSeconds: 1, now: new Date(Date.now() - 60_000) })))).status, 404, "expired");
  assert.equal((await call(null, "GET", `/portal-media/${goodUrl.split("/").pop()!.slice(0, -3)}abc`)).status, 404, "tampered");
  assert.equal((await call(null, "GET", "/portal-media/garbage")).status, 404);
  assert.equal((await call(null, "POST", path(goodUrl))).status === 404 || (await call(null, "POST", path(goodUrl))).status === 403, true, "read-only: no write method reaches it");
  await db().propertyMedia.update({ where: { id: photo.id }, data: { status: "rejected" } });
  assert.equal((await call(null, "GET", path(goodUrl))).status, 404, "a link stops working the moment its photo is no longer approved");
  await db().propertyMedia.update({ where: { id: photo.id }, data: { status: "approved" } });

  // Links the provider receives are scoped, not storage keys (inspect what a publish would send).
  const sentUrls: string[] = [];
  const { createMockProvider } = await import("@home88/portals");
  const spy = createMockProvider("XE_GR");
  const origPublish = spy.publishProperty!;
  spy.publishProperty = async (p, ctx) => { sentUrls.push(...p.media.map((m) => m.url)); return origPublish(p, ctx); };
  const accounts = await import("../lib/portal-accounts");
  accounts.registerRealPortalProvider(spy);
  await db().portalListing.updateMany({ where: { propertyId: property.id }, data: { state: "REMOVED", externalId: null } });
  const viaSpy = await op(agentC, "publish");
  accounts.clearRealPortalProviders();
  assert.equal(viaSpy.status, 200, JSON.stringify(viaSpy.body));
  assert.equal(sentUrls.length, 1);
  assert.ok(sentUrls[0]!.includes("/api/portal-media/") && !sentUrls[0]!.includes(photoKey), "the provider receives a scoped link");
  assert.equal(viaSpy.body.mock, false, "a registered real provider is not labelled mock");

  // ---- Audit ------------------------------------------------------------------------------------------------------------------------------------------
  const audits = await db().auditLog.findMany({ where: { OR: [{ entity: "PORTAL_LISTING", entityId: listing.id }, { entity: "PORTAL", entityId: { in: [testId, prodId] } }] } });
  const names = new Set(audits.map((a) => a.action));
  for (const a of ["PROPERTY_PUBLISHED", "PROPERTY_UPDATED", "PROPERTY_UNPUBLISHED", "PORTAL_SYNC_FAILED", "PORTAL_SYNC_RETRIED", "PORTAL_CONNECTION_TESTED", "PORTAL_ACCOUNT_UPDATED"]) assert.ok(names.has(a), a);
  assert.equal(JSON.stringify(audits).includes(SECRET), false, "no secret in the audit trail");
  assert.equal(JSON.stringify(audits).includes(SECRET2), false);
  assert.ok(audits.some((a) => a.actorId === agent.id) && audits.some((a) => a.actorId === admin.id));

  // ---- Permission matrix as shipped -------------------------------------------------------------------------------------------------------------------
  const can = (role: string, p: string) => settings().can(role, p);
  assert.equal(await can("AGENT", "portals.publish"), true);
  assert.equal(await can("AGENT", "portals.unpublish"), false);
  assert.equal(await can("AGENT", "portals.configure"), false);
  assert.equal(await can("AGENT", "portals.manage_credentials"), false);
  assert.equal(await can("MANAGER", "portals.unpublish"), true);
  assert.equal(await can("MANAGER", "portals.manage_credentials"), false);
  assert.equal(await can("MANAGER", "portals.configure"), false);
  assert.equal(await can("ADMIN", "portals.configure"), true);
  assert.equal(await can("ADMIN", "portals.manage_credentials"), true);
  assert.equal(await can("ADMIN", "portals.activate_production"), false);
  assert.equal(await can("SUPER_ADMIN", "portals.activate_production"), true);

  // ---- Nothing automatic, nothing outbound --------------------------------------------------------------------------------------------------------------
  assert.deepEqual(outbound, [], "no request left the process");
  assert.equal(await db().portalSyncRun.count({ where: { trigger: { in: ["CRON", "PROPERTY_SAVE", "BULK_ACTION"] }, propertyId: property.id } }), 0, "no automatic or bulk run was created");
  globalThis.fetch = realFetch;
  await db().$disconnect();
});
