import Link from "next/link";
import { COMPANY } from "@/lib/config";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="wrap site-header__inner">
        <Link href="/" className="brand" aria-label={`${COMPANY.legalName} home`}>
          {COMPANY.legalName}
        </Link>

        <nav className="nav" aria-label="Main">
          <Link href="/properties?listingType=SALE">Αγορά</Link>
          <Link href="/properties?listingType=RENT">Ενοικίαση</Link>
          <Link href="/properties">Ακίνητα</Link>
          <Link href="/submit">Ανάθεση</Link>
          <Link href="/request">Ζήτηση</Link>
          <Link href="/about">Εταιρεία</Link>
          <Link href="/contact">Επικοινωνία</Link>
        </nav>

        <div className="header-actions">
          <Link href="/contact" className="btn btn--primary btn--sm">
            Επικοινωνία
          </Link>
        </div>
      </div>
    </header>
  );
}
