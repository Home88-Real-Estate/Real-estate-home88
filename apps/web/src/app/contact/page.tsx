import type { Metadata } from "next";

import { CaptureForm } from "@/components/CaptureForm";
import { COMPANY } from "@/lib/config";

export const metadata: Metadata = {
  title: "Επικοινωνία",
  description: "Στείλτε μας μήνυμα και θα σας απαντήσουμε το συντομότερο.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <div className="wrap section">
      <div className="grid grid--2" style={{ alignItems: "start" }}>
        <div>
          <h1>Επικοινωνία</h1>
          <p className="muted">
            Συμπληρώστε τη φόρμα ή στείλτε email στο{" "}
            <a href={`mailto:${COMPANY.privacyEmail}`}>{COMPANY.privacyEmail}</a>.
          </p>

          {COMPANY.postalAddress && (
            <p className="muted">
              <strong>Διεύθυνση:</strong>
              <br />
              {COMPANY.postalAddress}
            </p>
          )}

          <div className="notice">
            Για ζητήματα προσωπικών δεδομένων χρησιμοποιήστε το{" "}
            <a href={`mailto:${COMPANY.privacyEmail}`}>{COMPANY.privacyEmail}</a>. Για αναφορές
            πνευματικών δικαιωμάτων δείτε τη σελίδα{" "}
            <a href="/dmca">Πνευματικά Δικαιώματα</a>.
          </div>
        </div>

        <div className="searchpanel" style={{ marginTop: 0 }}>
          <CaptureForm
            endpoint="/api/contact"
            submitLabel="Αποστολή μηνύματος"
            successMessage="Λάβαμε το μήνυμά σας και θα απαντήσουμε σύντομα."
            consentLabel="Επεξεργασία των στοιχείων μου για να απαντηθεί το μήνυμα."
            fields={[
              { name: "firstName", label: "Όνομα", required: true, autoComplete: "given-name" },
              { name: "lastName", label: "Επώνυμο", autoComplete: "family-name" },
              { name: "email", label: "Email", type: "email", autoComplete: "email" },
              { name: "phone", label: "Τηλέφωνο", type: "tel", autoComplete: "tel" },
              { name: "subject", label: "Θέμα" },
              { name: "message", label: "Μήνυμα", type: "textarea", required: true, rows: 5 },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
