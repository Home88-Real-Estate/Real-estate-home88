import assert from "node:assert/strict";
import { test } from "node:test";

import { canonicalJson, combineHashes, propertyContentHash } from "./hash";
import { makePortalProperty } from "./test-fixtures";
import type { PortalProperty } from "./types";

test("canonicalJson sorts keys at every level", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":1}');
});

test("canonicalJson preserves array order", () => {
  assert.equal(canonicalJson({ list: [3, 1, 2] }), '{"list":[3,1,2]}');
});

test("content hash is stable across property key order", () => {
  const original = makePortalProperty();
  const reordered = Object.fromEntries(
    Object.entries(original).reverse(),
  ) as unknown as PortalProperty;
  assert.equal(propertyContentHash(original), propertyContentHash(reordered));
});

test("content hash ignores updatedAt", () => {
  const a = makePortalProperty({ updatedAt: "2026-01-01T00:00:00.000Z" });
  const b = makePortalProperty({ updatedAt: "2026-09-09T00:00:00.000Z" });
  assert.equal(propertyContentHash(a), propertyContentHash(b));
});

test("content hash changes when displayable content changes", () => {
  const before = makePortalProperty();
  const after = makePortalProperty({ price: 260000 });
  assert.notEqual(propertyContentHash(before), propertyContentHash(after));
});

test("combined hash is order-independent", () => {
  assert.equal(combineHashes(["a", "b", "c"]), combineHashes(["c", "a", "b"]));
});
