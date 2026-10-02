"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  isNavItemActive,
  isNavLinkActive,
  NAV,
  resolveActiveNav,
  type NavIconName,
  type NavMenu,
} from "@/lib/nav";

function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

function NavIcon({ name }: { name: NavIconName }) {
  if (name !== "properties") return null;
  return (
    <svg
      className="navlink__icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />
    </svg>
  );
}

function Dropdown({
  menu,
  pathname,
  searchParams,
  onNavigate,
}: {
  menu: NavMenu;
  pathname: string | null;
  searchParams: ReturnType<typeof useSearchParams>;
  onNavigate: () => void;
}) {
  const headingActive = isNavLinkActive(menu.heading, pathname, searchParams);
  return (
    <div className="navmenu" role="menu" aria-label="Ακίνητα">
      <Link
        href={menu.heading.href}
        className={headingActive ? "navmenu__heading is-active" : "navmenu__heading"}
        role="menuitem"
        aria-current={headingActive ? "page" : undefined}
        onClick={onNavigate}
      >
        {menu.heading.label}
      </Link>
      <ul>
        {menu.links.map((link) => {
          const active = isNavLinkActive(link, pathname, searchParams);
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                className={active ? "is-active" : undefined}
                role="menuitem"
                aria-current={active ? "page" : undefined}
                onClick={onNavigate}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [expandedMobile, setExpandedMobile] = useState<string | null>(null);
  const navRef = useRef<HTMLElement | null>(null);
  const parentRef = useRef<HTMLAnchorElement | null>(null);

  // Path, transaction and property filters decide which item is highlighted.
  const activeKey = resolveActiveNav(pathname, searchParams);
  const query = searchParams?.toString() ?? "";

  // The URL is the source of truth: any navigation closes every open surface.
  useEffect(() => {
    setOpenMenu(null);
    setDrawerOpen(false);
  }, [pathname, query]);

  // Clicking anywhere outside the desktop navigation dismisses the dropdown.
  useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (navRef.current && !navRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [openMenu]);

  const closeDesktopMenu = () => setOpenMenu(null);

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

        <nav className="nav" aria-label="Κύρια πλοήγηση" ref={navRef}>
          {NAV.map((item) => {
            const active = isNavItemActive(item, activeKey);

            if (!item.menu) {
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  className="navlink"
                  aria-current={active ? "page" : undefined}
                >
                  {item.icon ? <NavIcon name={item.icon} /> : null}
                  {item.label}
                </Link>
              );
            }

            const isOpen = openMenu === item.key;
            const menuId = `navmenu-${item.key}`;

            return (
              <div
                key={item.key}
                className="navitem navitem--has-menu"
                onMouseEnter={() => setOpenMenu(item.key)}
                onMouseLeave={(event) => {
                  if (!event.currentTarget.contains(document.activeElement)) closeDesktopMenu();
                }}
                onFocus={() => setOpenMenu(item.key)}
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    closeDesktopMenu();
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    closeDesktopMenu();
                    parentRef.current?.focus();
                  }
                }}
              >
                <Link
                  ref={isOpen ? parentRef : undefined}
                  href={item.href}
                  className="navlink"
                  aria-haspopup="true"
                  aria-expanded={isOpen}
                  aria-controls={isOpen ? menuId : undefined}
                  aria-current={active ? "page" : undefined}
                >
                  {item.icon ? <NavIcon name={item.icon} /> : null}
                  {item.label}
                  <span className="navlink__caret" aria-hidden="true">
                    ▾
                  </span>
                </Link>
                {isOpen ? (
                  <div id={menuId}>
                    <Dropdown
                      menu={item.menu}
                      pathname={pathname}
                      searchParams={searchParams}
                      onNavigate={closeDesktopMenu}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
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
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((v) => !v)}
          >
            ☰
          </button>
        </div>
      </div>

      {drawerOpen && (
        <nav className="mobile-nav" aria-label="Πλοήγηση κινητού">
          {NAV.map((item) => {
            const active = isNavItemActive(item, activeKey);

            if (!item.menu) {
              return (
                <div className="mobile-nav__item" key={item.key}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setDrawerOpen(false)}
                  >
                    {item.label}
                  </Link>
                </div>
              );
            }

            const isExpanded = expandedMobile === item.key;
            const subId = `mobile-sub-${item.key}`;

            return (
              <div className="mobile-nav__item" key={item.key}>
                <button
                  type="button"
                  className="mobile-nav__toggle"
                  aria-expanded={isExpanded}
                  aria-controls={subId}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setExpandedMobile(isExpanded ? null : item.key)}
                >
                  <span className="mobile-nav__toggle-label">
                    {item.icon ? <NavIcon name={item.icon} /> : null}
                    {item.label}
                  </span>
                  <span className="mobile-nav__caret" aria-hidden="true">
                    ▾
                  </span>
                </button>
                {isExpanded ? (
                  <div className="mobile-nav__sub" id={subId}>
                    <Link
                      href={item.menu.heading.href}
                      className={
                        isNavLinkActive(item.menu.heading, pathname, searchParams)
                          ? "mobile-nav__heading is-active"
                          : "mobile-nav__heading"
                      }
                      onClick={() => setDrawerOpen(false)}
                    >
                      {item.menu.heading.label}
                    </Link>
                    <ul>
                      {item.menu.links.map((link) => {
                        const linkActive = isNavLinkActive(link, pathname, searchParams);
                        return (
                          <li key={link.href}>
                            <Link
                              href={link.href}
                              className={linkActive ? "is-active" : undefined}
                              aria-current={linkActive ? "page" : undefined}
                              onClick={() => setDrawerOpen(false)}
                            >
                              {link.label}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
              </div>
            );
          })}
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
