import assert from "node:assert/strict";
import { test } from "node:test";

import { serverlessDatabaseUrl } from "@home88/database";

const POOLER = "postgresql://postgres.ref:pw@aws-0-eu-west-2.pooler.supabase.com:6543/postgres";

test("pooler URLs get pgbouncer, a usable pool and a longer wait", () => {
  const out = new URL(serverlessDatabaseUrl(`${POOLER}?pgbouncer=true&connection_limit=1`)!);
  assert.equal(out.searchParams.get("pgbouncer"), "true");
  assert.equal(out.searchParams.get("connection_limit"), "5");
  assert.equal(out.searchParams.get("pool_timeout"), "30");
  assert.equal(decodeURIComponent(out.password), "pw");
});

test("explicit larger settings are kept", () => {
  const out = new URL(serverlessDatabaseUrl(`${POOLER}?connection_limit=10&pool_timeout=5`)!);
  assert.equal(out.searchParams.get("connection_limit"), "10");
  assert.equal(out.searchParams.get("pool_timeout"), "5");
});

test("other URLs are untouched", () => {
  for (const raw of [
    "postgresql://postgres:pw@db.ref.supabase.co:5432/postgres",
    "postgresql://u:p@localhost:5432/db",
    "not a url",
  ]) {
    assert.equal(serverlessDatabaseUrl(raw), raw);
  }
  assert.equal(serverlessDatabaseUrl(undefined), undefined);
});
