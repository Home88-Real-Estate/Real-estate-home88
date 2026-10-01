import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PropertyCardGrid } from "@/components/PropertyCard";
import { getAreaBySlug } from "@/lib/areas";
import { searchProperties } from "@/lib/property";
import { SITE_URL } from "@/lib/config";

export const revalidate = 300;

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const area = await getAreaBySlug(slug);
  if (!area) return { title: "Η περιοχή δεν βρέθηκε", robots: { index: false } };

  const place = area.city ? `${area.name}, ${area.city}` : area.name;
  return {
    title: `Ακίνητα στη ${place}`,
    description: `Ακίνητα προς πώληση και ενοικίαση στη ${place}. Δείτε διαθέσιμα διαμερίσματα, καταστήματα και οικόπεδα.`,
    alternates: { canonical: `/areas/${area.slug}` },
  };
}

export default async function AreaPage({ params }: Props) {
  const { slug } = await params;
  const area = await getAreaBySlug(slug);
  if (!area) notFound();

  const result = await searchProperties("el", {
    city: area.city ?? undefined,
    areaName: area.name,
    sort: "newest",
    limit: 24,
  });

  const place = area.city ? `${area.name}, ${area.city}` : area.name;

  // Data-driven structured data: only claims the count we actually have.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `Ακίνητα στη ${place}`,
    url: `${SITE_URL}/areas/${area.slug}`,
    numberOfItems: result.total,
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="wrap section">
        <nav aria-label="Διαδρομή" style={{ fontSize: "0.85rem", marginBottom: 14 }}>
          <Link href="/">Αρχική</Link> <span className="muted">/</span>{" "}
          <Link href="/areas">Περιοχές</Link> <span className="muted">/</span>{" "}
          <span className="muted">{area.name}</span>
        </nav>

        <h1>Ακίνητα στη {place}</h1>
        <p className="lede" style={{ maxWidth: 760 }}>
          {result.total > 0
            ? `${result.total} ${result.total === 1 ? "ακίνητο" : "ακίνητα"} διαθέσιμα αυτή τη στιγμή στη ${place}.`
            : `Δεν υπάρχουν διαθέσιμα ακίνητα στη ${place} αυτή τη στιγμή.`}
        </p>

        <div className="row" style={{ marginBottom: 24 }}>
          <Link href="/request" className="btn btn--outline btn--sm">
            Ζητώ ακίνητο εδώ
          </Link>
          <Link href="/valuation" className="btn btn--ghost btn--sm">
            Εκτίμηση ακινήτου
          </Link>
          <Link href={`/properties?city=${encodeURIComponent(area.city ?? "")}`} className="btn btn--ghost btn--sm">
            Προηγμένη αναζήτηση
          </Link>
        </div>

        <PropertyCardGrid
          properties={result.data}
          emptyMessage="Δεν βρέθηκαν ακίνητα σε αυτή την περιοχή."
        />
      </div>
    </>
  );
}
