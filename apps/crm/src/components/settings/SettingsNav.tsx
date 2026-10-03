"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

type Item = { key: string; title: string; navGroup: string };

export function SettingsNav({ sections, canViewHistory }: { sections: Item[]; canViewHistory: boolean }) {
  const pathname = usePathname();
  const groups: Array<[string, Item[]]> = [];
  for (const s of sections) {
    const bucket = groups.find(([g]) => g === s.navGroup);
    if (bucket) bucket[1].push(s);
    else groups.push([s.navGroup, [s]]);
  }
  useEffect(() => {
    if (window.matchMedia("(max-width: 980px)").matches) {
      document.querySelector<HTMLElement>('.settings__nav [aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "center" });
    }
  }, [pathname]);
  const current = (href: string) => (pathname === href || pathname.startsWith(`${href}/`) ? "page" : undefined);

  return (
    <nav className="settings__nav" aria-label="Ενότητες ρυθμίσεων">
      <Link href="/settings" className="settings__link" aria-current={pathname === "/settings" ? "page" : undefined}>
        Επισκόπηση
      </Link>
      {groups.map(([group, items]) => (
        <div key={group} className="settings__group">
          <p className="settings__label">{group}</p>
          {items.map((s) => (
            <Link key={s.key} href={`/settings/${s.key}`} className="settings__link" aria-current={current(`/settings/${s.key}`)}>
              {s.title}
            </Link>
          ))}
        </div>
      ))}
      {canViewHistory && (
        <div className="settings__group">
          <p className="settings__label">Έλεγχος</p>
          <Link href="/settings/history" className="settings__link" aria-current={current("/settings/history")}>
            Ιστορικό αλλαγών
          </Link>
        </div>
      )}
    </nav>
  );
}
