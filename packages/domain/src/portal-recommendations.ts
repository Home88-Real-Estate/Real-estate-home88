/**
 * Explainable, rules-based portal recommendations.
 *
 * Two different questions are kept apart:
 *  - suitability: could this property go to this destination, and is it ready?
 *    Answered here from verified facts only (the directory and the property);
 *  - performance: does the destination actually produce qualified enquiries for
 *    properties like this one? That needs attributed results HOME88 does not hold
 *    yet, so it is reported as UNAVAILABLE, never as zero and never guessed.
 *
 * Nothing here claims an audience, a demand level or an expected speed of sale,
 * and a destination whose acceptance of Greek listings is not confirmed can never
 * be a strong fit. Every verdict lists the facts that produced it.
 */

import type { DirectoryEntry, DistributionStatus } from "./portal-directory";

export const FIT_LEVELS = ["STRONG", "POSSIBLE", "LOW", "NEEDS_INFO", "NOT_ELIGIBLE"] as const;
export type FitLevel = (typeof FIT_LEVELS)[number];

export const FIT_LABELS: Record<FitLevel, string> = {
  STRONG: "Ισχυρή συμβατότητα",
  POSSIBLE: "Πιθανή συμβατότητα",
  LOW: "Χαμηλή προτεραιότητα",
  NEEDS_INFO: "Χρειάζονται πληροφορίες",
  NOT_ELIGIBLE: "Δεν είναι επιλέξιμο",
};

/** The property facts the rules read; all of them exist on the property record. */
export type RecommendationFacts = {
  listingType: string;
  hasGreekTitle: boolean;
  hasGreekDescription: boolean;
  hasEnglishTitle: boolean;
  hasEnglishDescription: boolean;
  hasPrice: boolean;
  hasArea: boolean;
  /** Approved photos only. */
  photoCount: number;
};

/** What the existing portal framework says about this property on this portal, when there is a working integration. */
export type FrameworkVerdict = {
  /** The portal's own readiness for this property. */
  readiness: "READY" | "BLOCKED" | "NOT_SELECTED" | "NOT_CONFIGURED";
  blockers: string[];
};

export type Recommendation = {
  key: string;
  name: string;
  country: string;
  market: DirectoryEntry["market"];
  fit: FitLevel;
  /** Always rules: there is no performance data behind any verdict. */
  basis: "RULES";
  performance: "UNAVAILABLE";
  /** Facts in favour. */
  matches: string[];
  /** Hard problems that stop it (missing data, not eligible). */
  constraints: string[];
  /** Things worth knowing that do not stop it. */
  notes: string[];
  /** Whether HOME88 can actually send there today. */
  connection: DistributionStatus;
  /** One plain sentence. */
  summary: string;
};

const RANK: Record<FitLevel, number> = { STRONG: 0, POSSIBLE: 1, NEEDS_INFO: 2, LOW: 3, NOT_ELIGIBLE: 4 };

