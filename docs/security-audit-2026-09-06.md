# Green Engine Gas Service — production security audit

Date: 2026-09-06. Scope: current Next.js repository and lockfile, synthetic execution of application security boundaries, npm advisory registry, and one unauthenticated HTTPS HEAD request to the configured production root.

**Audit only.** No application/authentication/session/database implementation, credentials, dependency versions, infrastructure, or production records were changed. No deployment or push. Added only this report, a dependency evidence file, and a test-only harness. Existing pool `max=1`, `prepare:false`, timeouts, capacity logic and audit behavior remain intact; no advisory locks were added.

**Conclusion:** no confirmed critical exploit or protected-route authorization bypass was found. High-priority issues remain in administrator credential handling, session revocation, abuse protection, error logging, and dependency patching. Several security assertions cannot be established from this checkout alone.

Evidence limits: production environment values, database grants/RLS state, negotiated database TLS, WAF rules, backup subscription/settings, production log contents and deployed source revision were not accessed. A missing repository control is not proof a provider-level control is absent. The live header observation applies to `/` at the time of the request, not every route. Tests use synthetic data in isolated PGlite PostgreSQL, fake cookies and a synthetic environment; they do not connect to Supabase.

## CRITICAL

None confirmed. This is not a guarantee that the deployment has no critical issues; in particular, production database exposure and grants remain unverified.

## HIGH

### H1 — Plaintext administrator password fallback

**Affected:** `app/email-auth.ts:12`, `README.md` authentication instructions. Staff passwords are salted hashes, but the special administrator uses `ADMIN_PASSWORD` directly if `ADMIN_PASSWORD_HASH` is absent. The local environment has the plaintext fallback configured and no administrator hash configured; production configuration is unknown. No value is reproduced here.

**Risk:** an environment/configuration disclosure immediately exposes the administrator password; hash work factors and normal staff controls do not protect this path. The README encourages it. No evidence of a password being returned by an API or included in the browser build was found.

**Recommended fix:** provision and verify a valid administrator hash first, then remove the plaintext fallback and fail closed when the hash is missing. Rotate the fallback credential, invalidate administrator sessions, and document emergency recovery. Consider MFA for administrators separately.

**Migration:** no schema migration required; secret provisioning/rotation required. **Regression risk:** high if removed before verifying the administrator hash and recovery path; staged login tests are essential.

### H2 — Password reset does not revoke sessions; special administrator cannot be disabled

**Affected:** `app/email-auth.ts:28–47`, `app/authz.ts:9–17`, `app/api/users/route.ts:28`, `app/api/users/[id]/route.ts:11`.

**Current behavior:** each successful login creates a fresh session, but leaves previous sessions alive. Resetting a staff password through user POST does not remove existing sessions. Staff active/role state is checked per protected request, so disabling a staff account blocks it immediately; reactivating it revives its unexpired sessions. Sessions last 30 days with no idle expiry or periodic rotation. The special administrator is always considered active without consulting `app_users`; rotating its password does not invalidate existing sessions.

**Risk:** a stolen session can retain access after credential recovery, for up to its original expiry. Offboarding the special administrator requires explicit session deletion rather than the staff UI. Synthetic tests reproduce staff reset survival and reactivation survival.

**Recommended fix:** revoke all sessions for the account on password reset and disable; explicitly invalidate administrator sessions during credential rotation. Define absolute/idle lifetimes and an audited emergency revocation procedure. If session versions are introduced, check them consistently on every protected request.

**Migration:** none for deleting existing sessions by normalized email; optional migration for session version/last-activity fields. **Regression risk:** medium: users will be signed out and password reset must remain atomic with revocation.

### H3 — No application-level brute-force or abuse limiter

**Affected:** login POST; both public preorder POST routes; duplicate-check GET; reports GET/XLSX; unbounded preorder reads and expensive audit search.

**Current behavior:** no shared rate-limit implementation, challenge or per-user export concurrency control was found. Public creation has a honeypot and a 15-minute exact phone/vehicle duplicate check, not an IP/account limiter. Vercel firewall configuration is not represented in this checkout and was not verified.

**Risk:** credential guessing, database/hash CPU exhaustion, spam plus audit-table growth, and repeated expensive exports. Duplicate checks are bypassable by changing formatting or vehicle text and are not atomic against concurrent identical requests. `max=1` is per application instance, not a global traffic limit.

**Recommended fix:** combine coarse Vercel WAF limits with atomic shared-store account/user limits before expensive work. Apply public-creation limits to both endpoint aliases. Suggested architecture and initial thresholds appear below; tune using real traffic and avoid permanent account lockouts.

**Migration:** no PostgreSQL migration for a managed Redis/WAF implementation. **Regression risk:** medium: shared branch IPs, retries and intermittent mobile connections need reasonable bursts and clear 429 responses.

