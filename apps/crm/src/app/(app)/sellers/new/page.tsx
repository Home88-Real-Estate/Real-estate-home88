import type { Metadata } from "next";
import Link from "next/link";

import { NewSellerForm } from "@/components/sellers/Forms";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Νέος ιδιοκτήτης" };

export default async function NewSellerPage() {
  await requireRole("AGENT");
  return (
    <>
      <div className="between" style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0 }}>Νέος ιδιοκτήτης</h1>
        <Link href="/sellers" className="btn btn--outline btn--sm">Επιστροφή</Link>
      </div>
      <div className="panel">
        <NewSellerForm />
      </div>
    </>
  );
}
