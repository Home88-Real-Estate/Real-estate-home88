"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";

import { bulkContacts } from "@/actions/contacts";
import { CONTACT_ROLE_LABEL, CONTACT_STATUS_CLASS, CONTACT_STATUS_LABEL, type DirectoryUser } from "@/lib/contacts";
import { idleState } from "@/lib/form";
import { formatDate, personName } from "@/lib/format";
import { CRM_BASE_PATH } from "@/lib/paths";

export type ContactRow = {
  id: string;
  reference: string;
  firstName: string;
  lastName: string;
  company: string | null;
  roles: string[];
  status: string;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  assignedTo: { id: string; name: string } | null;
  lastActivityAt: string | null;
  createdAt: string;
  marketingOptOutAt: string | null;
};

type Props = {
  rows: ContactRow[];
  users: DirectoryUser[];
  /** Filters as a query string (no leading "?"), reused by the export link. */
  filterQuery: string;
  can: { export: boolean; exportSensitive: boolean; bulkAssign: boolean; bulkUpdate: boolean };
};

const ACTIONS = [
  { value: "assign", label: "Ανάθεση σε διαχειριστή", perm: "assign" },
  { value: "status", label: "Αλλαγή κατάστασης", perm: "update" },
  { value: "marketing_opt_out", label: "Εξαίρεση από marketing", perm: "update" },
  { value: "marketing_opt_in", label: "Άρση εξαίρεσης marketing", perm: "update" },
  { value: "sms_opt_out", label: "Εξαίρεση από SMS", perm: "update" },
  { value: "sms_opt_in", label: "Άρση εξαίρεσης SMS", perm: "update" },
] as const;

export function ContactsTable({ rows, users, filterQuery, can }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<string>("");
  const [state, formAction, pending] = useActionState(bulkContacts, idleState);
  const allIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const allOn = rows.length > 0 && selected.size === rows.length;
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allowed = ACTIONS.filter((a) => (a.perm === "assign" ? can.bulkAssign : can.bulkUpdate));
  const exportHref = (extra: string) => `${CRM_BASE_PATH}/api/contacts/export?${[filterQuery, extra].filter(Boolean).join("&")}`;

  return (
    <form action={formAction}>
      <div className="bulkbar no-print" role="region" aria-label="Μαζικές ενέργειες">
        <span className="muted" aria-live="polite">{selected.size > 0 ? `${selected.size} επιλεγμένες` : "Επιλέξτε επαφές για μαζικές ενέργειες"}</span>
        <div className="bulkbar__actions">
          {allowed.length > 0 && (
            <>
              <select className="select" aria-label="Ενέργεια" value={action} name="action" onChange={(e) => setAction(e.target.value)} disabled={selected.size === 0}>
                <option value="">Ενέργεια…</option>
                {allowed.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
              {action === "assign" && (
                <select className="select" name="assignedToId" aria-label="Διαχειριστής" defaultValue="">
                  <option value="">Χωρίς διαχειριστή</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              )}
              {action === "status" && (
                <select className="select" name="status" aria-label="Κατάσταση" defaultValue="ACTIVE">
                  <option value="ACTIVE">Ενεργή</option>
                  <option value="INACTIVE">Ανενεργή</option>
                </select>
              )}
              <button type="submit" className="btn btn--outline btn--sm" disabled={pending || selected.size === 0 || !action}>Εφαρμογή ενέργειας</button>
            </>
          )}
          {can.export && (
            <>
              <a className="btn btn--outline btn--sm" href={exportHref("")} download>Εξαγωγή CSV (φίλτρα)</a>
              {selected.size > 0 && <a className="btn btn--outline btn--sm" href={exportHref(`ids=${[...selected].join(",")}`)} download>Εξαγωγή επιλεγμένων</a>}
              {can.exportSensitive && <a className="btn btn--ghost btn--sm" href={exportHref("sensitive=1")} download title="Περιλαμβάνει ΑΦΜ και διεύθυνση">CSV με στοιχεία ταυτότητας</a>}
            </>
          )}
        </div>
      </div>
      {state.message && <div className={`notice ${state.ok ? "notice--ok" : "notice--danger"}`} role="status">{state.message}</div>}

      <div className="table-wrap">
        <table className="data contacts-table">
          <thead>
            <tr>
              <th style={{ width: 36 }}>
                <input type="checkbox" aria-label="Επιλογή όλων" checked={allOn} onChange={() => setSelected(allOn ? new Set() : new Set(allIds))} />
              </th>
              <th>Όνομα</th>
              <th>Επώνυμο</th>
              <th>Σχέση</th>
              <th>Τηλέφωνο</th>
              <th>Email</th>
              <th>Διαχειριστής</th>
              <th>Τελευταία δραστηριότητα</th>
              <th>Ημερομηνία καταχώρησης</th>
              <th>Κατάσταση</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-selected={selected.has(r.id) || undefined}>
                <td>
                  <input type="checkbox" name="ids" value={r.id} checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Επιλογή ${personName(r.firstName, r.lastName)}`} />
                </td>
                <td><Link href={`/contacts/${r.id}`}>{r.firstName || (r.lastName ? "" : r.company) || "-"}</Link></td>
                <td><Link href={`/contacts/${r.id}`}>{r.lastName || "-"}</Link>{r.company && (r.firstName || r.lastName) && <div className="muted small">{r.company}</div>}</td>
                <td>{r.roles.length ? r.roles.map((x) => CONTACT_ROLE_LABEL[x] ?? x).join(", ") : "-"}</td>
                <td>{r.mobile ?? r.phone ?? "-"}</td>
                <td>{r.email ?? "-"}</td>
                <td>{r.assignedTo?.name ?? "-"}</td>
                <td>{formatDate(r.lastActivityAt)}</td>
                <td>{formatDate(r.createdAt)}</td>
                <td><span className={CONTACT_STATUS_CLASS[r.status] ?? "badge"}>{CONTACT_STATUS_LABEL[r.status] ?? r.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </form>
  );
}
