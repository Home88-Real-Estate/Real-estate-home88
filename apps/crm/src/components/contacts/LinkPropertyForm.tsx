"use client";

import { useActionState } from "react";

import { linkProperty } from "@/actions/contacts";
import { PropertyPicker } from "@/components/PropertyPicker";
import { PROPERTY_RELATION_LABEL } from "@/lib/contacts";
import { idleState } from "@/lib/form";

export function LinkPropertyForm({ contactId }: { contactId: string }) {
  const [state, action, pending] = useActionState(linkProperty, idleState);
  return (
    <form action={action} className="subpanel" noValidate key={state.ok ? "done" : "open"}>
      <input type="hidden" name="contactId" value={contactId} />
      <div className="formgrid">
        <div className="field span2"><PropertyPicker name="propertyId" valueBy="id" multiple={false} error={state.fields?.propertyId?.[0]} /></div>
        <div className="field">
          <label htmlFor="relation">Σχέση με το ακίνητο</label>
          <select id="relation" name="relation" className="select" defaultValue="INTERESTED">
            {Object.entries(PROPERTY_RELATION_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="link-notes">Σημείωση</label>
          <input id="link-notes" name="notes" className="input" maxLength={500} />
        </div>
      </div>
      {state.message && <p className={state.ok ? "quickform__msg ok" : "quickform__msg error"} role="status">{state.message}</p>}
      <button type="submit" className="btn btn--primary btn--sm" disabled={pending}>{pending ? "Σύνδεση…" : "Σύνδεση ακινήτου"}</button>
    </form>
  );
}
