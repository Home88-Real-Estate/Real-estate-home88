import assert from "node:assert/strict";
import { test } from "node:test";

import { configProblems, withPlatformDefaults } from "../config";

const SECRET = "x".repeat(40);

test("a complete production configuration has no problems", () => {
  assert.deepEqual(
    configProblems({ NODE_ENV: "production", DATABASE_URL: "postgresql://h/db", JWT_SECRET: SECRET }),
    [],
  );
});

test("missing DATABASE_URL and JWT_SECRET are named, never valued", () => {
  assert.deepEqual(configProblems({ NODE_ENV: "production" }), [{ variable: "DATABASE_URL", problem: "missing" }]);
  assert.deepEqual(configProblems({ NODE_ENV: "production", DATABASE_URL: "postgresql://h/db" }), [
    { variable: "JWT_SECRET", problem: "missing" },
  ]);
  const short = configProblems({ NODE_ENV: "production", DATABASE_URL: "postgresql://h/db", JWT_SECRET: "short" });
  assert.deepEqual(short, [{ variable: "JWT_SECRET", problem: "too_short" }]);
  assert.ok(!JSON.stringify(short).includes("\"short\""), "the value is never echoed");
});

test("an invalid URL variable is reported as invalid", () => {
  assert.deepEqual(
    configProblems({ NODE_ENV: "production", DATABASE_URL: "postgresql://h/db", JWT_SECRET: SECRET, CRM_URL: "not a url" }),
    [{ variable: "CRM_URL", problem: "invalid" }],
  );
});

test("development does not require a long JWT_SECRET", () => {
  assert.deepEqual(configProblems({ NODE_ENV: "development", DATABASE_URL: "postgresql://h/db" }), []);
});

test("on Vercel, CRM_URL defaults to the deployment's production address", () => {
  assert.equal(
    withPlatformDefaults({ VERCEL_PROJECT_PRODUCTION_URL: "real-estate-home88-iota.vercel.app" }).CRM_URL,
    "https://real-estate-home88-iota.vercel.app",
  );
  assert.equal(
    withPlatformDefaults({ CRM_URL: "https://crm.home88.estate", VERCEL_PROJECT_PRODUCTION_URL: "x.vercel.app" }).CRM_URL,
    "https://crm.home88.estate",
  );
  assert.equal(withPlatformDefaults({}).CRM_URL, undefined);
});
