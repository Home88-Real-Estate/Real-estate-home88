import Link from "next/link";
import { COMPANY } from "@/lib/config";

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="wrap site-footer__inner">
        <div>
          <div className="brand" style={{ marginBottom: 10 }}>
            {COMPANY.legalName}
          </div>
          <p className="muted" style={{ fontSize: "0.9rem", maxWidth: "42ch" }}>
            Μεσιτικό γραφείο ακινήτων. Πωλήσεις, ενοικιάσεις και αναθέσεις σε όλη την Ελλάδα.
          </p>
          {COMPANY.postalAddress ? (
            <address className="muted" style={{ fontSize: "0.86rem", fontStyle: "normal", whiteSpace: "pre-line" }}>
              {COMPANY.postalAddress}
            </address>
          ) : (
            <p className="muted" style={{ fontSize: "0.82rem" }}>
              Διεύθυνση έδρας: <em>δεν έχει ρυθμιστεί</em>
            </p>
          )}
        </div>

        <div>
          <h3>Πλοήγηση</h3>
          <ul>
            <li><Link href="/properties">Ακίνητα</Link></li>
            <li><Link href="/properties?listingType=SALE">Προς πώληση</Link></li>
            <li><Link href="/properties?listingType=RENT">Προς ενοικίαση</Link></li>
            <li><Link href="/submit">Ανάθεση ακινήτου</Link></li>
            <li><Link href="/request">Ζήτηση ακινήτου</Link></li>
            <li><Link href="/contact">Επικοινωνία</Link></li>
          </ul>
        </div>

        <div>
          <h3>Νομικά</h3>
          <ul>
            <li><Link href="/privacy">Πολιτική απορρήτου</Link></li>
            <li><Link href="/cookies">Πολιτική cookies</Link></li>
            <li><Link href="/terms">Όροι χρήσης</Link></li>
            <li><Link href="/dmca">Πνευματικά δικαιώματα</Link></li>
            {/* Withdrawal must be as easy as granting: reachable from every page. */}
            <li><Link href="/cookies/settings">Ρυθμίσεις συγκατάθεσης</Link></li>
            <li><Link href="/unsubscribe">Διαγραφή από ενημερώσεις</Link></li>
          </ul>
        </div>
      </div>

      <div className="wrap legal-note">
        <div className="between">
          <span>
            © {year} {COMPANY.legalName}. Με την επιφύλαξη πάντων των δικαιωμάτων.
          </span>
          <span>
            Απόρρητο: <a href={`mailto:${COMPANY.privacyEmail}`}>{COMPANY.privacyEmail}</a>
          </span>
        </div>
      </div>
    </footer>
  );
}
