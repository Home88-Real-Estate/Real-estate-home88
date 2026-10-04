import type { Metadata } from "next";
import Link from "next/link";

import { NewValuationForm } from "@/components/sellers/Forms";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Νέα εκτίμηση" };

export default async function NewValuationPage({ searchParams }: { searchParams: Promise<{ seller?: string; property?: string }> }) {
  await requireRole("AGENT");
  const { seller, property } = await searchParams;
  return (
    <>
      <div className="between" style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0 }}>Νέα εκτίμηση</h1>
        <Link href={seller ? `/sellers/${seller}` : "/valuations"} className="btn btn--outline btn--sm">Επιστροφή</Link>
      </div>
      <div className="panel">
        <p className="muted" style={{ marginTop: 0 }}>
          Συγκριτική εκτίμηση: επιλέγετε συγκριτικά από τα δεδομένα του γραφείου ή από εξωτερικές πηγές και η εκτίμηση προκύπτει από τη διάμεση τιμή ανά m².
        </p>
        <NewValuationForm sellerLeadId={seller} propertyReference={property} />
      </div>
    </>
  );
}
