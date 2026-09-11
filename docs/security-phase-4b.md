# Security hardening Phase 4B

## Outcome and evidence boundary

Repository review completed on 2026-09-07; updated on 2026-09-10 with user-supplied **verified production catalog and connection findings** below. **Runtime postgres usage and RLS bypass are VERIFIED HIGH severity.** Other production verification remains incomplete. The process has no `DATABASE_URL`, `.env.local` has no database connection key, the checkout has no Vercel project link, and available connectors expose no Supabase database/backup management access. No credentials were printed. Production access or sanitized inspection results are needed to close the live findings below; lack of access is not evidence of a secure configuration or an absent backup.

The original Phase 4B work was documentation only. The subsequent **Phase 4B-TLS** update changes only the runtime TLS option in `db/index.ts`, adds focused tests, and updates this report. Authentication, sessions, rate limits, pool/timeouts, migrations, production data and privileges are unchanged. No production SQL, dump, restore, deployment or push was performed. All SQL and deployment/backup commands below remain **runbook proposals, not executed**. Migration 0011 is already applied according to the user and must not be edited or rerun.

Evidence: `db/index.ts`, `db/schema.ts`, `drizzle.config.ts`, migrations 0006–0012, application API handlers, `app/email-auth.ts`, `app/audit.ts`, `app/reports/query.ts`, and installed postgres.js 3.4.9 source. Source review establishes required behavior, not the deployed revision or live database state.

## Current verified status — final runtime-role planning

The latest user-supplied production evidence supersedes earlier TLS/backup uncertainty in the historical phase notes: **TLS with DATABASE_SSL_CA and rejectUnauthorized:true is deployed and verified**, and a **verified production pg_dump exists with successful pg_restore --list validation**. No credentials, archive locations or passwords are recorded here. No production checks were independently executed during this final documentation update.

The production runtime still uses `postgres.<project-ref>` through shared transaction pooling on 6543. All six tables remain postgres-owned, RLS enabled, FORCE RLS false, and without policies. The **HIGH runtime least-privilege finding remains open** until the new login is verified in deployed runtime connections. A readable archive TOC is not a successful restore drill: data restoration, off-site durability, backup recency/retention and achieved RPO/RTO remain unverified unless separately evidenced. The project remains Free per the supplied facts.

## Findings

| Severity | Evidence status | Finding / required action |
| --- | --- | --- |
| RESOLVED | VERIFIED production evidence supplied by user | Explicit certificate-verified TLS with DATABASE_SSL_CA is deployed. Preserve these settings during the role-only cutover. |
| INFORMATIONAL | Verified driver behavior | ssl:require disables certificate verification in this driver. Production now uses rejectUnauthorized:true; do not downgrade it during rollout or rollback. |
| HIGH | VERIFIED production evidence supplied by user | Next.js uses the postgres transaction-pooler login. postgres owns all six application tables and has BYPASSRLS; runtime bypasses RLS and has owner privileges beyond application DML. Separate runtime from migration/admin credentials. |
| HIGH | Unverified | Free plan confirmed; production pg_dump and TOC validation now verified. A complete disposable restore drill, off-site retention and recovery window remain unverified. |
| HIGH | Verified excessive grants; exploit reachability unverified | Previously observed TRUNCATE/TRIGGER/REFERENCES grants to anon, authenticated and service_role exceed application needs. RLS does not protect TRUNCATE/REFERENCES. These ACLs do not themselves prove ordinary row access or an exposed API operation. |
| HIGH | VERIFIED production design constraint | All six tables have RLS enabled, FORCE RLS false and zero policies. A new NOBYPASSRLS non-owner role needs both DML grants and matching policies on every table; grants alone leave default-deny RLS in effect. |
| MEDIUM | Unverified | PUBLIC schema CREATE, object/default ACLs and callable security-definer functions may broaden runtime or API privileges. Collect catalogs before revocation. |
| MEDIUM | Unverified | 0012 historical execution is uncertain. Inspect both function bodies and trigger bindings before any repair. |
| LOW | Verified in source | generate_booking_no() has no function-local search_path. Its body uses built-ins and NEW fields; pinning search_path is future defense in depth after checking name resolution. |
| INFORMATIONAL | Verified in source | prepare:false and max:1, idle_timeout:1, connect_timeout:10 remain intact. Runtime needs DML, not DDL. |
| CRITICAL | None verified | No critical condition established by this review; missing live evidence prevents a clean production attestation. |

TLS is now verified deployed. The final runtime-role rollout below remains documentation only; no SQL, Vercel update, redeployment or push is executed in this phase.

## Verified production evidence and interpretation

The user supplied these verified findings on 2026-09-10; they were not independently re-queried during this documentation update:

| Table | Owner | RLS enabled | FORCE RLS | Policies |
| --- | --- | --- | --- | --- |
| app_users | postgres | true | false | 0 |
| audit_logs | postgres | true | false | 0 |
| bookings | postgres | true | false | 0 |
| login_sessions | postgres | true | false | 0 |
| pre_bookings | postgres | true | false | 0 |
| products | postgres | true | false | 0 |

| Role | BYPASSRLS |
| --- | --- |
| anon | false |
| authenticated | false |
| service_role | true |
| postgres | true |

Production Supabase Transaction Pooler username: `postgres.<project-ref>`. Combined with the verified role attributes and ownership, this establishes that the production Next.js runtime uses `postgres` and bypasses RLS. This is a **VERIFIED HIGH-severity least-privilege finding**, not a conditional concern. FORCE RLS would not constrain a BYPASSRLS role. The project reference and credentials are intentionally omitted.

With no applicable policies, ordinary SELECT/INSERT/UPDATE/DELETE through the non-owner, non-bypass `anon` and `authenticated` roles is default-denied by RLS despite table DML grants. SELECT generally returns no rows; writes can affect no rows or fail policy checks. `service_role` bypasses RLS, so its existing DML grants can permit row access. Absence of policies does not deny that role. [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html).

The previously observed `TRUNCATE`, `TRIGGER` and `REFERENCES` grants to all three API roles are **excessive privileges**, distinct from evidence of row access. TRUNCATE can remove all rows and is outside RLS; REFERENCES is also outside RLS and supports foreign-key creation where other required privileges exist. TRIGGER permits trigger creation subject to function EXECUTE and other requirements; it is not itself a SELECT or DML policy. Actual exploitability through the Data API, an RPC, SQL credentials or role switching requires separate reachability review. Do not claim anonymous row disclosure or a public TRUNCATE endpoint from these grants alone.

## Phase 4B-TLS: historical implementation and verification notes

**Status update:** the latest user evidence confirms this TLS implementation is deployed and verified. References to unverified production TLS in this historical section describe the earlier phase; preserve the verified CA and verification options for the role cutover.

On the repeated TLS-only request, the working tree was re-inspected: the four-line TLS change and focused tests from the earlier TLS phase are already present. The original lack of explicit TLS describes the pre-change source, not the current working tree. No additional runtime code change is needed; production deployment and certificate compatibility remain unverified. The backup plan and runtime-role proposal remain separate from this TLS implementation.

### Current verified / unverified status

- **Verified source before this change:** the only runtime constructor is `postgres(databaseUrl, options)` in `db/index.ts:createDbBundle()`, consumed by both initial creation and client recycling. It reads server-side `process.env.DATABASE_URL`; missing URL fails before client creation. Previously the options contained no `ssl` property. All existing prepared-statement, pool, connection and SQL timeout options are retained verbatim.
- **Verified installed driver:** Postgres.js **3.4.9**. `node_modules/postgres/src/index.js:parseOptions()` defaults `ssl` to false; maps URL `sslmode` to `ssl`; and gives explicit options precedence over URL query parameters, then `PGSSL`, then defaults. URL `sslmode=require` can therefore enable encryption in the old code, while no SSL input leaves encryption disabled. Do not assume the URL or Supabase enables it automatically. This driver uses `PGSSL` for that default, not libpq's `PGSSLMODE`. `sslrootcert=system` maps to verify-full, but arbitrary `sslrootcert` paths are not loaded as CA files by this parser; use the TLS `ca` option for PEM content.
- **Verified production facts supplied by user:** Supabase shared Transaction Pooler, port **6543**, username `postgres.<project-ref>`. No runtime role change is made.
- **Unverified production TLS:** deployed URL SSL parameters, `PGSSL`/Node trust environment, actual encryption on each hop, certificate chain/hostname verification and Supabase server-side SSL enforcement. The shell has no DATABASE_URL and `.env.local` has no DATABASE_URL assignment; no live credentials or certificate chain were inspected. Presence checks printed no values. The old source gap does not prove production currently uses plaintext.
- **Prepared locally, not deployed:** explicit certificate-verified TLS now overrides URL SSL downgrade settings and PGSSL. No live connection was opened. A successful build does not establish production certificate compatibility.

### Selected minimum change

Use Postgres.js TLS options **equivalent to verify-full**, with `rejectUnauthorized: true` and optional `DATABASE_SSL_CA` PEM content. Without that variable Node uses its default trust roots. If the actual pooler chain needs a Supabase CA, obtain the current certificate from the authenticated Supabase Dashboard and supply it as a server-only multiline environment value. Do not guess that a direct-database certificate is the correct trust anchor for the shared pooler: verify the actual hostname/chain first. Supplying `ca` replaces Node's default CA list for this connection. An invalid or incorrect CA must fail closed.

`ssl: 'require'` is the smaller encryption-only alternative, but the installed driver's `connection.js:secure()` explicitly sets `rejectUnauthorized=false` for it. It requires TLS without authenticating the server certificate/hostname, leaving active impersonation risk. The selected object requires a trusted, valid certificate and hostname match; Postgres.js supplies the DNS hostname as TLS `servername`, and Node performs its normal identity check. Keep the Dashboard DNS hostname, not a substituted IP, and do not override `checkServerIdentity` or `servername`. There is no plaintext fallback for this object. Supabase recommends verified TLS and provides CA-based configuration guidance. [Supabase SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement), [Node TLS verification](https://nodejs.org/api/tls.html#tlsconnectoptions-callback).

This is the smallest strict-verification change with an explicit custom-CA path: four added lines inside the existing constructor, no new library or connection factory. Production compatibility remains a predeployment check rather than a claim established here. TLS applies to all uses of this runtime constructor, including development; a plaintext-only local database will need TLS configuration.

Exact updated initialization:

```ts
const client = postgres(databaseUrl, {
    ssl: {
      rejectUnauthorized: true,
      ...(process.env.DATABASE_SSL_CA ? { ca: process.env.DATABASE_SSL_CA } : {}),
    },
    prepare: false,
    max: 1,
    idle_timeout: 1,
    connect_timeout: 10,
    connection: { statement_timeout: 10000, lock_timeout: 10000 },
});
```

`DATABASE_SSL_CA`, if required, contains actual PEM newlines (not a filename or literal backslash-n encoding). Never expose it with a NEXT_PUBLIC prefix. No certificate, connection string or password is committed. No CA variable is required when the verified pooler chain is already trusted by the deployed Node runtime. No automatic fallback to `require` is added.

### Deployment procedure — proposed only

1. Inspect production connection settings privately: confirm the existing shared pooler DNS hostname, port 6543 and postgres project-suffixed username. Record only sanitized facts and SSL modes, never the URL, password, environment dump or full driver options. Verify `NODE_TLS_REJECT_UNAUTHORIZED` is not disabled and review any Node trust overrides. Preserve all existing pool/timeouts and prepare:false.
2. From the intended Node runtime, validate the actual pooler certificate chain and DNS identity using these same Postgres.js TLS options. First use default roots; if trust is missing, configure the verified Supabase CA as DATABASE_SSL_CA and repeat. Do not use `sslmode=require`, rejectUnauthorized:false or plaintext to bypass a failed check. Stop before deployment if trust/hostname verification cannot be established. Remove unsupported libpq-only URL certificate parameters in a separately reviewed configuration edit if present; this code does not rewrite DATABASE_URL.
3. Use an isolated staging database through shared transaction pooling for login/session, booking transaction, audit, report and cold/recycled-connection checks. Run valid-chain success, untrusted/expired-chain, wrong-hostname and TLS-refusal tests against disposable endpoints; failure cases must not send application credentials over plaintext. Local tests below cover option selection, not these live TLS handshakes.
4. After compatibility evidence and separate release authorization, deploy only this TLS code and any required CA environment value. Keep the existing runtime database role and URL target. New processes are needed to replace cached clients. Confirm a read-only SELECT 1 using the actual application's connection, certificate authorization/hostname evidence from controlled diagnostics, and ordinary application health without logging secrets. A pg_stat_ssl query through the pooler observes the database-facing hop only; it does not prove the app-to-pooler certificate was verified. Verify Supabase SSL enforcement and both hops separately. [Supabase connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres).
5. Observe connection failures, API availability, cold-start/client recycling and audit continuity. Keep TLS deployment separate from the future runtime-role proposal. No production write tests or privilege changes are authorized by this phase.

### Rollback procedure — proposed only

If staging verification fails, do not release. Fix the CA/hostname configuration and revalidate. If a later authorized release fails, first correct any confirmed CA configuration error while keeping verification enabled. If recovery requires reverting, restore the prior application artifact and its prior environment configuration through an authorized release, remove DATABASE_SSL_CA only if introduced by this change, and recycle the application instances. Reverting the code removes the added `ssl` object and returns to URL/environment-dependent TLS; it reopens the original HIGH source finding and must be recorded as a temporary security regression. It does not alter database roles, RLS, grants or data. Do not roll back by switching to another pooler, enabling prepared statements or changing timeouts. No rollback was executed here.

