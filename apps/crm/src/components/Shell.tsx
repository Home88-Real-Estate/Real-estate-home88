"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { USER_ROLE_LABELS, label } from "@home88/types";

import { logoutAction } from "@/actions/auth";
import { CRM_BASE_PATH } from "@/lib/paths";
import { activeGroup, activeHref, isGroup, navFor, type NavGroup, type NavLink } from "@/lib/nav";
import { displayName, hasRole, type CurrentUser } from "@/lib/user";

import { Icon, type IconName } from "./Icon";
import { Logo, MARK_WHITE } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

export type NavCounters = { properties: number; newLeads: number; dueTasks: number; newSubmissions?: number; unreadNotifications?: number } | null;

const NAV_COOKIE = "h88_nav";

function initials(user: CurrentUser): string {
  const a = user.firstName?.trim()[0] ?? "";
  const b = user.lastName?.trim()[0] ?? "";
  return (a + b).toUpperCase() || user.email[0]?.toUpperCase() || "?";
}

function formatCount(n: number): string {
  return new Intl.NumberFormat("el-GR").format(n);
}

export function Shell({
  user,
  counters,
  collapsed: initiallyCollapsed,
  siteUrl,
  children,
}: {
  user: CurrentUser;
  counters: NavCounters;
  collapsed: boolean;
  siteUrl: string | null;
  children: React.ReactNode;
}) {
  const rawPathname = usePathname();
  // usePathname excludes the basePath, but be defensive about it.
  const pathname =
    CRM_BASE_PATH && rawPathname.startsWith(CRM_BASE_PATH)
      ? rawPathname.slice(CRM_BASE_PATH.length) || "/"
      : rawPathname;
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  const userMenu = useRef<HTMLDetailsElement>(null);

  const sections = navFor(user);
  const current = activeHref(sections, pathname);
  const currentGroup = activeGroup(sections, pathname);
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(currentGroup ? [currentGroup] : []));

  // A deep link (or any navigation) opens the group that holds the page.
  useEffect(() => {
    if (currentGroup) setOpenGroups((prev) => (prev.has(currentGroup) ? prev : new Set(prev).add(currentGroup)));
  }, [currentGroup]);

  function toggleGroup(key: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Close the drawer and the user menu on navigation.
  useEffect(() => {
    setOpen(false);
    userMenu.current?.removeAttribute("open");
  }, [pathname]);

  // Escape closes overlays; a click outside closes the user menu.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      userMenu.current?.removeAttribute("open");
    };
    const onPointer = (event: PointerEvent) => {
      const menu = userMenu.current;
      if (menu?.open && !menu.contains(event.target as Node)) menu.removeAttribute("open");
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, []);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${NAV_COOKIE}=${next ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
  }

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const countOf = (link: NavLink) => (link.counter ? counters?.[link.counter] || 0 : 0);

  const renderLink = (link: NavLink, child = false) => {
    const count = countOf(link);
    return (
      <Link
        key={link.href}
        href={link.href}
        className={child ? "nav__item nav__item--child" : "nav__item"}
        aria-current={current === link.href ? "page" : undefined}
        title={collapsed ? link.label : undefined}
      >
        <Icon name={link.icon} size={child ? 16 : 20} />
        <span className="nav__text">{link.label}</span>
        {count > 0 && (
          <span className="nav__count nav__count--hot" title={link.counterTitle}>
            {formatCount(count)}
          </span>
        )}
      </Link>
    );
  };

  const renderGroup = (group: NavGroup) => {
    const expanded = openGroups.has(group.key);
    const holdsCurrent = currentGroup === group.key;
    // While closed, the group carries its children's actionable counts.
    const hidden = expanded ? 0 : group.children.reduce((sum, child) => sum + countOf(child), 0);
    const id = `nav-group-${group.key}`;
    return (
      <div key={group.key} className="nav__group" data-open={expanded}>
        <button
          type="button"
          className="nav__item nav__parent"
          data-active={holdsCurrent || undefined}
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => toggleGroup(group.key)}
          title={collapsed ? group.label : undefined}
        >
          <Icon name={group.icon} />
          <span className="nav__text">{group.label}</span>
          {hidden > 0 && <span className="nav__count nav__count--hot">{formatCount(hidden)}</span>}
          <Icon name="chevronDown" size={14} className="nav__chev" />
        </button>
        {expanded && (
          <div className="nav__children" id={id} role="group" aria-label={group.label}>
            {group.children.map((child) => renderLink(child, true))}
          </div>
        )}
      </div>
    );
  };

  const roleText = label(USER_ROLE_LABELS, user.role, "el");

  return (
    <div className="app" data-collapsed={collapsed} data-open={open}>
      <aside className="nav" aria-label="Κύρια πλοήγηση" id="crm-nav">
        <div className="nav__brand">
          <Link href="/" aria-label="HOME88 CRM — Αρχική">
            <Logo variant="white" width={118} className="nav__logo" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={MARK_WHITE} alt="" className="nav__mark" width={38} height={38} />
          </Link>
          <button
            type="button"
            className="nav__collapse nav__collapse--desktop"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Ανάπτυξη μενού" : "Σύμπτυξη μενού"}
            aria-expanded={!collapsed}
          >
            <Icon name="chevronLeft" />
          </button>
          <button
            type="button"
            className="nav__collapse nav__close"
            onClick={() => setOpen(false)}
            aria-label="Κλείσιμο μενού"
          >
            <Icon name="close" />
          </button>
        </div>

        <div className="nav__scroll">
          {sections.map((section, index) => (
            <nav key={section.key} aria-label={section.label} className={index ? "nav__section nav__section--sep" : "nav__section"}>
              {section.entries.map((entry) => (isGroup(entry) ? renderGroup(entry) : renderLink(entry)))}
            </nav>
          ))}
        </div>

        <div className="nav__footer">
          {siteUrl && (
            <a
              className="nav__item"
              href={siteUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={collapsed ? "Ιστότοπος" : undefined}
            >
              <Icon name="globe" />
              <span className="nav__text">Ιστότοπος</span>
              <Icon name="external" size={14} className="nav__text nav__ext" />
            </a>
          )}
          <div className="nav__user">
            <span className="nav__avatar" aria-hidden="true">
              {initials(user)}
            </span>
            <span className="nav__who">
              <strong>{displayName(user)}</strong>
              <span>{roleText}</span>
            </span>
          </div>
        </div>
      </aside>

      <div className="app__scrim" onClick={() => setOpen(false)} aria-hidden="true" />

      <div className="app__main">
        <header className="topbar">
          <button
            type="button"
            className="icon-btn topbar__menu"
            onClick={() => setOpen(true)}
            aria-label="Άνοιγμα μενού"
            aria-controls="crm-nav"
            aria-expanded={open}
          >
            <Icon name="menu" />
          </button>
          <div className="topbar__spacer" />
          {hasRole(user.role, "AGENT") && (
            <Link href="/properties/new" className="btn btn--primary btn--sm topbar__new">
              <Icon name="plus" size={16} />
              Νέο ακίνητο
            </Link>
          )}
          {hasRole(user.role, "AGENT") && (
            <Link
              href="/notifications"
              className="icon-btn topbar__bell"
              aria-label={counters?.unreadNotifications ? `Ειδοποιήσεις: ${counters.unreadNotifications} νέες` : "Ειδοποιήσεις"}
              aria-current={isActive("/notifications") ? "page" : undefined}
            >
              <Icon name="bell" />
              {counters?.unreadNotifications ? <span className="topbar__badge">{counters.unreadNotifications > 99 ? "99+" : counters.unreadNotifications}</span> : null}
            </Link>
          )}
          <ThemeToggle />
          <details className="usermenu" ref={userMenu}>
            <summary aria-label="Μενού χρήστη">
              <span className="nav__avatar" aria-hidden="true">
                {initials(user)}
              </span>
              <span className="usermenu__id">
                <span className="usermenu__name">{displayName(user)}</span>
                <span className="usermenu__role">{roleText}</span>
              </span>
              <Icon name="chevronDown" size={14} />
            </summary>
            <div className="usermenu__panel">
              <div className="usermenu__email">{user.email}</div>
              <Link href="/security">
                <Icon name="shield" size={16} /> Ασφάλεια &amp; κωδικός
              </Link>
              {siteUrl && (
                <a href={siteUrl} target="_blank" rel="noopener noreferrer">
                  <Icon name="globe" size={16} /> Ιστότοπος HOME88
                </a>
              )}
              <hr />
              <form action={logoutAction}>
                <button type="submit">
                  <Icon name="logout" size={16} /> Αποσύνδεση
                </button>
              </form>
            </div>
          </details>
        </header>

        <main className="content" id="main">
          {children}
        </main>
      </div>

      <nav className="tabbar" aria-label="Γρήγορη πλοήγηση">
        <Link href="/" aria-current={isActive("/") ? "page" : undefined}>
          <Icon name="home" size={22} />
          Αρχική
        </Link>
        <Link href="/properties" aria-current={isActive("/properties") ? "page" : undefined}>
          <Icon name="building" size={22} />
          Ακίνητα
        </Link>
        {hasRole(user.role, "AGENT") ? (
          <Link href="/properties/new" aria-label="Νέο ακίνητο">
            <span className="tabbar__add">
              <Icon name="plus" size={24} />
            </span>
          </Link>
        ) : (
          <span />
        )}
        <Link href="/leads" aria-current={isActive("/leads") ? "page" : undefined}>
          <Icon name="inbox" size={22} />
          Leads
        </Link>
        <button type="button" onClick={() => setOpen(true)} aria-controls="crm-nav" aria-expanded={open}>
          <Icon name="menu" size={22} />
          Μενού
        </button>
      </nav>
    </div>
  );
}
