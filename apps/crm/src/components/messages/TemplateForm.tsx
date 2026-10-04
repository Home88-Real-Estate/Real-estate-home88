"use client";

import { useActionState, useState } from "react";

import { saveTemplate } from "@/actions/messages";
import { idleState } from "@/lib/form";

type T = { id?: string; name?: string; channel?: string; purpose?: string; subject?: string | null; body?: string };

export function TemplateForm({ t }: { t?: T }) {
  const [state, action, pending] = useActionState(saveTemplate, idleState);
  const [channel, setChannel] = useState(t?.channel ?? "EMAIL");
  const err = (k: string) => state.fields?.[k]?.[0];
  const p = t?.id ?? "new";
  return (
    <form action={action} className="formgrid">
      {t?.id && <input type="hidden" name="id" value={t.id} />}
      <div className="field">
        <label htmlFor={`${p}-name`}>Όνομα</label>
        <input id={`${p}-name`} name="name" className="input" required maxLength={120} defaultValue={t?.name} placeholder="π.χ. Επιβεβαίωση ραντεβού" />
        {err("name") && <span className="error">{err("name")}</span>}
      </div>
      <div className="field">
        <label htmlFor={`${p}-ch`}>Κανάλι</label>
        <select id={`${p}-ch`} name="channel" className="select" value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="EMAIL">Email</option>
          <option value="SMS">SMS</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${p}-purpose`}>Είδος</label>
        <select id={`${p}-purpose`} name="purpose" className="select" defaultValue={t?.purpose ?? "SERVICE"}>
          <option value="SERVICE">Εξυπηρέτηση</option>
          <option value="MARKETING">Προώθηση (απαιτεί συγκατάθεση, προστίθεται σύνδεσμος διαγραφής)</option>
        </select>
      </div>
      {channel === "EMAIL" && (
        <div className="field">
          <label htmlFor={`${p}-subject`}>Θέμα</label>
          <input id={`${p}-subject`} name="subject" className="input" maxLength={200} defaultValue={t?.subject ?? ""} />
          {err("subject") && <span className="error">{err("subject")}</span>}
        </div>
      )}
      <div className="field span2">
        <label htmlFor={`${p}-body`}>Κείμενο</label>
        <textarea id={`${p}-body`} name="body" className="textarea" required maxLength={5000} defaultValue={t?.body} />
        {err("body") && <span className="error">{err("body")}</span>}
      </div>
      <div className="span2 row">
        <button type="submit" className="btn btn--primary btn--sm" disabled={pending}>Αποθήκευση</button>
        {state.message && <span className={state.ok ? "quickform__msg ok" : "quickform__msg error"} role="status">{state.message}</span>}
      </div>
    </form>
  );
}
