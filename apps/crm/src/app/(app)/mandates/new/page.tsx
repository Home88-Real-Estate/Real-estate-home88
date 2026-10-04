import type { Metadata } from "next";
import Link from "next/link";

import { NewMandateForm } from "@/components/mandates/Forms";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Νέα εντολή" };

export default async function NewMandatePage({ searchParams }: { searchParams: Promise<{ seller?: string; property?: string; type?: string }> }) {
  await requireRole("AGENT");
  const { seller, property, type } = await searchParams;
  return (
    <>
      <div className="between" style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0 }}>Νέα εντολή</h1>
        <Link href={seller ? `/sellers/${seller}` : "/mandates"} className="btn btn--outline btn--sm">Επιστροφή</Link>
      </div>
      <div className="panel">
        <p className="muted" style={{ marginTop: 0 }}>
          Η εντολή δημιουργείται πρόχειρη. Το κείμενο είναι το εγκεκριμένο κείμενο του τύπου της από τις Ρυθμίσεις → Ψηφιακές Εντολές, συμπληρωμένο με τα παρακάτω στοιχεία.
        </p>
        <NewMandateForm sellerLeadId={seller} propertyReference={property} type={type} />
      </div>
    </>
  );
}
