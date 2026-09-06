# Security hardening Phase 2 — infrastructure and login only

This pass implements the shared distributed limiter and `POST /api/auth/login` protection. Public preorder, duplicate-check and report export remain unchanged. Phase 1 credentials, hash format, cookies, session TTL, database pool settings and business logic remain unchanged. No packages were added or upgraded.

## Configure Vercel BEFORE deployment

Required server-only environment variables:

- `UPSTASH_REDIS_REST_URL`: the Upstash Redis HTTPS REST endpoint.
- `UPSTASH_REDIS_REST_TOKEN`: its read/write REST token, with permission to execute EVAL and the script's TIME, ZREMRANGEBYSCORE, ZCARD, ZRANGE, ZADD, PEXPIRE commands, plus ZREM for refunds. A read-only token does not work.

Provision/connect Upstash Redis and set both values for every Vercel environment that needs login, then deploy when authorized. Use a dedicated database for this application and separate Production from Preview/Development; all production instances/regions must use the same database and token. No infrastructure or environment values were changed in this pass, and live Upstash credentials/connectivity were not verified. No deployment or push was performed.

There is no memory fallback or limiter-disable environment switch. Missing/invalid configuration makes login return a generic **503**, so these variables are a deployment prerequisite. For local development, supply a separate development Redis instance; requests outside Vercel share the conservative `unknown` IP bucket. Builds do not contact Redis or require its credentials.

The implementation uses native `fetch` against the [Upstash HTTPS REST API](https://upstash.com/docs/redis/features/restapi), with JSON command arrays, bearer authorization, no response caching, no redirects, no retries, and a **1,000 ms deadline per operation**, including the response body. A normal failed login uses two operations; success uses a third to refund the account reservation. The limiter does not change existing database/authentication deadlines.

## Limits and atomic behavior

| Bucket | Limit | Behavior |
| --- | --- | --- |
| Client IP | 10 attempts in a rolling 10 minutes | Checked before body parsing and password/database work. All admitted requests consume an attempt, including successful or malformed requests and account-blocked attempts. |
| Normalized account | 5 failures or in-flight attempts in a rolling 10 minutes | Checked before password verification for both known and unknown accounts. Success removes only its own reservation, preserving other failures. |

Each check executes one Lua script atomically in Redis. Redis server time controls the rolling window; sorted sets hold random attempt IDs, and expired attempts are pruned before counting. Each bucket expires after 10 minutes without an admitted attempt. Blocked requests do not extend its expiry. There are no instance-local counters. Atomic reservation prevents concurrent login attempts from all passing an earlier count check.

Successful logins do not clear previous failures: they refund only their own uniquely identified attempt. In-flight requests temporarily count toward the five-account limit. Crashes or verification errors conservatively retain their reservation until expiry. A failed refund after successful authentication is safely logged and does not turn the successful login into an error; the reservation expires normally. Repeated refunds cannot erase another request's failure.

Exceeding either limit returns **429**, `Cache-Control: no-store`, and a positive integer `Retry-After` in seconds until the oldest blocking attempt expires:

> Хэт олон удаа оролдлоо. Түр хүлээгээд дахин оролдоно уу.

No account existence, bucket name or Redis details are included in the response. Backend errors, malformed responses, timeouts and missing configuration **fail closed before authentication** with a generic Mongolian 503, `Retry-After: 5`, and `Cache-Control: no-store`. This intentionally makes new login unavailable during a Redis outage; already-authenticated sessions and other endpoints do not depend on the limiter. There is no fail-open interval.

## Identity and privacy

IP extraction trusts only `x-vercel-forwarded-for`, and only when Vercel's system environment reports `VERCEL=1`. There is no fallback to `X-Forwarded-For`, `X-Real-IP`, cookies or a caller-supplied chain. Missing/invalid/multiple IPs share `unknown`. IPv6 text is canonicalized. Keep Vercel system environment variables enabled and verify that the platform header reaches the function before rollout. An additional proxy can cause clients to share the proxy's IP; review that topology before deployment. See [Vercel's request-header documentation](https://vercel.com/docs/headers/request-headers).

Accounts are trimmed and lowercased using the login normalization. Account and IP key suffixes use HMAC-SHA256 with the configured REST token, with separate limiter namespaces. Redis keys contain neither raw emails nor IPs. No additional secret environment variable is required. The REST token is used for key privacy as well as transport authorization: rotating it resets effective bucket identities, so use the same token across active instances and account for this reset during rotation. Keys use `green-engine:rl:v1:`; no phone, plate, password or session token is used as an identifier.

Limiter diagnostics emit only `rate_limit_check`, `rate_limit_allowed`, `rate_limit_blocked`, or `rate_limit_backend_error`, with fixed route, generated request ID, limiter name and duration. Backend exceptions/bodies, identifiers, headers and secret values are never logged.

## Files changed and validation

- `app/rate-limit.ts`: shared Upstash REST implementation, atomic rolling window, identity hashing, IP extraction, timeout and safe responses/diagnostics.
- `app/api/auth/login/route.ts`: IP/account checks and successful-login reservation refund.
- `tests/rate-limit.test.mjs`: focused route/helper tests using a test-only shared REST contract double.
- `tests/security-audit.test.mjs`: isolate the limiter in existing Phase 1 lifecycle tests, which still exercise real authentication code against synthetic PGlite data.
- `docs/security-phase-2-login.md`: configuration, behavior and deployment prerequisites.

Tests cover successful/generic login responses, both thresholds, account normalization across IPs and independent module instances, concurrent reservations, scoped/idempotent refunds, rolling expiry, Retry-After, trusted-header handling, privacy, missing configuration, backend errors, connection/body timeouts and refund errors. The test-only backend does not execute Lua or validate a live Upstash service; its contract double validates application integration. A configured staging smoke test against Upstash is still required before production rollout.

Validation commands:

- `node --test tests/rate-limit.test.mjs tests/security-audit.test.mjs`
- `npx tsc --noEmit`
- `npm run build`
- `git diff --check`

Results: all 26 focused tests passed (11 limiter tests and 15 existing security tests); TypeScript and whitespace checks passed. The production build passed outside the sandbox after the sandboxed compile stalled and was stopped.
