import Link from "next/link";
import { notFound } from "next/navigation";
import { COMPARABLE_KIND_LABELS, CONDITION_LABELS, VALUATION_STATUS_LABELS, type ValuationResult } from "@home88/domain";
import { PROPERTY_TYPE_LABELS, label } from "@home88/types";

import { addInternalComparable, duplicateValuation, removeComparable, toggleComparable } from "@/actions/sellers";
import { AdjustmentForm, ExternalComparableForm, FinalizeForm, SubjectForm } from "@/components/sellers/Forms";
import { PrintButton } from "@/components/sellers/PrintButton";
import { apiFetch } from "@/lib/api";
import { formatArea, formatDate, formatMoney } from "@/lib/format";
import { VALUATION_STATUS_CLASS } from "@/lib/labels";
import { requireRole } from "@/lib/session";

type Subject = { propertyType: string; city: string | null; areaName: string | null; area: number | null; bedrooms: number | null; floor: number | null; yearBuilt: number | null; condition: string | null };
type Comparable = {
  id: string; kind: string; label: string; source: string | null; propertyReference: string | null; city: string | null; areaName: string | null;
  price: number; area: number; perSqm: number; bedrooms: number | null; floor: number | null; yearBuilt: number | null; condition: string | null;
  observedAt: string | null; similarity: number | null; adjustmentPct: number; adjustmentReason: string | null; included: boolean;
};
type Valuation = {
  id: string; reference: string; status: string; listingType: string; subject: Subject;
  property: { id: string; reference: string; titleEl: string; price: number | null; monthlyRent: number | null } | null;
  sellerLead: { id: string; reference: string; ownerName: string; askingPrice: number | null } | null;
  agent: { firstName: string; lastName: string } | null;
  comparables: Comparable[]; result: ValuationResult; confidenceLabel: string | null;
  recommendedPrice: number | null; rationale: string | null; finalizedAt: string | null; createdAt: string;
};
type Candidate = {
  kind: string; propertyId: string; reference: string; title: string; city: string | null; areaName: string | null; price: number; area: number; perSqm: number;
  bedrooms: number | null; floor: number | null; yearBuilt: number | null; observedAt: string | null; note: string | null; similarity: number;
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const perSqm = (v: number) => `${formatMoney(Math.round(v))}/m²`;
const CONF_CLASS: Record<string, string> = { HIGH: "badge badge--ok", MEDIUM: "badge badge--warn", LOW: "badge badge--danger" };

/** Where each adjusted €/m² sits against the range. Text values below carry the numbers; the strip shows the shape. */
function RangeStrip({ values, labels, low, high, median }: { values: number[]; labels: string[]; low: number; high: number; median: number }) {
  const min = Math.min(low, ...values);
  const max = Math.max(high, ...values);
  const span = max - min || 1;
  const pos = (x: number) => `${((x - min) / span) * 100}%`;
  return (
    <figure style={{ margin: 0 }} aria-label="Θέση των συγκριτικών ανά m²">
      <div className="range-strip">
        <div className="range-strip__track" />
        <div className="range-strip__band" style={{ left: pos(low), width: `calc(${pos(high)} - ${pos(low)})` }} />
        {values.map((v, i) => <span key={i} className="range-strip__dot" style={{ left: pos(v) }} title={`${labels[i]}: ${perSqm(v)}`} />)}
        <div className="range-strip__median" style={{ left: pos(median) }} title={`Διάμεση: ${perSqm(median)}`} />
      </div>
      <figcaption className="range-strip__axis"><span>{perSqm(min)}</span><span>διάμεση {perSqm(median)}</span><span>{perSqm(max)}</span></figcaption>
    </figure>
  );
}

export default async function ValuationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole("AGENT");
  const { id } = await params;
  const sp = await searchParams;
  const result = await apiFetch<{ valuation: Valuation }>(`/api/valuations/${encodeURIComponent(id)}`);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return <div className="notice notice--danger">{result.error.message}</div>;
  }
  const v = result.data.valuation;
  const draft = v.status === "DRAFT";
  const rent = v.listingType === "RENT";
  const r = v.result;
  const s = v.subject;

  const filters = { sameArea: first(sp.sameArea) === "1" ? "1" : "0", sizeTolerancePct: first(sp.tol) || "30", months: first(sp.months) || "24" };
  const search = draft
    ? await apiFetch<{ candidates: Candidate[] }>(`/api/valuations/${encodeURIComponent(id)}/comparables/search`, { query: filters })
    : null;
  const included = v.comparables.filter((c) => c.included);
  const adjusted = (c: Comparable) => c.perSqm * (1 + c.adjustmentPct / 100);

  return (
    <>
      <div className="between" style={{ marginBottom: 12 }}>
        <div>
          <div className="row" style={{ marginBottom: 4 }}>
            <span className="mono muted">{v.reference}</span>
            <span className={VALUATION_STATUS_CLASS[v.status] ?? "badge"}>{VALUATION_STATUS_LABELS[v.status] ?? v.status}</span>
            <span className="badge badge--muted">{rent ? "Ενοικίαση (μίσθωμα/μήνα)" : "Πώληση"}</span>
          </div>
          <h1 style={{ margin: 0 }}>
            Εκτίμηση · {label(PROPERTY_TYPE_LABELS, s.propertyType, "el")}{s.area ? ` ${formatArea(s.area)}` : ""}{s.areaName ? `, ${s.areaName}` : s.city ? `, ${s.city}` : ""}
          </h1>
          <p className="muted" style={{ margin: 0 }}>
            {v.property && <Link href={`/properties/${v.property.id}`}>{v.property.reference} · {v.property.titleEl}</Link>}
            {v.property && v.sellerLead && " · "}
            {v.sellerLead && <Link href={`/sellers/${v.sellerLead.id}`}>Ιδιοκτήτης: {v.sellerLead.ownerName}</Link>}
            {v.agent && ` · ${v.agent.firstName} ${v.agent.lastName}`}
            {` · ${formatDate(v.createdAt)}`}
          </p>
        </div>
        <div className="row no-print">
          <PrintButton />
          {!draft && (
            <form action={duplicateValuation}>
              <input type="hidden" name="id" value={v.id} />
              <button type="submit" className="btn btn--outline btn--sm">Αντίγραφο για αναθεώρηση</button>
            </form>
          )}
        </div>
      </div>

      <section className="panel">
        <div className="panel__head">
          <div><h2>Αποτέλεσμα</h2><p className="panel__sub">Διάμεση προσαρμοσμένη τιμή ανά m² των συγκριτικών × εμβαδόν. Εύρος: ελάχιστη–μέγιστη έως 3 συγκριτικά, ενδοτεταρτημοριακό από 4 και πάνω.</p></div>
          {r.ok && <span className={CONF_CLASS[r.confidence] ?? "badge"}>Αξιοπιστία: {v.confidenceLabel}</span>}
        </div>
        {r.ok ? (
          <>
            <dl className="val-result">
              <div className="val-result__main"><dt>Εκτίμηση</dt><dd>{formatMoney(r.estimate)}{rent ? "/μήνα" : ""}</dd></div>
              <div><dt>Εύρος</dt><dd>{formatMoney(r.low)} – {formatMoney(r.high)}</dd></div>
              <div><dt>Ανά m² (διάμεση)</dt><dd>{perSqm(r.medianPerSqm)}</dd></div>
            </dl>
            <RangeStrip values={r.adjustedPerSqm} labels={included.map((c) => c.propertyReference ?? c.label)} low={r.lowPerSqm} high={r.highPerSqm} median={r.medianPerSqm} />
            <p className="muted" style={{ margin: 0, fontSize: "0.84rem" }}>
              {r.count} συγκριτικά · διασπορά {Math.round(r.dispersion * 100)}% · εύρος ανά m² {perSqm(r.lowPerSqm)} – {perSqm(r.highPerSqm)}
              {v.sellerLead?.askingPrice != null && ` · ο ιδιοκτήτης ζητά ${formatMoney(v.sellerLead.askingPrice)}`}
            </p>
          </>
        ) : (
          <div className="notice notice--warn">Λείπουν: {r.missing.join(", ")}.</div>
        )}
        {!draft && (
          <dl className="dl" style={{ marginTop: 14 }}>
            <dt>Προτεινόμενη τιμή</dt><dd><strong>{formatMoney(v.recommendedPrice)}{rent ? "/μήνα" : ""}</strong></dd>
            <dt>Σκεπτικό</dt><dd style={{ whiteSpace: "pre-wrap" }}>{v.rationale}</dd>
            <dt>Οριστικοποιήθηκε</dt><dd>{formatDate(v.finalizedAt)}</dd>
          </dl>
        )}
        {draft && r.ok && (
          <details className="subpanel">
            <summary>Οριστικοποίηση</summary>
            <FinalizeForm id={v.id} suggested={r.estimate} />
          </details>
        )}
      </section>

      <section className="panel">
        <div className="panel__head"><div><h2>Συγκριτικά ({included.length} από {v.comparables.length})</h2><p className="panel__sub">Κάθε προσαρμογή είναι του συνεργάτη και καταγράφεται με τον λόγο της.</p></div></div>
        {v.comparables.length === 0 ? (
          <p className="muted">Προσθέστε συγκριτικά από τα αποτελέσματα αναζήτησης ή από εξωτερική πηγή.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Συγκριτικό</th><th>Είδος</th><th className="num">Τιμή</th><th className="num nocase">m²</th><th className="num nocase">€/m²</th>
                  <th className="num">Ομοιότητα</th><th>Προσαρμογή</th><th className="num nocase">Μετά την προσαρμογή</th>{draft && <th className="no-print" />}
                </tr>
              </thead>
              <tbody>
                {v.comparables.map((c) => (
                  <tr key={c.id} className={c.included ? undefined : "is-excluded"}>
                    <td>
                      {c.propertyReference ? <span className="mono">{c.propertyReference}</span> : c.label}
                      <br />
                      <span className="muted">{[c.areaName ?? c.city, c.bedrooms != null ? `${c.bedrooms} υ/δ` : null, c.floor != null ? `${c.floor}ος` : null, c.yearBuilt, c.observedAt ? formatDate(c.observedAt) : null, c.kind === "EXTERNAL" ? c.source : null].filter(Boolean).join(" · ")}</span>
                    </td>
                    <td>{COMPARABLE_KIND_LABELS[c.kind as keyof typeof COMPARABLE_KIND_LABELS] ?? c.kind}</td>
                    <td className="num">{formatMoney(c.price)}</td>
                    <td className="num">{c.area}</td>
                    <td className="num">{perSqm(c.perSqm)}</td>
                    <td className="num">{c.similarity ?? "—"}</td>
                    <td>
                      {draft ? (
                        <AdjustmentForm id={v.id} cid={c.id} pct={c.adjustmentPct} reason={c.adjustmentReason} />
                      ) : c.adjustmentPct !== 0 ? (
                        `${c.adjustmentPct > 0 ? "+" : ""}${c.adjustmentPct}% · ${c.adjustmentReason ?? ""}`
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="num">{perSqm(adjusted(c))}</td>
                    {draft && (
                      <td className="no-print">
                        <div className="row">
                          <form action={toggleComparable}>
                            <input type="hidden" name="id" value={v.id} />
                            <input type="hidden" name="cid" value={c.id} />
                            <input type="hidden" name="included" value={c.included ? "false" : "true"} />
                            <button type="submit" className="btn btn--ghost btn--sm">{c.included ? "Εξαίρεση" : "Συμμετοχή"}</button>
                          </form>
                          <form action={removeComparable}>
                            <input type="hidden" name="id" value={v.id} />
                            <input type="hidden" name="cid" value={c.id} />
                            <button type="submit" className="btn btn--ghost btn--sm" aria-label={`Αφαίρεση ${c.propertyReference ?? c.label}`}>Αφαίρεση</button>
                          </form>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {draft && (
          <details className="subpanel">
            <summary>Συγκριτικό από εξωτερική πηγή</summary>
            <ExternalComparableForm id={v.id} isRent={rent} />
          </details>
        )}
      </section>

      {draft && (
        <section className="panel no-print">
          <div className="panel__head"><div><h2>Αναζήτηση συγκριτικών</h2><p className="panel__sub">Ολοκληρωμένες συναλλαγές (συμφωνημένη τιμή) και αγγελίες του γραφείου (ζητούμενη τιμή), ίδιου τύπου και πόλης, ταξινομημένες κατά ομοιότητα.</p></div></div>
          <form className="row" style={{ marginBottom: 12 }}>
            <label className="row" style={{ gap: 6 }}><input type="checkbox" name="sameArea" value="1" defaultChecked={filters.sameArea === "1"} /> Μόνο ίδια περιοχή</label>
            <label className="row" style={{ gap: 6 }}>Εμβαδόν ±<input name="tol" type="number" min="5" max="200" defaultValue={filters.sizeTolerancePct} className="input input--sm" style={{ width: 72 }} />%</label>
            <label className="row" style={{ gap: 6 }}>Τελευταίοι<input name="months" type="number" min="1" max="120" defaultValue={filters.months} className="input input--sm" style={{ width: 72 }} />μήνες</label>
            <button type="submit" className="btn btn--outline btn--sm">Αναζήτηση</button>
          </form>
          {!s.area && <div className="notice notice--warn">Συμπληρώστε εμβαδόν στο ακίνητο για να φιλτραριστούν τα συγκριτικά κατά μέγεθος.</div>}
          {search && !search.ok ? (
            <div className="notice notice--danger">{search.error.message}</div>
          ) : search && search.data.candidates.length === 0 ? (
            <p className="muted">Δεν βρέθηκαν συγκριτικά με αυτά τα κριτήρια. Διευρύνετε την αναζήτηση ή προσθέστε από εξωτερική πηγή.</p>
          ) : search ? (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Ακίνητο</th><th>Είδος</th><th className="num">Τιμή</th><th className="num nocase">m²</th><th className="num nocase">€/m²</th><th className="num">Ομοιότητα</th><th /></tr></thead>
                <tbody>
                  {search.data.candidates.map((c) => (
                    <tr key={`${c.propertyId}:${c.kind}`}>
                      <td>
                        <span className="mono">{c.reference}</span> · {c.title}
                        <br />
                        <span className="muted">{[c.areaName ?? c.city, c.bedrooms != null ? `${c.bedrooms} υ/δ` : null, c.yearBuilt, c.observedAt ? formatDate(c.observedAt) : null, c.note].filter(Boolean).join(" · ")}</span>
                      </td>
                      <td>{COMPARABLE_KIND_LABELS[c.kind as keyof typeof COMPARABLE_KIND_LABELS] ?? c.kind}</td>
                      <td className="num">{formatMoney(c.price)}</td>
                      <td className="num">{c.area}</td>
                      <td className="num">{perSqm(c.perSqm)}</td>
                      <td className="num">{c.similarity}</td>
                      <td>
                        <form action={addInternalComparable}>
                          <input type="hidden" name="id" value={v.id} />
                          <input type="hidden" name="kind" value={c.kind} />
                          <input type="hidden" name="propertyId" value={c.propertyId} />
                          <button type="submit" className="btn btn--outline btn--sm">Προσθήκη</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      )}

      <section className="panel">
        <div className="panel__head"><div><h2>Ακίνητο υπό εκτίμηση</h2><p className="panel__sub">Στιγμιότυπο: αλλαγές στο ακίνητο δεν αλλάζουν αυτή την εκτίμηση.</p></div></div>
        <dl className="dl">
          <dt>Τύπος</dt><dd>{label(PROPERTY_TYPE_LABELS, s.propertyType, "el")}</dd>
          <dt>Εμβαδόν</dt><dd>{s.area ? formatArea(s.area) : "—"}</dd>
          <dt>Περιοχή</dt><dd>{[s.areaName, s.city].filter(Boolean).join(", ") || "—"}</dd>
          <dt>Υπνοδωμάτια / όροφος</dt><dd>{s.bedrooms ?? "—"} / {s.floor ?? "—"}</dd>
          <dt>Έτος / κατάσταση</dt><dd>{s.yearBuilt ?? "—"} / {s.condition ? (CONDITION_LABELS as Record<string, string>)[s.condition] ?? s.condition : "—"}</dd>
        </dl>
        {draft && (
          <details className="subpanel">
            <summary>Επεξεργασία</summary>
            <SubjectForm id={v.id} d={s} />
          </details>
        )}
      </section>
    </>
  );
}