### H4 — Sensitive data can enter runtime error logs

**Affected:** `db/index.ts:156–176`; uncaught write paths in `app/api/users/route.ts`, `app/api/users/[id]/route.ts`, `app/api/products/[id]/route.ts`.

**Current behavior:** recognized PostgreSQL/connection failures use a safe diagnostic allowlist. Other failures call `console.error("API request failed", error)` with the entire object. Some write handlers have no outer catch, allowing framework logging of thrown errors. Query wrappers, custom errors and JSON parser errors can carry parameters, hashes or submitted content. A synthetic test confirms the generic handler forwards its original error object.

**Risk:** passwords/hashes, session data or PII can leak into runtime logs when attached to an error. This is a code-path finding, not a claim that actual production logs contain these values. Client responses from the safe helper remain generic.

**Recommended fix:** enforce a diagnostic allowlist everywhere: request ID, route, stage, vetted SQLSTATE/constraint and duration. Do not log raw errors, messages, stacks containing submitted text, request bodies or SQL parameters. Wrap the unhandled handlers without changing business transactions.

**Migration:** none. **Regression risk:** low, but keep enough non-sensitive information to diagnose database failures.

### H5 — Known high-severity dependency findings

**Affected:** `package.json`, `package-lock.json`.

**Current behavior:** `npm audit --omit=dev --json` reports **4 high** affected production packages: `next`, `postcss`, `sharp`, `nanoid`. Full audit reports **14 packages: 9 high, 4 moderate, 1 low; no critical**. These counts include transitive chains, not 14 independent exploitable bugs.

**Risk:** framework/image processing/build-chain vulnerabilities remain in installed versions. Reachability varies: the build has zero registered Server Actions, no application `next/image` use, no configured rewrite/proxy/i18n, and no user-supplied CSS pipeline. Accordingly, the Server Action DoS prerequisite is absent in this build; middleware/rewrites advisories are not demonstrated against this app. These observations do not establish that every framework route or deployed revision is unaffected.

