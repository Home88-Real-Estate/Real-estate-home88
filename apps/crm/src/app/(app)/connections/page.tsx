import type { Metadata } from "next";
import Link from "next/link";
import { PORTAL_STATUS_LABELS } from "@home88/domain";

import { STATUS_CLASS } from "@/components/settings/PortalsList";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Συνδέσεις" };

type Connection = {
  key: string;
  group: "communication" | "portals" | "server";
  name: string;
  purpose: string;
  status: string;
  provider: string | null;
  detail: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  variables?: string[];
  settingsHref: string | null;
};

const GROUPS: Array<{ key: Connection["group"]; title: string; sub: string }> = [
  { key: "communication", title: "Επικοινωνία & υπογραφές", sub: "Πάροχοι που επιλέγονται και ρυθμίζονται στις Ρυθμίσεις." },
  { key: "portals", title: "Portals", sub: "Δημοσίευση ακινήτων. Η λίστα δεν σημαίνει ότι η HOME88 έχει λογαριασμό σε όλα." },
  {
    key: "server",
    title: "Ρυθμίσεις server",
    sub: "Ορίζονται στις μεταβλητές περιβάλλοντος της εγκατάστασης (hosting), όχι από το CRM. Εμφανίζεται μόνο αν έχουν οριστεί — ποτέ η τιμή τους.",
  },
];

export default async function ConnectionsPage() {
  await requireRole("MANAGER");
  const result = await apiFetch<{ data: Connection[]; summary: { total: number; working: number; attention: number } }>("/api/connections");

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Συνδέσεις</h1>
          <p className="muted">Οι εξωτερικές υπηρεσίες από τις οποίες εξαρτάται το CRM και τι κάνει η καθεμία αυτή τη στιγμή.</p>
        </div>
      </div>

      {!result.ok ? (
        <div className="notice notice--danger">{result.error.message}</div>
      ) : (
        <>
          <div className="stat-grid conn__summary">
            <div className="stat"><div className="label">Σε λειτουργία</div><div className="value">{result.data.summary.working}</div></div>
            <div className="stat"><div className="label">Χρειάζονται ενέργεια</div><div className="value">{result.data.summary.attention}</div></div>
            <div className="stat"><div className="label">Σύνολο</div><div className="value">{result.data.summary.total}</div></div>
          </div>

          {GROUPS.map((g) => {
            const all = result.data.data.filter((c) => c.group === g.key);
            if (all.length === 0) return null;
            // Catalogue-only portals are listed once, compactly; rows are for connections that can act.
            const planned = g.key === "portals" ? all.filter((c) => c.status === "PLANNED") : [];
            const rows = all.filter((c) => !planned.includes(c));
            return (
              <section key={g.key} className="panel" aria-labelledby={`conn-${g.key}`}>
                <div className="panel__head">
                  <div>
                    <h2 id={`conn-${g.key}`}>{g.title}</h2>
                    <p className="panel__sub">{g.sub}</p>
                  </div>
                </div>
                <ul className="conn">
                  {rows.map((c) => (
                    <li key={c.key} className="conn__row">
                      <div className="conn__main">
                        <div className="conn__title">
                          <strong>{c.name}</strong>
                          {c.provider && <span className="muted"> · {c.provider}</span>}
                        </div>
                        <p className="conn__purpose">{c.purpose}</p>
                        {c.detail && <p className="conn__detail">{c.detail}</p>}
                        {c.variables && (
                          <p className="conn__vars">
                            {c.variables.map((v) => <code key={v}>{v}</code>)}
                          </p>
                        )}
                      </div>
                      <div className="conn__state">
                        <span className={STATUS_CLASS[c.status] ?? "badge"}>{PORTAL_STATUS_LABELS[c.status] ?? c.status}</span>
                        {c.lastSuccessAt && <span className="conn__when">Τελευταία επιτυχία: {formatDateTime(c.lastSuccessAt)}</span>}
                        {c.lastError && (
                          <span className="conn__when error">
                            {c.lastError}
                            {c.lastErrorAt ? ` (${formatDateTime(c.lastErrorAt)})` : ""}
                          </span>
                        )}
                        {c.settingsHref && <Link href={c.settingsHref} className="btn btn--outline btn--sm">Ρυθμίσεις</Link>}
                      </div>
                    </li>
                  ))}
                  {planned.length > 0 && (
                    <li className="conn__row">
                      <div className="conn__main">
                        <div className="conn__title"><strong>Στον κατάλογο, χωρίς σύνδεση ακόμα</strong></div>
                        <p className="conn__purpose">{planned.map((c) => c.name).join(" · ")}</p>
                      </div>
                      <div className="conn__state">
                        <span className={STATUS_CLASS.PLANNED}>{PORTAL_STATUS_LABELS.PLANNED} · {planned.length}</span>
                      </div>
                    </li>
                  )}
                </ul>
              </section>
            );
          })}
        </>
      )}
    </>
  );
}
