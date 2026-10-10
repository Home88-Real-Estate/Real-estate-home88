import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DOCUMENT_ITEM_STATUSES, REVIEW_STATUSES, suggestedDocuments, summarizeChecklist } from "./property-documents";

describe("property document checklist", () => {
  const usual = (l: string, t: string) => suggestedDocuments(l, t).filter((s) => s.level === "usual").map((s) => s.kind).sort();

  it("suggests what is usually gathered for each kind of listing", () => {
    assert.deepEqual(usual("SALE", "APARTMENT"), ["BUILDING_PERMIT", "CADASTRE", "ENERGY_CERT", "ENGINEER_CERT", "MANDATE", "TAX", "TITLE_DEED"]);
    assert.deepEqual(usual("SALE", "PLOT"), ["CADASTRE", "MANDATE", "TAX", "TITLE_DEED", "TOPOGRAPHIC"]);
    assert.deepEqual(usual("RENT", "STUDIO"), ["ENERGY_CERT", "MANDATE"]);
    assert.ok(!usual("RENT", "PARKING").includes("ENERGY_CERT"), "no energy certificate for a parking space");
    assert.ok(!usual("SALE", "PARKING").includes("ENGINEER_CERT"));
  });

  it("counts only what is required; verified only after review; problems separately", () => {
    const s = summarizeChecklist([{ status: "VERIFIED" }, { status: "UPLOADED" }, { status: "PENDING" }, { status: "REQUESTED" }, { status: "REJECTED" }, { status: "NOT_REQUIRED" }]);
    assert.deepEqual(s, { total: 6, required: 5, done: 2, verified: 1, waiting: 2, problems: 1 });
    assert.deepEqual(summarizeChecklist([]), { total: 0, required: 0, done: 0, verified: 0, waiting: 0, problems: 0 });
  });

  it("has the eight explicit statuses, two of them a manager's review", () => {
    assert.deepEqual(DOCUMENT_ITEM_STATUSES, ["NOT_REQUIRED", "PENDING", "REQUESTED", "UPLOADED", "IN_REVIEW", "VERIFIED", "REJECTED", "EXPIRED"]);
    assert.deepEqual(REVIEW_STATUSES, ["VERIFIED", "REJECTED"]);
  });
});
