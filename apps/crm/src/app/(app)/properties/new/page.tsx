import Link from "next/link";

import { saveProperty } from "@/actions/properties";
import { PropertyForm } from "@/components/PropertyForm";
import { requireRole } from "@/lib/session";

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

      <PropertyForm action={saveProperty} submitLabel="Αποθήκευση ακινήτου" withPhotos />
    </>
  );
}
