"use client";

import { useMemo, useState } from "react";
import { profileFor } from "@home88/domain";

import { LeadForm } from "@/components/LeadForm";
import { newIdempotencyKey } from "@/lib/intake-client";

/**
 * Guided indicative valuation: property type → core details → type-specific
 * details → result. Fields follow the same property profiles as the CRM, so a
 * plot is never asked for a floor. The browser only describes the property;
 * the server computes and stores the result.
 */

const TYPES: Array<[string, string]> = [
  ["APARTMENT", "Διαμέρισμα"], ["MAISONETTE", "Μεζονέτα"], ["HOUSE", "Μονοκατοικία"], ["VILLA", "Βίλα"],
  ["STUDIO", "Στούντιο"], ["OFFICE", "Γραφείο"], ["SHOP", "Κατάστημα"], ["WAREHOUSE", "Αποθήκη"],
  ["BUILDING", "Κτίριο"], ["HOTEL", "Ξενοδοχείο"], ["LAND", "Γη"], ["PLOT", "Οικόπεδο"],
  ["PARKING", "Parking"], ["INDUSTRIAL", "Βιομηχανικό"],
];
const TYPE_LABEL = Object.fromEntries(TYPES);
const CONDITIONS: Array<[string, string]> = [
  ["NEW_BUILD", "Νέα κατασκευή"], ["RENOVATED", "Ανακαινισμένο"], ["GOOD", "Καλή κατάσταση"],
  ["NEEDS_RENOVATION", "Χρειάζεται ανακαίνιση"], ["UNDER_CONSTRUCTION", "Υπό κατασκευή"],
];
const FEATURES: Array<[string, string]> = [
  ["parking", "Parking"], ["storage", "Αποθήκη"], ["balcony", "Μπαλκόνι"], ["elevator", "Ανελκυστήρας"],
  ["garden", "Κήπος"], ["pool", "Πισίνα"], ["seaView", "Θέα θάλασσα"],
];
const REGIONS = [
  "Αττική", "Κεντρική Μακεδονία", "Δυτική Μακεδονία", "Ανατολική Μακεδονία και Θράκη", "Ήπειρος", "Θεσσαλία",
  "Ιόνια Νησιά", "Δυτική Ελλάδα", "Στερεά Ελλάδα", "Πελοπόννησος", "Βόρειο Αιγαίο", "Νότιο Αιγαίο", "Κρήτη",
];
const LAND = new Set(["LAND", "PLOT"]);

type PublicValuation =
  | {
      status: "OK";
      low: number; midpoint: number; high: number;
      pricePerSqm: number; pricePerSqmLow: number; pricePerSqmHigh: number;
      confidence: "LOW" | "MEDIUM" | "HIGH"; confidenceReasons: string[];
      comparableCount: number; strongComparableCount: number; transactionCount: number; askingCount: number;
      scope: "AREA" | "CITY" | "REGION"; sizeRange: [number, number];
    }
  | { status: "INSUFFICIENT_DATA"; comparableCount: number; required: number };

