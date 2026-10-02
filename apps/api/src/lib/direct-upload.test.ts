import assert from "node:assert/strict";
import { test } from "node:test";

import { isIssuedKey, mustSniff, variantKey } from "./direct-upload";
import { buildStorageKey } from "./media-key";

test("keys the API issues are accepted only for their own property", () => {
  const key = buildStorageKey({ propertyId: "prop1", kind: "PHOTO", mime: "image/jpeg" });
  assert.equal(isIssuedKey(key, "prop1"), true);
  assert.equal(isIssuedKey(key, "prop2"), false);
});

test("variants, traversal and foreign paths are not issued keys", () => {
  const key = buildStorageKey({ propertyId: "prop1", kind: "PHOTO", mime: "image/jpeg" });
  assert.equal(isIssuedKey(variantKey(key, "preview"), "prop1"), false);
  assert.equal(isIssuedKey("properties/prop1/../prop2/photo/2026/10/x.jpg", "prop1"), false);
  assert.equal(isIssuedKey("anything/else.jpg", "prop1"), false);
  assert.equal(isIssuedKey(key, "prop1.*"), false);
});

test("variant keys sit next to the original", () => {
  assert.equal(
    variantKey("properties/p/photo/2026/10/abc.png", "thumbnail"),
    "properties/p/photo/2026/10/abc.thumbnail.jpg",
  );
});

test("only sniffable formats must prove their content", () => {
  assert.equal(mustSniff("image/jpeg"), true);
  assert.equal(mustSniff("application/pdf"), false);
});
