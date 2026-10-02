import Link from "next/link";
import { COMPANY, CRM_LOGIN_URL } from "@/lib/config";

export function SiteFooter() {
  const year = new Date().getFullYear();
  // Staff-only door to the internal CRM. Hidden entirely when no CRM origin is
  // configured (see lib/config.ts): production fails closed rather than sending
  // staff to a localhost placeholder.
  const staffUrl = CRM_LOGIN_URL;

  return (
    <footer className="site-footer">
      <div className="wrap site-footer__inner">
        <div>
          <div className="brand" style={{ marginBottom: 12 }}>
            {COMPANY.legalName}
            <span className="brand__sub">Real Estate</span>
          </div>
          <p className="muted" style={{ fontSize: "0.9rem", maxWidth: "44ch" }}>
            Μεσιτικό γραφείο ακινήτων. Πωλήσεις, ενοικιάσεις και αναθέσεις με
            επαγγελματική παρουσίαση και προσωπική εξυπηρέτηση.
          </p>
          {COMPANY.postalAddress ? (
            <address style={{ fontSize: "0.86rem", fontStyle: "normal", whiteSpace: "pre-line" }}>
              {COMPANY.postalAddress}
            </address>
          ) : null}
          {COMPANY.phone ? (
            <p style={{ margin: "8px 0 0" }}>
              <a href={`tel:${COMPANY.phone.replace(/\s+/g, "")}`}>{COMPANY.phone}</a>
            </p>
          ) : null}
          {COMPANY.contactEmail ? (
            <p style={{ margin: 0 }}>
              <a href={`mailto:${COMPANY.contactEmail}`}>{COMPANY.contactEmail}</a>
            </p>
          ) : null}
          {COMPANY.hours ? (
            <p className="muted" style={{ fontSize: "0.84rem", marginTop: 8 }}>
              {COMPANY.hours}
            </p>
          ) : null}
        </div>

        <div>
          <h3>Ακίνητα</h3>
          <ul>
            <li><Link href="/properties?listingType=SALE">Προς πώληση</Link></li>
            <li><Link href="/properties?listingType=RENT">Προς ενοικίαση</Link></li>
            <li><Link href="/properties?propertyType=APARTMENT">Κατοικίες</Link></li>
            <li><Link href="/properties?propertyType=SHOP">Επαγγελματικοί χώροι</Link></li>
            <li><Link href="/properties?propertyType=PLOT">Γη &amp; οικόπεδα</Link></li>
            <li><Link href="/areas">Ανά περιοχή</Link></li>
            <li><Link href="/properties">Όλα τα ακίνητα</Link></li>
          </ul>
        </div>

        <div>
          <h3>Υπηρεσίες</h3>
          <ul>
            <li><Link href="/submit">Ανάθεση ακινήτου</Link></li>
            <li><Link href="/request">Ζήτηση ακινήτου</Link></li>
            <li><Link href="/valuation">Εκτίμηση ακινήτου</Link></li>
            <li><Link href="/about">Η εταιρεία</Link></li>
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

        <div>
          <h3>Συνεργάτες</h3>
          <ul>
            {/*
              Staff/business access only — never a customer account. The footer
              link reaches the CRM login page; authorisation stays server-side.
            */}
            {staffUrl ? (
              <li>
                <a href={staffUrl} rel="nofollow">
                  Σύνδεση Συνεργατών
                </a>
              </li>
            ) : null}
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
