import assert from "node:assert/strict";
import { createHmac, timingSafeEqual } from "node:crypto";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/test";
process.env.SITE_URL = "https://site.example";

const { resetConfig } = await import("../config");
const { unsubscribeAvailable, unsubscribeUrl } = await import("./unsubscribe");

test("no UNSUBSCRIBE_SECRET: no link, so marketing mail is refused upstream", () => {
  process.env.UNSUBSCRIBE_SECRET = "";
  resetConfig();
  assert.equal(unsubscribeAvailable(), false);
  assert.equal(unsubscribeUrl("a@b.gr"), null);
});

test("links verify with the website's algorithm", () => {
  process.env.UNSUBSCRIBE_SECRET = "s3cret-for-tests";
  resetConfig();
  const url = unsubscribeUrl(" Maria@Example.GR ")!;
  assert.ok(url.startsWith("https://site.example/unsubscribe?token="));
  const token = new URL(url).searchParams.get("token")!;
  const dot = token.lastIndexOf(".");
  const email = Buffer.from(token.slice(0, dot).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString();
  assert.equal(email, "maria@example.gr");
  // apps/web/src/lib/unsubscribe-token.ts, reproduced: HMAC over the address, base64url, constant-time compare.
  const expected = Buffer.from(createHmac("sha256", "s3cret-for-tests").update(email).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
  assert.ok(timingSafeEqual(expected, Buffer.from(token.slice(dot + 1))));
  process.env.UNSUBSCRIBE_SECRET = "";
  resetConfig();
});
