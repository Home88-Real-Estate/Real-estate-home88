/**
 * Guards for what the public website reads and exposes. No database.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { FORBIDDEN_PUBLIC_FIELDS, PUBLIC_PROPERTY_FIELDS } from "@home88/domain";

import { handleRevalidate } from "./revalidate";
import { detailSelect, summarySelect } from "./property";

const RELATIONS = ["media", "agent", "websitePublication"];

test("the public selects stay inside the allow-list: no owner, notes, commission, legal or contact data can be read", () => {
  const allowed = new Set<string>([...PUBLIC_PROPERTY_FIELDS, ...RELATIONS]);
  for (const [name, select] of [["summarySelect", summarySelect], ["detailSelect", detailSelect]] as const) {
    for (const key of Object.keys(select)) {
      assert.ok(allowed.has(key), `${name}.${key} is not an allow-listed public field`);
      assert.ok(!(FORBIDDEN_PUBLIC_FIELDS as readonly string[]).includes(key), `${name}.${key} must never be public`);
    }
  }
  // The agent relation exposes a name only; the media relation never selects a private key or a file name.
  assert.deepEqual(Object.keys(detailSelect.agent.select).sort(), ["firstName", "lastName"]);
  assert.ok(!("originalName" in detailSelect.media.select) && !("thumbnailKey" in detailSelect.media.select));
  assert.deepEqual(Object.keys(detailSelect.websitePublication.select).sort(), ["noIndex", "visibility"]);
});

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== "node_modules" && entry !== ".next") sources(path, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry) && !/\.integration\.test\./.test(entry)) out.push(path);
  }
  return out;
}

test("nothing on the public site decides visibility from the legacy publishedOnWebsite flag", () => {
  const root = join(__dirname, "..");
  const offenders = sources(root).filter((file) => /\bpublishedOnWebsite\b/.test(readFileSync(file, "utf8")));
  assert.deepEqual(offenders, [], "the public site reads the website publication only (publicWebsiteWhere)");
});

test("every public property query takes its where clause from the one shared rule", () => {
  const property = readFileSync(join(__dirname, "property.ts"), "utf8");
  const areas = readFileSync(join(__dirname, "areas.ts"), "utf8");
  assert.ok(!/status:\s*\{\s*in:\s*\[\.\.\.PUBLIC_STATUSES\]/.test(property + areas), "no hand-written status gate");
  assert.equal((property.match(/publicWebsiteWhere\(/g) ?? []).length >= 5, true, "featured, recent, search, detail, count, sitemap");
  assert.match(areas, /publicWebsiteWhere\(/);
});

// --- Revalidation endpoint ------------------------------------------------------------------------------------------------

const SECRET = "s3cret-for-tests-only";
const post = (body: unknown, secret: string | null = SECRET) =>
  new Request("https://home88.test/api/revalidate", { method: "POST", headers: { "content-type": "application/json", ...(secret === null ? {} : { "x-revalidate-secret": secret }) }, body: typeof body === "string" ? body : JSON.stringify(body) });

test("revalidation: refuses everything without a configured secret, and anyone with a wrong or missing one", async () => {
  const paths: string[] = [];
  const spy = (p: string) => void paths.push(p);
  assert.equal((await handleRevalidate(post({ references: ["H88-000001"] }), spy, "")).status, 503);
  assert.equal((await handleRevalidate(post({ references: ["H88-000001"] }), spy, undefined)).status, 503);
  assert.equal((await handleRevalidate(post({ references: ["H88-000001"] }, null), spy, SECRET)).status, 401);
  assert.equal((await handleRevalidate(post({ references: ["H88-000001"] }, "wrong"), spy, SECRET)).status, 401);
  assert.equal((await handleRevalidate(post({ references: ["H88-000001"] }, SECRET + "x"), spy, SECRET)).status, 401);
  assert.deepEqual(paths, [], "nothing is revalidated for a refused request");
});

test("revalidation: only well-formed property references are accepted", async () => {
  const spy = () => {};
  for (const body of ["not json", { references: "H88-000001" }, { references: ["../../etc"] }, { references: ["H88-12"] }, { references: [1] }, { references: Array.from({ length: 51 }, (_, i) => `H88-${String(i).padStart(6, "0")}`) }, {}, null]) {
    assert.equal((await handleRevalidate(post(body), spy, SECRET)).status, 400, JSON.stringify(body).slice(0, 40));
  }
});

test("revalidation: refreshes the property page, the listings, the areas and the sitemap, once each", async () => {
  const paths: string[] = [];
  const out = await handleRevalidate(post({ references: ["h88-000001", "H88-000001", "H88-000002"] }), (p) => void paths.push(p), SECRET);
  assert.equal(out.status, 200);
  assert.deepEqual(paths, ["/property/H88-000001", "/property/H88-000002", "/", "/properties", "/areas", "/sitemap.xml"]);
  assert.deepEqual(out.body.revalidated, paths);
});
