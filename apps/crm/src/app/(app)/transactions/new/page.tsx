import type { Metadata } from "next";
import Link from "next/link";

import { NewTransactionForm } from "@/components/transactions/Forms";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Νέα συναλλαγή" };

export default async function NewTransactionPage({ searchParams }: { searchParams: Promise<{ property?: string }> }) {
  await requireRole("AGENT");
  const { property } = await searchParams;
  return (
    <>
      <div className="between" style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0 }}>Νέα συναλλαγή</h1>
        <Link href="/transactions" className="btn btn--outline btn--sm">Επιστροφή</Link>
      </div>
      <div className="panel">
        <NewTransactionForm defaultReference={property} />
      </div>
    </>
  );
}
