import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { handleRevalidate } from "@/lib/revalidate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Refreshes cached public pages after a publication change. See lib/revalidate. */
export async function POST(request: Request) {
  const { status, body } = await handleRevalidate(request, (path) => revalidatePath(path));
  return NextResponse.json(body, { status });
}
