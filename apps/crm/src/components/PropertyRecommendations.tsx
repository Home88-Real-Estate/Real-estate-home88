import { DISTRIBUTION_STATUS_LABELS, FIT_LABELS, type FitLevel, type Recommendation } from "@home88/domain";

import { apiFetch } from "@/lib/api";

type Payload = { data: Recommendation[]; counts: Record<FitLevel, number> };

const FIT_BADGE: Record<FitLevel, string> = { STRONG: "badge badge--ok", POSSIBLE: "badge badge--info", NEEDS_INFO: "badge badge--warn", LOW: "badge badge--muted", NOT_ELIGIBLE: "badge badge--muted" };

function Row({ r }: { r: Recommendation }) {
  return (
    <li className="pubchan">
      <div className="pubchan__head">
        <strong>{r.name}</strong>
        <span className={FIT_BADGE[r.fit]}>{FIT_LABELS[r.fit]}</span>
        <span className="badge badge--muted">{r.country === "INT" ? "Διεθνές" : r.country}</span>
        <span className="badge badge--muted">{DISTRIBUTION_STATUS_LABELS[r.connection]}</span>
      </div>
      <div className="pubchan__body">
        <p>{r.summary}</p>
        <details>
          <summary>Γιατί αυτή η πρόταση;</summary>
          {r.matches.length > 0 && <><p className="hint">Ταιριάζει:</p><ul>{r.matches.map((m) => <li key={m}>{m}</li>)}</ul></>}
          {r.constraints.length > 0 && <><p className="hint">Εμπόδια:</p><ul className="pubchan__blockers">{r.constraints.map((m) => <li key={m}>{m}</li>)}</ul></>}
          {r.notes.length > 0 && <><p className="hint">Σημειώσεις:</p><ul>{r.notes.map((m) => <li key={m}>{m}</li>)}</ul></>}
          <p className="hint">Βάση: κανόνες πάνω σε επιβεβαιωμένα στοιχεία. Πραγματική απόδοση (προβολές, επαφές): μη διαθέσιμη.</p>
        </details>
      </div>
    </li>
  );
}

/**
 * Where this property fits, and why. Suitability only: the page says outright
 * that no measured results back it, so a recommendation is never read as a forecast.
 */
export async function PropertyRecommendations({ propertyId }: { propertyId: string }) {
  const res = await apiFetch<Payload>(`/api/properties/${encodeURIComponent(propertyId)}/recommendations`);
  if (!res.ok) return null;
  const main = res.data.data.filter((r) => r.fit === "STRONG" || r.fit === "POSSIBLE" || r.fit === "NEEDS_INFO");
  const rest = res.data.data.filter((r) => r.fit === "LOW" || r.fit === "NOT_ELIGIBLE");
  const c = res.data.counts;
  return (
    <div className="panel" id="recommendations">
      <div className="panel__head">
        <div>
          <h2>Προτάσεις πυλών</h2>
          <p className="panel__sub">
            Συμβατότητα με βάση επιβεβαιωμένα στοιχεία: {c.STRONG} ισχυρή · {c.POSSIBLE} πιθανή · {c.NEEDS_INFO} χρειάζονται πληροφορίες · {c.LOW + c.NOT_ELIGIBLE} χαμηλής προτεραιότητας.
            Δεν αποτελεί πρόβλεψη πωλήσεων· δεν υπάρχουν ακόμη μετρημένα αποτελέσματα ανά portal.
          </p>
        </div>
      </div>
      <ul className="pubchannels">{main.map((r) => <Row key={r.key} r={r} />)}</ul>
      {rest.length > 0 && <details><summary>Χαμηλής προτεραιότητας ({rest.length})</summary><ul className="pubchannels">{rest.map((r) => <Row key={r.key} r={r} />)}</ul></details>}
    </div>
  );
}