### Focused validation

`tests/database-tls.test.mjs` invokes the actual transpiled application constructor with isolated globals and the installed Postgres.js parser, using synthetic credentials and a non-routable fixture hostname. It checks mandatory verification with absent/disable/false/require/prefer URL settings, precedence over PGSSL, intact optional CA handling without hostname overrides, missing-URL failure, and unchanged pool/timeouts. No query is issued; the lazy clients are closed without opening sockets. These tests establish application option wiring and driver parsing, not real TLS handshake or production CA compatibility.

Validation results are recorded at the end of this report.

## Read-only production inspection runbook

Run through the application identity first (to measure effective rights), then an authorized catalog-reader/admin if catalog visibility is incomplete. SQL Editor results under postgres do not identify the application's role. Save sanitized metadata in restricted evidence storage; omit connection strings, passwords, role password catalogs, session tokens and customer rows.

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';
SELECT current_user, session_user, current_database(), version();
SELECT ssl, version, cipher, bits FROM pg_stat_ssl WHERE pid = pg_backend_pid();
SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
       rolcanlogin, rolreplication, rolbypassrls
FROM pg_roles WHERE rolname IN (current_user, session_user);
-- All membership edges: review transitive inheritance AND SET ROLE reachability.
SELECT pg_get_userbyid(roleid) AS granted_role,
       pg_get_userbyid(member) AS member, admin_option
FROM pg_auth_members;
SELECT datname, pg_get_userbyid(datdba) AS owner,
       has_database_privilege(current_user, oid, 'CONNECT') AS connect,
       has_database_privilege(current_user, oid, 'CREATE') AS create_schema,
       has_database_privilege(current_user, oid, 'TEMP') AS temporary
FROM pg_database WHERE datname = current_database();
SELECT nspname, pg_get_userbyid(nspowner) AS owner,
       has_schema_privilege(current_user, oid, 'USAGE') AS usage,
       has_schema_privilege(current_user, oid, 'CREATE') AS create_objects,
       nspacl
FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema';
SELECT c.relname, pg_get_userbyid(c.relowner) AS owner,
       c.relrowsecurity, c.relforcerowsecurity, p.privilege,
       has_table_privilege(current_user, c.oid, p.privilege) AS effective
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),
                   ('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(privilege)
WHERE n.nspname = 'public' AND c.relname IN
 ('bookings','pre_bookings','products','app_users','login_sessions','audit_logs');
SELECT c.relname, p.privilege,
       has_sequence_privilege(current_user,c.oid,p.privilege) AS effective,
       pg_get_userbyid(c.relowner) AS owner
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
CROSS JOIN (VALUES ('USAGE'),('SELECT'),('UPDATE')) p(privilege)
WHERE n.nspname='public' AND c.relkind='S';
-- Expanded ACLs include implicit PostgreSQL defaults when ACL is NULL.
SELECT n.nspname, c.relname, c.relkind, a.*
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,
 acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) a
WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S');
SELECT n.nspname, a.* FROM pg_namespace n
CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a
WHERE n.nspname='public';
SELECT p.oid::regprocedure AS function, pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef, p.proconfig,
       has_function_privilege(current_user,p.oid,'EXECUTE') AS effective_execute,
       a.*
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
WHERE n.nspname='public';
SELECT pg_get_userbyid(d.defaclrole) AS creator,
       n.nspname, d.defaclobjtype, a.*
FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
CROSS JOIN LATERAL aclexplode(d.defaclacl) a;
SELECT * FROM pg_policies WHERE schemaname='public';
COMMIT;
```

ACL grantee 0 means PUBLIC; other OIDs map through pg_roles. NULL ACL is not “no privileges.” Default ACLs apply to the creating role, not all future creators; inspect global and schema-specific entries. Inspect column ACLs (`pg_attribute.attacl`) and effective column rights if table rights appear absent. Review executable SECURITY DEFINER routines and other schemas for privilege escalation. Ownership supplies ALTER/DROP rights independently of ordinary grants; there is no table DROP privilege to revoke. A non-superuser postgres role can still be an elevated owner. A Supabase service_role API role is distinct from the SQL login in DATABASE_URL. Classify from current_user, flags, ownership and membership, not the URL username alone.

## Minimum application privileges and RLS design

| Object | SELECT | INSERT | UPDATE | DELETE | Evidence / purpose |
| --- | --- | --- | --- | --- | --- |
| bookings | Yes | Yes | Yes | Yes | Booking handlers, conversion, capacity allocation, reports |
| pre_bookings | Yes | Yes | Yes | No | Public/manual intake, status edits, conversion, report linkage |
| products | Yes | Yes | Yes | Yes | Product CRUD handlers |
| app_users | Yes | Yes | Yes | No | User administration and login; SELECT FOR UPDATE also needs UPDATE |
| login_sessions | Yes | Yes | No | Yes | Session lookup, issuance, signout and user-session invalidation |
| audit_logs | Yes | Yes | No | No | Audit writer and audit/report readers |
| Six id sequences | No separate SELECT needed | USAGE | No UPDATE/setval | — | serial/bigserial defaults invoke nextval; USAGE also permits currval |

Runtime does not need schema/table ownership, CREATE DATABASE, CREATE ROLE, replication, BYPASSRLS, TRUNCATE, TRIGGER creation, arbitrary DDL or grant options. postgres.js type/catalog discovery and SELECT 1 need no custom DDL grants. No application-defined function is called directly by runtime SQL. The three migration functions are trigger functions using NEW/built-ins; no additional table access is required by their bodies. Trigger creation requires EXECUTE for the migration role; existing trigger invocation does not require a runtime function EXECUTE grant. Validate this on the deployed PostgreSQL version in staging.

All six live tables require policies, superseding the narrower migration-only inference. Keep `postgres` as migration/admin and existing object owner. Create only `gas_app_runtime`, a server-only LOGIN with no elevated flags, memberships, ownership or grant options. Keep migration credentials separate from Next.js. Do not grant this role to `anon`, `authenticated`, `authenticator` or any other role, and do not make runtime a member of another role.

The policies below intentionally allow all rows for each required command **only to gas_app_runtime**. They preserve the application's server-side authorization model; they do not implement per-user/tenant isolation and do not protect permitted rows from a compromised runtime credential. Do not use JWT-dependent policies: this application uses a shared SQL login and application-managed sessions. Policies and grants both constrain commands: no policy or grant for audit UPDATE/DELETE, user/preorder DELETE, or session UPDATE. RLS stays enabled; ownership, FORCE RLS and service_role behavior remain unchanged.

### Final source review: privilege evidence

| Table | Required operations | Reviewed source |
| --- | --- | --- |
| app_users | SELECT, INSERT, UPDATE | app/authz.ts; app/email-auth.ts; app/api/users/route.ts and [id]/route.ts. Login/reset uses SELECT FOR UPDATE. No user DELETE. |
| audit_logs | SELECT, INSERT | app/audit.ts writer and app/api/audit-logs/route.ts reader. No UPDATE/DELETE. |
| bookings | SELECT, INSERT, UPDATE, DELETE | Booking collection/detail routes, duplicate search, capacity allocation, preorder conversion, audit linkage and reports. |
| login_sessions | SELECT, INSERT, DELETE | app/email-auth.ts; user reset/disable invalidation in user routes. No UPDATE. |
| pre_bookings | SELECT, INSERT, UPDATE | Public/manual preorder routes, detail/conversion route and reports. No DELETE. |
| products | SELECT, INSERT, UPDATE, DELETE | Product routes, booking/conversion lookup and reports. |

`app/reports/query.ts` executes an unqualified SQL SELECT across bookings, products and pre_bookings using built-ins, not a stored application function. Preserve a search_path that resolves these names to public; verify this below. All six schema IDs are serial/bigserial defaults. Sequence USAGE permits nextval/currval; SELECT and UPDATE/setval are not needed. Returning inserted/updated/deleted rows requires SELECT, already included.

The only custom functions in reviewed migrations are `public.generate_booking_no()`, `public.validate_booking_manufacture_year()` and `public.validate_pre_booking_manufacture_year()`: existing row-trigger functions, not application RPCs. Their bodies need no extra table permissions. **Step E adds no EXECUTE grants.** The migration/admin role creates triggers; its trigger/function permissions must remain intact. Verify deployed definitions/bindings against the existing 0010/0012 checklist and test inserts in the disposable database. Built-in functions/operators retain their ordinary existing access; no blanket function grants or revocations are proposed. [PostgreSQL trigger creation privileges](https://www.postgresql.org/docs/16/sql-createtrigger.html).

## CUTOVER STAGE 1 — manual SQL Editor preparation only, NOT EXECUTED

This section is the Stage 1 extraction of the reviewed setup and supersedes the **first-install-only** mechanics below for this stage. It contains no Vercel changes. Run the entire setup block in Supabase SQL Editor as postgres against database postgres. It touches only gas_app_runtime, its grants and its 19 named policies. RLS remains enabled, FORCE RLS remains false, all six tables stay postgres-owned, and existing API-role privileges remain untouched. No custom function EXECUTE grant is required: the three reviewed functions are invoked by existing triggers. No blanket function grants are added.

**Password replacement:** generate a unique strong password outside this file. In the private SQL Editor copy only, replace the contents of the single-quoted literal assigned to `runtime_password` below: `'<GENERATE_STRONG_PASSWORD_OUTSIDE_SQL_FILE>'`. Keep the surrounding single quotes; double any embedded single quote in the password for SQL escaping. Do not include the dollar-quote delimiter `$runtime_role$` in the generated password. Never save the real password in repository files, screenshots or shared snippets. SQL Editor can retain query history: treat that private query/history as sensitive credential material. The untouched placeholder raises an exception and rolls back the setup.

Reruns reapply the flags/grants, reset the password to the operator-supplied value, and replace only the named runtime policies inside one transaction. Use the same securely retained password for a setup retry unless intentionally rotating it. An existing role must be the intended Stage 1 role; memberships/ownership or unexpected policies cause an abort rather than automatic adoption or removal. If any statement fails, issue ROLLBACK in the same session (or discard that failed session) and rerun the whole block after resolving the cause. Never execute selected later statements from a failed setup.

**INFORMATIONAL / accepted inherited privilege:** user-verified production facts are `public_temp_on_database = true` and `public_create_on_public_schema = false`. PUBLIC supplies TEMPORARY on database postgres; effective runtime TEMP is accepted through PUBLIC, including the ability to create temporary objects. No TEMPORARY privilege is revoked from PUBLIC. Stage 1 rejects a direct TEMPORARY ACL grant to gas_app_runtime instead of rejecting effective TEMP. This Stage 1 exception supersedes the older blanket TEMP prohibition below for this stage only. Effective database CREATE, schema CREATE, ownership, memberships, elevated role flags and excessive table/sequence rights remain disallowed. This stage performs no shared-ACL remediation or revocations. If that occurs, stop and retain the findings for a separately reviewed prerequisite change. Successful role provisioning alone does not establish safe runtime access; callable functions and other-object ACLs still require the finalized runbook's review. The password is a placeholder only, and none of this SQL has been executed.

### Stage 1 setup — execute as one block only after manual password replacement

```sql
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
DO $$
DECLARE tbl text; matches integer;
BEGIN
  IF current_database() <> 'postgres' OR current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Wrong target database';
  END IF;
  FOREACH tbl IN ARRAY ARRAY['bookings','pre_bookings','products',
                            'app_users','login_sessions','audit_logs'] LOOP
    SELECT count(*) INTO matches
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = tbl AND c.relkind = 'r'
      AND pg_get_userbyid(c.relowner) = 'postgres'
      AND c.relrowsecurity AND NOT c.relforcerowsecurity;
    IF matches <> 1 OR EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl
        AND NOT (policyname = ANY (ARRAY[
          'gas_app_runtime_' || tbl || '_select',
          'gas_app_runtime_' || tbl || '_insert',
          'gas_app_runtime_' || tbl || '_update',
          'gas_app_runtime_' || tbl || '_delete'])
          AND roles=ARRAY['gas_app_runtime']::name[]
          AND NOT (tablename IN ('app_users','pre_bookings','audit_logs')
                   AND policyname='gas_app_runtime_' || tbl || '_delete')
          AND NOT (tablename IN ('audit_logs','login_sessions')
                   AND policyname='gas_app_runtime_' || tbl || '_update'))
    ) THEN
      RAISE EXCEPTION 'Table ownership/RLS/policy drift: %', tbl;
    END IF;
  END LOOP;
END $$;
-- A. Only this runtime role is created/altered. Existing owners/members fail closed.
DO $runtime_role$
DECLARE
  runtime_password text := '<GENERATE_STRONG_PASSWORD_OUTSIDE_SQL_FILE>';
  runtime_oid oid;
BEGIN
  IF left(runtime_password,1) = '<' THEN
    RAISE EXCEPTION 'Replace the password placeholder privately before execution';
  END IF;
  SELECT oid INTO runtime_oid FROM pg_roles WHERE rolname='gas_app_runtime';
  IF runtime_oid IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM pg_auth_members
               WHERE member=runtime_oid OR roleid=runtime_oid)
       OR EXISTS (SELECT 1 FROM pg_shdepend
                  WHERE refclassid='pg_authid'::regclass
                    AND refobjid=runtime_oid AND deptype='o') THEN
      RAISE EXCEPTION 'Existing runtime role has memberships or ownership; stop for review';
    END IF;
  ELSE
    CREATE ROLE gas_app_runtime NOLOGIN;
  END IF;
  EXECUTE format(
    'ALTER ROLE gas_app_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD %L',
    runtime_password);
