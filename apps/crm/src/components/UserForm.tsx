"use client";

import { useActionState } from "react";
import { USER_ROLE_LABELS, USER_STATUS_LABELS, label } from "@home88/types";

import { idleState, type ActionState } from "@/lib/form";

type Option = [string, string];

function optionsFrom(map: Record<string, { el: string; en: string }>): Option[] {
  return Object.keys(map).map((key) => [key, label(map, key, "el")]);
}

const STATUS_OPTIONS = optionsFrom(USER_STATUS_LABELS);

export type UserInitial = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: string;
  status: string;
};

function text(initial: UserInitial | undefined, name: keyof UserInitial): string {
  const value = initial?.[name];
  return value == null ? "" : String(value);
}

export function UserForm({
  action,
  initial,
  assignableRoles,
  canEditRole,
  canEditStatus,
  submitLabel,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  initial?: UserInitial;
  assignableRoles: string[];
  canEditRole: boolean;
  canEditStatus: boolean;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, idleState);
  const error = (name: string) => state.fields?.[name]?.[0];
  const editing = Boolean(initial?.id);

  const roleOptions: Option[] = assignableRoles.map((value) => [
    value,
    label(USER_ROLE_LABELS, value, "el"),
  ]);
  if (initial && !roleOptions.some(([value]) => value === initial.role)) {
    roleOptions.unshift([initial.role, label(USER_ROLE_LABELS, initial.role, "el")]);
  }
  const defaultRole = initial?.role ?? roleOptions[0]?.[0] ?? "AGENT";

  return (
    <form action={formAction}>
      {initial?.id && <input type="hidden" name="id" value={initial.id} />}

      {state.message && (
        <div
          className={state.ok ? "notice notice--ok" : "notice notice--danger"}
          role="alert"
          style={{ marginBottom: 16 }}
        >
          {state.message}
        </div>
      )}

      <div className="panel">
        <h2>Λογαριασμός</h2>
        <div className="formgrid">
          <div className="field span2">
            <label htmlFor="email">Email{editing ? "" : " *"}</label>
            <input
              id="email"
              name="email"
              type="email"
              className="input"
              defaultValue={initial?.email ?? ""}
              required={!editing}
              disabled={editing}
            />
            {editing && <span className="hint">Το email δεν αλλάζει.</span>}
            {error("email") && <span className="error">{error("email")}</span>}
          </div>

          <TextField name="firstName" label="Όνομα" defaultValue={text(initial, "firstName")} error={error("firstName")} required />
          <TextField name="lastName" label="Επώνυμο" defaultValue={text(initial, "lastName")} error={error("lastName")} required />
          <TextField name="phone" label="Τηλέφωνο" defaultValue={text(initial, "phone")} error={error("phone")} />

          {canEditRole ? (
            <SelectField
              name="role"
              label="Ρόλος"
              defaultValue={defaultRole}
              options={roleOptions}
              error={error("role")}
            />
          ) : (
            <div className="field">
              <label>Ρόλος</label>
              <p className="mono">{label(USER_ROLE_LABELS, initial?.role ?? "", "el")}</p>
            </div>
          )}

          {canEditStatus && (
            <SelectField
              name="status"
              label="Κατάσταση"
              defaultValue={initial?.status ?? "ACTIVE"}
              options={STATUS_OPTIONS}
              error={error("status")}
            />
          )}
        </div>
      </div>

      {!editing && (
        <div className="panel">
          <h2>Αρχικός κωδικός</h2>
          <div className="field">
            <label htmlFor="password">Password *</label>
            <input id="password" name="password" type="password" className="input" autoComplete="new-password" required />
            <span className="hint">
              At least 12 characters with uppercase, lowercase, a digit and a symbol.
            </span>
            {error("password") && <span className="error">{error("password")}</span>}
          </div>
        </div>
      )}

      <div className="row" style={{ marginTop: 6 }}>
        <button type="submit" className="btn btn--primary" disabled={pending}>
          {pending ? "Αποθήκευση…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

function TextField({
  name,
  label,
  defaultValue,
  error,
  required,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  error?: string;
  required?: boolean;
}) {
  return (
    <div className="field">
      <label htmlFor={name}>
        {label}
        {required ? " *" : ""}
      </label>
      <input id={name} name={name} type="text" className="input" defaultValue={defaultValue} required={required} />
      {error && <span className="error">{error}</span>}
    </div>
  );
}

function SelectField({
  name,
  label,
  defaultValue,
  options,
  error,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  options: Option[];
  error?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <select id={name} name={name} className="select" defaultValue={defaultValue}>
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
      {error && <span className="error">{error}</span>}
    </div>
  );
}
