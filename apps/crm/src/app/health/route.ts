/**
 * Liveness endpoint for the CRM.
 *
 * Served under the basePath, so the public URL is /crm/health. It deliberately
 * reports nothing about configuration: no environment names, no database
 * connection strings, no secrets. A 200 here only means the Next server is up
 * and rendering; use it as a deployment/uptime probe, not a readiness check.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  return NextResponse.json({ application: "healthy" });
}
