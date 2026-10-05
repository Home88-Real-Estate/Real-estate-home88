import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CONDITION_LABELS } from "@home88/domain";
import { PROPERTY_TYPE_LABELS, label } from "@home88/types";

import { assignRequest, openAgentValuation, setRequestStage } from "@/actions/valuation-requests";
import { apiFetch } from "@/lib/api";
import { formatArea, formatDateTime, formatMoney } from "@/lib/format";
import { requireRole } from "@/lib/session";
import { hasRole } from "@/lib/user";
import { CONFIDENCE_LABEL, DIMENSION_LABEL, REQUEST_STAGE_LABELS, SCOPE_LABEL } from "@/lib/valuation-requests";

export const metadata: Metadata = { title: "Αίτημα εκτίμησης" };

type Comparable = {
  id: string;
  rank: number;
  source: string;
  observationType: string;
  tier: string;
  propertyId: string | null;
  price: number;
  areaSqm: number;
  pricePerSqm: number;
  similarity: number;
  recency: number;
  weight: number;
  ageMonths: number;
  breakdown: Record<string, number>;
  outlier: boolean;
  snapshot: Record<string, unknown>;
};
type Detail = {
  id: string;
  reference: string;
  status: string;
  stage: string;
  subject: {
    propertyType: string; region: string | null; city: string | null; areaName: string | null; areaSqm: number;
    bedrooms: number | null; bathrooms: number | null; floor: number | null; yearBuilt: number | null; condition: string | null;
    features: Record<string, boolean>;
  };
  result: {
    estimatedMin: number | null; estimatedValue: number | null; estimatedMax: number | null;
    pricePerSqm: number | null; pricePerSqmLow: number | null; pricePerSqmHigh: number | null;
    confidence: string | null; comparableCount: number; strongComparableCount: number; transactionCount: number; askingCount: number;
    scope: string | null; explanation: { confidenceReasons?: string[]; outliersRemoved?: number; tierCounts?: Record<string, number>; reason?: string; required?: number };
  };
  engineVersion: string;
  methodologyVersion: string;
  referenceDate: string;
  contact: { id: string; name: string } | null;
  lead: { id: string; reference: string; status: string } | null;
  agentValuation: { id: string; reference: string; status: string; recommendedPrice: number | null } | null;
  assignedAgent: { id: string; name: string } | null;
  createdAt: string;
  comparables: Comparable[];
};

const FEATURE_LABEL: Record<string, string> = { parking: "Parking", storage: "Αποθήκη", balcony: "Μπαλκόνι", elevator: "Ανελκυστήρας", garden: "Κήπος", pool: "Πισίνα", seaView: "Θέα θάλασσα" };
const pct = (v: number) => `${Math.round(v * 100)}%`;

