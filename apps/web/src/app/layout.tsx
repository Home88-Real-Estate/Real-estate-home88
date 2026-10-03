import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import Link from "next/link";

import "./globals.css";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { ConsentBanner } from "@/components/ConsentBanner";
import { CompareBar } from "@/components/CompareBar";
import { CONSENT_COOKIE, needsDecision, parseConsent } from "@/lib/consent";
import { COMPANY, SITE_URL } from "@/lib/config";
import { getCompanyInfo } from "@/lib/company";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${COMPANY.legalName} — Ακίνητα προς πώληση και ενοικίαση`,
    template: `%s | ${COMPANY.legalName}`,
  },
  description:
    "Αναζητήστε ακίνητα προς πώληση και ενοικίαση στην Ελλάδα. Διαμερίσματα, κατοικίες, καταστήματα, γραφεία και οικόπεδα.",
  applicationName: COMPANY.legalName,
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    siteName: COMPANY.legalName,
    locale: "el_GR",
  },
  // No verification or analytics tokens are hard-coded here.
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b5394",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const consent = parseConsent(cookieStore.get(CONSENT_COOKIE)?.value);
  const showBanner = needsDecision(consent);
  const company = await getCompanyInfo();

  return (
    <html lang="el">
      <body>
        <a className="skip-link" href="#main">
          Μετάβαση στο περιεχόμενο
        </a>

        <SiteHeader legalName={company.name} phone={company.phone ?? ""} hours={company.hours ?? ""} />

        <main id="main">{children}</main>

        <SiteFooter company={company} />

        <CompareBar />

        {/*
          The banner only appears before a choice is made. Its "Αποδοχή όλων"
          sets the same booleans as before, so nothing changes silently.
        */}
        {showBanner && <ConsentBanner policyVersion={COMPANY.policyVersion} />}

        {/*
          Automated accessibility and screen-reader notes:
          there is deliberately no analytics, no session-replay and no external
          script of any kind in this layout. If one is ever added it must be
          wrapped in <ConsentGate consent={consent} purpose="...">, which reads
          the cookie parsed above on the server.
        */}
        <noscript>
          <div className="wrap" style={{ paddingBottom: 20 }}>
            <p className="muted" style={{ fontSize: "0.85rem" }}>
              Η ιστοσελίδα λειτουργεί χωρίς JavaScript.{" "}
              <Link href="/contact">Επικοινωνήστε μαζί μας</Link> για οποιαδήποτε βοήθεια.
            </p>
          </div>
        </noscript>
      </body>
    </html>
  );
}
