/** The structured terms of a mandate as API input (Phase A columns), shared by create and update. */

import { z } from "zod";
import type { Prisma } from "@home88/database";
import { FEE_BASES, FEE_METHODS, FEE_PAYERS, PAYMENT_TRIGGERS, VAT_TREATMENTS, validateCommission, type FeeTerms } from "@home88/domain";

import { validationFailed } from "../../errors";

const num = z.union([z.number(), z.string().trim().min(1)]).transform((v) => Number(v)).refine((v) => Number.isFinite(v), "Μη έγκυρος αριθμός.");
const text = (max: number) => z.string().trim().max(max).optional().or(z.literal("")).transform((v) => (v ? v : null));
const bool = z.boolean().nullable().optional();

export const milestoneInput = z.object({
  sequence: z.number().int().min(1).max(20),
  percentage: num.nullable().optional(),
  fixedAmount: num.nullable().optional(),
  trigger: z.enum(PAYMENT_TRIGGERS),
  description: text(200),
  dueDateRule: text(200),
});

export const structuredShape = {
  feePayer: z.enum(FEE_PAYERS).nullable().optional(),
  feeMethod: z.enum(FEE_METHODS).nullable().optional(),
  feeBasis: z.enum(FEE_BASES).nullable().optional(),
  feePercentage: num.nullable().optional(),
  feeFixedAmount: num.nullable().optional(),
  feeCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).nullable().optional(),
  vatTreatment: z.enum(VAT_TREATMENTS).nullable().optional(),
  vatRate: num.nullable().optional(),
  paymentTrigger: z.enum(PAYMENT_TRIGGERS).nullable().optional(),
  milestones: z.array(milestoneInput).max(12).optional(),
  durationType: z.enum(["INDEFINITE", "FIXED_TERM"]).nullable().optional(),
  knownDefects: bool,
  defectsDisclosureConfirmed: bool,
  defectsDescription: text(2000),
  photoPermission: bool,
  videoPermission: bool,
  floorplanPermission: bool,
  signboardPermission: bool,
  portalPublicationPermission: bool,
  socialMediaPermission: bool,
  cooperatingBrokerPermission: bool,
  brokerCooperationAllowed: bool,
  dualRepresentationConsent: bool,
  marketingChannels: z.array(z.string().trim().max(40)).max(12).optional(),
  specialTerms: text(4000),
  /** Reference (MND-…) of the mandate this one replaces. */
  supersedesReference: z.string().trim().max(30).optional().or(z.literal("")),
};

const COLUMNS = [
  "feePayer", "feeMethod", "feeBasis", "feeCurrency", "vatTreatment", "paymentTrigger", "durationType", "knownDefects", "defectsDisclosureConfirmed",
  "defectsDescription", "photoPermission", "videoPermission", "floorplanPermission", "signboardPermission", "portalPublicationPermission",
  "socialMediaPermission", "cooperatingBrokerPermission", "brokerCooperationAllowed", "dualRepresentationConsent", "marketingChannels", "specialTerms",
] as const;
const DECIMALS = ["feePercentage", "feeFixedAmount", "vatRate"] as const;

/** Only the keys the caller actually sent; absent means "leave as it is". */
export function structuredMandateData(input: Record<string, unknown>): Prisma.MandateUncheckedUpdateInput {
  const data: Record<string, unknown> = {};
  for (const k of COLUMNS) if (k in input && input[k] !== undefined) data[k] = input[k];
  for (const k of DECIMALS) if (k in input && input[k] !== undefined) data[k] = input[k] == null ? null : Number(input[k]);
  // A changed fee invalidates an earlier acknowledgement of its anomaly.
  if (["feeMethod", "feePercentage", "feeFixedAmount", "feeBasis"].some((k) => k in input && input[k] !== undefined)) {
    data.feeAnomalyOverrideReason = null;
    data.feeAnomalyOverriddenById = null;
  }
  return data as Prisma.MandateUncheckedUpdateInput;
}

/** Impossible fee values are refused even in a draft. */
export function assertFeeSaveable(input: Record<string, unknown>) {
  const terms: FeeTerms = {
    payer: (input.feePayer as FeeTerms["payer"]) ?? null, method: (input.feeMethod as FeeTerms["method"]) ?? null, basis: (input.feeBasis as FeeTerms["basis"]) ?? null,
    percentage: input.feePercentage == null ? null : Number(input.feePercentage), fixedAmount: input.feeFixedAmount == null ? null : Number(input.feeFixedAmount),
    currency: (input.feeCurrency as string | null) ?? null, vatTreatment: (input.vatTreatment as FeeTerms["vatTreatment"]) ?? null, vatRate: input.vatRate == null ? null : Number(input.vatRate),
    paymentTrigger: (input.paymentTrigger as FeeTerms["paymentTrigger"]) ?? null,
    milestones: ((input.milestones as Array<{ sequence: number; percentage?: number | null; fixedAmount?: number | null; trigger: string }>) ?? []).map((m) => ({ sequence: m.sequence, percentage: m.percentage ?? null, fixedAmount: m.fixedAmount ?? null, trigger: m.trigger })),
  };
  const r = validateCommission(terms, {}, { requireComplete: false });
  if (!r.draftSaveable) {
    const fields: Record<string, string[]> = {};
    for (const i of r.blockingIssues.filter((x) => x.integrity)) (fields[i.field ?? "fee"] ??= []).push(i.message);
    throw validationFailed("Ελέγξτε τα πεδία της αμοιβής.", fields);
  }
}
