import assert from "node:assert/strict";
import { test } from "node:test";

import { propertyUpsertSchema } from "./index";

const base = { listingType: "SALE", propertyType: "APARTMENT", titleEl: "Διαμέρισμα", descriptionEl: "Περιγραφή", price: 300000, area: 80, status: "DRAFT" };

test("an agent or owner id may be a CUID or a UUID (accounts created outside the app), never arbitrary text", () => {
  for (const id of ["cmv5snwp50001p6m53n2dgl1k", "3f6c2a1e-8b4d-4c2a-9f1e-2d3c4b5a6e7f"]) {
    const r = propertyUpsertSchema.safeParse({ ...base, agentId: id, ownerId: id });
    assert.ok(r.success, JSON.stringify(!r.success && r.error.issues));
  }
  for (const bad of ["", "has space", "x".repeat(65), "a;drop"]) {
    assert.equal(propertyUpsertSchema.safeParse({ ...base, agentId: bad }).success, false, bad);
  }
});
