import Link from "next/link";
import { SELLER_STAGE_LABELS, SHOWING_STATUS_LABELS } from "@home88/domain";
import { LISTING_TYPE_LABELS, PROPERTY_TYPE_LABELS, label } from "@home88/types";

import { setTaskStatus } from "@/actions/work";
import { unlinkProperty } from "@/actions/contacts";
import { LinkPropertyForm } from "@/components/contacts/LinkPropertyForm";
import { ReminderForm } from "@/components/contacts/ReminderForm";
import { ContactCommunication } from "@/components/messages/ContactCommunication";
import { OwnerReport } from "@/components/sellers/OwnerReport";
import { StatusBadge } from "@/components/StatusBadge";
import { apiFetch } from "@/lib/api";
import { CONTACT_ROLE_LABEL, CONTACT_STATUS_CLASS, CONTACT_STATUS_LABEL, PREFERRED_METHOD_LABEL, TIMELINE_LABEL } from "@/lib/contacts";
import { formatArea, formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { MANDATE_STATUS_CLASS, priceRange, REQUEST_STATUS_CLASS, REQUEST_STATUS_LABEL, SELLER_STAGE_CLASS, TASK_PRIORITY_LABEL } from "@/lib/labels";

export type ContactDetail = {
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
  workPhone: string | null;
  city: string | null;
  postalCode: string | null;
  taxId: string | null;
  address: string | null;
  hasTaxId: boolean;
  hasAddress: boolean;
  sensitiveHidden: boolean;
  preferredContactMethod: string;
  preferredLocale: string;
  marketingOptOutAt: string | null;
  smsOptOutAt: string | null;
  lastActivityAt: string | null;
  assignedTo: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
  properties: Array<{ id: string; reference: string; titleEl: string; status: string }>;
  leads: Array<{ id: string; reference: string; status: string; createdAt: string }>;
  sellerLeads: Array<{ id: string; reference: string; stage: string; listingType: string; createdAt: string }>;
};

const Fail = ({ message }: { message: string }) => <div className="notice notice--danger">{message}</div>;
const Empty = ({ children }: { children: React.ReactNode }) => <div className="empty empty--compact"><p className="empty__text">{children}</p></div>;
const dash = (v: string | null | undefined) => (v && v.trim() ? v : "-");

export function DetailsTab({ c }: { c: ContactDetail }) {
  return (
    <>
      <div className="panel">
        <h2>Βασικά</h2>
        <dl className="dl">
          <dt>Όνομα</dt><dd>{dash(c.firstName)}</dd>
          <dt>Επώνυμο</dt><dd>{dash(c.lastName)}</dd>
          <dt>Email</dt><dd>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : "-"}</dd>
          <dt>Κινητό</dt><dd>{c.mobile ? <a href={`tel:${c.mobile}`}>{c.mobile}</a> : "-"}</dd>
          <dt>Τηλέφωνο</dt><dd>{c.phone ? <a href={`tel:${c.phone}`}>{c.phone}</a> : "-"}</dd>
          <dt>Τηλέφωνο εργασίας</dt><dd>{c.workPhone ? <a href={`tel:${c.workPhone}`}>{c.workPhone}</a> : "-"}</dd>
          <dt>Σχέση</dt><dd>{c.roles.length ? c.roles.map((r) => CONTACT_ROLE_LABEL[r] ?? r).join(", ") : "-"}</dd>
          <dt>Διαχειριστής</dt><dd>{c.assignedTo?.name ?? "-"}</dd>
        </dl>
      </div>
      <div className="panel">
        <h2>Επιπλέον</h2>
        <dl className="dl">
          <dt>Πόλη</dt><dd>{dash(c.city)}</dd>
          <dt>Τ.Κ.</dt><dd>{dash(c.postalCode)}</dd>
          <dt>Προτιμώμενη επικοινωνία</dt><dd>{PREFERRED_METHOD_LABEL[c.preferredContactMethod] ?? c.preferredContactMethod}</dd>
          <dt>Γλώσσα</dt><dd>{c.preferredLocale === "en" ? "English" : "Ελληνικά"}</dd>
          <dt>Marketing</dt><dd>{c.marketingOptOutAt ? `Εξαίρεση από ${formatDate(c.marketingOptOutAt)}` : "Επιτρέπεται (με συγκατάθεση)"}</dd>
          <dt>SMS</dt><dd>{c.smsOptOutAt ? `Εξαίρεση από ${formatDate(c.smsOptOutAt)}` : "Επιτρέπεται"}</dd>
          <dt>Τελευταία δραστηριότητα</dt><dd>{formatDateTime(c.lastActivityAt)}</dd>
          <dt>Δημιουργία</dt><dd>{formatDateTime(c.createdAt)}</dd>
          <dt>Ενημέρωση</dt><dd>{formatDateTime(c.updatedAt)}</dd>
        </dl>
      </div>
      <div className="panel">
        <h2>Οικονομικά και επαγγελματικά</h2>
        <dl className="dl">
          <dt>Εταιρεία</dt><dd>{dash(c.company)}</dd>
          <dt>ΑΦΜ</dt><dd>{c.sensitiveHidden ? (c.hasTaxId ? "Κρυμμένο (δεν έχετε δικαίωμα)" : "-") : dash(c.taxId)}</dd>
          <dt>Διεύθυνση</dt><dd>{c.sensitiveHidden ? (c.hasAddress ? "Κρυμμένη (δεν έχετε δικαίωμα)" : "-") : dash(c.address)}</dd>
        </dl>
      </div>

      {c.sellerLeads.length > 0 && (
        <div className="panel">
          <h2>Ως ιδιοκτήτης ({c.sellerLeads.length})</h2>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Κωδικός</th><th>Ενδιαφέρον</th><th>Στάδιο</th><th>Δημιουργία</th></tr></thead>
              <tbody>
                {c.sellerLeads.map((s) => (
                  <tr key={s.id}>
                    <td className="mono"><Link href={`/sellers/${s.id}`}>{s.reference}</Link></td>
                    <td>{s.listingType === "RENT" ? "Ενοικίαση" : "Πώληση"}</td>
                    <td><span className={SELLER_STAGE_CLASS[s.stage] ?? "badge"}>{SELLER_STAGE_LABELS[s.stage as keyof typeof SELLER_STAGE_LABELS] ?? s.stage}</span></td>
                    <td>{formatDate(s.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ContactCommunication contactId={c.id} />
      {c.properties.length > 0 && <OwnerReport contactId={c.id} />}

      <div className="panel">
        <h2>Leads ({c.leads.length})</h2>
        {c.leads.length === 0 ? <Empty>Δεν υπάρχουν συνδεδεμένα leads.</Empty> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Κωδικός</th><th>Κατάσταση</th><th>Δημιουργία</th></tr></thead>
              <tbody>
                {c.leads.map((lead) => (
                  <tr key={lead.id}>
                    <td className="mono"><Link href={`/leads/${lead.id}`}>{lead.reference}</Link></td>
                    <td><StatusBadge value={lead.status} kind="lead" /></td>
                    <td>{formatDateTime(lead.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

type PropRow = { key: string; linkId: string | null; removable: boolean; relation: string; relationLabel: string; share: number | null; property: { id: string; reference: string; titleEl: string; status: string; listingType: string; propertyType: string; city: string | null; areaName: string | null; price: number | string | null; area: number | string | null } };

export async function PropertiesTab({ id }: { id: string }) {
  const r = await apiFetch<{ data: PropRow[] }>(`/api/contacts/${id}/properties`);
  if (!r.ok) return <Fail message={r.error.message} />;
  return (
    <div className="panel">
      <div className="panel__head"><h2>Ακίνητα ({r.data.data.length})</h2></div>
      {r.data.data.length === 0 ? <Empty>Δεν υπάρχουν συνδεδεμένα ακίνητα.</Empty> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Σχέση</th><th>Κωδικός</th><th>Ακίνητο</th><th>Περιοχή</th><th className="num">τ.μ.</th><th className="num">Τιμή</th><th>Κατάσταση</th><th /></tr></thead>
            <tbody>
              {r.data.data.map((x) => (
                <tr key={x.key}>
                  <td><span className="badge badge--info">{x.relationLabel}</span>{x.share ? <span className="muted small"> {x.share}%</span> : null}</td>
                  <td className="mono"><Link href={`/properties/${x.property.id}`}>{x.property.reference}</Link></td>
                  <td>{label(PROPERTY_TYPE_LABELS, x.property.propertyType, "el")} · {label(LISTING_TYPE_LABELS, x.property.listingType, "el")}<div className="muted small">{x.property.titleEl}</div></td>
                  <td>{[x.property.areaName, x.property.city].filter(Boolean).join(", ") || "-"}</td>
                  <td className="num">{x.property.area ? formatArea(x.property.area) : "-"}</td>
                  <td className="num">{x.property.price ? formatMoney(x.property.price) : "-"}</td>
                  <td><StatusBadge value={x.property.status} kind="property" /></td>
                  <td>
                    {x.removable && x.linkId && (
                      <form action={unlinkProperty}>
                        <input type="hidden" name="contactId" value={id} />
                        <input type="hidden" name="linkId" value={x.linkId} />
                        <button type="submit" className="btn btn--ghost btn--sm">Αποσύνδεση</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <details className="subpanel">
        <summary>+ Σύνδεση ακινήτου</summary>
        <LinkPropertyForm contactId={id} />
      </details>
    </div>
  );
}

type ReqRow = { id: string; reference: string; status: string; listingType: string; propertyTypes: string[]; areas: string[]; minPrice: number | null; maxPrice: number | null; createdAt: string; agent: string | null };

export async function RequestsTab({ id }: { id: string }) {
  const r = await apiFetch<{ data: ReqRow[] }>(`/api/contacts/${id}/requests`);
  if (!r.ok) return <Fail message={r.error.message} />;
  return (
    <div className="panel">
      <div className="panel__head">
        <h2>Ζητήσεις ({r.data.data.length})</h2>
        <Link href="/requests/new" className="btn btn--outline btn--sm">+ Νέα ζήτηση</Link>
      </div>
      {r.data.data.length === 0 ? <Empty>Δεν υπάρχουν ζητήσεις για αυτή την επαφή.</Empty> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Κωδικός</th><th>Είδος</th><th>Περιοχές</th><th>Προϋπολογισμός</th><th>Κατάσταση</th><th>Ημερομηνία</th><th>Διαχειριστής</th><th /></tr></thead>
            <tbody>
              {r.data.data.map((q) => (
                <tr key={q.id}>
                  <td className="mono"><Link href={`/requests/${q.id}`}>{q.reference}</Link></td>
                  <td>{label(LISTING_TYPE_LABELS, q.listingType, "el")}{q.propertyTypes.length ? ` · ${q.propertyTypes.map((t) => label(PROPERTY_TYPE_LABELS, t, "el")).join(", ")}` : ""}</td>
                  <td>{q.areas.join(", ") || "-"}</td>
                  <td>{priceRange(q.minPrice, q.maxPrice)}</td>
                  <td><span className={REQUEST_STATUS_CLASS[q.status] ?? "badge"}>{REQUEST_STATUS_LABEL[q.status] ?? q.status}</span></td>
                  <td>{formatDate(q.createdAt)}</td>
                  <td>{q.agent ?? "-"}</td>
                  <td className="actions"><Link href={`/requests/${q.id}`} className="btn btn--ghost btn--sm">Προβολή</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type ShowRow = { id: string; number: string | null; status: string; visitAt: string | null; comments: string | null; createdAt: string; agent: string | null; properties: Array<{ code: string; address: string | null }> };

export async function ShowingsTab({ id }: { id: string }) {
  const r = await apiFetch<{ data: ShowRow[] }>(`/api/contacts/${id}/showings`);
  if (!r.ok) return <Fail message={r.error.message} />;
  return (
    <div className="panel">
      <div className="panel__head">
        <h2>Υποδείξεις ({r.data.data.length})</h2>
        <Link href={`/showings/new?contact=${id}`} className="btn btn--primary btn--sm">+ Νέα Υπόδειξη</Link>
      </div>
      {r.data.data.length === 0 ? <Empty>Δεν έχουν γίνει υποδείξεις σε αυτόν τον πελάτη.</Empty> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Ημερομηνία</th><th>Ακίνητα</th><th>Διαχειριστής</th><th>Σχόλια</th><th>Κατάσταση</th><th /></tr></thead>
            <tbody>
              {r.data.data.map((s) => (
                <tr key={s.id}>
                  <td>{s.visitAt ? formatDateTime(s.visitAt) : formatDate(s.createdAt)}{s.number && <div className="mono muted small">{s.number}</div>}</td>
                  <td>{s.properties.map((p) => <div key={p.code}><span className="mono">{p.code}</span>{p.address && <span className="muted small"> · {p.address}</span>}</div>)}</td>
                  <td>{s.agent ?? "-"}</td>
                  <td className="clamp">{s.comments ?? "-"}</td>
                  <td><span className={MANDATE_STATUS_CLASS[s.status] ?? "badge"}>{SHOWING_STATUS_LABELS[s.status as keyof typeof SHOWING_STATUS_LABELS] ?? s.status}</span></td>
                  <td className="actions"><Link href={`/showings/${s.id}`} className="btn btn--outline btn--sm">Προβολή</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type RemRow = { id: string; title: string; status: string; priority: string; dueAt: string | null; showingId: string | null; assignee: string | null };

export async function RemindersTab({ id }: { id: string }) {
  const r = await apiFetch<{ data: RemRow[] }>(`/api/contacts/${id}/reminders`);
  if (!r.ok) return <Fail message={r.error.message} />;
  return (
    <div className="panel">
      <div className="panel__head"><h2>Υπενθυμίσεις ({r.data.data.length})</h2><Link href="/reminders" className="btn btn--ghost btn--sm">Όλες οι υπενθυμίσεις</Link></div>
      {r.data.data.length === 0 ? <Empty>Δεν υπάρχουν υπενθυμίσεις.</Empty> : (
        <ul className="plain-list">
          {r.data.data.map((t) => (
            <li key={t.id} className="between">
              <span>
                <strong style={t.status === "DONE" ? { textDecoration: "line-through" } : undefined}>{t.title}</strong>
                <span className="muted"> · {t.dueAt ? formatDateTime(t.dueAt) : "χωρίς ημερομηνία"} · {TASK_PRIORITY_LABEL[t.priority] ?? t.priority}{t.assignee ? ` · ${t.assignee}` : ""}</span>
                {t.showingId && <> · <Link href={`/showings/${t.showingId}`}>υπόδειξη</Link></>}
              </span>
              <form action={setTaskStatus}>
                <input type="hidden" name="id" value={t.id} />
                <input type="hidden" name="status" value={t.status === "DONE" ? "OPEN" : "DONE"} />
                <button type="submit" className="btn btn--ghost btn--sm">{t.status === "DONE" ? "Επαναφορά" : "Ολοκλήρωση"}</button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <details className="subpanel">
        <summary>+ Προσθήκη υπενθύμισης</summary>
        <ReminderForm contactId={id} />
      </details>
    </div>
  );
}

type TimelineRow = { at: string; type: string; title: string; href: string | null };

export async function HistoryTab({ id }: { id: string }) {
  const r = await apiFetch<{ data: TimelineRow[] }>(`/api/contacts/${id}/timeline`);
  if (!r.ok) return <Fail message={r.error.message} />;
  return (
    <div className="panel">
      <h2>Ιστορικό</h2>
      {r.data.data.length === 0 ? <Empty>Δεν υπάρχουν καταγραφές.</Empty> : (
        <ol className="history">
          {r.data.data.map((e, i) => (
            <li key={`${e.at}-${i}`}>
              <span className="history__when">{formatDateTime(e.at)}</span>
              <span className="badge badge--muted">{TIMELINE_LABEL[e.type] ?? e.type}</span>
              {e.href ? <Link href={e.href}>{e.title}</Link> : <span>{e.title}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

type MandateRow = { role: string; id: string; reference: string; number: string | null; type: string; status: string; startsAt: string | null; endsAt: string | null; property: { reference: string; titleEl: string } | null };

export async function MandatesTab({ id }: { id: string }) {
  const r = await apiFetch<{ data: MandateRow[] }>(`/api/contacts/${id}/mandates`);
  if (!r.ok) return <Fail message={r.error.message} />;
  return (
    <div className="panel">
      <h2>Εντολές ({r.data.data.length})</h2>
      {r.data.data.length === 0 ? <Empty>Δεν υπάρχουν εντολές για αυτή την επαφή.</Empty> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Εντολή</th><th>Ακίνητο</th><th>Έναρξη</th><th>Λήξη</th><th>Κατάσταση</th></tr></thead>
            <tbody>
              {r.data.data.map((m) => (
                <tr key={m.id}>
                  <td className="mono"><Link href={`/mandates/${m.id}`}>{m.number ?? m.reference}</Link></td>
                  <td>{m.property ? `${m.property.reference} · ${m.property.titleEl}` : "-"}</td>
                  <td>{formatDate(m.startsAt)}</td>
                  <td>{formatDate(m.endsAt)}</td>
                  <td><span className={MANDATE_STATUS_CLASS[m.status] ?? "badge"}>{m.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type DocRow = { id: string; title: string; category: string; mimeType: string; byteSize: number; createdAt: string };

export async function DocumentsTab({ id }: { id: string }) {
  const r = await apiFetch<{ data: DocRow[] }>(`/api/contacts/${id}/documents`);
  if (!r.ok) return <Fail message={r.error.message} />;
  const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  return (
    <div className="panel">
      <h2>Έγγραφα ({r.data.data.length})</h2>
      {r.data.data.length === 0 ? <Empty>Δεν υπάρχουν έγγραφα για αυτή την επαφή.</Empty> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Τίτλος</th><th>Κατηγορία</th><th>Μέγεθος</th><th>Ημερομηνία</th></tr></thead>
            <tbody>
              {r.data.data.map((d) => (
                <tr key={d.id}><td>{d.title}</td><td>{d.category}</td><td>{kb(d.byteSize)}</td><td>{formatDate(d.createdAt)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export { CONTACT_STATUS_CLASS, CONTACT_STATUS_LABEL };
