"use client";

import { useActionState } from "react";
import { MANDATE_TYPES, TEMPLATE_LOCALES } from "@home88/domain";

import { addMandateNote, cancelMandate, createMandate, issueMandate, sendMandate, updateMandate } from "@/actions/mandates";
import { idleState, type ActionState } from "@/lib/form";

function Msg({ state }: { state: ActionState }) {
  if (!state.message) return null;
  return <p className={state.ok ? "quickform__msg ok" : "quickform__msg error"} role="status">{state.message}</p>;
}
const err = (s: ActionState, k: string) => s.fields?.[k]?.[0];
function FieldError({ state, name }: { state: ActionState; name: string }) {
  const e = err(state, name);
  return e ? <span className="error">{e}</span> : null;
}

export type PartyValues = { fullName?: string | null; taxId?: string | null; idNumber?: string | null; address?: string | null; phone?: string | null; email?: string | null };
export type DraftValues = {
  type?: string;
  propertyReference?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  terms?: { price?: number | null; commission?: string | null; viewingDate?: string | null; cadastralCode?: string | null; special?: string | null };
  parties?: PartyValues[];
};

const v = (x: unknown) => (x == null ? "" : String(x));
const day = (x: string | null | undefined) => (x ? x.slice(0, 10) : "");

function PartyRow({ i, p, optional }: { i: number; p?: PartyValues; optional?: boolean }) {
  const n = (k: string) => `party${i}.${k}`;
  return (
    <fieldset className="fieldset span2">
      <legend>{i === 0 ? "Εντολέας" : `Συνεντολέας ${i + 1}`}{optional ? " (προαιρετικά)" : ""}</legend>
      <div className="formgrid">
        <div className="field">
          <label htmlFor={`${n("fullName")}`}>Ονοματεπώνυμο</label>
          <input id={n("fullName")} name={n("fullName")} className="input" maxLength={160} defaultValue={v(p?.fullName)} />
        </div>
        <div className="field">
          <label htmlFor={n("contactReference")}>ή κωδικός επαφής</label>
          <input id={n("contactReference")} name={n("contactReference")} className="input mono" placeholder="C-000123" maxLength={20} />
        </div>
        <div className="field">
          <label htmlFor={n("taxId")}>ΑΦΜ</label>
          <input id={n("taxId")} name={n("taxId")} className="input" maxLength={20} defaultValue={v(p?.taxId)} />
        </div>
        <div className="field">
          <label htmlFor={n("idNumber")}>Αρ. ταυτότητας</label>
          <input id={n("idNumber")} name={n("idNumber")} className="input" maxLength={30} defaultValue={v(p?.idNumber)} />
        </div>
        <div className="field span2">
          <label htmlFor={n("address")}>Διεύθυνση</label>
          <input id={n("address")} name={n("address")} className="input" maxLength={300} defaultValue={v(p?.address)} />
        </div>
        <div className="field">
          <label htmlFor={n("phone")}>Τηλέφωνο</label>
          <input id={n("phone")} name={n("phone")} type="tel" className="input" maxLength={40} defaultValue={v(p?.phone)} />
        </div>
        <div className="field">
          <label htmlFor={n("email")}>Email</label>
          <input id={n("email")} name={n("email")} type="email" className="input" maxLength={254} defaultValue={v(p?.email)} />
        </div>
      </div>
    </fieldset>
  );
}

