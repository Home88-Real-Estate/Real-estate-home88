"use client";

import { useActionState } from "react";
import { CONDITION_LABELS, SELLER_MOTIVATIONS, SELLER_STAGE_LABELS, SELLER_TIMEFRAMES, type SellerStage } from "@home88/domain";
import { PROPERTY_TYPE_LABELS, label } from "@home88/types";

import {
  addExternalComparable,
  addSellerNote,
  createSeller,
  createValuation,
  finalizeValuation,
  linkSellerProperty,
  moveSeller,
  updateComparable,
  updateSeller,
  updateValuationSubject,
} from "@/actions/sellers";
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

export type SellerDetails = {
  listingType: string;
  propertyType: string | null;
  city: string | null;
  areaName: string | null;
  address: string | null;
  area: number | null;
  bedrooms: number | null;
  floor: number | null;
  yearBuilt: number | null;
  condition: string | null;
  askingPrice: number | null;
  motivation: string | null;
  timeframe: string | null;
  source: string | null;
  nextFollowUpAt: string | null;
  notes: string | null;
};

const v = (x: unknown) => (x == null ? "" : String(x));

/** Property description fields shared by the owner and valuation forms. */
function SubjectFields({ state, d, prefix, typeRequired }: { state: ActionState; d?: Partial<SellerDetails>; prefix: string; typeRequired?: boolean }) {
  return (
    <>
      <div className="field">
        <label htmlFor={`${prefix}-type`}>Τύπος ακινήτου{typeRequired ? " *" : ""}</label>
        <select id={`${prefix}-type`} name="propertyType" className="select" defaultValue={v(d?.propertyType)} required={typeRequired}>
          <option value="">—</option>
          {Object.keys(PROPERTY_TYPE_LABELS).map((k) => <option key={k} value={k}>{label(PROPERTY_TYPE_LABELS, k, "el")}</option>)}
        </select>
        <FieldError state={state} name="propertyType" />
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-area`}>Εμβαδόν (m²)</label>
        <input id={`${prefix}-area`} name="area" type="number" min="1" step="0.01" className="input" defaultValue={v(d?.area)} />
        <FieldError state={state} name="area" />
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-city`}>Πόλη</label>
        <input id={`${prefix}-city`} name="city" className="input" maxLength={120} defaultValue={v(d?.city)} />
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-areaName`}>Περιοχή</label>
        <input id={`${prefix}-areaName`} name="areaName" className="input" maxLength={120} defaultValue={v(d?.areaName)} />
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-bed`}>Υπνοδωμάτια</label>
        <input id={`${prefix}-bed`} name="bedrooms" type="number" min="0" max="50" className="input" defaultValue={v(d?.bedrooms)} />
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-floor`}>Όροφος</label>
        <input id={`${prefix}-floor`} name="floor" type="number" min="-5" max="100" className="input" defaultValue={v(d?.floor)} />
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-year`}>Έτος κατασκευής</label>
        <input id={`${prefix}-year`} name="yearBuilt" type="number" min="1800" max="2100" className="input" defaultValue={v(d?.yearBuilt)} />
        <FieldError state={state} name="yearBuilt" />
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-cond`}>Κατάσταση</label>
        <select id={`${prefix}-cond`} name="condition" className="select" defaultValue={v(d?.condition)}>
          <option value="">—</option>
          {Object.entries(CONDITION_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
    </>
  );
}

function OwnerFields({ state, d, prefix }: { state: ActionState; d?: Partial<SellerDetails>; prefix: string }) {
  return (
    <>
      <div className="field">
        <label htmlFor={`${prefix}-lt`}>Ενδιαφέρον *</label>
        <select id={`${prefix}-lt`} name="listingType" className="select" defaultValue={d?.listingType ?? "SALE"}>
          <option value="SALE">Πώληση</option>
          <option value="RENT">Ενοικίαση</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-ask`}>Τιμή που ζητά ο ιδιοκτήτης (€)</label>
        <input id={`${prefix}-ask`} name="askingPrice" type="number" min="1" step="1" className="input" defaultValue={v(d?.askingPrice)} />
        <FieldError state={state} name="askingPrice" />
      </div>
      <SubjectFields state={state} d={d} prefix={prefix} />
      <div className="field span2">
        <label htmlFor={`${prefix}-addr`}>Διεύθυνση</label>
        <input id={`${prefix}-addr`} name="address" className="input" maxLength={200} defaultValue={v(d?.address)} />
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-mot`}>Κίνητρο</label>
        <select id={`${prefix}-mot`} name="motivation" className="select" defaultValue={v(d?.motivation)}>
          <option value="">—</option>
          {SELLER_MOTIVATIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-tf`}>Χρονικός ορίζοντας</label>
        <select id={`${prefix}-tf`} name="timeframe" className="select" defaultValue={v(d?.timeframe)}>
          <option value="">—</option>
          {SELLER_TIMEFRAMES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-src`}>Πηγή</label>
        <input id={`${prefix}-src`} name="source" className="input" maxLength={120} placeholder="π.χ. σύσταση, πινακίδα" defaultValue={v(d?.source)} />
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-fu`}>Επόμενη επικοινωνία</label>
        <input id={`${prefix}-fu`} name="nextFollowUpAt" type="date" className="input" defaultValue={d?.nextFollowUpAt ? d.nextFollowUpAt.slice(0, 10) : ""} />
        <span className="hint">Δημιουργεί υπενθύμιση.</span>
      </div>
      <div className="field span2">
        <label htmlFor={`${prefix}-notes`}>Σημειώσεις</label>
        <textarea id={`${prefix}-notes`} name="notes" className="textarea textarea--sm" maxLength={4000} defaultValue={v(d?.notes)} />
      </div>
    </>
  );
}

