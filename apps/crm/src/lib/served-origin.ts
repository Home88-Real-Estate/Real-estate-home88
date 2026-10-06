/**
 * The host and protocol a request was really addressed to, to hand to the API.
 *
 * The API runs inside this server process and is called with a placeholder
 * address, so it cannot see which address the browser used. Its origin check
 * (CSRF defence) accepts a write whose `Origin` is the origin it was served
 * from; without this the only origins it could ever accept were the ones
 * configured by name, and a deployment opened on any other address (a Vercel
 * alias, a preview) was refused with "Origin not allowed.".
 *
 * Values come from this request's own headers (set by the platform's edge, or
 * the Host header on a plain server), never from a client-chosen field.
 */

type HeaderReader = { get(name: string): string | null };

const first = (value: string | null) => value?.split(",")[0]?.trim() || undefined;

export function servedAddress(headers: HeaderReader, url: string): { host: string; proto: string } {
  const parsed = new URL(url);
  const host = first(headers.get("x-forwarded-host")) ?? first(headers.get("host")) ?? parsed.host;
  const proto = first(headers.get("x-forwarded-proto")) ?? parsed.protocol.replace(/:$/, "");
  return { host, proto };
}
