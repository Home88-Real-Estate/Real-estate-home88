import Link from "next/link";
import type { Metadata } from "next";

import { PropertyCardGrid } from "@/components/PropertyCard";
import { CategoryNav } from "@/components/CategoryNav";
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

const TYPE_OPTIONS: Array<[string, string]> = [
  ["", "Όλοι οι τύποι"],
  ["APARTMENT", "Διαμέρισμα"],
  ["MAISONETTE", "Μεζονέτα"],
  ["HOUSE", "Μονοκατοικία"],
  ["VILLA", "Βίλα"],
  ["STUDIO", "Στούντιο"],
  ["OFFICE", "Γραφείο"],
  ["SHOP", "Κατάστημα"],
  ["WAREHOUSE", "Αποθήκη"],
  ["BUILDING", "Κτίριο"],
  ["HOTEL", "Ξενοδοχείο"],
  ["LAND", "Γη"],
  ["PLOT", "Οικόπεδο"],
  ["PARKING", "Parking"],
  ["INDUSTRIAL", "Βιομηχανικό"],
  ["OTHER", "Άλλο"],
];

const VALUES: Array<{ title: string; text: string; icon: string }> = [
  { title: "Τοπική γνώση", text: "Εξειδίκευση στις περιοχές και τις τιμές της αγοράς.", icon: "◎" },
  { title: "Επαγγελματική παρουσίαση", text: "Σύγχρονη προβολή και marketing κάθε ακινήτου.", icon: "▣" },
  { title: "Προσωπική εξυπηρέτηση", text: "Υποστήριξη από την πρώτη επικοινωνία έως την ολοκλήρωση.", icon: "☏" },
  { title: "Δίκτυο & συνεργασίες", text: "Πρόσβαση σε αγοραστές, ιδιοκτήτες και επενδυτές.", icon: "⇄" },
];

export default async function HomePage() {
  const [featured, recent, total] = await Promise.all([
    listFeaturedProperties("el", 3),
    listRecentProperties("el", 6),
    countPublicProperties(),
  ]);

  const heroImage = featured[0]?.primaryImage ?? recent[0]?.primaryImage ?? null;

  return (
    <>
      <section
        className="hero"
        style={heroImage ? { backgroundImage: `url(${heroImage})` } : undefined}
      >
        <div className="wrap hero__inner">
          <span className="hero__eyebrow">HOME88 Real Estate</span>
          <h1>Βρείτε το επόμενο ακίνητό σας</h1>
          <p className="lede">
            Κατοικίες, επαγγελματικοί χώροι, γη και επενδυτικές ευκαιρίες με
            επαγγελματική υποστήριξη σε κάθε βήμα.
          </p>

          {/*
            A plain GET form. It works with JavaScript disabled, it is
            crawlable, and it produces a shareable, server-rendered result URL.
          */}
          <form className="search-overlay" action="/properties" method="get">
            <div className="tabs" role="group" aria-label="Τύπος συναλλαγής">
              <label>
                <input type="radio" name="listingType" value="SALE" defaultChecked />
                <span>Αγορά</span>
              </label>
              <label>
                <input type="radio" name="listingType" value="RENT" />
                <span>Ενοικίαση</span>
              </label>
            </div>

            <div className="search-grid">
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
                  {TYPE_OPTIONS.map(([value, text]) => (
                    <option key={value} value={value}>
                      {text}
                    </option>
                  ))}
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

            <div className="row" style={{ marginTop: 16 }}>
              <button type="submit" className="btn btn--primary btn--lg">
                Αναζήτηση
              </button>
              <Link href="/properties" className="btn btn--onhero">
                Προηγμένη αναζήτηση
              </Link>
            </div>
          </form>

          {total > 0 && (
            <p className="muted" style={{ color: "#bcd2e6", marginTop: 18, fontSize: "0.88rem" }}>
              {total} ακίνητα διαθέσιμα αυτή τη στιγμή.
            </p>
          )}
        </div>
      </section>

      <CategoryNav />

      <section className="section">
        <div className="wrap">
          <div className="between section-head">
            <div>
              <h2 style={{ margin: 0 }}>Επιλεγμένα ακίνητα</h2>
              <p className="muted" style={{ margin: "6px 0 0" }}>
                Ξεχωριστές επιλογές από το χαρτοφυλάκιό μας.
              </p>
            </div>
            <Link href="/properties" className="btn btn--outline btn--sm">
              Όλα τα ακίνητα
            </Link>
          </div>
          <PropertyCardGrid
            properties={featured}
            emptyMessage="Δεν έχουν οριστεί προτεινόμενα ακίνητα ακόμη."
          />
        </div>
      </section>

      <section className="section section--surface">
        <div className="wrap">
          <div className="section-head">
            <h2 style={{ margin: 0 }}>Γιατί HOME88</h2>
            <p className="muted" style={{ margin: "6px 0 0" }}>
              Μια εταιρεία που γνωρίζει την αγορά και στηρίζει κάθε συναλλαγή.
            </p>
          </div>
          <div className="value-grid">
            {VALUES.map((v) => (
              <div className="value" key={v.title}>
                <div className="value__icon" aria-hidden="true">
                  {v.icon}
                </div>
                <h3>{v.title}</h3>
                <p>{v.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="cta-band">
            <h2>Θέλετε να πουλήσετε ή να ενοικιάσετε το ακίνητό σας;</h2>
            <p>
              Αφήστε τα στοιχεία του ακινήτου σας και ένας σύμβουλος της HOME88
              θα επικοινωνήσει μαζί σας για εκτίμηση και στρατηγική προβολής.
            </p>
            <div className="row" style={{ marginTop: 18 }}>
              <Link href="/submit" className="btn btn--onhero btn--lg">
                Ζητήστε εκτίμηση
              </Link>
              <Link href="/request" className="btn btn--onhero">
                Ζητώ ακίνητο
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="section section--surface">
        <div className="wrap">
          <div className="between section-head">
            <div>
              <h2 style={{ margin: 0 }}>Πρόσφατα ακίνητα</h2>
              <p className="muted" style={{ margin: "6px 0 0" }}>
                Οι τελευταίες καταχωρίσεις που δημοσιεύτηκαν.
              </p>
            </div>
            <Link href="/properties" className="btn btn--outline btn--sm">
              Προβολή όλων
            </Link>
          </div>
          <PropertyCardGrid
            properties={recent}
            emptyMessage="Δεν υπάρχουν δημοσιευμένα ακίνητα ακόμη."
          />
        </div>
      </section>
    </>
  );
}
