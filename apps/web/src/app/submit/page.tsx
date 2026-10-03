import type { Metadata } from "next";

import { CaptureForm } from "@/components/CaptureForm";

export const metadata: Metadata = {
  title: "Ανάθεση ακινήτου",
  description: "Δώστε μας το ακίνητό σας προς πώληση ή ενοικίαση και αναλαμβάνουμε τα υπόλοιπα.",
  alternates: { canonical: "/submit" },
};

export default function SubmitPage() {
  return (
    <div className="wrap section">
      <h1>Ανάθεση ακινήτου</h1>
      <p className="muted" style={{ maxWidth: 640 }}>
        Περιγράψτε το ακίνητο και θα επικοινωνήσουμε μαζί σας για αυτοψία και τιμολόγηση. Δεν
        χρεώνεστε για την υποβολή.
      </p>

      <div className="grid grid--2" style={{ alignItems: "start", marginTop: 20 }}>
        <div className="searchpanel" style={{ marginTop: 0 }}>
          <CaptureForm
            endpoint="/api/submissions"
            uploads
            submitLabel="Υποβολή ακινήτου"
            successMessage="Λάβαμε την υποβολή σας. Θα επικοινωνήσουμε μαζί σας για τα επόμενα βήματα."
            consentLabel="Επεξεργασία των στοιχείων μου για να αξιολογηθεί η ανάθεση."
            fields={[
              { name: "titleEl", label: "Τίτλος ακινήτου", required: true, placeholder: "π.χ. Διαμέρισμα 3ου ορόφου, Γλυφάδα" },
              {
                name: "listingType",
                label: "Ενδιαφέρομαι για",
                type: "select",
                required: true,
                options: [
                  { value: "SALE", label: "Πώληση" },
                  { value: "RENT", label: "Ενοικίαση" },
                  { value: "ASSIGNMENT", label: "Ανάθεση" },
                ],
              },
              {
                name: "propertyType",
                label: "Τύπος ακινήτου",
                type: "select",
                required: true,
                options: [
                  { value: "APARTMENT", label: "Διαμέρισμα" },
                  { value: "MAISONETTE", label: "Μεζονέτα" },
                  { value: "HOUSE", label: "Μονοκατοικία" },
                  { value: "VILLA", label: "Βίλα" },
                  { value: "STUDIO", label: "Στούντιο" },
                  { value: "OFFICE", label: "Γραφείο" },
                  { value: "SHOP", label: "Κατάστημα" },
                  { value: "WAREHOUSE", label: "Αποθήκη" },
                  { value: "BUILDING", label: "Κτίριο" },
                  { value: "HOTEL", label: "Ξενοδοχείο" },
                  { value: "LAND", label: "Γη" },
                  { value: "PLOT", label: "Οικόπεδο" },
                  { value: "PARKING", label: "Parking" },
                  { value: "INDUSTRIAL", label: "Βιομηχανικό" },
                  { value: "OTHER", label: "Άλλο" },
                ],
              },
              { name: "city", label: "Πόλη / Περιοχή" },
              { name: "neighborhood", label: "Γειτονιά" },
              { name: "area", label: "Εμβαδόν (τ.μ.)", type: "number", placeholder: "π.χ. 95" },
              { name: "bedrooms", label: "Υπνοδωμάτια", type: "number" },
              { name: "price", label: "Επιθυμητή τιμή (€)", type: "number" },
              { name: "descriptionEl", label: "Περιγραφή", type: "textarea", required: true, rows: 5 },
              { name: "contactFirstName", label: "Το όνομά σας", required: true, autoComplete: "given-name" },
              { name: "contactLastName", label: "Επώνυμο", autoComplete: "family-name" },
              { name: "contactEmail", label: "Email", type: "email", autoComplete: "email" },
              { name: "contactPhone", label: "Τηλέφωνο", type: "tel", autoComplete: "tel" },
              {
                name: "contactConsent",
                label: "Συμφωνώ να επικοινωνήσετε μαζί μου σχετικά με αυτό το ακίνητο.",
                type: "checkbox",
                required: true,
              },
            ]}
          />
        </div>

        <aside className="notice">
          <strong>Τι ακολουθεί.</strong>
          <ol style={{ marginTop: 8, paddingLeft: 20 }}>
            <li>Επικοινωνία και επιβεβαίωση στοιχείων.</li>
            <li>Αυτοψία και φωτογράφιση.</li>
            <li>Συμφωνία ανάθεσης και δημοσίευση.</li>
          </ol>
          <p className="muted" style={{ fontSize: "0.85rem", marginBottom: 0 }}>
            Η υποβολή δεν συνιστά ανάθεση. Η ανάθεση ολοκληρώνεται με χωριστή συμφωνία.
          </p>
        </aside>
      </div>
    </div>
  );
}