function DraftFields({ state, d, showType, fromOwner }: { state: ActionState; d?: DraftValues; showType: boolean; fromOwner?: boolean }) {
  const t = d?.terms ?? {};
  return (
    <>
      {showType && (
        <>
          <div className="field">
            <label htmlFor="m-type">Τύπος εντολής *</label>
            <select id="m-type" name="type" className="select" defaultValue={d?.type ?? "EXCLUSIVE_ASSIGNMENT"}>
              {MANDATE_TYPES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="m-locale">Γλώσσα κειμένου</label>
            <select id="m-locale" name="locale" className="select" defaultValue="el">
              {TEMPLATE_LOCALES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
            </select>
          </div>
        </>
      )}
      <div className="field">
        <label htmlFor="m-prop">Κωδικός ακινήτου</label>
        <input id="m-prop" name="propertyReference" className="input mono" placeholder="H88-000123" maxLength={20} defaultValue={v(d?.propertyReference)} />
        <FieldError state={state} name="propertyReference" />
      </div>
      <div className="field">
        <label htmlFor="m-kaek">ΚΑΕΚ</label>
        <input id="m-kaek" name="cadastralCode" className="input mono" maxLength={40} defaultValue={v(t.cadastralCode)} />
      </div>
      <div className="field">
        <label htmlFor="m-start">Έναρξη ισχύος</label>
        <input id="m-start" name="startsAt" type="date" className="input" defaultValue={day(d?.startsAt)} />
      </div>
      <div className="field">
        <label htmlFor="m-end">Λήξη ισχύος</label>
        <input id="m-end" name="endsAt" type="date" className="input" defaultValue={day(d?.endsAt)} />
      </div>
      <div className="field">
        <label htmlFor="m-price">Τιμή (€)</label>
        <input id="m-price" name="price" type="number" min="1" step="1" className="input" defaultValue={v(t.price)} />
      </div>
      <div className="field">
        <label htmlFor="m-comm">Αμοιβή γραφείου (όπως συμφωνήθηκε)</label>
        <input id="m-comm" name="commission" className="input" maxLength={300} defaultValue={v(t.commission)} placeholder="π.χ. όπως συμφωνήθηκε με τον εντολέα" />
      </div>
      <div className="field">
        <label htmlFor="m-view">Ημερομηνία υπόδειξης (εντολή υπόδειξης)</label>
        <input id="m-view" name="viewingDate" type="date" className="input" defaultValue={v(t.viewingDate)} />
      </div>
      <div className="field span2">
        <label htmlFor="m-special">Ειδικοί όροι</label>
        <textarea id="m-special" name="special" className="textarea textarea--sm" maxLength={4000} defaultValue={v(t.special)} />
      </div>
      {fromOwner && !d?.parties?.length && (
        <p className="hint span2">Ο εντολέας συμπληρώνεται από τον ιδιοκτήτη. Συμπληρώστε τα παρακάτω μόνο για να τον αλλάξετε ή να προσθέσετε συνιδιοκτήτη.</p>
      )}
      <PartyRow i={0} p={d?.parties?.[0]} optional={fromOwner} />
      <details className="subpanel span2" open={(d?.parties?.length ?? 0) > 1}>
        <summary>Συνιδιοκτήτες</summary>
        <PartyRow i={1} p={d?.parties?.[1]} optional />
        <PartyRow i={2} p={d?.parties?.[2]} optional />
      </details>
      <p className="hint span2">Τα στοιχεία του εντολέα αποθηκεύονται κρυπτογραφημένα.</p>
    </>
  );
}

export function NewMandateForm({ sellerLeadId, propertyReference, type }: { sellerLeadId?: string; propertyReference?: string; type?: string }) {
  const [state, action, pending] = useActionState(createMandate, idleState);
  return (
    <form action={action} className="formgrid">
      {state.message && !state.ok && <div className="notice notice--danger span2" role="alert">{state.message}</div>}
      {sellerLeadId && <input type="hidden" name="sellerLeadId" value={sellerLeadId} />}
      <DraftFields state={state} d={{ propertyReference, type }} showType fromOwner={!!sellerLeadId} />
      <div className="span2 row">
        <button type="submit" className="btn btn--primary" disabled={pending}>{pending ? "Δημιουργία…" : "Δημιουργία πρόχειρης εντολής"}</button>
      </div>
    </form>
  );
}

export function EditMandateForm({ id, d }: { id: string; d: DraftValues }) {
  const [state, action, pending] = useActionState(updateMandate, idleState);
  return (
    <form action={action} className="formgrid">
      <input type="hidden" name="id" value={id} />
      <DraftFields state={state} d={d} showType={false} />
      <div className="span2 row">
        <button type="submit" className="btn btn--primary btn--sm" disabled={pending}>Αποθήκευση</button>
        <Msg state={state} />
      </div>
    </form>
  );
}

export function IssueForm({ id, disabled }: { id: string; disabled: boolean }) {
  const [state, action, pending] = useActionState(issueMandate, idleState);
  return (
    <form action={action} className="quickform">
      <input type="hidden" name="id" value={id} />
      <div className="row">
        <button type="submit" className="btn btn--primary" disabled={pending || disabled}>{pending ? "Έκδοση…" : "Έκδοση εντολής"}</button>
        <span className="hint">Δίνεται αριθμός, δημιουργείται το PDF και το κείμενο κλειδώνει.</span>
      </div>
      <Msg state={state} />
    </form>
  );
}

export function SendForm({ id, disabled, reason }: { id: string; disabled: boolean; reason?: string }) {
  const [state, action, pending] = useActionState(sendMandate, idleState);
  return (
    <form action={action} className="quickform">
      <input type="hidden" name="id" value={id} />
      <div className="row">
        <button type="submit" className="btn btn--outline btn--sm" disabled={pending || disabled}>Αποστολή για ηλεκτρονική υπογραφή</button>
        {reason && <span className="hint">{reason}</span>}
      </div>
      <Msg state={state} />
    </form>
  );
}

export function CancelForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(cancelMandate, idleState);
  return (
    <form action={action} className="quickform">
      <input type="hidden" name="id" value={id} />
      <div className="row">
        <input name="reason" className="input input--sm" placeholder="Λόγος ακύρωσης" aria-label="Λόγος ακύρωσης" required maxLength={1000} />
        <button type="submit" className="btn btn--ghost btn--sm" disabled={pending}>Ακύρωση εντολής</button>
      </div>
      <FieldError state={state} name="reason" />
      <Msg state={state} />
    </form>
  );
}

export function MandateNoteForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(addMandateNote, idleState);
  return (
    <form action={action} className="quickform">
      <input type="hidden" name="id" value={id} />
      <textarea name="text" className="textarea textarea--sm" placeholder="Σημείωση για το χρονολόγιο" aria-label="Σημείωση" required maxLength={4000} />
      <div className="row">
        <button type="submit" className="btn btn--outline btn--sm" disabled={pending}>Καταγραφή</button>
        <Msg state={state} />
      </div>
    </form>
  );
}
