import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkDeclaration,
  contentMatchesDeclaration,
  DEFAULT_UPLOAD_LIMITS,
  isQuarantineKeyFor,
  normaliseEmail,
  normalisePhone,
  quarantineKey,
  sanitiseAttribution,
  sniffMime,
  uploadLimitsFromEnv,
} from "./index";

// --- identity ---------------------------------------------------------------

test("email is trimmed, lower-cased and rejected when malformed", () => {
  assert.equal(normaliseEmail("  Maria@Example.COM "), "maria@example.com");
  assert.equal(normaliseEmail("nope"), null);
  assert.equal(normaliseEmail(""), null);
  assert.equal(normaliseEmail(null), null);
});

test("every way of writing a Greek number collapses to one key", () => {
  for (const raw of ["210 123 4567", "+30 210 123 4567", "0030 210-123-4567", "30 2101234567", "(210) 123.4567", "2101234567"]) {
    assert.equal(normalisePhone(raw), "2101234567", raw);
  }
  assert.equal(normalisePhone("+30 694 123 4567"), "6941234567");
});

test("foreign numbers keep their country code and junk is not a key", () => {
  assert.equal(normalisePhone("+44 20 7946 0958"), "+442079460958");
  assert.equal(normalisePhone("0044 20 7946 0958"), "+442079460958");
  for (const bad of ["", "abc", "12345", "+", "21012345678901234567", null, undefined]) {
    assert.equal(normalisePhone(bad as never), null, String(bad));
  }
});

// --- attribution ------------------------------------------------------------

test("landing page keeps the path only, never a query string or another host", () => {
  const a = sanitiseAttribution({ landingPage: "/submit?utm_source=x&email=a@b.gr#top" }, { allowCampaign: false });
  assert.equal(a.landingPage, "/submit");
  assert.equal(sanitiseAttribution({ landingPage: "//evil.example/x" }, { allowCampaign: false }).landingPage, null);
  assert.equal(sanitiseAttribution({ landingPage: "https://evil.example/x" }, { allowCampaign: false }).landingPage, null);
  assert.equal(sanitiseAttribution({ landingPage: "/a b<script>" }, { allowCampaign: false }).landingPage, null);
});

test("referrer is reduced to a hostname and own site is ignored", () => {
  const own = ["home88.vercel.app"];
  assert.equal(sanitiseAttribution({ referrer: "https://www.google.com/search?q=secret" }, { allowCampaign: false, ownHosts: own }).referrerHost, "google.com");
  assert.equal(sanitiseAttribution({ referrer: "https://home88.vercel.app/properties" }, { allowCampaign: false, ownHosts: own }).referrerHost, null);
  assert.equal(sanitiseAttribution({ referrer: "not a url" }, { allowCampaign: false }).referrerHost, null);
});

test("campaign tags are dropped unless measurement is allowed", () => {
  const raw = { utmSource: "Instagram", utmMedium: "social", utmCampaign: "spring-2026" };
  const denied = sanitiseAttribution(raw, { allowCampaign: false });
  assert.deepEqual([denied.utmSource, denied.utmMedium, denied.utmCampaign], [null, null, null]);
  const allowed = sanitiseAttribution(raw, { allowCampaign: true });
  assert.equal(allowed.utmCampaign, "spring-2026");
  assert.equal(allowed.sourceChannel, "INSTAGRAM");
  assert.equal(sanitiseAttribution({ utmCampaign: "<script>" }, { allowCampaign: true }).utmCampaign, null);
});

test("channel comes from the referrer when there is no campaign", () => {
  const ch = (referrer: string) => sanitiseAttribution({ referrer }, { allowCampaign: false }).sourceChannel;
  assert.equal(ch("https://www.facebook.com/"), "FACEBOOK");
  assert.equal(ch("https://www.spitogatos.gr/x"), "PORTAL");
  assert.equal(ch("https://blog.example.org/post"), "REFERRAL");
  assert.equal(sanitiseAttribution({}, { allowCampaign: false }).sourceChannel, null);
});

// --- files ------------------------------------------------------------------

const L = DEFAULT_UPLOAD_LIMITS;
const photo = (over: object = {}) => ({ kind: "PHOTO" as const, mimeType: "image/jpeg", fileName: "salon.jpg", byteSize: 1_000_000, ...over });

