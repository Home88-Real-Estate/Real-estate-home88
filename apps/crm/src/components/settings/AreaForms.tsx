"use client";

import { useActionState } from "react";
import { AREA_LEVELS, childLevel, type AreaLevel } from "@home88/domain";

import { createArea, updateArea } from "@/actions/settings";
import { idleState } from "@/lib/form";

export type AreaRow = {
  id: string;
  level: string;
  parentId: string | null;
  nameEl: string;
  nameEn: string | null;
  slug: string;
  active: boolean;
  mappings: Array<{ portalCode: string; externalId: string }>;
};

const levelLabel = (l: string) => AREA_LEVELS.find((x) => x.value === l)?.label ?? l;

export function AreaCreateForm({ areas }: { areas: AreaRow[] }) {
  const [state, action, pending] = useActionState(createArea, idleState);
  const error = (k: string) => state.fields?.[k]?.[0];
  const parents = areas.filter((a) => a.level !== "NEIGHBORHOOD" && a.active);
  return (
    <form action={action} className="quickform">
      <div className="field quickform__grow">
        <label htmlFor="area-parent">Ανήκει σε</label>
        <select id="area-parent" name="parentId" className="select" defaultValue=""
          onChange={(e) => {
            const parent = areas.find((a) => a.id === e.currentTarget.value);
            const level = childLevel((parent?.level as AreaLevel | undefined) ?? null);
            const select = e.currentTarget.form?.elements.namedItem("level") as HTMLSelectElement | null;
            if (select && level) select.value = level;
          }}>
          <option value="">— Κανένα (νέα περιφέρεια) —</option>
          {parents.map((a) => (
            <option key={a.id} value={a.id}>{levelLabel(a.level)} · {a.nameEl}</option>
          ))}
        </select>
        {error("parentId") && <span className="error">{error("parentId")}</span>}
      </div>
      <div className="field">
        <label htmlFor="area-level">Επίπεδο</label>
        <select id="area-level" name="level" className="select" defaultValue="REGION">
          {AREA_LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
        {error("level") && <span className="error">{error("level")}</span>}
      </div>
      <div className="field">
        <label htmlFor="area-name">Όνομα (Ελληνικά)</label>
        <input id="area-name" name="nameEl" className="input" maxLength={120} required />
        {error("nameEl") && <span className="error">{error("nameEl")}</span>}
      </div>
      <div className="field">
        <label htmlFor="area-name-en">English</label>
        <input id="area-name-en" name="nameEn" className="input" maxLength={120} />
      </div>
      <button type="submit" className="btn btn--primary" disabled={pending}>Προσθήκη</button>
      {state.message && <p className={state.ok ? "quickform__msg ok" : "quickform__msg error"} role="status">{state.message}</p>}
    </form>
  );
}

export function AreaEditForm({ area, portals, canManage }: { area: AreaRow; portals: Array<{ code: string; name: string }>; canManage: boolean }) {
  const [state, action, pending] = useActionState(updateArea, idleState);
  const error = (k: string) => state.fields?.[k]?.[0];
  const mapped = new Map(area.mappings.map((m) => [m.portalCode, m.externalId]));
  return (
    <form action={action} className="areaedit">
      <input type="hidden" name="id" value={area.id} />
      <div className="formgrid">
        <div className="field">
          <label htmlFor={`an-${area.id}`}>Όνομα (Ελληνικά)</label>
          <input id={`an-${area.id}`} name="nameEl" className="input" defaultValue={area.nameEl} disabled={!canManage} maxLength={120} />
          {error("nameEl") && <span className="error">{error("nameEl")}</span>}
        </div>
        <div className="field">
          <label htmlFor={`ae-${area.id}`}>English</label>
          <input id={`ae-${area.id}`} name="nameEn" className="input" defaultValue={area.nameEn ?? ""} disabled={!canManage} maxLength={120} />
        </div>
        <div className="field">
          <label htmlFor={`as-${area.id}`}>Slug</label>
          <input id={`as-${area.id}`} name="slug" className="input mono" defaultValue={area.slug} disabled={!canManage} maxLength={80} />
          {error("slug") && <span className="error">{error("slug")}</span>}
        </div>
        <div className="field">
          <span className="fieldlabel">Κατάσταση</span>
          <label className="check"><input type="checkbox" name="active" defaultChecked={area.active} disabled={!canManage} /> Ενεργή</label>
        </div>
      </div>
      <p className="fieldlabel">Κωδικοί στα portals</p>
      <div className="formgrid">
        {portals.slice(0, 6).map((p) => (
          <div key={p.code} className="field">
            <label htmlFor={`m-${area.id}-${p.code}`}>{p.name}</label>
            <input id={`m-${area.id}-${p.code}`} name={`map.${p.code}`} className="input mono" defaultValue={mapped.get(p.code) ?? ""} disabled={!canManage} maxLength={80} />
          </div>
        ))}
      </div>
      {canManage && <button type="submit" className="btn btn--outline btn--sm" disabled={pending}>Αποθήκευση</button>}
      {state.message && <p className={state.ok ? "quickform__msg ok" : "quickform__msg error"} role="status">{state.message}</p>}
    </form>
  );
}
