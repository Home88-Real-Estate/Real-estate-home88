/**
 * Contact identity normalisation.
 *
 * Matching a returning visitor to an existing contact depends on both sides
 * being reduced to the same canonical form, so this lives in one place and is
 * used by every public flow and by the CRM.
 */

export function normaliseEmail(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

/**
 * Canonical phone: Greek numbers collapse to their 10 national digits whether
 * written `210 123 4567`, `+30 210 123 4567`, `0030 210...` or `30210...`;
 * foreign numbers keep a leading `+` and their country code. Returns null for
 * anything that cannot be a phone number, so junk never becomes a match key.
 */
export function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim().replace(/[\s().\-/]/g, "");
  if (value.startsWith("00")) value = `+${value.slice(2)}`;
  if (!/^\+?\d{7,15}$/.test(value)) return null;

  const plus = value.startsWith("+");
  const digits = plus ? value.slice(1) : value;
  if (digits.startsWith("30") && digits.length === 12) return digits.slice(2);
  if (plus) return `+${digits}`;
  return digits;
}
