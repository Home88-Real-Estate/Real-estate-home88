"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";

import { isNavItemActive, isNavLinkActive, NAV, resolveActiveNav, type NavMenuGroup } from "@/lib/nav";

function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

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

  // Path, transaction and property filters decide which item is highlighted.
  const activeKey = resolveActiveNav(pathname, searchParams);

  const renderGroup = (group: NavMenuGroup, className: string) => (
    <div className={className} key={group.heading}>
      {group.href ? (
        <Link className={`${className}__heading`} href={group.href}>
          {group.heading}
        </Link>
      ) : (
        <span className={`${className}__heading`}>{group.heading}</span>
      )}
      <ul>
        {group.links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className={isNavLinkActive(link, pathname, searchParams) ? "is-active" : undefined}
              onClick={() => setOpen(false)}
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <header className="site-header">
      <div className="topbar">
        <div className="wrap topbar__inner">
          {hours && <span className="topbar__hours">Ανοιχτά: {hours}</span>}
          <div className="topbar__links">
            <Link className="topbar__search" href="/properties">
              Αναζήτηση ακινήτων
            </Link>
            <span className="langswitch" lang="el" aria-label="Γλώσσα: Ελληνικά">
              Ελληνικά
            </span>
          </div>
        </div>
      </div>

      <div className="wrap header-main">
        <Link href="/" className="brand" aria-label={`${legalName} — αρχική`}>
          <img className="brand__logo" src="/images/logo.png" alt={legalName} />
        </Link>

        <nav className="nav" aria-label="Κύρια πλοήγηση">
          {NAV.map((item) =>
            item.menu ? (
              <div className="navitem navitem--has-menu" key={item.key}>
                <Link
                  href={item.href}
                  className="navlink"
                  aria-haspopup="true"
                  aria-current={isNavItemActive(item, activeKey) ? "page" : undefined}
                >
                  {item.label}
                  <span className="navlink__caret" aria-hidden="true">
                    ▾
                  </span>
                </Link>
                <div className="navmenu">
                  {item.menu.map((group) => renderGroup(group, "navmenu__group"))}
                </div>
              </div>
            ) : (
              <Link
                key={item.key}
                href={item.href}
                className="navlink"
                aria-current={isNavItemActive(item, activeKey) ? "page" : undefined}
              >
                {item.label}
              </Link>
            ),
          )}
        </nav>

        <div className="header-actions">
          {phone ? (
            <a className="header-phone" href={telHref(phone)}>
              <span className="header-phone__label">Τηλέφωνο Επικοινωνίας</span>
              <span className="header-phone__number">{phone}</span>
            </a>
          ) : null}
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
            <div className="mobile-nav__item" key={item.key}>
              <Link
                href={item.href}
                aria-current={isNavItemActive(item, activeKey) ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
              {item.menu ? (
                <div className="mobile-nav__sub">
                  {item.menu.map((group) => renderGroup(group, "mobile-nav__group"))}
                </div>
              ) : null}
            </div>
          ))}
          {phone ? (
            <a className="mobile-nav__phone" href={telHref(phone)}>
              Τηλέφωνο Επικοινωνίας: {phone}
            </a>
          ) : null}
        </nav>
      )}
    </header>
  );
}