**Recommended fix:** review a coordinated Next.js/React patch upgrade and compatible transitive updates, then rerun build, role/session, image-route and mobile tests. npm suggests Next `16.3.4` and direct `react-server-dom-webpack` `19.2.8`; use a reviewed compatible dependency set, not `audit fix --force`. The named Next advisories list `16.2.11` as their first fixed 16.x version, which does not automatically resolve every transitive finding. [Next.js advisory](https://github.com/vercel/next.js/security/advisories/GHSA-m99w-x7hq-7vfj).

**Migration:** no database migration. **Regression risk:** medium: framework/RSC/build changes need full validation. Exact package evidence and advisory URLs are in [security-dependencies-2026-09-06.json](security-dependencies-2026-09-06.json).

## MEDIUM

### M1 — Password work factor and comparison hardening

**Affected:** `app/email-auth.ts:55–73`.

**Current:** PBKDF2-HMAC-SHA-256, 120,000 iterations, 16-byte random salt, 256-bit output; stored as salt/digest hex without algorithm/version/work-factor metadata. `safeCompare` uses string length plus `===`, not a timing-safe primitive. Missing/inactive users return before password derivation, permitting timing-based account inference; login's human-readable failure response is otherwise generic. No live timing exploit was attempted.

**Risk/fix:** offline guessing is cheaper than current guidance; use a versioned format and benchmark Argon2id or PBKDF2-SHA256 at least 600,000 iterations, with rehash-on-success, validated encodings and `timingSafeEqual`. Use an equivalent dummy derivation for unknown accounts after rate limiting. [OWASP password guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

**Migration:** no schema change needed for versioned strings in the existing text field; gradual hash migration required. **Regression risk:** medium: never reinterpret old hashes using a new iteration count; higher CPU cost needs load testing.

### M2 — Missing explicit Origin validation; state-changing logout GET

**Affected:** all cookie-authenticated POST/PATCH/DELETE routes and `app/api/auth/signout/route.ts:11`.

**Current:** `SameSite=Lax`; no Origin/Referer checks or CSRF token. JSON handlers do not enforce `application/json`. Synthetic login accepts foreign Origin with `text/plain`. GET logout deletes the session and cookie. Cross-site top-level GET navigation can therefore log a user out. Lax blocks cookies on ordinary cross-site POST/PATCH/DELETE, but does not isolate potentially untrusted same-site subdomains. Login CSRF can also replace a victim's session with an attacker's account. No permissive CORS configuration was found; CORS response-reading protection is not a substitute for CSRF protection.

**Risk/fix:** add an allowlisted same-origin guard for cookie-authenticated mutations and login, using a trusted configured origin and carefully defined missing-Origin/Referer fallback. Require JSON content type. Replace mutating GET logout with POST and update the UI. Public preorder creation needs a separate intentional policy; do not accidentally disable its public workflow. Route Handlers do not gain Server Action-specific origin checks automatically. [OWASP CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

**Migration:** none. **Regression risk:** medium: test canonical domains, previews, Safari/PWA, proxies, expired sessions and existing logout links before enforcement.

### M3 — Inconsistent write validation can corrupt financial/scheduling data

**Affected:** booking POST/PATCH, preorder conversion, user POST/PATCH, product POST/PATCH; see validation matrix.

**Current:** most handlers whitelist fields, preventing classic arbitrary-field mass assignment, but many accept arbitrary-length strings, date/time/branch strings, unbounded numeric conversions and weakly checked IDs. Booking PATCH accepts any status string and any nonnegative `finalPaid`, without checking the outstanding balance. SQL integer types are not application-level validation. Public phone validation accepts punctuation-only values; oversize public strings are truncated rather than rejected.

**Risk/fix:** malformed or malicious authorized requests can produce invalid schedules/statuses/payment records and database errors. Add server schemas for bounded strings, positive safe integer IDs, finite integer money, business-approved payment bounds, actual calendar dates, time slots, branch/status enums and normalized phone/plate values. Preserve intentional payment workflows and duplicate overrides; agree on business constraints before changing them.

**Migration:** none for request validation; optional constraints need a legacy-data review and migration. **Regression risk:** medium/high for payment/date rules and old records; use explicit invalid-input regression tests.

### M4 — Missing browser defenses confirmed on production root

**Affected:** empty `next.config.ts` header configuration; production `/` HEAD response.

**Current:** HTTPS response has `Strict-Transport-Security: max-age=63072000`. CSP, CSP Report-Only, X-Frame-Options, X-Content-Type-Options, Referrer-Policy and Permissions-Policy are absent on this response.

**Risk/fix:** clickjacking is not explicitly prevented and XSS defense in depth is missing. Start with `nosniff`, explicit referrer and permissions policies, frame protection, then a measured CSP Report-Only rollout compatible with Next hydration, inline styles, fonts and Speed Insights. Detailed recommendations below; no headers were changed.

**Migration:** none. **Regression risk:** low for basic headers; medium/high for CSP without browser verification.

### M5 — Database TLS, least privilege and Supabase REST exposure unverified

**Affected:** `db/index.ts:38–52`, PostgreSQL migrations, production database configuration.

**Current:** no explicit `ssl` option; behavior depends on connection-string/environment options. Installed postgres.js defaults SSL to false; `sslmode=require` encrypts but disables certificate verification in its implementation. The local env file has no `DATABASE_URL`; production TLS settings could not be inspected. No Supabase service key is referenced by application code. Repository migrations enable RLS on `audit_logs`, but do not establish a comprehensive least-privilege role, grants and RLS configuration for all sensitive tables.

**Risk/fix:** if production permits plaintext transport, uses an owner/BYPASSRLS role, or exposes sensitive tables to anon/authenticated Data API roles, consequences can be severe. Those conditions are **not confirmed**. Verify negotiated TLS and certificate validation; inspect grants/RLS and Data API exposure privately. Separate migration-owner credentials from a restricted runtime SQL role, deny public access to sessions/users/financial tables, and grant only necessary tables/sequences/functions. Custom application sessions are not Supabase Auth JWTs. [Supabase connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres).

**Migration:** configuration-only for verified TLS; SQL grants/RLS changes may require a reviewed migration. **Regression risk:** medium/high if policies deny existing server access. Preserve transaction pooler compatibility, `prepare:false`, `max=1`, timeouts and capacity mechanism.

### M6 — Mechanic redaction leaves payment-related free text

**Affected:** `app/authz.ts:28`, booking GET.

**Current:** `totalPrice`, `advance`, `finalPaid`, `receipt` are removed; payment booleans are returned. `advanceType` and `advanceNote` remain in the spread object. Synthetic test confirms note visibility.

**Risk/fix:** staff can put monetary or sensitive information into `advanceNote`, making financial confidentiality dependent on what they type. Define an explicit mechanic response allowlist and confirm whether payment notes belong in it. This is not a report-API bypass: reports and export reject mechanics.

**Migration:** none. **Regression risk:** low/medium if a mechanic UI currently relies on these notes; verify its intended fields.

### M7 — Detail row caps do not bound all query or export work

**Affected:** `app/reports/query.ts`, `app/api/reports/route.ts`, `app/api/preorders/route.ts:19`, `app/api/audit-logs/route.ts:8`.

**Current:** browser reports cap details at 50; export fetches up to 50,001 and rejects totals above 50,000. The base CTE/options and aggregates still consider broad data. Large date ranges, deep offsets and grouping cardinality are not tightly bounded. XLSX is built in memory. Preorder GET has no limit; audit search can collect an unbounded matching-booking ID list. A workbook with large text cells can exceed provider response limits despite staying under 50,000 rows.

**Risk/fix:** excessive work/memory and provider errors under abuse or normal growth. Add per-user export concurrency/rate limits, bounded date windows or documented asynchronous export strategy, body/byte budgets, and cursor pagination where warranted. Profile before adding indexes; do not change pool size to conceal abuse.

**Migration:** none initially; optional measured indexes later. **Regression risk:** medium: avoid silently truncating exports or dropping historical matches.

## LOW

### L1 — Additional session lifecycle/cookie hardening

**Affected:** `app/email-auth.ts`, `db/schema.ts` login sessions.

**Current/risk:** no expired-session cleanup, idle tracking, session-count cap or `__Host-` cookie prefix. Token format/size is not prevalidated before hashing/lookup. Host-only cookie without Domain is already good, but a prefix would provide stronger browser enforcement against cookie injection from related domains.

**Fix:** define retention/cleanup and size bounds; consider a `__Host-` cookie with a controlled old-cookie transition. **Migration:** none for cleanup/prefix; optional idle timestamp/index migration. **Regression risk:** low/medium: cookie renaming logs existing users out. [OWASP session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

### L2 — Public source attribution and response minimization

**Affected:** both public preorder POST handlers.

**Current/risk:** public callers can choose `manual`, `facebook` or `website`; source is therefore untrusted attribution. The response returns the entire newly created preorder including submitted PII, timestamps and sequential ID, rather than only a receipt/acknowledgment. The duplicate response reveals that a guessed phone/vehicle combination was recently submitted. It does not return an existing customer's record.

**Fix:** distinguish trusted internal source from marketing attribution, and return the minimum public acknowledgment needed. **Migration:** none unless a separate trusted-attribution field is adopted. **Regression risk:** low/medium: check integrations using returned IDs or source parameters.

### L3 — PII in query URLs and uneven explicit cache policy

**Affected:** duplicate-check/report search URLs; protected users/products/preorders/duplicate responses.

**Current/risk:** phone/plate/search terms are query parameters and may enter platform access logs/telemetry even though application diagnostics omit them. Some sensitive GETs lack explicit no-store headers; Next request-time cookies normally make them dynamic, so public CDN caching is not established here.

**Fix:** apply consistent private/no-store response policy and configure URL/query redaction in telemetry; consider POST for sensitive searches where appropriate. Do not log raw query strings. **Migration:** none. **Regression risk:** low; confirm client fetch behavior and diagnostics remain useful.

### L4 — Production backup/recovery documentation is missing or stale

**Affected:** `README.md`, migration history and operational documentation.

**Current/risk:** README still describes Vinext/D1 deployment and migration behavior. No production PostgreSQL backup schedule, tested restore procedure, migration recovery sequence, or administrator recovery/revocation runbook was found. SQL migration files alone are not backups. Provider backups may exist; not verified.

**Fix:** document and test RPO/RTO, backup retention/access, isolated restore drills, forward-fix and rollback decisions for migrations, and administrator recovery with session invalidation. The migration directory mixes historical SQLite/D1 and later PostgreSQL files; document the actual PostgreSQL baseline/order before attempting automated replay. **Migration:** none for documentation; recovery tooling may need follow-up work. **Regression risk:** low for documentation, high for untested restore execution. [Supabase backup guidance](https://supabase.com/docs/guides/platform/backups).

### L5 — Unused legacy header-auth helper could be misused

**Affected:** `app/chatgpt-auth.ts`, stale README examples.

**Current/risk:** the helper trusts special identity headers supplied by an external hosting environment. Active application auth imports the password/session implementation, not this helper; no current spoofed-header bypass was found. Reusing it on Vercel without a trusted header-stripping/injection boundary would create one.

**Fix:** clearly deprecate/remove unused examples or document the required trust boundary before reuse. **Migration:** none. **Regression risk:** low after confirming no external tooling depends on the helper.

## ALREADY GOOD

- All 18 protected route/method implementations checked server-side reject anonymous access. Report and export share the same admin/operator guard; mechanics cannot access them. User/audit management is admin-only.
- Password hashes are stripped from user API responses; `/api/me` returns a curated identity. No passwords/hashes are intentionally returned. The browser build contains no match for the locally configured secret value tested. `.env*` is ignored and no env file is tracked. A limited source scan found no literal DB credentials, private keys, selected token patterns or password hashes; this is not a complete git-history secret scan.
- Staff passwords use per-password cryptographically random salts. Session tokens concatenate two cryptographic UUIDv4 values (72 characters, approximately 244 random bits), and only SHA-256 token digests are stored in PostgreSQL. Fast SHA-256 is appropriate for hashing a high-entropy token; it is not the password hash.
- Session lookup requires `expiresAt > now`; invalid/expired tokens fail. Cookies are HttpOnly, Secure in production, SameSite=Lax, Path=/, host-only, Max-Age 2,592,000 seconds. Login generates a new token rather than adopting a supplied one; no conventional login fixation was found. Logout deletes the presented server-side session and cookie on success. On DB failure, deletion fails and the handler returns a safe error rather than claiming success.
- Staff account active state and current role are checked per protected request. The special administrator exception and revocation gaps are recorded above.
- Inspected Drizzle operations and SQL tagged templates parameterize user values. Dynamic report conditions/ordering use fixed SQL structure; no user-driven `sql.raw`/unsafe query concatenation was found. Report `%`, `_` and backslash input is escaped for literal matching. Audit `ilike` wildcards can broaden search but are not SQL injection.
- Public preorders whitelist persisted properties, force public status to `new`, ignore converted booking IDs/arbitrary privilege fields, cap stored strings and validate manufacture year. Product selection is not part of public preorder creation; it is validated against an active server-side product on booking/conversion.
- React renders names, notes, plates and source labels as text. No `dangerouslySetInnerHTML`, `innerHTML`, arbitrary script URL or user-controlled HTML sink was found in active app code. Dynamic API URLs use encoded query parameters or record IDs. Export download URLs are locally created Blob URLs with date-validated filenames.
- XLSX text fields are explicitly `type: String`, including branch/product summaries. Tests with `=`, `+`, `-`, `@` prefixes produced string cells, no formula elements and no external-link parts. Prefix removal/apostrophe mutation is not needed for this XLSX implementation. Reassess separately if CSV is introduced.
- Recognized database failures log only request/route/stage/SQLSTATE/constraint. Safe response helpers send generic Mongolian messages with no SQL or stack. Audit-table entries intentionally contain business PII and are admin-readable; they are distinct from runtime logs. Sensitive audit **keys** are filtered recursively, but free-text values are not a general secret detector. Preserve this business audit behavior while setting access/retention controls.
- Production root responds over HTTPS with HSTS. SQL connection pool/capacity settings were left unchanged.

## Complete API authorization matrix

A = admin, O = operator, M = mechanic, P = anonymous/public. `requireRole` performs server-side session lookup and current staff authorization, not just UI hiding. `/api/reports?format=xlsx` is the same GET handler. Every path below is under `app/api/<path>/route.ts`.

| Route | Method | Allowed | Current check | Risk / qualification |
|---|---|---|---|---|
| `/api/auth/login` | POST | P/A/O/M | Password verification | H1/H3, M1/M2; no throttle or Origin gate |
| `/api/auth/signout` | POST | P/A/O/M | Operates only on presented session cookie | M2; no Origin gate, anonymous no-op |
| `/api/auth/signout` | GET | P/A/O/M | Same session deletion, then 303 `/login` | M2; mutating GET |
| `/api/me` | GET | A/O/M | `getAppUser`, 403 if absent | Special administrator exception H2 |
| `/api/users` | GET | A | `requireRole([admin])` | Hashes stripped; explicit no-store recommended |
| `/api/users` | POST | A | `requireRole([admin])` | Reset without session revocation; weak validation/uncaught errors |
| `/api/users/[id]` | PATCH | A | `requireRole([admin])` | Role/active allowlist; weak ID/empty-update handling |
| `/api/products` | GET | A/O | `requireRole([admin,operator])` | Operator receives active products only |
| `/api/products` | POST | A | `requireRole([admin])` | Bounded schema absent; any DB error presented as duplicate |
| `/api/products/[id]` | PATCH | A | `requireRole([admin])` | Name/price/active allowlist; weak validation/uncaught errors |
| `/api/products/[id]` | DELETE | A | `requireRole([admin])` | Integer check, no positive bound; authorized global record deletion |
| `/api/bookings` | GET | A/O/M | `requireRole([admin,operator,mechanic])` | Latest 500; mechanic fields redacted except payment notes M6 |
| `/api/bookings` | POST | A/O | `requireRole([admin,operator])` | Product price trusted server-side; scheduling/input gaps M3 |
| `/api/bookings/[id]` | PATCH | A/O | `requireRole([admin,operator])` | Global edit/payment access; status/payment validation gaps |
| `/api/bookings/[id]` | DELETE | A/O | `requireRole([admin,operator])` | Global deletion is current policy; do not silently narrow it |
| `/api/bookings/duplicate-check` | GET | A/O | `requireRole([admin,operator])` | Returns existing customer/history PII to authorized roles; H3/L3 |
| `/api/preorder` | POST | P/A/O/M | Public, honeypot + field validation | H3/M3/L2; always public creation semantics |
| `/api/preorders` | GET | A/O | `requireRole([admin,operator])` | Excludes converted/linked rows; unbounded result M7 |
| `/api/preorders` | POST | P/A/O/M | `getAppUser` selects internal A/O vs public semantics | Public including mechanics; internal status supported; H3/L2 |
| `/api/preorders/[id]` | PATCH | A/O | `requireRole([admin,operator])` | Status/year whitelist; transition and ID constraints incomplete |
| `/api/preorders/[id]` | POST | A/O | `requireRole([admin,operator])` | Converts using active product; cancelled transition rules need review |
| `/api/reports` | GET | A/O | `requireRole([admin,operator])` | Validated filters; 50-row page; aggregate work M7 |
| `/api/reports?format=xlsx` | GET | A/O | Same guard as JSON | 50,000-row ceiling, no user throttle/concurrency limit |
| `/api/audit-logs` | GET | A | `requireRole([admin])` | PII intended for admin; bounds/date/search validation incomplete |

Unsupported write methods are not exported. Framework-generated OPTIONS/HEAD behavior does not introduce a separate application write endpoint. No active PUT handler exists.

**IDOR/BOLA:** IDs are global and there is no per-owner/branch predicate. This matches the current shared staff model: A/O intentionally access all bookings/preorders; admin manages all users/products. No tenant/owner boundary exists in this schema, so changing an ID within an authorized role is not by itself a demonstrated IDOR. Anonymous, mechanic financial access and operator administrative access were tested as denied even with tampered IDs. If branch-limited staff permissions are intended, the current global scope needs a separate business-approved change.

## Write/input validation matrix

Every handler parses the full JSON body before its field checks; no application byte ceiling or strict JSON content-type gate is present. Vercel's function payload ceiling (documented at 4.5 MB) is an outer platform limit, not a small login/preorder schema budget. [Vercel payload limit](https://vercel.com/docs/errors/function_payload_too_large).

| Endpoint | Existing validation / assignment | Remaining gap |
|---|---|---|
| Login POST | Email normalized/contains `@`; password coerced to string, minimum 8 | No maxima, strict types/email syntax, throttle or Origin check |
| Users POST | Admin only; basic email, password min 8; role enum; explicit persisted fields; special admin email cannot be created here | No strict password type/max/email max; existing email resets password and activates without session revocation |
| Users PATCH | Admin only; role enum and boolean active whitelist | `Number(id)` not a positive safe-integer check; invalid/unknown fields can produce empty update; no session invalidation |
| Products POST | Admin; nonempty name; numeric price clamped nonnegative and required nonzero | No max name, finite/integer/currency cap; errors conflated with duplicates |
| Products PATCH/DELETE | Admin; name/price/active whitelist; DELETE integer ID | PATCH weak ID, no name max/finite integer price; empty updates; no positive ID bound |
| Bookings POST | Seven required nonempty string fields; active product lookup sets ID/name/price; advance 0..price; manufacture year; advance-type enum; advance note 200; duplicate/capacity checks | Name/phone/plate/vehicle/receipt max/syntax; date/time/branch enums; strict product ID/finite integer advance; empty note/type semantics |
| Bookings PATCH/DELETE | A/O; integer ID; explicit editable keys; year parser; advance-type enum; note 200; capacity handling | Positive safe ID; arbitrary status/date/time/branch; finalPaid upper/finite integer bound; transition checks |
| Public preorder POST, both aliases | Customer/vehicle 120, phone/plate 40, note 500 (truncated); required customer/phone/vehicle; phone character regex; year 1950..current year+1; honeypot; explicit keys; public status new; 15-minute exact duplicate lookup | No parsed-byte limit; no minimum normalized phone digits; no plate format; non-string object body/null handling inconsistent; source spoofable; duplicate normalization/race gaps; silent truncation |
| Internal preorders POST | Same stored-field caps; A/O can choose status from enum | Can request terminal statuses at creation; define transition invariants without changing public workflow accidentally |
| Preorders PATCH | A/O; integer ID, allowed status values, manufacture year; only status/year persisted | Positive ID, empty update, transition rules (direct converted status without real conversion) |
| Preorders conversion POST | A/O; required strings; active product price; existing manufacture year required; advance clamped to price; note 200; duplicate/capacity checks | String/date/time/branch bounds, strict product ID/advance type; arbitrary advanceType; cancelled preorder not explicitly blocked server-side |
| Logout | Only cookie's session is deleted | GET mutation and missing Origin validation |

`parseManufactureYear` accepts values coercible to a valid integer, not only number/string types; endpoints should reject arrays/objects before coercion. Existing DB insert triggers add year checks, but legacy records/updates are not equivalent to full endpoint validation. Unrecognized JSON fields are ignored by explicit assignment; no arbitrary `...body` database write was found.

## Rate-limit architecture recommendation

Proposed starting points, not deployed settings:

| Operation | Shared key / suggested starting budget |
|---|---|
| Login | 10 attempts/10 minutes per trusted client IP + normalized-account pair; broader 60/IP/10 minutes burst guard; escalating challenge/delay on per-account distributed failures rather than permanent account lockout |
| Public preorder, both aliases | 5 creations/10 minutes/IP, burst 3; additional daily abuse budget and server-verified challenge after suspicious traffic; exempt/adjust authenticated staff appropriately |
| Duplicate check | 60/minute authenticated user, short burst 15; retain client debounce and small query limits |
| Report JSON | 30/minute authenticated user; tune date-range/deep-page cost separately |
| XLSX export | 3/5 minutes authenticated user, concurrency 1 with shared lease/expiry; return 429/Retry-After rather than silently dropping rows |
| User/password writes and other expensive work | Per-user mutation budget, stricter password-reset throttle; alert using safe counters |

Use Vercel WAF for coarse edge/IP filtering before function execution, then an atomic distributed limiter in managed Redis (or equivalent persistent shared service) for verified user/account keys. Do not trust a caller-supplied account/user header. Derive user ID from the validated session, and HMAC normalized account identifiers for limiter keys rather than placing raw emails in diagnostic logs. Obtain client IP only through the documented trusted platform/proxy boundary. Use a shared regional strategy appropriate to the application; Vercel WAF counters are per-region, so they are not automatically global account limits. [Vercel WAF documentation](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting).

Avoid local process maps and database advisory locks. Keep `max=1`. Define a limiter outage policy: short safe retry/503 for login or costly export, with a monitored public-submission fallback that cannot become an unlimited bypass. Roll out observational counters before enforcement where practical; do not retain raw request data in telemetry.

## Production headers and CSP rollout

Live observation: HTTPS HEAD `/` returned 200, server Vercel, HSTS `max-age=63072000`; the six other security headers listed in M4 were absent. No provider configurations were changed.

Recommended initial explicit values:

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin` (consider `no-referrer` if appropriate)
- `Permissions-Policy: camera=(), microphone=(), geolocation=()` after confirming no intended use
- `X-Frame-Options: DENY` plus CSP `frame-ancestors 'none'`, unless approved embedding is required
- Keep HTTPS/HSTS; add includeSubDomains/preload only after verifying every subdomain's HTTPS readiness.

Start a **Report-Only** CSP with `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'`. Inventory actual script/style/font/image/connect requirements and add only verified sources. Next hydration uses inline scripts; blindly enforcing `script-src 'self'` breaks it. A nonce-based strict CSP requires a coordinated rendering strategy and may make currently static pages dynamic; assess nonces vs supported hash approaches before implementation. Account for actual Speed Insights requests, local icons, and any inline styles; do not broadly enable unsafe-eval in production. Test report export, mobile navigation, Safari/PWA and login before enforcing. CSP reporting itself must not collect PII-bearing URLs unsafely. [Next.js CSP guide](https://nextjs.org/docs/app/guides/content-security-policy), [Vercel security headers](https://vercel.com/docs/cdn-security/security-headers).

## Dependency detail

Production audit lists `next 16.2.6`, `sharp 0.34.5`, `nanoid 3.3.12`, and Next's nested `postcss 8.4.31`. A separate top-level `postcss 8.5.14` is dev-classified. nanoid findings concern non-secure/custom generator edge cases; this application's session tokens use `crypto.randomUUID`, not nanoid. PostCSS reachability generally needs attacker-controlled CSS/source maps; no such application flow was found. Sharp concerns image parsing; absence of `next/image` use does not alone prove the framework optimizer is unreachable.

| Additional full-audit package | Installed version(s) | Severity | Exposure / remediation note |
|---|---|---|---|
| `@babel/core` | 7.29.0 | Low | Build/source-map file-read advisory; update within compatible tooling |
| `@esbuild-kit/core-utils` | 3.3.2 | Moderate | Inherited esbuild chain through drizzle-kit |
| `@esbuild-kit/esm-loader` | 2.6.5 | Moderate | Same chain, not a separate production endpoint |
| `drizzle-kit` | 0.31.10 | Moderate | npm suggests a breaking downgrade to 0.18.1; do not apply it blindly |
| `esbuild` | 0.18.20, 0.25.12, 0.28.0 | Moderate overall | Vulnerable old dev-server chain and affected Windows release; 0.25.12 does not match the listed ranges |
| `brace-expansion` | 1.1.14, 5.0.6 | High | Tooling expansion DoS; compatible patched dependency resolution needed |
| `browserslist` | 4.28.2 | High | Tooling memory/stats processing; no user browserslist input found |
| `fast-uri` | 3.1.2 | High | Tooling URI normalization/host confusion; no app SSRF flow found |
| `js-yaml` | 4.1.1 | High | Tooling alias/merge DoS; no public YAML input flow found |
| `react-server-dom-webpack` | 19.2.6 | High | Direct package is dev-only in lockfile; do not confuse that with Next's vendored RSC runtime; coordinate React/Next updates |

Full commands exited 1 because vulnerabilities were reported, not because the final registry query failed. No install, forced fix or package upgrade was performed. Exact advisory identifiers, ranges, chains and npm fix proposals are preserved in the linked JSON. [React Server Functions advisory](https://github.com/react/react/security/advisories/GHSA-wx67-qw84-cm4g).

## Backup, recovery and deployment checks still needed

Before broader use, establish an owner and tested procedure for:

1. PostgreSQL backup schedule/retention, PITR availability where needed, RPO/RTO and restore drills into an isolated project. Check what the actual Supabase plan provides; do not assume backups merely because the DB is managed.
2. Pre-migration backups, reviewed SQL ordering, staging rehearsal, compatibility with rollbacked application code, and a recovery decision tree. Do not replay SQLite-era migrations against PostgreSQL.
3. Emergency administrator recovery: authenticated control-plane access, hash provisioning, credential rotation, server-session revocation and proof that an old token is denied. Avoid an emergency plaintext password committed into code.
4. Restricted runtime and migration credentials, key rotation ownership, protected environment access, and least-privilege production log/audit access with retention rules.
5. Production WAF/limiter settings, verified SQL TLS/certificate configuration, actual table grants/RLS/Data API exposure, and dependency update monitoring.

## Security regression tests

Added `tests/security-audit.test.mjs`. It is deliberately **characterization-oriented**: tests recording an insecure current behavior are labeled as such and must be inverted when the approved fix lands. Passing them does not mean the behavior is secure.

Executed audit checks:

- All 18 protected route/method implementations deny anonymous requests and tampered IDs.
- Mechanic financial/admin denials, operator administrative denials; curated mechanic financial fields.
- Salted password hashing, fresh random login tokens, digest-only session storage, production cookie flags and server-side logout revocation.
- Invalid/expired token denial; immediate staff disable and current session revival after reactivation.
- Existing session survives password reset; special admin plaintext fallback; foreign-Origin/text/plain login and mutating GET logout characterization.
- Both public routes reject required/year/honeypot failures, limit stored string lengths, force public status and ignore unrelated persisted fields.
- Public punctuation-only phone/manual attribution acceptance characterization.
- XLSX `= + - @` text prefix safety and no external-link parts.
- Generic error-object logging characterization.

Existing report tests cover admin/operator report access, forbidden export, SQL literal search/injection probes, date/enum/ID validation, exact filtered totals and oversized export rejection. Existing preorder tests cover conversion/cancellation workflow restrictions in the UI and request handling.

After remediation, add/invert tests for: password reset/disable permanently revokes old sessions; administrator recovery invalidates sessions; constant-time verification and legacy rehash; normalized public duplicate races; oversized body rejection before JSON parsing; invalid money/date/branch/status and IDs; accepted/denied Origin combinations; logout GET does not mutate; no secret/PII markers in runtime diagnostics; and distributed limiter behavior across two instances. Add approved-role success tests for each write with domain-valid fixtures, and cookie/CSRF browser tests on Safari/PWA in staging.

## Validation results

- `npx tsc --noEmit`: passed.
- `npm run build`: passed; zero registered Server Actions in the built manifest.
- `git diff --check`: passed at final review.
- `node --test tests/security-audit.test.mjs`: 10 passed.
- Combined audit/report/preorder run: **25 passed, 0 failed**. Command: `node --test tests/security-audit.test.mjs tests/reports.test.mjs tests/preorder-workflow.test.mjs`.
- Focused ESLint check for the new audit harness: passed.
- The legacy Vinext preview test was not part of this targeted run; it requires `dist/server/index.js`, which the Next.js build does not produce.
- Dependency checks: completed with the findings above; no fixes applied.
- Production HEAD: read-only, no cookies/authentication or application payload sent.

## Remediation order

**Phase 1 — authentication/session critical fixes:** remove admin plaintext fallback only after tested hash provisioning; define emergency administrator revocation; revoke sessions on reset/disable; migrate password hashes safely; close raw-error logging paths. No confirmed critical finding, but these are the first credential-containment tasks.

**Phase 2 — API authorization and abuse protection:** retain existing guards; add shared login/public/duplicate/export limits; confirm mechanic field allowlist and intended global staff scope; cap export concurrency and costly reads. Prioritize the reviewed framework/dependency update alongside this phase, without a forced downgrade.

**Phase 3 — browser/header/input hardening:** Origin/content-type guards and POST-only logout; explicit validation schemas and agreed payment/transition limits; safe cache/telemetry handling; basic headers, then tested CSP Report-Only to enforcement.

**Phase 4 — operational security/backups:** privately verify TLS, runtime grants/RLS and public Data API exposure; document and exercise backup/restore/migration/admin recovery; establish log/audit retention, environment access controls and dependency monitoring. Treat any confirmed public database exposure or unencrypted privileged connection as an immediate escalation rather than waiting for this phase.