export function recommendFor(entry: DirectoryEntry, status: DistributionStatus, facts: RecommendationFacts, framework?: FrameworkVerdict | null): Recommendation {
  const matches: string[] = [];
  const constraints: string[] = [];
  const notes: string[] = [];
  const greek = entry.market === "GR";

  if (status === "UNSUPPORTED") constraints.push("Η ενσωμάτωση δεν υποστηρίζεται.");

  // Listing quality every destination needs, from the property itself.
  if (facts.photoCount === 0) constraints.push("Δεν υπάρχει εγκεκριμένη φωτογραφία.");
  else matches.push(`${facts.photoCount} εγκεκριμένες φωτογραφίες`);
  if (!facts.hasPrice) constraints.push("Λείπει η τιμή.");
  if (!facts.hasGreekDescription || !facts.hasGreekTitle) {
    if (greek) constraints.push("Λείπει ελληνικός τίτλος ή περιγραφή.");
    else notes.push("Λείπει ελληνικός τίτλος ή περιγραφή.");
  } else if (greek) matches.push("Ελληνικός τίτλος και περιγραφή");

  if (greek) {
    matches.push("Ελληνικό portal για ακίνητο στην Ελλάδα");
  } else if (entry.market === "AGGREGATOR") {
    notes.push("Aggregator: η εμπορική πρόσβαση και το feed δεν έχουν επιβεβαιωθεί.");
  } else {
    // Foreign buyers read English; a foreign portal without it is wasted.
    if (!facts.hasEnglishTitle || !facts.hasEnglishDescription) constraints.push("Λείπει αγγλικός τίτλος ή περιγραφή, που χρειάζεται για αγοραστές εξωτερικού.");
    else matches.push("Αγγλικός τίτλος και περιγραφή");
  }
  if (entry.greece === "UNKNOWN") notes.push("Δεν έχει επιβεβαιωθεί ότι δέχεται ακίνητα στην Ελλάδα.");
  if (entry.publication === "FULL_SNAPSHOT") notes.push("Πλήρες feed: ό,τι λείπει από το feed μπορεί να αφαιρεθεί.");

  // The existing framework's own verdict for connected portals is authoritative on readiness.
  if (framework) {
    if (framework.readiness === "BLOCKED") constraints.push(...framework.blockers);
    else if (framework.readiness === "NOT_SELECTED") notes.push("Ο κανόνας δημοσίευσης του portal δεν περιλαμβάνει αυτό το ακίνητο.");
    else if (framework.readiness === "READY") matches.push("Πληροί τους κανόνες του portal");
  }

  if (status === "AWAITING_ACCOUNT" || status === "READY_FOR_TEST") notes.push("Δεν είναι ακόμη πλήρως συνδεδεμένο.");
  if (status === "NEEDS_SPECIFICATION" || status === "CATALOG_ONLY") notes.push("Δεν υπάρχει ακόμη λειτουργική ενσωμάτωση.");

  let fit: FitLevel;
  if (status === "UNSUPPORTED") fit = "NOT_ELIGIBLE";
  else if (constraints.length > 0) fit = "NEEDS_INFO";
  else if (!greek && entry.greece === "UNKNOWN" && entry.market === "EUROPE") fit = "LOW";
  else if (entry.greece === "UNKNOWN") fit = "POSSIBLE";
  else fit = "STRONG";
  // Not ready is a blocker the agent can fix; a destination that cannot accept the listing at all is different.
  if (fit === "STRONG" && (status === "NEEDS_SPECIFICATION" || status === "CATALOG_ONLY") && !framework) fit = "POSSIBLE";

  const summary =
    fit === "STRONG" ? "Κατάλληλο με βάση τα επιβεβαιωμένα στοιχεία."
    : fit === "POSSIBLE" ? "Πιθανώς κατάλληλο· υπάρχουν στοιχεία που δεν έχουν επιβεβαιωθεί."
    : fit === "LOW" ? "Χαμηλή προτεραιότητα: εθνικό portal άλλης χώρας με ανεπιβεβαίωτη αποδοχή ελληνικών ακινήτων."
    : fit === "NEEDS_INFO" ? "Δεν είναι έτοιμο: διορθώστε τα εμπόδια."
    : "Δεν είναι επιλέξιμο.";

  return { key: entry.key, name: entry.name, country: entry.country, market: entry.market, fit, basis: "RULES", performance: "UNAVAILABLE", matches, constraints, notes, connection: status, summary };
}

export function sortRecommendations(rows: readonly Recommendation[]): Recommendation[] {
  return [...rows].sort((a, b) => RANK[a.fit] - RANK[b.fit] || a.name.localeCompare(b.name));
}

export function countByFit(rows: readonly Recommendation[]): Record<FitLevel, number> {
  const out = Object.fromEntries(FIT_LEVELS.map((f) => [f, 0])) as Record<FitLevel, number>;
  for (const r of rows) out[r.fit] += 1;
  return out;
}
