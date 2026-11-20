/**
 * Controlled Estate+ CSV staging. This phase stops before entity mapping,
 * approval and writes to canonical HOME88 records.
 *
 * Security boundaries:
 * - Managers and above only.
 * - Private, short-lived source upload; the source object is deleted after staging.
 * - Raw row values are AES-256-GCM encrypted before database persistence.
 * - No source cells or contact details are written to logs or audit metadata.
 */

import { randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { Prisma } from "@home88/database";
import { z } from "zod";

import { writeAudit } from "../lib/audit";
import { purgeExpiredLegacyImports } from "../lib/legacy-import/purge";
import { configuredLegacyImportRetentionDays, legacyImportExpiry } from "../lib/legacy-import/retention";
import { conflict, notFound, badRequest } from "../lib/errors";
import { clientIp, parseInput, userAgent } from "../lib/http";
import { decryptField, encryptField, hasEncryptionKey } from "../lib/pii";
import { db } from "../lib/prisma";
import { documentStore, isLegacyImportKey, legacyImportKey, sha256 } from "../lib/document-store";
import { requireRole } from "../plugins/auth";
import {
  LEGACY_CSV_PARSER_VERSION,
  LegacyCsvError,
  parseLegacyCsv,
  type LegacyCsvDelimiterChoice,
} from "../lib/legacy-import/csv";
import {
  LEGACY_IMPORT_MAPPING_VERSION,
  LEGACY_IMPORT_TARGET_TYPES,
  LegacyMappingConfigurationError,
  legacyImportMappingOptions,
  mapLegacyImportRow,
  validateLegacyImportMapping,
  type LegacyImportMapping,
} from "../lib/legacy-import/mapping";

const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const MAX_IMPORT_ROWS = 10_000;
const CSV_CONTENT_TYPE = "text/csv";
const manager = { preHandler: requireRole("MANAGER") };

const createSchema = z.object({
  fileName: z.string().trim().min(1).max(160).refine(
    (value) => /\.csv$/i.test(value) && !/[\\/\u0000-\u001f]/.test(value),
    "Επιλέξτε αρχείο CSV.",
  ),
  byteSize: z.coerce.number().int().positive().max(MAX_IMPORT_BYTES),
  delimiter: z.enum(["AUTO", "COMMA", "SEMICOLON", "TAB"]).default("AUTO"),
});

const paramsSchema = z.object({ id: z.string().min(1).max(64) });
const listSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
const rowsSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const mappingOptionsSchema = z.object({
  targetType: z.enum(LEGACY_IMPORT_TARGET_TYPES),
});
const mappingPreviewSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const rowReviewSchema = z.object({
  rowNumber: z.coerce.number().int().min(1).max(MAX_IMPORT_ROWS),
  reason: z.enum([
    "SOURCE_RECORD_VERIFIED",
    "NOT_RELEVANT",
    "DUPLICATE_CONFIRMED_DISTINCT",
    "EXACT_DUPLICATE_SKIPPED",
    "INVALID_SOURCE_SKIPPED",
    "MAPPING_ISSUE_SKIPPED",
  ]),
});

function auditMeta(request: Parameters<typeof clientIp>[0]) {
  return { ipAddress: clientIp(request), userAgent: userAgent(request) };
}

function requireEncryption(): void {
  if (!hasEncryptionKey()) {
    throw conflict("Η ασφαλής εισαγωγή απαιτεί έγκυρο PII_ENCRYPTION_KEY στον server.");
  }
}

function requireStore() {
  const store = documentStore();
  if (!store.configured()) throw conflict("Η ιδιωτική αποθήκευση αρχείων δεν έχει ρυθμιστεί.");
  return store;
}

function configuredCronSecret(): string | null {
  const secret = process.env.CRON_SECRET;
  return typeof secret === "string" && secret.length >= 32 ? secret : null;
}

function requireBatchWithinRetention(batch: { status?: string; retentionExpiresAt?: Date | null }): void {
  if (batch.status === "EXPIRED" || (batch.retentionExpiresAt && batch.retentionExpiresAt <= new Date())) {
    throw conflict("Η περίοδος διατήρησης της παρτίδας έχει λήξει. Τα δεδομένα δεν είναι πλέον διαθέσιμα για προβολή ή επεξεργασία.");
  }
}

function reviewDecisionForReason(reason: z.infer<typeof rowReviewSchema>["reason"]): "ACCEPT_AS_NEW" | "SKIP" {
  return reason === "SOURCE_RECORD_VERIFIED" || reason === "DUPLICATE_CONFIRMED_DISTINCT"
    ? "ACCEPT_AS_NEW"
    : "SKIP";
}

function validateReviewReason(
  previewStatus: "READY" | "DUPLICATE_REVIEW" | "SOURCE_INVALID" | "MAPPING_INVALID",
  reason: z.infer<typeof rowReviewSchema>["reason"],
): void {
  const allowed: Record<typeof previewStatus, readonly string[]> = {
    READY: ["SOURCE_RECORD_VERIFIED", "NOT_RELEVANT"],
    DUPLICATE_REVIEW: ["DUPLICATE_CONFIRMED_DISTINCT", "EXACT_DUPLICATE_SKIPPED"],
    SOURCE_INVALID: ["INVALID_SOURCE_SKIPPED"],
    MAPPING_INVALID: ["MAPPING_ISSUE_SKIPPED"],
  };
  if (!allowed[previewStatus].includes(reason)) {
    throw badRequest("Η αιτιολογία δεν αντιστοιχεί στην κατάσταση της συγκεκριμένης γραμμής.");
  }
}

function delimiterChoice(value: string): LegacyCsvDelimiterChoice {
  return value as LegacyCsvDelimiterChoice;
}

async function removeSourceObject(key: string, batchId: string, request: Parameters<typeof clientIp>[0]): Promise<boolean> {
  try {
    await documentStore().remove(key);
    await db().legacyImportBatch.update({ where: { id: batchId }, data: { temporaryStorageKey: null } });
    return true;
  } catch {
    // Do not log an object URL, key, file name or source contents.
    request.log.warn({ batchId }, "temporary import source cleanup failed");
    return false;
  }
}

export async function legacyImportRoutes(app: FastifyInstance): Promise<void> {
  // Vercel Cron calls this route with Authorization: Bearer <CRON_SECRET>.
  // No cookie/session is accepted as a substitute for the server-side secret.
  app.get("/cron/legacy-import-purge", async (request, reply) => {
    const secret = configuredCronSecret();
    if (!secret) {
      reply.code(503);
      return { error: { code: "cron_not_configured", message: "Η εργασία εκκαθάρισης δεν έχει ρυθμισμένο CRON_SECRET." } };
    }

    const match = /^Bearer\s+(.+)$/i.exec(request.headers.authorization ?? "");
    const supplied = Buffer.from(match?.[1] ?? "");
    const expected = Buffer.from(secret);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      reply.code(401);
      return { error: { code: "unauthorized", message: "Δεν επιτρέπεται η εκτέλεση της εργασίας." } };
    }

    const retentionDays = configuredLegacyImportRetentionDays();
    if (retentionDays === null) {
      reply.code(503);
      return { error: { code: "retention_policy_not_configured", message: "Η εργασία απαιτεί έγκυρο LEGACY_IMPORT_RETENTION_DAYS." } };
    }

    const result = await purgeExpiredLegacyImports({ limit: 25 });
    if (result.failed > 0) reply.code(503);
    return { retentionDays, ...result };
  });

  app.post("/legacy-imports", manager, async (request, reply) => {
    const actor = request.auth!.user;
    const input = parseInput(createSchema, request.body);
    requireEncryption();
    const retentionDays = configuredLegacyImportRetentionDays();
    if (retentionDays === null) {
      throw conflict("Η εισαγωγή είναι απενεργοποιημένη μέχρι να οριστεί έγκυρο LEGACY_IMPORT_RETENTION_DAYS.");
    }
    if (!configuredCronSecret()) {
      throw conflict("Η εισαγωγή είναι απενεργοποιημένη μέχρι να ρυθμιστεί το CRON_SECRET για την αυτόματη εκκαθάριση.");
    }
    const createdAt = new Date();
    const retentionExpiresAt = legacyImportExpiry(createdAt, retentionDays);
    const store = requireStore();

    // The original client filename is validated but never persisted.
    const id = randomUUID();
    const key = legacyImportKey();
    const upload = await store.presignPut(key, CSV_CONTENT_TYPE, input.byteSize);

    await db().legacyImportBatch.create({
      data: {
        id,
        sourceSystem: "ESTATE_PLUS",
        status: "CREATED",
        sourceFileBytes: input.byteSize,
        temporaryStorageKey: key,
        requestedDelimiter: input.delimiter,
        parserVersion: LEGACY_CSV_PARSER_VERSION,
        mappingVersion: "unmapped",
        retentionDays,
        retentionExpiresAt,
        createdAt,
        createdByUserId: actor.id,
      },
    });

    await writeAudit({
      entity: "LEGACY_IMPORT_BATCH",
      entityId: id,
      action: "create",
      changes: {
        sourceSystem: "ESTATE_PLUS",
        sourceFileBytes: input.byteSize,
        requestedDelimiter: input.delimiter,
        parserVersion: LEGACY_CSV_PARSER_VERSION,
        mappingVersion: "unmapped",
        retentionDays,
        retentionExpiresAt: retentionExpiresAt.toISOString(),
      },
      actorId: actor.id,
      ...auditMeta(request),
    });

    reply.code(201);
    return {
      batch: {
        id,
        status: "CREATED",
        sourceFileBytes: input.byteSize,
        retentionDays,
        retentionExpiresAt,
        expiresInSeconds: 600,
      },
      upload,
    };
  });

  app.post("/legacy-imports/:id/parse", manager, async (request) => {
    const actor = request.auth!.user;
    const { id } = parseInput(paramsSchema, request.params);
    requireEncryption();
    const store = requireStore();

    const batch = await db().legacyImportBatch.findUnique({ where: { id } });
    if (!batch) throw notFound("Η παρτίδα εισαγωγής δεν βρέθηκε.");
    if (batch.status !== "CREATED" || batch.purgeLockedAt !== null || !batch.temporaryStorageKey || !isLegacyImportKey(batch.temporaryStorageKey)) {
      throw conflict("Η παρτίδα δεν είναι διαθέσιμη για ανάλυση.");
    }
    requireBatchWithinRetention(batch);

    // A compare-and-set claim excludes a concurrent purge lease and expired batches.
    const parseClaimAt = new Date();
    const claim = await db().legacyImportBatch.updateMany({
      where: {
        id,
        status: "CREATED",
        purgeLockedAt: null,
        OR: [{ retentionExpiresAt: null }, { retentionExpiresAt: { gt: parseClaimAt } }],
      },
      data: { status: "PARSING" },
    });
    if (claim.count !== 1) throw conflict("Η παρτίδα αναλύεται ήδη ή έχει ήδη ολοκληρωθεί.");

    const key = batch.temporaryStorageKey;
    let stagingPersisted = false;
    try {
      const head = await store.head(key);
      if (!head || head.byteSize !== batch.sourceFileBytes || head.byteSize > MAX_IMPORT_BYTES) {
        throw badRequest("Το αρχείο δεν βρέθηκε ή το μέγεθός του δεν συμφωνεί με τη μεταφόρτωση.");
      }
      if (head.contentType !== CSV_CONTENT_TYPE) {
        throw badRequest("Ο τύπος του αρχείου δεν είναι έγκυρος CSV.");
      }
      const bytes = await store.read(key);
      if (!bytes || bytes.length !== batch.sourceFileBytes) {
        throw badRequest("Δεν ήταν δυνατή η ανάγνωση του αρχείου CSV.");
      }

      let decoded: string;
      try {
        decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw badRequest("Το CSV πρέπει να είναι κωδικοποιημένο σε UTF-8.");
      }

      let parsed;
      try {
        parsed = parseLegacyCsv(decoded, {
          delimiter: delimiterChoice(batch.requestedDelimiter),
          maxBytes: MAX_IMPORT_BYTES,
          maxRows: MAX_IMPORT_ROWS,
        });
      } catch (error) {
        if (error instanceof LegacyCsvError) throw badRequest(error.message);
        throw error;
      }

      const seenPayloads = new Map<string, number>();
      const encryptedRows = parsed.rows.map((row) => {
        const payload = JSON.stringify({ headers: parsed.headers, values: row.values });
        const payloadSha256 = sha256(payload);
        const duplicateOfRow = row.issues.length === 0 ? seenPayloads.get(payloadSha256) : undefined;
        if (row.issues.length === 0 && duplicateOfRow === undefined) {
          seenPayloads.set(payloadSha256, row.rowNumber);
        }

        const payloadCiphertext = encryptField(payload);
        if (!payloadCiphertext) {
          throw conflict("Η κρυπτογράφηση των δεδομένων εισαγωγής απέτυχε.");
        }

        const validationIssues = [
          ...row.issues,
          ...(duplicateOfRow === undefined ? [] : [{ code: "EXACT_DUPLICATE_ROW", duplicateOfRowNumber: duplicateOfRow }]),
        ];
        return {
          batchId: id,
          rowNumber: row.rowNumber,
          status: row.issues.length > 0
            ? "INVALID" as const
            : duplicateOfRow !== undefined
              ? "DUPLICATE_REVIEW" as const
              : "STAGED" as const,
          payloadCiphertext,
          payloadSha256,
          ...(validationIssues.length > 0
            ? { validationIssues: validationIssues as unknown as Prisma.InputJsonValue }
            : {}),
        };
      });

      const invalidRowCount = encryptedRows.filter((row) => row.status === "INVALID").length;
      const duplicateRowCount = encryptedRows.filter((row) => row.status === "DUPLICATE_REVIEW").length;
      const stagedRowCount = encryptedRows.filter((row) => row.status === "STAGED").length;
      const sourceFileSha256 = sha256(bytes);
      const finalStatus = invalidRowCount > 0 || duplicateRowCount > 0 ? "NEEDS_REVIEW" : "STAGED";

      await db().$transaction(async (tx) => {
        await tx.legacyImportRow.createMany({ data: encryptedRows });
        await tx.legacyImportBatch.update({
          where: { id },
          data: {
            status: finalStatus,
            sourceFileSha256,
            detectedDelimiter: parsed.delimiter,
            columnHeaders: parsed.headers as unknown as Prisma.InputJsonValue,
            sourceRowCount: encryptedRows.length,
            stagedRowCount,
            invalidRowCount,
            duplicateRowCount,
          },
        });
      });
      stagingPersisted = true;

      const sourceDeleted = await removeSourceObject(key, id, request);
      await writeAudit({
        entity: "LEGACY_IMPORT_BATCH",
        entityId: id,
        action: "stage",
        changes: {
          status: finalStatus,
          sourceFileSha256,
          sourceRowCount: encryptedRows.length,
          stagedRowCount,
          invalidRowCount,
          duplicateRowCount,
          detectedDelimiter: parsed.delimiter,
          parserVersion: LEGACY_CSV_PARSER_VERSION,
        },
        actorId: actor.id,
        ...auditMeta(request),
      });

      return {
        batch: {
          id,
          status: finalStatus,
          sourceFileSha256,
          detectedDelimiter: parsed.delimiter,
          headers: parsed.headers,
          sourceRowCount: encryptedRows.length,
          stagedRowCount,
          invalidRowCount,
          duplicateRowCount,
          importedRowCount: 0,
          mappingVersion: "unmapped",
          sourceCleanupPending: !sourceDeleted,
        },
        nextStep: "FIELD_MAPPING_REQUIRED",
      };
    } catch (error) {
      // Once the transaction committed, the batch is durable. A failed
      // cleanup or audit write must not reset it to CREATED (rows already exist).
      if (stagingPersisted) throw error;

      if (error instanceof Error && "statusCode" in error) {
        const httpError = error as Error & { statusCode?: number };
        if ((httpError.statusCode ?? 500) < 500) {
          const deleted = await removeSourceObject(key, id, request);
          await db().legacyImportBatch.update({
            where: { id },
            data: { status: "FAILED", ...(deleted ? { temporaryStorageKey: null } : {}) },
          });
          await writeAudit({
            entity: "LEGACY_IMPORT_BATCH",
            entityId: id,
            action: "parse_failed",
            changes: { status: "FAILED" },
            actorId: actor.id,
            ...auditMeta(request),
          });
          throw error;
        }
      }

      // An infrastructure failure is retryable; retain the private upload and
      // return the batch to CREATED. No source payload is logged.
      await db().legacyImportBatch.update({ where: { id }, data: { status: "CREATED" } }).catch(() => undefined);
      throw error;
    }
  });

  app.get("/legacy-imports", manager, async (request) => {
    const query = parseInput(listSchema, request.query);
    const [data, total] = await Promise.all([
      db().legacyImportBatch.findMany({
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          sourceSystem: true,
          status: true,
          sourceFileSha256: true,
          sourceFileBytes: true,
          requestedDelimiter: true,
          detectedDelimiter: true,
          parserVersion: true,
          mappingVersion: true,
          columnHeaders: true,
          sourceRowCount: true,
          stagedRowCount: true,
          invalidRowCount: true,
          duplicateRowCount: true,
          importedRowCount: true,
          retentionDays: true,
          retentionExpiresAt: true,
          purgedAt: true,
          purgedRowCount: true,
          reviewedRowCount: true,
          acceptedRowCount: true,
          skippedRowCount: true,
          reviewCompletedAt: true,
          createdByUserId: true,
          approvedByUserId: true,
          approvedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      db().legacyImportBatch.count(),
    ]);
    return { data, pagination: { page: query.page, limit: query.limit, total, pages: Math.max(1, Math.ceil(total / query.limit)) } };
  });

  app.get("/legacy-imports/:id", manager, async (request) => {
    const { id } = parseInput(paramsSchema, request.params);
    const batch = await db().legacyImportBatch.findUnique({
      where: { id },
      select: {
        id: true,
        sourceSystem: true,
        status: true,
        sourceFileSha256: true,
        sourceFileBytes: true,
        requestedDelimiter: true,
        detectedDelimiter: true,
        parserVersion: true,
        mappingVersion: true,
        fieldMapping: true,
        columnHeaders: true,
        sourceRowCount: true,
        stagedRowCount: true,
        invalidRowCount: true,
        duplicateRowCount: true,
        importedRowCount: true,
          retentionDays: true,
          retentionExpiresAt: true,
          purgedAt: true,
          purgedRowCount: true,
        reviewedRowCount: true,
        acceptedRowCount: true,
        skippedRowCount: true,
        reviewCompletedAt: true,
        createdByUserId: true,
        approvedByUserId: true,
        approvedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!batch) throw notFound("Η παρτίδα εισαγωγής δεν βρέθηκε.");
    const nextStep = batch.mappingVersion === "unmapped"
      ? "FIELD_MAPPING_REQUIRED"
      : batch.status === "READY_FOR_APPROVAL"
        ? "SEPARATE_APPROVAL_REQUIRED"
        : batch.status === "REVIEWED"
          ? "NO_IMPORTABLE_ROWS"
          : "REVIEW_REQUIRED";
    return { batch, nextStep };
  });

  app.get("/legacy-imports/:id/mapping-options", manager, async (request) => {
    const { id } = parseInput(paramsSchema, request.params);
    const query = parseInput(mappingOptionsSchema, request.query);
    const batch = await db().legacyImportBatch.findUnique({
      where: { id },
      select: { id: true, status: true, retentionExpiresAt: true, columnHeaders: true },
    });
    if (!batch) throw notFound("Η παρτίδα εισαγωγής δεν βρέθηκε.");
    requireBatchWithinRetention(batch);
    const headers = Array.isArray(batch.columnHeaders)
      ? batch.columnHeaders.filter((header): header is string => typeof header === "string")
      : [];
    return {
      headers,
      ...legacyImportMappingOptions(query.targetType),
    };
  });

  app.put("/legacy-imports/:id/mapping", manager, async (request) => {
    const actor = request.auth!.user;
    const { id } = parseInput(paramsSchema, request.params);
    const batch = await db().legacyImportBatch.findUnique({ where: { id } });
    if (!batch) throw notFound("Η παρτίδα εισαγωγής δεν βρέθηκε.");
    requireBatchWithinRetention(batch);
    if (!["STAGED", "NEEDS_REVIEW"].includes(batch.status) || batch.importedRowCount > 0 || batch.purgeLockedAt !== null) {
      throw conflict("Η αντιστοίχιση μπορεί να αλλάξει μόνο πριν από οποιαδήποτε εκτέλεση εισαγωγής.");
    }

    const headers = Array.isArray(batch.columnHeaders)
      ? batch.columnHeaders.filter((header): header is string => typeof header === "string")
      : [];
    let mapping: LegacyImportMapping;
    try {
      mapping = validateLegacyImportMapping(request.body, headers);
    } catch (error) {
      if (error instanceof LegacyMappingConfigurationError) throw badRequest(error.message);
      throw error;
    }

    const fieldMapping = JSON.parse(JSON.stringify(mapping)) as Prisma.InputJsonValue;
    const mappingChanged = JSON.stringify(batch.fieldMapping) !== JSON.stringify(fieldMapping);
    await db().$transaction(async (tx) => {
      await tx.legacyImportBatch.update({
        where: { id },
        data: {
          fieldMapping,
          mappingVersion: LEGACY_IMPORT_MAPPING_VERSION,
          ...(mappingChanged ? {
            reviewedRowCount: 0,
            acceptedRowCount: 0,
            skippedRowCount: 0,
            reviewCompletedAt: null,
          } : {}),
        },
      });
      if (mappingChanged) {
        await tx.legacyImportRow.updateMany({
          where: { batchId: id },
          data: {
            previewStatus: null,
            previewIssues: Prisma.DbNull,
            reviewDecision: null,
            reviewReason: null,
            reviewedByUserId: null,
            reviewedAt: null,
            reviewMappingVersion: null,
          },
        });
      }
    });
    await writeAudit({
      entity: "LEGACY_IMPORT_BATCH",
      entityId: id,
      action: "mapping_configured",
      changes: {
        targetType: mapping.targetType,
        mappingVersion: LEGACY_IMPORT_MAPPING_VERSION,
        fieldCount: mapping.fields.length,
        sourceHeaderCount: headers.length,
      },
      actorId: actor.id,
      ...auditMeta(request),
    });

    return {
      batchId: id,
      targetType: mapping.targetType,
      mappingVersion: LEGACY_IMPORT_MAPPING_VERSION,
      mappedFieldCount: mapping.fields.length,
      nextStep: "MAPPING_PREVIEW_REQUIRED",
      canImport: false,
    };
  });

  app.post("/legacy-imports/:id/mapping/preview", manager, async (request) => {
    const actor = request.auth!.user;
    const { id } = parseInput(paramsSchema, request.params);
    const query = parseInput(mappingPreviewSchema, request.query);
    requireEncryption();

    const batch = await db().legacyImportBatch.findUnique({ where: { id } });
    if (!batch) throw notFound("Η παρτίδα εισαγωγής δεν βρέθηκε.");
    requireBatchWithinRetention(batch);
    if (batch.purgeLockedAt !== null) throw conflict("Η παρτίδα εκκαθαρίζεται και δεν είναι διαθέσιμη για προεπισκόπηση.");
    if (!batch.fieldMapping || batch.mappingVersion !== LEGACY_IMPORT_MAPPING_VERSION) {
      throw conflict("Αποθηκεύστε πρώτα την αντιστοίχιση πεδίων.");
    }

    const headers = Array.isArray(batch.columnHeaders)
      ? batch.columnHeaders.filter((header): header is string => typeof header === "string")
      : [];
    let mapping: LegacyImportMapping;
    try {
      mapping = validateLegacyImportMapping(batch.fieldMapping, headers);
    } catch (error) {
      if (error instanceof LegacyMappingConfigurationError) {
        throw conflict("Η αποθηκευμένη αντιστοίχιση δεν είναι έγκυρη. Αποθηκεύστε την ξανά.");
      }
      throw error;
    }

    const rows = await db().legacyImportRow.findMany({
      where: { batchId: id },
      orderBy: { rowNumber: "asc" },
      select: {
        id: true,
        rowNumber: true,
        status: true,
        payloadCiphertext: true,
        validationIssues: true,
        reviewDecision: true,
        reviewReason: true,
        reviewedAt: true,
        reviewedByUserId: true,
        reviewMappingVersion: true,
      },
    });

    const previewRows = rows.map((row) => {
      const plaintext = decryptField(row.payloadCiphertext);
      if (plaintext === null) {
        throw conflict("Τα δεδομένα της παρτίδας δεν μπορούν να αποκρυπτογραφηθούν με το τρέχον κλειδί.");
      }

      let source: { headers: string[]; values: string[] };
      try {
        source = JSON.parse(plaintext) as { headers: string[]; values: string[] };
      } catch {
        throw conflict("Μία εγγραφή της παρτίδας δεν είναι αναγνώσιμη.");
      }
      if (!Array.isArray(source.headers) || !Array.isArray(source.values) || source.headers.length !== headers.length || source.headers.some((value, index) => value !== headers[index])) {
        throw conflict("Η δομή μίας αρχικής εγγραφής δεν συμφωνεί με τις επικεφαλίδες της παρτίδας.");
      }

      const mapped = mapLegacyImportRow(mapping, headers, source.values);
      const sourceIssues = Array.isArray(row.validationIssues) ? row.validationIssues : [];
      const status: "READY" | "DUPLICATE_REVIEW" | "SOURCE_INVALID" | "MAPPING_INVALID" =
        row.status === "DUPLICATE_REVIEW"
          ? "DUPLICATE_REVIEW"
          : row.status === "INVALID"
            ? "SOURCE_INVALID"
            : mapped.issues.length > 0
              ? "MAPPING_INVALID"
              : "READY";

      return {
        id: row.id,
        rowNumber: row.rowNumber,
        status,
        record: mapped.record,
        issues: mapped.issues,
        sourceIssues,
        reviewDecision: row.reviewDecision,
        reviewReason: row.reviewReason,
        reviewedAt: row.reviewedAt,
        reviewedByUserId: row.reviewedByUserId,
        reviewMappingVersion: row.reviewMappingVersion,
      };
    });

    const readyRows = previewRows.filter((row) => row.status === "READY").length;
    const duplicateRows = previewRows.filter((row) => row.status === "DUPLICATE_REVIEW").length;
    const sourceInvalidRows = previewRows.filter((row) => row.status === "SOURCE_INVALID").length;
    const mappingInvalidRows = previewRows.filter((row) => row.status === "MAPPING_INVALID").length;

    // Persist only the non-PII classification and issue codes. The mapped
    // record itself remains in memory and is never written to the database.
    const skip = (query.page - 1) * query.limit;
    const pageRows = previewRows.slice(skip, skip + query.limit);

    // Persist only the non-PII classifications for the rows visible on this
    // page. A 10,000-row batch therefore does not create 10,000 database writes
    // from one preview request; each subsequent page becomes reviewable when
    // its manager opens it.
    if (!["READY_FOR_APPROVAL", "REVIEWED"].includes(batch.status) && pageRows.length > 0) {
      await db().$transaction(async (tx) => {
        for (const row of pageRows) {
          await tx.legacyImportRow.update({
            where: { id: row.id },
            data: {
              previewStatus: row.status,
              previewIssues: row.issues.length > 0
                ? row.issues as unknown as Prisma.InputJsonValue
                : Prisma.DbNull,
            },
          });
        }
      });
    }

    const reviewedRowCount = previewRows.filter((row) => row.reviewDecision !== null).length;
    const acceptedRowCount = previewRows.filter((row) => row.reviewDecision === "ACCEPT_AS_NEW").length;
    const skippedRowCount = previewRows.filter((row) => row.reviewDecision === "SKIP").length;
    const pendingRowCount = previewRows.length - reviewedRowCount;
    const data = pageRows.map(({ id: _id, reviewMappingVersion: _version, ...row }) => row);

    await writeAudit({
      entity: "LEGACY_IMPORT_BATCH",
      entityId: id,
      action: "mapping_preview",
      changes: {
        targetType: mapping.targetType,
        mappingVersion: batch.mappingVersion,
        rowsChecked: previewRows.length,
        readyRows,
        duplicateRows,
        sourceInvalidRows,
        mappingInvalidRows,
        reviewedRowCount,
        pendingRowCount,
        page: query.page,
        limit: query.limit,
        rowsReturned: data.length,
      },
      actorId: actor.id,
      ...auditMeta(request),
    });

    return {
      batchId: id,
      summary: {
        targetType: mapping.targetType,
        mappingVersion: batch.mappingVersion,
        totalRows: previewRows.length,
        readyRows,
        duplicateRows,
        sourceInvalidRows,
        mappingInvalidRows,
      },
      data,
      reviewSummary: {
        totalRows: previewRows.length,
        reviewedRowCount,
        acceptedRowCount,
        skippedRowCount,
        pendingRowCount,
        complete: pendingRowCount === 0,
      },
      batchStatus: batch.status,
      pagination: {
        page: query.page,
        limit: query.limit,
        total: previewRows.length,
        pages: Math.max(1, Math.ceil(previewRows.length / query.limit)),
      },
      nextStep: pendingRowCount > 0
        ? "ROW_REVIEW_REQUIRED"
        : acceptedRowCount > 0
          ? "SEPARATE_APPROVAL_REQUIRED"
          : "NO_IMPORTABLE_ROWS",
      canApprove: false,
      canImport: false,
    };
  });

  app.post("/legacy-imports/:id/review", manager, async (request) => {
    const actor = request.auth!.user;
    const { id } = parseInput(paramsSchema, request.params);
    const input = parseInput(rowReviewSchema, request.body);
    const decision = reviewDecisionForReason(input.reason);
    const now = new Date();

    const result = await db().$transaction(async (tx) => {
      const batch = await tx.legacyImportBatch.findUnique({ where: { id } });
      if (!batch) throw notFound("Η παρτίδα εισαγωγής δεν βρέθηκε.");
      requireBatchWithinRetention(batch);
      if (!["STAGED", "NEEDS_REVIEW"].includes(batch.status) || batch.purgeLockedAt !== null) {
        throw conflict("Η ανθρώπινη αξιολόγηση έχει ολοκληρωθεί ή η παρτίδα δεν είναι διαθέσιμη.");
      }
      if (!batch.fieldMapping || batch.mappingVersion !== LEGACY_IMPORT_MAPPING_VERSION) {
        throw conflict("Αποθηκεύστε πρώτα την αντιστοίχιση και εκτελέστε την προεπισκόπηση.");
      }

      const row = await tx.legacyImportRow.findUnique({
        where: { batchId_rowNumber: { batchId: id, rowNumber: input.rowNumber } },
      });
      if (!row) throw notFound("Η γραμμή εισαγωγής δεν βρέθηκε.");
      if (!row.previewStatus) {
        throw conflict("Εκτελέστε πρώτα την προεπισκόπηση της αντιστοίχισης για αυτή την παρτίδα.");
      }
      validateReviewReason(row.previewStatus, input.reason);

      const saved = await tx.legacyImportRow.updateMany({
        where: {
          id: row.id,
          batchId: id,
          previewStatus: row.previewStatus,
          reviewDecision: row.reviewDecision,
          reviewedAt: row.reviewedAt,
          reviewMappingVersion: row.reviewMappingVersion,
        },
        data: {
          reviewDecision: decision,
          reviewReason: input.reason,
          reviewedByUserId: actor.id,
          reviewedAt: now,
          reviewMappingVersion: batch.mappingVersion,
        },
      });
      if (saved.count !== 1) {
        throw conflict("Η γραμμή ενημερώθηκε ταυτόχρονα από άλλο χρήστη. Φορτώστε ξανά την προεπισκόπηση.");
      }

      const [totalRows, acceptedRowCount, skippedRowCount] = await Promise.all([
        tx.legacyImportRow.count({ where: { batchId: id } }),
        tx.legacyImportRow.count({ where: { batchId: id, reviewDecision: "ACCEPT_AS_NEW" } }),
        tx.legacyImportRow.count({ where: { batchId: id, reviewDecision: "SKIP" } }),
      ]);
      const reviewedRowCount = acceptedRowCount + skippedRowCount;
      const pendingRowCount = totalRows - reviewedRowCount;
      const complete = pendingRowCount === 0;
      const batchStatus = complete
        ? acceptedRowCount > 0 ? "READY_FOR_APPROVAL" as const : "REVIEWED" as const
        : batch.status;

      await tx.legacyImportBatch.update({
        where: { id },
        data: {
          reviewedRowCount,
          acceptedRowCount,
          skippedRowCount,
          ...(complete ? { status: batchStatus, reviewCompletedAt: now } : {}),
        },
      });

      await writeAudit({
        entity: "LEGACY_IMPORT_BATCH",
        entityId: id,
        action: "row_review_decision",
        changes: {
          rowNumber: input.rowNumber,
          previewStatus: row.previewStatus,
          decision,
          reason: input.reason,
          mappingVersion: batch.mappingVersion,
          reviewedRowCount,
          pendingRowCount,
        },
        actorId: actor.id,
        ...auditMeta(request),
      }, tx);

      if (complete) {
        await writeAudit({
          entity: "LEGACY_IMPORT_BATCH",
          entityId: id,
          action: "review_completed",
          changes: {
            status: batchStatus,
            totalRows,
            reviewedRowCount,
            acceptedRowCount,
            skippedRowCount,
            importExecutionAvailable: false,
          },
          actorId: actor.id,
          ...auditMeta(request),
        }, tx);
      }

      return {
        batchStatus,
        totalRows,
        reviewedRowCount,
        acceptedRowCount,
        skippedRowCount,
        pendingRowCount,
        complete,
      };
    });

    return {
      batchId: id,
      ...result,
      nextStep: result.pendingRowCount > 0
        ? "ROW_REVIEW_REQUIRED"
        : result.acceptedRowCount > 0
          ? "SEPARATE_APPROVAL_REQUIRED"
          : "NO_IMPORTABLE_ROWS",
      canApprove: false,
      canImport: false,
    };
  });

  app.get("/legacy-imports/:id/rows", manager, async (request) => {
    const actor = request.auth!.user;
    const { id } = parseInput(paramsSchema, request.params);
    const query = parseInput(rowsSchema, request.query);
    requireEncryption();

    const batch = await db().legacyImportBatch.findUnique({
      where: { id },
      select: { id: true, status: true, retentionExpiresAt: true, purgeLockedAt: true },
    });
    if (!batch) throw notFound("Η παρτίδα εισαγωγής δεν βρέθηκε.");
    requireBatchWithinRetention(batch);
    if (batch.purgeLockedAt !== null) throw conflict("Η παρτίδα εκκαθαρίζεται και δεν είναι διαθέσιμη για προεπισκόπηση.");

    const [rows, total] = await Promise.all([
      db().legacyImportRow.findMany({
        where: { batchId: id },
        orderBy: { rowNumber: "asc" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          rowNumber: true,
          status: true,
          payloadCiphertext: true,
          validationIssues: true,
          previewStatus: true,
          reviewDecision: true,
          reviewReason: true,
          reviewedByUserId: true,
          reviewedAt: true,
        },
      }),
      db().legacyImportRow.count({ where: { batchId: id } }),
    ]);

    const data = rows.map((row) => {
      const plaintext = decryptField(row.payloadCiphertext);
      if (plaintext === null) throw conflict("Τα δεδομένα της παρτίδας δεν μπορούν να αποκρυπτογραφηθούν με το τρέχον κλειδί.");
      try {
        return {
          id: row.id,
          rowNumber: row.rowNumber,
          status: row.status,
          previewStatus: row.previewStatus,
          reviewDecision: row.reviewDecision,
          reviewReason: row.reviewReason,
          reviewedByUserId: row.reviewedByUserId,
          reviewedAt: row.reviewedAt,
          record: JSON.parse(plaintext) as { headers: string[]; values: string[] },
          validationIssues: row.validationIssues,
        };
      } catch {
        throw conflict("Μία εγγραφή της παρτίδας δεν είναι αναγνώσιμη.");
      }
    });

    await writeAudit({
      entity: "LEGACY_IMPORT_BATCH",
      entityId: id,
      action: "preview",
      changes: { page: query.page, limit: query.limit, rowsReturned: data.length },
      actorId: actor.id,
      ...auditMeta(request),
    });

    return { data, pagination: { page: query.page, limit: query.limit, total, pages: Math.max(1, Math.ceil(total / query.limit)) } };
  });
}
