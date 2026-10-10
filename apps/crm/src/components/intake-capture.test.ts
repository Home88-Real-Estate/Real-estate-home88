import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { IntakeSession } from "@/lib/intake-client";

import { keyRows } from "./intake/CapturePanel";

type F = IntakeSession["fields"];
const session = (fields: F): IntakeSession =>
  ({ fields, review: { rows: Object.keys(fields).map((key) => ({ key, label: key, display: `«${String(fields[key]!.value)}»`, origin: "AGENT_STATED", confirmed: fields[key]!.confirmed, needsConfirmation: !fields[key]!.confirmed })) } }) as unknown as IntakeSession;
const v = (value: string | number | boolean, confirmed = true) => ({ value, origin: "AGENT_STATED" as const, confirmed });

describe("what has been captured", () => {
  it("counts a fact only when it is the agent's own or approved", () => {
    const rows = keyRows(session({ price: v(350000), area: v(95), areaName: v("Γλυφάδα"), titleEl: v("Διαμέρισμα", false) }));
    assert.deepEqual(rows.map((r) => [r.key, r.state]), [["titleEl", "review"], ["descriptionEl", "missing"], ["price", "ok"], ["areaName", "ok"], ["area", "ok"]]);
    assert.equal(rows.filter((r) => r.state === "ok").length, 3);
    assert.equal(rows.find((r) => r.key === "price")!.display, "«350000»", "the value shown is the server's own display text");
  });

  it("nothing is invented: an empty draft has five missing facts", () => {
    assert.ok(keyRows(session({})).every((r) => r.state === "missing" && r.display === null));
    assert.ok(keyRows(null).every((r) => r.state === "missing"));
  });

  it("a rental counts the monthly rent; price on request counts as a price", () => {
    assert.equal(keyRows(session({ listingType: v("RENT"), monthlyRent: v(900) }))[2]!.label, "Μηνιαίο μίσθωμα");
    assert.equal(keyRows(session({ listingType: v("RENT"), monthlyRent: v(900) }))[2]!.state, "ok");
    const onRequest = keyRows(session({ priceOnRequest: v(true) }))[2]!;
    assert.deepEqual([onRequest.state, onRequest.display], ["ok", "Κατόπιν επικοινωνίας"]);
  });

  it("the city stands in for the area when only the city was given", () => {
    const place = keyRows(session({ city: v("Αθήνα", false) }))[3]!;
    assert.deepEqual([place.key, place.state, place.display], ["areaName", "review", "«Αθήνα»"]);
  });

  it("each fact leads to the step where it is corrected", () => {
    assert.deepEqual(keyRows(null).map((r) => r.step), [4, 4, 1, 1, 1]);
  });
});
