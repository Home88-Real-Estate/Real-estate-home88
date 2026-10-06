/** The object-storage document store: links are signed and short-lived, and a bare object URL is useless. No network. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Synthetic, runtime-assembled values: nothing credential-shaped is committed.
const FAKE_ACCESS = ["synthetic", "access", "id"].join("-");
const FAKE_SECRET = ["synthetic", "secret", "not", "real"].join("-");

test("signed document links expire quickly, are bound to a signature, and force a download", async () => {
  process.env.DATABASE_URL ??= "postgresql://unused:unused@localhost:5432/unused"; // config requires it; nothing connects
  process.env.S3_ENDPOINT = "https://storage.example.test";
  process.env.S3_ACCESS_KEY = FAKE_ACCESS;
  process.env.S3_SECRET_KEY = FAKE_SECRET;
  process.env.S3_BUCKET = "private-bucket-test";
  const { documentStore, setDocumentStore } = await import("./document-store");
  setDocumentStore(null);
  const store = documentStore();
  assert.ok(store.configured());

  const key = "private/documents/showings/abc/ΥΠ-2026-000001-0123456789abcdef.pdf";
  const link = new URL(await store.signedGet(key, "Υπόδειξη ΥΠ-2026-000001.pdf", 120));
  assert.equal(link.searchParams.get("X-Amz-Expires"), "120", "the link lives two minutes");
  assert.ok(link.searchParams.get("X-Amz-Signature"), "the link carries a signature");
  assert.match(link.searchParams.get("response-content-disposition") ?? "", /^attachment;/, "browsers download instead of rendering inline");

  // Without the query string there is no authority at all: the bare object URL carries nothing that grants access.
  const bare = `${link.origin}${link.pathname}`;
  assert.ok(!/X-Amz|Signature|Credential|token/i.test(bare));
  assert.ok(!bare.includes(FAKE_SECRET) && !link.search.includes(FAKE_SECRET), "the secret never appears in a link");

  const upload = new URL((await store.presignPut(key, "application/pdf", 1234)).url);
  assert.equal(upload.searchParams.get("X-Amz-Expires"), "600", "upload links are short-lived too");
});

test("documents are never written with a public ACL", () => {
  const source = readFileSync(new URL("./document-store.ts", import.meta.url), "utf8");
  assert.ok(!/ACL\s*:/.test(source), "no ACL is ever set on a document object");
  assert.ok(!/public-read/i.test(source));
});