END $runtime_role$;
GRANT CONNECT ON DATABASE postgres TO gas_app_runtime;
-- B. Schema lookup only.
GRANT USAGE ON SCHEMA public TO gas_app_runtime;
-- C. Exact application table privileges.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bookings, public.products TO gas_app_runtime;
GRANT SELECT, INSERT, UPDATE ON public.pre_bookings, public.app_users TO gas_app_runtime;
GRANT SELECT, INSERT, DELETE ON public.login_sessions TO gas_app_runtime;
GRANT SELECT, INSERT ON public.audit_logs TO gas_app_runtime;
-- D. USAGE only on actual id sequences.
DO $$
DECLARE tbl text; seq text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['bookings','pre_bookings','products',
                            'app_users','login_sessions','audit_logs'] LOOP
    seq := pg_get_serial_sequence(format('public.%I', tbl), 'id');
    IF seq IS NULL THEN RAISE EXCEPTION 'Missing id sequence: %', tbl; END IF;
    EXECUTE format('GRANT USAGE ON SEQUENCE %s TO gas_app_runtime', seq::regclass);
    IF has_sequence_privilege('gas_app_runtime', seq, 'SELECT')
       OR has_sequence_privilege('gas_app_runtime', seq, 'UPDATE') THEN
      RAISE EXCEPTION 'Excess effective sequence privileges: %', seq;
    END IF;
  END LOOP;
END $$;
-- E. No additional application-function EXECUTE grants required.
-- F. Command-specific policies; never TO PUBLIC/anon/authenticated.
DROP POLICY IF EXISTS gas_app_runtime_bookings_select ON public.bookings;
CREATE POLICY gas_app_runtime_bookings_select ON public.bookings
  FOR SELECT TO gas_app_runtime USING (true);
DROP POLICY IF EXISTS gas_app_runtime_bookings_insert ON public.bookings;
CREATE POLICY gas_app_runtime_bookings_insert ON public.bookings
  FOR INSERT TO gas_app_runtime WITH CHECK (true);
DROP POLICY IF EXISTS gas_app_runtime_bookings_update ON public.bookings;
CREATE POLICY gas_app_runtime_bookings_update ON public.bookings
  FOR UPDATE TO gas_app_runtime USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS gas_app_runtime_bookings_delete ON public.bookings;
CREATE POLICY gas_app_runtime_bookings_delete ON public.bookings
  FOR DELETE TO gas_app_runtime USING (true);
DROP POLICY IF EXISTS gas_app_runtime_pre_bookings_select ON public.pre_bookings;
CREATE POLICY gas_app_runtime_pre_bookings_select ON public.pre_bookings
  FOR SELECT TO gas_app_runtime USING (true);
DROP POLICY IF EXISTS gas_app_runtime_pre_bookings_insert ON public.pre_bookings;
CREATE POLICY gas_app_runtime_pre_bookings_insert ON public.pre_bookings
  FOR INSERT TO gas_app_runtime WITH CHECK (true);
DROP POLICY IF EXISTS gas_app_runtime_pre_bookings_update ON public.pre_bookings;
CREATE POLICY gas_app_runtime_pre_bookings_update ON public.pre_bookings
  FOR UPDATE TO gas_app_runtime USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS gas_app_runtime_products_select ON public.products;
CREATE POLICY gas_app_runtime_products_select ON public.products
  FOR SELECT TO gas_app_runtime USING (true);
DROP POLICY IF EXISTS gas_app_runtime_products_insert ON public.products;
CREATE POLICY gas_app_runtime_products_insert ON public.products
  FOR INSERT TO gas_app_runtime WITH CHECK (true);
DROP POLICY IF EXISTS gas_app_runtime_products_update ON public.products;
CREATE POLICY gas_app_runtime_products_update ON public.products
  FOR UPDATE TO gas_app_runtime USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS gas_app_runtime_products_delete ON public.products;
CREATE POLICY gas_app_runtime_products_delete ON public.products
  FOR DELETE TO gas_app_runtime USING (true);
DROP POLICY IF EXISTS gas_app_runtime_app_users_select ON public.app_users;
CREATE POLICY gas_app_runtime_app_users_select ON public.app_users
  FOR SELECT TO gas_app_runtime USING (true);
DROP POLICY IF EXISTS gas_app_runtime_app_users_insert ON public.app_users;
CREATE POLICY gas_app_runtime_app_users_insert ON public.app_users
  FOR INSERT TO gas_app_runtime WITH CHECK (true);
DROP POLICY IF EXISTS gas_app_runtime_app_users_update ON public.app_users;
CREATE POLICY gas_app_runtime_app_users_update ON public.app_users
  FOR UPDATE TO gas_app_runtime USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS gas_app_runtime_login_sessions_select ON public.login_sessions;
CREATE POLICY gas_app_runtime_login_sessions_select ON public.login_sessions
  FOR SELECT TO gas_app_runtime USING (true);
DROP POLICY IF EXISTS gas_app_runtime_login_sessions_insert ON public.login_sessions;
CREATE POLICY gas_app_runtime_login_sessions_insert ON public.login_sessions
  FOR INSERT TO gas_app_runtime WITH CHECK (true);
DROP POLICY IF EXISTS gas_app_runtime_login_sessions_delete ON public.login_sessions;
CREATE POLICY gas_app_runtime_login_sessions_delete ON public.login_sessions
  FOR DELETE TO gas_app_runtime USING (true);
DROP POLICY IF EXISTS gas_app_runtime_audit_logs_select ON public.audit_logs;
CREATE POLICY gas_app_runtime_audit_logs_select ON public.audit_logs
  FOR SELECT TO gas_app_runtime USING (true);
DROP POLICY IF EXISTS gas_app_runtime_audit_logs_insert ON public.audit_logs;
CREATE POLICY gas_app_runtime_audit_logs_insert ON public.audit_logs
  FOR INSERT TO gas_app_runtime WITH CHECK (true);
-- PUBLIC-derived TEMP is accepted; a direct runtime TEMPORARY grant is not.
DO $$
DECLARE tbl text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_auth_members
             WHERE member = 'gas_app_runtime'::regrole
                OR roleid = 'gas_app_runtime'::regrole)
     OR has_database_privilege('gas_app_runtime', 'postgres', 'CREATE')
     OR EXISTS (
       SELECT 1 FROM pg_database d
       CROSS JOIN LATERAL aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) acl
       WHERE d.datname = 'postgres'
         AND acl.grantee = 'gas_app_runtime'::regrole
         AND acl.privilege_type = 'TEMPORARY'
     )
     OR EXISTS (SELECT 1 FROM pg_namespace
                WHERE has_schema_privilege('gas_app_runtime', oid, 'CREATE')) THEN
    RAISE EXCEPTION 'Runtime has membership, CREATE privileges or direct TEMPORARY grant';
  END IF;
  FOREACH tbl IN ARRAY ARRAY['bookings','pre_bookings','products',
                            'app_users','login_sessions','audit_logs'] LOOP
    IF has_table_privilege('gas_app_runtime', format('public.%I', tbl), 'TRUNCATE')
       OR has_table_privilege('gas_app_runtime', format('public.%I', tbl), 'TRIGGER')
       OR has_table_privilege('gas_app_runtime', format('public.%I', tbl), 'REFERENCES') THEN
      RAISE EXCEPTION 'Excess effective table privileges: %', tbl;
    END IF;
  END LOOP;
  IF has_table_privilege('gas_app_runtime', 'public.pre_bookings', 'DELETE')
     OR has_table_privilege('gas_app_runtime', 'public.app_users', 'DELETE')
     OR has_table_privilege('gas_app_runtime', 'public.login_sessions', 'UPDATE')
     OR has_table_privilege('gas_app_runtime', 'public.audit_logs', 'UPDATE')
     OR has_table_privilege('gas_app_runtime', 'public.audit_logs', 'DELETE') THEN
    RAISE EXCEPTION 'Unexpected effective DML privileges';
  END IF;
END $$;
COMMIT;
```

### Stage 1 read-only verification — run separately after successful COMMIT

Run as postgres in SQL Editor. Expect no exception, the exact table/sequence privilege matrix, 19 exact command/role/expression policy matches, six postgres-owned tables with RLS true and FORCE false, LOGIN true and all elevated flags false. The assertion block checks every table command and sequence privilege, including forbidden rights and grant options. Function EXECUTE output may be true via PUBLIC without an explicit runtime grant; review every callable SECURITY DEFINER result. Missing or drifted trigger functions remain unresolved, not a reason to grant EXECUTE broadly. Expected TEMP output: `public_temp_on_database = true`, `effective_temp = true` (accepted via PUBLIC), `direct_runtime_temp = false`, `database_create = false`, and `public_schema_create = false`. These are expected results, not checks executed in this update. These admin catalog checks do not test the new password, pooler login or actual runtime RLS execution; those belong to later stages.

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';
SELECT current_user, session_user, current_database(), current_setting('search_path');
DO $$
DECLARE r record; t record; op text; allowed boolean; seq text; pname text;
        expected_commands text[];
BEGIN
  IF current_user <> 'postgres'
     OR current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Use postgres admin in database postgres';
  END IF;
  SELECT * INTO STRICT r FROM pg_roles WHERE rolname='gas_app_runtime';
  IF NOT r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole
     OR r.rolbypassrls OR r.rolreplication OR r.rolinherit THEN
    RAISE EXCEPTION 'Unsafe role flags';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member=r.oid OR roleid=r.oid)
     OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner=r.oid)
     OR EXISTS (SELECT 1 FROM pg_class WHERE relowner=r.oid)
     OR EXISTS (SELECT 1 FROM pg_proc WHERE proowner=r.oid)
     OR EXISTS (SELECT 1 FROM pg_database WHERE datdba=r.oid)
     OR has_database_privilege('gas_app_runtime',current_database(),'CREATE')
     OR EXISTS (
       SELECT 1 FROM pg_database d
       CROSS JOIN LATERAL aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) acl
       WHERE d.datname = 'postgres'
         AND acl.grantee = 'gas_app_runtime'::regrole
         AND acl.privilege_type = 'TEMPORARY'
     )
     OR EXISTS (SELECT 1 FROM pg_namespace
                WHERE has_schema_privilege('gas_app_runtime',oid,'CREATE')) THEN
    RAISE EXCEPTION 'Ownership, membership, CREATE privileges or direct TEMPORARY grant present';
  END IF;
  IF NOT has_schema_privilege('gas_app_runtime','public','USAGE') THEN
    RAISE EXCEPTION 'Missing public USAGE';
  END IF;
  FOR t IN SELECT * FROM (VALUES
    ('app_users', ARRAY['SELECT','INSERT','UPDATE']),
    ('audit_logs', ARRAY['SELECT','INSERT']),
    ('bookings', ARRAY['SELECT','INSERT','UPDATE','DELETE']),
    ('login_sessions', ARRAY['SELECT','INSERT','DELETE']),
    ('pre_bookings', ARRAY['SELECT','INSERT','UPDATE']),
    ('products', ARRAY['SELECT','INSERT','UPDATE','DELETE'])
  ) AS expected(tbl,commands) LOOP
    IF to_regclass(t.tbl) IS DISTINCT FROM to_regclass('public.' || t.tbl) THEN
      RAISE EXCEPTION 'Unsafe search_path resolution: %',t.tbl;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid=to_regclass('public.' || t.tbl)
       AND pg_get_userbyid(c.relowner)='postgres' AND c.relrowsecurity
       AND NOT c.relforcerowsecurity) THEN
      RAISE EXCEPTION 'Ownership/RLS drift: %',t.tbl;
    END IF;
    FOREACH op IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES'] LOOP
      allowed := op=ANY(t.commands);
      IF has_table_privilege('gas_app_runtime','public.' || t.tbl,op) <> allowed
         OR has_table_privilege('gas_app_runtime','public.' || t.tbl,op || ' WITH GRANT OPTION') THEN
        RAISE EXCEPTION 'Table privilege mismatch: %, %',t.tbl,op;
      END IF;
      IF op IN ('INSERT','UPDATE','REFERENCES') AND NOT allowed
         AND has_any_column_privilege('gas_app_runtime','public.' || t.tbl,op) THEN
        RAISE EXCEPTION 'Excess column privilege: %, %',t.tbl,op;
      END IF;
    END LOOP;
    IF current_setting('server_version_num')::integer >= 170000 THEN
      IF has_table_privilege('gas_app_runtime','public.' || t.tbl,'MAINTAIN') THEN
        RAISE EXCEPTION 'Excess MAINTAIN privilege: %',t.tbl;
      END IF;
    END IF;
    seq := pg_get_serial_sequence('public.' || t.tbl,'id');
    IF seq IS NULL OR NOT has_sequence_privilege('gas_app_runtime',seq,'USAGE')
       OR has_sequence_privilege('gas_app_runtime',seq,'SELECT')
       OR has_sequence_privilege('gas_app_runtime',seq,'UPDATE')
       OR has_sequence_privilege('gas_app_runtime',seq,'USAGE WITH GRANT OPTION') THEN
      RAISE EXCEPTION 'Sequence privilege mismatch: %',t.tbl;
    END IF;
    IF (SELECT count(*) FROM pg_policies WHERE schemaname='public'
        AND tablename=t.tbl) <> cardinality(t.commands) THEN
      RAISE EXCEPTION 'Unexpected policy count: %',t.tbl;
    END IF;
    FOREACH op IN ARRAY t.commands LOOP
      pname := 'gas_app_runtime_' || t.tbl || '_' || lower(op);
      IF NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname='public'
        AND p.tablename=t.tbl AND p.policyname=pname AND p.cmd=op
        AND p.roles=ARRAY['gas_app_runtime']::name[] AND p.permissive='PERMISSIVE'
        AND p.qual IS NOT DISTINCT FROM
          (CASE WHEN op='INSERT' THEN NULL::text ELSE 'true' END)
        AND p.with_check IS NOT DISTINCT FROM
          (CASE WHEN op IN ('INSERT','UPDATE') THEN 'true' ELSE NULL::text END)) THEN
        RAISE EXCEPTION 'Policy mismatch: %',pname;
      END IF;
    END LOOP;

  END LOOP;
END $$;
SELECT c.relname, c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS force_rls_must_remain_false,
       pg_get_userbyid(c.relowner) AS owner
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN
 ('app_users','audit_logs','bookings','login_sessions','pre_bookings','products');
-- Manual review gate: inspect bodies/dependencies of every returned definer routine.
SELECT p.oid::regprocedure AS callable_definer, pg_get_userbyid(p.proowner) AS owner
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE p.prosecdef AND has_schema_privilege('gas_app_runtime',n.oid,'USAGE')
  AND has_function_privilege('gas_app_runtime',p.oid,'EXECUTE');
-- Three expected trigger functions: EXECUTE is reported, not required for firing.
SELECT expected.signature, p.oid IS NOT NULL AS function_exists,
       p.prosecdef AS security_definer,
       has_function_privilege('gas_app_runtime',p.oid,'EXECUTE') AS effective_execute
FROM (VALUES ('public.generate_booking_no()'),
             ('public.validate_booking_manufacture_year()'),
             ('public.validate_pre_booking_manufacture_year()')) expected(signature)
LEFT JOIN pg_proc p ON p.oid=to_regprocedure(expected.signature);
SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
       rolbypassrls, rolreplication, rolinherit
FROM pg_roles WHERE rolname='gas_app_runtime';
SELECT has_schema_privilege('gas_app_runtime','public','USAGE') AS public_usage,
       has_schema_privilege('gas_app_runtime','public','CREATE') AS public_create;
-- Report effective TEMP separately from a forbidden direct grant.
SELECT
  EXISTS (
    SELECT 1 FROM aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) acl
    WHERE acl.grantee = 0 AND acl.privilege_type = 'TEMPORARY'
  ) AS public_temp_on_database,
  has_database_privilege('gas_app_runtime', d.oid, 'TEMP') AS effective_temp,
  EXISTS (
    SELECT 1 FROM aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) acl
    WHERE acl.grantee = 'gas_app_runtime'::regrole
      AND acl.privilege_type = 'TEMPORARY'
  ) AS direct_runtime_temp,
  has_database_privilege('gas_app_runtime', d.oid, 'CREATE') AS database_create,
  has_schema_privilege('gas_app_runtime', 'public', 'CREATE') AS public_schema_create
FROM pg_database d WHERE d.datname = 'postgres';
SELECT count(*) AS matching_policy_count_must_be_19
FROM pg_policies WHERE schemaname='public'
  AND tablename IN ('app_users','audit_logs','bookings','login_sessions','pre_bookings','products')
  AND roles=ARRAY['gas_app_runtime']::name[];
COMMIT;
```

