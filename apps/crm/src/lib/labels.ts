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
