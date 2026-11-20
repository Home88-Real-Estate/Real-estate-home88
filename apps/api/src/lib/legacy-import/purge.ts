/**
 * Retention purge for quarantined Estate+ imports.
 *
 * It keeps the batch row as an audit tombstone, but removes the staged,
 * encrypted source rows and any leftover private CSV object after expiry.
 * Approved/imported batches and rows linked to canonical records are never
 * eligible. Each batch is claimed independently so overlapping cron runs are
 * safe to retry.
 */
import { Prisma } from "@home88/database";

import { writeAudit } from "../audit";
import { db } from "../prisma";
import { documentStore, isLegacyImportKey } from "../document-store";

const ELIGIBLE_STATUSES = ["CREATED", "FAILED", "STAGED", "NEEDS_REVIEW", "CANCELLED"] as const;
const CLAIM_STALE_AFTER_MS = 60 * 60 * 1000;
const DEFAULT_BATCH_LIMIT = 25;
const MAX_BATCH_LIMIT = 100;

export type LegacyImportPurgeResult = {
  examined: number;
  purgedBatches: number;
  deletedRows: number;
  skipped: number;
  failed: number;
};

export async function purgeExpiredLegacyImports(input: {
  now?: Date;
  limit?: number;
} = {}): Promise<LegacyImportPurgeResult> {
  const now = input.now ?? new Date();
  if (Number.isNaN(now.valueOf())) throw new RangeError("Invalid purge clock.");
  const requestedLimit = input.limit ?? DEFAULT_BATCH_LIMIT;
  const limit = Math.min(MAX_BATCH_LIMIT, Math.max(1, Math.floor(requestedLimit)));
  const staleBefore = new Date(now.getTime() - CLAIM_STALE_AFTER_MS);
  const result: LegacyImportPurgeResult = {
    examined: 0,
    purgedBatches: 0,
    deletedRows: 0,
    skipped: 0,
    failed: 0,
  };

  const candidates = await db().legacyImportBatch.findMany({
    where: {
      status: { in: [...ELIGIBLE_STATUSES] },
      retentionExpiresAt: { lte: now },
      purgedAt: null,
      approvedAt: null,
      importedRowCount: 0,
      OR: [{ purgeLockedAt: null }, { purgeLockedAt: { lt: staleBefore } }],
    },
    orderBy: [{ retentionExpiresAt: "asc" }, { createdAt: "asc" }],
    take: limit,
    select: { id: true, temporaryStorageKey: true },
  });

  for (const candidate of candidates) {
    result.examined += 1;

    // The exact lease timestamp is used as a compare-and-set token.
    const claimed = await db().legacyImportBatch.updateMany({
      where: {
        id: candidate.id,
        status: { in: [...ELIGIBLE_STATUSES] },
        retentionExpiresAt: { lte: now },
        purgedAt: null,
        approvedAt: null,
        importedRowCount: 0,
        OR: [{ purgeLockedAt: null }, { purgeLockedAt: { lt: staleBefore } }],
      },
      data: { purgeLockedAt: now },
    });
    if (claimed.count !== 1) {
      result.skipped += 1;
      continue;
    }

    try {
      // Check for canonical links before touching the source object.
      const [linkedRows, entityMappings] = await Promise.all([
        db().legacyImportRow.count({
          where: { batchId: candidate.id, targetEntityId: { not: null } },
        }),
        db().legacyEntityMapping.count({ where: { importBatchId: candidate.id } }),
      ]);
      if (linkedRows > 0 || entityMappings > 0) {
        await db().legacyImportBatch.updateMany({
          where: { id: candidate.id, purgeLockedAt: now },
          data: { purgeLockedAt: null },
        });
        result.skipped += 1;
        continue;
      }

      if (candidate.temporaryStorageKey) {
        if (!isLegacyImportKey(candidate.temporaryStorageKey)) {
          throw new Error("Invalid temporary import object key; refusing purge.");
        }
        const store = documentStore();
        if (!store.configured()) throw new Error("Private object storage is not configured.");
        // S3 DeleteObject is idempotent; retries are safe if the DB transaction fails.
        await store.remove(candidate.temporaryStorageKey);
      }

      const deletedRows = await db().$transaction(async (tx) => {
        const batch = await tx.legacyImportBatch.findUnique({ where: { id: candidate.id } });
        if (
          !batch
          || batch.purgeLockedAt?.getTime() !== now.getTime()
          || !ELIGIBLE_STATUSES.includes(batch.status as (typeof ELIGIBLE_STATUSES)[number])
          || !batch.retentionExpiresAt
          || batch.retentionExpiresAt > now
          || batch.purgedAt !== null
          || batch.approvedAt !== null
          || batch.importedRowCount !== 0
        ) {
          return null;
        }

        const [linkedRows, entityMappings, rowCount] = await Promise.all([
          tx.legacyImportRow.count({
            where: { batchId: candidate.id, targetEntityId: { not: null } },
          }),
          tx.legacyEntityMapping.count({ where: { importBatchId: candidate.id } }),
          tx.legacyImportRow.count({ where: { batchId: candidate.id } }),
        ]);
        if (linkedRows > 0 || entityMappings > 0) return null;

        const marked = await tx.legacyImportBatch.updateMany({
          where: {
            id: candidate.id,
            status: { in: [...ELIGIBLE_STATUSES] },
            retentionExpiresAt: { lte: now },
            purgedAt: null,
            approvedAt: null,
            importedRowCount: 0,
            purgeLockedAt: now,
          },
          data: {
            status: "EXPIRED",
            temporaryStorageKey: null,
            purgeLockedAt: null,
            purgedAt: now,
            purgedRowCount: rowCount,
            fieldMapping: Prisma.DbNull,
            columnHeaders: Prisma.DbNull,
          },
        });
        if (marked.count !== 1) return null;

        const deletion = await tx.legacyImportRow.deleteMany({ where: { batchId: candidate.id } });
        if (deletion.count !== rowCount) {
          throw new Error("Staged row count changed during the retention purge.");
        }

        await writeAudit({
          entity: "LEGACY_IMPORT_BATCH",
          entityId: candidate.id,
          action: "retention_purge",
          changes: {
            status: "EXPIRED",
            purgedRowCount: deletion.count,
            sourceObjectRemoved: Boolean(candidate.temporaryStorageKey),
            retentionPolicyApplied: true,
          },
          actorId: null,
        }, tx);
        return deletion.count;
      });

      if (deletedRows === null) {
        await db().legacyImportBatch.updateMany({
          where: { id: candidate.id, purgeLockedAt: now },
          data: { purgeLockedAt: null },
        });
        result.skipped += 1;
        continue;
      }

      result.purgedBatches += 1;
      result.deletedRows += deletedRows;
    } catch {
      // Never expose source keys or personal data in operational output.
      await db().legacyImportBatch.updateMany({
        where: { id: candidate.id, purgeLockedAt: now },
        data: { purgeLockedAt: null },
      }).catch(() => undefined);
      result.failed += 1;
    }
  }

  return result;
}
