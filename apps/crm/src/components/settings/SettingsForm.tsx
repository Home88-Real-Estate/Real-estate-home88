"use client";

import { useActionState } from "react";
import { settingsSection, type SettingsField } from "@home88/domain";

import { saveSettingsSection, type SettingsActionState } from "@/actions/settings";
import { idleState } from "@/lib/form";

export type SecretStatus = { configured: boolean; updatedAt: string | null; needsReentry: boolean };

export type SectionView = {
  section: string;
  values: Record<string, unknown>;
  secrets: Record<string, SecretStatus>;
  updatedAt: string | null;
  canManage: boolean;
  provider: string | null;
  encryptionReady: boolean;
};

const DATE = new Intl.DateTimeFormat("el-GR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Athens" });
const when = (iso: string | null) => (iso ? DATE.format(new Date(iso)) : "");

function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function SecretInput({ field, status, disabled, encryptionReady }: { field: SettingsField; status?: SecretStatus; disabled: boolean; encryptionReady: boolean }) {
  const configured = status?.configured ?? false;
  return (
    <div className="secret">
      <div className="secret__state">
        {status?.needsReentry ? (
          <span className="badge badge--warn">Χρειάζεται νέα καταχώριση</span>
        ) : configured ? (
          <span className="badge badge--ok">Έχει ρυθμιστεί</span>
        ) : (
          <span className="badge badge--muted">Δεν έχει ρυθμιστεί</span>
        )}
        {configured && status?.updatedAt && <span className="hint">Αλλαγή: {when(status.updatedAt)}</span>}
      </div>
      <input
        id={field.key}
        name={`secret.${field.key}`}
        type="password"
        className="input"
        autoComplete="new-password"
        spellCheck={false}
        placeholder={configured ? "•••••••••••• (κενό = διατήρηση)" : "Νέα τιμή"}
        disabled={disabled || !encryptionReady}
      />
      {configured && !disabled && (
        <label className="check">
          <input type="checkbox" name={`clear.${field.key}`} /> Αφαίρεση
        </label>
      )}
    </div>
  );
}

