/**
 * Navigation route resolution.
 *
 * Πωλήσεις, Ενοικιάσεις and Ακίνητα all render the same `/properties` page;
 * they are nonetheless three distinct top-level destinations. The URL path and
 * the `listingType` query parameter together decide which one is active, so the
 * highlight must never be derived from the pathname alone.
 *
 * Kept pure and framework-free so it can be unit-tested and shared by the
 * desktop and mobile navigation.
 */

export type ActiveNavItem =
  | "sales"
  | "rentals"
  | "properties"
  | "areas"
  | "submit"
  | "request"
  | "valuation"
  | "about"
  | "contact";

export type NavItem = {
  href: string;
  label: string;
  /** The resolved active-nav value that lights this item up. */
  key: ActiveNavItem;
};

/** Single source of truth for the public navigation. */
export const NAV: NavItem[] = [
  { href: "/properties?listingType=SALE", label: "Πωλήσεις", key: "sales" },
  { href: "/properties?listingType=RENT", label: "Ενοικιάσεις", key: "rentals" },
  { href: "/properties", label: "Ακίνητα", key: "properties" },
  { href: "/areas", label: "Περιοχές", key: "areas" },
  { href: "/submit", label: "Ανάθεση", key: "submit" },
  { href: "/request", label: "Ζήτηση", key: "request" },
  { href: "/valuation", label: "Εκτίμηση", key: "valuation" },
  { href: "/about", label: "Εταιρεία", key: "about" },
  { href: "/contact", label: "Επικοινωνία", key: "contact" },
];

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
 * transaction wins over the generic Ακίνητα destination, so exactly one of the
 * three is ever active. Unrelated filters (area, price, …) are ignored.
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

  if (path === "/areas" || path.startsWith("/areas/")) return "areas";
  if (path === "/submit") return "submit";
  if (path === "/request") return "request";
  if (path === "/valuation") return "valuation";
  if (path === "/about") return "about";
  if (path === "/contact") return "contact";
  return null;
}
