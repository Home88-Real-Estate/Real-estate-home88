/**
 * Database security regression checks.
 *
 * The static checks always run. The live checks run against a real database
 * only when DB_SECURITY_TEST_URL is set (e.g. in a deploy pipeline):
 *   DB_SECURITY_TEST_URL=postgresql://… npm test -w @home88/database
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";

// Tests run from the package directory (npm test -w @home88/database).
const MIGRATIONS = join(process.cwd(), "prisma", "migrations");

test("rls_auto_enable is locked down by a versioned migration", () => {
  const dirs = readdirSync(MIGRATIONS).filter((d) => d.endsWith("_lock_rls_auto_enable"));
  assert.equal(dirs.length, 1);
  const sql = readFileSync(join(MIGRATIONS, dirs[0]!, "migration.sql"), "utf8");
  for (const role of ["PUBLIC", "anon", "authenticated"]) {
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.rls_auto_enable\\(\\) FROM ${role}`));
  }
  assert.doesNotMatch(sql, /DROP (FUNCTION|EVENT TRIGGER)/i, "the RLS safety net itself must stay");
});

test("every migration that creates a table also enables RLS on it", () => {
  const dirs = readdirSync(MIGRATIONS).filter((d) => /^\d{14}_/.test(d)).sort();
  for (const [i, dir] of dirs.entries()) {
    // A table may be locked in the same migration or a later one.
    const sql = dirs.slice(i).map((d) => readFileSync(join(MIGRATIONS, d, "migration.sql"), "utf8")).join("\n");
    // Tables created before 20261004000000_lock_public_api got RLS from that migration.
    if (dir.slice(0, 14) <= "20261004000000") continue;
    for (const [, table] of sql.matchAll(/CREATE TABLE "([a-z_]+)"/g)) {
      assert.match(sql, new RegExp(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`), `${dir}: ${table} without RLS`);
    }
  }
});

const url = process.env.DB_SECURITY_TEST_URL;

test("live: public API roles cannot execute rls_auto_enable, the trigger still exists, RLS is on", { skip: !url && "DB_SECURITY_TEST_URL not set" }, async () => {
  const db = new PrismaClient({ datasources: { db: { url: url! } } });
  try {
    const privileges = await db.$queryRawUnsafe<Array<{ role: string; allowed: boolean }>>(
      `select r.role, has_function_privilege(r.role, 'public.rls_auto_enable()', 'EXECUTE') as allowed
         from (values ('anon'), ('authenticated')) as r(role)`,
    );
    for (const p of privileges) assert.equal(p.allowed, false, `${p.role} can execute rls_auto_enable`);
    const acl = await db.$queryRawUnsafe<Array<{ acl: string }>>(
      `select coalesce(proacl::text, '') as acl from pg_proc where proname = 'rls_auto_enable'`,
    );
    assert.ok(!/(^|[{,])=X/.test(acl[0]?.acl ?? ""), "PUBLIC still holds EXECUTE");
    const trigger = await db.$queryRawUnsafe<unknown[]>(`select 1 from pg_event_trigger where evtname = 'ensure_rls' and evtenabled <> 'D'`);
    assert.equal(trigger.length, 1, "ensure_rls event trigger must stay enabled");
    const open = await db.$queryRawUnsafe<Array<{ relname: string }>>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    assert.deepEqual(open.map((r) => r.relname), [], "tables without RLS");
  } finally {
    await db.$disconnect();
  }
});
