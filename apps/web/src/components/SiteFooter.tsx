import Link from "next/link";
import { CRM_LOGIN_URL } from "@/lib/config";
import type { CompanyInfo } from "@/lib/company";

import { ContactEmail } from "./ContactEmail";
import { WaveDivider } from "./landing/WaveDivider";

const SOCIAL_LABEL: Record<string, string> = {
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  YOUTUBE: "YouTube",
  LINKEDIN: "LinkedIn",
  X: "X",
  PINTEREST: "Pinterest",
  TIKTOK: "TikTok",
};

export function SiteFooter({ company }: { company: CompanyInfo }) {
  const year = new Date().getFullYear();
  // Staff-only door to the internal CRM (see CRM_LOGIN_URL in lib/config.ts).
  const staffUrl = CRM_LOGIN_URL;

  return (
    <footer className="site-footer">
      <WaveDivider position="top" />
      <div className="wrap site-footer__inner">
        <div>
          <div className="brand" style={{ marginBottom: 12 }}>
            {company.name}
            <span className="brand__sub">Real Estate</span>
          </div>
          <p className="muted" style={{ fontSize: "0.9rem", maxWidth: "44ch" }}>
            Μεσιτικό γραφείο ακινήτων. Πωλήσεις, ενοικιάσεις και αναθέσεις με
            επαγγελματική παρουσίαση και προσωπική εξυπηρέτηση.
          </p>
          {company.address ? (
            <address style={{ fontSize: "0.86rem", fontStyle: "normal", whiteSpace: "pre-line" }}>
              {company.address}
            </address>
          ) : null}
          {company.phones.map((phone, i) => (
            <p key={phone} style={{ margin: i === 0 ? "8px 0 0" : 0 }}>
              <a href={`tel:${phone.replace(/[^\d+]/g, "")}`}>{phone}</a>
            </p>
          ))}
          {company.email ? (
            <p style={{ margin: 0 }}>
              <a href={`mailto:${company.email}`}>{company.email}</a>
            </p>
          ) : null}
          {company.hours ? (
            <p className="muted" style={{ fontSize: "0.84rem", marginTop: 8 }}>
              {company.hours}
            </p>
          ) : null}
          {company.socials.length > 0 ? (
            <p className="footer-social" style={{ margin: "10px 0 0", display: "flex", gap: 12, flexWrap: "wrap", fontSize: "0.86rem" }}>
              {company.socials.map((s) => (
                <a key={s.platform} href={s.url} rel="noopener noreferrer me" target="_blank">
                  {SOCIAL_LABEL[s.platform] ?? s.platform}
                </a>
              ))}
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

        {/*
          Staff/business access only — never a customer account. The link only
          reaches the CRM login page; authorisation stays server-side.
        */}
        {staffUrl ? (
          <div>
            <h3>Συνεργάτες</h3>
            <ul>
              <li>
                <a href={staffUrl} rel="nofollow">
                  Σύνδεση Συνεργατών
                </a>
              </li>
            </ul>
          </div>
        ) : null}
      </div>

      <div className="wrap legal-note">
        <div className="between">
          <span>
            © {year} {company.legalName}. Με την επιφύλαξη πάντων των δικαιωμάτων.
          </span>
          {company.privacyEmail ? (
            <span>
              Απόρρητο: <ContactEmail email={company.privacyEmail} />
            </span>
          ) : null}
        </div>
      </div>
    </footer>
  );
}
