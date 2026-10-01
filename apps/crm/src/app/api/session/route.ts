/**
 * Same-origin session endpoint.
 *
 * The login form posts here, not to the API, so the browser stores a cookie on
 * this origin. The API's Set-Cookie (which carries the real session token) is
 * copied through verbatim; the token is never part of a response body.
 */

import { NextResponse } from "next/server";

import { API_URL } from "@/lib/config";

export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.text();

  let upstream: Response;
  try {
    upstream = await fetch(`${API_URL}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body,
    });
  } catch {
    return NextResponse.json(
      { error: { code: "network_error", message: "Cannot reach the API. Is it running?" } },
      { status: 502 },
    );
  }

  const text = await upstream.text();
  const response = new NextResponse(text, {
    status: upstream.status,
    headers: { "content-type": "application/json" },
  });

  for (const cookie of upstream.headers.getSetCookie()) {
    response.headers.append("set-cookie", cookie);
  }

  return response;
}
