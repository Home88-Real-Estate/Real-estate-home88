"use client";

import { useActionState } from "react";
import { TAG_COLORS } from "@home88/domain";

import { createPropertyTag, updatePropertyTag } from "@/actions/settings";
import { idleState } from "@/lib/form";

export type Tag = { id: string; code: string; labelEl: string; labelEn: string | null; color: string; active: boolean; isSystem: boolean; legacyLabels: string[] };

function ColorSelect({ id, value, disabled }: { id: string; value: string; disabled?: boolean }) {
  return (
    <select id={id} name="color" className="select" defaultValue={value} disabled={disabled}>
      {TAG_COLORS.map((c) => (
        <option key={c.value} value={c.value}>{c.label}</option>
      ))}
    </select>
  );
}

export function TagCreateForm() {
  const [state, action, pending] = useActionState(createPropertyTag, idleState);
  const error = (k: string) => state.fields?.[k]?.[0];
  return (
    <form action={action} className="quickform">
      <div className="field">
        <label htmlFor="tag-code">Κωδικός</label>
        <input id="tag-code" name="code" className="input mono" placeholder="PRICE_REVIEW" maxLength={40} required />
        {error("code") && <span className="error">{error("code")}</span>}
      </div>
      <div className="field quickform__grow">
        <label htmlFor="tag-label">Ετικέτα (Ελληνικά)</label>
        <input id="tag-label" name="labelEl" className="input" maxLength={80} required />
        {error("labelEl") && <span className="error">{error("labelEl")}</span>}
      </div>
      <div className="field">
        <label htmlFor="tag-label-en">English</label>
        <input id="tag-label-en" name="labelEn" className="input" maxLength={80} />
      </div>
      <div className="field">
        <label htmlFor="tag-color">Χρώμα</label>
        <ColorSelect id="tag-color" value="slate" />
      </div>
      <button type="submit" className="btn btn--primary" disabled={pending}>Προσθήκη</button>
      {state.message && <p className={state.ok ? "quickform__msg ok" : "quickform__msg error"} role="status">{state.message}</p>}
    </form>
  );
}

export function TagRowForm({ tag, canManage }: { tag: Tag; canManage: boolean }) {
  const [state, action, pending] = useActionState(updatePropertyTag, idleState);
  return (
    <form action={action} className="tagrow">
      <input type="hidden" name="id" value={tag.id} />
      <span className={`tagdot tagdot--${tag.color}`} aria-hidden="true" />
      <span className="mono tagrow__code">{tag.code}</span>
      <input name="labelEl" className="input" defaultValue={tag.labelEl} aria-label={`Ετικέτα ${tag.code}`} disabled={!canManage} maxLength={80} />
      <input name="labelEn" className="input" defaultValue={tag.labelEn ?? ""} aria-label={`English ${tag.code}`} disabled={!canManage} maxLength={80} />
      <ColorSelect id={`color-${tag.id}`} value={tag.color} disabled={!canManage} />
      <label className="check">
        <input type="checkbox" name="active" defaultChecked={tag.active} disabled={!canManage} /> Ενεργή
      </label>
      {canManage && <button type="submit" className="btn btn--outline btn--sm" disabled={pending}>Αποθήκευση</button>}
      {tag.legacyLabels.length > 0 && <span className="hint tagrow__legacy">Estate+: {tag.legacyLabels.join(", ")}</span>}
      {state.message && <span className={state.ok ? "quickform__msg ok" : "quickform__msg error"} role="status">{state.message}</span>}
    </form>
  );
}
