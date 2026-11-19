/**
 * Estate+ CSV staging through the real API and Postgres.
 * Uses only synthetic rows and a private in-memory object store.
 * Runs when TEST_DATABASE_URL points at a disposable database with all migrations applied.
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";

const url = process.env.TEST_DATABASE_URL;

test("Estate+ import: manager-only staging, encryption, duplicate review and source cleanup", { skip: !url && "TEST_DATABASE_URL not set" }, async () => {
  process.env.DATABASE_URL = url!;
  process.env.JWT_SECRET ??= randomBytes(32).toString("base64");
  process.env.PII_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

  const { resetConfig } = await import("../config");
  resetConfig();
  const { handleApiRequest } = await import("../handler");
  const { db } = await import("../lib/prisma");
  const { hashPassword } = await import("../lib/passwords");
  const { decryptField } = await import("../lib/pii");
  const { memoryDocumentStore, setDocumentStore } = await import("../lib/document-store");

  const store = memoryDocumentStore();
  setDocumentStore(store);

  const run = randomBytes(5).toString("hex");
  const password = "Estate-Import-Integration-Password-123";
  const passwordHash = hashPassword(password, 10);
  const makeUser = (role: "AGENT" | "MANAGER") =>
    db().user.create({
      data: {
        email: role.toLowerCase() + "-estate-import-" + run + "@test.invalid",
        firstName: role,
        lastName: "Import Test",
        role,
        passwordHash,
      },
    });
  const [agent, manager] = await Promise.all([makeUser("AGENT"), makeUser("MANAGER")]);

  async function login(email: string) {
    const response = await handleApiRequest(new Request("http://crm.test/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    }));
    assert.equal(response.status, 200, "login " + email);
    return response.headers.get("set-cookie")!.split(";")[0]!;
  }

  const [agentCookie, managerCookie] = await Promise.all([login(agent.email), login(manager.email)]);
  const raw = (cookie: string | null, method: string, endpoint: string, body?: unknown) => {
    const headers: Record<string, string> = body === undefined ? {} : { "content-type": "application/json" };
    if (cookie) headers.cookie = cookie;
    return handleApiRequest(new Request("http://crm.test/api" + endpoint, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }));
  };
  const call = async (cookie: string | null, method: string, endpoint: string, body?: unknown) => {
    const response = await raw(cookie, method, endpoint, body);
    return { status: response.status, body: (await response.json()) as any };
  };

  try {
    assert.equal((await raw(null, "GET", "/legacy-imports")).status, 401, "anonymous users cannot inspect import batches");
    assert.equal((await call(agentCookie, "GET", "/legacy-imports")).status, 403, "agents cannot inspect import batches");

    const csv = [
      "Κωδικός;Ονοματεπώνυμο;Σημειώσεις",
      "EP-001;Μαρία Παπαδοπούλου;Ενδιαφέρεται για αγορά",
      "EP-001;Μαρία Παπαδοπούλου;Ενδιαφέρεται για αγορά",
      "EP-002;Γιώργος Κωνσταντίνου;Τηλέφωνο 6900000000;extra",
    ].join("\r\n");
    const bytes = Buffer.from(csv, "utf8");

    const created = await call(managerCookie, "POST", "/legacy-imports", {
      fileName: "estate-plus-export.csv",
      byteSize: bytes.length,
      delimiter: "AUTO",
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const batchId = created.body.batch.id as string;
    const stagedBatch = await db().legacyImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    assert.ok(stagedBatch.temporaryStorageKey);
    await store.put(stagedBatch.temporaryStorageKey!, bytes, "text/csv");

    const parsed = await call(managerCookie, "POST", "/legacy-imports/" + batchId + "/parse");
    assert.equal(parsed.status, 200, JSON.stringify(parsed.body));
    assert.equal(parsed.body.nextStep, "FIELD_MAPPING_REQUIRED");
    assert.equal(parsed.body.batch.status, "NEEDS_REVIEW");
    assert.equal(parsed.body.batch.detectedDelimiter, ";");
    assert.deepEqual(parsed.body.batch.headers, ["Κωδικός", "Ονοματεπώνυμο", "Σημειώσεις"]);
    assert.deepEqual([
      parsed.body.batch.sourceRowCount,
      parsed.body.batch.stagedRowCount,
      parsed.body.batch.invalidRowCount,
      parsed.body.batch.duplicateRowCount,
      parsed.body.batch.importedRowCount,
    ], [3, 1, 1, 1, 0]);

    const persistedBatch = await db().legacyImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    assert.equal(persistedBatch.status, "NEEDS_REVIEW");
    assert.equal(persistedBatch.temporaryStorageKey, null, "temporary source object pointer is cleared after cleanup");
    assert.ok(persistedBatch.sourceFileSha256);
    assert.equal(store.objects.size, 0, "the temporary upload is removed after encrypted staging");

    const rows = await db().legacyImportRow.findMany({ where: { batchId }, orderBy: { rowNumber: "asc" } });
    assert.deepEqual(rows.map((row) => row.status), ["STAGED", "DUPLICATE_REVIEW", "INVALID"]);
    assert.equal(rows[1]?.validationIssues && JSON.stringify(rows[1].validationIssues).includes("EXACT_DUPLICATE_ROW"), true);
    assert.equal(rows[1]?.validationIssues && JSON.stringify(rows[1].validationIssues).includes("duplicateOfRowNumber"), true);
    assert.equal(rows[2]?.validationIssues && JSON.stringify(rows[2].validationIssues).includes("COLUMN_COUNT_MISMATCH"), true);

    for (const row of rows) {
      assert.ok(row.payloadCiphertext.startsWith("v1:"), "source cells are AES-GCM envelopes");
      assert.ok(!row.payloadCiphertext.includes("Μαρία"), "the staged database value contains no plaintext name");
      const plaintext = decryptField(row.payloadCiphertext);
      assert.ok(plaintext);
      const record = JSON.parse(plaintext!) as { headers: string[]; values: string[] };
      assert.equal(record.headers[0], "Κωδικός");
    }

    const preview = await call(managerCookie, "GET", "/legacy-imports/" + batchId + "/rows");
    assert.equal(preview.status, 200);
    assert.equal(preview.body.data.length, 3);
    assert.deepEqual(preview.body.data.map((row: any) => row.status), ["STAGED", "DUPLICATE_REVIEW", "INVALID"]);
    assert.equal(preview.body.data[0].record.values[1], "Μαρία Παπαδοπούλου");

    assert.equal((await raw(agentCookie, "GET", "/legacy-imports/" + batchId + "/rows")).status, 403);
    assert.equal((await call(managerCookie, "POST", "/legacy-imports/" + batchId + "/parse")).status, 409, "a staged batch cannot be parsed again");

    const audit = await db().auditLog.findMany({ where: { entity: "LEGACY_IMPORT_BATCH", entityId: batchId } });
    assert.ok(audit.some((entry) => entry.action === "stage"));
    assert.equal(JSON.stringify(audit).includes("Μαρία Παπαδοπούλου"), false, "audit rows contain no source values");
    assert.equal(JSON.stringify(audit).includes("6900000000"), false, "audit rows contain no source phone numbers");

    const mappings = await db().legacyEntityMapping.count({ where: { sourceSystem: "ESTATE_PLUS" } });
    assert.equal(mappings, 0, "staging does not create legacy mappings or canonical CRM records");
  } finally {
    setDocumentStore(null);
    await db().$disconnect();
  }
});
