# Booking service process — 2026-09-19

> **Production migration status (user verified): 0013 was MANUALLY APPLIED successfully.** The user reports the visits table, three completion columns and visits index verification all TRUE. Do not rerun 0013 during deployment. The historical pre-migration gates below describe earlier checks; the user has now authorized code commit/push/deployment. No automatic migration command is configured in package.json.

## Implemented

Service progress is independent of the existing payment/cancellation `status`. Programming and installation can complete in either order; both together derive “Бүрэн дууссан”. Handover takes display priority. Existing bookings start with all three flags false; legacy “Дууссан” is not backfilled because existing payment collection also sets that status.

Changes:
- `db/schema.ts`, `drizzle/0013_service_process.sql`: additive schema.
- `app/service-process.ts`: shared progress states, labels and badge derivation.
- `app/api/bookings/[id]/process/route.ts`: dedicated authenticated GET/PATCH endpoint.
- `app/ServiceProcess.tsx`, `app/page.tsx`, `app/globals.css`: badges, detail dialog, visit history/editor and schedule integration.
- `tests/service-process.test.mjs`: PostgreSQL-backed integration and server-rendered UI tests.

## Database / rollout

For a new environment only, run **`drizzle/0013_service_process.sql` once before deploying the new application** using its authorized migration/admin connection. **Production: already manually applied; do not run again.** It adds nine columns (`programming_completed`, `installation_completed`, `handover_completed`, each with `_at` and `_by`) and `service_visits`. `_by` contains an immutable-at-completion user ID, display-name/email fallback and role snapshot. Reset clears the current completion metadata while the audit retains it.

`service_visits` records booking ID/number, arrival timestamp, purpose, branch, note, original recorder snapshot and creation timestamp. A booking deletion leaves its visit records with a null booking ID and preserved booking number. Explicit visit deletion records the old row in audit before committing the transaction.

The migration uses a transaction, safe false/null defaults and no destructive changes or historical backfill. It enables RLS on the new table. If the documented `gas_app_runtime` role exists, it grants SELECT/INSERT/UPDATE/DELETE on this table, USAGE on its sequence and a role-specific policy. No role is created; existing grants/policies are unchanged. If production uses a differently named non-owner runtime role, provision equivalent table/sequence grants and a role-specific RLS policy for that actual role before deployment. If `gas_app_runtime` is created later, include the new table in that role's provisioning.

Existing migrations 0008–0012 are manually managed and absent from the old Drizzle journal; this migration follows that convention without rewriting migration history. Do not run the stale journal blindly against production. Review the live column/table catalog and apply 0013 once with `ON_ERROR_STOP` through the normal migration process.

Rollback: redeploy the prior application and retain the additive fields/table and recorded history. Do not drop columns/table or reverse audit records. Old application inserts continue to receive defaults. No production SQL, data changes, deployment or push was performed here.

## API / permissions

- GET `/api/bookings/:id/process`: booking and visits, ordered by arrival time. Admin/operator/mechanic can read; mechanic financial fields use the existing redaction helper.
- PATCH the same URL: admin/operator only. The separate endpoint permits a narrowly scoped mechanic process permission later without granting financial/customer editing rights. Current mechanic permissions remain view-only.
- `{ action: "step", step: "programming" | "installation" | "handover", completed: boolean }` updates one milestone. Actor/time come from the server, never the client.
- Handover before both services finish, or reversing a service while handed over, returns 409 with `requiresConfirmation`. The UI warns; repeating with `confirmIncomplete: true` acknowledges the exception and records it in audit. No silent cascade resets other milestones.
- Visit actions: `visit.add`, `visit.edit` (with `visitId`) and `visit.delete` (with `visitId`). Add/edit require `date`, `time`, a known `purpose` and `branch`; note is limited to 500 characters. Visit dates/times use Mongolia UTC+08:00 and are stored as timestamptz. Editing preserves the original recorder; the editing actor appears in audit.
- Same-origin protection, strict IDs/enums/dates/times/booleans, booking-scoped visit lookup, booking row locks, no-op milestone handling, and atomic audit writes prevent unauthorized edits, lost milestone updates and unaudited changes.

## UI / audit

List and calendar show light-tint badges with wrapping Mongolian text. “Үйлчилгээний явц” opens a native dialog with keyboard focus handling, timestamps, actor/role and repeat visit history. The existing schedule editor also links to it. Admin/operator can edit; mechanics see disabled milestone controls and no visit mutation form. Existing booking date/time/branch remain the only schedule; a pending service purpose is inferred after one milestone completes. Arrival records do not change the scheduled slot or capacity rules.

Audit actions cover completion/reset of all three milestones and visit create/update/delete. Each includes booking number, plate, actor display name/role, old/new values and audit timestamp. Date snapshots are serialized to ISO before the shared sanitizer. New action labels are exposed in the existing audit view/filter.

