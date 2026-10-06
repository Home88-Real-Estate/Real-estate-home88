import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ContactTabs } from "@/components/contacts/ContactTabsNav";
import { type ContactDetail, DetailsTab, DocumentsTab, HistoryTab, MandatesTab, PropertiesTab, RemindersTab, RequestsTab, ShowingsTab } from "@/components/contacts/ContactTabs";
import { apiFetch } from "@/lib/api";
import { CONTACT_ROLE_LABEL, CONTACT_STATUS_CLASS, CONTACT_STATUS_LABEL, CONTACT_TABS } from "@/lib/contacts";
import { personName } from "@/lib/format";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Επαφή" };

export default async function ContactDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole("AGENT");
  const { id } = await params;
  const sp = await searchParams;
  const requested = (Array.isArray(sp.tab) ? sp.tab[0] : sp.tab) ?? "details";
  const tabs = CONTACT_TABS.filter((t) => t.ready);
  const tab = tabs.some((t) => t.key === requested) ? requested : "details";

  const result = await apiFetch<{ contact: ContactDetail }>(`/api/contacts/${id}`);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return <div className="notice notice--danger">{result.error.message}</div>;
  }
  const c = result.data.contact;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="row" style={{ marginBottom: 4, flexWrap: "wrap" }}>
            <span className="mono muted">{c.reference}</span>
            {c.roles.map((role) => <span key={role} className="badge badge--muted">{CONTACT_ROLE_LABEL[role] ?? role}</span>)}
            <span className={CONTACT_STATUS_CLASS[c.status] ?? "badge"}>{CONTACT_STATUS_LABEL[c.status] ?? c.status}</span>
            {c.marketingOptOutAt && <span className="badge badge--danger">Εξαίρεση από marketing</span>}
          </div>
          <h1 style={{ margin: 0 }}>{personName(c.firstName, c.lastName) !== "-" ? personName(c.firstName, c.lastName) : c.company ?? c.reference}</h1>
          {c.company && personName(c.firstName, c.lastName) !== "-" && <p className="muted" style={{ margin: 0 }}>{c.company}</p>}
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <Link href={`/showings/new?contact=${c.id}`} className="btn btn--primary btn--sm">+ Νέα Υπόδειξη</Link>
          <Link href={`/contacts/${c.id}/edit`} className="btn btn--outline btn--sm">Επεξεργασία</Link>
          <Link href="/contacts" className="btn btn--ghost btn--sm">Όλες οι επαφές</Link>
        </div>
      </div>

      <ContactTabs id={c.id} current={tab} tabs={tabs.map((t) => ({ key: t.key, label: t.label }))} />

      {tab === "details" && <DetailsTab c={c} />}
      {tab === "properties" && <PropertiesTab id={c.id} />}
      {tab === "requests" && <RequestsTab id={c.id} />}
      {tab === "showings" && <ShowingsTab id={c.id} />}
      {tab === "reminders" && <RemindersTab id={c.id} />}
      {tab === "history" && <HistoryTab id={c.id} />}
      {tab === "mandates" && <MandatesTab id={c.id} />}
      {tab === "documents" && <DocumentsTab id={c.id} />}
    </>
  );
}
