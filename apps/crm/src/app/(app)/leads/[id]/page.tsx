import Link from "next/link";
import { notFound } from "next/navigation";
import { LEAD_SOURCE_LABELS, label } from "@home88/types";

import { LeadStatusForm } from "@/components/LeadStatusForm";
import { StatusBadge } from "@/components/StatusBadge";
import { apiFetch } from "@/lib/api";
import { formatDateTime, formatMoney, personName } from "@/lib/format";
import { requireRole } from "@/lib/session";

type Lead = {
  id: string;
  reference: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  status: string;
  source: string;
  budgetMin: unknown;
  budgetMax: unknown;
  createdAt: string;
  lastContactedAt: string | null;
  lostReason: string | null;
  property: { id: string; reference: string; titleEl: string; status: string } | null;
  contact: { id: string; reference: string; firstName: string; lastName: string } | null;
  assignedTo: { id: string; firstName: string; lastName: string } | null;
  notes: Array<{
    id: string;
    body: string;
    isPrivate: boolean;
    createdAt: string;
    author: { id: string; firstName: string; lastName: string };
  }>;
};

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("AGENT");
  const { id } = await params;

  const result = await apiFetch<{ lead: Lead }>(`/api/leads/${id}`);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return <div className="notice notice--danger">{result.error.message}</div>;
  }

  const lead = result.data.lead;

  return (
    <>
      <div className="between" style={{ marginBottom: 16 }}>
        <div>
          <div className="row" style={{ marginBottom: 4 }}>
            <span className="mono muted">{lead.reference}</span>
            <StatusBadge value={lead.status} kind="lead" />
          </div>
          <h1 style={{ margin: 0 }}>{personName(lead.firstName, lead.lastName)}</h1>
        </div>
        <Link href="/leads" className="btn btn--outline btn--sm">
          Back to leads
        </Link>
      </div>

      <div className="panel">
        <h2>Enquiry</h2>
        <dl className="dl">
          <dt>Email</dt>
          <dd>{lead.email ? <a href={`mailto:${lead.email}`}>{lead.email}</a> : "-"}</dd>
          <dt>Phone</dt>
          <dd>{lead.phone ? <a href={`tel:${lead.phone}`}>{lead.phone}</a> : "-"}</dd>
          <dt>Source</dt>
          <dd>{label(LEAD_SOURCE_LABELS, lead.source, "el")}</dd>
          <dt>Budget</dt>
          <dd>
            {formatMoney(lead.budgetMin)} - {formatMoney(lead.budgetMax)}
          </dd>
          <dt>Property</dt>
          <dd>
            {lead.property ? (
              <Link href={`/properties/${lead.property.id}`}>
                <span className="mono">{lead.property.reference}</span> {lead.property.titleEl}
              </Link>
            ) : (
              "-"
            )}
          </dd>
          <dt>Contact record</dt>
          <dd>
            {lead.contact ? (
              <Link href={`/contacts/${lead.contact.id}`}>
                {lead.contact.firstName} {lead.contact.lastName}
              </Link>
            ) : (
              "-"
            )}
          </dd>
          <dt>Assigned to</dt>
          <dd>{lead.assignedTo ? personName(lead.assignedTo.firstName, lead.assignedTo.lastName) : "-"}</dd>
          <dt>Created</dt>
          <dd>{formatDateTime(lead.createdAt)}</dd>
          <dt>Last contacted</dt>
          <dd>{lead.lastContactedAt ? formatDateTime(lead.lastContactedAt) : "-"}</dd>
          {lead.lostReason && (
            <>
              <dt>Lost reason</dt>
              <dd>{lead.lostReason}</dd>
            </>
          )}
        </dl>
        {lead.message && (
          <>
            <h3>Message</h3>
            <p style={{ whiteSpace: "pre-wrap" }}>{lead.message}</p>
          </>
        )}
      </div>

      <div className="panel">
        <h2>Update status</h2>
        <LeadStatusForm leadId={lead.id} current={lead.status} />
      </div>

      <div className="panel">
        <h2>Notes ({lead.notes.length})</h2>
        {lead.notes.length === 0 ? (
          <div className="empty">No notes yet.</div>
        ) : (
          <ul className="stack" style={{ listStyle: "none", padding: 0 }}>
            {lead.notes.map((note) => (
              <li key={note.id} className="panel" style={{ padding: 12 }}>
                <div className="muted" style={{ fontSize: "0.82rem", marginBottom: 4 }}>
                  {personName(note.author.firstName, note.author.lastName)} · {formatDateTime(note.createdAt)}
                  {note.isPrivate ? " · private" : ""}
                </div>
                <div style={{ whiteSpace: "pre-wrap" }}>{note.body}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
