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

import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { Prisma } from "@home88/database";
import { z } from "zod";

import { loadConfig } from "../config";
import { writeAudit } from "../lib/audit";
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
  app.post("/legacy-imports", manager, async (request, reply) => {
    const actor = request.auth!.user;
    const input = parseInput(createSchema, request.body);
    requireEncryption();
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
      },
      actorId: actor.id,
      ...auditMeta(request),
    });

    reply.code(201);
    return {
      batch: { id, status: "CREATED", sourceFileBytes: input.byteSize, expiresInSeconds: 600 },
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

      const encryptedRows = parsed.rows.map((row) => {
        const payload = JSON.stringify({ headers: parsed.headers, values: row.values });
        const payloadCiphertext = encryptField(payload);
        if (!payloadCiphertext) {
          throw conflict("Η κρυπτογράφηση των δεδομένων εισαγωγής απέτυχε.");
        }
        return {
          batchId: id,
          rowNumber: row.rowNumber,
          status: row.issues.length > 0 ? "INVALID" as const : "STAGED" as const,
          payloadCiphertext,
          payloadSha256: sha256(payload),
          ...(row.issues.length > 0
            ? { validationIssues: row.issues as unknown as Prisma.InputJsonValue }
            : {}),
        };
      });

      const invalidRowCount = encryptedRows.filter((row) => row.status === "INVALID").length;
      const stagedRowCount = encryptedRows.length - invalidRowCount;
      const sourceFileSha256 = sha256(bytes);
      const finalStatus = invalidRowCount > 0 ? "NEEDS_REVIEW" : "STAGED";

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
          },
        });
      });

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
          duplicateRowCount: 0,
          importedRowCount: 0,
          mappingVersion: "unmapped",
          sourceCleanupPending: !sourceDeleted,
        },
        nextStep: "FIELD_MAPPING_REQUIRED",
      };
    } catch (error) {
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
        columnHeaders: true,
        sourceRowCount: true,
        stagedRowCount: true,
        invalidRowCount: true,
        duplicateRowCount: true,
        importedRowCount: true,
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
