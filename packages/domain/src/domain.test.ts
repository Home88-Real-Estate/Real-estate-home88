import assert from "node:assert/strict";
import { test } from "node:test";

import {
  availableTransitions,
  can,
  checkTransition,
  isAllowedTransition,
  isPublicStatus,
  PERMISSIONS,
  type PropertyScope,
} from "./index";

const agent = { id: "agent-1", role: "AGENT" };
const otherAgent = { id: "agent-2", role: "AGENT" };
const manager = { id: "mgr", role: "MANAGER" };
const admin = { id: "adm", role: "ADMIN" };
const viewer = { id: "v", role: "VIEWER" };

const mine: PropertyScope = { agentId: "agent-1", createdById: null };
const created = { agentId: null, createdById: "agent-1" };

function sale(status: string, scope: PropertyScope = mine) {
  return { ...scope, status, listingType: "SALE" };
}

test("scoped permission: an agent may update own properties only", () => {
  assert.equal(can(agent, PERMISSIONS.PROPERTY_UPDATE, mine), true);
  assert.equal(can(agent, PERMISSIONS.PROPERTY_UPDATE, created), true);
  assert.equal(can(otherAgent, PERMISSIONS.PROPERTY_UPDATE, mine), false);
  assert.equal(can(manager, PERMISSIONS.PROPERTY_UPDATE, mine), true);
});

test("unknown roles and viewers get nothing they are not granted", () => {
  assert.equal(can({ id: "x", role: "INTRUDER" }, PERMISSIONS.PROPERTY_READ), false);
  assert.equal(can(viewer, PERMISSIONS.PROPERTY_READ), true);
  assert.equal(can(viewer, PERMISSIONS.PROPERTY_UPDATE, mine), false);
});

test("listing type decides SOLD vs RENTED", () => {
  assert.equal(isAllowedTransition("ACTIVE", "SOLD", "SALE"), true);
  assert.equal(isAllowedTransition("ACTIVE", "RENTED", "SALE"), false);
  assert.equal(isAllowedTransition("ACTIVE", "RENTED", "RENT"), true);
  assert.equal(isAllowedTransition("ACTIVE", "SOLD", "RENT"), false);
  assert.equal(isAllowedTransition("RESERVED", "SOLD", "ASSIGNMENT"), true);
});

test("illegal jumps are rejected regardless of role", () => {
  assert.equal(checkTransition(admin, sale("DRAFT"), "SOLD").ok, false);
  assert.equal(checkTransition(admin, sale("ACTIVE"), "ACTIVE").ok, false);
  assert.equal(checkTransition(admin, sale("ACTIVE"), "PUBLISHED").ok, false);
});

test("an agent can run a deal on their own listing but not reopen or archive", () => {
  assert.equal(checkTransition(agent, sale("DRAFT"), "ACTIVE").ok, true);
  assert.equal(checkTransition(agent, sale("ACTIVE"), "UNDER_OFFER").ok, true);
  assert.equal(checkTransition(agent, sale("UNDER_OFFER"), "SOLD").ok, true);
  const reopen = checkTransition(agent, sale("SOLD"), "ACTIVE");
  assert.equal(reopen.ok, false);
  assert.equal(!reopen.ok && reopen.code, "FORBIDDEN");
  assert.equal(checkTransition(agent, sale("ACTIVE"), "ARCHIVED").ok, false);
});

test("another agent cannot move someone else's listing", () => {
  const check = checkTransition(otherAgent, sale("ACTIVE"), "UNDER_OFFER");
  assert.equal(check.ok, false);
  assert.equal(!check.ok && check.code, "FORBIDDEN");
});

test("managers reopen, admins archive", () => {
  assert.equal(checkTransition(manager, sale("SOLD", created), "ACTIVE").ok, true);
  assert.equal(checkTransition(manager, sale("ACTIVE"), "ARCHIVED").ok, false);
  assert.equal(checkTransition(admin, sale("ACTIVE"), "ARCHIVED").ok, true);
  assert.equal(checkTransition(manager, sale("ARCHIVED"), "DRAFT").ok, true);
});

test("availableTransitions lists only what the actor may do", () => {
  assert.deepEqual(availableTransitions(agent, sale("ACTIVE")), [
    "UNDER_OFFER",
    "RESERVED",
    "SOLD",
    "INACTIVE",
    "DELETED",
  ]);
  assert.deepEqual(availableTransitions(otherAgent, sale("ACTIVE")), []);
  assert.deepEqual(availableTransitions(admin, { ...mine, status: "ACTIVE", listingType: "RENT" }), [
    "UNDER_OFFER",
    "RESERVED",
    "RENTED",
    "INACTIVE",
    "ARCHIVED",
    "DELETED",
  ]);
});

test("the deleted folder: soft delete, restore, and only admins remove for good", () => {
  // An agent may move their own listing to the bin, but not someone else's.
  assert.equal(checkTransition(agent, sale("ACTIVE"), "DELETED").ok, true);
  assert.equal(checkTransition(otherAgent, sale("ACTIVE"), "DELETED").ok, false);
  // Archived listings go to the bin too; like any scoped edit, a manager may
  // do it to any property while an agent only to their own.
  assert.equal(checkTransition(admin, sale("ARCHIVED"), "DELETED").ok, true);
  assert.equal(checkTransition(manager, sale("ARCHIVED"), "DELETED").ok, true);
  assert.equal(checkTransition(otherAgent, sale("ARCHIVED"), "DELETED").ok, false);

  // Out of the bin the only move is back to draft, and it is scoped like an edit.
  assert.equal(checkTransition(agent, sale("DELETED"), "DRAFT").ok, true);
  assert.equal(checkTransition(agent, sale("DELETED"), "ACTIVE").ok, false);
  assert.equal(checkTransition(otherAgent, sale("DELETED"), "DRAFT").ok, false);

  // Permanent removal is not a transition at all; its permission is admin-only.
  assert.equal(can(agent, PERMISSIONS.PROPERTY_DELETE_PERMANENT), false);
  assert.equal(can(agent, PERMISSIONS.PROPERTY_DELETE, mine), true);
  assert.equal(can(otherAgent, PERMISSIONS.PROPERTY_DELETE, mine), false);
  assert.equal(can(admin, PERMISSIONS.PROPERTY_DELETE_PERMANENT), true);

  // Deleted is never a public status.
  assert.equal(isPublicStatus("DELETED"), false);
});

test("public statuses", () => {
  assert.equal(isPublicStatus("ACTIVE"), true);
  assert.equal(isPublicStatus("UNDER_OFFER"), true);
  assert.equal(isPublicStatus("RESERVED"), true);
  assert.equal(isPublicStatus("DRAFT"), false);
  assert.equal(isPublicStatus("SOLD"), false);
});
