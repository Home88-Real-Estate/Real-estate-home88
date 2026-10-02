import type { Metadata } from "next";
import Link from "next/link";
import { LEAD_CHANNELS } from "@home88/domain";
import { LEAD_SOURCE_LABELS, LEAD_STATUS_LABELS, label, type Paginated } from "@home88/types";

import { EmptyState } from "@/components/EmptyState";
import { Pagination } from "@/components/Pagination";
import { StatusBadge } from "@/components/StatusBadge";
import { apiFetch } from "@/lib/api";
import { formatDateTime, personName } from "@/lib/format";
import { CHANNEL_LABEL } from "@/lib/labels";
import { CRM_BASE_PATH } from "@/lib/paths";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Leads" };

type LeadRow = {
  id: string;
  reference: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  source: string;
  createdAt: string;
  lastContactedAt: string | null;
  property: { id: string; reference: string; titleEl: string } | null;
  assignedTo: { id: string; firstName: string; lastName: string } | null;
};

const STATUS_OPTIONS = [
  ["", "Όλα τα στάδια"],
  ...Object.keys(LEAD_STATUS_LABELS).map((value) => [value, label(LEAD_STATUS_LABELS, value, "el")]),
];

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("AGENT");
  const sp = await searchParams;

  const q = first(sp.q);
  const status = first(sp.status);
  const channel = first(sp.channel);
  const assignedToId = first(sp.assignedToId);
  const page = Math.max(1, Number(first(sp.page)) || 1);

  const result = await apiFetch<Paginated<LeadRow>>("/api/leads", {
    query: { q, status, channel, assignedToId, page, limit: 25 },
  });

  const params: Record<string, string> = {};
  if (q) params.q = q;
  if (status) params.status = status;
  if (channel) params.channel = channel;
  if (assignedToId) params.assignedToId = assignedToId;
  const filtered = Object.keys(params).length > 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Leads</h1>
          <p className="muted">
            {result.ok ? `${result.data.pagination.total} εκδηλώσεις ενδιαφέροντος` : "Εκδηλώσεις ενδιαφέροντος"}
          </p>
        </div>
      </div>

      <form className="filters" method="get" action={`${CRM_BASE_PATH}/leads`}>
        <div className="field">
          <label htmlFor="q">Αναζήτηση</label>
          <input id="q" name="q" className="input" defaultValue={q} placeholder="Όνομα, email, κωδικός" />
        </div>
        <div className="field">
          <label htmlFor="status">Στάδιο</label>
          <select id="status" name="status" className="select" defaultValue={status}>
            {STATUS_OPTIONS.map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="channel">Κανάλι</label>
          <select id="channel" name="channel" className="select" defaultValue={channel}>
            <option value="">Όλα</option>
            {LEAD_CHANNELS.map((value) => (
              <option key={value} value={value}>
                {CHANNEL_LABEL[value]}
              </option>
            ))}
          </select>
        </div>
        {assignedToId && <input type="hidden" name="assignedToId" value={assignedToId} />}
        <button type="submit" className="btn btn--outline">
          Φιλτράρισμα
        </button>
        {filtered && (
          <Link href="/leads" className="btn btn--ghost">
            Καθαρισμός
          </Link>
        )}
      </form>

      {assignedToId && (
        <p className="filter-chip-row">
          <span className="filter-chip">Ανατεθειμένα σε εμένα</span>
        </p>
      )}

      {!result.ok ? (
        <div className="notice notice--danger">{result.error.message}</div>
      ) : result.data.data.length === 0 ? (
        filtered ? (
          <EmptyState title="Κανένα lead δεν ταιριάζει" text="Αλλάξτε ή καθαρίστε τα φίλτρα." />
        ) : (
          <EmptyState
            title="Δεν υπάρχουν ακόμη leads"
            text="Οι εκδηλώσεις ενδιαφέροντος από τον ιστότοπο και τα portals θα εμφανίζονται εδώ."
          />
        )
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Κωδικός</th>
                  <th>Όνομα</th>
                  <th>Στάδιο</th>
                  <th>Πηγή</th>
                  <th>Ακίνητο</th>
                  <th>Ανάθεση</th>
                  <th>Δημιουργία</th>
                </tr>
              </thead>
              <tbody>
                {result.data.data.map((row) => (
                  <tr key={row.id}>
                    <td className="mono">
                      <Link href={`/leads/${row.id}`}>{row.reference}</Link>
                    </td>
                    <td>
                      <Link href={`/leads/${row.id}`}>{personName(row.firstName, row.lastName)}</Link>
                      {row.email && <div className="muted" style={{ fontSize: "0.82rem" }}>{row.email}</div>}
                    </td>
                    <td>
                      <StatusBadge value={row.status} kind="lead" />
                    </td>
                    <td>{label(LEAD_SOURCE_LABELS, row.source, "el")}</td>
                    <td>
                      {row.property ? (
                        <Link href={`/properties/${row.property.id}`} className="mono">
                          {row.property.reference}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>{row.assignedTo ? personName(row.assignedTo.firstName, row.assignedTo.lastName) : "-"}</td>
                    <td>{formatDateTime(row.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={result.data.pagination.page}
            pages={result.data.pagination.pages}
            total={result.data.pagination.total}
            basePath="/leads"
            params={params}
          />
        </>
      )}
    </>
  );
}
