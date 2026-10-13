import Link from "next/link";

import { CONTACT_ROLE_LABEL } from "@/lib/contacts";
import { relative } from "@/lib/dashboard";

export type RecentContact = {
  id: string;
  firstName: string;
  lastName: string;
  company: string | null;
  roles: string[];
  email: string | null;
  phone: string | null;
  mobile: string | null;
  lastActivityAt: string | null;
  createdAt: string;
};

export function RecentContacts({ contacts, now }: { contacts: RecentContact[] | null; now: string }) {
  return (
    <section className="home-card" aria-labelledby="home-contacts-title">
      <div className="home-card__head">
        <h2 id="home-contacts-title">Πρόσφατες επαφές</h2>
        <Link href="/contacts" className="home-link">Προβολή όλων</Link>
      </div>
      {contacts === null ? (
        <p className="notice notice--danger" role="alert">Δεν ήταν δυνατή η φόρτωση των επαφών.</p>
      ) : contacts.length === 0 ? (
        <p className="hint">Δεν υπάρχουν επαφές ακόμη. <Link href="/contacts/new">Προσθέστε την πρώτη</Link>.</p>
      ) : (
        <div className="home-table-wrap">
          <table className="home-table">
            <thead>
              <tr><th>Όνομα</th><th>Τηλέφωνο</th><th>Email</th><th>Σχέση</th><th>Τελευταία δραστηριότητα</th></tr>
            </thead>
            <tbody>
              {contacts.map((c) => {
                const name = `${c.firstName} ${c.lastName}`.trim() || c.company || "Χωρίς όνομα";
                const at = c.lastActivityAt ?? c.createdAt;
                return (
                  <tr key={c.id}>
                    <td data-label="Όνομα"><Link href={`/contacts/${c.id}`}>{name}</Link></td>
                    <td data-label="Τηλέφωνο">{c.mobile || c.phone || "—"}</td>
                    <td data-label="Email" className="home-table__email">{c.email || "—"}</td>
                    <td data-label="Σχέση">{c.roles.length ? c.roles.map((r) => CONTACT_ROLE_LABEL[r] ?? r).join(", ") : "—"}</td>
                    <td data-label="Τελευταία δραστηριότητα">{relative(at, now)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
