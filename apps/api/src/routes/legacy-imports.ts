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
    const secret = process.env.CRON_SECRET;
    if (!secret || secret.length < 32) {
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
    if (batch.status !== "CREATED" || !batch.temporaryStorageKey || !isLegacyImportKey(batch.temporaryStorageKey)) {
      throw conflict("Η παρτίδα δεν είναι διαθέσιμη για ανάλυση.");
    }

    // A compare-and-set claim prevents two requests staging the same batch.
    const claim = await db().legacyImportBatch.updateMany({
      where: { id, status: "CREATED" },
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
        createdByUserId: true,
        approvedByUserId: true,
        approvedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!batch) throw notFound("Η παρτίδα εισαγωγής δεν βρέθηκε.");
    return { batch, nextStep: batch.mappingVersion === "unmapped" ? "FIELD_MAPPING_REQUIRED" : "REVIEW_REQUIRED" };
  });

  app.get("/legacy-imports/:id/mapping-options", manager, async (request) => {
    const { id } = parseInput(paramsSchema, request.params);
    const query = parseInput(mappingOptionsSchema, request.query);
    const batch = await db().legacyImportBatch.findUnique({
      where: { id },
      select: { id: true, columnHeaders: true },
    });
    if (!batch) throw notFound("Η παρτίδα εισαγωγής δεν βρέθηκε.");
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
    if (!["STAGED", "NEEDS_REVIEW"].includes(batch.status) || batch.importedRowCount > 0) {
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
    await db().legacyImportBatch.update({
      where: { id },
      data: {
        fieldMapping,
        mappingVersion: LEGACY_IMPORT_MAPPING_VERSION,
      },
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
        rowNumber: true,
        status: true,
        payloadCiphertext: true,
        validationIssues: true,
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
      const status = row.status === "DUPLICATE_REVIEW"
        ? "DUPLICATE_REVIEW"
        : row.status === "INVALID"
          ? "SOURCE_INVALID"
          : mapped.issues.length > 0
            ? "MAPPING_INVALID"
            : "READY";

      return {
        rowNumber: row.rowNumber,
        status,
        record: mapped.record,
        issues: mapped.issues,
        sourceIssues,
      };
    });

    const readyRows = previewRows.filter((row) => row.status === "READY").length;
    const duplicateRows = previewRows.filter((row) => row.status === "DUPLICATE_REVIEW").length;
    const sourceInvalidRows = previewRows.filter((row) => row.status === "SOURCE_INVALID").length;
    const mappingInvalidRows = previewRows.filter((row) => row.status === "MAPPING_INVALID").length;
    const skip = (query.page - 1) * query.limit;
    const data = previewRows.slice(skip, skip + query.limit);

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
      pagination: {
        page: query.page,
        limit: query.limit,
        total: previewRows.length,
        pages: Math.max(1, Math.ceil(previewRows.length / query.limit)),
      },
      nextStep: "HUMAN_REVIEW_REQUIRED",
      canApprove: false,
      canImport: false,
    };
  });

  app.get("/legacy-imports/:id/rows", manager, async (request) => {
    const actor = request.auth!.user;
    const { id } = parseInput(paramsSchema, request.params);
    const query = parseInput(rowsSchema, request.query);
    requireEncryption();

    const batch = await db().legacyImportBatch.findUnique({ where: { id }, select: { id: true } });
    if (!batch) throw notFound("Η παρτίδα εισαγωγής δεν βρέθηκε.");

    const [rows, total] = await Promise.all([
      db().legacyImportRow.findMany({
        where: { batchId: id },
        orderBy: { rowNumber: "asc" },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: { id: true, rowNumber: true, status: true, payloadCiphertext: true, validationIssues: true },
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
