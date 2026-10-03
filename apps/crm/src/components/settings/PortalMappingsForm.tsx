"use client";

import { useActionState } from "react";
import { PROPERTY_TYPE_LABELS } from "@home88/types";

import { savePortalMappings } from "@/actions/settings";
import { idleState } from "@/lib/form";

export type MappingEntry = { kind: "TYPE" | "FEATURE"; internalCode: string; status: string; externalValue: string | null };

const STATUSES = [
  ["MAPPED", "Αντιστοιχίστηκε"],
  ["TRANSFORM", "Με μετατροπή"],
  ["UNSUPPORTED", "Δεν υποστηρίζεται"],
] as const;

function Row({ kind, code, label, entry, disabled }: { kind: "TYPE" | "FEATURE"; code: string; label: string; entry?: MappingEntry; disabled: boolean }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>
        <select name={`map.${kind}.${code}`} className="select" defaultValue={entry?.status ?? ""} disabled={disabled} aria-label={`${label}: κατάσταση`}>
          <option value="">— Δεν έχει οριστεί —</option>
          {STATUSES.map(([value, l]) => <option key={value} value={value}>{l}</option>)}
        </select>
      </td>
      <td>
        <input name={`ext.${kind}.${code}`} className="input" defaultValue={entry?.externalValue ?? ""} maxLength={120} disabled={disabled} aria-label={`${label}: τιμή portal`} />
      </td>
    </tr>
  );
}

/**
 * Per-portal type and feature mapping. A blank status means "not mapped yet":
 * once any row is mapped, a property whose type has no mapping is withheld
 * rather than published under a guessed category.
 */
export function PortalMappingsForm({ code, entries, features, canEdit }: { code: string; entries: MappingEntry[]; features: Array<{ code: string; label: string }>; canEdit: boolean }) {
  const [state, action, pending] = useActionState(savePortalMappings, idleState);
  const find = (kind: string, c: string) => entries.find((e) => e.kind === kind && e.internalCode === c);
  return (
    <form action={action} className="sform">
      <input type="hidden" name="_code" value={code} />
      {state.message && <div className={state.ok ? "notice notice--ok" : "notice notice--danger"} role={state.ok ? "status" : "alert"}>{state.message}</div>}
      <p className="hint">
        Η ονοματολογία κάθε portal είναι δική του. Όσο δεν υπάρχει καμία αντιστοίχιση, δεν γίνεται έλεγχος κατηγορίας.
        Μόλις οριστεί έστω μία, ακίνητο με τύπο χωρίς αντιστοίχιση δεν δημοσιεύεται.
      </p>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th scope="col">Τύπος ακινήτου</th><th scope="col">Κατάσταση</th><th scope="col">Τιμή στο portal</th></tr></thead>
          <tbody>
            {Object.entries(PROPERTY_TYPE_LABELS).map(([c, l]) => <Row key={c} kind="TYPE" code={c} label={l.el} entry={find("TYPE", c)} disabled={!canEdit} />)}
          </tbody>
        </table>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th scope="col">Χαρακτηριστικό</th><th scope="col">Κατάσταση</th><th scope="col">Τιμή στο portal</th></tr></thead>
          <tbody>
            {features.map((f) => <Row key={f.code} kind="FEATURE" code={f.code} label={f.label} entry={find("FEATURE", f.code)} disabled={!canEdit} />)}
          </tbody>
        </table>
      </div>
      {canEdit ? (
        <div className="sform__footer">
          <span className="hint">Χαρακτηριστικό χωρίς αντιστοίχιση δεν δημοσιεύεται και εμφανίζεται ως προειδοποίηση.</span>
          <button type="submit" className="btn btn--primary" disabled={pending}>{pending ? "Αποθήκευση…" : "Αποθήκευση αντιστοιχίσεων"}</button>
        </div>
      ) : (
        <p className="hint">Οι αντιστοιχίσεις αλλάζουν από διαχειριστή.</p>
      )}
    </form>
  );
}