test("an ordinary photo is accepted", () => {
  assert.equal(checkDeclaration(photo(), L), null);
  assert.equal(checkDeclaration(photo({ mimeType: "image/png", fileName: "a.PNG" }), L), null);
  assert.equal(checkDeclaration({ kind: "DOCUMENT", mimeType: "application/pdf", fileName: "titlos.pdf", byteSize: 500_000 }, L), null);
});

test("executables, active content and disguised names are refused", () => {
  assert.equal(checkDeclaration(photo({ mimeType: "image/svg+xml", fileName: "a.svg" }), L)?.code, "TYPE_NOT_ALLOWED");
  assert.equal(checkDeclaration(photo({ mimeType: "text/html", fileName: "a.html" }), L)?.code, "TYPE_NOT_ALLOWED");
  assert.equal(checkDeclaration(photo({ mimeType: "application/x-msdownload", fileName: "a.exe" }), L)?.code, "TYPE_NOT_ALLOWED");
  assert.equal(checkDeclaration(photo({ fileName: "shell.php.jpg" }), L)?.code, "BLOCKED_NAME");
  assert.equal(checkDeclaration(photo({ fileName: "a.js.png", mimeType: "image/png" }), L)?.code, "BLOCKED_NAME");
  assert.equal(checkDeclaration(photo({ fileName: "salon.png" }), L)?.code, "EXTENSION_MISMATCH", "jpeg declared, png name");
  assert.equal(checkDeclaration(photo({ fileName: "noextension" }), L)?.code, "EXTENSION_MISMATCH");
  assert.equal(checkDeclaration({ kind: "PHOTO", mimeType: "application/pdf", fileName: "a.pdf", byteSize: 10 }, L)?.code, "TYPE_NOT_ALLOWED", "a PDF is not a photo");
});

test("empty and oversized files are refused against configurable limits", () => {
  assert.equal(checkDeclaration(photo({ byteSize: 0 }), L)?.code, "EMPTY");
  assert.equal(checkDeclaration(photo({ byteSize: L.maxPhotoBytes + 1 }), L)?.code, "TOO_LARGE");
  assert.equal(checkDeclaration(photo({ byteSize: 3_000_000 }), { ...L, maxPhotoBytes: 2_000_000 })?.code, "TOO_LARGE");
  assert.equal(uploadLimitsFromEnv({ INTAKE_MAX_PHOTOS: "5", INTAKE_MAX_PHOTO_BYTES: "x" }).maxPhotos, 5);
  assert.equal(uploadLimitsFromEnv({ INTAKE_MAX_PHOTO_BYTES: "x" }).maxPhotoBytes, L.maxPhotoBytes);
});

test("magic bytes decide the type, not the declaration", () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  const pdf = new TextEncoder().encode("%PDF-1.7\n");
  const webp = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
  assert.equal(sniffMime(jpeg), "image/jpeg");
  assert.equal(sniffMime(png), "image/png");
  assert.equal(sniffMime(pdf), "application/pdf");
  assert.equal(sniffMime(webp), "image/webp");
  const exe = new TextEncoder().encode("MZ\x90\0");
  const script = new TextEncoder().encode("<?php system($_GET[1]); ?>");
  assert.equal(sniffMime(exe), null);
  assert.equal(sniffMime(script), null);
  assert.equal(contentMatchesDeclaration(script, "image/jpeg"), false, "a script renamed .jpg");
  assert.equal(contentMatchesDeclaration(png, "image/jpeg"), false);
  assert.equal(contentMatchesDeclaration(jpeg, "image/jpeg"), true);
});

test("quarantine keys are random, scoped to one session and reject traversal", () => {
  const prefix = "a".repeat(32);
  const key = quarantineKey(prefix, "123e4567-e89b-12d3-a456-426614174000", "image/jpeg");
  assert.equal(key, `submissions/${prefix}/uploads/123e4567-e89b-12d3-a456-426614174000.jpg`);
  assert.equal(isQuarantineKeyFor(key, prefix), true);
  assert.equal(isQuarantineKeyFor(key, "b".repeat(32)), false, "another session's prefix");
  assert.equal(isQuarantineKeyFor(`submissions/${prefix}/uploads/../../other/x.jpg`, prefix), false);
  assert.equal(isQuarantineKeyFor(`properties/p1/photo/2026/10/123e4567-e89b-12d3-a456-426614174000.jpg`, prefix), false);
  assert.equal(isQuarantineKeyFor(key, "../etc"), false);
});
