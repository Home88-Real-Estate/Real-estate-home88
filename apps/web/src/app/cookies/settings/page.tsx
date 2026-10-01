import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";

import { ConsentSettings } from "@/components/ConsentSettings";
import { COMPANY } from "@/lib/config";
import { CONSENT_COOKIE, parseConsent } from "@/lib/consent";

export const metadata: Metadata = {
  title: "Ρυθμίσεις Cookies",
  description: "Αλλάξτε ή ανακαλέστε τη συγκατάθεσή σας για cookies ανά πάσα στιγμή.",
  alternates: { canonical: "/cookies/settings" },
  robots: { index: false, follow: true },
};

export default async function CookieSettingsPage() {
  const cookieStore = await cookies();
  const consent = parseConsent(cookieStore.get(CONSENT_COOKIE)?.value);

  return (
    <div className="wrap section" style={{ maxWidth: 720 }}>
      <h1>Ρυθμίσεις Cookies</h1>
      <p className="muted">
        Αλλάξτε τις προτιμήσεις σας. Η ανάκληση είναι εξίσου εύκολη με τη συγκατάθεση και δεν
        επηρεάζει τη νομιμότητα της επεξεργασίας που έγινε πριν από αυτήν. Δείτε την{" "}
        <Link href="/cookies">Πολιτική Cookies</Link>.
      </p>

      <ConsentSettings
        policyVersion={COMPANY.policyVersion}
        initial={{
          analytics: consent.analytics,
          marketing: consent.marketing,
          sessionReplay: consent.sessionReplay,
        }}
      />
    </div>
  );
}
