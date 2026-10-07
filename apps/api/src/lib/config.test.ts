import assert from "node:assert/strict";
import { test } from "node:test";

import { configProblems, loadConfig, resetConfig, withPlatformDefaults } from "../config";

const SECRET = "x".repeat(40);
const KEY = Buffer.alloc(32, 7).toString("base64");

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

test("a malformed SETTINGS_ENCRYPTION_KEY is flagged by name, never by value", () => {
  const problems = configProblems({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://h/db",
    JWT_SECRET: SECRET,
    SETTINGS_ENCRYPTION_KEY: "not a key",
  });
  assert.deepEqual(problems, [{ variable: "SETTINGS_ENCRYPTION_KEY", problem: "invalid" }]);
  assert.ok(!JSON.stringify(problems).includes("not a key"), "the key value is never echoed");
});

test("a missing or valid SETTINGS_ENCRYPTION_KEY is not a startup problem", () => {
  assert.deepEqual(
    configProblems({ NODE_ENV: "production", DATABASE_URL: "postgresql://h/db", JWT_SECRET: SECRET }),
    [],
    "missing is a degraded but supported state",
  );
  assert.deepEqual(
    configProblems({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://h/db",
      JWT_SECRET: SECRET,
      SETTINGS_ENCRYPTION_KEY: KEY,
    }),
    [],
    "a 32-byte base64 key is valid",
  );
});

test("loadConfig refuses a malformed SETTINGS_ENCRYPTION_KEY in production", () => {
  resetConfig();
  try {
    assert.throws(
      () => loadConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://h/db",
        JWT_SECRET: SECRET,
        SETTINGS_ENCRYPTION_KEY: "nope",
      }),
      /SETTINGS_ENCRYPTION_KEY/,
    );
  } finally {
    resetConfig();
  }
});
