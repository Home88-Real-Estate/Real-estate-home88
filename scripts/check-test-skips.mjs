#!/usr/bin/env node
/**
 * CI guard: a green test run that silently skipped its database suites is not
 * a pass. Two modes:
 *
 *   node scripts/check-test-skips.mjs --preflight
 *     Fails when CI=true and a database test URL is missing.
 *   node scripts/check-test-skips.mjs <tap-log>
 *     Fails when the log contains any skipped test other than the allowed ones,
 *     and prints a summary (also written to the GitHub step summary).
 */
import { appendFileSync, readFileSync } from "node:fs";

const REQUIRED_ENV = ["TEST_DATABASE_URL", "INTAKE_TEST_DATABASE_URL", "VALUATION_TEST_DATABASE_URL"];
// Checks against a live production database; never run in CI.
const ALLOWED_SKIPS = [/DB_SECURITY_TEST_URL not set/];

const arg = process.argv[2];
const fail = (message) => {
  console.error(`::error::${message}`);
  process.exit(1);
};

if (arg === "--preflight") {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (process.env.CI === "true" && missing.length) fail(`Database test URLs missing in CI: ${missing.join(", ")}. Database suites would be skipped.`);
  console.log(missing.length ? `Not in CI; missing (suites will skip locally): ${missing.join(", ")}` : "All database test URLs are set.");
  process.exit(0);
}

if (!arg) fail("Usage: check-test-skips.mjs --preflight | <tap-log>");

const log = readFileSync(arg, "utf8");
const total = (key) => [...log.matchAll(new RegExp(`^# ${key} (\\d+)$`, "gm"))].reduce((n, m) => n + Number(m[1]), 0);
const [tests, passed, failed] = ["tests", "pass", "fail"].map(total);
const skips = [...log.matchAll(/^\s*ok \d+ - (.*?) # SKIP (.*)$/gm)].map((m) => ({ name: m[1], reason: m[2] }));
const unexpected = skips.filter((s) => !ALLOWED_SKIPS.some((re) => re.test(s.reason)));

const summary = `Tests: ${passed} passed, ${failed} failed, ${skips.length} skipped (${skips.length - unexpected.length} allowed) of ${tests}; ${unexpected.length ? "SOME SUITES SKIPPED" : "no unexpected skips"}`;
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${summary}\n`);
if (tests === 0) fail("No tests were counted in the log.");
if (failed > 0) fail(`${failed} test(s) failed.`);
if (unexpected.length) fail(`Skipped tests are not allowed in CI: ${unexpected.map((s) => `"${s.name}" (${s.reason})`).join("; ")}`);
