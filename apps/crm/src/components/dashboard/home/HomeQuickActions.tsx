import Link from "next/link";

import { Icon, type IconName } from "../../Icon";
import { FocusSearchButton } from "./FocusSearchButton";

const ACTIONS: Array<{ href: string; label: string; icon: IconName }> = [
  { href: "/properties/new/assistant", label: "Νέο ακίνητο", icon: "building" },
  { href: "/contacts/new", label: "Νέα επαφή", icon: "users" },
  { href: "/requests/new", label: "Νέα ζήτηση", icon: "search" },
  { href: "/showings/new", label: "Νέα υπόδειξη", icon: "key" },
  { href: "/mandates/new", label: "Νέα ανάθεση", icon: "mandate" },
];

/** The everyday actions; every one opens an existing form, search focuses the global search in the top bar. */
export function HomeQuickActions() {
  return (
    <section className="home-card home-actions" aria-labelledby="home-actions-title">
      <h2 id="home-actions-title">Γρήγορες ενέργειες</h2>
      <ul>
        {ACTIONS.map((a) => (
          <li key={a.href}>
            <Link href={a.href} className="home-action">
              <span className="home-action__icon" aria-hidden="true"><Icon name={a.icon} size={20} /></span>
              <span>{a.label}</span>
            </Link>
          </li>
        ))}
        <li>
          <FocusSearchButton />
        </li>
      </ul>
    </section>
  );
}
