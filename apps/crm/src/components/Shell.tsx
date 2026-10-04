"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { USER_ROLE_LABELS, label } from "@home88/types";

import { logoutAction } from "@/actions/auth";
import { CRM_BASE_PATH } from "@/lib/paths";
import { displayName, hasRole, type CurrentUser } from "@/lib/user";

import { Icon, type IconName } from "./Icon";
import { Logo, MARK_WHITE } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

export type NavCounters = { properties: number; newLeads: number; dueTasks: number; newSubmissions?: number; unreadNotifications?: number } | null;

type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  min?: string;
  count?: number;
  hot?: boolean;
  countTitle?: string;
};

/** Modules on the roadmap. Listed so the plan is visible; never linked to a fake screen. */
const COMING_SOON: Array<{ label: string; icon: IconName }> = [
  { label: "Ψηφιακές Εντολές", icon: "mandate" },
  { label: "Διαφημίσεις", icon: "megaphone" },
  { label: "Στατιστικά", icon: "chart" },
  { label: "Μαζικό SMS", icon: "message" },
  { label: "Ομάδες", icon: "team" },
  { label: "Συνδέσεις", icon: "plug" },
];

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

  const main: NavItem[] = [
    {
      href: "/",
      label: "Αρχική",
      icon: "home",
    },
    {
      href: "/properties",
      label: "Ακίνητα",
      icon: "building",
      count: counters?.properties,
      countTitle: "Ακίνητα (χωρίς τα αρχειοθετημένα)",
    },
    {
      href: "/leads",
      label: "Leads",
      icon: "inbox",
      count: counters?.newLeads || undefined,
      hot: true,
      countTitle: "Νέα leads",
    },
    {
      href: "/submissions",
      label: "Αναθέσεις",
      icon: "table",
      count: counters?.newSubmissions || undefined,
      hot: true,
      countTitle: "Νέες υποβολές ιδιοκτητών από τον ιστότοπο",
    },
    { href: "/requests", label: "Ζητήσεις", icon: "search" },
    { href: "/media", label: "Πολυμέσα", icon: "image" },
    { href: "/sellers", label: "Ιδιοκτήτες", icon: "team" },
    { href: "/valuations", label: "Εκτιμήσεις", icon: "barChart" },
    { href: "/mandates", label: "Εντολές", icon: "mandate" },
    { href: "/transactions", label: "Συναλλαγές", icon: "key" },
    { href: "/calendar", label: "Ημερολόγιο", icon: "calendar" },
    {
      href: "/reminders",
      label: "Υπενθυμίσεις",
      icon: "bell",
      count: counters?.dueTasks || undefined,
      hot: true,
      countTitle: "Υπενθυμίσεις για σήμερα ή εκπρόθεσμες",
    },
    { href: "/contacts", label: "Πελάτες", icon: "users" },
    { href: "/documents", label: "Έγγραφα", icon: "lock" },
    { href: "/messages", label: "Επικοινωνία", icon: "message" },
  ];
  const admin: NavItem[] = (
    [
      { href: "/users", label: "Χρήστες", icon: "userCog", min: "MANAGER" },
      { href: "/invitations", label: "Προσκλήσεις", icon: "send", min: "ADMIN" },
    ] satisfies NavItem[]
  ).filter((item) => hasRole(user.role, item.min));
  if (user.canOpenSettings) admin.push({ href: "/settings", label: "Ρυθμίσεις", icon: "sliders" });

  const renderItem = (item: NavItem) => (
    <Link
      key={item.href}
      href={item.href}
      className="nav__item"
      aria-current={isActive(item.href) ? "page" : undefined}
      title={collapsed ? item.label : undefined}
    >
      <Icon name={item.icon} />
      <span className="nav__text">{item.label}</span>
      {item.count !== undefined && (
        <span className={item.hot ? "nav__count nav__count--hot" : "nav__count"} title={item.countTitle}>
          {formatCount(item.count)}
        </span>
      )}
    </Link>
  );

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
          <nav aria-label="Ενότητες">{main.map(renderItem)}</nav>

          {admin.length > 0 && (
            <>
              <p className="nav__label">Διαχείριση</p>
              <nav aria-label="Διαχείριση">{admin.map(renderItem)}</nav>
            </>
          )}

          <details className="nav__soon">
            <summary title={collapsed ? "Σύντομα διαθέσιμα" : undefined}>
              <span>Σύντομα διαθέσιμα</span>
              <Icon name="chevronDown" size={14} />
            </summary>
            {COMING_SOON.map((item) => (
              <div
                key={item.label}
                className="nav__item nav__item--soon"
                aria-disabled="true"
                title={`${item.label} — σύντομα`}
              >
                <Icon name={item.icon} />
                <span className="nav__text">{item.label}</span>
                <span className="nav__pill">Σύντομα</span>
              </div>
            ))}
          </details>
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
          <Link
            href="/security"
            className="nav__item"
            aria-current={isActive("/security") ? "page" : undefined}
            title={collapsed ? "Ασφάλεια" : undefined}
          >
            <Icon name="shield" />
            <span className="nav__text">Ασφάλεια</span>
          </Link>
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
