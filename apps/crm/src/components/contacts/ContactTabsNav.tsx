import Link from "next/link";

/** URL-driven tabs: each tab is a link, so back/forward, reload and sharing work and only the open tab loads its data. */
export function ContactTabs({ id, current, tabs }: { id: string; current: string; tabs: Array<{ key: string; label: string }> }) {
  return (
    <nav className="tabs tabs--scroll" aria-label="Ενότητες επαφής">
      {tabs.map((t) => (
        <Link key={t.key} href={t.key === "details" ? `/contacts/${id}` : `/contacts/${id}?tab=${t.key}`} className="tabs__link" aria-current={current === t.key ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
