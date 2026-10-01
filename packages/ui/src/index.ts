/**
 * Design tokens and small class helpers.
 *
 * Deliberately framework-free: shared React components across two Next.js apps
 * need a transpile step and a version alignment that is not worth the coupling
 * this early. Tokens and helpers are shared; components live with the app that
 * renders them.
 */

export const BRAND = {
  name: "HOME88",
  /** Overridden per environment from NEXT_PUBLIC_SITE_URL. */
  tagline: { el: "Ακίνητα στην Ελλάδα", en: "Property in Greece" },
} as const;

/**
 * Colours are declared once here and mirrored in globals.css as custom
 * properties. Keep the two in sync; the CSS is the source of truth at runtime.
 */
export const COLORS = {
  ink: "#14181f",
  inkMuted: "#5b6672",
  line: "#e3e7eb",
  paper: "#ffffff",
  surface: "#f6f8fa",
  brand: "#0f5c4a",
  brandInk: "#ffffff",
  accent: "#c8873a",
  danger: "#b3261e",
  success: "#1c6b45",
  warn: "#8a5a00",
} as const;

/** Tiny class-name joiner. Avoids pulling a dependency for one function. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * Renders a value that may be a Prisma Decimal, a number or null.
 * Prisma returns Decimal objects, and `Number(decimal)` is the documented
 * conversion, but doing it implicitly in a template literal gives "[object]".
 */
export function toNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === "object" && "toString" in value) {
    const n = Number(String(value));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Greek mobile/landline formatting for display only; storage stays E.164-ish. */
export function formatPhoneGr(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+30") && digits.length === 13) {
    const n = digits.slice(3);
    return `+30 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  }
  if (digits.startsWith("30") && digits.length === 12) {
    const n = digits.slice(2);
    return `+30 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  }
  if (/^\d{10}$/.test(digits)) {
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }
  return raw;
}
