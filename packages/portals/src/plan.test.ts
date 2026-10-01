import assert from "node:assert/strict";
import { test } from "node:test";

import { planSync } from "./plan";

const base = {
  eligible: true,
  currentHash: "hash-new",
  lastPayloadHash: "hash-new",
  state: "PUBLISHED" as const,
};

test("nothing to do when content is unchanged", () => {
  assert.equal(planSync(base).action, null);
});

test("updates a published listing when content changes", () => {
  const result = planSync({ ...base, currentHash: "hash-changed" });
  assert.equal(result.action, "UPDATE");
});

test("publishes a property that is not listed yet", () => {
  assert.equal(planSync({ ...base, state: "NOT_PUBLISHED", lastPayloadHash: null }).action, "PUBLISH");
  assert.equal(planSync({ ...base, state: "REMOVED", lastPayloadHash: null }).action, "PUBLISH");
  assert.equal(planSync({ ...base, state: "FAILED", lastPayloadHash: null }).action, "PUBLISH");
});

test("delists a published property that is no longer eligible", () => {
  assert.equal(planSync({ ...base, eligible: false }).action, "REMOVE");
});

test("ineligible and never published is a no-op", () => {
  assert.equal(planSync({ ...base, eligible: false, state: "NOT_PUBLISHED" }).action, null);
});

test("queued work is not duplicated", () => {
  assert.equal(planSync({ ...base, state: "QUEUED" }).action, null);
  assert.equal(planSync({ ...base, state: "PUBLISHING" }).action, null);
});

test("force republishes a live listing and publishes a dark one", () => {
  assert.equal(planSync({ ...base, force: true }).action, "REPUBLISH");
  assert.equal(planSync({ ...base, state: "NOT_PUBLISHED", force: true }).action, "PUBLISH");
});