export function NewSellerForm() {
  const [state, action, pending] = useActionState(createSeller, idleState);
  return (
    <form action={action} className="formgrid">
      {state.message && !state.ok && <div className="notice notice--danger span2" role="alert">{state.message}</div>}
      <fieldset className="span2 fieldset">
        <legend>Ιδιοκτήτης</legend>
        <div className="formgrid">
          <div className="field">
            <label htmlFor="s-first">Όνομα</label>
            <input id="s-first" name="firstName" className="input" maxLength={80} />
            <FieldError state={state} name="firstName" />
          </div>
          <div className="field">
            <label htmlFor="s-last">Επώνυμο</label>
            <input id="s-last" name="lastName" className="input" maxLength={80} />
          </div>
          <div className="field">
            <label htmlFor="s-phone">Τηλέφωνο</label>
            <input id="s-phone" name="phone" type="tel" className="input" maxLength={40} />
          </div>
          <div className="field">
            <label htmlFor="s-email">Email</label>
            <input id="s-email" name="email" type="email" className="input" maxLength={254} />
            <FieldError state={state} name="email" />
          </div>
          <div className="field">
            <label htmlFor="s-cref">ή κωδικός υπάρχουσας επαφής</label>
            <input id="s-cref" name="contactReference" className="input mono" placeholder="C-000123" />
            <FieldError state={state} name="contactReference" />
          </div>
          <div className="field">
            <label htmlFor="s-pref">Κωδικός ακινήτου (αν υπάρχει)</label>
            <input id="s-pref" name="propertyReference" className="input mono" placeholder="H88-000123" />
            <FieldError state={state} name="propertyReference" />
          </div>
        </div>
        <p className="hint">Τα στοιχεία επικοινωνίας αποθηκεύονται κρυπτογραφημένα. Με ίδιο email χρησιμοποιείται η υπάρχουσα επαφή.</p>
      </fieldset>
      <OwnerFields state={state} prefix="s" />
      <div className="span2 row">
        <button type="submit" className="btn btn--primary" disabled={pending}>{pending ? "Αποθήκευση…" : "Καταχώριση ιδιοκτήτη"}</button>
      </div>
    </form>
  );
}

export function EditSellerForm({ id, d }: { id: string; d: SellerDetails }) {
  const [state, action, pending] = useActionState(updateSeller, idleState);
  return (
    <form action={action} className="formgrid">
      <input type="hidden" name="id" value={id} />
      <OwnerFields state={state} d={d} prefix="e" />
      <div className="span2 row">
        <button type="submit" className="btn btn--primary btn--sm" disabled={pending}>Αποθήκευση</button>
        <Msg state={state} />
      </div>
    </form>
  );
}

