"use client";

import Link from "next/link";
import { useActionState } from "react";

import { createShowing, updateShowing } from "@/actions/contacts";
import { ContactPicker, type PickedContact } from "@/components/ContactPicker";
import { PropertyPicker, type PickedProperty } from "@/components/PropertyPicker";
import { FEE_BASIS_LABEL, FEE_METHOD_LABEL, FEE_PAYER_LABEL, PAYMENT_TRIGGER_LABEL, VAT_TREATMENT_LABEL, type DirectoryUser } from "@/lib/contacts";
import { idleState } from "@/lib/form";

export type ShowingValues = {
  id?: string;
  contact?: PickedContact | null;
  properties?: PickedProperty[];
  visitDate?: string;
  visitTime?: string;
  responsibleUserId?: string | null;
  comments?: string | null;
  language?: string;
  idNumber?: string | null;
  /** The stored identity number cannot be shown to this user; leave the client's details untouched. */
  partyMasked?: boolean;
  fee?: { payer?: string | null; method?: string | null; basis?: string | null; percentage?: string | number | null; fixedAmount?: string | number | null; currency?: string | null; vatTreatment?: string | null; vatRate?: string | number | null; paymentTrigger?: string | null };
};

const v = (x: unknown) => (x == null ? "" : String(x));

function Select({ name, label, options, value, blank = "Επιλέξτε…" }: { name: string; label: string; options: Record<string, string>; value?: string | null; blank?: string }) {
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <select id={name} name={name} className="select" defaultValue={value ?? ""}>
        <option value="">{blank}</option>
        {Object.entries(options).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    </div>
  );
}

export function ShowingForm({ values, users, currentUserId, canAssign }: { values?: ShowingValues; users: DirectoryUser[]; currentUserId: string; canAssign: boolean }) {
  const editing = Boolean(values?.id);
  const [state, action, pending] = useActionState(editing ? updateShowing : createShowing, idleState);
  const err = (k: string) => state.fields?.[k]?.[0];

  return (
    <form action={action} className="panel" noValidate>
      {editing && <input type="hidden" name="id" value={values!.id} />}
      <div className="formgrid">
        <div className="field span2">
          <ContactPicker initial={values?.contact ?? null} error={err("contactReference")} />
        </div>
        <div className="field">
          <label htmlFor="visitDate">Ημερομηνία</label>
          <input id="visitDate" name="visitDate" type="date" className="input" defaultValue={values?.visitDate ?? ""} />
          {err("visitAt") && <span className="error">{err("visitAt")}</span>}
        </div>
        <div className="field">
          <label htmlFor="visitTime">Ώρα</label>
          <input id="visitTime" name="visitTime" type="time" className="input" defaultValue={values?.visitTime ?? ""} />
        </div>
        <div className="field">
          <label htmlFor="responsibleUserId">Διαχειριστής</label>
          <select id="responsibleUserId" name="responsibleUserId" className="select" defaultValue={values?.responsibleUserId ?? currentUserId} disabled={!canAssign}>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          {!canAssign && <input type="hidden" name="responsibleUserId" value={values?.responsibleUserId ?? currentUserId} />}
          {err("responsibleUserId") && <span className="error">{err("responsibleUserId")}</span>}
        </div>
        <div className="field">
          <label htmlFor="language">Γλώσσα εγγράφου</label>
          <select id="language" name="language" className="select" defaultValue={values?.language ?? "el"}>
            <option value="el">Ελληνικά</option>
            <option value="en">English</option>
          </select>
        </div>
        <div className="field span2">
          <PropertyPicker initial={values?.properties ?? []} error={err("propertyReferences")} />
        </div>
        <div className="field span2">
          <label htmlFor="comments">Σχόλια</label>
          <textarea id="comments" name="comments" className="textarea" rows={3} maxLength={4000} defaultValue={values?.comments ?? ""} />
        </div>
      </div>

      <details className="subpanel" open={editing}>
        <summary>Στοιχεία εγγράφου (απαιτούνται για την έκδοση)</summary>
        <p className="muted small">Συμπληρώνονται από το συμφωνητικό. Δεν υπάρχουν προεπιλεγμένα ποσά ή ποσοστά.</p>
        {values?.partyMasked && <input type="hidden" name="partyMasked" value="1" />}
        <div className="formgrid">
          {!values?.partyMasked && (
            <div className="field">
              <label htmlFor="idNumber">Αριθμός ταυτότητας / διαβατηρίου πελάτη</label>
              <input id="idNumber" name="idNumber" className="input" maxLength={30} defaultValue={v(values?.idNumber)} autoComplete="off" />
            </div>
          )}
          <Select name="feePayer" label="Ποιος καταβάλλει την αμοιβή" options={FEE_PAYER_LABEL} value={values?.fee?.payer} />
          <Select name="feeMethod" label="Τρόπος υπολογισμού" options={FEE_METHOD_LABEL} value={values?.fee?.method} />
          <Select name="feeBasis" label="Βάση υπολογισμού" options={FEE_BASIS_LABEL} value={values?.fee?.basis} />
          <div className="field"><label htmlFor="feePercentage">Ποσοστό (%)</label><input id="feePercentage" name="feePercentage" inputMode="decimal" className="input" defaultValue={v(values?.fee?.percentage)} /></div>
          <div className="field"><label htmlFor="feeFixedAmount">Σταθερό ποσό</label><input id="feeFixedAmount" name="feeFixedAmount" inputMode="decimal" className="input" defaultValue={v(values?.fee?.fixedAmount)} /></div>
          <Select name="feeCurrency" label="Νόμισμα" options={{ EUR: "Ευρώ (EUR)" }} value={values?.fee?.currency} />
          <Select name="vatTreatment" label="ΦΠΑ" options={VAT_TREATMENT_LABEL} value={values?.fee?.vatTreatment} />
          <div className="field"><label htmlFor="vatRate">Συντελεστής ΦΠΑ (%)</label><input id="vatRate" name="vatRate" inputMode="decimal" className="input" defaultValue={v(values?.fee?.vatRate)} /></div>
          <Select name="paymentTrigger" label="Πότε οφείλεται" options={PAYMENT_TRIGGER_LABEL} value={values?.fee?.paymentTrigger} />
        </div>
        {Object.keys(state.fields ?? {}).filter((k) => k.startsWith("fee") || k === "vatRate" || k === "vatTreatment").map((k) => <p key={k} className="error">{state.fields![k]![0]}</p>)}
      </details>

      {!editing && (
        <details className="subpanel">
          <summary>+ Προσθήκη υπενθύμισης</summary>
          <div className="formgrid">
            <label className="check span2"><input type="checkbox" name="addReminder" /> Δημιουργία υπενθύμισης για αυτή την υπόδειξη</label>
            <div className="field"><label htmlFor="reminderTitle">Τίτλος</label><input id="reminderTitle" name="reminderTitle" className="input" defaultValue="Follow-up υπόδειξης" maxLength={200} /></div>
            <div className="field"><label htmlFor="reminderAt">Πότε</label><input id="reminderAt" name="reminderAt" type="datetime-local" className="input" /></div>
          </div>
        </details>
      )}

      {state.message && !state.ok && <div className="notice notice--danger" role="alert">{state.message}</div>}
      <div className="row" style={{ marginTop: 16, gap: 8 }}>
        <button type="submit" className="btn btn--primary" disabled={pending}>{pending ? "Αποθήκευση…" : "Αποθήκευση"}</button>
        <Link href={editing ? `/showings/${values!.id}` : "/showings"} className="btn btn--outline">Άκυρο</Link>
      </div>
    </form>
  );
}
