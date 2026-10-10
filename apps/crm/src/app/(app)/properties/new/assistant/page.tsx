import Link from "next/link";

import { BackLink } from "@/components/BackLink";
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
      <header className="xpage-head">
        <div>
          <BackLink fallback="/properties" />
          <h1>Νέο ακίνητο · Φωνητική καταχώριση</h1>
          <p>
            Περιγράψτε το ακίνητο με τη φωνή σας ή πληκτρολογήστε τις πληροφορίες. Το HOME88 θα οργανώσει αυτόματα τα στοιχεία για να
            επιταχύνετε την καταχώριση.
          </p>
        </div>
        <Link href="/properties/new" className="btn btn--outline btn--sm">
          Κανονική φόρμα
        </Link>
      </header>
      <IntakeAssistant maxUploadBytes={maxUploadBytes()} resumeId={typeof session === "string" && /^[a-z0-9]{20,40}$/i.test(session) ? session : undefined} />
    </>
  );
}
