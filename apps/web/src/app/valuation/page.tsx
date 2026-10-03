import type { Metadata } from "next";

import { LeadForm } from "@/components/LeadForm";
import { estimateFromDatabase } from "@/lib/valuation";
import { valuationInputSchema } from "@home88/validation";

export const metadata: Metadata = {
  title: "Εκτίμηση ακινήτου",
  description:
    "Ενδεικτική εκτίμηση της αξίας ενός ακινήτου, βασισμένη σε πραγματικές συγκρίσιμες αγγελίες. Δεν αποτελεί πιστοποιημένη εκτίμηση.",
  alternates: { canonical: "/valuation" },
};

type RawParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function eur(v: number): string {
  return new Intl.NumberFormat("el-GR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(v);
}

const TYPE_OPTIONS: Array<[string, string]> = [
  ["APARTMENT", "Διαμέρισμα"],
  ["MAISONETTE", "Μεζονέτα"],
  ["HOUSE", "Μονοκατοικία"],
  ["VILLA", "Βίλα"],
  ["STUDIO", "Στούντιο"],
  ["OFFICE", "Γραφείο"],
  ["SHOP", "Κατάστημα"],
  ["WAREHOUSE", "Αποθήκη"],
  ["BUILDING", "Κτίριο"],
  ["HOTEL", "Ξενοδοχείο"],
  ["LAND", "Γη"],
  ["PLOT", "Οικόπεδο"],
  ["PARKING", "Parking"],
  ["INDUSTRIAL", "Βιομηχανικό"],
  ["OTHER", "Άλλο"],
];

const CONDITION_OPTIONS: Array<[string, string]> = [
  ["NEW_BUILD", "Νέα κατασκευή"],
  ["RENOVATED", "Ανακαινισμένο"],
  ["GOOD", "Καλή κατάσταση"],
  ["NEEDS_RENOVATION", "Χρειάζεται ανακαίνιση"],
  ["UNDER_CONSTRUCTION", "Υπό κατασκευή"],
];

const FEATURES: Array<[string, string]> = [
  ["parking", "Parking"],
  ["storage", "Αποθήκη"],
  ["balcony", "Μπαλκόνι"],
  ["garden", "Κήπος"],
  ["pool", "Πισίνα"],
  ["seaView", "Θέα θάλασσα"],
  ["furnished", "Επιπλωμένο"],
  ["hasSolar", "Φωτοβολταϊκά"],
];

export default async function ValuationPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const raw = await searchParams;
  const submitted = first(raw.area) != null;

  const candidate: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) candidate[k] = first(v);
  const parsed = submitted ? valuationInputSchema.safeParse(candidate) : null;

  const outcome =
    parsed && parsed.success ? await estimateFromDatabase(parsed.data) : null;

  return (
    <div className="wrap section">
      <h1>Εκτίμηση ακινήτου</h1>
      <p className="lede" style={{ maxWidth: 760 }}>
        Συμπληρώστε τα βασικά στοιχεία του ακινήτου και θα δείτε μια ενδεικτική
        τιμή, υπολογισμένη από πραγματικές συγκρίσιμες αγγελίες της περιοχής.
      </p>

      <figure className="page-figure">
        <img
          src="/images/fox/fox-office-plans.webp"
          width={758}
          height={504}
          alt="Η αλεπού της HOME88 στο γραφείο, με κατόψεις και φωτογραφίες ακινήτων και θέα στην Ακρόπολη"
          loading="lazy"
          decoding="async"
        />
      </figure>

      <div className="notice" style={{ maxWidth: 760, marginBottom: 24 }}>
        <strong>Σημαντικό:</strong> το αποτέλεσμα είναι ενδεικτικό και βασίζεται
        σε στατιστικά στοιχεία της αγοράς. Δεν αποτελεί πιστοποιημένη εκτίμηση
        ούτε προσφορά. Για επίσημη εκτίμηση, επικοινωνήστε μαζί μας.
      </div>

      <div className="grid grid--2" style={{ alignItems: "start", gap: 32 }}>
        <form action="/valuation" method="get" className="searchpanel" style={{ marginTop: 0 }}>
          <div className="grid grid--2" style={{ gap: 0 }}>
            <div className="field">
              <label htmlFor="v-type">Τύπος ακινήτου *</label>
              <select id="v-type" name="propertyType" className="select" defaultValue={first(raw.propertyType) ?? "APARTMENT"}>
                {TYPE_OPTIONS.map(([value, text]) => (
                  <option key={value} value={value}>{text}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="v-area">Εμβαδόν (τ.μ.) *</label>
              <input id="v-area" name="area" className="input" inputMode="numeric" required defaultValue={first(raw.area) ?? ""} />
            </div>
          </div>

          <div className="grid grid--2" style={{ gap: 0 }}>
            <div className="field">
              <label htmlFor="v-city">Πόλη</label>
              <input id="v-city" name="city" className="input" defaultValue={first(raw.city) ?? ""} />
            </div>
            <div className="field">
              <label htmlFor="v-areaName">Περιοχή</label>
              <input id="v-areaName" name="areaName" className="input" defaultValue={first(raw.areaName) ?? ""} />
            </div>
          </div>

          <div className="grid grid--2" style={{ gap: 0 }}>
            <div className="field">
              <label htmlFor="v-condition">Κατάσταση</label>
              <select id="v-condition" name="condition" className="select" defaultValue={first(raw.condition) ?? "GOOD"}>
                {CONDITION_OPTIONS.map(([value, text]) => (
                  <option key={value} value={value}>{text}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="v-yearBuilt">Έτος κατασκευής</label>
              <input id="v-yearBuilt" name="yearBuilt" className="input" inputMode="numeric" defaultValue={first(raw.yearBuilt) ?? ""} />
            </div>
          </div>

          <div className="grid grid--2" style={{ gap: 0 }}>
            <div className="field">
              <label htmlFor="v-floor">Όροφος</label>
              <input id="v-floor" name="floor" className="input" inputMode="numeric" defaultValue={first(raw.floor) ?? ""} />
            </div>
            <div className="field">
              <label htmlFor="v-totalFloors">Σύνολο ορόφων</label>
              <input id="v-totalFloors" name="totalFloors" className="input" inputMode="numeric" defaultValue={first(raw.totalFloors) ?? ""} />
            </div>
          </div>

          <fieldset style={{ border: 0, padding: 0, margin: "4px 0 0" }}>
            <legend style={{ fontWeight: 700, marginBottom: 10 }}>Χαρακτηριστικά</legend>
            <div className="row" style={{ gap: 18 }}>
              {FEATURES.map(([name, text]) => (
                <label className="check" key={name} style={{ margin: 0 }}>
                  <input type="checkbox" name={name} value="true" defaultChecked={first(raw[name]) === "true"} />
                  <span>{text}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <button type="submit" className="btn btn--primary btn--lg" style={{ marginTop: 16 }}>
            Υπολογισμός ενδεικτικής αξίας
          </button>
        </form>

        <aside>
          {submitted && parsed && !parsed.success && (
            <div className="notice notice--danger" role="alert">
              Ελέγξτε τα στοιχεία που συμπληρώσατε (π.χ. έγκυρο εμβαδόν σε τ.μ.).
            </div>
          )}

          {outcome && outcome.result.ok && (
            <div className="searchpanel" style={{ marginTop: 0 }}>
              <h2 style={{ marginTop: 0 }}>Ενδεικτική αξία</h2>
              <div style={{ fontSize: "1.9rem", fontWeight: 800, marginBlock: 8 }}>
                {eur(outcome.result.estimate)}
              </div>
              <p className="muted" style={{ marginTop: -4 }}>
                Εύρος {eur(outcome.result.low)} – {eur(outcome.result.high)} ·{" "}
                {eur(outcome.result.pricePerSqm)}/τ.μ.
              </p>
              <p className="muted" style={{ fontSize: "0.85rem" }}>
                Βάση υπολογισμού: {outcome.result.comparableCount} συγκρίσιμες αγγελίες.
                Αξιοπιστία:{" "}
                {outcome.result.confidence === "high"
                  ? "υψηλή"
                  : outcome.result.confidence === "medium"
                    ? "μέτρια"
                    : "χαμηλή"}
                .
              </p>

              <h3 style={{ fontSize: "1rem" }}>Προσαρμογές</h3>
              {outcome.result.adjustments.length === 0 ? (
                <p className="muted" style={{ fontSize: "0.88rem" }}>
                  Δεν δόθηκαν επιπλέον χαρακτηριστικά — χρησιμοποιήθηκε ο μέσος όρος της αγοράς.
                </p>
              ) : (
                <ul className="muted" style={{ fontSize: "0.9rem", paddingLeft: 18 }}>
                  {outcome.result.adjustments.map((a) => (
                    <li key={a.label}>
                      {a.label}: {a.factor > 0 ? "+" : ""}
                      {(a.factor * 100).toFixed(0)}%
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {outcome && !outcome.result.ok && (
            <div className="notice">
              <strong>Δεν υπάρχουν αρκετά δεδομένα.</strong>
              <p style={{ margin: "6px 0 0" }}>
                Χρειάζονται τουλάχιστον {outcome.result.required} συγκρίσιμες αγγελίες
                (βρέθηκαν {outcome.result.comparableCount}). Δοκιμάστε μεγαλύτερη
                περιοχή ή ζητήστε επίσημη εκτίμηση παρακάτω.
              </p>
            </div>
          )}

          <div className="searchpanel">
            <h2 style={{ fontSize: "1.15rem" }}>Θέλετε επίσημη εκτίμηση;</h2>
            <p className="muted" style={{ fontSize: "0.9rem" }}>
              Αφήστε τα στοιχεία σας και ένας σύμβουλος θα επικοινωνήσει μαζί σας.
            </p>
            <LeadForm kind="valuation" />
          </div>
        </aside>
      </div>
    </div>
  );
}
