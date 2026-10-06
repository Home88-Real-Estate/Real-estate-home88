/**
 * Property photo upload through the real API and a real Postgres, with an
 * in-memory object store standing in for S3 (the browser's direct PUT is
 * simulated by writing into it). Covers the origin guard that blocked uploads
 * from the CRM's own origin, authentication, authorization, validation, the
 * confirm step (idempotent), cover and ordering. Runs only when
 * TEST_DATABASE_URL points at a disposable database:
 *
 *   TEST_DATABASE_URL=postgresql://… npx tsx --test src/routes/media.integration.test.ts
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

const url = process.env.TEST_DATABASE_URL;

/** A real 4x3 PNG header (enough for the dimension reader and the type check). */
function png(width = 4, height = 3): Buffer {
  const b = Buffer.alloc(33);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(0x0d0a1a0a, 4);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

test("media upload: origin guard, auth, authorization, validation, retry, cover, order", { skip: !url && "TEST_DATABASE_URL not set" }, async () => {
  process.env.DATABASE_URL = url!;
  process.env.JWT_SECRET ??= randomBytes(32).toString("base64");
  process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
  process.env.PII_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
  process.env.S3_ENDPOINT = "http://s3.test";
  process.env.S3_REGION = "us-east-1";
  process.env.S3_ACCESS_KEY = "test-access";
  process.env.S3_SECRET_KEY = "test-secret";
  process.env.S3_BUCKET = "test-bucket";
  process.env.S3_FORCE_PATH_STYLE = "true";
  process.env.CRM_URL = "https://crm.home88.test";
  process.env.SITE_URL = "https://home88.test";
  process.env.CRM_PUBLIC_ORIGINS = "https://www.home88.test";
  const { handleApiRequest } = await import("../handler");
  const { db } = await import("../lib/prisma");
  const { hashPassword } = await import("../lib/passwords");
  const { resetConfig } = await import("../config");
  const { storageClient, resetStorageClient } = await import("../lib/storage");
  resetConfig();
  resetStorageClient();

  // In-memory bucket: Head / Get(range) / Delete go through the client's send().
  const bucket = new Map<string, { body: Buffer; type: string }>();
  const c = storageClient() as unknown as { send: (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => Promise<unknown> };
  c.send = async (cmd) => {
    const key = String(cmd.input.Key);
    const obj = bucket.get(key);
    switch (cmd.constructor.name) {
      case "HeadObjectCommand":
        if (!obj) throw Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
        return { ContentLength: obj.body.length, ContentType: obj.type };
      case "GetObjectCommand":
        if (!obj) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
        return { Body: { transformToByteArray: async () => new Uint8Array(obj.body) } };
      case "DeleteObjectCommand":
        bucket.delete(key);
        return {};
      default:
        throw new Error(`unexpected ${cmd.constructor.name}`);
    }
  };

  const run = randomBytes(4).toString("hex");
  const password = "Integration-Test-Password-123";
  const hash = hashPassword(password, 10);
  const mk = (role: string, tag: string) => db().user.create({ data: { email: `${tag}-${run}@test.invalid`, firstName: tag, lastName: "Test", role: role as never, passwordHash: hash } });
  const [agent, other, manager] = await Promise.all([mk("AGENT", "mdagent"), mk("AGENT", "mdother"), mk("MANAGER", "mdmanager")]);
  async function login(email: string) {
    const res = await handleApiRequest(new Request("http://crm.test/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }));
    assert.equal(res.status, 200, `login ${email}`);
    return res.headers.get("set-cookie")!.split(";")[0]!;
  }
  const [agentCookie, otherCookie, managerCookie] = await Promise.all([login(agent.email), login(other.email), login(manager.email)]);

  const SELF = "https://real-estate-home88-iota.vercel.app";
  const call = async (cookie: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const h: Record<string, string> = { host: new URL(SELF).host, "x-forwarded-host": new URL(SELF).host, "x-forwarded-proto": "https", origin: SELF, ...headers };
    if (body !== undefined) h["content-type"] = "application/json";
    if (cookie) h.cookie = cookie;
    const res = await handleApiRequest(new Request(`http://crm.test/api${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
  };

  const property = await db().property.create({ data: { reference: `MD-${run.toUpperCase()}`, slug: `md-${run}`, listingType: "SALE", propertyType: "APARTMENT", titleEl: "Δοκιμή", descriptionEl: "Δοκιμή", price: 100000, status: "ACTIVE", agentId: agent.id, createdById: agent.id } });
  const base = `/properties/${property.id}/media`;
  const ask = (name: string, mimeType: string, byteSize: number, cookie: string | null = agentCookie, headers: Record<string, string> = {}) =>
    call(cookie, "POST", `${base}/uploads`, { fileName: name, mimeType, byteSize, kind: "PHOTO", withVariants: false }, headers);

  // ---- Origin guard -------------------------------------------------------------------
  assert.equal((await ask("a.png", "image/png", 33)).status, 201, "the origin the CRM is served from is accepted, with no configuration naming it");
  assert.equal((await ask("a.png", "image/png", 33, agentCookie, { origin: "https://crm.home88.test" })).status, 201, "CRM_URL is accepted");
  assert.equal((await ask("a.png", "image/png", 33, agentCookie, { origin: "https://www.home88.test" })).status, 201, "CRM_PUBLIC_ORIGINS is accepted");
  for (const origin of ["https://evil.example", "https://other.vercel.app", `${SELF}.evil.example`, "null"]) {
    const r = await ask("a.png", "image/png", 33, agentCookie, { origin });
    assert.equal(r.status, 403, origin);
    assert.equal(r.body.error.code, "csrf_origin");
  }
  assert.equal((await ask("a.png", "image/png", 33, agentCookie, { origin: "" })).status, 201, "non-browser clients send no Origin and still need a session");

  // ---- Authentication and authorization ----------------------------------------------------
  assert.equal((await ask("a.png", "image/png", 33, null)).status, 401, "anonymous");
  assert.equal((await ask("a.png", "image/png", 33, otherCookie)).status, 403, "an agent who does not own the property");
  assert.equal((await ask("a.png", "image/png", 33, managerCookie)).status, 201, "managers may");
  assert.equal((await call(agentCookie, "POST", "/properties/nope/media/uploads", { fileName: "a.png", mimeType: "image/png", byteSize: 33 })).status, 404);

  // ---- Request validation ----------------------------------------------------------------------
  assert.equal((await ask("a.pdf", "application/pdf", 100)).status, 400, "a PDF is not a photo");
  assert.equal((await ask("a.exe", "application/x-msdownload", 100)).status, 400);
  assert.equal((await ask("big.png", "image/png", 26 * 1024 * 1024)).status, 413, "over 25 MB");
  for (const mime of ["image/jpeg", "image/png", "image/webp", "image/avif"]) assert.equal((await ask("x", mime, 100)).status, 201, mime);

  // ---- Upload (simulated PUT) and confirm ---------------------------------------------------------
  async function upload(name: string, bytes: Buffer, type = "image/png") {
    const t = await ask(name, type, bytes.length);
    assert.equal(t.status, 201, JSON.stringify(t.body));
    assert.ok(t.body.upload.url.includes("X-Amz-Signature"), "a signed, short-lived URL; storage credentials are never returned");
    assert.ok(!JSON.stringify(t.body).includes("test-secret"));
    bucket.set(t.body.storageKey, { body: bytes, type });
    return t.body.storageKey as string;
  }
  const confirm = (storageKey: string, cookie: string | null = agentCookie) => call(cookie, "POST", `${base}/confirm`, { storageKey, kind: "PHOTO", hasPreview: false, hasThumbnail: false });

  const k1 = await upload("one.png", png(640, 480));
  let r = await confirm(k1);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.media.status, "pending_review", "nothing is public on arrival");
  assert.deepEqual([r.body.media.width, r.body.media.height], [640, 480]);
  assert.equal(r.body.media.isPrimary, true, "the first photo becomes the cover");
  const m1 = r.body.media.id;

  r = await confirm(k1);
  assert.equal(r.status, 200);
  assert.equal(r.body.duplicate, true, "retrying a confirm returns the same row");
  assert.equal(await db().propertyMedia.count({ where: { propertyId: property.id } }), 1, "no duplicate record");

  assert.equal((await confirm(k1, null)).status, 401);
  assert.equal((await confirm(k1, otherCookie)).status, 403, "confirming against a property you cannot edit");
  assert.equal((await call(agentCookie, "POST", `${base}/confirm`, { storageKey: `properties/${property.id}/forged.png`, kind: "PHOTO" })).status, 400, "a key the API never issued");

  // The bytes must match the declared type: a renamed text file is removed and not recorded.
  const kBad = await upload("fake.png", Buffer.from("this is not an image at all, just text"));
  r = await confirm(kBad);
  assert.equal(r.status, 400);
  assert.equal(bucket.has(kBad), false, "the rejected object is deleted from storage");
  const kMissing = (await ask("never.png", "image/png", 33)).body.storageKey;
  assert.equal((await confirm(kMissing)).status, 400, "storage never received the file: nothing is recorded as uploaded");
  assert.equal(await db().propertyMedia.count({ where: { propertyId: property.id } }), 1);

  // ---- Several files; one failure does not fail the rest -------------------------------------------------
  const keys = [await upload("two.png", png()), await upload("three.png", png(8, 6)), await upload("four.png", png(10, 10))];
  const results = await Promise.all([...keys.map((k) => confirm(k)), confirm(kMissing)]);
  assert.deepEqual(results.map((x) => x.status), [201, 201, 201, 400]);
  const rows = await db().propertyMedia.findMany({ where: { propertyId: property.id } });
  assert.equal(rows.length, 4);
  assert.equal(rows.filter((x) => x.isPrimary).length, 1, "exactly one cover");

  // ---- Cover ------------------------------------------------------------------------------------------------
  const m3 = results[1]!.body.media.id;
  assert.equal((await call(otherCookie, "PATCH", `${base}/${m3}`, { isPrimary: true })).status, 403, "another agent cannot change the cover");
  assert.equal((await call(agentCookie, "PATCH", `${base}/${m3}`, { isPrimary: true })).status, 200);
  let now = await db().propertyMedia.findMany({ where: { propertyId: property.id }, orderBy: { sortOrder: "asc" } });
  assert.deepEqual(now.filter((x) => x.isPrimary).map((x) => x.id), [m3], "setting a cover unsets the previous one");
  await call(agentCookie, "PATCH", `${base}/${m3}`, { isPrimary: false });
  now = await db().propertyMedia.findMany({ where: { propertyId: property.id } });
  assert.equal(now.filter((x) => x.isPrimary).length, 1, "un-setting the cover never leaves the property without one");

  // ---- Order -------------------------------------------------------------------------------------------------------
  const ids = now.map((x) => x.id).reverse();
  assert.equal((await call(otherCookie, "POST", `${base}/reorder`, { ids })).status, 403);
  assert.equal((await call(agentCookie, "POST", `${base}/reorder`, { ids })).status, 200);
  const listed = await call(agentCookie, "GET", base);
  const order = listed.body.media.map((x: any) => x.id);
  assert.deepEqual(order.filter((id: string) => id !== now.find((x) => x.isPrimary)!.id), ids.filter((id) => id !== now.find((x) => x.isPrimary)!.id), "the order persists (the cover is listed first)");
  assert.equal((await call(agentCookie, "POST", `${base}/reorder`, { ids: [...ids, "someone-elses-media"] })).status, 400);

  // ---- Moderation and delete --------------------------------------------------------------------------------------------
  assert.equal((await call(agentCookie, "POST", `${base}/${m1}/status`, { status: "approved" })).status, 403, "only a manager makes media public");
  r = await call(managerCookie, "POST", `${base}/${m1}/status`, { status: "approved" });
  assert.equal(r.status, 200);
  assert.ok(!r.body.media.url.includes("X-Amz-Signature"), "approved media has a public URL");
  assert.ok(r.body.media.url.includes("/api/public-media/"), "served through the API route; the bucket itself stays private");
  // Anonymous read of an approved file works, and only of approved files.
  const publicPath = `/public-media/${r.body.media.storageKey}`;
  const anon = await handleApiRequest(new Request(`http://crm.test/api${publicPath}`));
  assert.equal(anon.status, 200, "approved photo is readable without a session");
  assert.equal(anon.headers.get("content-type"), "image/png");
  assert.equal(anon.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await anon.arrayBuffer()), bucket.get(r.body.media.storageKey)!.body);
  const stillPending = (await call(agentCookie, "GET", base)).body.media.find((x: any) => x.status === "pending_review");
  assert.equal((await handleApiRequest(new Request(`http://crm.test/api/public-media/${stillPending.storageKey}`))).status, 404, "unapproved media is not served");
  assert.equal((await handleApiRequest(new Request("http://crm.test/api/public-media/properties/nope/x.png"))).status, 404, "unknown key");
  assert.equal((await handleApiRequest(new Request("http://crm.test/api/public-media/../../etc/passwd"))).status, 404, "path tricks");
  await call(managerCookie, "POST", `${base}/${m1}/status`, { status: "rejected" });
  assert.equal((await handleApiRequest(new Request(`http://crm.test/api${publicPath}`))).status, 404, "a rejected photo stops being served");
  await call(managerCookie, "POST", `${base}/${m1}/status`, { status: "approved" });
  const pending = (await call(agentCookie, "GET", base)).body.media.find((x: any) => x.status === "pending_review");
  assert.ok(pending.url.includes("X-Amz-Signature"), "media under review is only reachable by a short-lived signed URL");

  assert.equal((await call(otherCookie, "DELETE", `${base}/${m3}`)).status, 403, "another agent cannot delete");
  assert.equal((await call(agentCookie, "DELETE", `${base}/${m3}`)).status, 200);
  assert.equal((await db().propertyMedia.findMany({ where: { propertyId: property.id } })).filter((x) => x.isPrimary).length, 1, "deleting the cover promotes another");

  // ---- Storage failure: nothing is recorded, and the error is not hidden ----------------------------------
  const before = await db().propertyMedia.count({ where: { propertyId: property.id } });
  const kStorage = await upload("five.png", png());
  const realSend = c.send;
  c.send = async (cmd) => {
    if (cmd.constructor.name === "HeadObjectCommand") throw Object.assign(new Error("storage down"), { name: "ServiceUnavailable", $metadata: { httpStatusCode: 503 } });
    return realSend(cmd);
  };
  r = await confirm(kStorage);
  assert.ok(r.status >= 500, `storage failure is reported (${r.status})`);
  c.send = realSend;
  assert.equal(await db().propertyMedia.count({ where: { propertyId: property.id } }), before, "no record for a file that could not be verified");
  assert.equal((await confirm(kStorage)).status, 201, "and the same file can be confirmed once storage is back (retry)");

  // ---- Limit: 40 files per property -----------------------------------------------------------------------------
  const room = 40 - (await db().propertyMedia.count({ where: { propertyId: property.id } }));
  await db().propertyMedia.createMany({ data: Array.from({ length: room }, (_, i) => ({ propertyId: property.id, kind: "PHOTO" as const, storageKey: `properties/${property.id}/filler-${i}.png`, originalName: `filler-${i}.png`, mimeType: "image/png", byteSize: 33, status: "pending_review", sortOrder: 100 + i })) });
  r = await ask("over.png", "image/png", 33);
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, "media_limit");

  // ---- Property list: the cover's small variant, a placeholder when there is none ----------------------------------
  const { variantKey } = await import("../lib/direct-upload");
  const p2 = await db().property.create({ data: { reference: `MX-${run.toUpperCase()}`, slug: `mx-${run}`, listingType: "SALE", propertyType: "APARTMENT", titleEl: "Δοκιμή 2", descriptionEl: "Δοκιμή", price: 90000, status: "ACTIVE", agentId: agent.id, createdById: agent.id } });
  const t2 = await call(agentCookie, "POST", `/properties/${p2.id}/media/uploads`, { fileName: "cover.png", mimeType: "image/png", byteSize: 33, kind: "PHOTO", withVariants: true });
  assert.equal(t2.status, 201);
  assert.equal(t2.body.variants.thumbnail.storageKey, variantKey(t2.body.storageKey, "thumbnail"));
  bucket.set(t2.body.storageKey, { body: png(4000, 3000), type: "image/png" });
  bucket.set(variantKey(t2.body.storageKey, "thumbnail"), { body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), type: "image/jpeg" });
  r = await call(agentCookie, "POST", `/properties/${p2.id}/media/confirm`, { storageKey: t2.body.storageKey, kind: "PHOTO", hasPreview: false, hasThumbnail: true });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const listing = await call(agentCookie, "GET", `/properties?q=${p2.reference}`);
  const row2 = listing.body.data.find((x: any) => x.id === p2.id);
  assert.ok(row2.coverThumbnailUrl.includes(variantKey(t2.body.storageKey, "thumbnail")), "the list uses the thumbnail variant, not the full-size original");
  assert.ok(row2.coverThumbnailUrl.includes("X-Amz-Signature"), "still under review: a short-lived signed URL, not a public one");
  const none = await db().property.create({ data: { reference: `MY-${run.toUpperCase()}`, slug: `my-${run}`, listingType: "SALE", propertyType: "APARTMENT", titleEl: "Χωρίς φωτογραφία", descriptionEl: "Δοκιμή", price: 1, status: "ACTIVE", agentId: agent.id, createdById: agent.id } });
  const l2 = await call(agentCookie, "GET", `/properties?q=${none.reference}`);
  assert.equal(l2.body.data.find((x: any) => x.id === none.id).coverThumbnailUrl, null, "no image: the CRM shows its placeholder");

  // ---- Audit -------------------------------------------------------------------------------------------------------------------
  const actions = (await db().auditLog.findMany({ where: { entity: "PROPERTY", entityId: property.id } })).map((a) => a.action);
  for (const a of ["media.upload", "media.update", "media.reorder", "media.approved", "media.delete"]) assert.ok(actions.includes(a), a);

  await db().$disconnect();
});
