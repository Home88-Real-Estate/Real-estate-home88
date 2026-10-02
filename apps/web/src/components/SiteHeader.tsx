"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";

import { NAV, resolveActiveNav, type NavItem } from "@/lib/nav";

export function SiteHeader({
  legalName = "HOME88",
  phone = "",
  hours = "",
}: {
  legalName?: string;
  phone?: string;
  hours?: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  // Path + transaction parameter decide the active item, so the three
  // properties destinations never highlight together.
  const activeKey = resolveActiveNav(pathname, searchParams);
  const isActive = (item: NavItem): boolean => item.key === activeKey;

  return (
    <header className="site-header">
      {(phone || hours) && (
        <div className="topbar">
          <div className="wrap topbar__inner">
            {hours && <span className="topbar__hours">{hours}</span>}
            {phone && (
              <a className="topbar__phone" href={`tel:${phone.replace(/\s+/g, "")}`}>
                Τηλέφωνο: {phone}
              </a>
            )}
          </div>
        </div>
      )}

      <div className="wrap header-main">
        <Link href="/" className="brand" aria-label={`${legalName} — αρχική`}>
          {legalName}
          <span className="brand__sub">Real Estate</span>
        </Link>

        <nav className="nav" aria-label="Κύρια πλοήγηση">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="navlink"
              aria-current={isActive(item) ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="header-actions">
          <Link href="/properties" className="btn btn--primary btn--sm">
            Αναζήτηση
          </Link>
          <button
            type="button"
            className="nav-toggle"
            aria-label="Άνοιγμα μενού"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            ☰
          </button>
        </div>
      </div>

      {open && (
        <nav className="mobile-nav" aria-label="Πλοήγηση κινητού">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item) ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
