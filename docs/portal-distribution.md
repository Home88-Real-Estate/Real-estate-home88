# Πύλες & Διανομή (portal distribution)

## Milestone 1 — directory and navigation
- `packages/domain/src/portal-directory.ts`: every known destination with country, market, group, delivery method, whether a public specification is known and whether Greek listings are accepted. Entries without a framework link are research candidates.
- Status vocabulary: `CATALOG_ONLY`, `NEEDS_SPECIFICATION`, `AWAITING_ACCOUNT`, `READY_FOR_TEST`, `CONNECTED`, `SYNC_ERROR`, `PAUSED`, `UNSUPPORTED`. `CONNECTED` comes only from the existing framework status, which requires a successful sync.
- `GET /api/distribution/portals`, pages `/distribution` and `/distribution/portals`.

## Milestone 2 — bulk distribution
- `GET /api/distribution/properties`: server-side filtered, paginated rows with website and portal summaries (filters: the property list's own, plus `portalState=NONE|PUBLISHED|ISSUES`).
- `POST /api/distribution/plan`: judges every (property, portal) with the caller's own permissions; changes nothing. Selection is `ids` or `filter` (+`exclude`), resolved on the server with the same filter as the property list; at most 500 properties and 2000 items per batch.
- `POST /api/distribution/batches`: persists the plan as a durable batch (idempotency key supported). Ready items are queued, blocked ones are recorded with their reasons. Nothing is sent.
- `POST /api/distribution/batches/:id/process|cancel|retry`, `GET …/batches[/:id]`. Items are claimed with a conditional update (no double runs), run through the existing `runPublicationOperation`/`runPortalOperation` as the batch creator, and fail individually. Stale claims are reclaimed; attempts are bounded (3). Processing is driven by calls (the CRM polls while a batch is open); no scheduler exists yet.
- UI: `/distribution/properties` (selection across pages, "select all N matching", exclusions, check → start → live progress → per-item results → retry failed).
- Permission `portals.bulk_publish` (now granted to agents by default; each item still needs the caller's per-property and per-portal permissions, and unpublish needs `portals.unpublish`).

### Release requirements
- New migration `20261023000000_portal_distribution_batches` (additive: two tables with RLS). **Not applied to production from this branch.** Verify production migration status first, then migrate before deploying code that reads the tables.
- `CRM_URL` must be https in production (portals fetch photos from it); the planner blocks sends otherwise.

### Not built yet
Background scheduler for batches, per-portal rate limits beyond the sequential claim size, snapshot-feed safeguards (milestone 3), recommendations (milestone 4).

## Milestone 3 — removal safeguards
Already in place (audited, unchanged): served pull feeds are recorded as feed versions and compared with the last confirmed size (`gateFeed`/`guardPublicationChange`): an empty feed or a drop beyond the portal's threshold (default 30 %, only above 10 listings) is blocked until a manager approves that version; a surge raises a notice.

Added:
- **Bulk withdrawal guard.** A batch that unpublishes listings is checked per portal against the number of live listings with the same thresholds (`portal.settings.publicationGuard`). Emptying a portal, or dropping past the limit, is blocked at planning (no batch is created) until the request carries `confirmMassRemoval: true`. Confirming does not grant the right to withdraw (managers only), and the confirmation is written to the audit entry. Publishing and updating never trip it.
- **Publication mode in the directory** (`INCREMENTAL` / `FULL_SNAPSHOT` / `UNKNOWN`), claimed only where documented: Green-Acres (cancel-and-replace), Kyero and JamesEdition (feed reconciliation) are snapshot portals.

### XE.gr API (information supplied by the agency, from XE's support guide; not yet verified by HOME88 against the sandbox)
- Register a user, request CRM/integrator credentials (`client_id`, `client_secret`) with XE, receive sandbox access (`api-sandbox.xe.gr`), obtain XE's test scenarios from `api-support@xe.gr` (create, edit, delete), pass certification, then production credentials appear under "Στοιχεία Διασυνδέσεων".
- Auth: `POST` form-encoded to the Keycloak token endpoint (sandbox `auth-sandbox.xe.gr/auth/realms/xe/protocol/openid-connect/token`, production `www.xe.gr/auth/realms/xe/protocol/openid-connect/token`) with `grant_type=password`, `username`, `password`, `scope=openid profile email`; use the JWT as a Bearer token.
- Endpoints (JSON, `account_id` in the body): `POST /v1/real-estate/listings`, `PUT …/{id}`, `DELETE …/{id}` (pause), `GET …/listings`.
- Limits: 429 above 1 token/sec and 5 tokens/min — an adapter must cache and reuse tokens, not request one per listing.
- Status: the existing XE adapter is CSV-based; an API adapter is a separate piece of work gated on XE issuing sandbox credentials.
