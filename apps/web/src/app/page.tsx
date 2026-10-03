import Link from "next/link";
import type { Metadata } from "next";

import { PropertyCardGrid } from "@/components/PropertyCard";
import { CategoryNav } from "@/components/CategoryNav";
import { listFeaturedProperties, listRecentProperties, countPublicProperties } from "@/lib/property";
import { listAreas } from "@/lib/areas";
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

const VALUES: Array<{ title: string; text: string; image: string; alt: string }> = [
  {
    title: "Τοπική γνώση",
    text: "Εξειδίκευση στις περιοχές και τις τιμές της αγοράς.",
    image: "/images/why-icons/01_topiki_lysi.png",
    alt: "Τοπική γνώση HOME88",
  },
  {
    title: "Επαγγελματική παρουσίαση",
    text: "Σύγχρονη προβολή και marketing κάθε ακινήτου.",
    image: "/images/why-icons/02_epaggelmatiki_parousiasi.png",
    alt: "Επαγγελματική παρουσίαση HOME88",
  },
  {
    title: "Προσωπική εξυπηρέτηση",
    text: "Υποστήριξη από την πρώτη επικοινωνία έως την ολοκλήρωση.",
    image: "/images/why-icons/03_prosopiki_exypiretisi.png",
    alt: "Προσωπική εξυπηρέτηση HOME88",
  },
  {
    title: "Δίκτυο & συνεργασίες",
    text: "Πρόσβαση σε αγοραστές, ιδιοκτήτες και επενδυτές.",
    image: "/images/why-icons/04_diktyo_synergias.png",
    alt: "Δίκτυο και συνεργασίες HOME88",
  },
];