function FieldInput({ field, value, disabled }: { field: SettingsField; value: unknown; disabled: boolean }) {
  const common = { id: field.key, name: field.key, disabled: disabled || field.readOnly };
  switch (field.type) {
    case "textarea":
      return <textarea {...common} className="textarea textarea--sm" maxLength={field.max} defaultValue={asText(value)} placeholder={field.placeholder} />;
    case "boolean":
      return (
        <label className="check switchline">
          <input type="checkbox" {...common} defaultChecked={value === true} /> Ναι
        </label>
      );
    case "select":
      return (
        <select {...common} className="select" defaultValue={asText(value)}>
          {!field.readOnly && <option value="">— Δεν έχει οριστεί —</option>}
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "multiselect":
    case "weekdays": {
      const selected = new Set((Array.isArray(value) ? value : []).map(String));
      const options = field.options ?? [];
      return (
        <div className="checkgrid checkgrid--tight" role="group" aria-labelledby={`${field.key}-label`}>
          {options.map((o) => (
            <label key={o.value} className="check">
              <input type="checkbox" name={field.key} value={o.value} defaultChecked={selected.has(o.value)} disabled={common.disabled} /> {o.label}
            </label>
          ))}
        </div>
      );
    }
    case "color":
      return (
        <div className="colorpick">
          <input type="color" aria-hidden="true" tabIndex={-1} defaultValue={asText(value) || "#0B5394"} disabled={common.disabled}
            onChange={(e) => {
              const text = e.currentTarget.nextElementSibling as HTMLInputElement | null;
              if (text) text.value = e.currentTarget.value.toUpperCase();
            }} />
          <input {...common} className="input mono" defaultValue={asText(value)} placeholder="#RRGGBB" maxLength={7}
            onChange={(e) => {
              const picker = e.currentTarget.previousElementSibling as HTMLInputElement | null;
              if (picker && /^#[0-9a-fA-F]{6}$/.test(e.currentTarget.value)) picker.value = e.currentTarget.value;
            }} />
        </div>
      );
    case "int":
    case "decimal":
    case "percent":
      return (
        <div className="inputsuffix">
          <input {...common} className="input" inputMode="decimal" defaultValue={asText(value)} placeholder={field.placeholder} />
          {field.type === "percent" && <span aria-hidden="true">%</span>}
        </div>
      );
    case "time":
      return <input {...common} type="time" className="input" defaultValue={asText(value)} />;
    case "date":
      return <input {...common} type="date" className="input" defaultValue={asText(value)} />;
    case "email":
      return <input {...common} type="email" className="input" maxLength={field.max} defaultValue={asText(value)} autoComplete="off" />;
    case "url":
      return <input {...common} type="text" inputMode="url" className="input" maxLength={field.max} defaultValue={asText(value)} placeholder={field.placeholder} />;
    case "tel":
      return <input {...common} type="tel" className="input" maxLength={field.max} defaultValue={asText(value)} />;
    default:
      return <input {...common} type="text" className="input" maxLength={field.max} defaultValue={asText(value)} placeholder={field.placeholder} />;
  }
}

/**
 * Renders a settings section from the shared catalogue: the same field list
 * the API validates against, so form and server cannot drift apart.
 */
export function SettingsForm({ view }: { view: SectionView }) {
  const section = settingsSection(view.section)!;
  const [state, action, pending] = useActionState<SettingsActionState, FormData>(saveSettingsSection, idleState);
  const error = (key: string) => state.fields?.[key]?.[0];
  const disabled = !view.canManage;
  const values = state.values ?? view.values;

  const groups: Array<[string, SettingsField[]]> = [];
  for (const field of section.fields) {
    const name = field.group ?? "";
    const bucket = groups.find(([g]) => g === name);
    if (bucket) bucket[1].push(field);
    else groups.push([name, [field]]);
  }
  const hasSecrets = section.fields.some((f) => f.type === "secret");

  return (
    <form action={action} className="sform" noValidate>
      <input type="hidden" name="_section" value={view.section} />
      {disabled && <div className="notice">Βλέπετε την ενότητα χωρίς δικαίωμα αλλαγής.</div>}
      {hasSecrets && !view.encryptionReady && (
        <div className="notice notice--warn">
          Οι κωδικοί και τα κλειδιά δεν μπορούν να αποθηκευτούν: ο server δεν έχει κλειδί κρυπτογράφησης
          (<span className="mono">SETTINGS_ENCRYPTION_KEY</span>). Τα υπόλοιπα πεδία αποθηκεύονται κανονικά.
        </div>
      )}
      {state.message && (
        <div className={state.ok ? "notice notice--ok" : "notice notice--danger"} role={state.ok ? "status" : "alert"}>
          {state.message}
        </div>
      )}

      {groups.map(([group, fields]) => (
        <fieldset key={group || "main"} className="sform__group">
          {group && <legend>{group}</legend>}
          <div className="formgrid">
            {fields.map((field) => {
              const wide = field.type === "textarea" || field.type === "multiselect" || field.type === "weekdays";
              return (
                <div key={field.key} className={wide ? "field span2" : "field"}>
                  <label htmlFor={field.key} id={`${field.key}-label`}>
                    {field.label}
                    {field.appliesIn && <span className="soon" title="Η τιμή αποθηκεύεται τώρα· η λειτουργία ενεργοποιείται αργότερα.">{field.appliesIn}</span>}
                  </label>
                  {field.type === "secret" ? (
                    <SecretInput field={field} status={view.secrets[field.key]} disabled={disabled} encryptionReady={view.encryptionReady} />
                  ) : (
                    <FieldInput field={field} value={values[field.key]} disabled={disabled} />
                  )}
                  {field.help && <span className="hint">{field.help}</span>}
                  {error(field.key) && <span className="error">{error(field.key)}</span>}
                </div>
              );
            })}
          </div>
        </fieldset>
      ))}

      {!disabled && (
        <div className="sform__footer">
          <span className="hint">{view.updatedAt ? `Τελευταία αλλαγή: ${when(view.updatedAt)}` : "Δεν έχει αποθηκευτεί ακόμη."}</span>
          <button type="submit" className="btn btn--primary" disabled={pending}>
            {pending ? "Αποθήκευση…" : "Αποθήκευση"}
          </button>
        </div>
      )}
    </form>
  );
}
