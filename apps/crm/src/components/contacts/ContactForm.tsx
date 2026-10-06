"use client";

import Link from "next/link";
import { useActionState } from "react";

import { createContact, updateContact, type ContactActionState } from "@/actions/contacts";
import { CONTACT_ROLE_LABEL, PREFERRED_METHOD_LABEL, type DirectoryUser } from "@/lib/contacts";
import { idleState } from "@/lib/form";

export type ContactValues = {
  id?: string;
  firstName?: string;
  lastName?: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  workPhone?: string | null;
  city?: string | null;
  postalCode?: string | null;
  taxId?: string | null;
  address?: string | null;
  roles?: string[];
  preferredContactMethod?: string;
  preferredLocale?: string;
  status?: string;
  assignedToId?: string | null;
  sensitiveHidden?: boolean;
};

const v = (x: unknown) => (x == null ? "" : String(x));

function F({ name, label, values, error, type = "text", span }: { name: string; label: string; values?: ContactValues; error?: string; type?: string; span?: boolean }) {
  return (
    <div className={`field${span ? " span2" : ""}`}>
      <label htmlFor={name}>{label}</label>
      <input id={name} name={name} type={type} className="input" defaultValue={v(values?.[name as keyof ContactValues])} autoComplete="off" aria-invalid={error ? true : undefined} />
      {error && <span className="error">{error}</span>}
    </div>
  );
}

export function ContactForm({ values, users, currentUserId }: { values?: ContactValues; users: DirectoryUser[]; currentUserId: string }) {
  const editing = Boolean(values?.id);
  const [state, action, pending] = useActionState<ContactActionState, FormData>(editing ? updateContact : createContact, idleState);
  const err = (k: string) => state.fields?.[k]?.[0];
  return (
    <form action={action} className="panel" noValidate>
      {editing && <input type="hidden" name="id" value={values!.id} />}
      {values?.sensitiveHidden && <input type="hidden" name="sensitiveHidden" value="1" />}

      <h2>Βασικά</h2>
      <div className="formgrid">
        <F values={values} error={err("firstName")} name="firstName" label="Όνομα" />
        <F values={values} error={err("lastName")} name="lastName" label="Επώνυμο" />
        <F values={values} error={err("company")} name="company" label="Εταιρεία" span />
        <F values={values} error={err("email")} name="email" label="Email" type="email" />
        <F values={values} error={err("mobile")} name="mobile" label="Κινητό" type="tel" />
        <F values={values} error={err("phone")} name="phone" label="Τηλέφωνο" type="tel" />
        <F values={values} error={err("workPhone")} name="workPhone" label="Τηλέφωνο εργασίας" type="tel" />
        <F values={values} error={err("city")} name="city" label="Πόλη" />
        <F values={values} error={err("postalCode")} name="postalCode" label="Τ.Κ." />
      </div>

      <h2 style={{ marginTop: 20 }}>Σχέση και διαχείριση</h2>
      <div className="formgrid">
        <fieldset className="fieldset span2">
          <legend>Σχέση με το γραφείο</legend>
          <div className="row" style={{ flexWrap: "wrap", gap: 16 }}>
            {Object.entries(CONTACT_ROLE_LABEL).map(([value, label]) => (
              <label key={value} className="check">
                <input type="checkbox" name="roles" value={value} defaultChecked={values?.roles?.includes(value)} /> {label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="field">
          <label htmlFor="assignedToId">Διαχειριστής</label>
          <select id="assignedToId" name="assignedToId" className="select" defaultValue={editing ? v(values?.assignedToId) : currentUserId}>
            <option value="">Χωρίς διαχειριστή</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
          {err("assignedToId") && <span className="error">{err("assignedToId")}</span>}
        </div>
        <div className="field">
          <label htmlFor="status">Κατάσταση</label>
          <select id="status" name="status" className="select" defaultValue={values?.status ?? "ACTIVE"}>
            <option value="ACTIVE">Ενεργή</option>
            <option value="INACTIVE">Ανενεργή</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="preferredContactMethod">Προτιμώμενη επικοινωνία</label>
          <select id="preferredContactMethod" name="preferredContactMethod" className="select" defaultValue={values?.preferredContactMethod ?? "ANY"}>
            {Object.entries(PREFERRED_METHOD_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="preferredLocale">Γλώσσα</label>
          <select id="preferredLocale" name="preferredLocale" className="select" defaultValue={values?.preferredLocale ?? "el"}>
            <option value="el">Ελληνικά</option>
            <option value="en">English</option>
          </select>
        </div>
      </div>

      {!values?.sensitiveHidden && (
        <>
          <h2 style={{ marginTop: 20 }}>Οικονομικά και ταυτότητα</h2>
          <p className="muted" style={{ marginTop: 0 }}>Αποθηκεύονται κρυπτογραφημένα και εμφανίζονται μόνο σε όσους έχουν δικαίωμα.</p>
          <div className="formgrid">
            <F values={values} error={err("taxId")} name="taxId" label="ΑΦΜ" />
            <F values={values} error={err("address")} name="address" label="Διεύθυνση κατοικίας" />
          </div>
        </>
      )}

      {state.message && !state.ok && <div className="notice notice--danger" role="alert">{state.message}</div>}
      {state.duplicates && state.duplicates.length > 0 && (
        <div className="notice" role="alert">
          <strong>Πιθανή διπλοεγγραφή.</strong>
          <ul style={{ margin: "6px 0" }}>
            {state.duplicates.map((d) => (
              <li key={d.id}><Link href={`/contacts/${d.id}`} target="_blank">{d.reference} · {`${d.firstName} ${d.lastName}`.trim()}</Link></li>
            ))}
          </ul>
          <label className="check"><input type="checkbox" name="confirmDuplicate" /> Έλεγξα, είναι διαφορετικό πρόσωπο· δημιουργία νέας επαφής</label>
        </div>
      )}

      <div className="row" style={{ marginTop: 16, gap: 8 }}>
        <button type="submit" className="btn btn--primary" disabled={pending}>{pending ? "Αποθήκευση…" : editing ? "Αποθήκευση" : "Δημιουργία επαφής"}</button>
        <Link href={editing ? `/contacts/${values!.id}` : "/contacts"} className="btn btn--outline">Άκυρο</Link>
      </div>
    </form>
  );
}
