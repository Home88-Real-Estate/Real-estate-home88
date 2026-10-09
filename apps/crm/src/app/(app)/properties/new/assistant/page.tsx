import Link from "next/link";

import { IntakeAssistant } from "@/components/IntakeAssistant";
import { requireRole } from "@/lib/session";

/** Same variable and default as the API's MAX_UPLOAD_BYTES, which enforces it. */
function maxUploadBytes(): number {
  const value = Number(process.env.MAX_UPLOAD_BYTES);
  return Number.isInteger(value) && value >= 1024 ? value : 26214400;
}

export default async function IntakeAssistantPage({ searchParams }: { searchParams: Promise<{ session?: string }> }) {
  await requireRole("AGENT");
  const { session } = await searchParams;

  return (
    <>
      <div className="between" style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0 }}>Νέο ακίνητο · Φωνητική καταχώριση</h1>
        <Link href="/properties/new" className="btn btn--outline btn--sm">
          Κανονική φόρμα
        </Link>
      </div>
      <IntakeAssistant maxUploadBytes={maxUploadBytes()} resumeId={typeof session === "string" && /^[a-z0-9]{20,40}$/i.test(session) ? session : undefined} />
    </>
  );
}
