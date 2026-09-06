# Security hardening Phase 2B

Extends the deployed `app/rate-limit.ts` Upstash infrastructure. Phase 2A login thresholds, key namespace, responses and refunds remain unchanged.

## Endpoint limits

| Endpoint | Limit | Limiter name |
| --- | --- | --- |
| Public `POST /api/preorder` and public `POST /api/preorders` | 5 requests per rolling minute per IP, AND 20 per rolling hour per IP | `preorder-ip-minute`, `preorder-ip-hour` |
| `GET /api/bookings/duplicate-check` | 60 requests per rolling minute per authenticated user | `duplicate-user` |
| `GET /api/reports?format=xlsx` | 5 exports per rolling 10 minutes per authenticated user | `report-export-user` |

Both preorder aliases share buckets. The minute check runs first, then the hour check; both must admit the request before business queries/inserts run. A request rejected by the hour check still consumes its admitted minute attempt. Invalid submissions consume allowance too. Existing validation and duplicate handling remain unchanged. Authenticated admin/operator creation through the mixed `/api/preorders` route retains its internal behavior; public callers, including other roles, receive the public limits. This mixed route resolves authentication before deciding which path applies.

Duplicate-check and report permission checks run first; admin/operator remain authorized, mechanics and anonymous callers remain forbidden. Rate checks precede the duplicate query, full export query and workbook generation. Normal JSON report viewing never contacts the limiter. The existing 50,000-row export cap remains.

## Keys, failures and responses

All new keys use the existing HMAC-SHA256 strategy and REST-token secret. IP extraction is unchanged: only the Vercel platform header under `VERCEL=1`, otherwise the conservative unknown bucket. Internal identity comes exclusively from the authorized server user: database user ID, or normalized protected-admin identity when ID is null. The resulting identity is HMAC-hashed before Redis use. Sessions, phones, plates and payloads never select buckets; multiple sessions of one user share an allowance. Separate limiter names keep endpoint allowances independent.

All new rate-limit 429 responses contain `Retry-After`, `Cache-Control: no-store`, and:

> Хэт олон хүсэлт илгээсэн байна. Түр хүлээгээд дахин оролдоно уу.

Existing business-duplicate responses are preserved separately.

Redis failures or timeouts return safe 503 with `Retry-After: 5`; no silent bypass or production memory fallback. The existing one-second deadline applies to each Redis operation, so the two preorder checks have at most two seconds of limiter wait. Generic 503 text:

> Хүсэлтийг боловсруулах боломжгүй байна. Түр хүлээгээд дахин оролдоно уу.

Limiter logs remain limited to `rate_limit_check`, `rate_limit_allowed`, `rate_limit_blocked`, `rate_limit_backend_error` with route, request ID, limiter and duration. No raw identity, payload, headers, backend errors or credentials are logged by the limiter.

## Configuration

**No new Vercel variables, packages or infrastructure are required.** Reuses the deployed `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. No auth, cookie, TTL, database pool, CSP or dependency changes. No deployment or push performed.

## Files changed

- `app/rate-limit.ts`: per-limiter window/count configuration, shared preorder check and authenticated identity helper, endpoint-appropriate messages.
- `app/api/preorder/route.ts`, `app/api/preorders/route.ts`: public creation limits.
- `app/api/bookings/duplicate-check/route.ts`: authorized-user limit before query.
- `app/api/reports/route.ts`: export-only limit before query/workbook.
- `tests/rate-limit.test.mjs`: Phase 2B real-handler integration coverage using the existing test-only REST double and counted business-work doubles.
- `tests/security-audit.test.mjs`, `tests/report-fixture.mjs`: isolate the limiter in existing business/auth regression suites.
- `docs/security-phase-2b.md`: this report.

## Validation

Passed:

- `node --test tests/rate-limit.test.mjs tests/security-audit.test.mjs tests/reports.test.mjs tests/preorder-workflow.test.mjs` — 48 tests.
- `npx tsc --noEmit`.
- `npm run build`.
- `git diff --check`.

New tests cover both preorder windows and shared aliases, per-user isolation, export threshold, normal report availability during limiter failure, mechanic/anonymous denials, row cap, Retry-After, safe 503, PII-free keys/diagnostics and rejection before expensive work. Existing login tests continue to pass. No live production traffic or Redis data was changed; new endpoint behavior was verified through isolated test doubles, not a deployed Phase 2B instance.
