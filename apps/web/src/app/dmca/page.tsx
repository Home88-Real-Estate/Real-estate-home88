import type { Metadata } from "next";

import { CaptureForm } from "@/components/CaptureForm";
import { COMPANY } from "@/lib/config";

export const metadata: Metadata = {
  title: "Πνευματικά Δικαιώματα",
  description: "Διαδικασία αναφοράς περιεχομένου που παραβιάζει πνευματικά δικαιώματα.",
  alternates: { canonical: "/dmca" },
};

export default function DmcaPage() {
  return (
    <div className="wrap section">
      <div className="prose">
        <h1>Αναφορά παραβίασης πνευματικών δικαιωμάτων</h1>
        <p>
          Αν πιστεύετε ότι υλικό στην ιστοσελίδα παραβιάζει δικαίωμα πνευματικής ιδιοκτησίας που
          σας ανήκει, συμπληρώστε τη φόρμα. Η αναφορά σας καταγράφεται με δικό της κωδικό και
          εξετάζεται.
        </p>

        <h2>Τι πρέπει να περιλαμβάνει</h2>
        <ul>
          <li>Τα στοιχεία σας και τρόπο επικοινωνίας.</li>
          <li>Περιγραφή του προστατευόμενου έργου.</li>
          <li>Τη διεύθυνση (URL) του υλικού για το οποίο διαμαρτύρεστε.</li>
          <li>Δήλωση καλής πίστης ότι η χρήση δεν είναι εξουσιοδοτημένη.</li>
          <li>Δήλωση ότι τα στοιχεία είναι ακριβή, με υπογραφή σας.</li>
        </ul>

        <div className="notice notice--danger">
          <strong>Προσοχή.</strong> Η εν γνώσει ψευδής αναφορά μπορεί να επιφέρει ευθύνη. Αν δεν
          είστε βέβαιοι, συμβουλευτείτε νομικό σύμβουλο. Η ψευδής δήλωση σε αναφορά που αφορά
          υλικό το οποίο αφαιρέθηκε λόγω λάθους μπορεί επίσης να έχει συνέπειες.
        </div>

        <p className="muted">
          Εναλλακτικά, μπορείτε να στείλετε την αναφορά σας στο{" "}
          <a href={`mailto:${COMPANY.dmcaEmail}`}>{COMPANY.dmcaEmail}</a>.
        </p>
      </div>

      <div className="searchpanel" style={{ marginTop: 20, maxWidth: 760 }}>
        <CaptureForm
          endpoint="/api/dmca"
          submitLabel="Υποβολή αναφοράς"
          successMessage="Λάβαμε την αναφορά σας. Θα την εξετάσουμε και θα επικοινωνήσουμε μαζί σας."
          consentLabel="Επεξεργασία των στοιχείων μου για να εξεταστεί η αναφορά."
          policyHref="/terms"
          fields={[
            { name: "claimantName", label: "Ονοματεπώνυμο", required: true, autoComplete: "name" },
            { name: "claimantEmail", label: "Email", type: "email", required: true, autoComplete: "email" },
            { name: "claimantAddress", label: "Διεύθυνση", autoComplete: "street-address" },
            { name: "originalWorkUrl", label: "Σύνδεσμος πρωτότυπου έργου", type: "text" },
            { name: "workDescription", label: "Περιγραφή προστατευόμενου έργου", type: "textarea", required: true, rows: 4 },
            { name: "infringingUrl", label: "Σύνδεσμος παραβαίνοντος υλικού" },
            { name: "propertyReference", label: "Κωδικός ακινήτου (αν υπάρχει)", placeholder: "H88-000000" },
            {
              name: "goodFaithStatement",
              label: "Δήλωση καλής πίστης",
              type: "textarea",
              required: true,
              rows: 3,
              defaultValue:
                "Δηλώνω με ποινή ψευδορκίας ότι πιστεύω καλόπιστα πως η χρήση του υλικού δεν έχει εξουσιοδοτηθεί από τον κάτοχο, τον αντιπρόσωπό του ή τον νόμο.",
            },
            { name: "signature", label: "Υπογραφή (πληκτρολογήστε το όνομά σας)", required: true },
          ]}
        />
      </div>
    </div>
  );
}
