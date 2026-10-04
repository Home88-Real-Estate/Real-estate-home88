import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CHECKLIST_STATUS_LABELS,
  CHECKLIST_STATUSES,
  COMMISSION_STATUS_LABELS,
  FINANCING_OPTIONS,
  nextTransactionStatuses,
  OFFER_STATUS_LABELS,
  TRANSACTION_STATUS_LABELS,
  type CommissionResult,
} from "@home88/domain";

import { respondOffer, setChecklistStatus } from "@/actions/transactions";
import { CalculateForm, ChecklistAddForm, CommissionStatusForm, NoteForm, OfferForm, StatusForm } from "@/components/transactions/Forms";
import { apiFetch } from "@/lib/api";
import { TRX_STATUS_CLASS } from "@/lib/labels";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { requireRole } from "@/lib/session";

type Offer = { id: string; reference: string; round: number; party: string; amount: number; conditions: string | null; financing: string | null; deposit: number | null; expiresAt: string | null; status: string; createdAt: string; open: boolean };
type Commission = { basis: string; rate: number; baseAmount: number; buyerSide: number; sellerSide: number; net: number; vat: number; gross: number; agentShare: number; agencyShare: number; minimumApplied: boolean; overridden: boolean; overrideReason: string | null; status: string; storedStatus: string; invoiceNumber: string | null; dueDate: string | null; paidAmount: number | null; calculatedAt: string };
type Trx = {
  id: string; reference: string; type: string; status: string;
  property: { id: string; reference: string; titleEl: string; price: number | null; monthlyRent: number | null; areaName: string | null; city: string | null };
  agent: { firstName: string; lastName: string } | null; lead: { id: string; reference: string } | null;
  buyerName: string; buyerPhone: string | null; buyerEmail: string | null;
  agreedAmount: number | null; agreementAt: string | null; contractAt: string | null; expectedCloseAt: string | null; closedAt: string | null; cancelReason: string | null; notes: string | null;
  offers: Offer[]; openOfferId: string | null;
  events: Array<{ id: string; type: string; summary: string; actorName: string | null; createdAt: string }>;
  commission: Commission | null;
  checklist: Array<{ id: string; label: string; status: string; note: string | null }>;
};

const OFFER_CLASS: Record<string, string> = { SUBMITTED: "badge badge--info", COUNTERED: "badge badge--muted", ACCEPTED: "badge badge--ok", REJECTED: "badge badge--danger", WITHDRAWN: "badge badge--muted", EXPIRED: "badge badge--warn" };
const COMMISSION_CLASS: Record<string, string> = { EXPECTED: "badge badge--info", INVOICED: "badge badge--warn", PARTIALLY_PAID: "badge badge--warn", PAID: "badge badge--ok", OVERDUE: "badge badge--danger", CANCELLED: "badge badge--muted" };
const CHECK_CLASS: Record<string, string> = { REQUESTED: "badge badge--info", RECEIVED: "badge badge--warn", VERIFIED: "badge badge--ok", REJECTED: "badge badge--danger", EXPIRED: "badge badge--danger", NOT_REQUIRED: "badge badge--muted" };

