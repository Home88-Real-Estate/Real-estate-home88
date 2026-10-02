import assert from "node:assert/strict";
import { test } from "node:test";

import { hashPassword, verifyStoredPassword } from "./passwords";

// Lowest cost the verifier accepts, to keep the test fast.
const ROUNDS = 10;
const timing = hashPassword("timing-equaliser", ROUNDS);

test("a stored hash verifies its own password only", () => {
  const stored = hashPassword("correct horse", ROUNDS);
  assert.equal(verifyStoredPassword("correct horse", stored, timing), true);
  assert.equal(verifyStoredPassword("wrong", stored, timing), false);
});

test("an account without a password never authenticates", () => {
  assert.equal(verifyStoredPassword("anything", null, timing), false);
  assert.equal(verifyStoredPassword("anything", undefined, timing), false);
  // Not even with the timing hash's own plaintext.
  assert.equal(verifyStoredPassword("timing-equaliser", null, timing), false);
});
