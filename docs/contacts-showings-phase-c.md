# Contacts workspace and Υποδείξεις (Phase C / Phase 1)

Single-agency HOME88 CRM. Nothing here is multi-tenant, and no Estate+ data is imported.

## What exists

| Area | Where |
| --- | --- |
| Contact list: filters, sorting, page size, bulk actions, CSV export | `/contacts` (`apps/crm/src/app/(app)/contacts`, `components/contacts/ContactsTable.tsx`) |
| Contact 360 (tabs) | `/contacts/[id]?tab=…` — Στοιχεία, Ακίνητα, Ζητήσεις, Υποδείξεις, Υπενθυμίσεις, Ιστορικό, Εντολές, Έγγραφα |
| New / edit contact (duplicate review) | `/contacts/new`, `/contacts/[id]/edit` |
| Υποδείξεις (global list, new, detail, edit) | `/showings`, `/showings/new`, `/showings/[id]`, `/showings/[id]/edit` |
| Εντολή Υπόδειξης preview, issue, PDF | `/showings/[id]#document` — uses the existing document pipeline and approved template system |

Κλήσεις and Συσχετίσεις are in the tab registry (`CONTACT_TABS` in `apps/crm/src/lib/contacts.ts`) with `ready: false`, so they are not rendered until a module exists.

## Data model (migration `20261017000000_contact_workspace`, additive only)

- `contacts`: `status` (ACTIVE/INACTIVE), `assignedToId` (Διαχειριστής), `lastActivityAt`, `city`, `postalCode`, `workPhoneEncrypted`.
- `tasks` (the existing reminders): `contactId`, `showingId`. No second reminder system.
- `showings`: `visitAt` (date and time of the showing). A showing is the legal document; the appointment (`viewings`) stays a separate record.
- `contact_properties`: how a contact relates to a property as BUYER / TENANT / INTERESTED. Owners and co-owners stay in `property_owners`, so ownership is never stored twice. RLS on, API roles revoked.
- `lastActivityAt` is set when something happens with the contact: created or edited, showing created / edited / issued, reminder created, property linked, bulk change.

## API

- `GET /api/contacts` — filters: `q` (name, company, reference, whole email or phone through the hash), `role`, `assignedToId` (or `none`), `status`, `email`, `phone`, `createdFrom/To`, `activeFrom/To`, `inactiveDays`; `sort`, `dir`, `page`, `limit` ≤ 100.
- `GET /api/contacts/export` — same filters, `ids=` for a selection, `sensitive=1` adds ΑΦΜ and address. Permissions `contacts.export` and (for identity data) `contacts.export_sensitive`. Semicolon CSV with BOM, formulas neutralised, ≤ 5000 rows. The audit row holds the filter and count, never values.
- `POST /api/contacts/bulk` — assign, status, marketing / SMS consent. Permissions `contacts.bulk_assign`, `contacts.bulk_update`. One audit row per contact.
- `POST /api/contacts` — 409 `potential_duplicate` when the email or phone hash matches; a person confirms with `confirmDuplicate`. Contacts are never merged automatically.
- `GET/POST/DELETE /api/contacts/:id/properties`, `GET /api/contacts/:id/{requests,showings,reminders,mandates,documents,timeline}`.
- `GET /api/showings/:id/preview` — what the document would say if issued now; nothing is stored or numbered.
- `GET /api/users/directory` — names of active users, for choosing a Διαχειριστής.

Default grants: managers hold export and bulk permissions; administrators also hold sensitive export; agents hold neither. Roles can be changed in Settings → Δικαιώματα.

## Legal text

The wording of an Εντολή Υπόδειξης only ever comes from the approved ACTIVE template (Ρυθμίσεις → Ψηφιακές Εντολές). Until counsel approves and activates one, the document page says so and issuing is blocked. The legacy Estate+ wording stays reference-only in `packages/domain/src/legacy-templates.ts`.

Showings are never hard-deleted: an issued legal document is immutable and its history is append-only. "Delete" is a cancellation with a recorded reason (`showings.cancel`, managers).

## Prepared for the later Estate+ import (not started)

Upload → Parse → Validate → Duplicate detection → Dry run → Report → Approval → Import → Verification. The identity hashes (`emailHash`, `phoneHash`) and the reference columns give the duplicate keys (email, mobile, phone, name + surname, property code, external source id). Duplicates become "potential duplicate" records for review; no automatic merge. Production import needs manager / Super Admin approval with approver, batch, checksums, counts, conflicts, mapping version, timestamps and result recorded.
