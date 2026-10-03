import assert from "node:assert/strict";
import { test } from "node:test";

import { executeTransport } from "./portal-sync";

test("a feed portal is never reported as published merely because we generated the feed", () => {
  for (const transport of ["XML_FEED", "CSV_FEED", "JSON_FEED"]) {
    const outcome = executeTransport(transport, "PUBLISH");
    assert.equal(outcome.state, "IN_FEED", transport);
    assert.match(outcome.detail, /awaiting portal import/);
    assert.equal(outcome.errorCode, null);
  }
});

test("withdrawing from a feed is a removal, an API transport fails loudly", () => {
  assert.equal(executeTransport("XML_FEED", "REMOVE").state, "REMOVED");
  assert.equal(executeTransport("API", "PUBLISH").state, "FAILED");
  assert.equal(executeTransport("API", "REMOVE").errorCode, "api_transport_unavailable");
});

test("manual portals stay queued for a human", () => {
  assert.equal(executeTransport("MANUAL", "PUBLISH").state, "QUEUED");
});
