# Website publication and unified channel publishing

`WebsitePublication.status` is the only authority on whether a property is on the
HOME88 website. `Property.publishedOnWebsite` is a derived compatibility flag; the
only writer of both is `apps/api/src/lib/website-publication.ts`. Portals keep
their own tables (`portal_listings`, `portal_sync_runs`, …) and their own rules:
publishing or withdrawing in one channel never changes another.

## API (all `AGENT` and up)

- `GET  /api/properties/:id/publications` – website + portal channels with status, blockers, warnings, URLs, last operation and permitted actions, all computed on the server. Read-only.
- `POST /api/properties/:id/publications/{validate,preview,publish,update,unpublish}` – body `{ channels: [{code, accountId?, environment?}], force? }`. Channels run independently; the response lists one result per channel. Authorization is checked for every channel before any runs.

Portal operations go through the existing `runPortalOperation`; the per-portal routes are unchanged. Mock-provider results carry `mock: true`. Portals with no adapter are `NOT_CONFIGURED` and have no Publish action.

## Public site

Pages are served at the existing `/property/[reference]` URLs. One rule (`publicWebsiteWhere`) decides visibility everywhere (detail, search, areas, sitemap, enquiry gate). The sitemap is derived from state, never from a stored flag. Only approved photos are public. After each change the CRM calls `POST {SITE_URL}/api/revalidate` (header `x-revalidate-secret`); failure never undoes the change.

## Release requirements

1. Set the same `WEBSITE_REVALIDATE_SECRET` on the CRM/API and web apps (without it pages refresh on the normal ISR timer).
2. **Migrate first, then deploy.** Do not apply migrations to production from the feature branch. Before deploying, verify on production:
   ```sql
   select migration_name, finished_at from _prisma_migrations
   where migration_name in ('20261008120000_website_publication','20261020000000_website_publication_cutover');
   ```
   `20261008120000_website_publication` is PR #61's migration and its production status is **unverified**: both rows must exist with `finished_at` set. If the first is absent, deploy is blocked until it is applied through the normal release. An API health check is not evidence.
3. The cutover migration is data-only and idempotent: it reconciles publications with `publishedOnWebsite` (changes made through the old checkbox since PR #61's backfill), writing an audit row per change.

## Limitations

- MARKETING cannot open the panel (routes require AGENT), same as the portal panel.
- No real XE/Spitogatos adapters; Green-Acres feed, bulk publishing, auto-publish and background sync are out of scope.
- Status changes (sold, rented) do not withdraw portal listings; that stays with the portal engine.
