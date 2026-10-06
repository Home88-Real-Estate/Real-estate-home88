import assert from "node:assert/strict";
import { test } from "node:test";

import { servedAddress } from "./served-origin";

const h = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });

test("the platform's forwarded host and protocol win", () => {
  assert.deepEqual(servedAddress(h({ "x-forwarded-host": "real-estate-home88-iota.vercel.app", "x-forwarded-proto": "https", host: "internal:3000" }), "http://internal:3000/crm/api/x"), { host: "real-estate-home88-iota.vercel.app", proto: "https" });
});

test("a plain server falls back to the Host header, then the request URL", () => {
  assert.deepEqual(servedAddress(h({ host: "localhost:3100" }), "http://localhost:3100/crm/api/x"), { host: "localhost:3100", proto: "http" });
  assert.deepEqual(servedAddress(h({}), "https://crm.example.com/crm/api/x"), { host: "crm.example.com", proto: "https" });
});

test("only the first value of a proxy chain is used", () => {
  assert.deepEqual(servedAddress(h({ "x-forwarded-host": "a.example, b.example", "x-forwarded-proto": "https, http" }), "http://x/"), { host: "a.example", proto: "https" });
});
