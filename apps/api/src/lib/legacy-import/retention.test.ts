import assert from "node:assert/strict";
import { test } from "node:test";

import {
  configuredLegacyImportRetentionDays,
  legacyImportExpiry,
} from "./retention";

test("legacy import retention requires an explicit bounded positive integer", () => {
  assert.equal(configuredLegacyImportRetentionDays(undefined), null);
  assert.equal(configuredLegacyImportRetentionDays(""), null);
  assert.equal(configuredLegacyImportRetentionDays("0"), null);
  assert.equal(configuredLegacyImportRetentionDays("-1"), null);
  assert.equal(configuredLegacyImportRetentionDays("1.5"), null);
  assert.equal(configuredLegacyImportRetentionDays("3651"), null);
  assert.equal(configuredLegacyImportRetentionDays("30"), 30);
  assert.equal(configuredLegacyImportRetentionDays(" 90 "), 90);
});

test("legacy import expiry is calculated from the batch creation timestamp", () => {
  const createdAt = new Date("2026-11-20T10:00:00.000Z");
  assert.equal(legacyImportExpiry(createdAt, 30).toISOString(), "2026-12-20T10:00:00.000Z");
  assert.throws(() => legacyImportExpiry(createdAt, 0), RangeError);
});
