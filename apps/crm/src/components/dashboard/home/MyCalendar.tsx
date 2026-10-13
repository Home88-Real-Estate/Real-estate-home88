import Link from "next/link";

import { timeOf, type DashboardData } from "@/lib/dashboard";

export function MyCalendar({ data }: { data: DashboardData }) {
  const rows = [
    ...data.todaysViewings.map((v) => ({
      key: `v-${v.id}`,
      at: v.startsAt,
      time: timeOf(v.startsAt),
      kind: "Υπόδειξη",
      title: `${v.clientName} · ${v.property.reference}`,
      href: `/properties/${v.property.id}`,
    })),
    ...data.reminders.today.items.map((r) => ({
      key: `r-${r.id}`,
      at: r.dueAt ?? data.generatedAt,
      time: r.dueAt ? timeOf(r.dueAt) : "—",
      kind: "Υπενθύμιση",
      title: r.title,
      href: "/reminders",
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const overdue = data.reminders.overdue.count;
  return (
    <section className="home-card" aria-labelledby="home-cal-title">
      <div className="home-card__head">
        <h2 id="home-cal-title">Το ημερολόγιό μου</h2>
        <Link href="/calendar" className="home-link">Προβολή όλων</Link>
      </div>
      {rows.length === 0 ? (
        <p className="hint">Τίποτα προγραμματισμένο για σήμερα.</p>
      ) : (
        <ul className="home-list">
          {rows.slice(0, 6).map((r) => (
            <li key={r.key}>
              <time className="home-list__time">{r.time}</time>
              <Link href={r.href}><span className="home-list__kind">{r.kind}</span> {r.title}</Link>
            </li>
          ))}
        </ul>
      )}
      {overdue > 0 && <p className="hint"><Link href="/reminders">{overdue} {overdue === 1 ? "εκπρόθεσμη υπενθύμιση" : "εκπρόθεσμες υπενθυμίσεις"}</Link></p>}
      <Link href="/calendar?new=1#new" className="btn btn--outline btn--sm home-card__cta">Προσθήκη στο ημερολόγιο</Link>
    </section>
  );
}
