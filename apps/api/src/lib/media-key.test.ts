import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildStorageKey,
  extensionFor,
  isAllowedUpload,
  kindForMime,
  sanitiseFilename,
} from "./media-key";

test("only the declared MIME allow-list is uploadable", () => {
  assert.equal(isAllowedUpload("image/jpeg"), true);
  assert.equal(isAllowedUpload("IMAGE/PNG"), true);
  assert.equal(isAllowedUpload("application/pdf"), true);
  assert.equal(isAllowedUpload("application/x-msdownload"), false);
  assert.equal(isAllowedUpload("image/svg+xml"), true);
});

test("kindForMime uses the default, honours a valid override, ignores a bogus one", () => {
  assert.equal(kindForMime("image/jpeg"), "PHOTO");
  assert.equal(kindForMime("application/pdf"), "DOCUMENT");
  assert.equal(kindForMime("image/png", "FLOOR_PLAN"), "FLOOR_PLAN");
  assert.equal(kindForMime("image/png", "NOT_A_KIND"), "PHOTO");
});

test("extensionFor prefers the MIME and falls back to the filename", () => {
  assert.equal(extensionFor("image/jpeg", "photo.JPEG"), "jpg");
  assert.equal(extensionFor("application/octet-stream", "plan.dwg"), "dwg");
  assert.equal(extensionFor("application/octet-stream", "no-extension"), "bin");
});

test("sanitiseFilename strips directory components and unsafe characters", () => {
  assert.equal(sanitiseFilename("C:\\Users\\a\\My Photo (1).jpg"), "My Photo _1_.jpg");
  assert.equal(sanitiseFilename("../../etc/passwd"), "passwd");
  assert.equal(sanitiseFilename(""), null);
  assert.equal(sanitiseFilename(undefined), null);
});

test("buildStorageKey is deterministic given a clock and id", () => {
  const key = buildStorageKey({
    propertyId: "prop_123",
    kind: "PHOTO",
    mime: "image/jpeg",
    originalName: "front.jpg",
    now: new Date("2026-03-04T05:06:07.000Z"),
    id: "abc-123",
  });
  assert.equal(key, "properties/prop_123/photo/2026/03/abc-123.jpg");
});

test("buildStorageKey lowers the kind segment and pads the month", () => {
  const key = buildStorageKey({
    propertyId: "p",
    kind: "FLOOR_PLAN",
    mime: "application/pdf",
    now: new Date("2026-11-30T23:00:00.000Z"),
    id: "x",
  });
  assert.equal(key, "properties/p/floor_plan/2026/11/x.pdf");
});
