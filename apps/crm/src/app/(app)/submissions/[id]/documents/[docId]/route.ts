import { NextResponse } from "next/server";

import { apiFetch } from "@/lib/api";
import { CRM_BASE_PATH } from "@/lib/paths";

/**
 * Opens a private submission document. The API authorises (assigned agent or a
 * manager), audits the access and returns a two-minute signed URL; the browser
 * is redirected there, so the link never sits in a page and never outlives its
 * expiry.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await params;
  const result = await apiFetch<{ url: string }>(`/api/submissions/${encodeURIComponent(id)}/documents/${encodeURIComponent(docId)}/url`);
  if (!result.ok) {
    const back = new URL(`${CRM_BASE_PATH}/submissions/${id}`, request.url);
    return NextResponse.redirect(back, { status: 303 });
  }
  return NextResponse.redirect(result.data.url, { status: 302, headers: { "Cache-Control": "no-store" } });
}
