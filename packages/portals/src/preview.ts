/**
 * Dry run of a portal publication.
 *
 * Runs every property through the same gates a real sync uses (on the market,
 * publication rule, adapter support, portal validation, taxonomy mapping) and
 * reports what would go out and why the rest would not. It touches nothing.
 */

import { PUBLISHABLE_STATUSES } from "./eligibility";
import { checkMappings, type MappingEntry } from "./mapping";
import { evaluatePublicationRule, type PublicationRule } from "./rules";
import { guardPublicationChange, type GuardConfig, type GuardVerdict } from "./safety";
import type { PortalAdapter, PortalProperty } from "./types";
import { validateForPortal, type ValidationIssue, type ValidationProfile } from "./validation";

export type PreviewCandidate = { property: PortalProperty; tagCodes: string[] };

export type PreviewInput = CandidateContext & {
  candidates: PreviewCandidate[];
  /** Last confirmed publication size; null before the first publication. */
  previousCount: number | null;
  guard?: GuardConfig;
};

export type PreviewOutcome = "READY" | "BLOCKED" | "NOT_SELECTED";

export type PreviewItem = {
  reference: string;
  outcome: PreviewOutcome;
  /** Why it is not selected or cannot publish; empty when ready. */
  reasons: string[];
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

export type PreviewResult = {
  total: number;
  /** Chosen by the publication rule and supported by the portal. */
  selected: number;
  ready: number;
  blocked: number;
  notSelected: number;
  warningCount: number;
  /** What the feed or push would contain. */
  expectedCount: number;
  mappingConfigured: boolean;
  guard: GuardVerdict;
  /** Reason text → how many properties hit it, largest first. */
  reasonCounts: Array<{ reason: string; count: number }>;
  items: PreviewItem[];
};

/** Everything one property is judged against; shared by previews, syncs and feeds. */
export type CandidateContext = {
  adapter?: PortalAdapter | null;
  rule: PublicationRule | null | undefined;
  profile: ValidationProfile;
  mappings: MappingEntry[];
  allowAssignment: boolean;
};

/**
 * The single gate a property passes before it may go to a portal. A real sync
 * and a feed use this too, so what the dry run promises is what is published.
 */
export function evaluateCandidate({ property, tagCodes }: PreviewCandidate, ctx: CandidateContext): PreviewItem {
  const base = { reference: property.reference, errors: [], warnings: [] };

  if (!(PUBLISHABLE_STATUSES as readonly string[]).includes(property.status)) {
    return { ...base, outcome: "NOT_SELECTED", reasons: [`status ${property.status.toLowerCase()}`] };
  }
  const reasons = [...evaluatePublicationRule(property, tagCodes, ctx.rule).reasons];
  if (property.listingType === "ASSIGNMENT" && !ctx.allowAssignment) {
    reasons.push("assignment listings are not carried");
  }
  if (ctx.adapter && !ctx.adapter.supports(property)) reasons.push("not supported by this portal");
  if (reasons.length > 0) return { ...base, outcome: "NOT_SELECTED", reasons };

  const validation = validateForPortal(property, ctx.profile);
  const mapping = checkMappings(property, ctx.mappings);
  const errors = [...validation.errors, ...mapping.errors];
  return {
    reference: property.reference,
    outcome: errors.length === 0 ? "READY" : "BLOCKED",
    reasons: errors.map((e) => e.message),
    errors,
    warnings: [...validation.warnings, ...mapping.warnings],
  };
}

export function buildPublicationPreview(input: PreviewInput): PreviewResult {
  const items = input.candidates.map((candidate) => evaluateCandidate(candidate, input));
  const mappingConfigured = input.mappings.length > 0;

  const ready = items.filter((i) => i.outcome === "READY").length;
  const blocked = items.filter((i) => i.outcome === "BLOCKED").length;
  const notSelected = items.length - ready - blocked;

  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.outcome === "READY") continue;
    for (const reason of new Set(item.reasons)) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }

  return {
    total: items.length,
    selected: ready + blocked,
    ready,
    blocked,
    notSelected,
    warningCount: items.reduce((sum, i) => sum + i.warnings.length, 0),
    expectedCount: ready,
    mappingConfigured,
    guard: guardPublicationChange(input.previousCount, ready, input.guard),
    reasonCounts: [...counts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
    items,
  };
}
