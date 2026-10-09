import Link from "next/link";

import { saveProperty } from "@/actions/properties";
import { PropertyForm } from "@/components/PropertyForm";
import { requireRole } from "@/lib/session";

/** Same variable and default as the API's MAX_UPLOAD_BYTES, which enforces it. */
function maxUploadBytes(): number {
  const value = Number(process.env.MAX_UPLOAD_BYTES);
  return Number.isInteger(value) && value >= 1024 ? value : 26214400;
}

export default async function NewPropertyPage() {
  await requireRole("AGENT");

  return (
    <>
      <div className="between" style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0 }}>Νέο ακίνητο</h1>
        <Link href="/properties" className="btn btn--outline btn--sm">
          Επιστροφή στη λίστα
        </Link>
      </div>

      <div className="notice" style={{ marginBottom: 18 }}>
        <div className="between">
          <span>
            <strong>AI Voice Assistant</strong> — περιγράψτε το ακίνητο με φωνή ή κείμενο (ελληνικά ή αγγλικά), τραβήξτε φωτογραφίες και ο βοηθός συμπληρώνει το πρόχειρο.
          </span>
          <Link href="/properties/new/assistant" className="btn btn--primary btn--sm">
            🎤 Φωνητική καταχώριση
          </Link>
        </div>
      </div>

      <PropertyForm action={saveProperty} submitLabel="Αποθήκευση ακινήτου" withPhotos maxUploadBytes={maxUploadBytes()} />
    </>
  );
}
