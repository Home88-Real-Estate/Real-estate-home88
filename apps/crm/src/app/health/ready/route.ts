/**
 * Readiness check for the CRM and its in-process API: /crm/health/ready.
 *
 * Answers whether the API starts, whether the database answers and, when
 * something is wrong, the NAMES of the environment variables to fix on this
 * deployment. It never returns a value, connection string or secret.
 */

import { NextResponse } from "next/server";

import { API_URL } from "@/lib/config";
import { safeDetail } from "@/lib/api-transport";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  if (API_URL) {
    // A separately running API (local development).
    try {
      const response = await fetch(`${API_URL}/health/ready`, { cache: "no-store" });
      const body = (await response.json()) as Record<string, unknown>;
      return NextResponse.json({ ...body, api: "up", mode: "external" }, { status: response.status });
    } catch (error) {
      console.error("[crm] readiness: API_URL is set but unreachable:", safeDetail(error));
      return NextResponse.json(
        {
          status: "unavailable",
          api: "down",
          mode: "external",
          configuration: [{ variable: "API_URL", problem: "unreachable" }],
        },
        { status: 503 },
      );
    }
  }

  const { apiReadiness } = await import("@home88/api/handler");
  const readiness = await apiReadiness();
  return NextResponse.json(
    { ...readiness, mode: "in-process" },
    { status: readiness.status === "ready" ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
