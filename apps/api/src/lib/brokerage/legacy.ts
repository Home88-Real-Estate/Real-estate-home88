/**
 * Mapping of records from another system (Estate+, a CSV…) to HOME88 records.
 *
 * Idempotent: asking for the same legacy id again returns the same mapping, and
 * never silently points it somewhere else. Importing itself is not part of this
 * phase; this is the table and the rules it will rely on.
 */

import { Prisma } from "@home88/database";

import { BrokerageError } from "./errors";
import type { Db } from "./types";

export const DEFAULT_ORGANIZATION = "home88";
export type LegacySource = "ESTATE_PLUS" | "HOME88_LEGACY" | "MANUAL_IMPORT" | "CSV_IMPORT";

export type LegacyMappingInput = {
  organizationId?: string;
  sourceSystem: LegacySource;
  sourceEntityType: string;
  legacyId: string;
  targetEntityType: string;
  targetEntityId: string;
  importBatchId?: string | null;
  sourcePayloadHash?: string | null;
  importedByUserId?: string | null;
};

export type LegacyMappingResult = { status: "created" | "existing"; id: string; targetEntityType: string; targetEntityId: string; payloadChanged: boolean };

const key = (i: LegacyMappingInput) => ({
  organizationId_sourceSystem_sourceEntityType_legacyId: {
    organizationId: i.organizationId ?? DEFAULT_ORGANIZATION,
    sourceSystem: i.sourceSystem,
    sourceEntityType: i.sourceEntityType,
    legacyId: i.legacyId,
  },
});

export async function recordLegacyMapping(db: Db, input: LegacyMappingInput): Promise<LegacyMappingResult> {
  const settle = (row: { id: string; targetEntityType: string; targetEntityId: string; sourcePayloadHash: string | null }): LegacyMappingResult => {
    if (row.targetEntityType !== input.targetEntityType || row.targetEntityId !== input.targetEntityId) {
      // The same legacy record already stands for a different HOME88 record: never repoint it quietly.
      throw new BrokerageError("LEGACY_MAPPING_CONFLICT", `Το παλιό αναγνωριστικό ${input.sourceSystem}/${input.sourceEntityType}/${input.legacyId} αντιστοιχεί ήδη σε άλλη εγγραφή.`);
    }
    return {
      status: "existing",
      id: row.id,
      targetEntityType: row.targetEntityType,
      targetEntityId: row.targetEntityId,
      payloadChanged: Boolean(input.sourcePayloadHash && row.sourcePayloadHash && input.sourcePayloadHash !== row.sourcePayloadHash),
    };
  };

  const existing = await db.legacyEntityMapping.findUnique({ where: key(input) });
  if (existing) return settle(existing);

  try {
    const row = await db.legacyEntityMapping.create({
      data: {
        organizationId: input.organizationId ?? DEFAULT_ORGANIZATION,
        sourceSystem: input.sourceSystem,
        sourceEntityType: input.sourceEntityType,
        legacyId: input.legacyId,
        targetEntityType: input.targetEntityType,
        targetEntityId: input.targetEntityId,
        importBatchId: input.importBatchId ?? null,
        sourcePayloadHash: input.sourcePayloadHash ?? null,
        importedByUserId: input.importedByUserId ?? null,
      },
    });
    return { status: "created", id: row.id, targetEntityType: row.targetEntityType, targetEntityId: row.targetEntityId, payloadChanged: false };
  } catch (error) {
    // Two imports raced for the same legacy id: the loser re-reads the winner's row.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const again = await db.legacyEntityMapping.findUnique({ where: key(input) });
      if (again) return settle(again);
    }
    throw error;
  }
}

export async function resolveLegacyMapping(db: Db, ref: Pick<LegacyMappingInput, "organizationId" | "sourceSystem" | "sourceEntityType" | "legacyId">) {
  return db.legacyEntityMapping.findUnique({
    where: {
      organizationId_sourceSystem_sourceEntityType_legacyId: {
        organizationId: ref.organizationId ?? DEFAULT_ORGANIZATION,
        sourceSystem: ref.sourceSystem,
        sourceEntityType: ref.sourceEntityType,
        legacyId: ref.legacyId,
      },
    },
  });
}