## Validation

- TypeScript: passed.
- New files/schema targeted ESLint: passed. Existing `app/page.tsx` diagnostics were compared against HEAD and are unchanged. Full-repository lint still reports pre-existing errors.
- `npm run build -- --webpack`: passed. Default Turbopack build failed because the environment disallows its PostCSS worker port; an escalated retry had the same failure.
- All 8 new tests passed; full suite: 81 passed, 1 failed (legacy worker artifact below). New PostgreSQL/PGlite integration and UI tests cover migration/default preservation, restricted runtime role grants/RLS, both service sequences, handover warning/priority, actor snapshots, no-op updates, resets, repeated visits/edit/delete, timestamps in audit, authorization/origin protection, transaction rollback and deletion compatibility.
- Full-suite legacy `tests/rendered-html.test.mjs` requires missing `dist/server/index.js` (old worker output); unrelated to the Next.js build.
- In-app Browser was unavailable and the fallback browser CLI was not installed. Actual mobile screenshots and a live authenticated end-to-end test remain unverified; server-rendered component checks are not a substitute for these.

## Manual checks after staging migration/deploy

1. As operator, complete programming → installation → handover; repeat on another booking in reverse service order. Refresh and verify badge, name/role/time and history.
2. Confirm incomplete handover warns, cancellation leaves it unchanged, explicit acknowledgment works, and reversing a completed milestone retains the audit record.
3. Register two arrivals on different dates, edit/delete one and inspect all corresponding audit entries as admin.
4. As mechanic, view progress/history and confirm direct PATCH returns 403 and no financial fields appear.
5. At 320/375px and desktop widths, check long names/statuses, dialog scrolling, keyboard focus, mobile drawer and absence of horizontal overflow.
6. Recheck preorder conversion, duplicate plate protection, manufacture-year validation, product/price/payment, search, reschedule/capacity and cancellation using existing bookings.

## Final readiness audit — 2026-09-19

**Release gate: NOT READY. Local feature verification passed; production-matched staging verification remains outstanding.** No new feature or application behavior was added during this audit. Added only migration-safety and real-session regression tests plus this evidence/runbook. No production database migration, deployment or git push was run.

### Failed test: unrelated baseline artifact

`tests/rendered-html.test.mjs:7`, test `renders development preview metadata`, imports `dist/server/index.js` and raises `ERR_MODULE_NOT_FOUND` before loading any application module. This is the old Vite/vinext/Cloudflare worker output; the current `npm run build` invokes Next.js and emits `.next`. The test and package.json are unchanged against HEAD. Running the exact test from HEAD in `/tmp/service-readiness-baseline` reproduced the same missing-artifact failure. It is not a service-process regression and was not hidden/skipped or rewritten merely to make the suite green.

Current full suite: **88 tests, 87 passed, 1 failed**. The additional six tests cover migration integrity/rollback and real login/session/role integration with existing booking workflows. TypeScript and targeted application/schema lint passed. The last application build passed with `npm run build -- --webpack`; default Turbopack remains blocked by the local worker-port restriction. A successful default production build in the actual deployment environment is still required. Existing full-repository lint failures are unchanged.

### Migration safety findings

