import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/EmptyState";
import { Pagination } from "@/components/Pagination";
import { RunAutomations } from "@/components/RunAutomations";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { hasRole, requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Αυτοματισμοί" };

type Rule = { key: string; label: string; help: string; days: number | null; mode?: string; settingsHref: string; last30Days: number; lastRunAt: string | null };
type Run = { id: string; ruleLabel: string; entityType: string; createdAt: string; task: { id: string; title: string; status: string } | null; assignee: string | null };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const TASK_STATUS: Record<string, string> = { OPEN: "Ανοιχτή", IN_PROGRESS: "Σε εξέλιξη", DONE: "Ολοκληρώθηκε", CANCELLED: "Ακυρώθηκε" };

export default async function AutomationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRole("MANAGER");
  const sp = await searchParams;
  const page = Math.max(1, Number(first(sp.page)) || 1);
  const [rules, runs] = await Promise.all([
    apiFetch<{ rules: Rule[] }>("/api/automation"),
    apiFetch<{ data: Run[]; pagination: { page: number; pages: number; total: number } }>("/api/automation/runs", { query: { page } }),
  ]);
  const isAdmin = hasRole(user.role, "ADMIN");

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Αυτοματισμοί</h1>
          <p className="muted">
            Κανόνες που δημιουργούν εργασία για τον υπεύθυνο όταν κάτι μένει χωρίς ενέργεια. Δεν στέλνουν ποτέ μήνυμα σε πελάτη. Εκτελούνται μαζί με τις υπενθυμίσεις.
          </p>
        </div>
        {isAdmin && <RunAutomations />}
      </div>

      {!rules.ok ? (
        <div className="notice notice--danger">{rules.error.message}</div>
      ) : (
        <section className="panel" aria-labelledby="rules">
          <div className="panel__head">
            <div>
              <h2 id="rules">Κανόνες</h2>
              <p className="panel__sub">Κάθε κανόνας είναι ανενεργός μέχρι να οριστεί στις Ρυθμίσεις.</p>
            </div>
          </div>
          <ul className="conn">
            {rules.data.rules.map((r) => {
              const on = r.days !== null || r.mode === "APPROVAL";
              return (
                <li key={r.key} className="conn__row">
                  <div className="conn__main">
                    <div className="conn__title"><strong>{r.label}</strong></div>
                    <p className="conn__purpose">{r.help}</p>
                    <p className="conn__detail">
                      {on ? (r.days !== null ? `Ενεργός: ${r.days} ${r.days === 1 ? "ημέρα" : "ημέρες"}.` : "Ενεργός: εργασία για κάθε ζήτηση που ταιριάζει.") : "Ανενεργός."} Τελευταίες 30 ημέρες: {r.last30Days} εργασίες
                      {r.lastRunAt ? ` · τελευταία ${formatDateTime(r.lastRunAt)}` : ""}.
                    </p>
                  </div>
                  <div className="conn__state">
                    <span className={on ? "badge badge--ok" : "badge badge--muted"}>{on ? "Ενεργός" : "Ανενεργός"}</span>
                    <Link href={r.settingsHref} className="btn btn--outline btn--sm">Ρυθμίσεις</Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="panel" aria-labelledby="runs">
        <div className="panel__head"><h2 id="runs">Πρόσφατες εκτελέσεις</h2></div>
        {!runs.ok ? (
          <div className="notice notice--danger">{runs.error.message}</div>
        ) : runs.data.data.length === 0 ? (
          <EmptyState title="Καμία εκτέλεση ακόμα" text="Όταν ένας κανόνας βρει κάτι, η εργασία που δημιουργεί εμφανίζεται εδώ." />
        ) : (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Πότε</th><th>Κανόνας</th><th>Εργασία</th><th>Υπεύθυνος</th><th>Κατάσταση</th></tr></thead>
                <tbody>
                  {runs.data.data.map((r) => (
                    <tr key={r.id}>
                      <td>{formatDateTime(r.createdAt)}</td>
                      <td>{r.ruleLabel}</td>
                      <td>{r.task?.title ?? "—"}</td>
                      <td>{r.assignee ?? "Χωρίς υπεύθυνο"}</td>
                      <td>{r.task ? (TASK_STATUS[r.task.status] ?? r.task.status) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={runs.data.pagination.page} pages={runs.data.pagination.pages} total={runs.data.pagination.total} basePath="/automation" />
          </>
        )}
      </section>
    </>
  );
}