Stage 1 validation: documentation-only extraction; static checks cover all 19 immediately paired DROP/CREATE policies, grants, placeholder guard and read-only verification. No SQL execution, credential provisioning, production change, deployment or push. `git diff --check` and direct untracked-file whitespace checks passed.

Stage 1 TEMP adjustment: both abort checks now inspect database ACLs for a direct runtime TEMPORARY grant. NULL datacl uses PostgreSQL default ACLs; PUBLIC is grantee 0 and does not match the runtime role. Verification separately reports PUBLIC, effective and direct TEMP. Other privilege checks and all 19 policy pairs remain unchanged. Static scope/SQL-text checks and `git diff --check` passed; no SQL was executed.

## Final role SQL: steps A–F — NOT EXECUTED

This is a future owner/admin transaction for database `postgres`, schema `public`, and the verified six tables. Run only after separate authorization, staging validation and catalog review. The new role must not already exist. This is intentionally a first-install transaction: CREATE ROLE and CREATE POLICY fail on collisions; do not silently adopt an existing login or overwrite unknown policies. Grants are naturally repeatable. On a failed transaction, ROLLBACK and retry the whole transaction after resolving the cause. After a successful commit, use verification instead of rerunning creation. Policy names are explicit and deterministic; avoiding DROP/replace makes retries safe without destroying unrelated policy state. No password is embedded: provision a unique secret out of band after approval, before cutover. Do not execute any of this SQL in this documentation phase, including on a local fixture.

The transaction deliberately aborts if effective database/schema CREATE, TEMP, excess table/sequence rights or role memberships prevent the target. PostgreSQL has no per-role DENY to override PUBLIC grants. If it aborts, inventory affected consumers and prepare a separately reviewed PUBLIC/inherited ACL change with a captured exact inverse; do not weaken these checks or silently revoke shared privileges. Also review accessible SECURITY DEFINER functions, views, other schemas and extension entry points before rollout; no arbitrary DDL or escalation path is an acceptance requirement. This proposal changes no shared/default ACLs and no service_role privileges.

Use a client configured to stop on the first SQL error (`\set ON_ERROR_STOP on` in psql). Never resume at a later statement after failure. The role intentionally has no password until secure provisioning; do not briefly assign a shared or example password. Idempotency is limited deliberately: GRANT and read-only verification are repeatable, failed installation rolls back atomically, and a committed installation is verified rather than recreated. PostgreSQL CREATE POLICY has no IF NOT EXISTS form; swallowing duplicate-policy errors would conceal drift. The optional cleanup uses DROP POLICY IF EXISTS for already-removed named policies, but still requires the role and reviewed dependencies to exist.

```sql
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
DO $$
DECLARE tbl text; matches integer;
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Wrong target database';
  END IF;
  FOREACH tbl IN ARRAY ARRAY['bookings','pre_bookings','products',
                            'app_users','login_sessions','audit_logs'] LOOP
    SELECT count(*) INTO matches
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = tbl AND c.relkind = 'r'
      AND pg_get_userbyid(c.relowner) = 'postgres'
      AND c.relrowsecurity AND NOT c.relforcerowsecurity;
    IF matches <> 1 OR EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl
    ) THEN
      RAISE EXCEPTION 'Table ownership/RLS/policy drift: %', tbl;
    END IF;
  END LOOP;
END $$;
-- A. New login; no memberships or ownership transfers.
CREATE ROLE gas_app_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS NOINHERIT;
GRANT CONNECT ON DATABASE postgres TO gas_app_runtime;
-- B. Schema lookup only.
GRANT USAGE ON SCHEMA public TO gas_app_runtime;
-- C. Exact application table privileges.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bookings, public.products TO gas_app_runtime;
GRANT SELECT, INSERT, UPDATE ON public.pre_bookings, public.app_users TO gas_app_runtime;
GRANT SELECT, INSERT, DELETE ON public.login_sessions TO gas_app_runtime;
GRANT SELECT, INSERT ON public.audit_logs TO gas_app_runtime;
-- D. USAGE only on actual id sequences.
DO $$
DECLARE tbl text; seq text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['bookings','pre_bookings','products',
                            'app_users','login_sessions','audit_logs'] LOOP
    seq := pg_get_serial_sequence(format('public.%I', tbl), 'id');
    IF seq IS NULL THEN RAISE EXCEPTION 'Missing id sequence: %', tbl; END IF;
    EXECUTE format('GRANT USAGE ON SEQUENCE %s TO gas_app_runtime', seq::regclass);
    IF has_sequence_privilege('gas_app_runtime', seq, 'SELECT')
       OR has_sequence_privilege('gas_app_runtime', seq, 'UPDATE') THEN
      RAISE EXCEPTION 'Excess effective sequence privileges: %', seq;
    END IF;
  END LOOP;
END $$;
-- E. No additional application-function EXECUTE grants required.
-- F. Command-specific policies; never TO PUBLIC/anon/authenticated.
CREATE POLICY gas_app_runtime_bookings_select ON public.bookings
  FOR SELECT TO gas_app_runtime USING (true);
CREATE POLICY gas_app_runtime_bookings_insert ON public.bookings
  FOR INSERT TO gas_app_runtime WITH CHECK (true);
CREATE POLICY gas_app_runtime_bookings_update ON public.bookings
  FOR UPDATE TO gas_app_runtime USING (true) WITH CHECK (true);
CREATE POLICY gas_app_runtime_bookings_delete ON public.bookings
  FOR DELETE TO gas_app_runtime USING (true);
CREATE POLICY gas_app_runtime_pre_bookings_select ON public.pre_bookings
  FOR SELECT TO gas_app_runtime USING (true);
CREATE POLICY gas_app_runtime_pre_bookings_insert ON public.pre_bookings
  FOR INSERT TO gas_app_runtime WITH CHECK (true);
CREATE POLICY gas_app_runtime_pre_bookings_update ON public.pre_bookings
  FOR UPDATE TO gas_app_runtime USING (true) WITH CHECK (true);
CREATE POLICY gas_app_runtime_products_select ON public.products
  FOR SELECT TO gas_app_runtime USING (true);
CREATE POLICY gas_app_runtime_products_insert ON public.products
  FOR INSERT TO gas_app_runtime WITH CHECK (true);
CREATE POLICY gas_app_runtime_products_update ON public.products
  FOR UPDATE TO gas_app_runtime USING (true) WITH CHECK (true);
CREATE POLICY gas_app_runtime_products_delete ON public.products
  FOR DELETE TO gas_app_runtime USING (true);
CREATE POLICY gas_app_runtime_app_users_select ON public.app_users
  FOR SELECT TO gas_app_runtime USING (true);
CREATE POLICY gas_app_runtime_app_users_insert ON public.app_users
  FOR INSERT TO gas_app_runtime WITH CHECK (true);
CREATE POLICY gas_app_runtime_app_users_update ON public.app_users
  FOR UPDATE TO gas_app_runtime USING (true) WITH CHECK (true);
CREATE POLICY gas_app_runtime_login_sessions_select ON public.login_sessions
  FOR SELECT TO gas_app_runtime USING (true);
CREATE POLICY gas_app_runtime_login_sessions_insert ON public.login_sessions
  FOR INSERT TO gas_app_runtime WITH CHECK (true);
CREATE POLICY gas_app_runtime_login_sessions_delete ON public.login_sessions
  FOR DELETE TO gas_app_runtime USING (true);
CREATE POLICY gas_app_runtime_audit_logs_select ON public.audit_logs
  FOR SELECT TO gas_app_runtime USING (true);
CREATE POLICY gas_app_runtime_audit_logs_insert ON public.audit_logs
  FOR INSERT TO gas_app_runtime WITH CHECK (true);
-- Abort rather than claim least privilege while PUBLIC supplies extra rights.
DO $$
DECLARE tbl text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_auth_members
             WHERE member = 'gas_app_runtime'::regrole
                OR roleid = 'gas_app_runtime'::regrole)
     OR has_database_privilege('gas_app_runtime', 'postgres', 'CREATE')
     OR has_database_privilege('gas_app_runtime', 'postgres', 'TEMP')
     OR EXISTS (SELECT 1 FROM pg_namespace
                WHERE has_schema_privilege('gas_app_runtime', oid, 'CREATE')) THEN
    RAISE EXCEPTION 'Runtime has membership or effective DDL privileges';
  END IF;
  FOREACH tbl IN ARRAY ARRAY['bookings','pre_bookings','products',
                            'app_users','login_sessions','audit_logs'] LOOP
    IF has_table_privilege('gas_app_runtime', format('public.%I', tbl), 'TRUNCATE')
       OR has_table_privilege('gas_app_runtime', format('public.%I', tbl), 'TRIGGER')
       OR has_table_privilege('gas_app_runtime', format('public.%I', tbl), 'REFERENCES') THEN
      RAISE EXCEPTION 'Excess effective table privileges: %', tbl;
    END IF;
  END LOOP;
  IF has_table_privilege('gas_app_runtime', 'public.pre_bookings', 'DELETE')
     OR has_table_privilege('gas_app_runtime', 'public.app_users', 'DELETE')
     OR has_table_privilege('gas_app_runtime', 'public.login_sessions', 'UPDATE')
     OR has_table_privilege('gas_app_runtime', 'public.audit_logs', 'UPDATE')
     OR has_table_privilege('gas_app_runtime', 'public.audit_logs', 'DELETE') THEN
    RAISE EXCEPTION 'Unexpected effective DML privileges';
  END IF;
END $$;
COMMIT;
```

There are 19 command-specific policies. None targets PUBLIC, anon, authenticated or service_role. Existing service_role bypass and grants are preserved. Excess API-role grants remain a documented follow-up, not a silent change in this runtime cutover. A later revocation proposal must inventory actual grants/grantors/options and consumers, capture exact rollback, and distinguish removing service_role administrative privileges from preserving its required DML behavior. Future postgres migrations must explicitly grant only needed privileges and add role-specific policies for new runtime tables; no blanket default grants are proposed.

