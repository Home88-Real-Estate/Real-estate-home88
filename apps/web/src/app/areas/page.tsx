import type { Metadata } from "next";
import Link from "next/link";

import { listAreas } from "@/lib/areas";

export const metadata: Metadata = {
  title: "Περιοχές",
  description: "Ακίνητα ανά περιοχή. Δείτε πού υπάρχουν διαθέσιμα ακίνητα προς πώληση και ενοικίαση.",
  alternates: { canonical: "/areas" },
};

export const revalidate = 3600;

export default async function AreasPage() {
  const areas = await listAreas();

  return (
    <div className="wrap section">
      <h1>Περιοχές</h1>
      <p className="lede" style={{ maxWidth: 720 }}>
        Επιλέξτε περιοχή για να δείτε τα διαθέσιμα ακίνητα. Εμφανίζονται μόνο
        περιοχές με ενεργές αγγελίες.
      </p>

      {areas.length === 0 ? (
        <div className="empty">
          Δεν υπάρχουν ακόμη καταχωρίσεις ανά περιοχή. Δείτε όλα τα{" "}
          <Link href="/properties">ακίνητα</Link>.
        </div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", marginTop: 20 }}>
          {areas.map((a) => (
            <Link key={a.slug} href={`/areas/${a.slug}`} className="value" style={{ textDecoration: "none" }}>
              <h3 style={{ margin: "0 0 4px" }}>{a.name}</h3>
              <p style={{ margin: 0 }}>
                {a.city ? `${a.city} · ` : ""}
                {a.count} {a.count === 1 ? "ακίνητο" : "ακίνητα"}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
