/**
 * SSRF defence for portal endpoints.
 *
 * A portal account may store an endpoint URL (an override the adapter will
 * call instead of the portal's well-known public address). That URL must
 * never reach a private or link-local network, a loopback address, or the
 * cloud metadata service — otherwise a box storing such a URL could be used
 * as a proxy into the internal network.
 *
 * The checks are done at the IP layer after normalising the host, because a
 * bare prefix test misses `::ffff:192.168.1.5`, DNS names that resolve to
 * `10.x.x.x`, and redirects to a private host. All resolution failures are
 * treated as blocked (fail closed).
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { HttpError } from "./errors";

const ENDPOINT_NOT_HTTPS = "Το endpoint πρέπει να είναι https.";
const ENDPOINT_WITH_USERINFO = "Το endpoint δεν πρέπει να περιέχει στοιχεία σύνδεσης.";
const ENDPOINT_PRIVATE = "Το endpoint δεν μπορεί να δείχνει σε ιδιωτικό δίκτυο.";
const ENDPOINT_TOO_MANY_REDIRECTS = "Το endpoint κάνει υπερβολικά πολλά redirects.";
const ENDPOINT_BAD_URL = "Το endpoint δεν είναι έγκυρη διεύθυνση.";

function badEndpoint(message: string = ENDPOINT_PRIVATE): HttpError {
  return new HttpError(400, "bad_endpoint", message);
}

/** The host portion, with surrounding brackets from an IPv6 literal removed. */
function bareHost(host: string): string {
  let h = host.trim();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  return h;
}

/** Parses a dotted-quad IPv4 literal to its 32-bit value, or null. */
export function parseIPv4(host: string): number | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    // A leading zero would read as octal in some parsers and let
    // "010.0.0.1" slip past as loopback; reject it outright.
    if (!/^\d{1,3}$/.test(part) || (part.length > 1 && part.startsWith("0"))) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/** A trailing IPv4 literal as two 16-bit groups for embedding in IPv6. */
function parseIPv4Tail(text: string): { hi: number; lo: number } | null {
  const v4 = parseIPv4(text);
  if (v4 === null) return null;
  return { hi: Math.floor(v4 / 65536), lo: v4 % 65536 };
}

function group16(group: string): number | null {
  if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
  return parseInt(group, 16);
}

/**
 * Parses an IPv6 literal (brackets optional) into eight 16-bit groups, or
 * null when it is not a valid address. Handles `::` compression and a
 * trailing embedded IPv4 (`::ffff:192.168.1.5`, `::1.2.3.4`).
 */
export function ipv6ToParts(host: string): number[] | null {
  let h = bareHost(host);
  if (!h || h.includes("%")) return null; // zone indices only appear on link-local

  // A trailing dotted quad counts as the last 32 bits; peel it off first so
  // the remainder is a plain hex address.
  const segments = h.split(":");
  const last = segments[segments.length - 1] ?? "";
  let v4: { hi: number; lo: number } | null = null;
  if (last.includes(".")) {
    v4 = parseIPv4Tail(last);
    if (!v4) return null;
    h = segments.slice(0, -1).join(":");
  }
  if (h.includes(".")) return null;
  if (h === "") return null;
  if (v4 && h === ":") h = "::";

  const shim = h.split("::");
  if (shim.length > 2) return null;
  const hasShim = shim.length === 2;
  const head = hasShim ? (shim[0] ? shim[0]!.split(":") : []) : h.split(":");
  const tail = hasShim ? (shim[1] ? shim[1]!.split(":") : []) : [];

  if (!hasShim && head.length + (v4 ? 2 : 0) !== 8) return null;
  if (hasShim && head.length + tail.length + (v4 ? 2 : 0) > 7) return null;

  const missing = Math.max(0, 8 - head.length - tail.length - (v4 ? 2 : 0));
  const groups: number[] = [];
  for (const g of [...head, ...Array<string>(missing).fill("0"), ...tail]) {
    const value = group16(g);
    if (value === null) return null;
    groups.push(value);
  }
  if (v4) groups.push(v4.hi, v4.lo);
  return groups.length === 8 ? groups : null;
}

function groupsToBigInt(groups: number[]): bigint {
  let value = 0n;
  for (const group of groups) value = (value << 16n) | BigInt(group);
  return value;
}

/** The inclusive value range an IPv6 CIDR covers. */
function v6Range(network: string, prefix: number): readonly [bigint, bigint] {
  const groups = ipv6ToParts(network);
  if (!groups) throw new Error(`bad IPv6 network ${network}`);
  const base = groupsToBigInt(groups);
  const hostBits = 128 - prefix;
  const mask = hostBits === 0 ? 0n : (1n << BigInt(hostBits)) - 1n;
  return [base & ~mask, base | mask];
}

// -- IPv4 ---------------------------------------------------------------

const BLOCKED_IPV4: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 0x00ffffff], // 0/8 "this network"
  [0x0a000000, 0x0affffff], // 10/8 private
  [0x64400000, 0x647fffff], // 100.64/10 CGNAT
  [0x7f000000, 0x7fffffff], // 127/8 loopback
  [0xa9fe0000, 0xa9feffff], // 169.254/16 link-local
  [0xac100000, 0xac1fffff], // 172.16/12 private
  [0xc0000000, 0xc00000ff], // 192.0.0/24 "this network"/misconfiguration
  [0xc0000200, 0xc00002ff], // 192.0.2/24 TEST-NET-1
  [0xc0a80000, 0xc0a8ffff], // 192.168/16 private
  [0xc6120000, 0xc613ffff], // 198.18/15 benchmarking
  [0xc6336400, 0xc63364ff], // 198.51.100/24 TEST-NET-2
  [0xcb007100, 0xcb0071ff], // 203.0.113/24 TEST-NET-3
  [0xe0000000, 0xefffffff], // 224/4 multicast
  [0xf0000000, 0xffffffff], // 240/4 reserved (incl. broadcast)
];

