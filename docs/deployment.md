# Deployment

Two Vercel projects from one repository, one PostgreSQL database, one object
storage bucket. No other servers.

| Vercel project | Root directory | Serves | Domain |
|---|---|---|---|
| HOME88 Web | `apps/web` | Public website | `home88.estate` (today `realestate-home-88.vercel.app`) |
| HOME88 CRM | `apps/crm` | Staff CRM under `/crm` **and the API** under `/crm/api/*` and `/api/*` | `crm.home88.estate` |

```
browser ──► home88.estate ─────────────► apps/web ──► PostgreSQL (published listings, enquiries)
   │
   └──────► crm.home88.estate/crm/... ──► apps/crm ──► API in the same process ──► PostgreSQL
                     │                                        │
                     └──── photo bytes (signed PUT) ──────────┴──► object storage
```

## How the API runs inside the CRM

`apps/api` is unchanged business logic (Fastify routes, Prisma, auth). Two
entry points share it:

- `apps/api/src/index.ts`: standalone server for local development (`npm run dev`).
- `apps/api/src/handler.ts`: builds the same app once per process and serves requests with Fastify's `inject`, with no open port.

The CRM calls it through `apps/crm/src/lib/api-transport.ts`. With `API_URL`
empty (production), every call runs in-process; with `API_URL` set (local
dev), it goes over HTTP to the standalone server. Public access to the API
(portal feeds, health, the browser's upload calls) goes through
`apps/crm/src/app/api/[...path]/route.ts`, at `/crm/api/<path>`. On Vercel,
`apps/crm/vercel.json` also maps `/api/<path>` to it, and `/` to `/crm`.

Because of this, the CRM project holds the API's server-only secrets
(`DATABASE_URL`, `JWT_SECRET`, `S3_*`, `SMTP_*`, `PII_*`). None of them is a
`NEXT_PUBLIC_` variable, so none can reach the browser bundle.

## Photos and documents: direct-to-storage uploads

Vercel functions accept at most 4.5 MB per request, so file bytes never pass
through the API:

1. The CRM asks `POST /api/properties/:id/media/uploads` for a signed PUT URL.
   The API picks the key, checks the type and size, and signs Content-Type
   and Content-Length, so the browser cannot upload a different type or a
   larger file than it declared. The URL expires after 15 minutes.
2. The browser PUTs the original straight to the bucket. For photos it also
   uploads a 2048px web version and a 480px thumbnail, made in the browser,
   so phones upload less and the website serves small images.
3. The CRM calls `POST /api/properties/:id/media/confirm`. The API checks
   that the object exists, its size and type, and that its bytes really are
   that image, then records `PropertyMedia` (key, type, size, width, height,
   variant keys) as `pending_review`. Confirm is idempotent per key, so a
   retried confirm never creates a duplicate.

Every step retries with backoff, and the uploader waits for the connection to
return when offline. It warns before the page is closed with uploads still
pending. A queue that survives closing the page (IndexedDB) is part of the
planned offline PWA phase.

### Bucket CORS (required)

The bucket must accept browser PUTs from the CRM origin:

```json
[
  {
    "AllowedOrigins": ["https://crm.home88.estate"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["content-type", "cache-control"],
    "MaxAgeSeconds": 3600
  }
]
```

## Setting up the two projects

### HOME88 CRM (root `apps/crm`)

1. Vercel → Add New Project → this repository → Root Directory `apps/crm` → Framework Next.js. Build and install commands stay at their defaults.
2. Environment variables: everything in `apps/crm/.env.example`. Leave `API_URL` empty. The required ones:
   `DATABASE_URL`, `JWT_SECRET` (32+ characters), `CRM_URL=https://crm.home88.estate`,
   `SITE_URL=https://home88.estate`, `S3_*`, `PII_HASH_PEPPER`, `PII_ENCRYPTION_KEY`, `SMTP_*`.
3. Domains → add `crm.home88.estate`, then create the DNS record Vercel shows (a CNAME for `crm`) wherever `home88.estate`'s DNS is managed.
4. Apply database migrations once per release from a trusted machine:
   `DATABASE_URL=… npm run db:deploy -w @home88/database`.
5. Create the first administrator (see `docs/authentication.md`).

Check: `https://crm.home88.estate/api/health` returns `{"status":"ok",…}`.
`/api/health/ready` reports whether the database answers, as up or down only:
it never shows connection details.

### HOME88 Web (root `apps/web`)

- `NEXT_PUBLIC_SITE_URL` = the site's URL (note: `NEXT_PUBLIC_`, not `NEXT_SITE_URL`).
- `DATABASE_URL`, `PII_HASH_PEPPER`, `PII_ENCRYPTION_KEY` (same values as the CRM).
- `NEXT_PUBLIC_CRM_URL=https://crm.home88.estate` once that domain resolves, so the footer's «Σύνδεση Συνεργατών» goes to `https://crm.home88.estate/crm/login`. Redeploy after setting it (it is read at build time).

Until the CRM domain exists, leave `NEXT_PUBLIC_CRM_URL` unset and set
`CRM_ORIGIN` to the CRM project's `*.vercel.app` URL instead. The website then
serves the CRM under its own `/crm`, and the footer links there. If you do
that, add the website's origin to the CRM's `CRM_PUBLIC_ORIGINS`.

## Limits to know

- **Rate limits** for login and password reset are kept in memory per running
  instance. On Vercel, instances come and go, so the limits are weaker than on
  one long-lived server. A shared store (e.g. Redis) is the upgrade path.
- **Database connections:** each instance opens its own Prisma connection
  pool. Use Supabase's pooled connection string (port 6543, `?pgbouncer=true`)
  for `DATABASE_URL` in both projects, and the direct one for running migrations.
