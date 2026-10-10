import type { Metadata } from "next";
import Link from "next/link";

import { setTaskStatus } from "@/actions/work";
import { EmptyState } from "@/components/EmptyState";
import { TaskForm } from "@/components/work/TaskForm";
import { apiFetch } from "@/lib/api";
import { dueLabel } from "@/lib/dashboard";
import { TASK_PRIORITY_LABEL } from "@/lib/labels";
import { hasRole, requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Υπενθυμίσεις" };

type Bucket = "overdue" | "today" | "upcoming" | "nodate" | "done";

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueAt: string | null;
  completedAt: string | null;
  assignedTo: { id: string; firstName: string; lastName: string } | null;
  lead: { id: string; reference: string; firstName: string; lastName: string | null } | null;
  property: { id: string; reference: string; titleEl: string } | null;
};

type TaskList = { data: TaskRow[]; counts: Record<Bucket, number>; scope: "mine" | "all" };

const BUCKETS: Array<[Bucket, string]> = [
  ["overdue", "Εκπρόθεσμες"],
  ["today", "Σήμερα"],
  ["upcoming", "Επόμενες"],
  ["nodate", "Χωρίς προθεσμία"],
  ["done", "Ολοκληρωμένες"],
];

const EMPTY: Record<Bucket, string> = {
  overdue: "Καμία εκπρόθεσμη υπενθύμιση.",
  today: "Τίποτα άλλο για σήμερα.",
  upcoming: "Καμία επόμενη υπενθύμιση.",
  nodate: "Όλες οι υπενθυμίσεις έχουν προθεσμία.",
  done: "Δεν έχει ολοκληρωθεί καμία υπενθύμιση ακόμη.",
};

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function RemindersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole("AGENT");
  const sp = await searchParams;
  const requested = first(sp.bucket) as Bucket;
  const scope = first(sp.scope);
  const manager = hasRole(user.role, "MANAGER");

  const result = await apiFetch<TaskList>("/api/tasks", {
    query: { bucket: requested || undefined, scope: scope || undefined, limit: 100 },
  });
  const bucket: Bucket = BUCKETS.some(([b]) => b === requested) ? requested : "today";
  const now = new Date().toISOString();
  const href = (b: Bucket, s = scope) => `/reminders?bucket=${b}${s ? `&scope=${s}` : ""}`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Υπενθυμίσεις</h1>
          <p className="muted">Τι πρέπει να γίνει και πότε.</p>
        </div>
        {manager && result.ok && (
          <nav className="seg" aria-label="Εύρος">
            <Link href={href(bucket, "mine")} aria-current={result.data.scope === "mine" ? "true" : undefined}>
              Οι δικές μου
            </Link>
            <Link href={href(bucket, "all")} aria-current={result.data.scope === "all" ? "true" : undefined}>
              Όλο το γραφείο
            </Link>
          </nav>
        )}
      </div>

      <section id="new" className="panel">
        <h2>Νέα υπενθύμιση</h2>
        <TaskForm />
      </section>

      {!result.ok ? (
        <div className="notice notice--danger">{result.error.message}</div>
      ) : (
        <section className="panel">
          <nav className="tabs" aria-label="Κατηγορίες">
            {BUCKETS.map(([b, text]) => (
              <Link key={b} href={href(b)} className="tabs__link" aria-current={b === bucket ? "page" : undefined}>
                {text}
                <span className={b === "overdue" && result.data.counts.overdue > 0 ? "count count--critical" : "count"}>
                  {result.data.counts[b] ?? 0}
                </span>
              </Link>
            ))}
          </nav>

          {result.data.data.length === 0 ? (
            <EmptyState compact title={EMPTY[bucket]} />
          ) : (
            <ul className="list tasklist">
              {result.data.data.map((task) => {
                const open = task.status === "OPEN" || task.status === "IN_PROGRESS";
                return (
                  <li key={task.id}>
                    <form action={setTaskStatus}>
                      <input type="hidden" name="id" value={task.id} />
                      <input type="hidden" name="status" value={open ? "DONE" : "OPEN"} />
                      <button
                        type="submit"
                        className={open ? "taskcheck" : "taskcheck taskcheck--done"}
                        aria-label={open ? `Ολοκλήρωση: ${task.title}` : `Επαναφορά: ${task.title}`}
                        title={open ? "Σήμανση ως ολοκληρωμένη" : "Επαναφορά"}
                      />
                    </form>
                    <span className="list__main">
                      <span className={open ? "list__title" : "list__title is-done"}>{task.title}</span>
                      <span className="list__sub">
                        {dueLabel(task.dueAt, now)}
                        {task.lead && (
                          <>
                            {" · "}
                            <Link href={`/leads/${task.lead.id}`}>
                              {task.lead.firstName} {task.lead.lastName ?? ""} ({task.lead.reference})
                            </Link>
                          </>
                        )}
                        {task.property && (
                          <>
                            {" · "}
                            <Link href={`/properties/${task.property.id}`}>{task.property.reference}</Link>
                          </>
                        )}
                        {result.data.scope === "all" && task.assignedTo && ` · ${task.assignedTo.firstName} ${task.assignedTo.lastName}`}
                      </span>
                    </span>
                    {(task.priority === "HIGH" || task.priority === "URGENT") && (
                      <span className={task.priority === "URGENT" ? "badge badge--danger" : "badge badge--warn"}>
                        {TASK_PRIORITY_LABEL[task.priority]}
                      </span>
                    )}
                    {open && (
                      <form action={setTaskStatus}>
                        <input type="hidden" name="id" value={task.id} />
                        <input type="hidden" name="status" value="CANCELLED" />
                        <button type="submit" className="btn btn--ghost btn--sm">
                          Ακύρωση
                        </button>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
