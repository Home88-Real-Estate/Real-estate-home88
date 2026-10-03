import type { Metadata } from "next";

import { CaptureForm } from "@/components/CaptureForm";
import { ContactEmail } from "@/components/ContactEmail";
import { getCompanyInfo } from "@/lib/company";

export const metadata: Metadata = {
  title: "Επικοινωνία",
  description: "Στείλτε μας μήνυμα και θα σας απαντήσουμε το συντομότερο.",
  alternates: { canonical: "/contact" },
};

export default async function ContactPage() {
  const company = await getCompanyInfo();
  return (
    <div className="wrap section">
      <div className="grid grid--2" style={{ alignItems: "start" }}>
        <div>
          <h1>Επικοινωνία</h1>
          <p className="muted">
            Συμπληρώστε τη φόρμα και θα σας απαντήσουμε το συντομότερο.
            {company.email ? (
              <>
                {" "}Ή στείλτε email στο <ContactEmail email={company.email} />.
              </>
            ) : null}
          </p>

          {(company.address || company.phones.length > 0 || company.hours) && (
            <p className="muted">
              {company.address && (
                <>
                  <strong>Διεύθυνση:</strong> {company.address}
                  <br />
                </>
              )}
              {company.phones.map((p) => (
                <span key={p}>
                  <strong>Τηλέφωνο:</strong> <a href={`tel:${p.replace(/[^\d+]/g, "")}`}>{p}</a>
                  <br />
                </span>
              ))}
              {company.hours && (
                <>
                  <strong>Ωράριο:</strong> {company.hours}
                </>
              )}
            </p>
          )}

          <div className="notice">
            Για ζητήματα προσωπικών δεδομένων χρησιμοποιήστε το{" "}
            <ContactEmail email={company.privacyEmail} fallback="τη φόρμα αυτής της σελίδας" />. Για αναφορές
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
