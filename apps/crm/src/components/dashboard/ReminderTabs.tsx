"use client";

import Link from "next/link";
import { useState } from "react";

import { dueLabel, num, type DashboardData, type TaskItem } from "@/lib/dashboard";
import { TASK_PRIORITY_LABEL } from "@/lib/labels";

import { EmptyState } from "../EmptyState";

type Key = "overdue" | "today" | "upcoming";

const TABS: Array<{ key: Key; label: string; empty: string }> = [
  { key: "overdue", label: "Εκπρόθεσμες", empty: "Καμία εκπρόθεσμη υπενθύμιση." },
  { key: "today", label: "Σήμερα", empty: "Τίποτα άλλο για σήμερα." },
  { key: "upcoming", label: "7 ημέρες", empty: "Καμία υπενθύμιση για την επόμενη εβδομάδα." },
];

function related(task: TaskItem) {
  if (task.lead) {
    return (
      <Link href={`/leads/${task.lead.id}`}>
        {task.lead.firstName} {task.lead.lastName ?? ""} · {task.lead.reference}
      </Link>
    );
  }
  if (task.property) return <Link href={`/properties/${task.property.id}`}>{task.property.reference}</Link>;
  return null;
}

/** My reminders (tasks assigned to me), split by when they are due. */
export function ReminderTabs({ reminders, now }: { reminders: DashboardData["reminders"]; now: string }) {
  const initial: Key = reminders.overdue.count > 0 ? "overdue" : reminders.today.count > 0 ? "today" : "upcoming";
  const [tab, setTab] = useState<Key>(initial);
  const current = reminders[tab];
  const meta = TABS.find((t) => t.key === tab)!;

  return (
    <section className="panel" id="reminders" aria-labelledby="reminders-title">
      <div className="panel__head">
        <h2 id="reminders-title">Υπενθυμίσεις</h2>
        <Link href="/reminders" className="btn btn--ghost btn--sm">
          Όλες
        </Link>
      </div>
      {/* Count above label: three tabs fit even in the narrow side column. */}
      <div className="tabs tabs--stats" role="tablist" aria-label="Υπενθυμίσεις">
        {TABS.map((t) => {
          const count = reminders[t.key].count;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              aria-controls="reminders-panel"
              className={t.key === "overdue" && count > 0 ? "is-critical" : undefined}
              onClick={() => setTab(t.key)}
            >
              <span className="tabs__value">{num(count)}</span>
              <span className="tabs__label">{t.label}</span>
            </button>
          );
        })}
      </div>
      <div id="reminders-panel" role="tabpanel">
        {current.items.length === 0 ? (
          <EmptyState compact title={meta.empty} />
        ) : (
          <ul className="list">
            {current.items.map((task) => (
              <li key={task.id}>
                <span className="list__main">
                  <span className="list__title" title={task.title}>
                    {task.title}
                  </span>
                  <span className="list__sub">
                    {dueLabel(task.dueAt, now)}
                    {related(task) && <> · {related(task)}</>}
                  </span>
                </span>
                {(task.priority === "HIGH" || task.priority === "URGENT") && (
                  <span className={task.priority === "URGENT" ? "badge badge--danger" : "badge badge--warn"}>
                    {TASK_PRIORITY_LABEL[task.priority]}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {current.count > current.items.length && (
          <p className="panel__sub" style={{ marginTop: 10 }}>
            Εμφανίζονται {current.items.length} από {current.count}.
          </p>
        )}
      </div>
    </section>
  );
}
