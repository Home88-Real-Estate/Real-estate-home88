# Deployment

Three deployables, one database:

| App | What it is | Where it can run |
|---|---|---|
| `apps/web` | Public website (Next.js) | Vercel — today `https://realestate-home-88.vercel.app` |
| `apps/crm` | Staff CRM (Next.js, served under `/crm`) | Vercel, as its own project |
| `apps/api` | API (Fastify, long-running Node server) the CRM calls | Any host that keeps a Node process running (Render, Railway, Fly.io, a VPS). Not a static/serverless deploy as-is. |

All three use the same PostgreSQL database (Supabase). Only the API writes CRM data.

## The CRM on the website's own address (recommended)

The website passes everything under `/crm` through to the CRM deployment, so
staff sign in at `https://<website>/crm/login`. No extra domain or DNS record
is needed, and the footer's "Σύνδεση συνεργατών" link points there automatically.

```
browser ──► realestate-home-88.vercel.app/crm/login
                 │  (rewrite, apps/web/next.config.mjs)
                 ▼
            <crm project>.vercel.app/crm/login ──► API (API_URL) ──► Postgres
```

### 1. API

Deploy `apps/api` (`npm ci` at the repo root, then `npm run db:deploy -w @home88/database` once per release, then `npm start -w @home88/api`). Environment:

| Variable | Value |
|---|---|
| `DATABASE_URL` | HOME88 Supabase connection string (server secret) |
| `NODE_ENV` | `production` |
| `CRM_URL` | The website origin, e.g. `https://realestate-home-88.vercel.app` (password-reset links are built from it) |
| `SITE_URL` | The website origin |
| `CRM_BASE_PATH` | `/crm` |
| `SMTP_*` | Mail server, so password links are delivered |
| `PII_HASH_PEPPER`, `PII_ENCRYPTION_KEY` | Same values as the website |

Then create the first administrator (see `docs/authentication.md`).

### 2. CRM (new Vercel project)

Import the same GitHub repository as a **new** Vercel project:

- Root directory: `apps/crm`
- Framework: Next.js (install/build commands: defaults)
- Environment variables:
  - `API_URL` = the API's URL from step 1 (server-only)
  - `CRM_PUBLIC_ORIGINS` = `https://realestate-home-88.vercel.app` (add any custom domain later, comma-separated). Without it, forms that use server actions are rejected when reached through the website.
  - `NEXT_PUBLIC_CRM_BASE_PATH` = `/crm`

Note its production URL, e.g. `https://home88-crm.vercel.app`.

### 3. Website (existing Vercel project)

- Add `CRM_ORIGIN` = the CRM production URL from step 2.
- Remove `NEXT_PUBLIC_CRM_URL` (it currently points at `crm.home88.estate`, which has no DNS record). `CRM_ORIGIN` takes precedence anyway.
- Redeploy. `CRM_ORIGIN` is read at build time, so a redeploy is required.

Check: `https://realestate-home-88.vercel.app/crm/login` shows the HOME88 sign-in page.

## Alternative: a CRM subdomain

To use `crm.home88.estate` instead, add that domain to the CRM Vercel project,
create the DNS record Vercel asks for (a CNAME for `crm`) wherever
`home88.estate` DNS is managed, set `NEXT_PUBLIC_CRM_URL=https://crm.home88.estate`
on the website and leave `CRM_ORIGIN` unset. Set the API's `CRM_URL` to the
subdomain too.
