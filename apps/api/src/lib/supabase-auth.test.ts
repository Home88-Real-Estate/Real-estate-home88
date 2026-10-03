import assert from "node:assert/strict";
import { test } from "node:test";

import { projectRefFromDatabaseUrl, supabaseAuthConfig, verifyWithSupabaseAuth } from "./supabase-auth";

const REF = "abcdefghijklmnopqrst";
const UID = "cde0578d-bbee-4eae-9a71-ac703f3c62da";
const config = { url: `https://${REF}.supabase.co`, apiKey: "sb_publishable_test" };

test("project ref comes from the pooler user or the direct host", () => {
  assert.equal(projectRefFromDatabaseUrl(`postgresql://postgres.${REF}:pw@aws-0-eu-west-2.pooler.supabase.com:6543/postgres`), REF);
  assert.equal(projectRefFromDatabaseUrl(`postgresql://postgres:pw@db.${REF}.supabase.co:5432/postgres`), REF);
  assert.equal(projectRefFromDatabaseUrl("postgresql://u:p@localhost:5432/db"), null);
});

test("config needs a key; the URL can be derived", () => {
  assert.equal(supabaseAuthConfig({}), null);
  assert.deepEqual(
    supabaseAuthConfig({ NEXT_ANON_SB: "k", DATABASE_URL: `postgresql://postgres.${REF}:pw@h.pooler.supabase.com:6543/postgres` }),
    { url: `https://${REF}.supabase.co`, apiKey: "k" },
  );
  assert.deepEqual(supabaseAuthConfig({ SUPABASE_PUBLISHABLE_KEY: "k", SUPABASE_URL: "https://x.supabase.co/" }), {
    url: "https://x.supabase.co",
    apiKey: "k",
  });
});

function fakeFetch(status: number, body: unknown, seen?: { url?: string; init?: RequestInit }): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    if (seen) Object.assign(seen, { url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

test("accepts only when Supabase confirms the exact linked user", async () => {
  const seen: { url?: string; init?: RequestInit } = {};
  assert.equal(
    await verifyWithSupabaseAuth({ config, email: "a@b.gr", password: "pw", expectedUid: UID, fetchImpl: fakeFetch(200, { user: { id: UID } }, seen) }),
    true,
  );
  assert.equal(seen.url, `https://${REF}.supabase.co/auth/v1/token?grant_type=password`);
  assert.equal((seen.init?.headers as Record<string, string>).apikey, "sb_publishable_test");

  assert.equal(
    await verifyWithSupabaseAuth({ config, email: "a@b.gr", password: "pw", expectedUid: UID, fetchImpl: fakeFetch(200, { user: { id: "someone-else" } }) }),
    false,
    "a different identity never counts",
  );
  assert.equal(
    await verifyWithSupabaseAuth({ config, email: "a@b.gr", password: "bad", expectedUid: UID, fetchImpl: fakeFetch(400, { error: "invalid_grant" }) }),
    false,
  );
});

test("network failure is a refusal, not a crash", async () => {
  const failing = (async () => {
    throw new Error("down");
  }) as unknown as typeof fetch;
  const original = console.error;
  console.error = () => {};
  try {
    assert.equal(await verifyWithSupabaseAuth({ config, email: "a@b.gr", password: "pw", expectedUid: UID, fetchImpl: failing }), false);
  } finally {
    console.error = original;
  }
});
