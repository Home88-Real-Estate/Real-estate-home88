import assert from "node:assert/strict";
import { test } from "node:test";

import { isAuthUid, planAdminBootstrap, type BootstrapFacts } from "./admin-bootstrap";

const EMAIL = "home88estate@gmail.com";
const UID = "63cd0c1b-7251-41a4-bdb5-e34154ad6fbd";

function facts(overrides: Partial<BootstrapFacts> = {}): BootstrapFacts {
  return {
    email: EMAIL,
    authUid: UID,
    byEmail: null,
    byAuthUid: null,
    otherSuperAdmin: null,
    force: false,
    promote: false,
    ...overrides,
  };
}

test("fresh database: creates the admin linked to the UID", () => {
  assert.deepEqual(planAdminBootstrap(facts()), { kind: "create", linkAuthUid: UID });
});

test("running twice is a no-op, not a second account", () => {
  const admin = { id: "u1", email: EMAIL, role: "SUPER_ADMIN", authUid: UID };
  assert.deepEqual(planAdminBootstrap(facts({ byEmail: admin, byAuthUid: admin })), {
    kind: "noop",
    userId: "u1",
    linkAuthUid: null,
  });
});

test("an existing SUPER_ADMIN without a UID gets linked, not recreated", () => {
  const admin = { id: "u1", email: EMAIL, role: "SUPER_ADMIN", authUid: null };
  assert.deepEqual(planAdminBootstrap(facts({ byEmail: admin })), {
    kind: "noop",
    userId: "u1",
    linkAuthUid: UID,
  });
});

test("refuses a second SUPER_ADMIN unless forced", () => {
  const plan = planAdminBootstrap(facts({ otherSuperAdmin: { email: "admin@home88.gr" } }));
  assert.equal(plan.kind, "refuse");
  assert.equal(
    planAdminBootstrap(facts({ otherSuperAdmin: { email: "admin@home88.gr" }, force: true })).kind,
    "create",
  );
});

test("an existing lower-role account is promoted only with --promote", () => {
  const agent = { id: "u2", email: EMAIL, role: "AGENT", authUid: null };
  assert.equal(planAdminBootstrap(facts({ byEmail: agent })).kind, "refuse");
  assert.deepEqual(planAdminBootstrap(facts({ byEmail: agent, promote: true })), {
    kind: "promote",
    userId: "u2",
    fromRole: "AGENT",
    linkAuthUid: UID,
  });
});

test("a UID already linked to someone else is refused", () => {
  const other = { id: "u3", email: "someone@home88.gr", role: "AGENT", authUid: UID };
  assert.equal(planAdminBootstrap(facts({ byAuthUid: other })).kind, "refuse");
  const mine = { id: "u1", email: EMAIL, role: "SUPER_ADMIN", authUid: null };
  assert.equal(planAdminBootstrap(facts({ byEmail: mine, byAuthUid: other })).kind, "refuse");
});

test("an email already linked to a different UID is refused", () => {
  const admin = {
    id: "u1",
    email: EMAIL,
    role: "SUPER_ADMIN",
    authUid: "00000000-0000-4000-8000-000000000000",
  };
  assert.equal(planAdminBootstrap(facts({ byEmail: admin })).kind, "refuse");
});

test("works without a UID", () => {
  assert.deepEqual(planAdminBootstrap(facts({ authUid: null })), {
    kind: "create",
    linkAuthUid: null,
  });
});

test("UID format check", () => {
  assert.equal(isAuthUid(UID), true);
  assert.equal(isAuthUid("not-a-uid"), false);
});
