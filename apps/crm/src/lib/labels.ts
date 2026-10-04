/** Greek UI labels for the shared catalog groupings (see @home88/domain). */

import type { LeadChannel, PropertyCategory } from "@home88/domain";

export const CATEGORY_LABEL: Record<PropertyCategory, string> = {
  RESIDENTIAL: "Κατοικίες",
  COMMERCIAL: "Επαγγελματικά",
  LAND: "Οικόπεδα / Γη",
  OTHER: "Λοιπά",
};

export const CHANNEL_LABEL: Record<LeadChannel, string> = {
  WEBSITE: "Ιστότοπος",
  PORTAL: "Portals",
  DIRECT: "Απευθείας",
};

export const TASK_PRIORITY_LABEL: Record<string, string> = {
  LOW: "Χαμηλή",
  NORMAL: "Κανονική",
  HIGH: "Υψηλή",
  URGENT: "Επείγουσα",
};

export const VIEWING_STATUS_LABEL: Record<string, string> = {
  SCHEDULED: "Προγραμματισμένο",
  COMPLETED: "Ολοκληρώθηκε",
  CANCELLED: "Ακυρώθηκε",
  NO_SHOW: "Δεν εμφανίστηκε",
};

export const OFFER_STATUS_LABEL: Record<string, string> = {
  SUBMITTED: "Υποβλήθηκε",
  COUNTERED: "Αντιπρόταση",
  ACCEPTED: "Αποδεκτή",
  REJECTED: "Απορρίφθηκε",
  WITHDRAWN: "Αποσύρθηκε",
  EXPIRED: "Έληξε",
};

export const REQUEST_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Ενεργή",
  PAUSED: "Σε παύση",
  FULFILLED: "Ολοκληρώθηκε",
  CANCELLED: "Ακυρώθηκε",
};

export const REQUEST_STATUS_CLASS: Record<string, string> = {
  ACTIVE: "badge badge--ok",
  PAUSED: "badge badge--warn",
  FULFILLED: "badge badge--info",
  CANCELLED: "badge badge--muted",
};

const EURO = new Intl.NumberFormat("el-GR", { maximumFractionDigits: 0 });

/** "300.000 – 450.000 €", "έως 1.200 €", "—". */
export function priceRange(min: unknown, max: unknown): string {
  const lo = min == null ? null : Number(min);
  const hi = max == null ? null : Number(max);
  if (lo != null && hi != null) return `${EURO.format(lo)} – ${EURO.format(hi)} €`;
  if (hi != null) return `έως ${EURO.format(hi)} €`;
  if (lo != null) return `από ${EURO.format(lo)} €`;
  return "—";
}

export const TRX_STATUS_CLASS: Record<string, string> = {
  NEGOTIATION: "badge badge--info",
  AGREEMENT: "badge badge--warn",
  CONTRACT: "badge badge--warn",
  CLOSED: "badge badge--ok",
  CANCELLED: "badge badge--muted",
};

export const SELLER_STAGE_CLASS: Record<string, string> = {
  NEW: "badge badge--info",
  CONTACTED: "badge badge--info",
  VALUATION: "badge badge--warn",
  PROPOSAL: "badge badge--warn",
  MANDATE: "badge badge--warn",
  LISTED: "badge badge--ok",
  LOST: "badge badge--muted",
};

export const VALUATION_STATUS_CLASS: Record<string, string> = {
  DRAFT: "badge badge--info",
  FINAL: "badge badge--ok",
};
