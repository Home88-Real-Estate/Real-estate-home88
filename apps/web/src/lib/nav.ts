/**
 * Navigation route resolution.
 *
 * Several destinations render the same `/properties` page but are distinct
 * menus; the URL path and the `listingType` query parameter together decide
 * which one is active, so the highlight must never be derived from the
 * pathname alone.
 *
 * Kept pure and framework-free so it can be unit-tested and shared by the
 * desktop and mobile navigation.
 */

export type ActiveNavItem =
  | "home"
  | "sales"
  | "rentals"
  | "properties"
  | "areas"
  | "submit"
  | "request"
  | "valuation"
  | "about"
  | "contact";

export type NavLink = {
  href: string;
  label: string;
  /** The resolved active-nav value that lights this destination up. */
  key: ActiveNavItem;
};

/** An optional inline icon the header renders before a top-level label. */
export type NavIconName = "properties";

/**
 * A dropdown attached to a top-level item: one highlighted heading that links
 * to the section landing page, then the section's leaf links. Πωλήσεις and
 * Ενοικιάσεις are leaves here, never top-level items of their own.
 */
export type NavMenu = {
  heading: NavLink;
  links: NavLink[];
};

export type NavItem = NavLink & {
  icon?: NavIconName;
  /** Shown on hover (desktop) or tap (mobile) of this item. */
  menu?: NavMenu;
};

/** The Ακίνητα dropdown: the section landing page plus each transaction. */
export const PROPERTY_MENU: NavMenu = {
  heading: { href: "/properties", label: "Αναζήτηση ακινήτων", key: "properties" },
  links: [
    { href: "/properties?listingType=SALE", label: "Προς πώληση", key: "sales" },
    { href: "/properties?listingType=RENT", label: "Προς ενοικίαση", key: "rentals" },
  ],
};

/** Single source of truth for the public navigation. */
export const NAV: NavItem[] = [
  { href: "/", label: "Αρχική", key: "home" },
  {
    href: "/properties",
    label: "Ακίνητα",
    key: "properties",
    icon: "properties",
    menu: PROPERTY_MENU,
  },
  { href: "/submit", label: "Ανάθεση", key: "submit" },
  { href: "/request", label: "Ζήτηση", key: "request" },
  { href: "/about", label: "Η εταιρεία", key: "about" },
  { href: "/contact", label: "Επικοινωνία", key: "contact" },
];

/** Every link reachable from the navigation, including dropdown leaves. */
export function allNavLinks(): NavLink[] {
  const links: NavLink[] = [];
  for (const item of NAV) {
    links.push(item);
    if (item.menu) links.push(item.menu.heading, ...item.menu.links);
  }
  return links;
}

/** Normalises `SALE`/`rent `/`sale` to a canonical value; anything else is null. */
export function normalizeListingType(value: string | null | undefined): "SALE" | "RENT" | null {
  if (typeof value !== "string") return null;
  const normalised = value.trim().toUpperCase();
  if (normalised === "SALE") return "SALE";
  if (normalised === "RENT") return "RENT";
  return null;
}

/** Strips a query/hash suffix and any trailing slash, so `/properties/` === `/properties`. */
function normalizePath(pathname: string): string {
  let path = pathname;
  const hashAt = path.indexOf("#");
  if (hashAt !== -1) path = path.slice(0, hashAt);
  const queryAt = path.indexOf("?");
  if (queryAt !== -1) path = path.slice(0, queryAt);
  path = path.replace(/\/+$/, "");
  return path === "" ? "/" : path;
}

type SearchParamsReader = { get(name: string): string | null } | null | undefined;

/**
 * Resolves which navigation item should be active for a path + query string.
 *
 * Precedence for the shared properties page: an explicit SALE or RENT
 * transaction wins over the generic Ακίνητα destination, so exactly one
 * destination is ever active. Unrelated filters (area, price, …) are ignored.
 */
export function resolveActiveNav(
  pathname: string | null | undefined,
  searchParams?: SearchParamsReader,
): ActiveNavItem | null {
  const path = normalizePath(pathname ?? "/");
  const listingType = normalizeListingType(searchParams?.get("listingType"));

  const isProperties = path === "/properties" || path.startsWith("/properties/");
  if (isProperties) {
    if (listingType === "SALE") return "sales";
    if (listingType === "RENT") return "rentals";
    return "properties";
  }

  if (path === "/") return "home";
  if (path === "/areas" || path.startsWith("/areas/")) return "areas";
  if (path === "/submit") return "submit";
  if (path === "/request") return "request";
  if (path === "/valuation") return "valuation";
  if (path === "/about") return "about";
  if (path === "/contact") return "contact";
  return null;
}

/**
 * Section-level active state for a top-level item. The Ακίνητα parent stays
 * highlighted for every properties URL (sale, rent or generic), since its
 * children are the more specific destinations.
 */
export function isNavItemActive(item: NavItem, active: ActiveNavItem | null): boolean {
  if (!active) return false;
  if (item.key === "properties") {
    return active === "properties" || active === "sales" || active === "rentals";
  }
  return item.key === active;
}

type QueryReader = { get(name: string): string | null } | null | undefined;

/**
 * Exact active state for any link (used for the mega-menu leaves): same path,
 * and the same transaction/property filter. Ignores unrelated parameters.
 */
export function isNavLinkActive(
  link: NavLink,
  pathname: string | null | undefined,
  searchParams?: QueryReader,
): boolean {
  const target = new URL(link.href, "https://nav.local");
  if (normalizePath(pathname ?? "/") !== normalizePath(target.pathname)) return false;

  const targetListing = normalizeListingType(target.searchParams.get("listingType"));
  const currentListing = normalizeListingType(searchParams?.get("listingType"));
  if (targetListing !== currentListing) return false;

  const targetType = target.searchParams.get("propertyType");
  const currentType = searchParams?.get("propertyType") ?? null;
  return targetType === currentType;
}