For cutover, use transaction-pooler username `gas_app_runtime.<project-ref>` with its own secret, the existing endpoint and verified TLS; preserve `prepare:false`, `max:1`, `idle_timeout:1` and `connect_timeout:10`. Check `current_user` and `session_user` through the actual application connection, not SQL Editor. Custom pooler usernames use the database role plus project suffix. [Supavisor FAQ](https://supabase.com/docs/guides/troubleshooting/supavisor-faq-YyP5tI).

## Final rollout order and gates — proposed only

**Before A:** retain the verified backup and its TOC/checksum evidence, capture current role/object/policy/ACL/function/default-ACL metadata with the read-only inspection runbook, and protect the old Vercel DATABASE_URL secret version for rollback. Complete a disposable restore and application-role drill before production rollout; TOC validation alone does not satisfy that gate. Confirm the deployed revision matches the reviewed application operations. No execution is authorized by this document.

| Step | Action and acceptance |
| --- | --- |
| A | As postgres migration/admin, create gas_app_runtime with the flags in the A–F transaction. No ownership transfer, membership or schema creation. Provision a unique password through an approved secret manager or psql hidden `\password gas_app_runtime` prompt after the transaction commits; never put a literal password in SQL/history/logs. |
| B | Grant database CONNECT and public schema USAGE only. |
| C | Grant exactly the six-table DML matrix. |
| D | Resolve each owned id sequence and grant USAGE only. |
| E | No extra application-function EXECUTE grant is required. Review accessible SECURITY DEFINER entry points before acceptance. |
| F | Create the 19 explicit policies in the same transaction as A–D. Preserve RLS, FORCE RLS and ownership; no API-role policies or memberships. COMMIT only if all checks pass. |
| G | Open a **fresh actual login** through the shared transaction pooler as gas_app_runtime.<project-ref>, using the verified CA/TLS settings. Run the pre-switch SQL below. SQL Editor SET ROLE cannot establish password/pooler compatibility. Complete disposable application tests for all permitted writes, RETURNING, triggers, session invalidation, reports and denied DDL/DML. No synthetic production writes are required by this verification SQL. |
| H | After G succeeds and release authorization, change only the Production Vercel DATABASE_URL username/password to the new project-suffixed login and its securely encoded password. Preserve hostname, database, port 6543 and applicable URL parameters. Preserve DATABASE_SSL_CA, rejectUnauthorized:true, prepare:false and every pool/SQL timeout. Keep postgres credentials only in admin/backup and protected rollback storage. Do not change preview environments implicitly. |
| I | Redeploy the reviewed application with the updated Production environment. Existing deployments/processes retain their previous environment; verify the production alias and replace/drain old instances and database clients. No code or migration change accompanies this cutover. |
| J | Run post-switch SQL through the actual deployed server-side connection, then smoke-test login/logout, booking list/detail, preorders, products, audit search and reports. Verify write flows in the disposable drill and observe authorized normal production writes/audit continuity; synthetic production transactions require separate authorization. Check cold/recycled connections and absence of permission/RLS/sequence errors. |
| K | Only after stable success consider excessive-grant cleanup as a separate change with dependency review and exact ACL rollback. Do not revoke postgres ownership/admin capability or service_role privileges as part of this rollout. |

A **hard precondition** is no effective runtime CREATE/TEMP, ownership, role switching, excess privileges or unsafe callable escalation path. PUBLIC TEMP is a PostgreSQL default and may cause the A–F transaction to abort. NOINHERIT cannot neutralize PUBLIC. If these gates fail, stop before Vercel changes: prepare a separate consumer-aware ACL remediation and exact inverse, preserving service_role behavior. “Consider revocations after success” does not permit switching to a role that fails least-privilege checks. No broad shared ACL revocation is embedded here. [PostgreSQL default privileges](https://www.postgresql.org/docs/current/ddl-priv.html).

## Exact pre-switch verification SQL — step G, NOT EXECUTED

Run in a fresh new-role pooler login, with the actual production CA and client options, after A–F and password provisioning. Use a transaction so checks share one backend. Expect no exception, six RLS-active tables, 19 exact policies, and no unreviewed escalation findings. This verifies access metadata and SELECT paths without changing rows or sequences. Capture only sanitized results. The source search_path must resolve the report's unqualified names to public.

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';
SELECT current_user, session_user, current_database(), current_setting('search_path');
DO $$
DECLARE r record; t record; op text; allowed boolean; seq text; pname text;
        expected_commands text[];
BEGIN
  IF current_user <> 'gas_app_runtime' OR session_user <> 'gas_app_runtime'
     OR current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Wrong runtime login/database';
  END IF;
  SELECT * INTO r FROM pg_roles WHERE rolname=current_user;
  IF NOT r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole
     OR r.rolbypassrls OR r.rolreplication OR r.rolinherit THEN
    RAISE EXCEPTION 'Unsafe role flags';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member=r.oid OR roleid=r.oid)
     OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner=r.oid)
     OR EXISTS (SELECT 1 FROM pg_class WHERE relowner=r.oid)
     OR EXISTS (SELECT 1 FROM pg_proc WHERE proowner=r.oid)
     OR EXISTS (SELECT 1 FROM pg_database WHERE datdba=r.oid)
     OR has_database_privilege(current_user,current_database(),'CREATE')
     OR has_database_privilege(current_user,current_database(),'TEMP')
     OR EXISTS (SELECT 1 FROM pg_namespace
                WHERE has_schema_privilege(current_user,oid,'CREATE')) THEN
    RAISE EXCEPTION 'Ownership, membership or DDL privileges present';
  END IF;
  IF NOT has_schema_privilege(current_user,'public','USAGE') THEN
    RAISE EXCEPTION 'Missing public USAGE';
  END IF;
  FOR t IN SELECT * FROM (VALUES
    ('app_users', ARRAY['SELECT','INSERT','UPDATE']),
    ('audit_logs', ARRAY['SELECT','INSERT']),
    ('bookings', ARRAY['SELECT','INSERT','UPDATE','DELETE']),
    ('login_sessions', ARRAY['SELECT','INSERT','DELETE']),
    ('pre_bookings', ARRAY['SELECT','INSERT','UPDATE']),
    ('products', ARRAY['SELECT','INSERT','UPDATE','DELETE'])
  ) AS expected(tbl,commands) LOOP
    IF to_regclass(t.tbl) IS DISTINCT FROM to_regclass('public.' || t.tbl) THEN
      RAISE EXCEPTION 'Unsafe search_path resolution: %',t.tbl;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid=to_regclass('public.' || t.tbl)
       AND pg_get_userbyid(c.relowner)='postgres' AND c.relrowsecurity
       AND NOT c.relforcerowsecurity AND row_security_active(c.oid)) THEN
      RAISE EXCEPTION 'Ownership/RLS drift: %',t.tbl;
    END IF;
    FOREACH op IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES'] LOOP
      allowed := op=ANY(t.commands);
      IF has_table_privilege(current_user,'public.' || t.tbl,op) <> allowed
         OR has_table_privilege(current_user,'public.' || t.tbl,op || ' WITH GRANT OPTION') THEN
        RAISE EXCEPTION 'Table privilege mismatch: %, %',t.tbl,op;
      END IF;
      IF op IN ('INSERT','UPDATE','REFERENCES') AND NOT allowed
         AND has_any_column_privilege(current_user,'public.' || t.tbl,op) THEN
        RAISE EXCEPTION 'Excess column privilege: %, %',t.tbl,op;
      END IF;
    END LOOP;
    IF current_setting('server_version_num')::integer >= 170000 THEN
      IF has_table_privilege(current_user,'public.' || t.tbl,'MAINTAIN') THEN
        RAISE EXCEPTION 'Excess MAINTAIN privilege: %',t.tbl;
      END IF;
    END IF;
    seq := pg_get_serial_sequence('public.' || t.tbl,'id');
    IF seq IS NULL OR NOT has_sequence_privilege(current_user,seq,'USAGE')
       OR has_sequence_privilege(current_user,seq,'SELECT')
       OR has_sequence_privilege(current_user,seq,'UPDATE')
       OR has_sequence_privilege(current_user,seq,'USAGE WITH GRANT OPTION') THEN
      RAISE EXCEPTION 'Sequence privilege mismatch: %',t.tbl;
    END IF;
    IF (SELECT count(*) FROM pg_policies WHERE schemaname='public'
        AND tablename=t.tbl) <> cardinality(t.commands) THEN
      RAISE EXCEPTION 'Unexpected policy count: %',t.tbl;
    END IF;
    FOREACH op IN ARRAY t.commands LOOP
      pname := 'gas_app_runtime_' || t.tbl || '_' || lower(op);
      IF NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname='public'
        AND p.tablename=t.tbl AND p.policyname=pname AND p.cmd=op
        AND p.roles=ARRAY['gas_app_runtime']::name[] AND p.permissive='PERMISSIVE'
        AND p.qual IS NOT DISTINCT FROM
          (CASE WHEN op='INSERT' THEN NULL::text ELSE 'true' END)
        AND p.with_check IS NOT DISTINCT FROM
          (CASE WHEN op IN ('INSERT','UPDATE') THEN 'true' ELSE NULL::text END)) THEN
        RAISE EXCEPTION 'Policy mismatch: %',pname;
      END IF;
    END LOOP;
    -- Resolve all columns as well as checking an actual RLS SELECT path.
    EXECUTE format('SELECT * FROM public.%I LIMIT 0',t.tbl);
    EXECUTE format('SELECT 1 FROM public.%I LIMIT 1',t.tbl);
  END LOOP;
END $$;
SELECT c.relname, row_security_active(c.oid) AS runtime_rls_active
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN
 ('app_users','audit_logs','bookings','login_sessions','pre_bookings','products');
-- Manual review gate: inspect bodies/dependencies of every returned definer routine.
SELECT p.oid::regprocedure AS callable_definer, pg_get_userbyid(p.proowner) AS owner
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE p.prosecdef AND has_schema_privilege(current_user,n.oid,'USAGE')
  AND has_function_privilege(current_user,p.oid,'EXECUTE');
COMMIT;
```

Before A and again after F, use the existing full ACL/membership/column/function catalog inventory as postgres; compare snapshots for anon/authenticated/service_role. Only the new runtime role/grants/policies should differ. Verify anon/authenticated still have no BYPASSRLS, no ownership or path to privileged roles, and no applicable policies on these tables; zero row access must remain. service_role must retain BYPASSRLS and its previous ACLs. Do not grant the new role to authenticator. Check effective access outside these six tables, grant options on columns, database/schema grants, role-level settings and callable functions as a separate catalog-review gate; the automated block is not a complete privilege-escalation audit. Any unresolved path blocks G.

### API isolation and unchanged service role — admin verification, NOT EXECUTED

Run this read-only block as postgres **before A**, **after F**, and **after J**. Retain and compare its sanitized outputs: existing role flags, membership edges, table/column ACLs must be identical except for new gas_app_runtime grants. Schema/database/function/default ACLs from the full inspection runbook must also remain unchanged. The assertions reject any policy applicable to anon/authenticated, even a restrictive policy; the intended state needs none. These are catalog checks, not a claim that every possible view/RPC exposure has been audited.

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
DO $$
DECLARE api_role text; tbl text; target oid;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Use migration/admin identity for API verification';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles
                 WHERE rolname='service_role' AND rolbypassrls) THEN
    RAISE EXCEPTION 'service_role bypass changed';
  END IF;
  FOREACH api_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=api_role
                   AND NOT rolsuper AND NOT rolbypassrls) THEN
      RAISE EXCEPTION 'Unsafe or missing API role: %',api_role;
    END IF;
    -- Conservative transitive membership check, including SET ROLE paths.
    IF EXISTS (SELECT 1 FROM pg_roles r
               WHERE r.rolname <> api_role
                 AND pg_has_role(api_role,r.oid,'MEMBER')
                 AND (r.rolsuper OR r.rolbypassrls
                      OR r.rolname IN ('postgres','gas_app_runtime'))) THEN
      RAISE EXCEPTION 'Privileged membership path: %',api_role;
    END IF;
    FOREACH tbl IN ARRAY ARRAY['app_users','audit_logs','bookings',
                              'login_sessions','pre_bookings','products'] LOOP
      target := to_regclass('public.' || tbl);
      IF target IS NULL OR NOT EXISTS (
        SELECT 1 FROM pg_class WHERE oid=target AND relrowsecurity
          AND NOT relforcerowsecurity AND pg_get_userbyid(relowner)='postgres'
      ) THEN
        RAISE EXCEPTION 'Table RLS/ownership drift: %',tbl;
      END IF;
      IF EXISTS (
        SELECT 1 FROM pg_policy p CROSS JOIN LATERAL unnest(p.polroles) pr(role_oid)
        WHERE p.polrelid=target AND
          CASE WHEN pr.role_oid=0 THEN true
               ELSE pg_has_role(api_role,pr.role_oid,'MEMBER') END
      ) THEN
        RAISE EXCEPTION 'Policy applicable to API role: %, %',api_role,tbl;
      END IF;
    END LOOP;
  END LOOP;
END $$;
SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb,
       rolcanlogin, rolreplication, rolinherit
FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','postgres')
ORDER BY rolname;
SELECT pg_get_userbyid(roleid) AS granted_role,
       pg_get_userbyid(member) AS member, admin_option
FROM pg_auth_members ORDER BY 1,2;
SELECT c.relname, c.relacl, a.attname, a.attacl
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
WHERE n.nspname='public' AND c.relname IN
 ('app_users','audit_logs','bookings','login_sessions','pre_bookings','products')
ORDER BY c.relname,a.attnum;
COMMIT;
```

In the disposable drill, also use transaction-local SET ROLE anon and authenticated to confirm SELECT returns no rows (or permission denied if the existing ACL denies SELECT), INSERT is rejected, and UPDATE/DELETE cannot affect rows. Never infer denial from an empty fixture: seed known rows first as admin. Verify service_role sees the same fixture rows and retains baseline operations. Do not test TRUNCATE against production; RLS does not constrain it.

