/**
 * Same-origin session endpoint.
 *
 * The login form posts here, not to the API, so the browser stores a cookie on
 * this origin. The API's Set-Cookie (which carries the real session token) is
 * copied through verbatim; the token is never part of a response body.
 */

import { NextResponse } from "next/server";

import { apiUrl, callApi } from "@/lib/api-transport";

export async function POST(request: Request): Promise<NextResponse> {
  const body = await request.text();

  let upstream: Response;
  try {
    const headers = new Headers({ "content-type": "application/json", accept: "application/json" });
    // Login is rate-limited per client IP and audited with it.
    for (const name of ["x-forwarded-for", "user-agent"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    upstream = await callApi(new Request(apiUrl("/api/auth/login"), { method: "POST", headers, body }));
  } catch {
    return NextResponse.json(
      { error: { code: "network_error", message: "Η υπηρεσία δεν είναι διαθέσιμη. Δοκιμάστε ξανά." } },
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
