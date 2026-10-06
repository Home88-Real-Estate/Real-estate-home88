import type { Metadata } from "next";
import Link from "next/link";
import type { Paginated } from "@home88/types";

import { ContactsTable, type ContactRow } from "@/components/contacts/ContactsTable";
import { Pagination } from "@/components/Pagination";
import { apiFetch } from "@/lib/api";
import { CONTACT_ROLE_LABEL, qs, type DirectoryUser } from "@/lib/contacts";
import { requireRole } from "@/lib/session";
import { CRM_BASE_PATH } from "@/lib/paths";

export const metadata: Metadata = { title: "Επαφές" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const FILTER_KEYS = ["q", "role", "assignedToId", "status", "email", "phone", "createdFrom", "createdTo", "activeFrom", "activeTo", "inactiveDays"] as const;
const SORTS: Array<[string, string]> = [
  ["createdAt", "Ημερομηνία καταχώρησης"],
  ["lastActivityAt", "Τελευταία δραστηριότητα"],
  ["lastName", "Επώνυμο"],
  ["firstName", "Όνομα"],
];

export default async function ContactsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole("AGENT");
  const sp = await searchParams;
  const f = Object.fromEntries(FILTER_KEYS.map((k) => [k, first(sp[k])])) as Record<(typeof FILTER_KEYS)[number], string>;
  const sort = first(sp.sort) || "createdAt";
  const dir = first(sp.dir) === "asc" ? "asc" : "desc";
  const limit = [25, 50, 100].includes(Number(first(sp.limit))) ? Number(first(sp.limit)) : 25;
  const page = Math.max(1, Number(first(sp.page)) || 1);

  const [result, usersResult, perms] = await Promise.all([
    apiFetch<Paginated<ContactRow>>("/api/contacts", { query: { ...f, sort, dir, page, limit } }),
    apiFetch<{ data: DirectoryUser[] }>("/api/users/directory"),
    apiFetch<{ can: Record<string, boolean> }>("/api/contacts/permissions"),
  ]);
  const users = usersResult.ok ? usersResult.data.data : [];
  const can = perms.ok ? perms.data.can : {};

  const active = Object.fromEntries(Object.entries(f).filter(([, v]) => v));
  const filterQuery = qs({ ...active, sort, dir }).slice(1);
  const hasFilters = Object.keys(active).length > 0;
  const advancedOpen = Boolean(f.email || f.phone || f.createdFrom || f.createdTo || f.activeFrom || f.activeTo || f.inactiveDays);
  const pageParams: Record<string, string> = { ...(active as Record<string, string>), sort, dir, limit: String(limit) };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Επαφές</h1>
          <p className="muted">Πελάτες, ιδιοκτήτες και ενδιαφερόμενοι.</p>
        </div>
        <Link href="/contacts/new" className="btn btn--primary">+ Νέα επαφή</Link>
      </div>

      <form className="panel contact-filters" method="get" action={`${CRM_BASE_PATH}/contacts`}>
        <div className="filters">
          <div className="field grow">
            <label htmlFor="q">Αναζήτηση</label>
            <input id="q" name="q" className="input" defaultValue={f.q} placeholder="Όνομα, εταιρεία, κωδικός, email ή τηλέφωνο" />
          </div>
          <div className="field">
            <label htmlFor="role">Σχέση</label>
            <select id="role" name="role" className="select" defaultValue={f.role}>
              <option value="">Όλες</option>
              {Object.entries(CONTACT_ROLE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="assignedToId">Διαχειριστής</label>
            <select id="assignedToId" name="assignedToId" className="select" defaultValue={f.assignedToId}>
              <option value="">Όλοι</option>
              <option value="none">Χωρίς διαχειριστή</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="status">Κατάσταση</label>
            <select id="status" name="status" className="select" defaultValue={f.status}>
              <option value="">Όλες</option>
              <option value="ACTIVE">Ενεργή</option>
              <option value="INACTIVE">Ανενεργή</option>
            </select>
          </div>
        </div>
        <details open={advancedOpen} className="subpanel">
          <summary>Περισσότερα φίλτρα</summary>
          <div className="filters" style={{ marginTop: 12 }}>
            <div className="field"><label htmlFor="email">Email (πλήρες)</label><input id="email" name="email" type="email" className="input" defaultValue={f.email} /></div>
            <div className="field"><label htmlFor="phone">Τηλέφωνο (πλήρες)</label><input id="phone" name="phone" type="tel" className="input" defaultValue={f.phone} /></div>
            <div className="field"><label htmlFor="createdFrom">Καταχώρηση από</label><input id="createdFrom" name="createdFrom" type="date" className="input" defaultValue={f.createdFrom} /></div>
            <div className="field"><label htmlFor="createdTo">Καταχώρηση έως</label><input id="createdTo" name="createdTo" type="date" className="input" defaultValue={f.createdTo} /></div>
            <div className="field"><label htmlFor="activeFrom">Δραστηριότητα από</label><input id="activeFrom" name="activeFrom" type="date" className="input" defaultValue={f.activeFrom} /></div>
            <div className="field"><label htmlFor="activeTo">Δραστηριότητα έως</label><input id="activeTo" name="activeTo" type="date" className="input" defaultValue={f.activeTo} /></div>
            <div className="field">
              <label htmlFor="inactiveDays">Χωρίς δραστηριότητα</label>
              <select id="inactiveDays" name="inactiveDays" className="select" defaultValue={f.inactiveDays}>
                <option value="">-</option>
                <option value="30">Πάνω από 30 ημέρες</option>
                <option value="90">Πάνω από 90 ημέρες</option>
                <option value="180">Πάνω από 180 ημέρες</option>
                <option value="365">Πάνω από 1 έτος</option>
              </select>
            </div>
          </div>
        </details>
        <div className="filters" style={{ marginTop: 12, marginBottom: 0 }}>
          <div className="field">
            <label htmlFor="sort">Ταξινόμηση</label>
            <select id="sort" name="sort" className="select" defaultValue={sort}>{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </div>
          <div className="field">
            <label htmlFor="dir">Σειρά</label>
            <select id="dir" name="dir" className="select" defaultValue={dir}><option value="desc">Φθίνουσα</option><option value="asc">Αύξουσα</option></select>
          </div>
          <div className="field">
            <label htmlFor="limit">Ανά σελίδα</label>
            <select id="limit" name="limit" className="select" defaultValue={String(limit)}><option>25</option><option>50</option><option>100</option></select>
          </div>
          <button type="submit" className="btn btn--primary">Εφαρμογή φίλτρων</button>
          {hasFilters && <Link href="/contacts" className="btn btn--ghost">Καθαρισμός φίλτρων</Link>}
        </div>
      </form>

      {!result.ok ? (
        <div className="notice notice--danger">{result.error.message}</div>
      ) : result.data.data.length === 0 ? (
        <div className="empty">{hasFilters ? "Καμία επαφή δεν ταιριάζει με τα φίλτρα." : "Δεν υπάρχουν επαφές ακόμη."}</div>
      ) : (
        <>
          <ContactsTable
            rows={result.data.data}
            users={users}
            filterQuery={filterQuery}
            can={{ export: Boolean(can["contacts.export"]), exportSensitive: Boolean(can["contacts.export_sensitive"]), bulkAssign: Boolean(can["contacts.bulk_assign"]), bulkUpdate: Boolean(can["contacts.bulk_update"]) }}
          />
          <Pagination page={result.data.pagination.page} pages={result.data.pagination.pages} total={result.data.pagination.total} basePath="/contacts" params={pageParams} />
        </>
      )}
    </>
  );
}
