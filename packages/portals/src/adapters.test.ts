import assert from "node:assert/strict";
import { test } from "node:test";

import { getAdapter, listAdapters, registerAdapter, requireAdapter } from "./adapters";
import { spitogatosAdapter } from "./adapters/spitogatos";
import { XE_GR_COLUMNS, xeGrAdapter } from "./adapters/xe";
import { manualAdapter } from "./adapters/manual";
import { makePortalProperty } from "./test-fixtures";
import type { BuildContext, PortalAdapter } from "./types";

const context: BuildContext = {
  portal: {
    code: "SPITOGATOS",
    name: "Spitogatos",
    transport: "XML_FEED",
    defaultAgentExternalId: "AG-77",
  },
  agency: {
    name: "HOME88",
    phone: "+30 210 0000000",
    email: "info@home88.gr",
    website: "https://home88.gr",
    license: "123456789",
  },
  mediaBaseUrl: "https://cdn.home88.gr/",
};

test("spitogatos renders reference, price and agent", () => {
  const payload = spitogatosAdapter.build(makePortalProperty(), context);
  assert.match(payload.body, /<reference>H88-000001<\/reference>/);
  assert.match(payload.body, /<price currency="EUR">250000<\/price>/);
  assert.match(payload.body, /<agent external_id="AG-77" \/>/);
  assert.match(payload.body, /<last_updated>2026-10-01T09:00:00.000Z<\/last_updated>/);
});

test("spitogatos lists the primary photo first", () => {
  const payload = spitogatosAdapter.build(makePortalProperty(), context);
  assert.ok(payload.body.indexOf("2.jpg") < payload.body.indexOf("1.jpg"));
});

test("spitogatos escapes user text", () => {
  const payload = spitogatosAdapter.build(
    makePortalProperty({ titleEl: "Loft & <View>" }),
    context,
  );
  assert.ok(payload.body.includes("Loft &amp; &lt;View&gt;"));
});

test("spitogatos omits the price when it is on request", () => {
  const payload = spitogatosAdapter.build(
    makePortalProperty({ priceOnRequest: true, price: null }),
    context,
  );
  assert.ok(!payload.body.includes("<price "));
  assert.match(payload.body, /<price_on_request>true<\/price_on_request>/);
});

test("spitogatos composes a feed document", () => {
  const payloads = [
    spitogatosAdapter.build(makePortalProperty(), context),
    spitogatosAdapter.build(makePortalProperty({ reference: "H88-000002" }), context),
  ];
  const feed = spitogatosAdapter.compose!(payloads);
  assert.match(feed.body, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.ok(feed.body.includes("<properties>"));
  assert.equal(feed.propertyCount, 2);
  assert.match(feed.hash, /^[0-9a-f]{64}$/);
});

test("xe.gr writes one column per header column", () => {
  const payload = xeGrAdapter.build(makePortalProperty(), context);
  assert.equal(payload.body.split(",").length, XE_GR_COLUMNS.length);
});

test("xe.gr quotes fields containing commas and quotes", () => {
  const payload = xeGrAdapter.build(
    makePortalProperty({ descriptionEl: 'A, "B"\nC' }),
    context,
  );
  assert.ok(payload.body.includes('"A, ""B""\nC"'));
});

test("xe.gr compose emits a header row and a row per property", () => {
  const payloads = [
    xeGrAdapter.build(makePortalProperty(), context),
    xeGrAdapter.build(makePortalProperty({ reference: "H88-000002" }), context),
  ];
  const feed = xeGrAdapter.compose!(payloads);
  const lines = feed.body.split("\r\n");
  assert.equal(lines[0]!.split(",").length, XE_GR_COLUMNS.length);
  assert.ok(feed.body.includes("H88-000002"));
  assert.equal(feed.propertyCount, 2);
});

test("manual adapter produces a posting sheet", () => {
  const payload = manualAdapter.build(makePortalProperty(), context);
  assert.ok(payload.body.includes("Διαμέρισμα στην Καλλιθέα"));
  assert.ok(payload.body.includes("Photos (2):"));
  assert.equal(payload.contentType, "text/plain; charset=utf-8");
});

test("registry resolves adapters case-insensitively", () => {
  assert.equal(getAdapter("spitogatos")?.code, "SPITOGATOS");
  assert.equal(requireAdapter("XE_GR").code, "XE_GR");
  assert.equal(listAdapters().length >= 3, true);
});

test("registry throws for an unknown portal", () => {
  assert.throws(() => requireAdapter("NOPE"), /No portal adapter registered/);
});

test("custom adapters can be registered", () => {
  const custom: PortalAdapter = {
    code: "TEST_PORTAL",
    transport: "API",
    label: "Test",
    supports: () => true,
    build: (property) => ({
      propertyReference: property.reference,
      externalId: property.reference,
      body: "{}",
      contentType: "application/json",
      filename: "test.json",
      hash: property.reference,
    }),
  };
  registerAdapter(custom);
  assert.equal(getAdapter("test_portal")?.label, "Test");
});