export default async function HomePage() {
  const [featured, recent, total, areas] = await Promise.all([
    listFeaturedProperties("el", 3),
    listRecentProperties("el", 6),
    countPublicProperties(),
    listAreas(),
  ]);

  // Only the areas we actually cover: the list is derived from live listings,
  // so this section is never a set of invented place names.
  const topAreas = areas.slice(0, 8);

  // The branded landing background is the hero, independent of inventory, so
  // the homepage never falls back to a bare colour or a slow-loading photo.
  // The file is served untouched; the darkening ramp and the copy are separate
  // layers in CSS (see `.hero::before`).
  const heroImage = "/images/home88-landing-background.png";

  return (
    <>
      <section
        className="hero"
        style={heroImage ? { backgroundImage: `url(${heroImage})` } : undefined}
      >
        <div className="wrap hero__inner">
          <span className="hero__eyebrow">Πωλήσεις · Ενοικιάσεις · Αναθέσεις</span>
          <span className="hero__rule" aria-hidden="true" />
          <h1>
            Βρείτε το επόμενο
            <br />
            <strong>ακίνητό σας</strong>
          </h1>
          <p className="lede">
            Κατοικίες, επαγγελματικοί χώροι, γη και επενδυτικές ευκαιρίες με
            επαγγελματική υποστήριξη σε κάθε βήμα.
          </p>

          {/*
            A plain GET form. It works with JavaScript disabled, it is
            crawlable, and it produces a shareable, server-rendered result URL.

            Structure is deliberately two rows only: the transaction tabs, then
            a single row of controls with the submit button inside that same
            grid. The button used to live in a separate row underneath, which
            made the panel a tall block instead of a compact search bar.
          */}
          <form className="search-panel" action="/properties" method="get">
            <div className="search-tabs" role="group" aria-label="Τύπος συναλλαγής">
              <label>
                <input type="radio" name="listingType" value="SALE" defaultChecked />
                <span>Αγορά</span>
              </label>
              <label>
                <input type="radio" name="listingType" value="RENT" />
                <span>Ενοικίαση</span>
              </label>
            </div>

            <div className="search-controls">
              <div className="control">
                <label htmlFor="q">Περιοχή ή κωδικός</label>
                <div className="control__box">
                  <svg className="control__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                  <input
                    id="q"
                    name="q"
                    className="input"
                    placeholder="π.χ. Γλυφάδα"
                    autoComplete="off"
                  />
                </div>
              </div>

              <div className="control">
                <label htmlFor="propertyType">Τύπος ακινήτου</label>
                <div className="control__box">
                  <svg className="control__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 21h18" />
                    <path d="M5 21V7l7-4 7 4v14" />
                    <path d="M9 21v-5h6v5" />
                  </svg>
                  <select id="propertyType" name="propertyType" className="select" defaultValue="">
                    {TYPE_OPTIONS.map(([value, text]) => (
                      <option key={value} value={value}>
                        {text}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="control">
                <label htmlFor="minPrice">Τιμή από</label>
                <div className="control__box">
                  <svg className="control__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 5v14" />
                    <path d="m19 12-7 7-7-7" />
                  </svg>
                  <input id="minPrice" name="minPrice" className="input" inputMode="numeric" placeholder="€" />
                </div>
              </div>

              <div className="control">
                <label htmlFor="maxPrice">Τιμή έως</label>
                <div className="control__box">
                  <svg className="control__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 19V5" />
                    <path d="m5 12 7-7 7 7" />
                  </svg>
                  <input id="maxPrice" name="maxPrice" className="input" inputMode="numeric" placeholder="€" />
                </div>
              </div>

              <div className="control control--submit">
                <button type="submit" className="search-submit">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                  Αναζήτηση
                </button>
              </div>
            </div>
          </form>

          {total > 0 && (
            <p className="hero__count">{total} ακίνητα διαθέσιμα αυτή τη στιγμή.</p>
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

      <section className="section">
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
                <div className="value__media">
                  <img src={v.image} alt={v.alt} loading="lazy" />
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
          <div className="split-cta">
            <div>
              <h2 style={{ marginTop: 0 }}>
                Θέλετε να πουλήσετε ή να ενοικιάσετε το ακίνητό σας;
              </h2>
              <p className="muted">
                Αφήστε τα στοιχεία του ακινήτου σας και ένας σύμβουλος της HOME88
                θα επικοινωνήσει μαζί σας για εκτίμηση και στρατηγική προβολής.
              </p>
              <div className="row">
                <Link href="/submit" className="btn btn--primary btn--lg">
                  Ανάθεση ακινήτου
                </Link>
                <Link href="/request" className="btn btn--outline">
                  Ζητώ ακίνητο
                </Link>
              </div>
            </div>
            <ul className="checklist">
              <li>Δωρεάν εκτίμηση της εμπορικής αξίας του ακινήτου σας.</li>
              <li>Προτεινόμενη τιμή και διάρκεια διαφήμισης, πριν από τη λήψη απόφασης.</li>
              <li>Επιλεκτική προβολή σε καταχωρίσεις και επαφή με υποψήφιους αγοραστές.</li>
              <li>Συνεργασία με νομικούς συμβούλους και μηχανικούς για την ολοκλήρωση της συναλλαγής.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="section section--surface">
        <div className="wrap">
          <div className="between section-head">
            <div>
              <h2 style={{ margin: 0 }}>Εκτίμηση ακινήτου</h2>
              <p className="muted" style={{ margin: "6px 0 0" }}>
                Θέλετε να μάθετε την τρέχουσα αξία του ακινήτου σας; Συμπληρώστε τα
                στοιχεία σας και θα σας επικοινωνήσουμε με προσωπικό ενημέρωση.
              </p>
            </div>
            <Link href="/valuation" className="btn btn--primary">
              Ζητήστε εκτίμηση
            </Link>
          </div>
        </div>
      </section>

      {topAreas.length > 0 && (
        <section className="section">
          <div className="wrap">
            <div className="between section-head">
              <div>
                <h2 style={{ margin: 0 }}>Περιοχές που καλύπτουμε</h2>
                <p className="muted" style={{ margin: "6px 0 0" }}>
                  Δείτε τις διαθέσιμες αγγελίες ανά περιοχή.
                </p>
              </div>
              <Link href="/areas" className="btn btn--outline btn--sm">
                Όλες οι περιοχές
              </Link>
            </div>
            <div className="area-grid">
              {topAreas.map((a) => (
                <Link key={a.slug} href={`/areas/${a.slug}`} className="area-card">
                  <h3>{a.name}</h3>
                  <p>
                    {a.city ? `${a.city} · ` : ""}
                    {a.count} {a.count === 1 ? "ακίνητο" : "ακίνητα"}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="section">
        <div className="wrap">
          <div className="cta-band">
            <h2>Έχετε ερώτηση για ένα ακίνητο;</h2>
            <p>
              Επικοινωνήστε με την ομάδα της HOME88 για πληροφορίες, διαθεσιμότητα και
              προγραμματισμό επίσκεψης.
            </p>
            <div className="row" style={{ marginTop: 18 }}>
              <Link href="/contact" className="btn btn--onhero btn--lg">
                Επικοινωνία
              </Link>
              <a href={`tel:${COMPANY.phone}`} className="btn btn--onhero">
                {COMPANY.phone}
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
