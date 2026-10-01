import type { Metadata } from "next";

import { CaptureForm } from "@/components/CaptureForm";

export const metadata: Metadata = {
  title: "Ζητώ ακίνητο",
  description: "Πείτε μας τι ψάχνετε και θα σας ενημερώσουμε για διαθέσιμα ακίνητα.",
  alternates: { canonical: "/request" },
};

export default function RequestPage() {
  return (
    <div className="wrap section">
      <h1>Ζητώ ακίνητο</h1>
      <p className="muted" style={{ maxWidth: 640 }}>
        Συμπληρώστε τα κριτήριά σας. Θα σας ενημερώσουμε για ακίνητα που ταιριάζουν, χωρίς να
        χρειάζεται να ελέγχετε συνεχώς τις αγγελίες.
      </p>

      <div className="searchpanel" style={{ marginTop: 20, maxWidth: 760 }}>
        <CaptureForm
          endpoint="/api/leads"
          submitLabel="Αποστολή αιτήματος"
          successMessage="Λάβαμε τα κριτήριά σας και θα επικοινωνήσουμε όταν βρούμε κάτι κατάλληλο."
          consentLabel="Επεξεργασία των στοιχείων μου για να βρεθεί ακίνητο που ταιριάζει."
          extra={{ source: "WEBSITE" }}
          fields={[
            { name: "firstName", label: "Όνομα", required: true, autoComplete: "given-name" },
            { name: "lastName", label: "Επώνυμο", autoComplete: "family-name" },
            { name: "email", label: "Email", type: "email", autoComplete: "email" },
            { name: "phone", label: "Τηλέφωνο", type: "tel", autoComplete: "tel" },
            { name: "budgetMin", label: "Προϋπολογισμός από (€)", type: "number" },
            { name: "budgetMax", label: "Προϋπολογισμός έως (€)", type: "number" },
            {
              name: "message",
              label: "Τι ψάχνετε;",
              type: "textarea",
              rows: 5,
              placeholder:
                "π.χ. Διαμέρισμα 2-3 υπνοδωματίων, περιοχή νότια προάστια, με parking, άνω των 80 τ.μ.",
            },
          ]}
        />
      </div>
    </div>
  );
}
