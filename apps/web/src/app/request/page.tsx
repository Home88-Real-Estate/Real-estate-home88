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

      <figure className="page-figure">
        <img
          src="/images/fox/fox-lounge-keys.webp"
          width={758}
          height={504}
          alt="Η αλεπού της HOME88 σε σαλόνι με θέα στη θάλασσα, δίπλα σε κλειδιά και συμβόλαιο"
          loading="lazy"
          decoding="async"
        />
      </figure>

      <div className="searchpanel" style={{ marginTop: 20, maxWidth: 760 }}>
        <CaptureForm
          endpoint="/api/requests"
          submitLabel="Αποστολή αιτήματος"
          successMessage="Λάβαμε τα κριτήριά σας και θα επικοινωνήσουμε όταν βρούμε κάτι κατάλληλο."
          consentLabel="Επεξεργασία των στοιχείων μου για να βρεθεί ακίνητο που ταιριάζει."
          fields={[
            { name: "firstName", label: "Όνομα", required: true, autoComplete: "given-name" },
            { name: "lastName", label: "Επώνυμο", autoComplete: "family-name" },
            { name: "email", label: "Email", type: "email", autoComplete: "email" },
            { name: "phone", label: "Τηλέφωνο", type: "tel", autoComplete: "tel" },
            {
              name: "listingType",
              label: "Ψάχνω για",
              type: "select",
              required: true,
              defaultValue: "SALE",
              options: [
                { value: "SALE", label: "Αγορά" },
                { value: "RENT", label: "Ενοικίαση" },
              ],
            },
            {
              name: "propertyType",
              label: "Τύπος ακινήτου",
              type: "select",
              options: [
                { value: "", label: "Οποιοσδήποτε" },
                { value: "APARTMENT", label: "Διαμέρισμα" },
                { value: "MAISONETTE", label: "Μεζονέτα" },
                { value: "HOUSE", label: "Μονοκατοικία" },
                { value: "VILLA", label: "Βίλα" },
                { value: "STUDIO", label: "Στούντιο" },
                { value: "OFFICE", label: "Γραφείο" },
                { value: "SHOP", label: "Κατάστημα" },
                { value: "LAND", label: "Γη" },
                { value: "PLOT", label: "Οικόπεδο" },
              ],
            },
            { name: "city", label: "Περιοχή", placeholder: "π.χ. Γλυφάδα", hint: "Μία περιοχή· περιγράψτε περισσότερες στις σημειώσεις." },
            { name: "budgetMin", label: "Προϋπολογισμός από (€)", type: "number" },
            { name: "budgetMax", label: "Προϋπολογισμός έως (€)", type: "number" },
            { name: "minArea", label: "Εμβαδόν από (τ.μ.)", type: "number" },
            { name: "minBedrooms", label: "Υπνοδωμάτια (τουλάχιστον)", type: "number" },
            { name: "minBathrooms", label: "Μπάνια (τουλάχιστον)", type: "number" },
            { name: "minFloor", label: "Όροφος (από)", type: "number" },
            { name: "minYearBuilt", label: "Έτος κατασκευής (από)", type: "number" },
            { name: "parking", label: "Parking", type: "checkbox" },
            { name: "storage", label: "Αποθήκη", type: "checkbox" },
            { name: "elevator", label: "Ανελκυστήρας", type: "checkbox" },
            { name: "balcony", label: "Μπαλκόνι", type: "checkbox" },
            { name: "garden", label: "Κήπος", type: "checkbox" },
            { name: "pool", label: "Πισίνα", type: "checkbox" },
            { name: "seaView", label: "Θέα θάλασσα", type: "checkbox" },
            { name: "furnished", label: "Επιπλωμένο", type: "checkbox" },
            {
              name: "message",
              label: "Τι άλλο ψάχνετε;",
              type: "textarea",
              rows: 4,
              placeholder: "π.χ. κοντά σε μετρό, ήσυχη γειτονιά, άνω των 80 τ.μ.",
            },
          ]}
        />
      </div>
    </div>
  );
}
