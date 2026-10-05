import type { Metadata } from "next";

import { ValuationWizard } from "@/components/ValuationWizard";

export const metadata: Metadata = {
  title: "Εκτίμηση ακινήτου",
  description:
    "Ενδεικτική εκτίμηση της αξίας ενός ακινήτου από συγκρίσιμα ακίνητα που πληρούν τα κριτήρια ομοιότητας του συστήματος. Δεν αποτελεί πιστοποιημένη εκτίμηση.",
  alternates: { canonical: "/valuation" },
};

export default function ValuationPage() {
  return (
    <div className="wrap section">
      <h1>Εκτίμηση ακινήτου</h1>
      <p className="lede" style={{ maxWidth: 760 }}>
        Περιγράψτε το ακίνητο σε τρία σύντομα βήματα. Η ενδεικτική αξία υπολογίζεται από συγκρίσιμα ακίνητα και
        διαθέσιμα δεδομένα της αγοράς που πληρούν τα κριτήρια ομοιότητας του συστήματος.
      </p>

      <div className="grid grid--2 valuation-layout" style={{ alignItems: "start", gap: 32 }}>
        <ValuationWizard />
        <aside>
          <figure className="page-figure" style={{ marginTop: 0 }}>
            <img
              src="/images/fox/fox-office-plans.webp"
              width={758}
              height={504}
              alt="Η αλεπού της HOME88 στο γραφείο, με κατόψεις και φωτογραφίες ακινήτων και θέα στην Ακρόπολη"
              loading="lazy"
              decoding="async"
            />
          </figure>
          <div className="notice">
            <strong>Σημαντικό:</strong> το αποτέλεσμα είναι ενδεικτικό εύρος τιμών και όχι πιστοποιημένη εκτίμηση ούτε
            προσφορά. Όταν δεν υπάρχουν αρκετά αξιόπιστα συγκρίσιμα στοιχεία, δεν εμφανίζουμε αριθμό. Για επίσημη
            εκτίμηση, ζητήστε επικοινωνία με σύμβουλο.
          </div>
        </aside>
      </div>
    </div>
  );
}