export function SellerStageForm({ id, stages, hasProperty }: { id: string; stages: SellerStage[]; hasProperty: boolean }) {
  const [state, action, pending] = useActionState(moveSeller, idleState);
  return (
    <form action={action} className="quickform">
      <input type="hidden" name="id" value={id} />
      <div className="row">
        <select name="stage" className="select select--sm" aria-label="Νέο στάδιο" defaultValue={stages[0]}>
          {stages.map((s) => <option key={s} value={s}>{SELLER_STAGE_LABELS[s]}</option>)}
        </select>
        <input name="reason" className="input input--sm" placeholder="Λόγος (για «Χάθηκε»)" maxLength={1000} />
        {!hasProperty && <input name="propertyReference" className="input input--sm mono" placeholder="Κωδικός ακινήτου (για «Καταχωρήθηκε»)" maxLength={20} />}
        <button type="submit" className="btn btn--outline btn--sm" disabled={pending}>Αλλαγή σταδίου</button>
      </div>
      <FieldError state={state} name="reason" />
      <FieldError state={state} name="propertyReference" />
      <Msg state={state} />
    </form>
  );
}

export function LinkPropertyForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(linkSellerProperty, idleState);
  return (
    <form action={action} className="quickform">
      <input type="hidden" name="id" value={id} />
      <div className="row">
        <input name="propertyReference" className="input input--sm mono" placeholder="H88-000123" aria-label="Κωδικός ακινήτου" required maxLength={20} />
        <button type="submit" className="btn btn--outline btn--sm" disabled={pending}>Σύνδεση ακινήτου</button>
      </div>
      <FieldError state={state} name="propertyReference" />
      <Msg state={state} />
    </form>
  );
}

export function SellerNoteForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(addSellerNote, idleState);
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

// --- Valuations -------------------------------------------------------------------

export function NewValuationForm({ sellerLeadId, propertyReference }: { sellerLeadId?: string; propertyReference?: string }) {
  const [state, action, pending] = useActionState(createValuation, idleState);
  return (
    <form action={action} className="formgrid">
      {state.message && !state.ok && <div className="notice notice--danger span2" role="alert">{state.message}</div>}
      {sellerLeadId && <input type="hidden" name="sellerLeadId" value={sellerLeadId} />}
      <div className="field">
        <label htmlFor="v-ref">Κωδικός ακινήτου</label>
        <input id="v-ref" name="propertyReference" className="input mono" defaultValue={propertyReference} placeholder="H88-000123" />
        <span className="hint">Τα στοιχεία συμπληρώνονται από το ακίνητο{sellerLeadId ? " ή τον ιδιοκτήτη" : ""}. Ό,τι γράψετε παρακάτω υπερισχύει.</span>
        <FieldError state={state} name="propertyReference" />
      </div>
      <div className="field">
        <label htmlFor="v-lt">Είδος</label>
        <select id="v-lt" name="listingType" className="select" defaultValue="">
          <option value="">Από το ακίνητο / ιδιοκτήτη</option>
          <option value="SALE">Πώληση (τιμή)</option>
          <option value="RENT">Ενοικίαση (μίσθωμα)</option>
        </select>
        <FieldError state={state} name="listingType" />
      </div>
      <SubjectFields state={state} prefix="v" />
      <div className="span2 row">
        <button type="submit" className="btn btn--primary" disabled={pending}>{pending ? "Δημιουργία…" : "Νέα εκτίμηση"}</button>
      </div>
    </form>
  );
}

export function SubjectForm({ id, d }: { id: string; d: Partial<SellerDetails> }) {
  const [state, action, pending] = useActionState(updateValuationSubject, idleState);
  return (
    <form action={action} className="formgrid">
      <input type="hidden" name="id" value={id} />
      <SubjectFields state={state} d={d} prefix="sub" typeRequired />
      <div className="span2 row">
        <button type="submit" className="btn btn--primary btn--sm" disabled={pending}>Αποθήκευση</button>
        <Msg state={state} />
      </div>
    </form>
  );
}

