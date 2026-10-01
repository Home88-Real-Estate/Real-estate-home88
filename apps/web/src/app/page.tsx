import Link from "next/link";
import type { Metadata } from "next";

import { PropertyCardGrid } from "@/components/PropertyCard";
import { listFeaturedProperties, listRecentProperties, countPublicProperties } from "@/lib/property";
import { COMPANY } from "@/lib/config";

export const metadata: Metadata = {
  title: `${COMPANY.legalName} — Ακίνητα προς πώληση και ενοικίαση`,
  description:
    "Αναζητήστε ακίνητα προς πώληση και ενοικίαση. Διαμερίσματα, μεζονέτες, καταστήματα, γραφεία και οικόπεδα.",
  alternates: { canonical: "/" },
};

// Listings change constantly; do not serve a cached shell to search engines
// that would then disagree with the sitemap.
export const revalidate = 300;

export default async function HomePage() {
  const [featured, recent, total] = await Promise.all([
    listFeaturedProperties("el", 3),
    listRecentProperties("el", 6),
    countPublicProperties(),
  ]);

  return (
    <>
      <section className="hero">
        <div className="wrap">
          <h1>Βρείτε το επόμενο ακίνητό σας</h1>
          <p className="lede">
            {total > 0
              ? `${total} ακίνητα διαθέσιμα προς πώληση και ενοικίαση.`
              : "Πωλήσεις, ενοικιάσεις και αναθέσεις ακινήτων."}
          </p>

          {/*
            A plain GET form. It works with JavaScript disabled, it is
            crawlable, and it produces a shareable, server-rendered result URL.
          */}
          <form className="searchpanel" action="/properties" method="get">
            <div className="tabs" role="group" aria-label="Τύπος συναλλαγής">
              <label className="check" style={{ margin: 0, alignItems: "center" }}>
                <input type="radio" name="listingType" value="SALE" defaultChecked />
                <span>Αγορά</span>
              </label>
              <label className="check" style={{ margin: 0, alignItems: "center" }}>
                <input type="radio" name="listingType" value="RENT" />
                <span>Ενοικίαση</span>
              </label>
            </div>

            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
              <div className="field">
                <label htmlFor="q">Περιοχή ή κωδικός</label>
                <input
                  id="q"
                  name="q"
                  className="input"
                  placeholder="π.χ. Γλυφάδα ή H88-000001"
                  autoComplete="off"
                />
              </div>

              <div className="field">
                <label htmlFor="propertyType">Τύπος ακινήτου</label>
                <select id="propertyType" name="propertyType" className="select" defaultValue="">
                  <option value="">Όλοι οι τύποι</option>
                  <option value="APARTMENT">Διαμέρισμα</option>
                  <option value="MAISONETTE">Μεζονέτα</option>
                  <option value="HOUSE">Μονοκατοικία</option>
                  <option value="VILLA">Βίλα</option>
                  <option value="STUDIO">Στούντιο</option>
                  <option value="OFFICE">Γραφείο</option>
                  <option value="SHOP">Κατάστημα</option>
                  <option value="WAREHOUSE">Αποθήκη</option>
                  <option value="BUILDING">Κτίριο</option>
                  <option value="HOTEL">Ξενοδοχείο</option>
                  <option value="LAND">Γη</option>
                  <option value="PLOT">Οικόπεδο</option>
                  <option value="PARKING">Parking</option>
                  <option value="INDUSTRIAL">Βιομηχανικό</option>
                  <option value="OTHER">Άλλο</option>
                </select>
              </div>

              <div className="field">
                <label htmlFor="minPrice">Τιμή από</label>
                <input id="minPrice" name="minPrice" className="input" inputMode="numeric" placeholder="€" />
              </div>

              <div className="field">
                <label htmlFor="maxPrice">Τιμή έως</label>
                <input id="maxPrice" name="maxPrice" className="input" inputMode="numeric" placeholder="€" />
              </div>
            </div>

            <button type="submit" className="btn btn--primary btn--block">
              Αναζήτηση
            </button>
          </form>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="between">
            <h2 style={{ margin: 0 }}>Προτεινόμενα ακίνητα</h2>
            <Link href="/properties" className="btn btn--outline btn--sm">
              Όλα τα ακίνητα
            </Link>
          </div>
          <div style={{ marginTop: 18 }}>
            <PropertyCardGrid
              properties={featured}
              emptyMessage="Δεν έχουν οριστεί προτεινόμενα ακίνητα ακόμη."
            />
          </div>
        </div>
      </section>

      <section className="section section--surface">
        <div className="wrap">
          <h2>Κατηγορίες</h2>
          <div className="grid grid--cards" style={{ marginTop: 18 }}>
            <Link href="/properties?propertyType=APARTMENT" className="card" style={{ padding: 20 }}>
              <h3 style={{ margin: 0 }}>Κατοικίες</h3>
              <p className="muted" style={{ margin: "6px 0 0", fontSize: "0.9rem" }}>
                Διαμερίσματα, μεζονέτες, μονοκατοικίες και βίλες.
              </p>
            </Link>
            <Link href="/properties?propertyType=SHOP" className="card" style={{ padding: 20 }}>
              <h3 style={{ margin: 0 }}>Επαγγελματικά</h3>
              <p className="muted" style={{ margin: "6px 0 0", fontSize: "0.9rem" }}>
                Καταστήματα, γραφεία, αποθήκες και κτίρια.
              </p>
            </Link>
            <Link href="/properties?propertyType=PLOT" className="card" style={{ padding: 20 }}>
              <h3 style={{ margin: 0 }}>Γη &amp; Οικόπεδα</h3>
              <p className="muted" style={{ margin: "6px 0 0", fontSize: "0.9rem" }}>
                Οικόπεδα, αγροτεμάχια και επενδυτικές εκτάσεις.
              </p>
            </Link>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <h2>Πρόσφατα ακίνητα</h2>
          <div style={{ marginTop: 18 }}>
            <PropertyCardGrid
              properties={recent}
              emptyMessage="Δεν υπάρχουν δημοσιευμένα ακίνητα ακόμη."
            />
          </div>
        </div>
      </section>

      <section className="section section--surface">
        <div className="wrap">
          <h2>Γιατί εμάς</h2>
          <div className="grid grid--2" style={{ marginTop: 18 }}>
            <div className="notice">
              <strong>Τοπική γνώση.</strong> Γνωρίζουμε τις τιμές και τις γειτονιές, όχι μόνο τον
              κατάλογο.
            </div>
            <div className="notice">
              <strong>Μία καταχώριση, παντού.</strong> Το ακίνητό σας δημοσιεύεται στην ιστοσελίδα
              μας και στα συνεργαζόμενα δίκτυα από μία εγγραφή.
            </div>
          </div>

          <div className="row" style={{ marginTop: 22 }}>
            <Link href="/submit" className="btn btn--primary">
              Ανάθεση ακινήτου
            </Link>
            <Link href="/request" className="btn btn--outline">
              Ζητώ ακίνητο
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
