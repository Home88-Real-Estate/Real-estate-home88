#!/usr/bin/env node
/**
 * CI guard for an additive portal migration.
 *
 * Builds a throwaway database from every migration EXCEPT the one under test,
 * fills the existing portal tables with rows, applies the migration, and proves
 * that nothing was lost or rewritten, that the new objects are deny-by-default
 * (RLS on, no grants to the Supabase roles), and that the new foreign keys never
 * cascade-delete history. Uses the standard PG* variables (PGHOST, PGPORT,
 * PGUSER, PGPASSWORD); PGHOST may be a socket directory.
 *
 *   node scripts/check-portal-migration.mjs [migration-folder-name]
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const target = process.argv[2] ?? "20261019000000_portal_accounts";
const root = new URL("..", import.meta.url).pathname;
const prismaDir = join(root, "packages/database/prisma");
const db = `migcheck_${process.pid}`;
const host = process.env.PGHOST ?? "localhost";
const port = process.env.PGPORT ?? "5432";
const user = process.env.PGUSER ?? "postgres";
const password = process.env.PGPASSWORD ?? "";
const url = host.startsWith("/")
  ? `postgresql://${user}@localhost:${port}/${db}?host=${host}`
  : `postgresql://${user}:${encodeURIComponent(password)}@${host}:${port}/${db}?schema=public`;

const fail = (m) => {
  console.error(`::error::${m}`);
  process.exitCode = 1;
  throw new Error(m);
};
const psql = (database, sql) => execFileSync("psql", ["-h", host, "-p", port, "-U", user, "-d", database, "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const deploy = (dir) => execFileSync("npx", ["prisma", "migrate", "deploy", "--schema", join(dir, "schema.prisma")], { cwd: root, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });

const work = mkdtempSync(join(tmpdir(), "migcheck-"));
try {
  psql("postgres", `create database ${db}`);
  mkdirSync(join(work, "migrations"));
  cpSync(join(prismaDir, "schema.prisma"), join(work, "schema.prisma"));
  cpSync(join(prismaDir, "migrations/migration_lock.toml"), join(work, "migrations/migration_lock.toml"));
  const all = readdirSync(join(prismaDir, "migrations"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  if (!all.includes(target)) fail(`migration ${target} not found`);
  for (const name of all) if (name !== target && name < target) cpSync(join(prismaDir, "migrations", name), join(work, "migrations", name), { recursive: true });
  if (all.some((n) => n > target)) console.log(`note: ${all.filter((n) => n > target).length} later migration(s) are ignored for this check`);

  deploy(work);
  console.log("base schema built without", target);

  // Existing portal data, in every table the migration touches or neighbours.
  psql(db, `
    insert into properties (id, reference, slug, "listingType", "propertyType", "titleEl", "descriptionEl", "updatedAt") values ('mp1', 'MIG-1', 'mig-1', 'SALE', 'APARTMENT', 't', 'd', now());
    insert into portals (id, name, code, "updatedAt") values ('mportal', 'Mig Portal', 'MIG_PORTAL', now());
    insert into portal_listings (id, "portalId", "propertyId", "updatedAt", state, "externalId") values ('mlist', 'mportal', 'mp1', now(), 'PUBLISHED', 'ext-1');
    insert into portal_sync_logs (id, "portalId", "portalListingId", "propertyId", action, ok, detail) values ('mlog', 'mportal', 'mlist', 'mp1', 'PUBLISH', true, 'seed');
    insert into portal_mappings (id, "portalId", kind, "internalCode", "updatedAt") values ('mmap', 'mportal', 'TYPE', 'APARTMENT', now());
    insert into portal_property_mappings (id, "portalId", "propertyId", "externalId", "updatedAt") values ('mpm', 'mportal', 'mp1', 'ext-1', now());
    insert into portal_feed_versions (id, "portalId", version, "schemaVersion", "propertyCount", checksum) values ('mfeed', 'mportal', 1, '1', 1, 'abc');
    insert into portal_publication_rules (id, "portalId", mode, "updatedAt") values ('mrule', 'mportal', 'ALL_WEBSITE', now());`);
  const snapshot = () =>
    psql(db, `select md5(string_agg(t, '|' order by t)) from (
      select 'l' || (to_jsonb(l) #- '{lastAction}' #- '{lastActionAt}' #- '{lastActionById}' #- '{lastFailedAt}' #- '{lastSuccessfulSyncAt}' #- '{payloadSnapshot}' #- '{portalAccountId}')::text as t from portal_listings l
      union all select 'g' || (to_jsonb(g) #- '{syncRunId}')::text from portal_sync_logs g
      union all select 'p' || to_jsonb(p)::text from portals p
      union all select 'm' || to_jsonb(m)::text from portal_mappings m
      union all select 'q' || to_jsonb(q)::text from portal_property_mappings q
      union all select 'f' || to_jsonb(f)::text from portal_feed_versions f
      union all select 'r' || to_jsonb(r)::text from portal_publication_rules r) s`);
  const before = snapshot();

  cpSync(join(prismaDir, "migrations", target), join(work, "migrations", target), { recursive: true });
  deploy(work);
  console.log("migration applied:", target);

  if (snapshot() !== before) fail("existing portal rows changed during the migration");
  const counts = psql(db, `select (select count(*) from portals), (select count(*) from portal_listings), (select count(*) from portal_sync_logs), (select count(*) from portal_mappings), (select count(*) from portal_property_mappings), (select count(*) from portal_feed_versions), (select count(*) from portal_publication_rules)`);
  if (counts !== "1|1|1|1|1|1|1") fail(`row counts changed: ${counts}`);

  const rls = psql(db, `select string_agg(relname || '=' || relrowsecurity, ',' order by relname) from pg_class where relname in ('portal_accounts','portal_sync_runs') and relkind = 'r'`);
  if (rls !== "portal_accounts=true,portal_sync_runs=true") fail(`RLS not enabled on the new tables: ${rls}`);
  const policies = psql(db, `select count(*) from pg_policies where tablename in ('portal_accounts','portal_sync_runs')`);
  if (policies !== "0") fail("the new tables must have no policy (deny by default)");

  // Simulate Supabase's default grants, then prove the migration's revoke block removes them.
  psql("postgres", `do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end $$`);
  // (The roles are cluster-wide and harmless: they own and can do nothing.)
  psql(db, `grant all on table portal_accounts, portal_sync_runs to anon, authenticated`);
  const block = readFileSync(join(prismaDir, "migrations", target, "migration.sql"), "utf8");
  psql(db, block.slice(block.indexOf("DO $$")));
  const grants = psql(db, `select count(*) from information_schema.role_table_grants where table_name in ('portal_accounts','portal_sync_runs') and grantee in ('anon','authenticated')`);
  if (grants !== "0") fail(`the new tables still grant access to the public API roles (${grants})`);

  // History survives the deletion of what it points at.
  psql(db, `
    insert into portal_accounts (id, "portalId", "accountName", "updatedAt") values ('macct', 'mportal', 'A', now());
    insert into portal_sync_runs (id, "portalId", "portalAccountId", operation) values ('mrun', 'mportal', 'macct', 'PUBLISH');
    update portal_listings set "portalAccountId" = 'macct' where id = 'mlist';
    update portal_sync_logs set "syncRunId" = 'mrun' where id = 'mlog';
    delete from portal_sync_runs where id = 'mrun';
    delete from portal_accounts where id = 'macct';`);
  const survived = psql(db, `select (select count(*) from portal_listings), (select count(*) from portal_sync_logs), (select "portalAccountId" is null from portal_listings where id='mlist'), (select "syncRunId" is null from portal_sync_logs where id='mlog')`);
  if (survived !== "1|1|t|t") fail(`deleting an account or run must not delete listings or logs: ${survived}`);
  let restricted = false;
  try {
    psql(db, `insert into portal_accounts (id, "portalId", "accountName", "updatedAt") values ('macct2', 'mportal', 'B', now()); delete from portals where id = 'mportal'`);
  } catch {
    restricted = true;
  }
  if (!restricted) fail("an account must block deleting its portal (ON DELETE RESTRICT)");

  console.log("portal migration check: PASS");
} finally {
  try { psql("postgres", `drop database if exists ${db} with (force)`); } catch { /* best effort */ }
  rmSync(work, { recursive: true, force: true });
}

