# Showings & mandates — Phase B: documents

Phase B turns the Phase A data model into issued, verifiable documents: six
variants (showing, simple assignment, exclusive assignment × Greek, English),
extension addenda, private PDF storage, signing and an audit trail. No UI,
reporting, reminders or Estate+ import (later phases).

## Issuing

`issueDocument(client, kind, id, ctx)` (`apps/api/src/lib/brokerage/documents/issue.ts`)
runs one transaction: lock the row → return the existing document if already
issued (idempotent) → record a fee-anomaly acknowledgement → validate with the
Phase A validators → resolve the approved ACTIVE template and verify its
checksum → allocate the number → build the snapshot → render the clauses and
the text (checksummed) → render the PDF (checksummed) → stage it privately →
commit ISSUED and the append-only audit events. Any failure rolls back: the
document stays a draft with no number (the counter is returned) and no final
PDF; the staged object is removed.

After the commit the PDF is written to its final immutable key, read back and
verified, and the document is marked `CONFIRMED`. If that move fails the
document is `STORAGE_PENDING`: it cannot be downloaded, sent or signed until
`recoverPendingStorage` re-creates the identical PDF from the snapshot (PDFs
are deterministic) and confirms it.

## Templates

Selection is deterministic: document kind + language + the ACTIVE version. A
version is used only if it is ACTIVE, not `ESTATE_PLUS_LEGACY`, its checksum
matches its body, counsel's approval is recorded against that exact checksum,
and its wording passes the content checks (no clauses of the other kind, no
unresolved alternatives or blanks). There is no fallback language or kind.
Legal wording lives only in template versions; the code supplies structure and
labels.

Governance (Settings → templates): create draft (`templates.create_draft`) →
submit for review → **approve** (`templates.approve_legal_version` *and* the
user flag `legalApprover`, which only a Super Admin sets) → activate
(`templates.activate`). Editing an approved draft voids the approval.

## Storage keys

`private/documents/{showings|mandates}/{id}/issued/…` and
`…/mandates/{id}/extensions/…`; ASCII, never overwritten; a changed text maps
to a different key. Downloads are short-lived signed URLs minted after the
permission check, and audited.

## API

Showings: `POST/GET /api/showings`, `GET/PATCH /:id`, `POST /:id/validate|issue|send|signed-copy|cancel|replace`, `GET /:id/pdf|events`.
Mandates: `POST /api/mandates/:id/validate|issue|send|signed-copy|cancel|replace|extensions|conflict-override`, `GET /:id/pdf|events`.
Extensions: `POST /api/mandate-extensions/:id/issue|send|signed-copy|cancel`, `GET /:id/pdf`.
Public: `GET /api/verify/:code` (rate limited; number, type, status, issue date and a checksum prefix only).

Agents prepare drafts; managers issue, send, cancel, replace, extend and
override conflicts; admins draft and activate templates; SUPER_ADMIN is system
administration only. All grants are in the existing permission matrix and can
be overridden per role.

## Signing

The provider receives the exact issued PDF and its checksum, at the level
configured in Settings (never upgraded). Paper signing stores the signed copy
as a separate private artifact with its own checksum, level `SIMPLE`, the
signer's date, uploader and timestamp; the original PDF is never overwritten.

## Known limitations

- No QR code (no QR library in the repo): the PDF footer prints a 12-character
  verification code that `GET /api/verify/:code` resolves.
- No provider adapter is added; the existing provider interface is reused.
- Legacy `VIEWING` mandates keep their previous issue path.
- Existing SIMPLE/EXCLUSIVE mandates must now carry the structured Phase A
  fields and an approved template to be issued (deliberately stricter).
- The API test suite now runs with `--test-concurrency=1`: several suites share
  singleton settings rows (company details, templates).
