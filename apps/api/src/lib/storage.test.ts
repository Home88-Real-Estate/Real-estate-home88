import assert from "node:assert/strict";
import { test } from "node:test";

// Signing is a local computation; no storage server is contacted.
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/test";
process.env.S3_ENDPOINT = "https://storage.example.com";
process.env.S3_ACCESS_KEY = "test-access-key";
process.env.S3_SECRET_KEY = "test-secret-key";
process.env.S3_BUCKET = "home88-media";
process.env.S3_FORCE_PATH_STYLE = "true";

const { presignPut, resetStorageClient } = await import("./storage");

test("a sized upload URL signs the content type and exact length", async () => {
  resetStorageClient();
  const { url, headers } = await presignPut("properties/p/photo/2026/10/a.jpg", "image/jpeg", 1234);
  const signed = new URL(url).searchParams.get("X-Amz-SignedHeaders") ?? "";
  assert.ok(url.startsWith("https://storage.example.com/home88-media/properties/p/photo/"));
  assert.ok(signed.includes("content-type"), signed);
  assert.ok(signed.includes("content-length"), signed);
  assert.equal(headers["content-type"], "image/jpeg");
  assert.ok(Number(new URL(url).searchParams.get("X-Amz-Expires")) <= 900);
});

test("a variant URL signs the type but not a length", async () => {
  resetStorageClient();
  const { url } = await presignPut("properties/p/photo/2026/10/a.preview.jpg", "image/jpeg");
  const signed = new URL(url).searchParams.get("X-Amz-SignedHeaders") ?? "";
  assert.ok(signed.includes("content-type"), signed);
  assert.ok(!signed.includes("content-length"), signed);
});
