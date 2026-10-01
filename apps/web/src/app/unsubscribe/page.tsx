import type { Metadata } from "next";
import Link from "next/link";

import { UnsubscribeConfirm } from "@/components/UnsubscribeConfirm";
import { COMPANY } from "@/lib/config";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe-token";

export const metadata: Metadata = {
  title: "Διαγραφή από ενημερώσεις",
  description: "Διαγραφείτε από τα ενημερωτικά μηνύματα.",
  alternates: { canonical: "/unsubscribe" },
  robots: { index: false, follow: false },
};

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const sp = await searchParams;
  const rawToken = Array.isArray(sp.token) ? sp.token[0] : sp.token;
  const verified = rawToken ? verifyUnsubscribeToken(rawToken) : null;

  return (
    <div className="wrap section" style={{ maxWidth: 640 }}>
      <h1>Διαγραφή από ενημερώσεις</h1>

      {verified && rawToken ? (
        <UnsubscribeConfirm token={rawToken} />
      ) : (
        <div className="notice">
          <strong>Ο σύνδεσμος δεν είναι έγκυρος ή έχει λήξει.</strong>
          <p style={{ margin: "6px 0 0" }}>
            Χρησιμοποιήστε τον σύνδεσμο «Διαγραφή» στο κάτω μέρος του email που λάβατε, ή
            επικοινωνήστε μαζί μας στο{" "}
            <a href={`mailto:${COMPANY.privacyEmail}`}>{COMPANY.privacyEmail}</a> και θα σας
            διαγράψουμε.
          </p>
        </div>
      )}

      <p className="muted" style={{ marginTop: 18, fontSize: "0.9rem" }}>
        Δείτε την <Link href="/privacy">Πολιτική Απορρήτου</Link>.
      </p>
    </div>
  );
}
