import Link from "next/link";
import { notFound } from "next/navigation";

import { StatusBadge } from "@/components/StatusBadge";
import { apiFetch } from "@/lib/api";
import { formatDateTime, personName } from "@/lib/format";
import { requireRole } from "@/lib/session";

type Contact = {
  id: string;
  reference: string;
  firstName: string;
  lastName: string;
  company: string | null;
  roles: string[];
  email: string | null;
  phone: string | null;
  mobile: string | null;
  preferredContactMethod: string;
  preferredLocale: string;
  marketingOptOutAt: string | null;
  createdAt: string;
  updatedAt: string;
  properties: Array<{ id: string; reference: string; titleEl: string; status: string }>;
  leads: Array<{ id: string; reference: string; status: string; createdAt: string }>;
};

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("AGENT");
  const { id } = await params;

  const result = await apiFetch<{ contact: Contact }>(`/api/contacts/${id}`);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return <div className="notice notice--danger">{result.error.message}</div>;
  }

  const c = result.data.contact;

  return (
    <>
      <div className="between" style={{ marginBottom: 16 }}>
        <div>
          <div className="row" style={{ marginBottom: 4 }}>
            <span className="mono muted">{c.reference}</span>
            {c.roles.map((role) => (
              <span key={role} className="badge badge--muted">
                {role}
              </span>
            ))}
            {c.marketingOptOutAt && <span className="badge badge--danger">Εξαίρεση από marketing</span>}
          </div>
          <h1 style={{ margin: 0 }}>{personName(c.firstName, c.lastName)}</h1>
          {c.company && <p className="muted" style={{ margin: 0 }}>{c.company}</p>}
        </div>
        <Link href="/contacts" className="btn btn--outline btn--sm">
          Επιστροφή στις επαφές
        </Link>
      </div>

      <div className="panel">
        <h2>Στοιχεία</h2>
        <dl className="dl">
          <dt>Email</dt>
          <dd>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : "-"}</dd>
          <dt>Τηλέφωνο</dt>
          <dd>{c.phone ? <a href={`tel:${c.phone}`}>{c.phone}</a> : "-"}</dd>
          <dt>Κινητό</dt>
          <dd>{c.mobile ? <a href={`tel:${c.mobile}`}>{c.mobile}</a> : "-"}</dd>
          <dt>Προτιμώμενη επικοινωνία</dt>
          <dd>{c.preferredContactMethod}</dd>
          <dt>Γλώσσα</dt>
          <dd>{c.preferredLocale}</dd>
          <dt>Δημιουργία</dt>
          <dd>{formatDateTime(c.createdAt)}</dd>
          <dt>Ενημέρωση</dt>
          <dd>{formatDateTime(c.updatedAt)}</dd>
        </dl>
      </div>

      <div className="panel">
        <h2>Ακίνητα ({c.properties.length})</h2>
        {c.properties.length === 0 ? (
          <div className="empty">Δεν υπάρχουν συνδεδεμένα ακίνητα.</div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Κωδικός</th>
                  <th>Τίτλος</th>
                  <th>Κατάσταση</th>
                </tr>
              </thead>
              <tbody>
                {c.properties.map((property) => (
                  <tr key={property.id}>
                    <td className="mono">
                      <Link href={`/properties/${property.id}`}>{property.reference}</Link>
                    </td>
                    <td>{property.titleEl}</td>
                    <td>
                      <StatusBadge value={property.status} kind="property" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Leads ({c.leads.length})</h2>
        {c.leads.length === 0 ? (
          <div className="empty">Δεν υπάρχουν συνδεδεμένα leads.</div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Κωδικός</th>
                  <th>Κατάσταση</th>
                  <th>Δημιουργία</th>
                </tr>
              </thead>
              <tbody>
                {c.leads.map((lead) => (
                  <tr key={lead.id}>
                    <td className="mono">
                      <Link href={`/leads/${lead.id}`}>{lead.reference}</Link>
                    </td>
                    <td>
                      <StatusBadge value={lead.status} kind="lead" />
                    </td>
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
