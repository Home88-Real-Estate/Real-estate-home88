import type { Metadata } from "next";
import Link from "next/link";
import { zonedParts, zonedTime } from "@home88/domain";

import { setViewingStatus } from "@/actions/work";
import { ViewingForm } from "@/components/work/ViewingForm";
import { apiFetch } from "@/lib/api";
import { timeOf } from "@/lib/dashboard";
import { TIME_ZONE } from "@/lib/format";
import { VIEWING_STATUS_LABEL } from "@/lib/labels";
import { hasRole, requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Ημερολόγιο" };

type Viewing = {
  id: string;
  startsAt: string;
  endsAt: string | null;
  status: string;
  clientName: string;
  clientPhone: string | null;
  property: { id: string; reference: string; titleEl: string; areaName: string | null; city: string | null };
  agent: { id: string; firstName: string; lastName: string };
};

const DAY = new Intl.DateTimeFormat("el-GR", { weekday: "long", day: "numeric", month: "long", timeZone: TIME_ZONE });
const RANGE = new Intl.DateTimeFormat("el-GR", { day: "numeric", month: "long", year: "numeric", timeZone: TIME_ZONE });
const KEY = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: TIME_ZONE });

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** Monday 00:00 (Athens) of the week containing `date`. */
function weekStart(date: Date): Date {
  const p = zonedParts(date);
  return zonedTime(p.year, p.month, p.day - (p.weekday - 1), 0, 0);
}

function addDays(date: Date, days: number): Date {
  const p = zonedParts(date);
  return zonedTime(p.year, p.month, p.day + days, 0, 0);
}

const STATUS_CLASS: Record<string, string> = {
  SCHEDULED: "badge badge--info",
  COMPLETED: "badge badge--ok",
  CANCELLED: "badge badge--muted",
  NO_SHOW: "badge badge--warn",
};

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole("AGENT");
  const sp = await searchParams;
  const scope = first(sp.scope);
  const requested = first(sp.week);
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(requested) ? new Date(`${requested}T12:00:00Z`) : new Date();
  const from = weekStart(anchor);
  const to = addDays(from, 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));

  const [result, runtime] = await Promise.all([
    apiFetch<{ data: Viewing[]; scope: "mine" | "all" }>("/api/viewings", {
      query: { from: from.toISOString(), to: to.toISOString(), scope: scope || undefined },
    }),
    apiFetch<{ calendar: { viewingMinutes: number } }>("/api/settings/runtime"),
  ]);
  const viewingMinutes = runtime.ok ? runtime.data.calendar.viewingMinutes : 30;

  const byDay = new Map<string, Viewing[]>();
  if (result.ok) {
    for (const v of result.data.data) {
      const key = KEY.format(new Date(v.startsAt));
      byDay.set(key, [...(byDay.get(key) ?? []), v]);
    }
  }
  const todayKey = KEY.format(new Date());
  const week = (d: Date) => `/calendar?week=${KEY.format(d)}${scope ? `&scope=${scope}` : ""}`;
  const manager = hasRole(user.role, "MANAGER");

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Ημερολόγιο</h1>
          <p className="muted">
            {RANGE.format(from)} – {RANGE.format(addDays(from, 6))}
          </p>
        </div>
        <div className="row">
          {manager && result.ok && (
            <nav className="seg" aria-label="Εύρος">
              <Link href={`/calendar?week=${KEY.format(from)}&scope=mine`} aria-current={result.data.scope === "mine" ? "true" : undefined}>
                Τα δικά μου
              </Link>
              <Link href={`/calendar?week=${KEY.format(from)}&scope=all`} aria-current={result.data.scope === "all" ? "true" : undefined}>
                Όλο το γραφείο
              </Link>
            </nav>
          )}
          <nav className="seg" aria-label="Εβδομάδα">
            <Link href={week(addDays(from, -7))}>‹ Προηγούμενη</Link>
            <Link href={week(new Date())}>Σήμερα</Link>
            <Link href={week(addDays(from, 7))}>Επόμενη ›</Link>
          </nav>
        </div>
      </div>

      <details id="new" className="panel" open={sp.new === "1" || !result.ok || (result.ok && result.data.data.length === 0)}>
        <summary className="panel__summary">
          <h2>Νέο ραντεβού / υπόδειξη</h2>
        </summary>
        <ViewingForm defaultMinutes={viewingMinutes} />
      </details>

      {!result.ok ? (
        <div className="notice notice--danger">{result.error.message}</div>
      ) : (
        <div className="week">
          {days.map((day) => {
            const key = KEY.format(day);
            const items = byDay.get(key) ?? [];
            return (
              <section key={key} className={key === todayKey ? "week__day is-today" : "week__day"} aria-label={DAY.format(day)}>
                <h3 className="week__head">{DAY.format(day)}</h3>
                {items.length === 0 ? (
                  <p className="week__empty">—</p>
                ) : (
                  <ul className="week__list">
                    {items.map((v) => (
                      <li key={v.id} className={`appt appt--${v.status.toLowerCase()}`}>
                        <div className="appt__top">
                          <strong className="appt__time">{timeOf(v.startsAt)}</strong>
                          {v.status !== "SCHEDULED" && (
                            <span className={STATUS_CLASS[v.status] ?? "badge"}>{VIEWING_STATUS_LABEL[v.status] ?? v.status}</span>
                          )}
                        </div>
                        <Link href={`/properties/${v.property.id}`} className="appt__title" title={v.property.titleEl}>
                          {v.property.reference} · {v.property.titleEl}
                        </Link>
                        <span className="appt__sub">
                          {v.clientName}
                          {v.clientPhone ? ` · ${v.clientPhone}` : ""}
                          {result.data.scope === "all" ? ` · ${v.agent.firstName} ${v.agent.lastName}` : ""}
                        </span>
                        {v.status === "SCHEDULED" && (
                          <div className="appt__actions">
                            {(["COMPLETED", "NO_SHOW", "CANCELLED"] as const).map((status) => (
                              <form key={status} action={setViewingStatus}>
                                <input type="hidden" name="id" value={v.id} />
                                <input type="hidden" name="status" value={status} />
                                <button type="submit" className="btn btn--ghost btn--sm">
                                  {status === "COMPLETED" ? "Έγινε" : status === "NO_SHOW" ? "Δεν ήρθε" : "Ακύρωση"}
                                </button>
                              </form>
                            ))}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
