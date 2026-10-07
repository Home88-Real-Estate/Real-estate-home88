# Portal foundation

An additive extension of the portal subsystem that already existed. Nothing was
replaced: `portals`, `portal_listings`, `portal_sync_logs`, `portal_mappings`,
`portal_property_mappings`, `portal_feed_versions`, `portal_publication_rules`,
`packages/portals` (normalised property, validation, preview, content hash,
retry/backoff, safety checks, XML/CSV serialisation, adapters, provider
contract) and `portal-distribution.ts` / `portal-sync.ts` all keep working as
before. Feeds, mappings and publication rules are untouched.

## What exists, and what this adds

| Need | Already there | Added |
|---|---|---|
| Portal registry | `portals`, `PORTAL_CATALOG` | — |
| One listing per property and portal | `portal_listings` | `portalAccountId`, `lastAction`, `lastActionAt`, `lastActionById`, `lastSuccessfulSyncAt`, `lastFailedAt`, `payloadSnapshot` |
| Event history | `portal_sync_logs` | `syncRunId` link |
| Several accounts, TEST/PRODUCTION | — | `portal_accounts` |
| One record per operation | — | `portal_sync_runs` (+ `PortalRunTrigger`, `PortalRunOperation`, `PortalRunStatus`) |
| Encrypted secrets | `provider_credentials` + AES-256-GCM `secret-box` | reused under scope `portal-account:<id>`; hints for masking on the account row |
| Gate: status, rule, tags, validation, mapping | `evaluateCandidate` | reused unchanged |
| Payload hash / "unchanged → no update" | `propertyContentHash`, `planSync` | reused |
| Failure classes, backoff, review parking | `decideRetry`, `classifyError` | `DUPLICATE_LISTING` code |
| Provider contract | `provider-contract.ts` | optional call context (environment, idempotency key, credentials) |
| Audit | `writeAudit` | actions `PORTAL_CONNECTION_TESTED`, `PORTAL_ACCOUNT_UPDATED`, `PROPERTY_PUBLISHED`, `PROPERTY_UPDATED`, `PROPERTY_UNPUBLISHED`, `PORTAL_SYNC_FAILED`, `PORTAL_SYNC_RETRIED` |
| Permissions | settings permission matrix | `portals.*` (see below) |

## Environments

Every account is `TEST` or `PRODUCTION`, chosen explicitly when it is created.
Every operation names the environment it expects and is refused (409,
`environment_mismatch`) if the account is the other one.

No real provider exists in this repository. Therefore:

* a **TEST** account on a portal that has an adapter uses the in-process **mock** provider
  (seven behaviours: success, validation error, temporary failure, authentication
  failure, rate limit, duplicate, timeout). It never opens a connection. Results are
  labelled mock in the UI and in the audit trail;
* a **PRODUCTION** account has **no provider**: it cannot be tested, enabled
  or used. A mock result can never be mistaken for a live listing;
* a portal without an adapter (JamesEdition, Plot.gr, …) shows
  «Δεν υπάρχει ακόμη adapter για αυτό το portal.» and offers no action.

Real XE / Spitogatos adapters are added later with `registerRealPortalProvider`
(`apps/api/src/lib/portal-accounts.ts`), from the portals' official specifications
only. None of their endpoints, fields or authentication are guessed here.

## Credentials

Submitted once, sealed server-side with `SETTINGS_ENCRYPTION_KEY`, stored in
`provider_credentials`. The account row keeps only the last four characters of
values long enough to mask safely. Routes return `{ configured, masked:
"********abcd", changedAt }`. Values are not returned, logged, audited or put
in a payload snapshot. Replacing a credential resets the connection-test result
and disables the account until it is tested again.

## Operations (manual only)

`POST /api/properties/:id/portals/:code/{preview,publish,update,unpublish,retry}`
with `{ accountId, environment }`.

* **preview** judges and renders; changes nothing.
* **publish** needs the property to pass the portal's gate. `DO_NOT_PUBLISH` and
  `WEBSITE_ONLY` block it; `PORTAL_ONLY` does not.
* **update** sends nothing when the content hash is unchanged.
* **unpublish** never needs the gate.
* **retry** repeats whatever failed last, on the same listing; a person's retry
  overrides the automatic backoff.
* A *duplicate* answer on publish adopts the portal's existing listing and
  updates it, so a lost reply cannot create a second listing. The idempotency
  key is derived from account, property and content hash.
* One listing per property per portal: a live listing is moved to another account
  only after it is withdrawn.

Each operation writes a `portal_sync_runs` row (counts, status, who), a
`portal_sync_logs` event and an audit entry. Blocked and failed outcomes are
returned in the body with HTTP 200 (they are outcomes, not server faults).

Not implemented, on purpose: publishing on property save, cron, bulk
publishing, webhooks. The `CRON`, `PROPERTY_SAVE` and `BULK_ACTION` run
triggers and the `portals.bulk_publish` permission exist so a later PR can use
them; nothing in this one creates such a run.

## Photos

`GET /api/portal-media/<token>` (anonymous: the token is the authority). A token
names one media item of one property for one portal and expires (default 1 hour,
at most 24). It carries no storage key, is HMAC-signed with a key derived from
`SETTINGS_ENCRYPTION_KEY`, and the route re-checks at request time that the media is
still approved and that the portal has a listing for that property. Anything else
is a plain 404. The bucket stays private. A photo over ~4 MB is served as its
preview variant (Vercel's response limit). The content hash is taken from the
stable projection, so fresh tokens never trigger an update.

## Permissions

| | Agent | Manager | Admin | Super Admin |
|---|---|---|---|---|
| view, preview, publish, update, retry, history | ✔ (own properties for changes) | ✔ | ✔ | ✔ |
| unpublish, provider error wording | | ✔ | ✔ | ✔ |
| configure accounts, test connection | | | ✔ | ✔ |
| manage credentials | | | ✔ | ✔ |
| bulk publish (not active) | | | ✔ | ✔ |
| production accounts (`portals.activate_production`, reserved) | | | | ✔ |

Role overrides in Settings → Permissions still apply, except the reserved
production permission, which cannot be granted.
