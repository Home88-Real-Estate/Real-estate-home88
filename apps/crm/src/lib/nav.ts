/**
 * The CRM sidebar, in one place: sections → items → optional children.
 *
 * Only live modules are listed (roadmap modules stay out until they ship).
 * Visibility mirrors the routes' own guards; it hides links, it never grants
 * access. Active state is derived from the pathname, so deep links open the
 * right group.
 */

import type { IconName } from "@/components/Icon";
import { hasRole, type CurrentUser } from "./user";

export type NavCounterKey = "newLeads" | "newSubmissions" | "dueTasks";

export type NavLink = {
  href: string;
  label: string;
  icon: IconName;
  /** Minimum role, as in `hasRole`. */
  min?: string;
  /** Requires the settings capability from the API. */
  settings?: boolean;
  /** Actionable count shown as a badge (never totals). */
  counter?: NavCounterKey;
  counterTitle?: string;
};

export type NavGroup = { key: string; label: string; icon: IconName; children: NavLink[] };
export type NavEntry = NavLink | NavGroup;
export type NavSection = { key: string; label: string; entries: NavEntry[] };

export const isGroup = (entry: NavEntry): entry is NavGroup => "children" in entry;

export const NAV_SECTIONS: NavSection[] = [
  {
    key: "main",
    label: "Κύρια",
    entries: [
      { href: "/", label: "Αρχική", icon: "home" },
      {
        key: "properties",
        label: "Ακίνητα",
        icon: "building",
        children: [
          { href: "/properties", label: "Όλα τα ακίνητα", icon: "building" },
          { href: "/properties/new", label: "Νέο ακίνητο", icon: "plus", min: "AGENT" },
        ],
      },
      {
        key: "clients",
        label: "Πελάτες",
        icon: "users",
        children: [
          { href: "/contacts", label: "Όλοι οι πελάτες", icon: "users" },
          { href: "/leads", label: "Leads", icon: "inbox", counter: "newLeads", counterTitle: "Νέα leads" },
          { href: "/sellers", label: "Ιδιοκτήτες", icon: "team" },
        ],
      },
      { href: "/requests", label: "Ζητήσεις", icon: "search" },
      {
        key: "assignments",
        label: "Αναθέσεις",
        icon: "table",
        children: [
          {
            href: "/submissions",
            label: "Αναθέσεις",
            icon: "table",
            counter: "newSubmissions",
            counterTitle: "Νέες υποβολές ιδιοκτητών από τον ιστότοπο",
          },
          { href: "/mandates", label: "Ψηφιακές Εντολές", icon: "mandate" },
        ],
      },
      { href: "/valuations", label: "Εκτιμήσεις", icon: "barChart" },
      { href: "/transactions", label: "Συναλλαγές", icon: "key" },
      { href: "/reports", label: "Στατιστικά", icon: "chart" },
    ],
  },
  {
    key: "daily",
    label: "Καθημερινά",
    entries: [
      {
        key: "calendar",
        label: "Ημερολόγιο",
        icon: "calendar",
        children: [
          { href: "/calendar", label: "Ημερολόγιο", icon: "calendar" },
          {
            href: "/reminders",
            label: "Υπενθυμίσεις",
            icon: "bell",
            counter: "dueTasks",
            counterTitle: "Υπενθυμίσεις για σήμερα ή εκπρόθεσμες",
          },
        ],
      },
      {
        key: "communication",
        label: "Επικοινωνία",
        icon: "message",
        children: [{ href: "/messages", label: "Μηνύματα", icon: "message" }],
      },
      {
        key: "files",
        label: "Αρχεία",
        icon: "folder",
        children: [
          { href: "/media", label: "Πολυμέσα", icon: "image" },
          { href: "/documents", label: "Έγγραφα", icon: "file" },
        ],
      },
    ],
  },
  {
    key: "admin",
    label: "Διαχείριση",
    entries: [
      {
        key: "settings",
        label: "Ρυθμίσεις",
        icon: "sliders",
        children: [
          { href: "/settings", label: "Γενικά", icon: "sliders", settings: true },
          { href: "/users", label: "Χρήστες", icon: "userCog", min: "MANAGER" },
          { href: "/invitations", label: "Προσκλήσεις", icon: "send", min: "ADMIN" },
          { href: "/security", label: "Ασφάλεια", icon: "shield" },
          { href: "/automation", label: "Δραστηριότητα αυτοματισμών", icon: "sparkle", min: "MANAGER" },
          { href: "/connections", label: "Συνδέσεις", icon: "plug", min: "MANAGER" },
        ],
      },
    ],
  },
];

function canSee(link: NavLink, user: Pick<CurrentUser, "role" | "canOpenSettings">): boolean {
  if (link.settings && !user.canOpenSettings) return false;
  return !link.min || hasRole(user.role, link.min);
}

/** The sections this user may see; groups lose hidden children and empty groups/sections disappear. */
export function navFor(user: Pick<CurrentUser, "role" | "canOpenSettings">): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    entries: section.entries.flatMap((entry): NavEntry[] => {
      if (!isGroup(entry)) return canSee(entry, user) ? [entry] : [];
      const children = entry.children.filter((child) => canSee(child, user));
      return children.length ? [{ ...entry, children }] : [];
    }),
  })).filter((section) => section.entries.length > 0);
}

const matches = (href: string, pathname: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

/**
 * The single link that should be highlighted for `pathname`: the longest
 * matching href wins, so `/properties/new` selects "Νέο ακίνητο" while
 * `/properties/123` stays on "Όλα τα ακίνητα".
 */
export function activeHref(sections: NavSection[], pathname: string): string | null {
  let best: string | null = null;
  for (const section of sections)
    for (const entry of section.entries)
      for (const link of isGroup(entry) ? entry.children : [entry])
        if (matches(link.href, pathname) && (!best || link.href.length > best.length)) best = link.href;
  return best;
}

/** Key of the group that contains the active link, if any. */
export function activeGroup(sections: NavSection[], pathname: string): string | null {
  const href = activeHref(sections, pathname);
  if (!href) return null;
  for (const section of sections)
    for (const entry of section.entries)
      if (isGroup(entry) && entry.children.some((child) => child.href === href)) return entry.key;
  return null;
}