## Exact post-switch verification SQL — step J, NOT EXECUTED

Run through the **deployed application's server-side Postgres.js connection** with its new environment (private diagnostic session, no public endpoint and no URL/options logging). A separate psql login proves only that login, not the Vercel deployment. Run the complete step-G transaction again through that connection, followed by:

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
DO $$
BEGIN
  IF current_user <> 'gas_app_runtime' OR session_user <> 'gas_app_runtime'
     OR current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Production cutover identity mismatch';
  END IF;
END $$;
SELECT current_user, session_user, current_database();
SELECT c.relname, pg_get_userbyid(c.relowner) AS owner,
       c.relrowsecurity, c.relforcerowsecurity,
       row_security_active(c.oid) AS runtime_rls_active
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN
 ('app_users','audit_logs','bookings','login_sessions','pre_bookings','products');
SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies WHERE schemaname='public' AND tablename IN
 ('app_users','audit_logs','bookings','login_sessions','pre_bookings','products')
ORDER BY tablename,cmd;
SELECT ssl, version, cipher FROM pg_stat_ssl WHERE pid=pg_backend_pid();
COMMIT;
```

Expect gas_app_runtime for both identities, six postgres-owned RLS-active tables with FORCE false and exactly 19 scoped policies. pg_stat_ssl describes the pooler-to-database hop; retain the already verified app-to-pooler TLS evidence. Run on new/cold and recycled connections and verify the production deployment ID/alias. Never infer success solely from unchanged application pages (cached responses may conceal the old role).

## Exact proposed rollback SQL — NOT EXECUTED

If the creation transaction fails, roll it back (`ROLLBACK;`); it must not partially commit. After a committed rollout, first restore the protected **old Vercel Production DATABASE_URL** secret version (postgres project-suffixed username and old password), preserve the verified DATABASE_SSL_CA/TLS and all pool settings, and **redeploy the previous working configuration**. Verify the production alias, postgres identity and application login/read/write/audit health before cleanup. Then drain all gas_app_runtime app/pooler connections. Returning to postgres temporarily reintroduces the verified HIGH finding. Do not drop the role while workers still use it. Cleanup is optional and must wait until application recovery is confirmed; leaving the new role/policies temporarily is safer than interrupting recovery. The SQL below reverses only the role, policies and grants introduced above, assuming no subsequent dependencies or grants. Confirm sequence mappings are unchanged. Stop on drift; do not use CASCADE, DROP OWNED or broad regrants. Existing data, RLS flags, ownership and service_role are untouched.

```sql
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
ALTER ROLE gas_app_runtime NOLOGIN;
DROP POLICY IF EXISTS gas_app_runtime_bookings_select ON public.bookings;
DROP POLICY IF EXISTS gas_app_runtime_bookings_insert ON public.bookings;
DROP POLICY IF EXISTS gas_app_runtime_bookings_update ON public.bookings;
DROP POLICY IF EXISTS gas_app_runtime_bookings_delete ON public.bookings;
DROP POLICY IF EXISTS gas_app_runtime_pre_bookings_select ON public.pre_bookings;
DROP POLICY IF EXISTS gas_app_runtime_pre_bookings_insert ON public.pre_bookings;
DROP POLICY IF EXISTS gas_app_runtime_pre_bookings_update ON public.pre_bookings;
DROP POLICY IF EXISTS gas_app_runtime_products_select ON public.products;
DROP POLICY IF EXISTS gas_app_runtime_products_insert ON public.products;
DROP POLICY IF EXISTS gas_app_runtime_products_update ON public.products;
DROP POLICY IF EXISTS gas_app_runtime_products_delete ON public.products;
DROP POLICY IF EXISTS gas_app_runtime_app_users_select ON public.app_users;
DROP POLICY IF EXISTS gas_app_runtime_app_users_insert ON public.app_users;
DROP POLICY IF EXISTS gas_app_runtime_app_users_update ON public.app_users;
DROP POLICY IF EXISTS gas_app_runtime_login_sessions_select ON public.login_sessions;
DROP POLICY IF EXISTS gas_app_runtime_login_sessions_insert ON public.login_sessions;
DROP POLICY IF EXISTS gas_app_runtime_login_sessions_delete ON public.login_sessions;
DROP POLICY IF EXISTS gas_app_runtime_audit_logs_select ON public.audit_logs;
DROP POLICY IF EXISTS gas_app_runtime_audit_logs_insert ON public.audit_logs;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.bookings, public.products FROM gas_app_runtime;
REVOKE SELECT, INSERT, UPDATE ON public.pre_bookings, public.app_users FROM gas_app_runtime;
REVOKE SELECT, INSERT, DELETE ON public.login_sessions FROM gas_app_runtime;
REVOKE SELECT, INSERT ON public.audit_logs FROM gas_app_runtime;
DO $$
DECLARE tbl text; seq text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['bookings','pre_bookings','products',
                            'app_users','login_sessions','audit_logs'] LOOP
    seq := pg_get_serial_sequence(format('public.%I', tbl), 'id');
    IF seq IS NULL THEN RAISE EXCEPTION 'Missing id sequence: %', tbl; END IF;
    EXECUTE format('REVOKE USAGE ON SEQUENCE %s FROM gas_app_runtime', seq::regclass);
  END LOOP;
