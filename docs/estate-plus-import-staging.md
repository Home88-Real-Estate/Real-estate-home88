# Estate+ import staging

**Status:** secure staging, CRM mapping preview, retention purge and manager row-review decisions are implemented. Real customer exports remain blocked until an operator-approved retention value, a representative Estate+ export schema, and canonical duplicate/approval policies are supplied.

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
| POST | /api/legacy-imports/:id/review | Record a manager's explicit decision and reason for one row |

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
- Phase D.3 provides the manager-only CRM mapping workspace. The screen displays mapped values only in the manager session; it does not persist plaintext mapped records.
- A successful preview is not approval. `canApprove` and `canImport` remain false.

## Retention and purge lifecycle (Phase D.4)

Every newly created batch snapshots the operator's configured retention duration and its absolute expiry timestamp:

- `LEGACY_IMPORT_RETENTION_DAYS` is mandatory for new batch creation. It must be an integer from 1 to 3,650. There is intentionally no code default: this range is a technical validation bound, not a recommended or legally approved retention period.
- If the variable is absent or invalid, intake is disabled with a clear conflict response. Existing batches with a NULL expiry are not eligible for automatic deletion.
- The CRM deployment schedules `GET /api/cron/legacy-import-purge` once daily at 03:17 UTC. The endpoint requires `Authorization: Bearer <CRON_SECRET>`; `CRON_SECRET` must be at least 32 characters and must be configured as a Vercel environment variable.
- The worker processes batches in bounded chunks. It considers expired CREATED, FAILED, STAGED, NEEDS_REVIEW, READY_FOR_APPROVAL, REVIEWED or CANCELLED batches, provided they have never been approved/imported and have no canonical record links. It excludes PARSING, APPROVED, IMPORTING and COMPLETED batches. Reviewed-but-unapproved staging decisions do not extend the retention period.
- It rechecks approval, imported-row counts and canonical LegacyEntityMapping links before deletion. A per-batch compare-and-set lease prevents overlapping runs from purging the same batch.
- Any remaining private temporary CSV object is deleted first. The worker then marks the batch EXPIRED and deletes its encrypted staged rows in one database transaction.
- The batch row remains as an audit tombstone with the retention duration/expiry, source file hash and counts, purge timestamp and purged-row count. Mapping configuration and source column headers are cleared. The purge is recorded as a `retention_purge` audit action.
- Database triggers reject direct row deletion unless the batch has been marked EXPIRED by the controlled worker, and reject deletion for approved/imported batches or batches linked to canonical records.

Required production configuration:
- `LEGACY_IMPORT_RETENTION_DAYS`: the duration selected and approved by HOME88's data-retention owner.
- `CRON_SECRET`: a randomly generated secret of at least 32 characters, set on the CRM Vercel project for the relevant deployment environments.

The integration test uses a synthetic 30-day value only to test date handling. It is not a production recommendation.

## Human row review and duplicate resolution (Phase D.5)

The manager workspace now requires an explicit decision for each row after a mapping preview:

- The preview persists only the non-PII row classification and validation issue codes. Mapped customer values remain in memory and are not written to the database.
- Each row must receive one of two decisions: `ACCEPT_AS_NEW` or `SKIP`. Decisions record the manager, timestamp, mapping version and a reason code. Audit events contain the row number, classification, decision and reason code, never source values.
- A `READY` row may be accepted only with `SOURCE_RECORD_VERIFIED`, or skipped with `NOT_RELEVANT`.
- A within-file exact duplicate may be accepted only with `DUPLICATE_CONFIRMED_DISTINCT`, or skipped with `EXACT_DUPLICATE_SKIPPED`. Accepting it does not bypass future canonical duplicate checks.
- A source-invalid row can only be skipped with `INVALID_SOURCE_SKIPPED`. A mapping-invalid row can only be skipped with `MAPPING_ISSUE_SKIPPED`.
- The API validates these reason/classification combinations and the PostgreSQL row trigger independently. A decision is tied to the mapping version; changing the mapping before review completion clears the earlier preview classifications and decisions.
- Review counts and decisions are updated transactionally. Concurrent edits to the same row are rejected; the final row decision moves the batch to `READY_FOR_APPROVAL` if at least one row was accepted, or `REVIEWED` if every row was skipped.
- After review completion, row decisions and the mapping are locked. The batch is waiting for a separate approval phase; `canApprove` and `canImport` remain false in this phase.
- No contacts, properties, entity mappings or other canonical CRM records are created by review.

**Important limitation:** the parser detects exact repeated payload rows inside one CSV batch. This phase does not perform fuzzy matching, cross-batch duplicate detection, or matching against existing HOME88 contacts/properties. Those rules still require a verified source sample and an approved duplicate policy.

## Explicitly out of scope

- An approved, reusable Estate+ vendor mapping template (until a real export sample is reviewed).
- XLSX/XLS parsing.
- Existing-contact/property/mandate matching.
- Cross-batch or canonical-record duplicate detection.
- Separate human batch approval, contact/property creation, or import execution. Phase D.5 records row-level review decisions only; it does not authorize canonical writes.
- Automatic merging of contacts.
- Rollback of imported canonical records (no import writes exist yet).

## Blockers before a real export can be staged

1. Obtain a representative Estate+ CSV export and confirm which entity types it contains (contacts, properties, mandates, viewings, documents, etc.).
2. Review and approve the source column mappings, numeric formats, enum translations, boolean tokens, and null/empty conventions against representative Estate+ records. The API can store a mapping now, but it is not evidence that the vendor export has been mapped correctly.
3. Define canonical-record and cross-batch duplicate matching rules. Phase D.5 records decisions for same-file exact duplicates only; it does not search or link existing HOME88 contacts/properties.
4. Define the separate approval authority, separation-of-duties rule and evidence the approver must review. Phase D.5 does not approve or execute imports.
5. Have HOME88's data-retention owner select and approve the actual retention duration, then configure LEGACY_IMPORT_RETENTION_DAYS and CRON_SECRET in the CRM Vercel project. The purge mechanism is implemented, but its production retention duration is intentionally not selected by code.
6. Define a verified rollback/recovery plan for the later phase that writes canonical CRM records.

## Verification

apps/api/src/lib/legacy-import/csv.test.ts covers parser behavior and resource limits. apps/api/src/lib/document-store.test.ts covers private import-key validation. apps/api/src/routes/legacy-imports.integration.test.ts exercises the API with synthetic data against the disposable Postgres test database and an in-memory object store.

Never use production customer exports for development fixtures. Use a redacted copy when field names and value formats are all that is needed.