export function ExternalComparableForm({ id, isRent }: { id: string; isRent: boolean }) {
  const [state, action, pending] = useActionState(addExternalComparable, idleState);
  return (
    <form action={action} className="formgrid">
      <input type="hidden" name="id" value={id} />
      <div className="field">
        <label htmlFor="x-label">Περιγραφή *</label>
        <input id="x-label" name="label" className="input" required maxLength={160} placeholder="π.χ. Διαμέρισμα 2ος, 95 m²" />
        <FieldError state={state} name="label" />
      </div>
      <div className="field">
        <label htmlFor="x-origin">Πηγή *</label>
        <input id="x-origin" name="origin" className="input" required maxLength={200} placeholder="π.χ. αγγελία, συμβόλαιο, συνεργάτης" />
        <FieldError state={state} name="origin" />
      </div>
      <div className="field">
        <label htmlFor="x-price">{isRent ? "Μίσθωμα (€/μήνα) *" : "Τιμή (€) *"}</label>
        <input id="x-price" name="price" type="number" min="1" step="1" className="input" required />
        <FieldError state={state} name="price" />
      </div>
      <div className="field">
        <label htmlFor="x-area">Εμβαδόν (m²) *</label>
        <input id="x-area" name="area" type="number" min="1" step="0.01" className="input" required />
        <FieldError state={state} name="area" />
      </div>
      <div className="field">
        <label htmlFor="x-areaName">Περιοχή</label>
        <input id="x-areaName" name="areaName" className="input" maxLength={120} />
      </div>
      <div className="field">
        <label htmlFor="x-date">Ημερομηνία</label>
        <input id="x-date" name="observedAt" type="date" className="input" />
      </div>
      <div className="field">
        <label htmlFor="x-adj">Προσαρμογή (%)</label>
        <input id="x-adj" name="adjustmentPct" type="number" min="-50" max="50" step="0.5" className="input" defaultValue="0" />
        <FieldError state={state} name="adjustmentPct" />
      </div>
      <div className="field">
        <label htmlFor="x-reason">Λόγος προσαρμογής</label>
        <input id="x-reason" name="adjustmentReason" className="input" maxLength={300} />
        <FieldError state={state} name="adjustmentReason" />
      </div>
      <div className="span2 row">
        <button type="submit" className="btn btn--outline btn--sm" disabled={pending}>Προσθήκη συγκριτικού</button>
        <Msg state={state} />
      </div>
    </form>
  );
}

export function AdjustmentForm({ id, cid, pct, reason }: { id: string; cid: string; pct: number; reason: string | null }) {
  const [state, action, pending] = useActionState(updateComparable, idleState);
  return (
    <form action={action} className="adjust">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="cid" value={cid} />
      <input name="adjustmentPct" type="number" min="-50" max="50" step="0.5" className="input input--sm adjust__pct" defaultValue={pct} aria-label="Προσαρμογή %" />
      <input name="adjustmentReason" className="input input--sm" defaultValue={reason ?? ""} placeholder="Λόγος" aria-label="Λόγος προσαρμογής" maxLength={300} />
      <button type="submit" className="btn btn--ghost btn--sm" disabled={pending}>OK</button>
      {state.message && !state.ok && <span className="error">{err(state, "adjustmentReason") ?? state.message}</span>}
    </form>
  );
}

export function FinalizeForm({ id, suggested }: { id: string; suggested: number | null }) {
  const [state, action, pending] = useActionState(finalizeValuation, idleState);
  return (
    <form action={action} className="formgrid">
      <input type="hidden" name="id" value={id} />
      <div className="field">
        <label htmlFor="f-price">Προτεινόμενη τιμή (€) *</label>
        <input id="f-price" name="recommendedPrice" type="number" min="1" step="1" className="input" defaultValue={suggested ?? ""} required />
        <FieldError state={state} name="recommendedPrice" />
      </div>
      <div className="field span2">
        <label htmlFor="f-why">Σκεπτικό *</label>
        <textarea id="f-why" name="rationale" className="textarea textarea--sm" required maxLength={4000} placeholder="Γιατί αυτή η τιμή, με βάση τα συγκριτικά." />
        <FieldError state={state} name="rationale" />
      </div>
      <div className="span2 row">
        <button type="submit" className="btn btn--primary btn--sm" disabled={pending}>Οριστικοποίηση</button>
        <span className="hint">Μετά την οριστικοποίηση η εκτίμηση δεν αλλάζει· για αναθεώρηση δημιουργείτε αντίγραφο.</span>
        <Msg state={state} />
      </div>
    </form>
  );
}