END $$;
REVOKE USAGE ON SCHEMA public FROM gas_app_runtime;
REVOKE CONNECT ON DATABASE postgres FROM gas_app_runtime;
DROP ROLE gas_app_runtime;
COMMIT;
```

DROP ROLE fails if unexpected dependencies remain, rolling back this transaction when the client issues ROLLBACK. NOLOGIN alone does not terminate existing sessions; drain them before cleanup. Retire the new credential from secret storage after successful rollback. This inverse requires no restoration of shared ACLs because this proposal never changes them.

## Phase 4B-BACKUP: status and options

**Scope:** documentation only. The user confirms this production project is on **Free**. Public plan documentation was checked on **2026-09-10**; no Dashboard, production database or backup storage was accessed. Existing TLS code/tests and the proposed role SQL are unchanged by this update. Latest evidence now confirms a production pg_dump and successful pg_restore --list. Exact snapshot recency, off-site copies, retention enforcement and a full restore drill remain **unverified**; recovery assurance is not yet closed.

Free does not provide customer-accessible managed backup recovery/downloads or PITR; Supabase recommends regular exports stored off-site. Do not rely on possible internal provider backups or assume an upgrade will recover a historical incident. [Production checklist](https://supabase.com/docs/guides/deployment/going-into-prod), [backup guidance](https://supabase.com/docs/guides/platform/backups).

| Option | Protection | Operational consequence |
| --- | --- | --- |
| **A — Upgrade to Pro** | Automatic daily backups with **7 days** of accessible history | Verify the first completed backup after upgrading; perform an isolated drill. Daily snapshots can lose about a day's bookings. Retain independent off-site exports for a separate recovery path. |
| **B — Stay on Free** | Scheduled custom-format logical exports to storage outside the Supabase project | Own scheduling, encrypted storage, monitoring, retention and restoration. Recovery is limited to successful dump snapshots; this is not PITR. |

Pro's daily backups do **not** include PITR. PITR is a separate paid add-on requiring at least Small compute, with 7/14/28-day recovery windows; enabling it replaces daily backups. Provider database backups exclude Storage object bytes. [Supabase backup capabilities](https://supabase.com/docs/guides/platform/backups).

**Recommendation:** use Option B immediately once execution is authorized, even if an upgrade is planned. Prefer Option A plus independent off-site exports when budget allows; an upgrade alone does not meet an hourly recovery objective. If losing even an hour of bookings/payments is unacceptable, evaluate paid PITR. No upgrade, scheduler or storage integration is created here.

### Proposed recovery objectives, frequency and retention

These are operational recommendations for this booking system, not user-approved guarantees:

- **Recovery point objective (RPO):** target no more than **1 hour** of lost committed bookings. Schedule an hourly dump around the clock, for example minute 10 of each hour in UTC. Account for dump/upload duration: the latest off-site snapshot age, not job start time, measures exposure. If processing delays routinely exceed the target, run every 30 minutes or revise the objective explicitly.
- **Recovery time objective (RTO):** initially target **4 hours** from incident declaration to a validated isolated recovery, including obtaining keys/secrets, provisioning, restore and application checks. Production cutover requires its own plan and authorization. Measure the first drill before claiming this target is achievable.
- **Retention:** keep every hourly snapshot for **48 hours**, one successful snapshot per day for **30 days**, and one per week for **12 weeks**. These are overlapping tiers, not instructions to delete all copies after 48 hours. Optional longer retention needs an explicit business need because archives contain personal data and session/password hashes.
- **Additional copies:** take a verified backup before an authorized schema change or bulk data operation. Preserve it through the change's acceptance period. Do not rerun a migration as a backup test.
- **Drills:** first restore before declaring coverage, then **monthly**, and after material schema, PostgreSQL-version or backup-tool changes. Include the newest snapshot and periodically an older retained copy.

### Option B scheduling and off-site controls

Use a dedicated external scheduler/runner, not a request handler or the production Next.js runtime. No workflow is installed in this phase. Assign a primary operator and backup operator; store recovery instructions and decryption-key access where loss of the Supabase account does not remove them.

1. Supply connection variables from the scheduler's secret store. Restrict the runner to trusted jobs; do not expose production secrets to pull requests/forks, job debug dumps or shared-machine users. PGPASSWORD avoids command-line/history disclosure but process environments are still sensitive. Do not commit credentials, CA configuration containing secrets, dumps or manifests. A CA certificate itself is public trust material, not a password.
2. Run one backup at a time with a scheduler concurrency lock. Impose a 20-minute job deadline initially, tune from measured size, and retry transient failures at most twice with delay. A dump reads production and takes access-share locks; avoid concurrent schema changes, limit lock wait and monitor load. No production DDL, grants or role creation are part of this plan. An existing authorized backup identity must read every included row; the proposed restricted runtime role is not a substitute.
3. Write to a unique run directory on encrypted ephemeral disk with restrictive permissions. Complete dump, TOC inspection and checksum before marking the local archive usable. A custom-format dump is **not encrypted**.
4. Encrypt the dump and restricted manifest before upload using an organization-approved tool/key (for example age public-key encryption, with the recovery private key held separately). Store encrypted objects in a private object-storage bucket under a separate account/provider or independently controlled backup account. Use TLS uploads, storage encryption, versioning and immutability where available. Give the backup uploader create access without general deletion rights; manage retention with separate credentials/lifecycle rules. Keep keys for as long as retained backups need them.
5. Upload the encrypted archive, encrypted metadata and ciphertext checksum under an immutable timestamp/run key. Verify remote object size and checksum using the provider's documented checksum facility or a download-and-hash check; an ETag is not universally a content checksum. Only then record success and dispose of the ephemeral plaintext volume. Failed `.partial` archives are never promoted or uploaded as successful backups.
6. Emit only run ID, UTC snapshot/start/finish times, duration, bytes, exit status and verification status to routine logs. Alert immediately on dump/list/encryption/upload/verification failure and when the newest verified off-site snapshot is over **90 minutes** old. That alert is an escalation threshold, not achievement of the 1-hour RPO. Investigate retries and age daily. Never prune the last validated copy because a new job merely started.

## Manual logical backup — documented only

Execute against production only with explicit backup authorization. Use an encrypted, access-controlled directory outside the repo and web roots; a dump contains personal information, password hashes, session token hashes and audit details. Disable shell tracing and CI command echo. Inject individual libpq PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD and PGSSLROOTCERT variables from a secret manager; never paste a password or URL in a command. Alternatively use the hidden password prompt below in a Bash subshell. Do not use `pg_dump "$DATABASE_URL"`, which exposes credentials in process arguments.

Use the Dashboard's **direct database endpoint on 5432**; if IPv6 is unavailable, use its supported **session pooler on 5432**, after testing. Do not use transaction port 6543 for this runbook. Use a pg_dump version matching the server major where possible (never older than the server major); use matching pg_restore and a compatible target server. Inventory extensions and cross-schema dependencies first.

```bash
# Bash; PGHOST/PGPORT/PGDATABASE/PGUSER/PGSSLROOTCERT supplied securely first.
(
  set +x
  set -euo pipefail
  umask 077
  : "${PGHOST:?}" "${PGPORT:?}" "${PGDATABASE:?}" "${PGUSER:?}" "${PGSSLROOTCERT:?}"
  test "$PGPORT" = 5432
  export PGHOST PGPORT PGDATABASE PGUSER PGSSLROOTCERT
  export PGSSLMODE=verify-full PGCONNECT_TIMEOUT=10
  [[ "$PGDATABASE" =~ ^[A-Za-z0-9_]+$ ]] # Plain database name, never conninfo.
  if test -z "${PGPASSWORD:-}"; then
    read -r -s -p 'Backup database password: ' PGPASSWORD
    echo
  fi
  export PGPASSWORD
  trap 'unset PGPASSWORD' EXIT
  : "${BACKUP_DIR:?Set an approved encrypted backup directory outside the repository}"
  test -d "$BACKUP_DIR"
  backup_run_dir="$(mktemp -d "$BACKUP_DIR/green-engine-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")"
  backup_file="$backup_run_dir/green-engine-$(date -u +%Y%m%dT%H%M%SZ).dump"
  snapshot_args=()
  if test -n "${BACKUP_SNAPSHOT:-}"; then snapshot_args=(--snapshot="$BACKUP_SNAPSHOT"); fi
  pg_dump --no-password --format=custom --schema=public \
    --lock-wait-timeout=5s "${snapshot_args[@]}" --file="$backup_file.partial"
  test -s "$backup_file.partial"
  pg_restore --list "$backup_file.partial" > "$backup_file.toc"
  mv "$backup_file.partial" "$backup_file"
  (cd "$backup_run_dir"; shasum -a 256 "${backup_file##*/}" > "${backup_file##*/}.sha256")
  # Still only a local archive: encrypt, upload and verify as described above.
)
```

This exports **schema and data for public**, including the six tables, sequences, functions, triggers and indexes; no data-only/schema-only switch. It is an application backup, not a full Supabase project backup. Include additional application schemas and the migration journal schema if catalog inspection finds dependencies there; do not silently omit them. Managed auth/storage schemas, role definitions/passwords, external storage, Redis, deployment secrets and platform settings require separate recovery plans. The backup role must be able to read every included row, including audit_logs despite RLS; do not add `--enable-row-security` to accept a filtered dump. Review stderr and reject any failed/incomplete export. Dump is snapshot-consistent; capture validation counts using that same exported snapshot when exact comparison is required. A separate live count after dump may differ due to legitimate writes. [pg_dump documentation](https://www.postgresql.org/docs/current/app-pgdump.html).

### Snapshot manifest and archive acceptance

Save source PostgreSQL version, pg_dump version, UTC snapshot/start/end times, source alias (no URL), included schemas, application revision/migration definitions, TOC and SHA-256 in the restricted backup manifest. Inspect `pg_restore --list` for all six TABLE and TABLE DATA entries, all six id sequences and SEQUENCE SET entries, indexes, constraints, functions, triggers, and RLS entries. Listing success proves the archive header/TOC is readable, not that every data block restores successfully.

For exact source-to-restore row counts during live writes, use a shared snapshot: in a separate source `psql -X --no-password` session with the same secure source PG variables, start `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;`, run `SELECT pg_export_snapshot();`, and capture the six-table count query below **in that transaction**. Pass the returned snapshot ID as BACKUP_SNAPSHOT to the dump shell. Keep that transaction open until pg_dump finishes; then COMMIT. Exported snapshots work only while the exporting transaction exists in the same database. A scheduler implementation must own and close this session on success/failure; do not leave an idle transaction behind. All these source commands are read-only proposals, not executed here.

Without shared-snapshot orchestration, the dump is still internally consistent, but separate live counts are only approximate comparators. Record that limitation; establish an exact count manifest from the first isolated restore and compare later drills of the same artifact against it. Sequences are nontransactional, so check safe next-ID state in the restored database separately rather than expecting source sequence equality during concurrent writes.

## Restore into a disposable/test database only

Explicitly verify target identity against the production inventory before connecting. Use a newly created isolated database with no application objects, compatible extensions and no public app traffic. For a new Supabase project, inspect the archive TOC for managed extension/schema conflicts and use a reviewed restore list; never add --clean to resolve conflicts. Provision required policy role names without production passwords. Do not restore source ACLs or ownership onto the new project.

```bash
# Bash. Set TARGET_PG* separately; never reuse source PG* implicitly.
(
  set +x
  set -euo pipefail
  umask 077
  : "${TARGET_PGHOST:?}" "${TARGET_PGPORT:?}" "${TARGET_PGDATABASE:?}"
  : "${TARGET_PGUSER:?}" "${TARGET_PGSSLROOTCERT:?}" "${TARGET_PGPASSWORD:?}"
  : "${BACKUP_FILE:?}" "${DISPOSABLE_TARGET_CONFIRMED:?}"
  test "$DISPOSABLE_TARGET_CONFIRMED" = yes
  : "${APPROVED_TEST_PGHOST:?}" "${APPROVED_TEST_PGDATABASE:?}"
  : "${PRODUCTION_PGHOST:?}"
  # Approved inventory values must be supplied independently of TARGET_PG*.
  test "$TARGET_PGHOST" = "$APPROVED_TEST_PGHOST"
  test "$TARGET_PGDATABASE" = "$APPROVED_TEST_PGDATABASE"
  test "$TARGET_PGHOST" != "$PRODUCTION_PGHOST"
  test "$TARGET_PGPORT" = 5432
  [[ "$TARGET_PGDATABASE" =~ ^[A-Za-z0-9_]+$ ]]
  export PGHOST="$TARGET_PGHOST" PGPORT="$TARGET_PGPORT"
  export PGDATABASE="$TARGET_PGDATABASE" PGUSER="$TARGET_PGUSER"
  export PGPASSWORD="$TARGET_PGPASSWORD" PGSSLROOTCERT="$TARGET_PGSSLROOTCERT"
  export PGSSLMODE=verify-full PGCONNECT_TIMEOUT=10
  trap 'unset PGPASSWORD TARGET_PGPASSWORD' EXIT
  # Decrypt to encrypted scratch disk first; obtain checksum sidecar with the archive.
  (cd "$(dirname "$BACKUP_FILE")"; shasum -a 256 -c "${BACKUP_FILE##*/}.sha256")
  # Operator must verify this identity is the approved empty disposable target.
  psql -X --no-password -v ON_ERROR_STOP=1 -c \
    'SELECT current_database(), current_user, inet_server_addr(), inet_server_port();'
  psql -X --no-password -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')) THEN
    RAISE EXCEPTION 'Disposable target is not empty';
  END IF;
END $$;
SQL
  pg_restore --list "$BACKUP_FILE" > "$BACKUP_FILE.restore.toc"
  pg_restore --no-password --exit-on-error --single-transaction \
    --no-owner --no-privileges --dbname="$PGDATABASE" "$BACKUP_FILE"
)
```

The confirmation variable and host/name checks are operator guards, not independent proof of target identity. Independently verify the test project and all its endpoint aliases against production before running: a shared pooler hostname can serve multiple projects, so this conservative host inequality may reject a legitimate target. Prefer distinct direct endpoints and never weaken the gate to accommodate an unverified target. The restore role must be scoped to the disposable target, and it must have no path to production credentials. Read-only identity output cannot pause this script for review; verify the inventory beforehand. Full archive restore orders pre-data schema/functions, data/sequence state, then post-data indexes/constraints/triggers. This avoids firing new-record validation triggers against legacy rows during data loading. Do not restore all schema/triggers first and then import legacy data. With --no-owner the restore executor owns created objects; apply the reviewed runtime grants/policies separately after validation. Never use --clean, --create, --disable-triggers or a production target here. Stop on any error and investigate the disposable database. [pg_restore documentation](https://www.postgresql.org/docs/current/app-pgrestore.html).

## Recovery validation checklist

Run catalog/aggregate comparisons first, with no customer details in reports. Perform mutation-based checks **only in the disposable restore**; preserve baseline counts before tests and roll back test transactions where possible (sequence increments do not roll back).

- [ ] Compare exact row counts for all six tables to the dump snapshot manifest; separately record count of legacy NULL manufacture_year rows. Do not “repair” historical data to fit new-record rules.
- [ ] Booking numbers: zero NULL/duplicate booking_no; compare identifiers to baseline. A synthetic new insert must receive the expected GE-date-id format from the trigger, including >6-digit IDs. Do not regenerate historical booking numbers.
- [ ] Capacity: verify the unique index is valid and ready, the check permits NULL or 1–3, and no duplicate non-NULL branch/date/capacity_slot groups exist under its actual predicate. 0009 excludes only 'Цуцлагдсан', whereas 0011 plate uniqueness excludes both that and 'cancelled'; preserve and report this difference without changing business logic.
- [ ] Duplicate plate index: definition must normalize upper(regexp_replace(btrim(plate), '[[:space:]]+', '', 'g')), include date/time, and exclude both cancellation spellings. Test active normalized duplicates are rejected and cancelled cases follow the predicate. Confirm obsolete booking_branch_day_unique is absent; inspect duplicate equivalent indexes without dropping anything.
- [ ] 0012 functions/triggers: inspect exact bodies/settings/bindings as below. On disposable data, NULL, 1949 and next-year+1 INSERTs fail for both tables; 1950 and next year succeed with otherwise valid fixtures. Existing legacy rows and ordinary UPDATEs remain compatible because triggers are INSERT-only.
- [ ] Audit logs: counts, timestamp bounds, four audit indexes and entity references match baseline. The current production identity remains postgres. Only if separately testing the future role proposal in the disposable database, verify gas_app_runtime can SELECT/INSERT but UPDATE/DELETE fail. Verify an application mutation and its audit insert commit/roll back together.
- [ ] Users and sessions: counts/active-role distributions and expiry ranges match; do not print hashes. Test synthetic login/logout/user invalidation against isolated secrets and isolated Redis. Keep restored production sessions inaccessible; any session invalidation decision belongs to a separately approved recovery release.
- [ ] Products: count, active state and prices match; CRUD works as permitted.
- [ ] Preorder linkage: count non-NULL converted_booking_id values lacking a bookings row; compare to baseline, because no FK is defined. Check converted status/link consistency and synthetic conversion transaction behavior.
- [ ] Reports: run app/reports/query.ts through the isolated app and compare totals/filter combinations, payments, source linkage, cancelled records and pagination to the baseline/known fixtures. Existing tests/reports.test.mjs helps but does not prove production restore correctness.
- [ ] Each id sequence: inspect pg_get_serial_sequence, last_value, is_called, increment and MAX(id). For increment 1 the next value (last_value+1 when called; last_value otherwise) must exceed existing IDs. Check all six, not only bookings. Do not call nextval/setval on production to test. If a restore needs setval repair, investigate missing SEQUENCE SET entries and repair only the disposable target under a separately reviewed command.
- [ ] Capture restored ownership, RLS flags and policies separately from production ACLs. For a separately authorized test of the future restricted role, verify it cannot create a table/schema, truncate, alter/drop, SET ROLE to an owner, or bypass audit RLS; run negative privilege tests only in the disposable database. Do not mark these controls passed for the current postgres runtime. Confirm no grant-option paths and inspect PUBLIC/default ACLs again.
- [ ] Record archive checksum, source/target versions, extension versions, snapshot time, counts, failures, actual recovery duration and achieved RPO/RTO. A restore is not validated until the application checks pass.

### Concrete read-only validation SQL — disposable target

Run after restore with the verified test target PG environment. Compare results to the manifest before synthetic writes; stop on any SQL error or missing object. The count query can also be used inside the source snapshot transaction described above. All SQL here remains unexecuted.

```sql
BEGIN READ ONLY;
-- Must return six non-NULL relations.
SELECT name, to_regclass('public.' || name) AS relation
FROM unnest(ARRAY['app_users','audit_logs','bookings','login_sessions',
                  'pre_bookings','products']) AS names(name);

-- Exact counts; no customer rows/hashes printed.
SELECT 'app_users' AS table_name, count(*) AS rows FROM public.app_users
UNION ALL SELECT 'audit_logs', count(*) FROM public.audit_logs
UNION ALL SELECT 'bookings', count(*) FROM public.bookings
UNION ALL SELECT 'login_sessions', count(*) FROM public.login_sessions
UNION ALL SELECT 'pre_bookings', count(*) FROM public.pre_bookings
UNION ALL SELECT 'products', count(*) FROM public.products;

-- Each anomaly count should be zero or investigated against the source baseline.
SELECT count(*) FILTER (WHERE booking_no IS NULL OR booking_no = '') AS missing_booking_no,
       count(*) FILTER (WHERE booking_no !~ '^GE-[0-9]{6}-[0-9]{6,}$') AS malformed_booking_no,
       count(*) FILTER (WHERE capacity_slot IS NOT NULL
                        AND capacity_slot NOT BETWEEN 1 AND 3) AS invalid_capacity_slot,
       count(*) FILTER (WHERE manufacture_year IS NULL) AS legacy_null_year
FROM public.bookings;
SELECT count(*) AS duplicate_booking_no_groups FROM (
  SELECT booking_no FROM public.bookings GROUP BY booking_no HAVING count(*) > 1
) AS duplicates;
SELECT count(*) AS duplicate_capacity_groups FROM (
  SELECT branch, booking_date, capacity_slot FROM public.bookings
  WHERE capacity_slot IS NOT NULL AND status <> 'Цуцлагдсан'
  GROUP BY branch, booking_date, capacity_slot HAVING count(*) > 1
) AS duplicates;
SELECT count(*) FILTER (WHERE manufacture_year IS NULL) AS legacy_null_year
FROM public.pre_bookings;
SELECT count(*) AS rows, min(created_at) AS earliest, max(created_at) AS latest
FROM public.audit_logs;

SELECT i.indrelid::regclass AS table_name, i.indexrelid::regclass AS index_name,
       i.indisvalid, i.indisready, pg_get_indexdef(i.indexrelid) AS definition
FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN
  ('app_users','audit_logs','bookings','login_sessions','pre_bookings','products');
SELECT conname, convalidated, pg_get_constraintdef(oid) AS definition
FROM pg_constraint WHERE conrelid='public.bookings'::regclass;
-- Expected booking_capacity_slot_check and booking_branch_day_capacity_slot_unique;
-- also bookings_booking_no_unique, PKs, audit indexes and plate uniqueness index.

