import Link from "next/link";

import { relative } from "@/lib/dashboard";

export type ActivityItem = { id: string; text: string; label: string | null; href: string | null; at: string; actor: string | null };

export function ActivityFeed({ items, now }: { items: ActivityItem[] | null; now: string }) {
  return (
    <section className="home-card" aria-labelledby="home-activity-title">
      <div className="home-card__head"><h2 id="home-activity-title">Πρόσφατη δραστηριότητα</h2></div>
      {items === null ? (
        <p className="notice notice--danger" role="alert">Δεν ήταν δυνατή η φόρτωση της δραστηριότητας.</p>
      ) : items.length === 0 ? (
        <p className="hint">Δεν υπάρχει πρόσφατη δραστηριότητα.</p>
      ) : (
        <ul className="home-feed">
          {items.map((a) => (
            <li key={a.id}>
              <span className="home-feed__dot" aria-hidden="true" />
              <div>
                <p>
                  {a.actor ? <strong>{a.actor}: </strong> : null}
                  {a.href ? <Link href={a.href}>{a.text}{a.label ? ` · ${a.label}` : ""}</Link> : <>{a.text}{a.label ? ` · ${a.label}` : ""}</>}
                </p>
                <time className="hint" dateTime={a.at}>{relative(a.at, now)}</time>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
