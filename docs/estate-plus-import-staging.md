# Estate+ import staging

**Status:** staging foundation only; do not use for a real migration yet.

**Branch / review:** feat/estate-plus-import-foundation / PR #89.

## Purpose

This phase accepts an Estate+ CSV export, validates its basic CSV structure, and stores source rows in a private quarantine area so that the export format can be inspected and field mappings can be designed.

The parser deliberately does not assume Estate+ column names. A real export sample must be reviewed before mappingVersion can move beyond unmapped.

## Current API

All routes require a signed-in user at or above MANAGER:

| Method | Route | Purpose |
| --- | --- | --- |
| POST | /api/legacy-imports | Create a batch and return a short-lived private CSV upload URL |
| POST | /api/legacy-imports/:id/parse | Parse and stage the uploaded file once |
| GET | /api/legacy-imports | List batches |
| GET | /api/legacy-imports/:id | Read batch metadata |
| GET | /api/legacy-imports/:id/rows | Decrypt and preview source rows for a manager |

The upload request takes a .csv filename, byte size, and optional delimiter (AUTO, COMMA, SEMICOLON, or TAB). The original filename is not persisted. Upload URLs expire after 10 minutes.

## Parser and row states

- UTF-8 only; BOM is supported.
- Comma, semicolon, and tab delimiters are supported, with quote/escaped-quote and quoted-newline handling.
- Current route limits: 20 MiB and 10,000 source rows; parser defaults also cap columns and individual cell length.
- Malformed-width rows are marked INVALID.
- Exact repeated payload rows within the same batch are marked DUPLICATE_REVIEW and retain a reference to the first row number.
- Only structurally valid first occurrences are marked STAGED.
- Any invalid or duplicate rows put the batch into NEEDS_REVIEW.
- A successful parse returns FIELD_MAPPING_REQUIRED. It does not import or map records.

## Security properties

- Only managers and above can create, parse, list, and preview batches.
- Source CSV objects use a random key under the private/legacy-imports/ prefix.
- Source row payloads are encrypted using the existing AES-256-GCM PII helper before database storage. The parser itself never writes raw cells to logs.
- File and row SHA-256 hashes support integrity checks.
- Audit records include the batch, parser, row counts, and page counts, not source cell values.
- The source object is deleted after successful staging or a client-side parse failure. The database clears its temporary object pointer after successful deletion.
- Database RLS is enabled and anon / authenticated privileges are revoked for the import tables.
- Database triggers prevent source payload/hash edits and prevent source batch identity from being rewritten.

## Mapping and validation preview (Phase D.2)

- Mapping is manager-only and can target CONTACT or PROPERTY. This is a controlled allowlist, not a general Prisma field mapper.
- A source header can be mapped once and each HOME88 target field can be mapped once. Unknown fields and relation IDs (for example owner/agent IDs) are not accepted.
- TEXT and EMAIL conversions are explicit. Numeric fields require INTEGER, NUMBER_DOT, or NUMBER_COMMA. Boolean fields require user-supplied true/false tokens. Enum fields require a user-supplied source-to-HOME88 value map.
- Property preview always validates a DRAFT property. Status, publication, ownership links, agent assignments, generated reference and slug are not mappable.
- The mapping configuration stores only target field names, source header names, and conversion rules. Mapped row values are computed in memory from the encrypted source payloads; no plaintext mapped rows are persisted.
- Preview returns summary counts and a paginated sample of mapped records to managers. Audit metadata stores only counts and mapping information, not row values.
- This phase does not yet offer a CRM mapping screen; the mapping and preview endpoints are API-only.
- A successful preview is not approval. `canApprove` and `canImport` remain false.

## Explicitly out of scope

- An approved, reusable Estate+ vendor mapping template (until a real export sample is reviewed).
- XLSX/XLS parsing.
- Existing-contact/property/mandate matching.
- Cross-batch or canonical-record duplicate detection.
- Human approval, contact/property creation, or import execution. (The current mapping preview is a non-writing dry run only.)
- Automatic merging of contacts.
- Rollback of imported canonical records (no import writes exist yet).

## Blockers before a real export can be staged

1. Obtain a representative Estate+ CSV export and confirm which entity types it contains (contacts, properties, mandates, viewings, documents, etc.).
2. Review and approve the source column mappings, numeric formats, enum translations, boolean tokens, and null/empty conventions against representative Estate+ records. The API can store a mapping now, but it is not evidence that the vendor export has been mapped correctly.
3. Define canonical-record duplicate rules and how conflicts are resolved by a human.
4. Define who may approve an import and what evidence the approver must review.
5. Agree a retention period and cleanup process for both abandoned temporary uploads and encrypted staged rows. There is currently no scheduled expiry/purge job for abandoned uploads or staged source rows. Do not upload real customer data until that retention policy and cleanup mechanism are agreed and implemented.
6. Define a verified rollback/recovery plan for the later phase that writes canonical CRM records.

## Verification

apps/api/src/lib/legacy-import/csv.test.ts covers parser behavior and resource limits. apps/api/src/lib/document-store.test.ts covers private import-key validation. apps/api/src/routes/legacy-imports.integration.test.ts exercises the API with synthetic data against the disposable Postgres test database and an in-memory object store.

Never use production customer exports for development fixtures. Use a redacted copy when field names and value formats are all that is needed.