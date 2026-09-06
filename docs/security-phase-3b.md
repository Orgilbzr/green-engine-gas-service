# Security hardening Phase 3B

## Shared validation

`app/input-validation.ts` supplies object/JSON parsing, bounded strings, positive integer IDs, strict monetary values, real calendar dates, 24-hour times, phone/plate normalization, endpoint-specific payload validation and safe Mongolian 400 responses. Unknown keys do not survive validation; routes continue to construct database write objects explicitly. `app/manufacture-year.ts` retains 1950 through current year + 1, now rejecting coercible arrays/objects and malformed numeric strings.

Reviewed writes: login, booking create/update/delete, preorder create/update/convert, product create/update/delete, and user create/reset/update. Logout accepts no writable payload. Duplicate-check query date/time and text bounds are also validated after the existing limiter and before duplicate queries. Report query parsing reuses shared dates and enums.

## Chosen limits

| Input | Limit |
| --- | --- |
| Customer, vehicle, product name, display name | 120 characters |
| Raw phone / raw plate | 40 characters |
| Normalized phone | 6–15 digits |
| Normalized plate | 2–20 uppercase Latin/Cyrillic letters, digits or hyphens; optional on preorders |
| Customer preorder note | 500 characters |
| Advance note / receipt text | 200 characters |
| Honeypot | 200 characters |
| Email | 254 characters; basic non-whitespace local@domain.suffix validation for user management |
| Password input | 1,024 characters; existing minimum 8 for creating/resetting users |
| IDs | Strict positive decimal integers, at most 2,147,483,647 |
| Money | Whole nonnegative currency units, at most 2,147,483,647 (database integer range); product price must be positive |
| Report search | 100 characters |
| Report page | 1–1,000; existing fixed 50-row page size; supplied pageSize is rejected |
| Report date span | At most 3,660 days |

Oversized values return 400, not truncation. Phone inputs allow digits and common formatting characters, then store digits only. Plate inputs trim, uppercase and remove whitespace. Public duplicate SQL normalizes existing stored phone formatting too, so previously formatted phone records still match newly normalized submissions.

Dates require real `YYYY-MM-DD` calendar dates from 1900 onward; times require `HH:mm` in 00:00–23:59. Monetary strings must contain decimal digits only: signs, exponent/hex syntax, whitespace, fractions, NaN, Infinity, null, arrays and objects fail closed. Existing total/advance/finalPaid arithmetic and remaining calculation are unchanged. Booking creation still reads price/name from the active product record; client totalPrice cannot set the stored price. Existing conversion advance capping, booking advance-vs-price check and capacity calculation are preserved.

## Enums and assignment boundaries

Shared allowlists cover roles, three current branches, booking statuses (including the existing cancelled alias), preorder statuses, source, advance type and report payment status. Unknown client values return 400. Historical rows are not revalidated on reads, and omitted manufacture year remains omitted on unrelated PATCH operations, preserving legacy NULL edits. New bookings/preorders still require year; converting a legacy NULL-year preorder still requires the existing year repair first.

Booking number, capacity slot, audit actor, final payment at creation, product-derived price and conversion linkage remain server-owned. Known client booking status is ignored on create in favor of the existing advance-derived status. Public preorder status is always new, linkage null, and public requests cannot persist role, security, financial or capacity data. The public `note` remains the existing customer-visible note, bounded to 500; internal advance notes/receipt/financial inputs are not persisted on public creation. User hashes are never returned; the protected administrator remains protected. Display name has no writable database field in the current user API: it is length-checked if supplied but not persisted.

The mixed preorder route retains its origin/limiter selection before field validation. No changes to Redis policy/configuration, auth/session/hash design, CSP/origin policy, pool settings or dependencies. Malformed login JSON/types or oversized login fields now return safe 400; ordinary bad credentials retain their generic authentication response.

## Files changed

- `app/input-validation.ts`: centralized helpers and enums.
- `app/manufacture-year.ts`: strict year input types/encoding.
- `app/api/auth/login/route.ts`: bounded login payload parsing.
- `app/api/bookings/route.ts`, `app/api/bookings/[id]/route.ts`: validated create/update/delete.
- `app/api/bookings/duplicate-check/route.ts`: bounded text and valid query dates/times.
- `app/api/preorder/route.ts`, `app/api/preorders/route.ts`: public payload validation, source rejection and normalized legacy-phone duplicate matching.
- `app/api/preorders/[id]/route.ts`: validated IDs, updates and conversion payload.
- `app/api/products/route.ts`, `app/api/products/[id]/route.ts`: validated names, prices, flags and IDs.
- `app/api/users/route.ts`, `app/api/users/[id]/route.ts`: validated credentials, roles, active flags and IDs.
- `app/reports/model.ts`: shared enum/date validation, branch/date-span/pagination bounds.
- `tests/input-validation.test.mjs`: focused validation and real-route assignment tests with counted business-query doubles.
- `tests/security-audit.test.mjs`: reject formerly truncated/punctuation-only input; verify legacy formatted-phone duplicate matching with PGlite.
- `tests/rate-limit.test.mjs`: isolate validation in rate-limit-focused fixtures.
- `docs/security-phase-3b.md`: this report.

## Compatibility and verification

Existing overlong text, fractions/exponent strings, malformed inputs, unknown branches/enums, and report requests outside the new bounds must be corrected or narrowed before resubmission. Existing records are not migrated or truncated. Historical branch labels outside the three configured branches can still be read in unfiltered reports but cannot be submitted as new branch filters/writes. Clients cannot depend on ignored malformed optional fields being accepted. Phone/plate formatting is normalized on new writes; old rows are not rewritten.

Validation commands:

```text
npx tsc --noEmit
node --test tests/input-validation.test.mjs tests/security-audit.test.mjs tests/rate-limit.test.mjs tests/reports.test.mjs tests/preorder-workflow.test.mjs tests/request-origin.test.mjs
npm run build
git diff --check
```

Tests use synthetic values and isolated database/business-work doubles, not production data. No new environment variables or migrations are required. No deployment or push performed.

Final results: all 61 focused/regression tests passed. TypeScript, production build and whitespace checks passed.
