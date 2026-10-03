"use client";

import { useActionState } from "react";

import { savePropertyTags } from "@/actions/properties";
import { idleState } from "@/lib/form";

/**
 * Internal tags by stable code. "Να μη δημοσιευθεί" and "Μόνο στον ιστότοπο"
 * keep a property off every portal; saving re-judges its portal listings.
 */
export function PropertyTagsForm({ propertyId, selected, available, canEdit }: { propertyId: string; selected: string[]; available: Array<{ code: string; labelEl: string }>; canEdit: boolean }) {
  const [state, action, pending] = useActionState(savePropertyTags, idleState);
  return (
    <form action={action} className="sform">
      <input type="hidden" name="id" value={propertyId} />
      {state.message && <div className={state.ok ? "notice notice--ok" : "notice notice--danger"} role={state.ok ? "status" : "alert"}>{state.message}</div>}
      <div className="checkgrid checkgrid--tight">
        {available.map((t) => (
          <label key={t.code} className="check">
            <input type="checkbox" name="tag" value={t.code} defaultChecked={selected.includes(t.code)} disabled={!canEdit} /> {t.labelEl}
          </label>
        ))}
      </div>
      {canEdit && (
        <div className="sform__footer">
          <span className="hint">Οι ετικέτες είναι εσωτερικές και δεν εμφανίζονται στον ιστότοπο.</span>
          <button type="submit" className="btn btn--primary" disabled={pending}>{pending ? "Αποθήκευση…" : "Αποθήκευση ετικετών"}</button>
        </div>
      )}
    </form>
  );
}
