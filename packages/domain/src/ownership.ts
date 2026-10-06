/**
 * Who owns a property and who may sign for it.
 *
 * A property has any number of owners, each in a capacity and with an optional
 * share. Nothing is assumed: an unknown share stays unknown (never 100 %), and
 * a share total below 100 % is a warning, not an error, because a partial
 * ownership may be recorded deliberately.
 */

import type { ValidationIssue } from "./document-validation";

export const OWNER_CAPACITIES = [
  "OWNER",
  "CO_OWNER",
  "USUFRUCTUARY",
  "BARE_OWNER",
  "LEGAL_REPRESENTATIVE",
  "ATTORNEY_IN_FACT",
  "COMPANY_REPRESENTATIVE",
  "OTHER",
] as const;
export type OwnerCapacity = (typeof OWNER_CAPACITIES)[number];

/** Capacities that hold a right in the property; the others act for someone who does. */
const HOLDS_RIGHT = new Set<string>(["OWNER", "CO_OWNER", "USUFRUCTUARY", "BARE_OWNER"]);
const ACTS_FOR_OTHERS = new Set<string>(["LEGAL_REPRESENTATIVE", "ATTORNEY_IN_FACT", "COMPANY_REPRESENTATIVE"]);

export type OwnerFact = {
  contactId: string;
  capacity: OwnerCapacity | string;
  ownershipPercentage?: number | null;
  isSignatory?: boolean;
  representativeCapacity?: OwnerCapacity | string | null;
  hasAuthority?: boolean;
  validFrom?: Date | string | null;
  validTo?: Date | string | null;
};

/** The owners in force on `on` (a person whose ownership ended is not an owner today). */
export function currentOwners<T extends OwnerFact>(owners: T[], on: Date = new Date()): T[] {
  const day = (v: Date | string | null | undefined) => (v ? new Date(v).getTime() : null);
  const t = on.getTime();
  return owners.filter((o) => {
    const from = day(o.validFrom);
    const to = day(o.validTo);
    return (from === null || from <= t) && (to === null || to >= t - 86_400_000 + 1);
  });
}

export type OwnershipOptions = {
  on?: Date;
  /** A manager accepted that fewer than all owners sign, and why. */
  partialSigningOverrideReason?: string | null;
};

export function validateOwnership(all: OwnerFact[], opts: OwnershipOptions = {}): { blockingIssues: ValidationIssue[]; warnings: ValidationIssue[] } {
  const blocking: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const owners = currentOwners(all, opts.on);

  const holders = owners.filter((o) => HOLDS_RIGHT.has(o.capacity));
  const representatives = owners.filter((o) => ACTS_FOR_OTHERS.has(o.capacity) || (o.representativeCapacity && ACTS_FOR_OTHERS.has(o.representativeCapacity)));

  if (holders.length === 0) {
    blocking.push({ code: "OWNER_MISSING", field: "owners", message: "Δεν έχει οριστεί ιδιοκτήτης στο ακίνητο." });
    return { blockingIssues: blocking, warnings };
  }

  for (const r of representatives) {
    if (!r.hasAuthority) blocking.push({ code: "OWNER_AUTHORITY_MISSING", field: "owners", message: "Λείπει η εξουσιοδότηση/πληρεξουσιότητα εκπροσώπου." });
  }

  // Shares are added per right: full owners together, a usufruct and bare ownership each on their own.
  const groups: Array<{ label: string; members: OwnerFact[] }> = [
    { label: "πλήρους κυριότητας", members: holders.filter((o) => o.capacity === "OWNER" || o.capacity === "CO_OWNER") },
    { label: "επικαρπίας", members: holders.filter((o) => o.capacity === "USUFRUCTUARY") },
    { label: "ψιλής κυριότητας", members: holders.filter((o) => o.capacity === "BARE_OWNER") },
  ];
  for (const g of groups) {
    if (g.members.length === 0) continue;
    const given = g.members.filter((o) => typeof o.ownershipPercentage === "number");
    if (given.length === 0) {
      if (g.members.length > 1) warnings.push({ code: "OWNERSHIP_SHARES_UNKNOWN", field: "owners", message: `Δεν έχουν δηλωθεί τα ποσοστά των συνιδιοκτητών (${g.label}).` });
      continue;
    }
    // Scaled by 100 so 33.33 + 33.33 + 33.34 sums exactly.
    const total = given.reduce((s, o) => s + Math.round((o.ownershipPercentage as number) * 100), 0);
    if (given.length < g.members.length) {
      warnings.push({ code: "OWNERSHIP_SHARES_INCOMPLETE", field: "owners", message: `Λείπει το ποσοστό ορισμένων συνιδιοκτητών (${g.label}).` });
    }
    if (total > 10_000) {
      blocking.push({ code: "OWNERSHIP_OVER_100", field: "owners", integrity: true, message: `Τα ποσοστά ${g.label} αθροίζουν ${total / 100}%, πάνω από 100%.` });
    } else if (total < 10_000 && given.length === g.members.length) {
      warnings.push({ code: "OWNERSHIP_UNDER_100", field: "owners", message: `Τα ποσοστά ${g.label} αθροίζουν ${total / 100}%, κάτω από 100%.` });
    }
  }

  const signing = owners.filter((o) => o.isSignatory);
  if (signing.length === 0) {
    blocking.push({ code: "SIGNATORY_MISSING", field: "owners", message: "Κανένας ιδιοκτήτης ή εκπρόσωπος δεν ορίζεται ως υπογράφων." });
  } else {
    const notSigning = holders.filter((o) => !o.isSignatory);
    if (notSigning.length > 0) {
      const reason = opts.partialSigningOverrideReason?.trim();
      const representedByAuthority = representatives.some((r) => r.isSignatory && r.hasAuthority);
      if (reason) {
        warnings.push({ code: "PARTIAL_SIGNING_OVERRIDDEN", field: "owners", message: `Δεν υπογράφουν όλοι οι ιδιοκτήτες (έχει γίνει αποδοχή: ${reason}).` });
      } else if (representedByAuthority) {
        warnings.push({ code: "OWNER_REPRESENTED", field: "owners", message: "Δεν υπογράφουν όλοι οι ιδιοκτήτες· ελέγξτε ότι η εξουσιοδότηση καλύπτει τους υπόλοιπους." });
      } else {
        blocking.push({ code: "OWNER_NOT_SIGNING", field: "owners", message: "Δεν υπογράφουν όλοι οι ιδιοκτήτες· απαιτείται εξουσιοδότηση ή αιτιολογημένη έγκριση προϊσταμένου." });
      }
    }
  }
  return { blockingIssues: blocking, warnings };
}
