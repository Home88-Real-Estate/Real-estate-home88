import assert from "node:assert/strict";
import { test } from "node:test";

import { isAllowedOrigin, normaliseOrigin, parseOriginList } from "./origin";

const CRM = "https://crm.home88.estate";
const allowed = [CRM, "https://home88.estate"];
const edge = (host: string, extra: Record<string, string> = {}) => ({ host, "x-forwarded-host": host, "x-forwarded-proto": "https", ...extra });

test("the origin the request was served from is accepted, whatever the alias", () => {
  const h = edge("real-estate-home88-iota.vercel.app");
  assert.equal(isAllowedOrigin("https://real-estate-home88-iota.vercel.app", allowed, h), true);
});

test("configured origins are accepted from any serving host", () => {
  assert.equal(isAllowedOrigin(CRM, allowed, edge("some-alias.vercel.app")), true);
  assert.equal(isAllowedOrigin("https://home88.estate", allowed, edge("some-alias.vercel.app")), true);
});

test("other origins are refused: another deployment, a sibling subdomain, a look-alike, null", () => {
  const h = edge("real-estate-home88-iota.vercel.app");
  for (const o of ["https://evil.example", "https://other-project.vercel.app", "https://real-estate-home88-iota.vercel.app.evil.example", "https://evil.real-estate-home88-iota.vercel.app", "null", "", "not a url", "javascript:alert(1)"]) {
    assert.equal(isAllowedOrigin(o, allowed, h), false, o);
  }
});

test("scheme and port must match the serving origin", () => {
  const h = edge("crm.example.com");
  assert.equal(isAllowedOrigin("http://crm.example.com", [], h), false);
  assert.equal(isAllowedOrigin("https://crm.example.com:8443", [], h), false);
  assert.equal(isAllowedOrigin("https://crm.example.com", [], h), true);
});

test("a forged Host cannot help a request from another site: the origin must still equal it", () => {
  assert.equal(isAllowedOrigin("https://evil.example", [], edge("crm.example.com")), false);
});

test("a local http server (no forwarded protocol) accepts only its own http origin", () => {
  assert.equal(isAllowedOrigin("http://localhost:3100", [], { host: "localhost:3100" }), true);
  assert.equal(isAllowedOrigin("http://localhost:9999", [], { host: "localhost:3100" }), false);
});

test("a request without a host accepts only configured origins", () => {
  assert.equal(isAllowedOrigin(CRM, allowed, {}), true);
  assert.equal(isAllowedOrigin("https://x.example", allowed, {}), false);
});

test("origin lists are normalised and invalid entries dropped", () => {
  assert.deepEqual(parseOriginList(" https://a.example/path , nope, http://b.example:8080 ,"), ["https://a.example", "http://b.example:8080"]);
  assert.equal(normaliseOrigin("ftp://x"), null);
});