const eur = (v: number) => new Intl.NumberFormat("el-GR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v);
const int = (v: number) => new Intl.NumberFormat("el-GR", { maximumFractionDigits: 0 }).format(v);
const CONFIDENCE: Record<string, { label: string; level: number }> = {
  HIGH: { label: "Υψηλή", level: 3 },
  MEDIUM: { label: "Μέτρια", level: 2 },
  LOW: { label: "Χαμηλή", level: 1 },
};

export function ValuationWizard() {
  const [step, setStep] = useState(1);
  const [values, setValues] = useState<Record<string, string>>({ propertyType: "", condition: "GOOD" });
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [renderedAt] = useState(() => Date.now());
  const [idempotencyKey, setKey] = useState(() => newIdempotencyKey());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; fields?: Record<string, string[]> } | null>(null);
  const [result, setResult] = useState<{ requestId: string | null; valuation: PublicValuation; snapshot: Record<string, string> } | null>(null);

  const type = values.propertyType ?? "";
  const profile = useMemo(() => profileFor(type), [type]);
  const has = (field: string) => profile.core.includes(field);
  const features = FEATURES.filter(([key]) => profile.features.includes(key));
  const set = (name: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setValues((v) => ({ ...v, [name]: e.target.value }));
  const fieldError = (name: string) => error?.fields?.[name]?.[0];

  const canContinue2 = Number(values.area) >= 10 && Boolean(values.city?.trim() || values.areaName?.trim());

  async function calculate() {
    setBusy(true);
    setError(null);
    const payload: Record<string, unknown> = { ...values, hpt: String(renderedAt), hpl: values.hpl ?? "", idempotencyKey };
    for (const [key] of features) payload[key] = Boolean(flags[key]);
    try {
      const response = await fetch("/api/valuation/estimate", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => null)) as
        | { ok: true; requestId: string | null; valuation: PublicValuation }
        | { ok: false; code?: string; message?: string; fields?: Record<string, string[]> }
        | null;
      if (!response.ok || !data || !data.ok) {
        setError({ message: (data && !data.ok && data.message) || "Ο υπολογισμός δεν ήταν δυνατός. Δοκιμάστε ξανά.", fields: data && !data.ok ? data.fields : undefined });
        return;
      }
      setResult({ requestId: data.requestId, valuation: data.valuation, snapshot: { ...values } });
      setStep(4);
    } catch {
      setError({ message: "Δεν ήταν δυνατή η σύνδεση. Ελέγξτε τη σύνδεσή σας και δοκιμάστε ξανά." });
    } finally {
      setBusy(false);
    }
  }

  function restart() {
    setResult(null);
    setKey(newIdempotencyKey());
    setStep(2);
  }

  return (
    <div className="valuation">
      <ol className="valuation__steps" aria-label="Βήματα">
        {["Ακίνητο", "Στοιχεία", "Χαρακτηριστικά", "Αποτέλεσμα"].map((label, i) => (
          <li key={label} aria-current={step === i + 1 ? "step" : undefined} className={step > i + 1 ? "is-done" : undefined}>
            <span>{i + 1}</span> {label}
          </li>
        ))}
      </ol>

      {/* Honeypot: invisible to people, filled by bots. */}
      <div className="hp-field" aria-hidden="true">
        <label htmlFor="v-hpl">Website</label>
        <input id="v-hpl" name="hpl" tabIndex={-1} autoComplete="off" value={values.hpl ?? ""} onChange={set("hpl")} />
      </div>

      {step === 1 && (
        <section className="searchpanel valuation__panel" aria-labelledby="v-step1">
          <h2 id="v-step1">Τι ακίνητο θέλετε να εκτιμήσετε;</h2>
          <div className="valuation__types">
            {TYPES.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={type === value ? "valuation__type is-selected" : "valuation__type"}
                aria-pressed={type === value}
                onClick={() => {
                  setValues((v) => ({ ...v, propertyType: value }));
                  setStep(2);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="searchpanel valuation__panel" aria-labelledby="v-step2">
          <h2 id="v-step2">{TYPE_LABEL[type]}: βασικά στοιχεία</h2>
          <div className="grid grid--2" style={{ gap: 0 }}>
            <div className="field">
              <label htmlFor="v-area">{LAND.has(type) ? "Εμβαδόν γης (τ.μ.) *" : (profile.labels?.area ?? "Εμβαδόν (τ.μ.)") + " *"}</label>
              <input id="v-area" className="input" inputMode="decimal" value={values.area ?? ""} onChange={set("area")} required aria-invalid={Boolean(fieldError("area"))} />
              {fieldError("area") && <p className="error">{fieldError("area")}</p>}
            </div>
            <div className="field">
              <label htmlFor="v-region">Περιφέρεια</label>
              <input id="v-region" className="input" list="v-regions" value={values.region ?? ""} onChange={set("region")} />
              <datalist id="v-regions">{REGIONS.map((r) => <option key={r} value={r} />)}</datalist>
            </div>
            <div className="field">
              <label htmlFor="v-city">Πόλη / Δήμος *</label>
              <input id="v-city" className="input" placeholder="π.χ. Γλυφάδα" value={values.city ?? ""} onChange={set("city")} aria-invalid={Boolean(fieldError("city"))} />
              {fieldError("city") && <p className="error">{fieldError("city")}</p>}
            </div>
            <div className="field">
              <label htmlFor="v-areaName">Περιοχή / Γειτονιά</label>
              <input id="v-areaName" className="input" placeholder="π.χ. Άνω Γλυφάδα" value={values.areaName ?? ""} onChange={set("areaName")} />
            </div>
            {profile.conditions && (
              <div className="field">
                <label htmlFor="v-condition">Κατάσταση</label>
                <select id="v-condition" className="select" value={values.condition ?? ""} onChange={set("condition")}>
                  {CONDITIONS.filter(([c]) => profile.conditions?.includes(c as never)).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            )}
            {has("yearBuilt") && (
              <div className="field">
                <label htmlFor="v-yearBuilt">Έτος κατασκευής</label>
                <input id="v-yearBuilt" className="input" inputMode="numeric" value={values.yearBuilt ?? ""} onChange={set("yearBuilt")} />
                {fieldError("yearBuilt") && <p className="error">{fieldError("yearBuilt")}</p>}
              </div>
            )}
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button type="button" className="btn btn--outline" onClick={() => setStep(1)}>Πίσω</button>
            <button type="button" className="btn btn--primary" disabled={!canContinue2} onClick={() => setStep(3)}>Συνέχεια</button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="searchpanel valuation__panel" aria-labelledby="v-step3">
          <h2 id="v-step3">{profile.title}</h2>
          <div className="grid grid--2" style={{ gap: 0 }}>
            {has("bedrooms") && (
              <div className="field">
                <label htmlFor="v-bedrooms">Υπνοδωμάτια</label>
                <input id="v-bedrooms" className="input" inputMode="numeric" value={values.bedrooms ?? ""} onChange={set("bedrooms")} />
              </div>
            )}
            {has("bathrooms") && (
              <div className="field">
                <label htmlFor="v-bathrooms">{profile.labels?.bathrooms ?? "Μπάνια"}</label>
                <input id="v-bathrooms" className="input" inputMode="numeric" value={values.bathrooms ?? ""} onChange={set("bathrooms")} />
              </div>
            )}
            {has("floor") && (
              <div className="field">
                <label htmlFor="v-floor">{profile.labels?.floor ?? "Όροφος"}</label>
                <input id="v-floor" className="input" inputMode="numeric" placeholder="0 = ισόγειο" value={values.floor ?? ""} onChange={set("floor")} />
              </div>
            )}
            {has("totalFloors") && (
              <div className="field">
                <label htmlFor="v-totalFloors">Σύνολο ορόφων κτιρίου</label>
                <input id="v-totalFloors" className="input" inputMode="numeric" value={values.totalFloors ?? ""} onChange={set("totalFloors")} />
              </div>
            )}
          </div>
          {features.length > 0 && (
            <fieldset style={{ border: 0, padding: 0, margin: "4px 0 0" }}>
              <legend style={{ fontWeight: 700, marginBottom: 10 }}>Χαρακτηριστικά</legend>
              <div className="row" style={{ gap: 18 }}>
                {features.map(([key, label]) => (
                  <label className="check" key={key} style={{ margin: 0 }}>
                    <input type="checkbox" checked={Boolean(flags[key])} onChange={(e) => setFlags((f) => ({ ...f, [key]: e.target.checked }))} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {error && <div className="notice notice--danger" role="alert" style={{ marginTop: 14 }}>{error.message}</div>}
          <div className="row" style={{ marginTop: 16 }}>
            <button type="button" className="btn btn--outline" onClick={() => setStep(2)}>Πίσω</button>
            <button type="button" className="btn btn--primary btn--lg" disabled={busy} onClick={() => void calculate()}>
              {busy ? "Υπολογισμός…" : "Υπολογισμός ενδεικτικής αξίας"}
            </button>
          </div>
        </section>
      )}

      {step === 4 && result && (
        <>
          {result.valuation.status === "OK" ? (
            <ValuationResult v={result.valuation} input={result.snapshot} />
          ) : (
            <section className="searchpanel valuation__panel" aria-live="polite">
              <h2>Δεν υπάρχουν αρκετά αξιόπιστα στοιχεία</h2>
              <p>
                Δεν υπάρχουν αρκετά αξιόπιστα συγκρίσιμα στοιχεία για ασφαλή αυτόματο υπολογισμό
                {result.valuation.comparableCount > 0 ? ` (βρέθηκαν ${result.valuation.comparableCount}, χρειάζονται τουλάχιστον ${result.valuation.required})` : ""}.
                Αφήστε τα στοιχεία σας για εξατομικευμένη εκτίμηση από σύμβουλο της HOME88.
              </p>
            </section>
          )}
          <section className="searchpanel valuation__panel">
            <h2 style={{ fontSize: "1.2rem" }}>Θέλετε επίσημη, εξατομικευμένη εκτίμηση;</h2>
            <p className="muted" style={{ fontSize: "0.92rem" }}>
              Ένας σύμβουλος της HOME88 θα δει το ακίνητο και θα σας προτείνει πώς να τοποθετηθεί σωστά στην αγορά.
            </p>
            <LeadForm kind="valuation" valuationRequestId={result.requestId ?? undefined} />
          </section>
          <button type="button" className="btn btn--ghost" onClick={restart}>Αλλαγή στοιχείων</button>
        </>
      )}
    </div>
  );
}

function ValuationResult({ v, input }: { v: Extract<PublicValuation, { status: "OK" }>; input: Record<string, string> }) {
  const where = v.scope === "AREA" ? input.areaName || input.city : v.scope === "CITY" ? `ευρύτερη περιοχή: ${input.city}` : `ευρύτερη περιφέρεια${input.region ? `: ${input.region}` : ""}`;
  const deals = v.transactionCount === 1 ? "1 ολοκληρωμένη συναλλαγή" : `${v.transactionCount} ολοκληρωμένες συναλλαγές`;
  const ads = v.askingCount === 1 ? "1 τρέχουσα αγγελία" : `${v.askingCount} τρέχουσες αγγελίες`;
  const basis =
    v.transactionCount > 0 && v.askingCount > 0 ? `${deals} και ${ads}` : v.transactionCount > 0 ? deals : `${ads} (ζητούμενες τιμές)`;
  const conf = CONFIDENCE[v.confidence] ?? CONFIDENCE.LOW!;
  return (
    <section className="searchpanel valuation__panel valuation__result" aria-live="polite">
      <p className="valuation__eyebrow">Η ενδεικτική αξία του ακινήτου σας</p>
      <p className="valuation__range">
        {eur(v.low)} – {eur(v.high)}
      </p>
      <p className="valuation__mid">
        Κεντρική ένδειξη <strong>{eur(v.midpoint)}</strong> · {int(v.pricePerSqm)} €/τ.μ.
      </p>

      <div className="valuation__confidence">
        <span>Αξιοπιστία εκτίμησης</span>
        <span className="valuation__meter" aria-hidden="true">
          {[1, 2, 3].map((i) => <i key={i} className={i <= conf.level ? "is-on" : undefined} />)}
        </span>
        <strong>{conf.label}</strong>
      </div>

      <h3>Πώς υπολογίστηκε</h3>
      <ul className="valuation__facts">
        <li>
          {v.comparableCount} συγκρίσιμα ακίνητα, {v.strongComparableCount} υψηλής ομοιότητας
        </li>
        <li>Βάση: {basis}</li>
        <li>Περιοχή αναζήτησης: {where}</li>
        <li>
          {TYPE_LABEL[input.propertyType ?? ""] ?? "Ακίνητα"} {int(v.sizeRange[0])}–{int(v.sizeRange[1])} τ.μ.
        </li>
        <li>Εύρος συγκρίσιμων τιμών: {int(v.pricePerSqmLow)} – {int(v.pricePerSqmHigh)} €/τ.μ.</li>
      </ul>
      {v.confidenceReasons.length > 0 && (
        <p className="muted" style={{ fontSize: "0.86rem" }}>Περιορισμοί: {v.confidenceReasons.join(" · ")}.</p>
      )}
      <p className="muted valuation__disclaimer">
        Η εκτίμηση είναι ενδεικτική και δεν αποτελεί πιστοποιημένη εκτίμηση ούτε προσφορά. Υπολογίζεται από συγκρίσιμα
        ακίνητα που πληρούν τα κριτήρια ομοιότητας του συστήματος
        {v.askingCount > 0 ? "· οι τιμές αγγελιών είναι ζητούμενες τιμές και όχι τιμές πώλησης" : ""}.
      </p>
    </section>
  );
}
