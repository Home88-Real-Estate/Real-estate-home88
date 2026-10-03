# Public intake: website → CRM

Everything a visitor submits from the website becomes structured CRM records
through one service, `PublicLeadIntakeService` (`packages/intake`). The website
(`apps/web`) calls it directly; staff work the results in the CRM
(`/submissions`, `/media`).

## Flows

| Form | Endpoint | Creates |
|---|---|---|
| `/submit` (assignment) | `POST /api/submissions` | contact, **SELLER_OWNER** lead, **draft submission**, private photos/documents |
| `/valuation` | `POST /api/valuation` | contact, **SELLER_VALUATION** lead, submission (kind VALUATION) |
| `/request` | `POST /api/requests` | contact, **BUYER** lead, buyer request |
| property page enquiry | `POST /api/leads` | contact, **PROPERTY_ENQUIRY** lead linked to the property |
| property page "book a viewing" | `POST /api/viewings` | contact, **BUYER_VIEWING** lead, viewing *request* (never a viewing) |
| `/contact` | `POST /api/contact` | contact, **GENERAL_INQUIRY** lead |

Every flow: age gate → idempotency → validation → contact resolution →
consent records → lead → audit → staff notification. A submission is **never**
a property; an agent converts or links it.

## Contacts and duplicates

Matched by normalised email first, then normalised phone (`Contact.phoneHash`).
An uncertain match (a shared phone with a different surname, or email and phone
pointing at two people) is **not merged**: a new contact is created and a
`possible_duplicate` notification plus audit entry is raised for a person.

Contacts that predate phone matching have no `phoneHash`. Run once after
deploying:

    npm run backfill:phone-hash -w @home88/api -- --dry   # report
    npm run backfill:phone-hash -w @home88/api            # write

## Idempotency

The browser sends one `idempotencyKey` per form. A repeat (double click, flaky
network, parallel duplicate) returns the original reference and creates
nothing. `intake_receipts` rows are small but never expire by themselves; add a
retention job if volume warrants it.

## Uploads and storage

Anonymous visitors upload straight to object storage through signed URLs
(`/api/uploads/session`, `/api/uploads/presign`); quotas are enforced in
`intake_upload_sessions`. Files land under `submissions/<random>/uploads/` and
are **private**:

- declared type, extension and size are checked before a URL is issued;
- on submit the bytes are verified (magic numbers), photos are decoded and
  re-encoded **without metadata** (no EXIF, no GPS), variants are generated
  (thumbnail 320, card 640, medium 1280, large 2048, WebP) and a checksum taken;
- unsafe files are rejected and deleted; valid-but-unusable images are
  quarantined for staff; documents become CRM-only `Document` rows;
- staff see photos through 5-minute signed URLs and documents through
  2-minute signed URLs, restricted to the assigned agent or a manager and
  audited. No API response contains a storage key.

**Bucket policy (required).** Public read must be limited to the
`properties/` prefix. `submissions/` must stay private. Converting a submission
*moves* approved photos to `properties/<propertyId>/photo/…`; nothing under
`submissions/` is ever referenced by the website or a portal.

**CORS (required).** The bucket must allow `PUT` with headers
`content-type`, `cache-control` and `content-length` from the website origin.

### Environment (website)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | database |
| `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE` | storage (same bucket as the CRM); unset ⇒ uploads answer 503, other flows still work. `S3_ENDPOINT`'s origin is added to the CSP `connect-src`. |
| `PII_HASH_PEPPER`, `PII_ENCRYPTION_KEY` | must equal the API's values |
| `INTAKE_MAX_PHOTOS` (20), `INTAKE_MAX_DOCUMENTS` (5), `INTAKE_MAX_PHOTO_BYTES` (15 MB), `INTAKE_MAX_DOCUMENT_BYTES` (10 MB), `INTAKE_MAX_TOTAL_BYTES` (150 MB), `INTAKE_MAX_PIXELS`, `INTAKE_MIN_DIMENSION` (300), `INTAKE_MAX_DIMENSION` (12000) | upload limits (defaults shown) |
| `LEAD_RETENTION_MONTHS` (24), `SUBMISSION_RETENTION_MONTHS` (12) | retention **defaults, not policy** — set with your legal basis |

## Known limits

- Rate limiting on the website is per server instance (in memory). On
  serverless it is a speed bump, not a guarantee; upload quotas are in the
  database and do hold.
- If the database is unavailable the visitor sees a generic error and must
  retry; there is no outbox that preserves the submission meanwhile.
- No email is sent to staff yet; notifications are in-app (`crm_notifications`).
- Lead routing rules and response-time (SLA) timers are not implemented: new
  leads are unassigned.
- Matching, follow-up tasks and the buyer-request → match pipeline are the
  existing request module's; the intake only creates the request.

## Tests

`packages/intake` (unit + Postgres integration), `apps/api`
(`submissions.e2e.test.ts`: real Fastify app, sessions and Postgres; in-memory
storage), `apps/web` (`intake-route.test.ts`). Database tests run only when
`INTAKE_TEST_DATABASE_URL` points at a scratch database with migrations applied;
otherwise they are **not run** (and are not counted as passed), so CI needs a Postgres service for them to count.
