import assert from "node:assert/strict";
import { test } from "node:test";
import { formatReference, slugify } from "./references";

test("formatReference zero-pads to six digits", () => {
  assert.equal(formatReference(1), "H88-000001");
  assert.equal(formatReference(42), "H88-000042");
  assert.equal(formatReference(999999), "H88-999999");
});

test("formatReference does not truncate beyond six digits", () => {
  assert.equal(formatReference(1234567), "H88-1234567");
});

test("slugify strips latin accents", () => {
  assert.equal(slugify("Café Résidence", "H88-000001"), "cafe-residence-h88-000001");
});

test("slugify keeps Greek letters but strips combining accents", () => {
  assert.equal(slugify("Νέα Διαμέρισμα", "H88-000042"), "νεα-διαμερισμα-h88-000042");
});

test("slugify collapses and trims non-alphanumerics", () => {
  assert.equal(slugify("  ---Hello!!! ---World---  ", "H88-000002"), "hello-world-h88-000002");
});

test("slugify falls back to the reference for an empty title", () => {
  assert.equal(slugify("", "H88-000009"), "h88-000009");
  assert.equal(slugify("!!!", "H88-000009"), "h88-000009");
});

test("slugify caps the base at 60 characters", () => {
  const slug = slugify("a".repeat(200), "H88-000003");
  assert.equal(slug, `${"a".repeat(60)}-h88-000003`);
});
