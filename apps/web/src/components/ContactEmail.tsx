/**
 * A configured address as a mailto link, or — when none is configured — a
 * link to the contact form, never a placeholder address.
 */
export function ContactEmail({ email, fallback = "τη φόρμα επικοινωνίας" }: { email: string | null; fallback?: string }) {
  if (email) return <a href={`mailto:${email}`}>{email}</a>;
  return <a href="/contact">{fallback}</a>;
}
