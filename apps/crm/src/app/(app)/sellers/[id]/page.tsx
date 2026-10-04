import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CONDITION_LABELS,
  SELLER_MOTIVATIONS,
  SELLER_OPEN_STAGES,
  SELLER_STAGE_LABELS,
  SELLER_TIMEFRAMES,
  VALUATION_STATUS_LABELS,
  type SellerStage,
} from "@home88/domain";
import { PROPERTY_STATUS_LABELS, PROPERTY_TYPE_LABELS, label } from "@home88/types";

import { EditSellerForm, LinkPropertyForm, SellerNoteForm, SellerStageForm, type SellerDetails } from "@/components/sellers/Forms";
import { apiFetch } from "@/lib/api";
import { formatArea, formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { SELLER_STAGE_CLASS, VALUATION_STATUS_CLASS } from "@/lib/labels";
import { requireRole } from "@/lib/session";

type Seller = SellerDetails & {
  id: string;
  reference: string;
  stage: SellerStage;
  stageLabel: string;
  nextStages: SellerStage[];
  ownerName: string;
  contact: { id: string; reference: string; name: string; email: string | null; phone: string | null } | null;
  property: { id: string; reference: string; titleEl: string; status: string; price: number | null; monthlyRent: number | null } | null;
  agent: { firstName: string; lastName: string } | null;
  followUpDue: boolean;
  listedAt: string | null;
  lostAt: string | null;
  lostReason: string | null;
  daysInPipeline: number;
  createdAt: string;
  events: Array<{ id: string; type: string; summary: string; actorName: string | null; createdAt: string }>;
  valuations: Array<{ id: string; reference: string; status: string; estimate: number | null; low: number | null; high: number | null; recommendedPrice: number | null; createdAt: string }>;
};

const labelOf = (list: ReadonlyArray<{ value: string; label: string }>, v: string | null) => (v ? (list.find((x) => x.value === v)?.label ?? v) : "—");

export default async function SellerPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("AGENT");
  const { id } = await params;
  const result = await apiFetch<{ seller: Seller }>(`/api/sellers/${encodeURIComponent(id)}`);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return <div className="notice notice--danger">{result.error.message}</div>;
  }
  const s = result.data.seller;
  const open = SELLER_OPEN_STAGES.includes(s.stage);
  const currentIndex = SELLER_OPEN_STAGES.indexOf(s.stage);
  const finalValuation = s.valuations.find((v) => v.status === "FINAL");
  const rent = s.listingType === "RENT";

  return (
    <>
      <div className="between" style={{ marginBottom: 12 }}>
        <div>
          <div className="row" style={{ marginBottom: 4 }}>
            <span className="mono muted">{s.reference}</span>
            <span className={SELLER_STAGE_CLASS[s.stage] ?? "badge"}>{s.stageLabel}</span>
            <span className="badge badge--muted">{rent ? "Ενοικίαση" : "Πώληση"}</span>
            {s.followUpDue && <span className="badge badge--danger">Για επικοινωνία</span>}
          </div>
          <h1 style={{ margin: 0 }}>{s.ownerName}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {[s.propertyType ? label(PROPERTY_TYPE_LABELS, s.propertyType, "el") : null, s.area ? formatArea(s.area) : null, s.areaName, s.city].filter(Boolean).join(" · ") || "Χωρίς στοιχεία ακινήτου"}
            {s.agent && ` · ${s.agent.firstName} ${s.agent.lastName}`}
            {` · ${s.daysInPipeline} ημέρες στη ροή`}
          </p>
        </div>
        <div className="trx-summary">
          <span className="muted">Ζητά / Εκτίμηση</span>
          <strong>{s.askingPrice != null ? formatMoney(s.askingPrice) : "—"}</strong>
          <span className="muted">{finalValuation ? formatMoney(finalValuation.recommendedPrice ?? finalValuation.estimate) : "χωρίς οριστική εκτίμηση"}</span>
        </div>
      </div>

      <div className="trx-grid">
        <div className="trx-main">
          <section className="panel">
            <div className="panel__head"><div><h2>Στάδιο</h2><p className="panel__sub">Νέος → Επικοινωνία → Εκτίμηση → Πρόταση → Ανάθεση → Καταχωρήθηκε.</p></div></div>
            <ol className="pipeline">
              {[...SELLER_OPEN_STAGES, "LISTED" as const].map((st, i) => (
                <li
                  key={st}
                  className={st === s.stage ? "is-current" : s.stage === "LISTED" || (currentIndex >= 0 && i < currentIndex) ? "is-done" : undefined}
                  aria-current={st === s.stage ? "step" : undefined}
                >
                  {SELLER_STAGE_LABELS[st]}
                </li>
              ))}
            </ol>
            {s.stage === "LOST" && <p className="notice notice--warn">Χάθηκε {s.lostAt ? formatDate(s.lostAt) : ""}{s.lostReason ? `: ${s.lostReason}` : ""}</p>}
            {s.stage === "LISTED" && s.listedAt && <p className="muted">Καταχωρήθηκε {formatDate(s.listedAt)}.</p>}
            {s.nextStages.length > 0 && <SellerStageForm id={s.id} stages={s.nextStages} hasProperty={!!s.property} />}
          </section>

          <section className="panel">
            <div className="panel__head">
              <div><h2>Εκτιμήσεις</h2><p className="panel__sub">Συγκριτική εκτίμηση αγοράς για τη συζήτηση με τον ιδιοκτήτη.</p></div>
              {open && (
                <div className="row">
                  <Link href={`/valuations/new?seller=${s.id}`} className="btn btn--outline btn--sm">Νέα εκτίμηση</Link>
                  <Link href={`/mandates/new?seller=${s.id}${s.property ? `&property=${s.property.reference}` : ""}`} className="btn btn--outline btn--sm">Νέα εντολή</Link>
                </div>
              )}
            </div>
            {s.valuations.length === 0 ? (
              <p className="muted">Δεν υπάρχει εκτίμηση ακόμη.</p>
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th>Κωδικός</th><th>Κατάσταση</th><th className="num">Εύρος</th><th className="num">Πρόταση</th><th>Ημερομηνία</th></tr></thead>
                  <tbody>
                    {s.valuations.map((v) => (
                      <tr key={v.id}>
                        <td><Link href={`/valuations/${v.id}`} className="mono">{v.reference}</Link></td>
                        <td><span className={VALUATION_STATUS_CLASS[v.status] ?? "badge"}>{VALUATION_STATUS_LABELS[v.status] ?? v.status}</span></td>
                        <td className="num">{v.low != null && v.high != null ? `${formatMoney(v.low)} – ${formatMoney(v.high)}` : "—"}</td>
                        <td className="num">{v.recommendedPrice != null ? formatMoney(v.recommendedPrice) : v.estimate != null ? formatMoney(v.estimate) : "—"}</td>
                        <td>{formatDate(v.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel__head"><div><h2>Στοιχεία</h2></div></div>
            <dl className="dl">
              <dt>Τύπος</dt><dd>{s.propertyType ? label(PROPERTY_TYPE_LABELS, s.propertyType, "el") : "—"}</dd>
              <dt>Διεύθυνση</dt><dd>{s.address ?? "—"}</dd>
              <dt>Υπνοδωμάτια / όροφος</dt><dd>{s.bedrooms ?? "—"} / {s.floor ?? "—"}</dd>
              <dt>Έτος / κατάσταση</dt><dd>{s.yearBuilt ?? "—"} / {s.condition ? (CONDITION_LABELS as Record<string, string>)[s.condition] ?? s.condition : "—"}</dd>
              <dt>Κίνητρο</dt><dd>{labelOf(SELLER_MOTIVATIONS, s.motivation)}</dd>
              <dt>Χρονικός ορίζοντας</dt><dd>{labelOf(SELLER_TIMEFRAMES, s.timeframe)}</dd>
              <dt>Πηγή</dt><dd>{s.source ?? "—"}</dd>
              <dt>Επόμενη επικοινωνία</dt><dd>{open && s.nextFollowUpAt ? formatDate(s.nextFollowUpAt) : "—"}</dd>
              {s.notes && <><dt>Σημειώσεις</dt><dd style={{ whiteSpace: "pre-wrap" }}>{s.notes}</dd></>}
            </dl>
            {open && (
              <details className="subpanel">
                <summary>Επεξεργασία</summary>
                <EditSellerForm id={s.id} d={s} />
              </details>
            )}
          </section>
        </div>

        <aside className="trx-side">
          <section className="panel">
            <div className="panel__head"><div><h2>Ιδιοκτήτης</h2></div></div>
            {s.contact ? (
              <dl className="dl">
                <dt>Επαφή</dt><dd><Link href={`/contacts/${s.contact.id}`}>{s.contact.reference} · {s.contact.name || s.ownerName}</Link></dd>
                <dt>Τηλέφωνο</dt><dd>{s.contact.phone ? <a href={`tel:${s.contact.phone}`}>{s.contact.phone}</a> : "—"}</dd>
                <dt>Email</dt><dd>{s.contact.email ? <a href={`mailto:${s.contact.email}`}>{s.contact.email}</a> : "—"}</dd>
              </dl>
            ) : (
              <p className="muted">Η επαφή δεν είναι πλέον διαθέσιμη.</p>
            )}
            {s.contact && <p style={{ margin: "8px 0 0" }}><Link href={`/contacts/${s.contact.id}#owner-report`} className="btn btn--outline btn--sm">Αναφορά ιδιοκτήτη</Link></p>}
          </section>

          <section className="panel">
            <div className="panel__head"><div><h2>Ακίνητο</h2></div></div>
            {s.property ? (
              <p style={{ margin: 0 }}>
                <Link href={`/properties/${s.property.id}`}>{s.property.reference} · {s.property.titleEl}</Link>
                <br />
                <span className="muted">
                  {label(PROPERTY_STATUS_LABELS, s.property.status, "el")}
                  {(rent ? s.property.monthlyRent : s.property.price) != null && ` · ${formatMoney(rent ? s.property.monthlyRent : s.property.price)}${rent ? "/μήνα" : ""}`}
                </span>
              </p>
            ) : (
              <>
                <p className="muted" style={{ marginTop: 0 }}>Δεν έχει δημιουργηθεί ακόμη. Όταν καταχωριστεί, συνδέστε το εδώ.</p>
                {open && <LinkPropertyForm id={s.id} />}
                {open && <p style={{ margin: "8px 0 0" }}><Link href="/properties/new" className="btn btn--ghost btn--sm">Νέο ακίνητο</Link></p>}
              </>
            )}
          </section>

          <section className="panel">
            <div className="panel__head"><div><h2>Χρονολόγιο</h2></div></div>
            <SellerNoteForm id={s.id} />
            <ol className="timeline">
              {s.events.map((e) => (
                <li key={e.id}>
                  <span className="timeline__when">{formatDateTime(e.createdAt)}</span>
                  <span>{e.summary}</span>
                  {e.actorName && <span className="muted"> · {e.actorName}</span>}
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </>
  );
}
