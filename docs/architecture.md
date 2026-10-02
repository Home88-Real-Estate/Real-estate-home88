# HOME88 platform architecture

This describes the system as it is, the decisions that shape where it goes, and
the order the HOME88 CRM is built in. It is the foundation the CRM brief asked
for before larger features land. Anything listed under "Planned" does not
exist yet; the CRM must say so (“Σύντομα”) rather than pretend.

## 1. Shape of the system

```
 apps/web  (public site, Next.js)        apps/crm  (staff CRM, Next.js, /crm)
     │ reads published listings              │ server components + server actions
     │ writes enquiries (capture.ts)         │ forward the session cookie
     ▼                                       ▼
 PostgreSQL ◄──────────── apps/api  (Fastify, the only CRM writer; in production it
     ▲                         │        runs inside the CRM deployment, docs/deployment.md)
     │                         ├── packages/domain      business rules (pure)
 object storage (S3/MinIO)     ├── packages/validation  Zod schemas, shared client/server
     photos, documents         ├── packages/portals     portal adapters + feeds
                               ├── packages/valuation   comparable-based estimates
                               └── packages/database    Prisma schema + migrations
```

- **Modular monolith.** One API, one database, domain boundaries inside it. No
  microservices; media processing, portal publishing, notifications and AI can
  be extracted later along the same boundaries if load ever requires it.
- **The CRM database is the single source of truth.** The website has no
  property store of its own; it reads the same tables. Publication is a channel
  (`publishedOnWebsite`, `PortalListing`), not a copy.
- **The CRM holds no database credentials.** Its server talks to `apps/api`
  with the user's session cookie; every authorization decision is made there.
- **Business rules live once, in `packages/domain`.** Status transitions,
  which statuses are public, and who may do what are imported by the API, the
  CRM, the website and the portal package instead of being re-typed in each.

### Website ↔ CRM synchronisation

There is nothing to synchronise: the website renders straight from the CRM
tables, so an edit is live on the next render. It reads only through
`apps/web/src/lib/db.ts` (`safeQuery`, degrades instead of 500s) and filters
with the shared public-status list. Enquiries enter through a single path
(`apps/web/src/lib/capture.ts`: age gate, consent ledger, encrypted PII) and
appear in the CRM as `Lead` rows linked to the property.

Planned: move the website's reads behind a read-only public API/DTO layer
(`GET /public/properties…`) so the website never sees internal columns even
by accident, and the same contract can feed the mobile app.

## 2. Identity and permissions

See `docs/authentication.md`. Roles are ranked
`SUPER_ADMIN > ADMIN > MANAGER > AGENT > MARKETING > VIEWER`
(brief names: Agency Admin = ADMIN, Assistant = MARKETING, Read-only = VIEWER).

Authorization is permission-based (`packages/domain/src/permissions.ts`):
`can(user, "property:update", property)` answers **who, which action, which
object**. Roles map to permissions in one table; resource scoping is part of
the check (an AGENT may change a property they are assigned to or created;
MANAGER and above may change any). Routes call `authorize(...)` rather than
comparing role names.

## 3. Property lifecycle

Status is a server-side state machine (`packages/domain/src/property-lifecycle.ts`).
Clients request a transition; the API decides.

```
DRAFT ──► ACTIVE ◄──► UNDER_OFFER ◄──► RESERVED
            │  ▲            │               │
            ▼  │            ▼               ▼
         INACTIVE        SOLD / RENTED  ◄───┘        any ──► ARCHIVED (ADMIN)
         (withdrawn)     (reopen: MANAGER)           ARCHIVED ──► DRAFT (MANAGER)
```

- `SOLD` is only reachable for sale/assignment listings, `RENTED` only for rentals.
- Public statuses (website + portals): `ACTIVE`, `UNDER_OFFER`, `RESERVED`.
- Every transition writes a `PropertyStatusHistory` row and an audit entry, in
  one transaction. Every price change writes a `PropertyPriceHistory` row.
- Readiness (“ready to publish”, legal file complete) is **computed** from
  checklists, not stored as extra statuses, so it cannot drift from the data.

## 4. Data model: what exists and what is planned

| Area | Exists (table) | Planned |
|---|---|---|
| Staff & access | `users`, `sessions`, `password_reset_tokens`, `invitations` | teams, MFA |
| People | `contacts` (roles[], encrypted PII, consent hooks) | contact relationships (owns/co-owns %, interested-in), duplicate detection |
| Properties | `properties`, `property_media`, `documents`, `notes` | status & price history (Phase 1, now), configurable categories/subcategories, relational amenities, multilingual content, SEO fields, location visibility mode |
| Pipeline | `leads`, `viewings`, `offers`, `tasks` | demands/requests + matching engine, viewing feedback, lead pipeline stages, reminders with repeat |
| Publishing | `portals`, `portal_listings`, `portal_sync_logs`, `portal_property_mappings` | publication checklist, advertisements/campaigns |
| Compliance & privacy | `consent_records`, `email_suppressions`, `data_requests`, `dmca_notices`, `audit_logs` | mandates (versioned, signed copies immutable), document requirements & reviews, rule engine with legal source register |
| Comms | `email_logs` | SMS campaigns (consent-gated), in-app notifications |

## 5. API conventions

- Fastify routes under `apps/api/src/routes/<domain>.ts`; input validated with
  the shared Zod schemas; errors are `{ error: { code, message } }` and never
  raw database errors (`lib/errors.ts`).
- Multi-record writes run in one transaction with their audit row.
- Responses are built from explicit `select`s, never whole ORM rows.

## 6. CRM navigation

Current: Dashboard, Properties, Leads, Contacts, Users, Invitations, Security.
Target sidebar (Greek first, strings in `@home88/types` label maps):
Αρχική · Ακίνητα · Ζητήσεις · Πελάτες · Ψηφιακές Εντολές · Υπενθυμίσεις ·
Ημερολόγιο · Διαφημίσεις · Στατιστικά · Μαζικό SMS · Ιστότοπος, then
Διαχειριστές · Ομάδες · Ρυθμίσεις · Συνδέσεις. A module appears in the sidebar
when it works; until then it is listed as “Σύντομα”, never as a fake screen.

## 7. Build order

Database → CRM → website → leads → reporting → automation → AI.

| Phase | Scope | State |
|---|---|---|
| 0 | Auth, staff, properties CRUD, media, leads, contacts, portals feeds, public site | Done (pre-existing) |
| 1 | First-admin bootstrap; permissions in one place; property state machine with status and price history; property timeline in the CRM | **In progress** |
| 2 | Contact relationships (multi-owner), demands/requests, matching engine with explanations, viewings + feedback, reminders, lead pipeline board | Planned |
| 3 | Quick capture (mobile-first draft), categories/amenities configuration, publication checklist, SEO + multilingual content, documents center | Planned |
| 4 | Mandates, compliance rule engine + legal sources, statistics/exports, calendar, notifications, SMS | Planned |
| 5 | Offline PWA (IndexedDB + sync queue + idempotency + conflicts), owner portal, HOME 88 AI (advisory, sourced) | Planned |
