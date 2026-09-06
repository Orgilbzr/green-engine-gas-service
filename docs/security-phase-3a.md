# Security hardening Phase 3A

## Origin validation and protected routes

`app/request-origin.ts` guards POST/PUT/PATCH/DELETE. Production accepts only `https://gas.ecoauto.app`, never the request Host or forwarded host as an authority. An Origin must be a valid serialized HTTP(S) origin, with no credentials, path, query or fragment. Matching is exact after URL parsing; malformed/foreign/null Origin is rejected even if Referer is allowed. When Origin is absent, a valid Referer with an allowed origin is accepted. Missing both fails closed. Values are not logged.

Non-production additionally permits localhost, 127.0.0.1 or [::1], only when the supplied origin exactly matches the request URL origin (including scheme and port). Production preview domains and localhost are intentionally not allowed. No wildcard or new environment variable is introduced.

Guards cover:

- POST `/api/auth/login` and `/api/auth/signout`.
- POST `/api/bookings`, PATCH/DELETE `/api/bookings/[id]`.
- POST `/api/products`, PATCH/DELETE `/api/products/[id]`.
- POST `/api/users`, PATCH `/api/users/[id]`.
- PATCH/POST `/api/preorders/[id]`.
- The authenticated admin/operator creation path of POST `/api/preorders`.

Existing role checks remain. Origin rejection occurs before protected business work, using 403, no-store and `Хүсэлтийг зөвшөөрөх боломжгүй байна.` Login origin rejection precedes its limiter; admitted requests retain the deployed limit behavior. Cookie/hash/TTL/pool designs are unchanged. This phase does not introduce a JSON content-type requirement or CSRF tokens.

## Logout and public preorder

Both navigation logout links are now ordinary POST forms with styled buttons. Successful browser form submission clears the server session/cookie and returns a 303 to `/login`; programmatic POST retains JSON success. GET returns 405 with `Allow: POST` without reading or mutating session state. Existing GET links/bookmarks no longer log a user out. Other API GET handlers were reviewed; none mutate business state.

The current preorder UI submits to same-origin APIs. Public POST `/api/preorder` and the unauthenticated/non-internal path of POST `/api/preorders` remain free of cookie-authenticated origin checks; rate limits, honeypot, validation and duplicate handling remain intact. Foreign-origin public submissions are covered by tests. No permissive CORS headers are added: a future browser integration may need an explicit CORS policy, while server-to-server integrations must use a separately designed authenticated integration path rather than trusting Origin as authentication. The mixed route resolves the current user before selecting its public or guarded internal path.

## Browser headers

`next.config.ts` adds globally:

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- `X-Frame-Options: DENY`
- `Content-Security-Policy` as below.

Production CSP:

```text
default-src 'self'; script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://vitals.vercel-insights.com; worker-src 'self' blob:; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'
```

Inline scripts are currently needed by the static Next.js hydration output; inline styles are used by the UI. This practical baseline therefore includes unsafe-inline, and is not a nonce-based strict XSS policy. Production does not permit unsafe-eval; development adds it for tooling. Same-origin APIs, manifests/workers, blob downloads and the installed Speed Insights package's same-origin/explicit Vercel script delivery are supported. CSP does not use wildcard script/connect destinations. Frame restrictions intentionally prevent embedding the application, including the public preorder page, in another site's iframe.

HSTS remains platform-owned. The completed audit observed `Strict-Transport-Security: max-age=63072000` on the production root; this phase adds no duplicate or conflicting HSTS and did not reconfigure/reprobe production.

## Files changed

- `app/request-origin.ts`: centralized origin guard.
- `app/api/auth/login/route.ts`, `app/api/auth/signout/route.ts`: login guard and POST-only logout.
- `app/api/bookings/route.ts`, `app/api/bookings/[id]/route.ts`.
- `app/api/products/route.ts`, `app/api/products/[id]/route.ts`.
- `app/api/users/route.ts`, `app/api/users/[id]/route.ts`.
- `app/api/preorders/route.ts`, `app/api/preorders/[id]/route.ts`.
- `app/page.tsx`, `app/globals.css`: logout form/buttons and appearance.
- `next.config.ts`: browser headers/CSP.
- `tests/request-origin.test.mjs`: focused origin/logout/header tests.
- `tests/security-audit.test.mjs`: same-origin fixtures, foreign login rejection, POST logout, public and mixed preorder coverage.
- `tests/rate-limit.test.mjs`: isolate origin checks in limiter-focused tests.
- `docs/security-phase-3a.md`: this report.

## Validation and deployment prerequisites

TypeScript, production build and `git diff --check` passed. The focused origin/security/rate-limit/preorder/report suite passed; updated origin/security tests also passed after adding explicit public/mixed preorder coverage. Tests use synthetic data, not production credentials. Configuration/header assertions and build verification do not replace a Safari/PWA staging smoke test of the enforced CSP; live browser behavior has not been verified in this pass.

No new environment variables, dependencies or database migrations. Before deployment, callers of internal mutations must send the canonical Origin or a same-origin Referer; headerless scripts will now receive 403. Preview-domain login/mutations are not enabled by the production allowlist. Existing integrations or embedding consumers need review against these intentional restrictions. Use the new POST logout UI. Existing Phase 1/2 environment configuration remains required.

No deployment or push was performed.
