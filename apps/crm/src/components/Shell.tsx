"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { logoutAction } from "@/actions/auth";
import { displayName, hasRole, roleLabel, type CurrentUser } from "@/lib/user";

const NAV: Array<{ href: string; label: string; min?: string }> = [
  { href: "/", label: "Dashboard" },
  { href: "/properties", label: "Properties" },
  { href: "/leads", label: "Leads" },
  { href: "/contacts", label: "Contacts" },
  { href: "/users", label: "Users", min: "MANAGER" },
];

export function Shell({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <div className="shell">
      <aside className="sidebar" data-open={open}>
        <Link href="/" className="brand">
          HOME88 CRM
        </Link>
        <nav>
          {NAV.filter((item) => !item.min || hasRole(user.role, item.min)).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="navlink"
              aria-current={isActive(item.href) ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="spacer" />
        <div className="who">
          <strong>{displayName(user)}</strong>
          {roleLabel(user.role)}
        </div>
        <form action={logoutAction}>
          <button type="submit" className="btn btn--outline btn--sm" style={{ width: "100%" }}>
            Sign out
          </button>
        </form>
      </aside>

      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="btn btn--outline btn--sm menu-toggle"
            aria-label="Toggle navigation"
            onClick={() => setOpen((value) => !value)}
          >
            Menu
          </button>
          <div />
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
