# Authentication

How HOME88 staff sign in to the CRM, and how the first administrator is set up.

## Where identities live

| Store | Used for | Notes |
|---|---|---|
| `users` table (Prisma, `apps/api`) | **CRM sign-in.** Email + password, sessions, roles | The only identity the CRM trusts. Passwords are scrypt hashes (`apps/api/src/lib/passwords.ts`). Sessions are opaque HttpOnly cookies whose SHA-256 is stored in `sessions`. |
| Supabase Auth (`auth.users`) | Not used by the CRM | If the person also has a Supabase Auth account (e.g. created in the Supabase dashboard), its user id can be recorded on the staff record as `users.authUid`. That link exists only to stop one person being mapped to two staff records; it grants nothing. |

There is no public registration. Staff accounts come from:

1. **The first administrator**, created once with `npm run admin:create` (below).
2. **Invitations** sent from the CRM (`/crm/invitations`) by an ADMIN or above. The invitee sets their own password when accepting.
3. **Direct creation** by an ADMIN (`/crm/users/new`), with an initial password that the user should change.

## Roles

`SUPER_ADMIN > ADMIN > MANAGER > AGENT > MARKETING > VIEWER`. Authorization is enforced only on the API (`apps/api/src/plugins/auth.ts`); the CRM UI hides what a role cannot do but is never the control. Nobody can assign themselves a role: role changes go through `PATCH /users/:id`, which requires ADMIN and forbids raising anyone to or above your own rank, and the bootstrap script, which needs database access.

## First administrator (HOME88)

The canonical first administrator is **home88estate@gmail.com** (Supabase Auth UID `63cd0c1b-7251-41a4-bdb5-e34154ad6fbd`). Do **not** create `admin@home88.gr` or any other administrator in production: the demo seed (`npm run db:seed`) refuses to run with `NODE_ENV=production` or on any database that already has a non-demo SUPER_ADMIN.

Run once, against the production database, from a trusted machine:

```bash
DATABASE_URL='postgresql://…' \
ADMIN_EMAIL=home88estate@gmail.com \
ADMIN_AUTH_UID=63cd0c1b-7251-41a4-bdb5-e34154ad6fbd \
npm run admin:create
```

What it does (`apps/api/scripts/create-admin.ts`, decisions in `apps/api/src/lib/admin-bootstrap.ts`):

- Looks the person up by `authUid`, then by email, and **reuses** a match. Re-running is a no-op.
- Creates the SUPER_ADMIN only if no SUPER_ADMIN exists (`--force` overrides). An existing lower-role account with that email is raised only with `--promote`.
- Refuses, changing nothing, if the UID is already linked to a different staff record or the email is linked to a different UID.
- Without `ADMIN_PASSWORD` the account is created **with no password**. A null password hash never authenticates (`verifyStoredPassword`), so the account is inert until its owner sets one.
- Writes an audit row (`ADMIN_BOOTSTRAP_CREATE` / `_PROMOTE` / `_LINK_UID` / `_SET_PASSWORD` / `_RESET_PASSWORD`). Never prints a password, hash or token.

Then the administrator sets their own password, in one of two ways:

**Without email (no SMTP needed).** The owner runs the command once more in their own terminal with a password they choose:

```bash
DATABASE_URL="postgresql://…" \
ADMIN_EMAIL=home88estate@gmail.com \
ADMIN_PASSWORD='a password you choose' \
npm run admin:create
```

It must meet the password policy, is stored only as a scrypt hash and is never printed. It is applied to an account with no password yet; an existing password is replaced only with `--reset-password`, which also signs out every session of the account. Clear the variable (and shell history) afterwards.

**By email.** Open `<CRM>/crm/forgot-password`, enter the email, open the emailed link (valid 60 minutes, single use) and choose a password. The API must have `SMTP_*` configured; with no `SMTP_HOST` it runs in log-only mode and the message is **not** delivered.

Then sign in at `https://real-estate-home88-iota.vercel.app/crm/login`.

## Password reset and change

- `POST /auth/forgot-password` always returns the same message, whether or not the email exists, and only ACTIVE accounts get a link. Only the token's SHA-256 is stored; requesting again retires the previous link.
- `POST /auth/reset-password` sets the password, burns every outstanding link and revokes all sessions.
- `POST /auth/password` (signed in) requires the current password. An account with no password yet must use the reset link instead.
- Login, forgot and reset are rate-limited per IP (and per email for login/forgot).

## First sign-in with the linked Supabase password

A staff account with **no CRM password yet** that is linked to a Supabase Auth
user (`authUid`) can sign in with that Supabase user's email and password:

- The API checks the password with Supabase Auth (password grant, publishable
  key) and accepts it only if Supabase returns exactly the linked `authUid`.
- On success the CRM stores its own scrypt hash of that password and writes
  `PASSWORD_ADOPTED_FROM_IDENTITY_PROVIDER` to the audit log; later sign-ins are
  checked locally. Accounts that already have a CRM password are never checked
  against Supabase.
- Configuration (CRM project): `SUPABASE_PUBLISHABLE_KEY` (or `SUPABASE_ANON_KEY`
  / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `NEXT_ANON_SB`). `SUPABASE_URL` is optional;
  it is derived from a Supabase `DATABASE_URL`.
