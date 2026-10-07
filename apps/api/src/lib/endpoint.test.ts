import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertSafeEndpointUrl,
  ipv6ToParts,
  isBlockedAddress,
  parseIPv4,
  safeEndpointFetch,
} from "./endpoint";

const unblocked = (host: string, label: string) =>
  assert.equal(isBlockedAddress(host), false, `${label}: ${host} must be allowed`);
const blocked = (host: string, label: string) =>
  assert.equal(isBlockedAddress(host), true, `${label}: ${host} must be blocked`);

/** The HttpError reported for a refused endpoint, matched by its stable code. */
const isBadEndpoint = (error: unknown): boolean =>
  error instanceof Error && "code" in error && (error as { code?: unknown }).code === "bad_endpoint";

test("parseIPv4", () => {
  assert.equal(parseIPv4("8.8.8.8"), (8 << 24) | (8 << 16) | (8 << 8) | 8);
  assert.equal(parseIPv4("255.255.255.255"), 0xffffffff);
  assert.equal(parseIPv4("1.2.3"), null);
  assert.equal(parseIPv4("1.2.3.4.5"), null);
  assert.equal(parseIPv4("1.2.3.256"), null);
  assert.equal(parseIPv4("01.2.3.4"), null); // leading zero: reject, not octal
});

test("ipv6ToParts edge cases", () => {
  assert.deepEqual(ipv6ToParts("::1"), [0, 0, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual(ipv6ToParts("fe80::"), [0xfe80, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(ipv6ToParts("2001:db8::1"), [0x2001, 0xdb8, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual(ipv6ToParts("::ffff:192.168.1.5"), [0, 0, 0, 0, 0, 0xffff, 0xc0a8, 0x0105]);
  assert.deepEqual(ipv6ToParts("::1.2.3.4"), [0, 0, 0, 0, 0, 0, 0x0102, 0x0304]);
  assert.equal(ipv6ToParts("1:2:3:4:5:192.168.1.5"), null); // 5 groups + tail is 7, not 8
  assert.deepEqual(ipv6ToParts("[::1]"), [0, 0, 0, 0, 0, 0, 0, 1], "brackets are optional");
  assert.equal(ipv6ToParts("::1%eth0"), null, "zone indices are rejected");
  assert.equal(ipv6ToParts("junk"), null);
  assert.equal(ipv6ToParts(""), null);
});

test("IPv4 block list", () => {
  blocked("127.0.0.1", "loopback");
  blocked("0.0.0.0", "this network");
  blocked("255.255.255.255", "broadcast");
  blocked("10.1.2.3", "private");
  blocked("172.16.0.1", "private 172.16/12");
  blocked("172.31.255.255", "private 172.16/12 top edge");
  blocked("192.168.1.5", "private");
  blocked("169.254.169.254", "cloud metadata");
  blocked("169.254.0.1", "link-local");
  blocked("100.64.0.1", "CGNAT");
  blocked("100.127.255.255", "CGNAT top edge");
  blocked("192.0.0.1", "192.0.0/24");
  blocked("192.0.2.5", "TEST-NET-1");
  blocked("198.51.100.5", "TEST-NET-2");
  blocked("203.0.113.5", "TEST-NET-3");
  blocked("198.18.0.1", "benchmarking");
  blocked("224.0.0.1", "multicast");
  blocked("240.1.2.3", "reserved");

  unblocked("8.8.8.8", "public DNS resolver");
  unblocked("100.63.255.255", "just below CGNAT");
  unblocked("100.128.0.1", "just above CGNAT");
  unblocked("172.15.0.1", "just below private block");
  unblocked("172.32.0.1", "just above private block");
  unblocked("192.169.0.1", "just above 192.168/16");
});

test("IPv6 block list and IPv4-mapped handling", () => {
  blocked("::1", "IPv6 loopback");
  blocked("::", "unspecified");
  blocked("fe80::1", "link-local");
  blocked("2001:0001::1", "Teredo");
  blocked("2001:db8::1", "documentation");
  blocked("2002::1", "6to4");
  blocked("fc00::1", "ULA");
  blocked("fd12:3456::1", "ULA fd");
  blocked("ff02::1", "multicast");
  blocked("::ffff:192.168.1.5", "IPv4-mapped private");
  blocked("::ffff:169.254.169.254", "IPv4-mapped metadata");
  blocked("[::ffff:10.0.0.1]", "bracketed IPv4-mapped");
  blocked("::192.168.1.5", "IPv4-compatible private");

  unblocked("2001:4860:4860::8888", "public IPv6");
  unblocked("::ffff:8.8.8.8", "IPv4-mapped public follows IPv4 rules");
  unblocked("2606:4700:4700::1111", "public IPv6");
});

test("hostnames are not judged as addresses", () => {
  unblocked("example.com", "hostname");
  unblocked("localhost", "hostname is resolved later");
});

test("assertSafeEndpointUrl rejects unsafe, accepts public", async () => {
  await assert.rejects(assertSafeEndpointUrl("http://example.com/x"), isBadEndpoint, "plain http");
  await assert.rejects(assertSafeEndpointUrl("https://user:pass@example.com/"), isBadEndpoint, "userinfo");
  await assert.rejects(assertSafeEndpointUrl("https://127.0.0.1/x"), isBadEndpoint, "loopback literal");
  await assert.rejects(assertSafeEndpointUrl("https://169.254.169.254/latest/meta-data/"), isBadEndpoint, "metadata");
  await assert.rejects(assertSafeEndpointUrl("https://[::1]/"), isBadEndpoint, "v6 loopback");
  await assert.rejects(assertSafeEndpointUrl("ftp://example.com/"), isBadEndpoint, "non-https protocol");
  await assert.rejects(assertSafeEndpointUrl("not a url"), isBadEndpoint, "unparseable");
  await assert.doesNotReject(assertSafeEndpointUrl("https://8.8.8.8/x"));
  await assert.doesNotReject(assertSafeEndpointUrl("https://[2001:4860:4860::8888]/x"));
});

test("safeEndpointFetch follows redirects but never onto a private network", async () => {
  const originalFetch = globalThis.fetch;
  try {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          status: 302,
          headers: { get: (name: string) => (name === "location" ? "http://10.0.0.1/x" : null) },
        } as unknown as Response;
      }
      throw new Error("should not reach the second hop");
    }) as unknown as typeof fetch;

    await assert.rejects(
      safeEndpointFetch("https://8.8.8.8/start"),
      isBadEndpoint,
      "a redirect to a private address is refused before it is fetched",
    );
    assert.equal(calls, 1, "the private hop is never requested");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("safeEndpointFetch returns the final response when every hop is safe", async () => {
  const originalFetch = globalThis.fetch;
  try {
    const chains: string[] = [];
    globalThis.fetch = (async (input: string) => {
      const url = input;
      chains.push(url);
      if (url === "https://8.8.8.8/root") {
        return {
          ok: true,
          status: 301,
          headers: { get: (name: string) => (name === "location" ? "https://8.8.8.8/final" : null) },
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        url,
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const response = await safeEndpointFetch("https://8.8.8.8/root");
    assert.equal(response.status, 200);
    assert.deepEqual(chains, ["https://8.8.8.8/root", "https://8.8.8.8/final"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("safeEndpointFetch caps redirects", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 308,
      headers: { get: (name: string) => (name === "location" ? "https://8.8.8.8/next" : null) },
    })) as unknown as typeof fetch;

    await assert.rejects(safeEndpointFetch("https://8.8.8.8/loop"), isBadEndpoint, "too many redirects");
  } finally {
    globalThis.fetch = originalFetch;
  }
});