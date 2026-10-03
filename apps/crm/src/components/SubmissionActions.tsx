"use client";

import { useActionState } from "react";

import { convertSubmission, updateSubmission } from "@/actions/submissions";
import { idleState } from "@/lib/form";
import { SUBMISSION_STATUS_LABEL } from "@/lib/labels";

type Sub = { id: string; status: string; titleEl: string; descriptionEl: string; price: number | null; area: number | null; bedrooms: number | null; city: string | null; neighborhood: string | null; assignedToId: string | null };

/** Statuses an agent can set by hand. PROPERTY_CREATED comes only from converting. */
const MANUAL = ["UNDER_REVIEW", "CONTACTED", "VALUATION", "ASSIGNMENT", "APPROVED", "PUBLISHED", "REJECTED", "ARCHIVED"];

export function SubmissionActions({ submission, meId, convertible, photos }: { submission: Sub; meId: string; convertible: boolean; photos: Array<{ id: string; fileName: string | null }> }) {
  const [upState, upAction, upPending] = useActionState(updateSubmission, idleState);
  const [cvState, cvAction, cvPending] = useActionState(convertSubmission, idleState);

  return (
    <div className="panel">
      <h2>Ενέργειες</h2>

      <form action={upAction} className="sform">
        <input type="hidden" name="id" value={submission.id} />
        <input type="hidden" name="me" value={meId} />
        {upState.message && <div className={upState.ok ? "notice notice--ok" : "notice notice--danger"} role={upState.ok ? "status" : "alert"}>{upState.message}</div>}
        <div className="field">
          <label htmlFor="status">Κατάσταση</label>
          <select id="status" name="status" className="select" defaultValue="">
            <option value="">— Χωρίς αλλαγή —</option>
            {MANUAL.filter((s) => s !== submission.status).map((s) => <option key={s} value={s}>{SUBMISSION_STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="note">Σημείωση (λόγος απόρριψης ή εσωτερική)</label>
          <textarea id="note" name="note" className="textarea" rows={2} maxLength={2000} />
        </div>
        {submission.assignedToId !== meId && (
          <label className="check"><input type="checkbox" name="assignToMe" value="1" /> <span>Ανάληψη από εμένα</span></label>
        )}
        <button type="submit" className="btn btn--outline" disabled={upPending}>{upPending ? "Αποθήκευση…" : "Ενημέρωση"}</button>
      </form>

      {convertible && (
        <form action={cvAction} className="sform" style={{ marginTop: 24 }}>
          <input type="hidden" name="id" value={submission.id} />
          <h3>Δημιουργία ή σύνδεση ακινήτου</h3>
          <p className="hint">Ελέγξτε και διορθώστε τα στοιχεία. Το ακίνητο δημιουργείται ως πρόχειρο και δεν δημοσιεύεται· οι φωτογραφίες μεταφέρονται, δεν αντιγράφονται.</p>
          {cvState.message && <div className="notice notice--danger" role="alert">{cvState.message}</div>}

          <fieldset className="sform__group">
            <legend>Τρόπος</legend>
            <label className="check"><input type="radio" name="mode" value="create" defaultChecked /> <span>Δημιουργία νέου ακινήτου</span></label>
            <label className="check"><input type="radio" name="mode" value="link" /> <span>Σύνδεση με υπάρχον ακίνητο</span></label>
            <div className="field">
              <label htmlFor="propertyReference">Κωδικός υπάρχοντος ακινήτου (για σύνδεση)</label>
              <input id="propertyReference" name="propertyReference" className="input mono" placeholder="H88-000123" />
            </div>
          </fieldset>

          <fieldset className="sform__group">
            <legend>Στοιχεία νέου ακινήτου</legend>
            <div className="field"><label htmlFor="titleEl">Τίτλος</label><input id="titleEl" name="titleEl" className="input" defaultValue={submission.titleEl} maxLength={200} /></div>
            <div className="field"><label htmlFor="descriptionEl">Περιγραφή</label><textarea id="descriptionEl" name="descriptionEl" className="textarea" rows={4} defaultValue={submission.descriptionEl} /></div>
            <div className="formgrid">
              <div className="field"><label htmlFor="price">Τιμή (€)</label><input id="price" name="price" inputMode="decimal" className="input" defaultValue={submission.price ?? ""} /></div>
              <div className="field"><label htmlFor="area">Εμβαδόν (τ.μ.)</label><input id="area" name="area" inputMode="decimal" className="input" defaultValue={submission.area ?? ""} /></div>
              <div className="field"><label htmlFor="bedrooms">Υπνοδωμάτια</label><input id="bedrooms" name="bedrooms" inputMode="numeric" className="input" defaultValue={submission.bedrooms ?? ""} /></div>
              <div className="field"><label htmlFor="city">Πόλη</label><input id="city" name="city" className="input" defaultValue={submission.city ?? ""} /></div>
              <div className="field"><label htmlFor="neighborhood">Γειτονιά</label><input id="neighborhood" name="neighborhood" className="input" defaultValue={submission.neighborhood ?? ""} /></div>
            </div>
          </fieldset>

          {photos.length > 0 && (
            <fieldset className="sform__group">
              <legend>Φωτογραφίες που θα συνδεθούν</legend>
              <div className="checkgrid checkgrid--tight">
                {photos.map((p, i) => (
                  <label key={p.id} className="check"><input type="checkbox" name="mediaId" value={p.id} defaultChecked /> <span>{p.fileName ?? `Φωτογραφία ${i + 1}`}</span></label>
                ))}
              </div>
              <p className="hint">Παραμένουν «σε αναμονή ελέγχου» μέχρι να εγκριθούν από υπεύθυνο. Τα έγγραφα δεν γίνονται ποτέ δημόσια πολυμέσα.</p>
            </fieldset>
          )}

          <button type="submit" className="btn btn--primary" disabled={cvPending}>{cvPending ? "Επεξεργασία…" : "Συνέχεια"}</button>
        </form>
      )}
    </div>
  );
}
