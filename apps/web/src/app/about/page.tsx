import type { Metadata } from "next";
import Link from "next/link";

import { COMPANY } from "@/lib/config";
import { ContactEmail } from "@/components/ContactEmail";
import { getCompanyInfo } from "@/lib/company";

export const metadata: Metadata = {
  title: "Η εταιρεία",
  description: `Ποιοι είμαστε και πώς δουλεύουμε. ${COMPANY.legalName}.`,
  alternates: { canonical: "/about" },
};

export default async function AboutPage() {
  const company = await getCompanyInfo();
  return (
    <div className="wrap prose section">
      <h1>Η εταιρεία</h1>
      {company.profile ? (
        company.profile.split(/\n{2,}/).map((para, i) => <p key={i} style={{ whiteSpace: "pre-line" }}>{para}</p>)
      ) : (
      <p>
        Ο {company.legalName} δραστηριοποιείται στην αγορά ακινήτων: πωλήσεις, ενοικιάσεις και
        αναθέσεις. Συνεργαζόμαστε με ιδιοκτήτες και αγοραστές σε όλη την Ελλάδα.
      </p>
      )}

      <h2>Το ακίνητό σας, σε ένα σημείο</h2>
      <p>
        Μία καταχώριση στην πλατφόρμα μας τροφοδοτεί την ιστοσελίδα και τα συνεργαζόμενα δίκτυα
        αγγελιών. Έτσι δεν χρειάζεται να συντηρείτε το ίδιο ακίνητο σε πολλά συστήματα, και οι
        αλλαγές τιμής ή κατάστασης εφαρμόζονται παντού.
      </p>

      <h2>Πώς δουλεύουμε</h2>
      <ul>
        <li>Αυτοψία και τεκμηρίωση στοιχείων πριν από τη δημοσίευση.</li>
        <li>Φωτογράφιση και περιγραφή στα ελληνικά, με αγγλική μετάφραση όπου χρειάζεται.</li>
        <li>Έλεγχος τίτλων και νομικών εκκρεμοτήτων σε συνεργασία με νομικούς συμβούλους.</li>
        <li>Διαχείριση επισκέψεων, προσφορών και διαπραγμάτευσης.</li>
      </ul>

      <h2>Επικοινωνία</h2>
      <p>
        Δείτε τη σελίδα <Link href="/contact">Επικοινωνία</Link>
        {company.email ? (
          <>
            {" "}ή στείλτε email στο <ContactEmail email={company.email} />
          </>
        ) : null}
        .
      </p>
    </div>
  );
}
