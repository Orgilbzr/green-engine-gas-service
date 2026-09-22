# Note history — local implementation, not deployed

## Schema audit and proposal

`pre_bookings.note` is a single legacy string, with no author or note-specific timestamp. `bookings` has no general note field. `advance_note` is payment metadata; `service_visits.note` belongs to service visits and is editable. Neither is reused or changed.

Final manual migration: `drizzle/0014_booking_notes.sql` (not executed on production).

`booking_notes` has `id`, exactly one of `booking_id` / `pre_booking_id` (foreign keys), `note`, `created_at` (`timestamptz`), `created_by` (immutable `{id,name,role}` snapshot), and `legacy`. The built-in admin has no `app_users` row, so its snapshot has `id:null`; names survive account changes. Public initial requests are explicitly labelled as customer web submissions, not attributed to a staff member. `updated_at` is unnecessary: there is no update/delete API, the runtime role has only SELECT/INSERT, and a database trigger rejects UPDATE/DELETE and a statement trigger rejects TRUNCATE.

The migration imports nonempty legacy preorder notes without changing the original field. Their exact author and writing time cannot be recovered: UI explicitly marks both unknown; `created_at` is import time for these flagged records. No fabricated writing timestamp. New notes always get a server/database timestamp and authenticated author snapshot. Existing text longer than 2000 characters makes migration fail transactionally rather than truncating history.

FK deletion is RESTRICT. Booking deletion with direct or inherited notes returns 409 with a cancellation explanation; UI displays it. No history is silently deleted.

## Conversion

Existing conversion keeps the preorder and atomically writes `converted_booking_id`. Notes remain attached to their original preorder. Booking history reads direct booking notes plus notes from linked preorders; no copy, update, or timestamp reset occurs. Preorder history also includes direct notes added to its converted booking. Later additions via either reference remain visible. A row lock during conversion prevents concurrent requests from replacing the link with two different bookings. The response immediately includes the inherited note count/preview.

## API, permissions, audit

GET/POST `/api/bookings/[id]/notes` and `/api/preorders/[id]/notes` use the existing session/role model, origin protection and input validation. Admin/operator may append. Mechanics may only GET booking notes; they retain their existing lack of preorder access. Unknown IDs return 404, bad IDs/text return 400, unauthorized operations return 403. Max length is 2000 characters. Client-supplied author/time are ignored.

Note insertion and `booking.note.added` / `preorder.note.added` audit entries share one transaction. Audit includes actor, entity reference, note ID, and note timestamp; the immutable note stores the text. An audit failure rolls back the insertion. Public and internal initial preorder notes use the same append storage in the creation transaction.

List endpoints return a count and newest preview using one aggregate query, not a request per row. Booking financial/service calculations and filters are unchanged. History uses `created_at DESC, id DESC`; date rendering explicitly uses `Asia/Ulaanbaatar`, e.g. `2026.09.22 · 11:45`. Native modal dialog provides focus containment, Escape, and focus restoration. Submission is guarded against repeated clicks, with loading/error/retry states and bounded network waits.

## Verification

- TypeScript: `npx tsc --noEmit` passed.
- ESLint on new note implementation/schema/test files: passed. Whole-repository lint retains 10 existing errors (13 warnings); no unrelated cleanup performed.
- 90 relevant tests passed across note history, preorder workflow, service regression/process, booking filters/progress, validation, origin, security and rate limit suites.
- PGlite tests execute migrations only in isolated in-memory databases: legacy import, zero/one/multiple notes, author/time, ordering/ties, initial internal/public notes, actual conversion route, post-conversion additions, mechanic/anonymous/origin restrictions, audit rollback, append-only trigger and restricted DB privileges.
- Browser checks use the actual React dashboard/components and CSS bundled locally with synthetic HTTP fixtures, not production data. Desktop 1440px and mobile 375px: empty/one/multiple notes, append and preview count update, preorder history, mechanic read-only, long unbroken text. Mobile document width 375px; dialog client/scroll widths both 335px. No browser JS errors.
- Screenshots: `outputs/note-history/desktop-list.png`, `desktop-history.png`, `mobile-history.png`, `mobile-added-note.png`, `mobile-empty.png`, `mobile-preorder.png`, `mobile-mechanic.png`.

