/**
 * Automation: rules that turn something the office has stopped noticing into
 * a task for the person responsible.
 *
 * Every rule is OFF until HOME88 sets its number of days in Settings →
 * Αυτοματισμοί; the platform ships no thresholds. Rules only create CRM tasks
 * and in-CRM notices for staff. Nothing is ever sent to a client by an
 * automation. Each rule fires once per "episode" (for example, once per
 * period of silence on a lead), so a task is not recreated every night.
 */

export const AUTOMATION_RULES = [
  {
    key: "LEAD_STALE",
    section: "automation",
    field: "leadStaleDays",
    label: "Lead χωρίς επικοινωνία",
    help: "Ημέρες από την τελευταία επικοινωνία (ή τη δημιουργία) ενός ανοιχτού lead.",
    taskLabel: "Επικοινωνία με lead",
  },
  {
    key: "VIEWING_FOLLOWUP",
    section: "automation",
    field: "viewingFollowUpDays",
    label: "Υπόδειξη χωρίς follow-up",
    help: "Ημέρες μετά από ολοκληρωμένη υπόδειξη χωρίς άλλη ενέργεια στο lead.",
    taskLabel: "Follow-up μετά από υπόδειξη",
  },
  {
    key: "LISTING_STALE",
    /** Already a setting of its own (Ρυθμίσεις → Ακίνητα → Παρακολούθηση); not duplicated here. */
    section: "properties",
    field: "staleAfterDays",
    label: "Καταχώριση χωρίς ενημέρωση",
    help: "Ημέρες από την τελευταία αλλαγή ενός ενεργού ακινήτου.",
    taskLabel: "Έλεγχος καταχώρισης",
  },
  {
    key: "MANDATE_EXPIRING",
    section: "automation",
    field: "mandateExpiryDays",
    label: "Εντολή που λήγει",
    help: "Ημέρες πριν τη λήξη μιας υπογεγραμμένης εντολής.",
    taskLabel: "Ανανέωση εντολής",
  },
  {
    key: "OFFER_EXPIRING",
    section: "automation",
    field: "offerExpiryDays",
    label: "Προσφορά που λήγει",
    help: "Ημέρες πριν τη λήξη μιας προσφοράς που περιμένει απάντηση.",
    taskLabel: "Απάντηση σε προσφορά",
  },
  {
    key: "SELLER_FOLLOWUP",
    section: "automation",
    field: "sellerFollowUpOverdueDays",
    label: "Εκπρόθεσμο follow-up ιδιοκτήτη",
    help: "Ημέρες καθυστέρησης της προγραμματισμένης επικοινωνίας με ιδιοκτήτη (0 = την ίδια μέρα).",
    taskLabel: "Follow-up ιδιοκτήτη",
  },
] as const;

export type AutomationRuleKey = (typeof AUTOMATION_RULES)[number]["key"];
export type AutomationRule = (typeof AUTOMATION_RULES)[number];

export const AUTOMATION_RULE_LABELS: Record<string, string> = Object.fromEntries(AUTOMATION_RULES.map((r) => [r.key, r.label]));

/** Days configured for a rule, from the values of the settings section it lives in; null when the rule is off. */
export function ruleDays(values: Record<string, unknown>, rule: AutomationRule): number | null {
  const v = values[rule.field];
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

const DAY = 24 * 3_600_000;

/** True when `at` is at least `days` days before `now`. */
export function olderThan(at: Date | string | null | undefined, days: number, now: Date): boolean {
  if (!at) return false;
  return now.getTime() - new Date(at).getTime() >= days * DAY;
}

/** True when `at` is in the future but within `days` days of `now`. */
export function dueWithin(at: Date | string | null | undefined, days: number, now: Date): boolean {
  if (!at) return false;
  const left = new Date(at).getTime() - now.getTime();
  return left >= 0 && left <= days * DAY;
}

/**
 * A task title. It names the record by its reference only (LD-000123, never a
 * person), because tasks and notifications are visible beyond the assignee.
 */
export function automationTaskTitle(rule: AutomationRule, reference: string): string {
  return `${rule.taskLabel} · ${reference}`;
}

/** The identity of one occurrence of a condition; the same episode never creates a second task. */
export function episodeKey(parts: Array<string | Date | null | undefined>): string {
  return parts.map((p) => (p instanceof Date ? p.toISOString() : (p ?? "-"))).join("|");
}
