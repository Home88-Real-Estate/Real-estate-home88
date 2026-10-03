"use client";

import { useActionState } from "react";
import { CHECKLIST_STATUS_LABELS, COMMISSION_STATUSES, COMMISSION_STATUS_LABELS, FINANCING_OPTIONS, TRANSACTION_STATUS_LABELS } from "@home88/domain";

import {
  addChecklistItem,
  addOffer,
  addTransactionNote,
  calculateCommissionAction,
  createTransaction,
  moveTransaction,
  updateCommissionAction,
} from "@/actions/transactions";
import { idleState, type ActionState } from "@/lib/form";

function Msg({ state }: { state: ActionState }) {
  if (!state.message) return null;
  return <p className={state.ok ? "quickform__msg ok" : "quickform__msg error"} role="status">{state.message}</p>;
}
const err = (s: ActionState, k: string) => s.fields?.[k]?.[0];

export function NewTransactionForm({ defaultReference }: { defaultReference?: string }) {
  const [state, action, pending] = useActionState(createTransaction, idleState);
  return (
    <form action={action} className="formgrid">
      {state.message && !state.ok && <div className="notice notice--danger span2" role="alert">{state.message}</div>}
      <div className="field">
        <label htmlFor="t-ref">Κωδικός ακινήτου *</label>
        <input id="t-ref" name="propertyReference" className="input mono" defaultValue={defaultReference} placeholder="H88-000123" required />
        {err(state, "propertyReference") && <span className="error">{err(state, "propertyReference")}</span>}
      </div>
      <div className="field">
        <label htmlFor="t-lead">Κωδικός lead</label>
        <input id="t-lead" name="leadReference" className="input mono" placeholder="προαιρετικό" />
        {err(state, "leadReference") && <span className="error">{err(state, "leadReference")}</span>}
      </div>
      <div className="field">
        <label htmlFor="t-buyer">Αγοραστής / μισθωτής *</label>
        <input id="t-buyer" name="buyerName" className="input" required maxLength={160} />
        {err(state, "buyerName") && <span className="error">{err(state, "buyerName")}</span>}
      </div>
      <div className="field">
        <label htmlFor="t-phone">Τηλέφωνο</label>
        <input id="t-phone" name="buyerPhone" type="tel" className="input" maxLength={40} />
      </div>
      <div className="field">
        <label htmlFor="t-email">Email</label>
        <input id="t-email" name="buyerEmail" type="email" className="input" maxLength={254} />
        {err(state, "buyerEmail") && <span className="error">{err(state, "buyerEmail")}</span>}
      </div>
      <div className="field">
        <label htmlFor="t-close">Αναμενόμενο κλείσιμο</label>
        <input id="t-close" name="expectedCloseAt" type="date" className="input" />
      </div>
      <div className="field span2">
        <label htmlFor="t-notes">Σημειώσεις</label>
        <textarea id="t-notes" name="notes" className="textarea textarea--sm" maxLength={4000} />
      </div>
      <div className="span2 row">
        <button type="submit" className="btn btn--primary" disabled={pending}>{pending ? "Δημιουργία…" : "Δημιουργία συναλλαγής"}</button>
      </div>
    </form>
  );
}

