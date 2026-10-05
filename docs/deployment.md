# Deployment

Two Vercel projects from one repository, one PostgreSQL database, one object
storage bucket. No other servers.

| Vercel project | Root directory | Serves | Domain |
|---|---|---|---|
| HOME88 Web | `apps/web` | Public website | `home88.estate` (today `realestate-home-88.vercel.app`) |
| HOME88 CRM | `apps/crm` | Staff CRM under `/crm` **and the API** under `/crm/api/*` and `/api/*` | `crm.home88.estate` (today `real-estate-home88-iota.vercel.app`) |

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
   `DATABASE_URL=… npm run prisma:deploy -w @home88/database`.
5. Create the first administrator (see `docs/authentication.md`).

Check: `https://crm.home88.estate/api/health` returns `{"status":"ok",…}`.
`/api/health/ready` reports whether the database answers, as up or down only:
it never shows connection details.

### HOME88 Web (root `apps/web`)

- `SITE_URL` = the site's URL, e.g. `https://realestate-home-88.vercel.app`.
  `NEXT_PUBLIC_SITE_URL` is also accepted; see the note on env names below.
- `DATABASE_URL`, `PII_HASH_PEPPER`, `PII_ENCRYPTION_KEY` (same values as the CRM).
- The footer's «Σύνδεση Συνεργατών» goes to the CRM deployment,
  `https://real-estate-home88-iota.vercel.app/crm/login`, with no configuration;
  `/crm` on the website redirects there too. Leave `CRM_URL` and `CRM_ORIGIN`
  **unset** for this.
- `CRM_URL=https://crm.home88.estate` once that domain resolves points the link
  there instead. `NEXT_PUBLIC_CRM_URL` is accepted too, but see the env names
  note below.
- Alternatively `CRM_ORIGIN` = the CRM deployment's URL serves the CRM on the
  website's own `/crm` (rewrite); then add the website's origin to the CRM's
  `CRM_PUBLIC_ORIGINS`.

### Env names on the web project

`apps/web` reads `SITE_URL`, `CRM_URL`, `CRM_BASE_PATH` and `MEDIA_BASE_URL`, and
also accepts the `NEXT_PUBLIC_` spelling of each. No module that reads them is a
client component, and they hold public origins rather than secrets, so the plain
names are preferred: Vercel warns that a `NEXT_PUBLIC_` value is exposed to the
browser, and some dashboards refuse the name outright. `NEXT_PUBLIC_CRM_BASE_PATH`
must keep its prefix — Next inlines it into the client bundle for the CRM router.

## Is the CRM's API working?

Open `https://<CRM domain>/crm/health/ready`. It answers whether the API
inside the CRM starts and whether the database answers. If not, it names the
environment variables to fix on the **CRM** Vercel project (names only, never
values), for example:

```json
{ "status": "unavailable", "api": "down", "configuration": [{ "variable": "DATABASE_URL", "problem": "missing" }] }
```

| Readiness says | Fix on the CRM project |
|---|---|
| `DATABASE_URL` missing/invalid | Set the database connection string. |
| `JWT_SECRET` missing/too_short | Set a random value of 32+ characters. |
| `API_URL` unreachable | Delete `API_URL` (production runs the API inside the CRM). |
| `"database": "down"` | The connection string is wrong, or the database is paused or unreachable. |

Redeploy after changing variables. While any of these is wrong, sign-in and
"forgot password" show «Η υπηρεσία δεν είναι προσωρινά διαθέσιμη» and answer
503, and the function log says which variable to fix.

`CRM_URL` (the origin used in reset/invitation links and the CSRF check)
defaults to the CRM deployment's own production address on Vercel
(`VERCEL_PROJECT_PRODUCTION_URL`); set it explicitly once a custom domain is used.

Every table in `public` has row-level security on with no policies and no
grants for Supabase's `anon`/`authenticated` roles (migration
`20261004000000_lock_public_api`), so the Supabase REST API exposes no CRM
data. Prisma connects as the table owner and is unaffected. A migration that
adds a table must enable RLS on it too.

To send reset/invitation emails with Gmail: `SMTP_HOST=smtp.gmail.com`,
`SMTP_PORT=465`, `SMTP_USER` = the Gmail address, `SMTP_PASSWORD` = a Google
**app password** (Google Account → Security → 2-Step Verification → App
passwords), `SMTP_FROM_EMAIL` = the same address.

Without `SMTP_HOST` the API runs in log-only mail mode: "forgot password"
succeeds, but no email (and no link) is delivered. Set your first password with
`npm run admin:create` and `ADMIN_PASSWORD` (see docs/authentication.md).

## Region and database connections

Both projects run their functions in London (`"regions": ["lhr1"]` in each
`vercel.json`), next to the Supabase database in `eu-west-2`. A function far
from its database pays a transatlantic round trip on every query, which makes
the dashboard (dozens of small counts) slow enough to time out.

For Supabase's transaction pooler (`*.pooler.supabase.com:6543`) the apps add
`pgbouncer=true`, raise `connection_limit` to at least 5 and set
`pool_timeout=30` when absent (`serverlessDatabaseUrl` in
`packages/database`). Other database URLs are used unchanged.

## Limits to know

- **Rate limits** for login and password reset are kept in memory per running
  instance. On Vercel, instances come and go, so the limits are weaker than on
  one long-lived server. A shared store (e.g. Redis) is the upgrade path.
- **Database connections:** each instance opens its own Prisma connection
  pool. Use Supabase's pooled connection string (port 6543, `?pgbouncer=true`)
  for `DATABASE_URL` in both projects, and the direct one for running migrations.