- The migration contains no DELETE, UPDATE of legacy columns, DROP or column rename. Legacy NULL manufacture years, completed/cancelled statuses and prices survive unchanged in the fixture. New progress columns default to false/null without deriving progress from payment status.
- All three booleans are NOT NULL with constant false defaults. Metadata columns are nullable. The new visits table is empty at creation, so its NOT NULL/check/FK constraints do not invalidate existing bookings. An old-style booking INSERT still succeeds after migration and receives the new defaults.
- `booking_id` is nullable and references the existing integer primary key; `ON DELETE SET NULL` retains visits and booking numbers when a booking is deleted. Invalid booking IDs are rejected; repeat arrivals for one booking are allowed. The PK and non-unique booking-ID index were verified.
- The entire migration is transactional. A deliberately induced late table-name collision rolled back earlier column additions after `ROLLBACK`; old data survived.
- **Not idempotent:** a second run raises SQLSTATE `42701` on `programming_completed` already existing. Stop at the first error, roll back the failed session, inspect the catalog; never run 0013 again blindly or add `IF NOT EXISTS` that could hide incompatible schema drift.
- `ALTER TABLE` requires a strong table lock. A constant default avoids a per-row rewrite on modern PostgreSQL, but does **not** make the migration lock-free. Use a short lock timeout, schedule a quiet period and stop if it times out. The new index covers only the initially empty visits table. [PostgreSQL ALTER TABLE documentation](https://www.postgresql.org/docs/17/sql-altertable.html).
- All table names are unqualified. Run with an explicit trusted `search_path=public,pg_catalog` against the intended database as its migration owner; verify the live schema before running.
- RLS is enabled on `service_visits`. Only an already-existing role named `gas_app_runtime` gets the conditional grants/policy. A different non-owner runtime role would have no access unless separately provisioned. Live runtime identity, RLS policy applicability and actual migration state have not been independently verified; this is a release gate, not a demonstrated local failure.

### Browser evidence and boundaries

Headless Chrome via agent-browser inspected the **actual Webpack-built Next.js UI**. A localhost-only fixture proxy connected the actual source API handlers, password/session/role helpers, validators, audit code and Drizzle queries to isolated PGlite seeded with migrations 0006–0013 and synthetic users/bookings. Rate limiting was stubbed; network PostgreSQL/TLS/pooling, Next.js route/cookie adapter integration and production runtime RLS were not reproduced by this fixture. It is stronger than mocked response screenshots, but is not a full deployment smoke test.

| Flow | Result |
| --- | --- |
| Operator login/logout | Passed with actual password/session code and browser cookies |
| A: base → programming → waiting installation → both complete → handover | Passed in desktop browser |
| B: base → installation → waiting programming → both complete → handover | Passed in mobile browser |
| Reverse handover | Passed; returned to fully complete and audited |
| Visit add → edit note/purpose → delete with confirmation | Passed; old/new audit payloads include timestamp, booking number, plate and actor |
| Booking list badge and detail dialog | Passed; list updates after mutation |
| Edit manufacture year and reschedule branch/day | Passed; process flags, booking number and payment data retained |
| Preorder → booking | Passed through UI with product/advance; generated booking number and base progress |
| Booking cancellation | Passed via browser-origin PATCH and independent real-session integration test; no new cancellation UI was introduced |
| Admin process update and audit page/expanded old/new | Passed |
| Mechanic view-only | Disabled milestone controls, no visit-edit form, redacted finances; direct process PATCH returned 403 |
| Mobile navigation drawer | Open/close passed |
| 375×812 and 320×740 layouts | Page scrollWidth equals viewport width; dialog content width equals its client width; long Mongolian badge wraps |
| Browser page exceptions/hydration errors | None observed |
| API responses | Successful observed feature requests 200/201; logout 303; intentional unauthorized mechanic PATCH 403; no observed feature 5xx |

Console exceptions are not claimed to be globally zero: unauthenticated initial `/api/me` produces expected 403 and the existing startup handler logs it as an error. Local Speed Insights script is unavailable and logs a warning. Neither comes from the new process flow. Screenshots are local temporary artifacts: `/tmp/service-readiness-mobile-waiting.png`, `/tmp/service-readiness-mobile-list.png`, `/tmp/service-readiness-desktop-list.png`, `/tmp/service-readiness-mobile-audit.png`.

### Required next steps (not executed)

1. Against the **actual runtime connection**, collect read-only identity/schema evidence using the SQL below. Against the migration owner connection, check migration 0013 is absent (or fully present with matching definitions), confirm a fresh verified backup and the exact previous deployment to roll back to. Do not print connection strings/passwords. If the runtime is not `gas_app_runtime` or an explicitly understood owner/BYPASSRLS role, adapt the new-table privileges/policy for the verified role before applying.
2. Use a production-matched disposable PostgreSQL staging database and the real Next.js API runtime to apply 0013 once, run the default deployment build, and repeat A/B, visit CRUD, role and existing-workflow checks. This closes the TLS/pooler/RLS/Next.js adapter gaps that PGlite cannot establish.
3. Review those results and authorize rollout separately. Order must be verified backup/catalog → additive migration → verify runtime access → application deployment → authenticated smoke test. Do not deploy the new schema-dependent app before migration. No production rollout is authorized or performed by this audit.

Read-only SQL (run as the actual runtime user, not a migration owner masquerading as runtime):

```sql
SELECT current_database(), current_user, session_user, current_setting('server_version');
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;
SELECT table_schema, table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND ((table_name = 'bookings' AND column_name LIKE '%completed%')
       OR table_name = 'service_visits')
ORDER BY table_name, ordinal_position;
SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'service_visits';
SELECT to_regclass('public.bookings'), to_regclass('public.service_visits');
```

Staging migration command template, with an already configured libpq service containing the **staging migration** connection and verified TLS settings (not executed):

```sh
psql 'service=gas_staging_migration' -X -v ON_ERROR_STOP=1 \
  -c "SET search_path=public,pg_catalog; SET lock_timeout='5s'; SET statement_timeout='60s';" \
  -f drizzle/0013_service_process.sql
npm run build
```

Use a direct/session migration connection, not a transaction-pooled connection for session-level SET assumptions. A lock timeout is a stop condition; inspect blockers and retry in a planned window, do not silently raise timeout and rerun.

### Exact non-destructive rollback

- **Before COMMIT / after a migration error in a still-open connection:** execute `ROLLBACK;` in that same session. If `psql -v ON_ERROR_STOP=1` exits with the transaction uncommitted, disconnect rolls it back. Verify catalog/data and resolve the cause before any retry. A new connection's ROLLBACK cannot undo an already committed migration.
- **After successful migration but before deployment:** leave the additive fields/table in place; keep the old application running. No rollback SQL is needed.
- **After application deployment:** restore the previously recorded, known-good application deployment using the hosting platform's rollback action. Keep all nine new columns, the visits table, its grants/policy and audit records. The old application remains compatible with those defaults. Verify login, list, booking creation, preorder conversion and reschedule on the restored deployment.
- Do **not** DROP the new table/columns, reset progress, restore an old database over newer production writes, or delete audit records. Destructive schema rollback is neither necessary nor authorized.

## Production read-only rollout gate — live environment check

Result: **BLOCKED**. No production SQL was sent: the runtime connection could not be obtained. No production write, migration, deployment, git commit or push was performed; no secret values were printed.

Verified live through the Vercel connector:
- Project `green-engine-gas-service` exists in the connected team.
- Deployment `dpl_3JhvsGZTMN8JdAKR71v5JCuYDw72` is READY, target production, and aliases include `gas.ecoauto.app`. Its source commit is `2475f842f7ab04cff5357d86ae05df268409315a` (encrypted backup workflow commit), not the uncommitted service-process work.
- That deployment and `dpl_DKtnzcwPPugq66vEjsMEN1UytyCZ` are marked `isRollbackCandidate: true`. This verifies rollback targets exist, not that a rollback was executed or a database restore was tested.

Access limitations:
- Process environment and `.env.local` contain no DATABASE_URL or database CA; no `.vercel/project.json` project link exists.
- The scoped local Vercel CLI credential was read in memory without printing it. A GET project request to the Vercel REST API returned HTTP 403. Consequently production environment values were not retrieved and the PostgreSQL connection was never opened.
- The connector's get_project operation failed due to its argument/schema mismatch (`idOrName` missing); the advertised get_deployment_build_logs operation returned tool-not-found. Therefore current dashboard build overrides could not be verified from that connector either.
- No Supabase management token/connector was available. Automatic backup status, actual plan, latest successful backup, PITR enabled state and recovery window remain UNVERIFIED. The repository backup workflow and earlier user-supplied backup evidence are not proof of a fresh successful backup today.

Unverified production DB facts: current_database/current_schema/search_path, actual runtime role, schema/table owner, runtime DDL authority, presence/definitions of bookings and service_visits, the nine 0013 columns, migration-history tables and 0013 registration. Source code reads DATABASE_URL with certificate verification and uses unqualified schema table names; neither the database nor effective schema can be established from the source alone. Do not infer migration absence from the old deployment's commit.

0013 conclusions remain conditional on live catalog verification: one explicit BEGIN/COMMIT transaction, no destructive DML, safe false defaults/nullable completion metadata for legacy rows, FK to bookings(id), nullable visit FK with SET NULL, initially empty new-table index. Duplicate columns/table/sequence/index, wrong search_path, inadequate ownership, lock contention or missing runtime RLS grants can still cause failure. The SQL file has no explicit lock_timeout/statement_timeout; choose bounded migration-session settings with the intended owner/direct or session connection. The application's own runtime connection config specifies 10s statement and lock timeouts, but it must not be presumed to be the migration connection. Migration-role separation is preferable to granting DDL to the runtime.

Production build verification: ran the repository's exact `npm run build` (`next build`, Next.js 16.3.0 Turbopack) with DATABASE_URL explicitly empty to prevent production DB access. Both sandboxed and escalated attempts failed at PostCSS worker process port binding with `Operation not permitted (os error 1)`. The observed failure is an execution-environment restriction, not evidence of a TypeScript/application compile error. This is not a successful production build; actual Vercel build-command overrides remain unknown. No Webpack workaround was used in this gate check.

Recovery:
- Failed/uncommitted migration: ROLLBACK in the same session or connection close; atomic DDL was previously demonstrated in isolated PostgreSQL tests. Cannot undo committed migration with ROLLBACK.
- Successful migration followed by bad application deployment: restore the verified previous production application deployment and retain all new fields/table/history. No DROP is needed. Vercel rollback does not restore database contents or automatically reverse environment-setting changes.
- Supabase backup/PITR availability depends on actual project configuration; verify it in the provider before authorizing migration. References: https://supabase.com/docs/guides/platform/backups and https://vercel.com/docs/instant-rollback.

Next gate: restore scoped production configuration/catalog read access (or run the provided catalog queries through an authorized runtime connection and share only sanitized results); verify current backup/recovery evidence; run the normal build in an unrestricted, deployment-matched environment. Only then reassess SAFE TO PROCEED.