## Rollout boundary

The implementation is approved for a local commit only. No push, deployment, or production migration was performed. Code requires 0014 before activation. A later approved rollout should back up and inspect the target database, check legacy note lengths, and coordinate a brief write pause during migration plus deployment (old code still writes the legacy string, so an uncoordinated migration/deploy gap could miss those notes). Verify migrated counts and conversion-linked history before resuming writes. Migration follows the repository's manually reviewed SQL convention; the older Drizzle journal is not used to run it automatically.

## Changed files

- UI: `app/NoteHistory.tsx`, `app/note-history.ts`, `app/page.tsx`, `app/globals.css`.
- Persistence/API: `db/schema.ts`, `db/notes.ts`, `app/note-routes.ts`, both new `[id]/notes/route.ts` handlers; booking list/deletion, preorder creation/list/update/conversion handlers.
- Migration: `drizzle/0014_booking_notes.sql`.
- Tests: `tests/note-history.test.mjs`; preorder workflow, service regression, security audit, and rate limit harnesses updated for the new note dependency/storage.


## Final pre-release audit (manual migration package)

- Final SQL: `drizzle/0014_booking_notes.sql`; read-only scripts: `docs/sql/0014_booking_notes_preflight.sql` and `docs/sql/0014_booking_notes_verification.sql`.
- One atomic transaction with `SET LOCAL lock_timeout = '10s'`, `statement_timeout = '60s'`, explicit public schema, an owner check, and fail-closed detection of an existing/partial installation. Successful migration runs ONCE; verification, not rerunning, determines installed state. After an error, roll back the same session, investigate, and obtain a reviewed recovery plan.
- Existing bookings/preorders are never updated/deleted/truncated. Only new note records are inserted; a conversion lookup index is added. SHARE lock stabilizes the preorder snapshot during backfill. Source checksums/counts in the read-only scripts verify unchanged data during the external write pause.
- Both note-owner FKs use DELETE RESTRICT. Inherited preorder notes keep the preorder FK; booking deletion for those notes is blocked by the application's existing-history check, not by an additional conversion FK. No existing conversion FK/schema semantics are silently changed.
- UPDATE/DELETE and TRUNCATE triggers protect new history. Supabase/default grants on the NEW table, sequence and function are removed from PUBLIC/anon/authenticated and normalized for gas_app_runtime; only SELECT/INSERT and sequence USAGE are granted to that runtime. Its two command-specific RLS policies mirror the documented shared server-login architecture. No existing table ACL, role, ownership, or shared default privilege is changed. Elevated administrators remain capable of altering database protections.
- If gas_app_runtime is absent, existing table-owner runtime access works without an RLS policy. If the actual application uses another non-owner role, STOP and review grants/policies before migration. Live runtime identity/role memberships/default ACLs have NOT been queried here; preflight evidence is required. SQL Editor current_user is not proof of the app's runtime identity.
- Keep application writes paused from before migration through the later application deployment. This includes public preorder forms: old code continues to write the legacy note field until replaced. Do not let manual migration/deploy timing create uncaptured notes. No automatic data catch-up or migration rerun is proposed.
- Local final SQL validation: 5/5 `tests/note-migration-safety.test.mjs` cases passed (source preservation, catalog/read-only scripts, simulated broad default ACLs, runtime read/insert, mutation rejection, rerun rollback, oversized text rollback, unsafe inherited-grant rollback). Final migration also passed the 7/7 note-history integration tests including actual conversion and audit rollback. Earlier TypeScript/90-test PASS evidence is retained; application TypeScript was unchanged in this final audit.
- The 0013 SQL file is unchanged and is NOT part of the manual execution package.
