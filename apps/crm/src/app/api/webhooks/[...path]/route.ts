/**
 * Provider callbacks (/crm/api/webhooks/*): e-signature and SMS.
 *
 * Vendors sign their callbacks in headers whose names differ per vendor, so
 * unlike the catch-all this forwards the request headers as they are, except
 * cookies and hop-by-hop headers. The body is passed byte-for-byte so the
 * adapter can verify the signature over it. Nothing here is trusted: the
 * adapter verifies, and an unverified call changes nothing.
 */

import { apiUrl, callApi } from "@/lib/api-transport";

const DROP = new Set(["cookie", "host", "connection", "content-length", "transfer-encoding", "keep-alive", "upgrade", "te", "trailer", "proxy-authorization"]);

async function forward(request: Request, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await context.params;
  const headers = new Headers();
  request.headers.forEach((value, name) => {
    if (!DROP.has(name.toLowerCase())) headers.set(name, value);
  });
  return callApi(
    new Request(apiUrl(`/api/webhooks/${path.map(encodeURIComponent).join("/")}${new URL(request.url).search}`), {
      method: "POST",
      headers,
      body: await request.arrayBuffer(),
    }),
  );
}

export const POST = forward;
export const dynamic = "force-dynamic";
