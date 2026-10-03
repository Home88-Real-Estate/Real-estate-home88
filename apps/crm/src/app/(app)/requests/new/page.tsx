import type { Metadata } from "next";
import Link from "next/link";

import { RequestForm } from "@/components/work/RequestForm";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Νέα ζήτηση" };

export default async function NewRequestPage() {
  await requireRole("AGENT");
  return (
    <>
      <div className="between" style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0 }}>Νέα ζήτηση</h1>
        <Link href="/requests" className="btn btn--outline btn--sm">
          Επιστροφή στη λίστα
        </Link>
      </div>
      <RequestForm submitLabel="Αποθήκευση ζήτησης" />
    </>
  );
}
