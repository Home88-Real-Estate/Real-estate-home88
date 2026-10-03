"use client";

import { useActionState } from "react";
import { PUBLICATION_RULE_MODES, type PortalField } from "@home88/domain";
import { PROPERTY_TYPE_LABELS } from "@home88/types";

import { savePortal } from "@/actions/settings";
import { idleState } from "@/lib/form";

export type PortalDetail = {
  code: string;
  name: string;
  fields: PortalField[];
  enabled: boolean;
  values: Record<string, string | null>;
  secrets: Record<string, { configured: boolean; updatedAt: string | null }>;
  missing: string[];
  feedUrl: string | null;
  rule: {
    mode: string;
    propertyTypes: string[];
    includeTags: string[];
    excludeTags: string[];
    conditions: { listingTypes?: string[]; cities?: string[]; minPrice?: number | null; maxPrice?: number | null; minArea?: number | null; maxArea?: number | null } | null;
  };
};

export function PortalForm({ portal, tags, canManage, encryptionNote }: { portal: PortalDetail; tags: Array<{ code: string; labelEl: string }>; canManage: boolean; encryptionNote: boolean }) {
  const [state, action, pending] = useActionState(savePortal, idleState);
  const disabled = !canManage;
  const types = Object.entries(PROPERTY_TYPE_LABELS);
  return (
    <form action={action} className="sform">
      <input type="hidden" name="_code" value={portal.code} />
      {state.message && <div className={state.ok ? "notice notice--ok" : "notice notice--danger"} role={state.ok ? "status" : "alert"}>{state.message}</div>}
      {encryptionNote && portal.fields.some((f) => f.type === "secret") && (
        <div className="notice notice--warn">Οι κωδικοί δεν αποθηκεύονται μέχρι να οριστεί το <span className="mono">SETTINGS_ENCRYPTION_KEY</span> στον server.</div>
      )}

      <fieldset className="sform__group">
        <legend>Σύνδεση</legend>
        <label className="check switchline">
          <input type="checkbox" name="enabled" defaultChecked={portal.enabled} disabled={disabled} /> Ενεργό
        </label>
        {portal.missing.length > 0 && <p className="hint">Για ενεργοποίηση λείπουν: {portal.missing.join(", ")}.</p>}
        {portal.fields.length === 0 && <p className="hint">Δεν χρειάζονται στοιχεία λογαριασμού: η σύνδεση γίνεται με τη ροή ακινήτων.</p>}
        <div className="formgrid">
          {portal.fields.map((f) =>
            f.type === "secret" ? (
              <div key={f.key} className="field">
                <label htmlFor={`p-${f.key}`}>{f.label}</label>
                <div className="secret__state">
                  {portal.secrets[f.key]?.configured ? <span className="badge badge--ok">Έχει ρυθμιστεί</span> : <span className="badge badge--muted">Δεν έχει ρυθμιστεί</span>}
                </div>
                <input id={`p-${f.key}`} name={`secret.${f.key}`} type="password" className="input" autoComplete="new-password" placeholder={portal.secrets[f.key]?.configured ? "•••••••••••• (κενό = διατήρηση)" : "Νέα τιμή"} disabled={disabled} />
                {portal.secrets[f.key]?.configured && !disabled && <label className="check"><input type="checkbox" name={`clear.${f.key}`} /> Αφαίρεση</label>}
              </div>
            ) : f.type === "select" ? (
              <div key={f.key} className="field">
                <label htmlFor={`p-${f.key}`}>{f.label}</label>
                <select id={`p-${f.key}`} name={`v.${f.key}`} className="select" defaultValue={portal.values[f.key] ?? ""} disabled={disabled}>
                  <option value="">— Δεν έχει οριστεί —</option>
                  {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            ) : (
              <div key={f.key} className="field">
                <label htmlFor={`p-${f.key}`}>{f.label}</label>
                <input id={`p-${f.key}`} name={`v.${f.key}`} type={f.type === "email" ? "email" : f.type === "tel" ? "tel" : "text"} className="input" defaultValue={portal.values[f.key] ?? ""} disabled={disabled} maxLength={300} />
                {f.help && <span className="hint">{f.help}</span>}
              </div>
            ),
          )}
        </div>
        {portal.feedUrl && (
          <div className="field">
            <label htmlFor="feed-url">URL ροής ακινήτων</label>
            <input id="feed-url" className="input mono" readOnly value={portal.feedUrl} onFocus={(e) => e.currentTarget.select()} />
            <span className="hint">Δώστε το μόνο στο portal: περιέχει κωδικό πρόσβασης στη ροή.</span>
          </div>
        )}
      </fieldset>

      <fieldset className="sform__group">
        <legend>Κανόνας δημοσίευσης</legend>
        <div className="field">
          <label htmlFor="ruleMode">Ποια ακίνητα στέλνονται</label>
          <select id="ruleMode" name="ruleMode" className="select" defaultValue={portal.rule.mode} disabled={disabled}>
            {PUBLICATION_RULE_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        <p className="fieldlabel">Τύποι ακινήτων (για «Ανά τύπο»)</p>
        <div className="checkgrid checkgrid--tight">
          {types.map(([value, l]) => (
            <label key={value} className="check"><input type="checkbox" name="ruleTypes" value={value} defaultChecked={portal.rule.propertyTypes.includes(value)} disabled={disabled} /> {l.el}</label>
          ))}
        </div>
        <p className="fieldlabel">Μόνο με ετικέτα (για «Ανά ετικέτα»)</p>
        <div className="checkgrid checkgrid--tight">
          {tags.map((t) => (
            <label key={t.code} className="check"><input type="checkbox" name="ruleInclude" value={t.code} defaultChecked={portal.rule.includeTags.includes(t.code)} disabled={disabled} /> {t.labelEl}</label>
          ))}
        </div>
        <p className="fieldlabel">Εξαιρούνται πάντα όσα έχουν ετικέτα</p>
        <div className="checkgrid checkgrid--tight">
          {tags.map((t) => (
            <label key={t.code} className="check"><input type="checkbox" name="ruleExclude" value={t.code} defaultChecked={portal.rule.excludeTags.includes(t.code)} disabled={disabled} /> {t.labelEl}</label>
          ))}
        </div>
        <p className="fieldlabel">Περιορισμοί (προαιρετικά)</p>
        <div className="checkgrid checkgrid--tight">
          {[["SALE", "Πώληση"], ["RENT", "Ενοικίαση"], ["ASSIGNMENT", "Ανάθεση"]].map(([value, l]) => (
            <label key={value} className="check"><input type="checkbox" name="condListing" value={value} defaultChecked={portal.rule.conditions?.listingTypes?.includes(value!) ?? false} disabled={disabled} /> {l}</label>
          ))}
        </div>
        <div className="formgrid">
          <div className="field"><label htmlFor="condMinPrice">Τιμή από (€)</label><input id="condMinPrice" name="condMinPrice" inputMode="decimal" className="input" defaultValue={portal.rule.conditions?.minPrice ?? ""} disabled={disabled} /></div>
          <div className="field"><label htmlFor="condMaxPrice">Τιμή έως (€)</label><input id="condMaxPrice" name="condMaxPrice" inputMode="decimal" className="input" defaultValue={portal.rule.conditions?.maxPrice ?? ""} disabled={disabled} /></div>
          <div className="field"><label htmlFor="condMinArea">τ.μ. από</label><input id="condMinArea" name="condMinArea" inputMode="decimal" className="input" defaultValue={portal.rule.conditions?.minArea ?? ""} disabled={disabled} /></div>
          <div className="field"><label htmlFor="condMaxArea">τ.μ. έως</label><input id="condMaxArea" name="condMaxArea" inputMode="decimal" className="input" defaultValue={portal.rule.conditions?.maxArea ?? ""} disabled={disabled} /></div>
        </div>
        <div className="field">
          <label htmlFor="condCities">Μόνο στις πόλεις</label>
          <textarea id="condCities" name="condCities" className="input" rows={2} defaultValue={(portal.rule.conditions?.cities ?? []).join(", ")} disabled={disabled} />
          <span className="hint">Χωρισμένες με κόμμα. Κενό = όλες. Μια τιμή που λείπει από το ακίνητο δεν περνά έλεγχο ορίων.</span>
        </div>
        <p className="hint">«Να μη δημοσιευθεί» και «Μόνο στον ιστότοπο» αποκλείουν πάντα ένα ακίνητο από κάθε portal.</p>
      </fieldset>

      {canManage && (
        <div className="sform__footer">
          <span className="hint">Οι κωδικοί αποθηκεύονται κρυπτογραφημένοι και δεν εμφανίζονται ξανά.</span>
          <button type="submit" className="btn btn--primary" disabled={pending}>{pending ? "Αποθήκευση…" : "Αποθήκευση"}</button>
        </div>
      )}
    </form>
  );
}