function isBlockedIPv4(value: number): boolean {
  return BLOCKED_IPV4.some(([start, end]) => value >= start && value <= end);
}

/** Whether the literal is a blocked IPv4 address (dotted quad only). */
function isBlockedIPv4Literal(host: string): boolean {
  const value = parseIPv4(bareHost(host));
  return value !== null && isBlockedIPv4(value);
}

// -- IPv6 ---------------------------------------------------------------

// `::/96` (IPv4-compatible) and `::ffff:0:0/96` (IPv4-mapped) are handled
// separately because the embedded 32 bits are reused as an IPv4 address and
// must follow the IPv4 rules (so `::ffff:8.8.8.8` stays allowed while
// `::ffff:192.168.1.5` is blocked).
const BLOCKED_IPV6: ReadonlyArray<readonly [bigint, bigint]> = [
  v6Range("::", 128), // unspecified address
  v6Range("::1", 128), // loopback
  v6Range("100::", 64), // discard-only
  v6Range("2001::", 23), // Teredo tunneling
  v6Range("2001:db8::", 32), // documentation (inside /23, kept explicit)
  v6Range("2002::", 16), // 6to4 tunneling
  v6Range("fc00::", 7), // unique local addresses
  v6Range("fe80::", 10), // link-local
  v6Range("ff00::", 8), // multicast
];

function isBlockedIPv6Literal(host: string): boolean {
  const groups = ipv6ToParts(host);
  if (!groups) return false; // not an IPv6 literal; caller resolves DNS
  // IPv4-compatible/compatible-mapped: the low 32 bits are an IPv4 address.
  const embeddedIPv4 =
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    (groups[5] === 0 || groups[5] === 0xffff);
  if (embeddedIPv4) {
    const value = groups[6]! * 65536 + groups[7]!;
    return isBlockedIPv4(value);
  }
  const value = groupsToBigInt(groups);
  return BLOCKED_IPV6.some(([start, end]) => value >= start && value <= end);
}

/**
 * True when the host is a literal that points at a private, link-local,
 * loopback, multicast, reserved or otherwise-internal address. Hostnames are
 * not judged here (they need DNS resolution); this returns false for them.
 */
export function isBlockedAddress(host: string): boolean {
  if (!bareHost(host)) return true;
  if (isIP(host) === 4 || /^\d+\.\d+\.\d+\.\d+$/.test(bareHost(host))) {
    return isBlockedIPv4Literal(host);
  }
  if (isIP(host) === 6 || bareHost(host).includes(":")) {
    return isBlockedIPv6Literal(host);
  }
  return isBlockedIPv4Literal(host) || isBlockedIPv6Literal(host);
}

const LOOKUP_FAILURES = new Set(["ENOTFOUND", "EAI_AGAIN", "ENODATA", "ESERVFAIL", "ETIMEOUT"]);

/**
 * Rejects a URL an adapters would have to fetch: not https, carrying
 * credentials, unreachable in DNS, or resolving to any blocked address. This
 * is the single entry point for "is this endpoint safe to call?", used by the
 * portal-accounts routes and (through `safeEndpointFetch`) by any fetch.
 */
export async function assertSafeEndpointUrl(raw: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw badEndpoint(ENDPOINT_BAD_URL);
  }
  if (url.protocol !== "https:") throw badEndpoint(ENDPOINT_NOT_HTTPS);
  if (url.username || url.password) throw badEndpoint(ENDPOINT_WITH_USERINFO);
  const host = bareHost(url.hostname);
  if (isBlockedAddress(host)) throw badEndpoint();

  // A hostname is only safe once every address it can resolve to is safe:
  // "localhost" usually means 127.0.0.1/::1, and a name could resolve to a
  // private address on a split-brain resolver.
  if (isIP(host) === 0) {
    let addresses: readonly string[];
    try {
      addresses = (await lookup(host, { all: true, verbatim: true })).map((r) => r.address);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code && LOOKUP_FAILURES.has(code)) throw badEndpoint();
      throw badEndpoint(ENDPOINT_BAD_URL);
    }
    if (addresses.length === 0) throw badEndpoint();
    for (const address of addresses) {
      if (isBlockedAddress(address)) throw badEndpoint();
    }
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

/**
 * `fetch` for portal adapters: follows manual redirects, but re-checks every
 * hop against `assertSafeEndpointUrl` so a redirect cannot smuggle the request
 * onto a private network. Non-https or blocked destinations throw
 * `HttpError("bad_endpoint")`; the caller decides how to surface that.
 */
export async function safeEndpointFetch(input: string | Request, init?: RequestInit): Promise<Response> {
  const startUrl = typeof input === "string" ? input : input.url;
  await assertSafeEndpointUrl(startUrl);

  let current: string | Request = input;
  let redirects = 0;
  for (;;) {
    const response = await fetch(current, { ...init, redirect: "manual" });
    const status = response.status;
    if (!REDIRECT_STATUSES.has(status)) return response;

    const location = response.headers.get("location");
    if (!location) return response;
    redirects += 1;
    if (redirects > MAX_REDIRECTS) throw badEndpoint(ENDPOINT_TOO_MANY_REDIRECTS);

    const base = typeof current === "string" ? current : current instanceof URL ? current.href : current.url;
    let next: string;
    try {
      next = new URL(location, base).toString();
    } catch {
      throw badEndpoint(ENDPOINT_BAD_URL);
    }
    await assertSafeEndpointUrl(next);
    current = next;
  }
}