export default async function TransactionPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("AGENT");
  const { id } = await params;
  const result = await apiFetch<{ transaction: Trx; commissionPreview: CommissionResult | null; canManageFinancials: boolean }>(`/api/transactions/${encodeURIComponent(id)}`);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return <div className="notice notice--danger">{result.error.message}</div>;
  }
  const { transaction: t, commissionPreview, canManageFinancials } = result.data;
  const rent = t.type === "RENT";
  const closed = t.status === "CLOSED" || t.status === "CANCELLED";
  const last = t.offers[t.offers.length - 1];
  const nextParty: "BUYER" | "SELLER" = last?.open ? (last.party === "BUYER" ? "SELLER" : "BUYER") : "BUYER";
  const asking = rent ? t.property.monthlyRent : t.property.price;
  const next = nextTransactionStatuses(t.status).filter((s) => s !== "AGREEMENT" && (s !== "NEGOTIATION" || canManageFinancials));
  const c = t.commission;

  return (
    <>
      <div className="between" style={{ marginBottom: 12 }}>
        <div>
          <div className="row" style={{ marginBottom: 4 }}>
            <span className="mono muted">{t.reference}</span>
            <span className={TRX_STATUS_CLASS[t.status] ?? "badge"}>{TRANSACTION_STATUS_LABELS[t.status as keyof typeof TRANSACTION_STATUS_LABELS]}</span>
            <span className="badge badge--muted">{rent ? "Ενοικίαση" : "Πώληση"}</span>
          </div>
          <h1 style={{ margin: 0 }}>{t.buyerName}</h1>
          <p className="muted" style={{ margin: 0 }}>
            <Link href={`/properties/${t.property.id}`}>{t.property.reference} · {t.property.titleEl}</Link>
            {asking != null && ` · Ζητούμενη τιμή: ${formatMoney(asking)}${rent ? "/μήνα" : ""}`}
            {t.agent && ` · ${t.agent.firstName} ${t.agent.lastName}`}
          </p>
        </div>
        <div className="trx-summary">
          <span className="muted">Συμφωνία</span>
          <strong>{t.agreedAmount != null ? formatMoney(t.agreedAmount) : "—"}</strong>
          {t.agreementAt && <span className="muted">{formatDate(t.agreementAt)}</span>}
        </div>
      </div>

      <div className="trx-grid">
        <div className="trx-main">
          <section className="panel">
            <div className="panel__head"><div><h2>Διαπραγμάτευση</h2><p className="panel__sub">Κάθε γύρος καταγράφεται και δεν αλλάζει. Μια νέα πρόταση κάνει την προηγούμενη αντιπροσφορά.</p></div></div>
            {t.offers.length === 0 ? (
              <p className="muted">Δεν υπάρχουν προσφορές ακόμη.</p>
            ) : (
              <ol className="rounds">
                {t.offers.map((o) => (
                  <li key={o.id} className={`round round--${o.party.toLowerCase()}`}>
                    <div className="round__head">
                      <span className="round__n">Γύρος {o.round}</span>
                      <strong>{formatMoney(o.amount)}{rent ? " /μήνα" : ""}</strong>
                      <span className="muted">{o.party === "BUYER" ? (rent ? "Μισθωτής" : "Αγοραστής") : "Ιδιοκτήτης"}</span>
                      <span className={OFFER_CLASS[o.status] ?? "badge"}>{OFFER_STATUS_LABELS[o.status] ?? o.status}</span>
                      <span className="muted">{formatDateTime(o.createdAt)}</span>
                    </div>
                    {(o.conditions || o.financing || o.deposit != null || o.expiresAt) && (
                      <p className="round__terms">
                        {o.financing && `Χρηματοδότηση: ${FINANCING_OPTIONS.find((f) => f.value === o.financing)?.label ?? o.financing}. `}
                        {o.deposit != null && `${rent ? "Εγγύηση" : "Προκαταβολή"}: ${formatMoney(o.deposit)}. `}
                        {o.expiresAt && `Ισχύει έως ${formatDate(o.expiresAt)}. `}
                        {o.conditions}
                      </p>
                    )}
                    {o.open && t.status === "NEGOTIATION" && (
                      <div className="row">
                        {(["ACCEPT", "REJECT", "WITHDRAW"] as const).map((a) => (
                          <form key={a} action={respondOffer}>
                            <input type="hidden" name="id" value={t.id} />
                            <input type="hidden" name="offerId" value={o.id} />
                            <input type="hidden" name="action" value={a} />
                            <button type="submit" className={a === "ACCEPT" ? "btn btn--primary btn--sm" : "btn btn--outline btn--sm"}>
                              {a === "ACCEPT" ? "Αποδοχή" : a === "REJECT" ? "Απόρριψη" : "Ανάκληση"}
                            </button>
                          </form>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
            {t.status === "NEGOTIATION" && (
              <details className="subpanel" open={t.offers.length === 0}>
                <summary>{t.offers.length === 0 ? "Πρώτη προσφορά" : last?.open ? "Αντιπροσφορά" : "Νέα προσφορά"}</summary>
                <OfferForm id={t.id} party={nextParty} isRent={rent} />
              </details>
            )}
          </section>

          <section className="panel">
            <div className="panel__head"><div><h2>Προμήθεια</h2><p className="panel__sub">Υπολογίζεται από τις Ρυθμίσεις → Προμήθειες και αποθηκεύεται ως στιγμιότυπο.</p></div>
              {c && <span className={COMMISSION_CLASS[c.status] ?? "badge"}>{COMMISSION_STATUS_LABELS[c.status] ?? c.status}</span>}</div>
            {t.agreedAmount == null ? (
              <p className="muted">Υπολογίζεται αφού γίνει αποδεκτή μια προσφορά.</p>
            ) : c ? (
              <>
                <dl className="dl dl--money">
                  <dt>Βάση</dt><dd>{formatMoney(c.baseAmount)} × {c.basis === "MONTHS" ? `${c.rate} μήνες` : `${c.rate}%`}{c.overridden && <span className="badge badge--warn" style={{ marginLeft: 8 }}>Ειδικό: {c.overrideReason}</span>}</dd>
                  {c.buyerSide > 0 && <><dt>Πλευρά αγοραστή</dt><dd>{formatMoney(c.buyerSide)}</dd></>}
                  <dt>{c.buyerSide > 0 ? "Πλευρά πωλητή" : "Προμήθεια"}</dt><dd>{formatMoney(c.sellerSide)}</dd>
                  <dt>Καθαρό</dt><dd>{formatMoney(c.net)}{c.minimumApplied && " (ελάχιστη αμοιβή)"}</dd>
                  <dt>ΦΠΑ</dt><dd>{formatMoney(c.vat)}</dd>
                  <dt>Σύνολο</dt><dd><strong>{formatMoney(c.gross)}</strong></dd>
                  <dt>Συνεργάτης / Γραφείο</dt><dd>{formatMoney(c.agentShare)} / {formatMoney(c.agencyShare)}</dd>
                  {c.invoiceNumber && <><dt>Παραστατικό</dt><dd>{c.invoiceNumber}{c.dueDate && ` · λήξη ${formatDate(c.dueDate)}`}</dd></>}
                  {c.paidAmount ? <><dt>Εξοφλημένο</dt><dd>{formatMoney(c.paidAmount)}</dd></> : null}
                </dl>
                {canManageFinancials && c.storedStatus !== "CANCELLED" && (
                  <CommissionStatusForm id={t.id} status={c.storedStatus} invoiceNumber={c.invoiceNumber} dueDate={c.dueDate} paidAmount={c.paidAmount} />
                )}
                {canManageFinancials && c.storedStatus === "EXPECTED" && <CalculateForm id={t.id} manager recalc />}
              </>
            ) : commissionPreview && !commissionPreview.ok ? (
              <div className="notice notice--warn">
                Δεν έχουν οριστεί κανόνες προμήθειας: {commissionPreview.missing.join(", ")}.{" "}
                <Link href="/settings/commissions">Ρυθμίσεις → Προμήθειες</Link>
                {canManageFinancials && <CalculateForm id={t.id} manager recalc={false} />}
              </div>
            ) : (
              <>
                {commissionPreview?.ok && <p className="muted">Εκτίμηση με τις τρέχουσες ρυθμίσεις: {formatMoney(commissionPreview.breakdown.gross)} με ΦΠΑ.</p>}
                <CalculateForm id={t.id} manager={canManageFinancials} recalc={false} />
              </>
            )}
          </section>

          <section className="panel">
            <div className="panel__head"><div><h2>Έγγραφα</h2><p className="panel__sub">Ποια έγγραφα χρειάζονται και πού βρίσκεται το καθένα. Η λίστα ορίζεται ανά συναλλαγή.</p></div></div>
            {t.checklist.length === 0 ? <p className="muted">Δεν έχουν οριστεί έγγραφα.</p> : (
              <ul className="list">
                {t.checklist.map((i) => (
                  <li key={i.id}>
                    <span className="list__main"><span className="list__title">{i.label}</span></span>
                    <span className={CHECK_CLASS[i.status] ?? "badge"}>{CHECKLIST_STATUS_LABELS[i.status] ?? i.status}</span>
                    {!closed && (
                      <form action={setChecklistStatus} className="row">
                        <input type="hidden" name="id" value={t.id} />
                        <input type="hidden" name="itemId" value={i.id} />
                        <select name="status" className="select select--sm" defaultValue={i.status} aria-label={`Κατάσταση: ${i.label}`}>
                          {CHECKLIST_STATUSES.map((s) => <option key={s} value={s}>{CHECKLIST_STATUS_LABELS[s]}</option>)}
                        </select>
                        <button type="submit" className="btn btn--ghost btn--sm">OK</button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {!closed && <ChecklistAddForm id={t.id} />}
          </section>
        </div>

        <aside className="trx-side">
          <section className="panel">
            <h2>Κατάσταση</h2>
            <ol className="steps">
              {(["NEGOTIATION", "AGREEMENT", "CONTRACT", "CLOSED"] as const).map((s, i, all) => {
                const order = all.indexOf(t.status as (typeof all)[number]);
                const done = t.status !== "CANCELLED" && order >= i;
                return <li key={s} className={done ? "is-done" : undefined}>{TRANSACTION_STATUS_LABELS[s]}</li>;
              })}
            </ol>
            {t.status === "CANCELLED" && <p className="notice notice--danger">Ακυρώθηκε{t.cancelReason ? `: ${t.cancelReason}` : ""}</p>}
            {!closed && <StatusForm id={t.id} next={next} />}
            <dl className="dl">
              {t.buyerPhone && <><dt>Τηλέφωνο</dt><dd>{t.buyerPhone}</dd></>}
              {t.buyerEmail && <><dt>Email</dt><dd>{t.buyerEmail}</dd></>}
              {t.lead && <><dt>Lead</dt><dd><Link href={`/leads/${t.lead.id}`} className="mono">{t.lead.reference}</Link></dd></>}
              {t.expectedCloseAt && <><dt>Αναμενόμενο κλείσιμο</dt><dd>{formatDate(t.expectedCloseAt)}</dd></>}
              {t.contractAt && <><dt>Συμβόλαιο</dt><dd>{formatDate(t.contractAt)}</dd></>}
              {t.closedAt && <><dt>Κλείσιμο</dt><dd>{formatDate(t.closedAt)}</dd></>}
            </dl>
          </section>
          <section className="panel">
            <h2>Χρονολόγιο</h2>
            <NoteForm id={t.id} />
            <ol className="timeline">
              {t.events.map((e) => (
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
