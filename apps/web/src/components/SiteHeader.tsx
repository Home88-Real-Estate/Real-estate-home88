"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

type NavItem = { href: string; label: string; section?: string };

const NAV: NavItem[] = [
  { href: "/properties?listingType=SALE", label: "Πωλήσεις" },
  { href: "/properties?listingType=RENT", label: "Ενοικιάσεις" },
  { href: "/properties", label: "Ακίνητα", section: "/properties" },
  { href: "/submit", label: "Ανάθεση", section: "/submit" },
  { href: "/request", label: "Ζήτηση", section: "/request" },
  { href: "/about", label: "Εταιρεία", section: "/about" },
  { href: "/contact", label: "Επικοινωνία", section: "/contact" },
];

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
  const [open, setOpen] = useState(false);

  const isActive = (item: NavItem): boolean => {
    if (!item.section) return false;
    if (item.section === "/") return pathname === "/";
    return pathname === item.section || pathname.startsWith(`${item.section}/`);
  };

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