-- No nextval/setval: inspect all six default sequences and verify the next ID.
DO $$
DECLARE tbl text; seq text; last_id bigint; called boolean;
        max_id bigint; increment_by bigint; cycles boolean;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['app_users','audit_logs','bookings',
                            'login_sessions','pre_bookings','products'] LOOP
    seq := pg_get_serial_sequence(format('public.%I',tbl),'id');
    IF seq IS NULL THEN RAISE EXCEPTION 'Missing sequence: %',tbl; END IF;
    EXECUTE format('SELECT last_value, is_called FROM %s',seq::regclass)
      INTO last_id, called;
    SELECT seqincrement, seqcycle INTO increment_by, cycles
      FROM pg_sequence WHERE seqrelid=seq::regclass;
    EXECUTE format('SELECT max(id) FROM public.%I',tbl) INTO max_id;
    IF increment_by <> 1 OR cycles THEN
      RAISE EXCEPTION 'Unexpected sequence configuration: %',tbl;
    END IF;
    IF max_id IS NOT NULL AND
       (CASE WHEN called THEN last_id + increment_by ELSE last_id END) <= max_id THEN
      RAISE EXCEPTION 'Sequence would collide with restored IDs: %',tbl;
    END IF;
    RAISE NOTICE 'Sequence validated: %',tbl;
  END LOOP;
END $$;
COMMIT;
```

Use the function/trigger catalog queries in the next section to verify `generate_booking_no()`, both manufacture-year validators, their exact bindings and enabled status. Confirm `bookings_booking_no_before_insert` runs BEFORE INSERT FOR EACH ROW, and compare its function body to migration 0010. Then run the checklist's synthetic valid/invalid inserts only in the isolated target; catalog presence is not a substitute for those behavior checks. Do not repair production while validating a backup. If 0012 was missing at backup time, record a pre-existing protection gap rather than silently calling the restore correct or modifying the archive.

Keep the restored database private, use isolated application/Redis/session-signing secrets, block outbound notifications and integrations, and destroy the disposable database and plaintext scratch storage after retaining the restricted validation report under the approved retention policy. No production recovery or cutover is included in this runbook.

## Migrations 0006–0012 and recovery

| Migration | Expected evidence / recovery risk |
| --- | --- |
| 0006 | Four core tables, id sequences and initial unique indexes; IF NOT EXISTS does not prove matching definitions. |
| 0007 | pre_bookings and bookings advance_type/advance_note; column additions are not blindly repeatable. |
| 0008 | booking_branch_day_unique removed. |
| 0009 | capacity_slot, range check, backfilled slots, unique branch/day/slot index. Backfill changes data: never rerun for inspection. |
| 0010 | booking_no NOT NULL, unique index, generate_booking_no(), insert trigger, audit_logs/indexes and enabled audit RLS. Contains historical data update. |
| 0011 | manufacture_year smallint on both tables; normalized partial plate/date/time index. **Already applied per user: do not edit or rerun.** |
| 0012 | Two validator functions with fixed search_path, and two BEFORE INSERT row triggers. Execution history uncertain; inspect semantics. |

Read-only inspection, safe to combine with the earlier transaction:

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
SELECT c.relname, a.attname, format_type(a.atttypid,a.atttypmod) AS type,
       a.attnotnull, pg_get_expr(d.adbin,d.adrelid) AS default_expression
FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
WHERE n.nspname='public' AND c.relname IN ('bookings','pre_bookings')
  AND a.attnum>0 AND NOT a.attisdropped;
SELECT c.relname, t.tgname, t.tgenabled, p.oid::regprocedure AS function,
       pg_get_triggerdef(t.oid,true) AS definition
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
WHERE n.nspname='public' AND c.relname IN ('bookings','pre_bookings')
  AND NOT t.tgisinternal;
SELECT p.oid::regprocedure AS function, p.prosecdef, p.proconfig,
       pg_get_functiondef(p.oid) AS definition
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN
 ('generate_booking_no','validate_booking_manufacture_year',
  'validate_pre_booking_manufacture_year');
SELECT i.indexrelid::regclass AS name, i.indisvalid, i.indisready,
       pg_get_indexdef(i.indexrelid) AS definition
FROM pg_index i WHERE i.indrelid IN ('public.bookings'::regclass,'public.pre_bookings'::regclass);
SELECT conname, convalidated, pg_get_constraintdef(oid)
FROM pg_constraint WHERE conrelid IN ('public.bookings'::regclass,'public.pre_bookings'::regclass);
-- Locate any journal before querying it; absence is not proof migrations were skipped.
SELECT n.nspname, c.relname FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE c.relname ILIKE '%migration%' AND c.relkind='r';
COMMIT;
```

0012 is semantically present only if **both** public, zero-argument, RETURNS trigger functions match checked-in logic (required year, inclusive 1950 through CURRENT_DATE year+1, expected exceptions, search_path pg_catalog/public, SECURITY INVOKER), and both correctly bound row triggers execute BEFORE INSERT on their respective tables without a restrictive WHEN clause. Expected names: bookings_validate_manufacture_year_insert and pre_bookings_validate_manufacture_year_insert. Normally tgenabled='O'; 'A' also fires in ordinary sessions but is drift to investigate; 'D' or 'R' does not satisfy ordinary runtime enforcement. Verify session_replication_role is origin for the tested app session. Function existence or trigger name alone is insufficient; inspect overloads and actual trigger function OIDs.

Classify results as **present and matching**, **absent**, or **partial/drifted**. Catalog matching proves current behavior, not historical execution date. Reconcile any migration journal/hash with deployment records without fabricating or manually marking an applied migration. For matching objects, do not rerun 0012. For absence/drift, capture definitions, verify a recoverable backup, restore to an isolated database, reproduce the gap and author a new narrowly scoped repair migration for review. Do not blindly rerun 0006–0012, db push, or 0011. 0012 contains DROP TRIGGER/CREATE OR REPLACE: apparent repeatability does not justify replacing live behavior without inspection. Do not add a global NOT NULL constraint to manufacture_year, because legacy NULLs are intentionally allowed.

## Unresolved items and release decision

The final A–K sequence above supersedes the earlier combined TLS/role rollout. **Do not switch Vercel yet without closing the following gates:**

- Confirm a full disposable restore and application drill; the verified pg_dump and pg_restore --list are necessary evidence but not a completed recovery drill. Confirm archive recency, off-site access/decryption, retention and measured recovery time.
- Inventory PUBLIC TEMP/CREATE, column/other-object ACLs, role memberships/settings, default grants, callable SECURITY DEFINER functions and other escalation paths. Resolve any unsafe effective runtime right before cutover with a separately reviewed remediation. No schema/database owner rights or arbitrary DDL are acceptable.
- Verify actual deployed functions/triggers and migration 0012 semantics; no rerun of 0011/0012 or schema repair is included here. Compare deployment revision with reviewed reads/writes.
- Validate custom-role password authentication through the shared transaction pooler with the verified CA, search_path behavior, all 19 command paths and denied operations in the disposable application drill.
- Record sanitized before/after ACL and policy evidence proving API-role isolation and unchanged service_role behavior, then obtain release authorization. Identify an operator for monitoring and a protected previous Vercel config for rollback.

The final plan is ready for review, not a claim of rollout completion. No SQL, role/password provisioning, deployment, push, production mutation or secret disclosure occurred during this finalization. postgres remains the current runtime identity and the HIGH least-privilege finding stays open.

## Local validation performed

The earlier document reported fixture execution of its old SQL; that does not validate the replacement role proposal. No role SQL was executed during either subsequent update. The role proposal passed static checks for 19 policies and matching rollback drops.

Phase 4B-TLS validation: focused TLS tests passed (4 tests); `npx tsc --noEmit` passed. `npm run build` passed (Next.js 16.3.0 production compilation, TypeScript and static generation); `git diff --check` passed. The new test and documentation files also passed direct whitespace checks because they are currently untracked. No production credentials, live TLS handshake, SQL, deployment or push were involved. Changes are limited to `db/index.ts`, `tests/database-tls.test.mjs` and this document. The verified HIGH runtime-role finding remains open.

Phase 4B-BACKUP validation: documentation-only update; Bash code blocks checked with `bash -n`, Markdown whitespace and `git diff --check` checked. No pg_dump, pg_restore, SQL, backup upload, scheduler installation, production change, deployment or push was executed. Application tests/build were not rerun for this documentation-only phase; the TLS results above are from the preceding phase.

TLS-only revalidation (2026-09-10): the existing four-line implementation required no further code changes. All four focused tests and `npx tsc --noEmit` passed again. `npm run build` failed because Turbopack could not bind its local PostCSS worker port (`Operation not permitted`); an escalated retry failed with the same error. The earlier successful build above is historical, not the result of this rerun. `git diff --check` and direct whitespace checks passed. Production TLS compatibility remains unverified; no deployment, push, secret disclosure or runtime-role change occurred.

Final runtime-role documentation validation: re-reviewed application queries and migrations; statically checked 19 explicit CREATE POLICY names against 19 rollback DROP POLICY names, Markdown fences/whitespace, and ran `git diff --check`. No SQL was executed, including verification SQL or local fixture SQL. Application code and tests were unchanged in this phase.

Finalization recheck (2026-09-10): confirmed the six-table operation matrix against all current app/db query sites, serial/bigserial defaults and the three migration trigger functions. Added exact admin API-isolation assertions and repeatable ACL evidence queries for before/after comparison, all-column SELECT resolution checks, fail-fast client guidance, and IF EXISTS for optional named-policy cleanup. No SQL was executed. `git diff --check`, direct untracked-document whitespace checks and static policy/grant/rollback checks passed; application tests/build were not rerun for documentation-only changes.

## Phase 5B — Automated daily production backup

`.github/workflows/database-backup.yml` schedules a logical backup daily at **18:23 UTC (02:23 the following day in Asia/Shanghai)**, with manual **Run workflow** (`workflow_dispatch`) testing. It does not run on push or pull requests. Scheduled execution starts once the workflow is on the default branch; GitHub may delay scheduled runs.

Configure these GitHub Actions repository secrets before the first manual run:

- `BACKUP_DATABASE_URL`: the password-bearing PostgreSQL URI for the Supabase **Session Pooler**, host `aws-0-ap-southeast-2.pooler.supabase.com`, port `5432`, database `postgres`, username `postgres.xcnhqcctednqbneseibb`. Percent-encode password characters for a URI. Supply no query parameters or fragment; TLS is enforced separately. Never commit the actual URI/password. This is separate from Vercel's application `DATABASE_URL` and the runtime role.
- `SUPABASE_DB_CA`: the PEM CA certificate used to verify Supabase. It is written to a temporary mode-0600 file and supplied through `PGSSLROOTCERT`, with `PGSSLMODE=verify-full`.

Configure the repository **variable** `BACKUP_AGE_PUBLIC_KEY` with the native age public recipient (`age1...`). The repository is **public**: raw production dumps must never be uploaded. Backup artifacts are encrypted with age before upload. Generate and retain the private age identity outside GitHub, offline or in a password manager. **Never store the private key in GitHub, repository files, GitHub secrets, workflow logs or artifacts. Private-key loss means backups cannot be decrypted.** Verify the configured public recipient matches the safely retained private identity before relying on backups.

The runner installs PostgreSQL 17 client tools from the official PostgreSQL Apt repository and `age` from Ubuntu packages (`sudo apt-get install -y --no-install-recommends postgresql-client-17 age`). It reads connection fields only from the secret and puts the password in a temporary mode-0600 `PGPASSFILE`; no URI/password is passed in command arguments. It runs `pg_dump -Fc --schema=public --no-owner --no-acl --no-password --file <dump>` in a private directory under `$RUNNER_TEMP`, checks successful exit and nonzero size, then requires `pg_restore --list <dump>` to succeed. It encrypts with the equivalent of `age -r "$BACKUP_AGE_PUBLIC_KEY" -o "$DUMP_FILE.age" "$DUMP_FILE"`, requires successful exit and a non-empty encrypted file, and removes the raw dump **before** making the encrypted file available to the upload step. The only upload path is the exact `gas-YYYYMMDD-HHMMSS.dump.age` filename (UTC); no directory or wildcard is uploaded. Retention remains **14 days**.

Database command diagnostics and archive listings are suppressed. Python temporary-directory cleanup and shell EXIT/INT/TERM traps remove raw dumps, partial ciphertext, CA and password files on success/failure; an `always()` step also removes runner backup files after upload/failure. Abrupt runner loss may prevent cleanup, and file deletion is not a guarantee of physical secure erasure on hosted storage. Plaintext stays in the ephemeral runner and is never an artifact. The workflow uses only `contents: read` token permission and needs no checkout. No restore, schema change, role/RLS change, Vercel change or application change occurs. Logical dumps take ordinary read locks and consume database resources; monitor scheduled failures and duration.

For a restore drill, download the `.dump.age` artifact and decrypt **locally** with the private identity stored outside GitHub:

```bash
umask 077
age --decrypt -i /secure/local/backup-age-identity.txt -o gas-YYYYMMDD-HHMMSS.dump gas-YYYYMMDD-HHMMSS.dump.age
pg_restore --list gas-YYYYMMDD-HHMMSS.dump
```

After successful decryption and listing, restore only to a **disposable/test database** with separately reviewed prerequisites, permissions and application checks. Never run a restore drill against production. Keep decrypted files local and access-restricted, and remove them after the drill. Never upload the decrypted dump or identity.

This is a **public-schema backup**, not a complete Supabase project backup: other schemas, global roles, ownership/ACL restoration, Storage objects and external configuration are not covered. Archive listing and non-empty ciphertext checks do not prove full recoverability or correct private-key custody. The first manual run and local decryption/disposable restore drill remain operator validation after secrets and the public variable are configured. This change does not configure GitHub values, run a production backup, or enable the schedule until published.
