# Showings, mandates and ownership — Phase A (data model and rules)

Phase A adds the relational foundation only. There is no PDF rendering, no
screen, no signature-provider change, no reminder, report or Estate+ import in
this phase; those follow in Phases B–D.

## Viewing and Showing are different things

| | Viewing (existing) | Showing (new) |
|---|---|---|
| What it is | the appointment / visit | the legal document: Υπόδειξη Ακινήτου |
| Properties | one | one or more (`showing_properties`) |
| Number | none | `ΥΠ-YYYY-NNNNNN`, allocated on issue, never reused |
| Needs a signature | no | yes (Phase B) |
| Link | `viewings.showingId` (optional) | `showings.sourceViewingId` (optional) |

Either can exist without the other. Existing viewings are not migrated or changed.

## What was added

**Tables:** `showings`, `showing_properties`, `showing_parties`, `showing_events`
(append-only), `property_owners`, `mandate_extensions`,
`mandate_conflict_overrides` (append-only), `payment_milestones`,
`legacy_entity_mappings`.

**Mandates** (`mandates`) gain structured columns: fee (payer, method, basis,
percentage, fixed amount, currency, VAT treatment and rate, payment trigger),
duration type, defects declaration, the photo / video / floor-plan / signboard /
portal / social / cooperating-broker permissions, dual-representation consent,
marketing channels, special terms, `supersedesMandateId` and the stored
completeness result. `terms` JSON remains for custom clauses and legacy data.
`startsAt` / `endsAt` remain the start and end dates. Nothing is back-filled:
the database freezes issued and signed mandates, so existing rows keep exactly
the values they have (the new columns are null for them).

**Templates** (`mandate_template_versions`) gain `source`, `requiresLegalReview`,
`legalReviewFlags` and counsel's approval (`legalApprovedAt/By/Checksum`). The
database refuses `ACTIVE` for a version that requires review unless the approval
is recorded against that exact checksum. `mandate_settings.maxExclusiveMonths`
holds the longest exclusive term counsel approved (null = none configured, none
enforced).

## Rules enforced by the database

- Showing number format and year; an issued showing has a number, an issue time and a template.
- Showing lifecycle `DRAFT → READY_FOR_ISSUANCE → ISSUED → SENT → VIEWED → SIGNED` (or `DECLINED / EXPIRED / CANCELLED`),
  frozen from issue (only signing progress moves); showing properties, parties and payment milestones freeze with it.
- Fee bounds, one fee method at a time, VAT rate only where VAT applies (showings and mandates).
- Exclusive mandates are never indefinite; a fixed term has an end; end is not before start (new and changed rows).
- One current primary contact per property, ownership 0–100 %, validity dates ordered, a representative needs authority on record.
- A milestone belongs to a mandate **or** a showing, carries exactly one amount, and its sequence is unique per parent.
- Extensions: `newEndDate > previousEndDate`; free while draft, then only signing progress moves, then immutable.
- Legacy templates (`source = ESTATE_PLUS_LEGACY`) must be flagged for review and cannot be ACTIVE without approval.
- Unique legacy ids per `(organization, source system, entity type, legacy id)`.
- Row-level security on every new table; trigger functions are not callable through the public API roles.

## Validators (`@home88/domain`, pure)

`validateShowing`, `validateMandate`, `validateCommission`,
`validatePaymentMilestones`, `validateOwnership`, `validateExclusiveConflict`,
`validateTemplateCheck`, `validateParties`, `detectCommissionAnomalies`,
`calculateFee`, `calculateDuration`, `effectiveEndDate`,
`detectLegacyLegalFlags`. Each returns a `DocumentCompletenessResult`
(`BLOCKED | WARNING | READY`, `blockingIssues[]`, `warnings[]`, `draftSaveable`);
a draft may stay incomplete, but impossible values are never saveable.

Server helpers are in `apps/api/src/lib/brokerage/`: number allocation, property
snapshots taken from the canonical property, `issueShowing`, conflict checks and
manager overrides, extensions, completeness, and idempotent legacy mapping.

## Not decided here (needs review)

- `organizationId` / `branchId`: the data model has no organisation or branch tables, so they are not on `showings`; `legacy_entity_mappings.organizationId` defaults to `home88`.
- `clientSnapshot` is stored encrypted (`clientSnapshotEncrypted`) because it holds ΑΦΜ and ID details.
- Showing templates reuse the mandate template tables with type `SHOWING`.
- `Property.ownerId` stays; `property_owners` is read together with it (no back-fill).
- Anomaly thresholds (10 %, 50 €) are warning heuristics and configurable in the call; they are not business rules.
- Legacy Estate+ wording is in `packages/domain/src/legacy-templates.ts` as source material only; nothing activates it.
