import { defaultDeps, handleChat } from "@/lib/ai/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The public assistant. All Gemini and CRM access happens behind this route. */
export async function POST(request: Request) {
  return handleChat(request, defaultDeps());
}
