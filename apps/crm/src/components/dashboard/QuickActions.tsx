import Link from "next/link";
import type { ReactNode } from "react";

import { Icon, type IconName } from "../Icon";

export type IntakeDraft = { id: string; updatedAt: string; fieldCount: number; summary: string | null };

const ACTIONS: Array<{ href: string; label: string; icon: IconName }> = [
  { href: "/contacts/new", label: "Νέος πελάτης", icon: "users" },
  { href: "/requests/new", label: "Νέα ζήτηση", icon: "search" },
  { href: "/calendar?new=1#new", label: "Νέο ραντεβού", icon: "calendar" },
  { href: "/showings/new", label: "Νέα υπόδειξη", icon: "key" },
  { href: "/reminders#new", label: "Υπενθύμιση", icon: "bell" },
  { href: "/leads?status=NEW", label: "Νέα leads", icon: "inbox" },
];

const WHEN = new Intl.DateTimeFormat("el-GR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Athens" });

/**
 * What an agent does from a phone, first: register a property (by voice or form), then the other everyday
 * actions, and the registrations left half-done. On a desktop this is one compact row; on a phone it is the
 * first thing on the screen.
 */
export function QuickActions({ drafts, children }: { drafts: IntakeDraft[]; children?: ReactNode }) {
  return (
    <section className="quick" aria-label="Γρήγορες ενέργειες">
      <div className="quick__main">
        <Link href="/properties/new/assistant" className="quick__primary">
          <span className="quick__plus" aria-hidden="true"><Icon name="plus" size={24} /></span>
          <span className="quick__text">
            <strong>Νέο ακίνητο</strong>
            <span className="quick__sub">Με φωνή ή κείμενο · αποθηκεύεται ως πρόχειρο</span>
          </span>
        </Link>
        <Link href="/properties/new" className="quick__alt">ή με την πλήρη φόρμα</Link>
      </div>
      <ul className="quick__grid">
        {ACTIONS.map((a) => (
          <li key={a.href}>
            <Link href={a.href} className="quick__action">
              <Icon name={a.icon} size={20} />
              <span>{a.label}</span>
            </Link>
          </li>
        ))}
      </ul>
      {children}
      {drafts.length > 0 && (
        <div className="quick__drafts">
          <h2>Συνέχεια καταχώρισης</h2>
          <ul>
            {drafts.slice(0, 3).map((d) => (
              <li key={d.id}>
                <Link href={`/properties/new/assistant?session=${encodeURIComponent(d.id)}`}>
                  <span className="quick__draft-title">{d.summary ?? "Νέο ακίνητο χωρίς στοιχεία ακόμη"}</span>
                  <span className="hint">
                    {d.fieldCount} {d.fieldCount === 1 ? "στοιχείο" : "στοιχεία"} · {WHEN.format(new Date(d.updatedAt))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