export default async function ValuationRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("AGENT");
  const { id } = await params;
  const res = await apiFetch<{ request: Detail }>(`/api/valuation-requests/${encodeURIComponent(id)}`);
  if (!res.ok) {
    if (res.status === 404) notFound();
    return <div className="notice notice--danger">{res.error.message}</div>;
  }
  const r = res.data.request;
  const manager = hasRole(user.role, "MANAGER");
  const users = manager ? await apiFetch<{ data: Array<{ id: string; firstName: string; lastName: string; status: string }> }>("/api/users", { query: { page: 1 } }) : null;
  const s = r.subject;
  const features = Object.entries(s.features ?? {}).filter(([, on]) => on).map(([k]) => FEATURE_LABEL[k] ?? k);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted" style={{ margin: 0 }}><Link href="/valuations/requests">Εκτιμήσεις από τον ιστότοπο</Link></p>
          <h1 className="mono">{r.reference}</h1>
          <p className="muted">
            {formatDateTime(r.createdAt)} · {REQUEST_STAGE_LABELS[r.stage] ?? r.stage}
            {r.contact ? <> · Πελάτης: <Link href={`/contacts/${r.contact.id}`}>{r.contact.name}</Link></> : " · Ανώνυμη εκτίμηση (χωρίς στοιχεία επικοινωνίας)"}
            {r.lead ? <> · Lead <Link href={`/leads/${r.lead.id}`} className="mono">{r.lead.reference}</Link></> : null}
          </p>
        </div>
        <div className="row">
          {r.agentValuation ? (
            <Link href={`/valuations/${r.agentValuation.id}`} className="btn btn--primary">Εκτίμηση συμβούλου {r.agentValuation.reference}</Link>
          ) : (
            <form action={openAgentValuation}>
              <input type="hidden" name="id" value={r.id} />
              <button className="btn btn--primary">Εκτίμηση συμβούλου</button>
            </form>
          )}
        </div>
      </div>

      <div className="grid grid--2" style={{ alignItems: "start" }}>
        <section className="panel">
          <h2>Αυτόματη ένδειξη</h2>
          {r.status === "COMPLETED" ? (
            <>
              <p style={{ fontSize: "1.6rem", fontWeight: 800, margin: "4px 0" }}>
                {formatMoney(r.result.estimatedMin)} – {formatMoney(r.result.estimatedMax)}
              </p>
              <p className="muted">
                Κεντρική ένδειξη <strong>{formatMoney(r.result.estimatedValue)}</strong> · {r.result.pricePerSqm} €/τ.μ. (εύρος {r.result.pricePerSqmLow}–{r.result.pricePerSqmHigh})
              </p>
              <dl className="dl">
                <dt>Αξιοπιστία</dt><dd>{CONFIDENCE_LABEL[r.result.confidence ?? ""] ?? "—"}{r.result.explanation.confidenceReasons?.length ? ` — ${r.result.explanation.confidenceReasons.join(" · ")}` : ""}</dd>
                <dt>Συγκριτικά</dt><dd>{r.result.comparableCount} ({r.result.strongComparableCount} υψηλής ομοιότητας) · {r.result.transactionCount} συναλλαγές, {r.result.askingCount} αγγελίες</dd>
                <dt>Εύρος αναζήτησης</dt><dd>{SCOPE_LABEL[r.result.scope ?? ""] ?? "—"}{r.result.explanation.tierCounts ? ` (διαθέσιμα: περιοχή ${r.result.explanation.tierCounts.AREA ?? 0}, πόλη ${r.result.explanation.tierCounts.CITY ?? 0}, περιφέρεια ${r.result.explanation.tierCounts.REGION ?? 0})` : ""}</dd>
                <dt>Ακραίες τιμές</dt><dd>{r.result.explanation.outliersRemoved ?? 0} εξαιρέθηκαν</dd>
              </dl>
            </>
          ) : (
            <p className="notice">
              Ανεπαρκή στοιχεία: βρέθηκαν {r.result.comparableCount} κατάλληλα συγκριτικά (χρειάζονται {r.result.explanation.required ?? "—"}). Δεν δόθηκε αριθμός στον επισκέπτη.
            </p>
          )}
          <p className="muted" style={{ fontSize: "0.82rem" }}>
            Μηχανή {r.engineVersion} · μεθοδολογία {r.methodologyVersion} · δεδομένα έως {formatDateTime(r.referenceDate)}. Η αυτόματη ένδειξη δεν αλλάζει· η άποψη του συμβούλου καταγράφεται στην εκτίμηση συμβούλου.
          </p>
        </section>

        <section className="panel">
          <h2>Ακίνητο</h2>
          <dl className="dl">
            <dt>Τύπος</dt><dd>{label(PROPERTY_TYPE_LABELS, s.propertyType, "el")}</dd>
            <dt>Εμβαδόν</dt><dd>{formatArea(s.areaSqm)}</dd>
            <dt>Τοποθεσία</dt><dd>{[s.areaName, s.city, s.region].filter(Boolean).join(", ") || "—"}</dd>
            {s.bedrooms != null && <><dt>Υπνοδωμάτια</dt><dd>{s.bedrooms}</dd></>}
            {s.bathrooms != null && <><dt>Μπάνια</dt><dd>{s.bathrooms}</dd></>}
            {s.floor != null && <><dt>Όροφος</dt><dd>{s.floor}</dd></>}
            {s.yearBuilt != null && <><dt>Έτος κατασκευής</dt><dd>{s.yearBuilt}</dd></>}
            {s.condition && <><dt>Κατάσταση</dt><dd>{CONDITION_LABELS[s.condition as keyof typeof CONDITION_LABELS] ?? s.condition}</dd></>}
            {features.length > 0 && <><dt>Χαρακτηριστικά</dt><dd>{features.join(", ")}</dd></>}
          </dl>

          <h3 style={{ marginTop: 18 }}>Ροή εργασίας</h3>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <form action={setRequestStage} className="row" style={{ gap: 6 }}>
              <input type="hidden" name="id" value={r.id} />
              <select name="stage" className="select" defaultValue={r.stage} aria-label="Στάδιο">
                {Object.entries(REQUEST_STAGE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <button className="btn btn--outline btn--sm">Αλλαγή σταδίου</button>
            </form>
            <form action={assignRequest} className="row" style={{ gap: 6 }}>
              <input type="hidden" name="id" value={r.id} />
              {manager && users?.ok ? (
                <>
                  <select name="assignedAgentId" className="select" defaultValue={r.assignedAgent?.id ?? ""} aria-label="Σύμβουλος">
                    <option value="">Χωρίς ανάθεση</option>
                    {users.data.data.filter((u) => u.status === "ACTIVE").map((u) => <option key={u.id} value={u.id}>{`${u.firstName} ${u.lastName}`}</option>)}
                  </select>
                  <button className="btn btn--outline btn--sm">Ανάθεση</button>
                </>
              ) : r.assignedAgent ? (
                r.assignedAgent.id === user.id ? (
                  <><input type="hidden" name="assignedAgentId" value="" /><button className="btn btn--outline btn--sm">Αποδέσμευση</button></>
                ) : (
                  <span className="muted">Σύμβουλος: {r.assignedAgent.name}</span>
                )
              ) : (
                <><input type="hidden" name="assignedAgentId" value={user.id} /><button className="btn btn--outline btn--sm">Ανάληψη</button></>
              )}
            </form>
          </div>
        </section>
      </div>

      <section className="panel">
        <h2>Συγκριτικά που χρησιμοποιήθηκαν</h2>
        <p className="muted" style={{ fontSize: "0.86rem" }}>
          Παγωμένο αντίγραφο τη στιγμή του υπολογισμού: αν αλλάξει μια αγγελία, η ιστορική εκτίμηση δεν αλλάζει.
        </p>
        {r.comparables.length === 0 ? (
          <p className="muted">Κανένα.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Ακίνητο</th>
                  <th>Πηγή</th>
                  <th>Τοποθεσία</th>
                  <th className="num">Τιμή</th>
                  <th className="num">τ.μ.</th>
                  <th className="num">€/τ.μ.</th>
                  <th className="num">Ομοιότητα</th>
                  <th className="num">Επικαιρότητα</th>
                  <th className="num">Βάρος</th>
                  <th>Διαφορές</th>
                </tr>
              </thead>
              <tbody>
                {r.comparables.map((c) => {
                  const snap = c.snapshot as Record<string, string | number | null>;
                  return (
                    <tr key={c.id} className={c.outlier ? "muted" : undefined}>
                      <td className="num">{c.rank}</td>
                      <td>
                        {c.propertyId && snap.reference ? <Link href={`/properties/${c.propertyId}`} className="mono">{snap.reference}</Link> : <span className="mono">{String(snap.sourceRecordId ?? snap.reference ?? "—")}</span>}
                        {c.outlier ? <span className="badge badge--warn" style={{ marginLeft: 6 }}>ακραία τιμή</span> : null}
                      </td>
                      <td>{c.source} · {c.observationType === "TRANSACTION" ? "συναλλαγή" : "αγγελία"}</td>
                      <td>{[snap.areaName, snap.city].filter(Boolean).join(", ")} <span className="muted">({SCOPE_LABEL[c.tier] ?? c.tier})</span></td>
                      <td className="num">{formatMoney(c.price)}</td>
                      <td className="num">{c.areaSqm}</td>
                      <td className="num">{Math.round(c.pricePerSqm)}</td>
                      <td className="num">{pct(c.similarity)}</td>
                      <td className="num">{pct(c.recency)}</td>
                      <td className="num">{c.weight.toFixed(2)}</td>
                      <td style={{ fontSize: "0.8rem" }}>
                        {Object.entries(c.breakdown).filter(([, v]) => v < 1).map(([k, v]) => `${DIMENSION_LABEL[k] ?? k} ${pct(v)}`).join(" · ") || "Πλήρης ταύτιση"}
                        <span className="muted"> ({Object.keys(c.breakdown).length}/8 κριτήρια)</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
