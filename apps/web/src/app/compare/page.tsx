import type { Metadata } from "next";
import Link from "next/link";

import { getPropertyByReference } from "@/lib/property";
import { parseRefsParam } from "@/lib/compare";
import type { PublicPropertyDetail } from "@home88/types";
import {
  formatArea,
  formatPrice,
  label,
  LISTING_TYPE_LABELS,
  PROPERTY_TYPE_LABELS,
} from "@home88/types";

// Comparison is user-generated from query params; it should be usable but not
// indexed as a distinct page.
export const metadata: Metadata = {
  title: "Σύγκριση ακινήτων",
  robots: { index: false, follow: true },
  alternates: { canonical: "/compare" },
};

export const dynamic = "force-dynamic";

type RawParams = Record<string, string | string[] | undefined>;

function pricePerSqm(p: PublicPropertyDetail): string {
  if (p.price == null || p.area == null || p.area <= 0 || p.priceOnRequest) return "—";
  return `${new Intl.NumberFormat("el-GR", { maximumFractionDigits: 0 }).format(p.price / p.area)} €`;
}

const yesNo = (v: boolean): string => (v ? "✓" : "—");

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const refs = parseRefsParam((await searchParams).refs);
  const found = await Promise.all(refs.map((r) => getPropertyByReference(r, "el")));
  const properties = found.filter((p): p is PublicPropertyDetail => p !== null);

  const rows: Array<[string, (p: PublicPropertyDetail) => string]> = [
    ["Τιμή", (p) => formatPrice(p.price, p.priceOnRequest, p.listingType, "el")],
    ["Τιμή / τ.μ.", pricePerSqm],
    ["Συναλλαγή", (p) => label(LISTING_TYPE_LABELS, p.listingType, "el")],
    ["Τύπος", (p) => label(PROPERTY_TYPE_LABELS, p.propertyType, "el")],
    ["Εμβαδόν", (p) => formatArea(p.area, "el") ?? "—"],
    ["Υπνοδωμάτια", (p) => (p.bedrooms != null ? String(p.bedrooms) : "—")],
    ["Μπάνια", (p) => (p.bathrooms != null ? String(p.bathrooms) : "—")],
    ["Όροφος", (p) => (p.floor != null ? String(p.floor) : "—")],
    ["Έτος κατασκευής", (p) => (p.yearBuilt != null ? String(p.yearBuilt) : "—")],
    ["Ενεργειακή κλάση", (p) => (p.energyClass !== "NOT_AVAILABLE" ? p.energyClass : "—")],
    ["Parking", (p) => yesNo(p.parking)],
    ["Αποθήκη", (p) => yesNo(p.storage)],
    ["Μπαλκόνι", (p) => yesNo(p.balcony)],
    ["Κήπος", (p) => yesNo(p.garden)],
    ["Πισίνα", (p) => yesNo(p.pool)],
    ["Θέα θάλασσα", (p) => yesNo(p.seaView)],
  ];

  return (
    <div className="wrap section">
      <h1>Σύγκριση ακινήτων</h1>

      {properties.length === 0 ? (
        <div className="empty">
          Δεν έχετε επιλέξει ακίνητα για σύγκριση. Προσθέστε ακίνητα από τη λίστα
          ή πατήστε «Σύγκριση» σε μια αγγελία. <Link href="/properties">Δείτε τα ακίνητα</Link>.
        </div>
      ) : (
        <>
          <p className="muted">
            Συγκρίνετε έως 4 ακίνητα. Η επιλογή αποθηκεύεται μόνο στη συσκευή σας.
          </p>

          <div style={{ overflowX: "auto", marginTop: 20 }}>
            <table className="compare-table">
              <thead>
                <tr>
                  <th scope="col">Χαρακτηριστικό</th>
                  {properties.map((p) => (
                    <th scope="col" key={p.reference}>
                      <Link href={`/property/${p.reference}`}>{p.title}</Link>
                      <div className="muted" style={{ fontWeight: 400, fontSize: "0.8rem" }}>
                        {p.reference}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(([name, get]) => (
                  <tr key={name}>
                    <th scope="row">{name}</th>
                    {properties.map((p) => (
                      <td key={p.reference}>{get(p)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="row" style={{ marginTop: 20 }}>
            <Link href="/properties" className="btn btn--outline btn--sm">
              Προσθήκη άλλου ακινήτου
            </Link>
            <Link href="/valuation" className="btn btn--ghost btn--sm">
              Εκτίμηση ακινήτου
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