export function OfferForm({ id, party, isRent }: { id: string; party: "BUYER" | "SELLER"; isRent: boolean }) {
  const [state, action, pending] = useActionState(addOffer, idleState);
  return (
    <form action={action} className="formgrid">
      <input type="hidden" name="id" value={id} />
      <div className="field">
        <label htmlFor="o-party">Από</label>
        <select id="o-party" name="party" className="select" defaultValue={party}>
          <option value="BUYER">{isRent ? "Μισθωτή" : "Αγοραστή"}</option>
          <option value="SELLER">Ιδιοκτήτη (αντιπρόταση)</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="o-amount">{isRent ? "Μίσθωμα (€/μήνα) *" : "Ποσό (€) *"}</label>
        <input id="o-amount" name="amount" className="input" inputMode="decimal" required />
        {err(state, "amount") && <span className="error">{err(state, "amount")}</span>}
      </div>
      <div className="field">
        <label htmlFor="o-fin">Χρηματοδότηση</label>
        <select id="o-fin" name="financing" className="select" defaultValue="">
          <option value="">—</option>
          {FINANCING_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="o-dep">{isRent ? "Εγγύηση (€)" : "Προκαταβολή (€)"}</label>
        <input id="o-dep" name="deposit" className="input" inputMode="decimal" />
      </div>
      <div className="field">
        <label htmlFor="o-exp">Ισχύει έως</label>
        <input id="o-exp" name="expiresAt" type="date" className="input" />
      </div>
      <div className="field span2">
        <label htmlFor="o-cond">Όροι</label>
        <textarea id="o-cond" name="conditions" className="textarea textarea--sm" maxLength={4000} placeholder="π.χ. παράδοση, έπιπλα, προθεσμίες" />
      </div>
      <div className="span2 row">
        <button type="submit" className="btn btn--primary btn--sm" disabled={pending}>Καταχώριση</button>
        <Msg state={state} />
      </div>
    </form>
  );
}

export function StatusForm({ id, next }: { id: string; next: string[] }) {
  const [state, action, pending] = useActionState(moveTransaction, idleState);
  if (next.length === 0) return null;
  return (
    <form action={action} className="quickform">
      <input type="hidden" name="id" value={id} />
      <div className="field">
        <label htmlFor="s-status">Νέα κατάσταση</label>
        <select id="s-status" name="status" className="select">
          {next.map((s) => <option key={s} value={s}>{TRANSACTION_STATUS_LABELS[s as keyof typeof TRANSACTION_STATUS_LABELS]}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="s-date">Ημερομηνία</label>
        <input id="s-date" name="date" type="date" className="input" />
      </div>
      <div className="field quickform__grow">
        <label htmlFor="s-reason">Αιτιολογία (υποχρεωτική για ακύρωση)</label>
        <input id="s-reason" name="reason" className="input" maxLength={1000} />
      </div>
      <button type="submit" className="btn btn--outline" disabled={pending}>Αλλαγή</button>
      <Msg state={state} />
    </form>
  );
}

export function CalculateForm({ id, manager, recalc }: { id: string; manager: boolean; recalc: boolean }) {
  const [state, action, pending] = useActionState(calculateCommissionAction, idleState);
  return (
    <form action={action} className="quickform">
      <input type="hidden" name="id" value={id} />
      {manager && (
        <>
          <div className="field">
            <label htmlFor="c-rate">Ειδικό ποσοστό / μήνες</label>
            <input id="c-rate" name="overrideRate" className="input" inputMode="decimal" placeholder="κενό = Ρυθμίσεις" />
          </div>
          <div className="field quickform__grow">
            <label htmlFor="c-why">Λόγος ειδικού ποσοστού</label>
            <input id="c-why" name="overrideReason" className="input" maxLength={500} />
          </div>
        </>
      )}
      <button type="submit" className="btn btn--primary btn--sm" disabled={pending}>{recalc ? "Επανυπολογισμός" : "Υπολογισμός προμήθειας"}</button>
      <Msg state={state} />
    </form>
  );
}

export function CommissionStatusForm({ id, status, invoiceNumber, dueDate, paidAmount }: { id: string; status: string; invoiceNumber: string | null; dueDate: string | null; paidAmount: number | null }) {
  const [state, action, pending] = useActionState(updateCommissionAction, idleState);
  return (
    <form action={action} className="quickform">
      <input type="hidden" name="id" value={id} />
      <div className="field">
        <label htmlFor="cs-status">Πληρωμή</label>
        <select id="cs-status" name="status" className="select" defaultValue={status}>
          {COMMISSION_STATUSES.map((s) => <option key={s} value={s}>{COMMISSION_STATUS_LABELS[s]}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="cs-inv">Αρ. παραστατικού</label>
        <input id="cs-inv" name="invoiceNumber" className="input" defaultValue={invoiceNumber ?? ""} maxLength={60} />
      </div>
      <div className="field">
        <label htmlFor="cs-due">Λήξη πληρωμής</label>
        <input id="cs-due" name="dueDate" type="date" className="input" defaultValue={dueDate ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="cs-paid">Εξοφλημένο (€)</label>
        <input id="cs-paid" name="paidAmount" className="input" inputMode="decimal" defaultValue={paidAmount ?? ""} />
        {err(state, "paidAmount") && <span className="error">{err(state, "paidAmount")}</span>}
      </div>
      <button type="submit" className="btn btn--outline btn--sm" disabled={pending}>Αποθήκευση</button>
      <Msg state={state} />
    </form>
  );
}

export function ChecklistAddForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(addChecklistItem, idleState);
  return (
    <form action={action} className="quickform">
      <input type="hidden" name="id" value={id} />
      <div className="field quickform__grow">
        <label htmlFor="cl-label">Νέο έγγραφο</label>
        <input id="cl-label" name="label" className="input" maxLength={200} placeholder="π.χ. Ενεργειακό πιστοποιητικό" required />
      </div>
      <button type="submit" className="btn btn--outline btn--sm" disabled={pending}>Προσθήκη</button>
      <Msg state={state} />
    </form>
  );
}

export function NoteForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(addTransactionNote, idleState);
  return (
    <form action={action} className="quickform">
      <input type="hidden" name="id" value={id} />
      <div className="field quickform__grow">
        <label htmlFor="n-text">Σημείωση στο χρονολόγιο</label>
        <input id="n-text" name="text" className="input" maxLength={4000} required />
      </div>
      <button type="submit" className="btn btn--outline btn--sm" disabled={pending}>Καταγραφή</button>
      <Msg state={state} />
    </form>
  );
}

export const CHECKLIST_LABELS = CHECKLIST_STATUS_LABELS;
