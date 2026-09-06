# Security hardening Phase 1

Implements the authentication/session lifecycle findings in `security-audit-2026-09-06.md`. The dated audit remains a historical baseline; the regression suite now expects the Phase 1 protections.

## Required Vercel environment action BEFORE deployment

- Old plaintext source: `ADMIN_PASSWORD`. It is completely ignored by this version; remove it from the relevant Vercel environments after provisioning the hash.
- Required source: `ADMIN_PASSWORD_HASH` (already supported previously, now mandatory). Set it for Production and any Preview/Development environment that needs the protected administrator. No environment changes were made by this implementation.
- Exact value: `salt:digest`, with a random 16-byte salt encoded as 32 lowercase hexadecimal characters and a PBKDF2-HMAC-SHA256 digest of 32 bytes encoded as 64 lowercase hexadecimal characters. Derive with 120,000 iterations from the UTF-8 password and the decoded salt bytes. This is the existing `hashPassword` format. Provision using a trusted local credential process; never put a plaintext password or hash into repository files, shell history, logs, screenshots, or chat.
- If a valid hash is already configured, no password migration is needed. If only the plaintext variable exists, configure the hash before deploying this code. Missing/malformed hashes fail with the same generic 401 login response as an incorrect password.
- Vercel environment changes require a new deployment to reach running code. Deploy only after the hash is configured. Retire/restrict old deployments that retain old credentials or plaintext fallback, especially during credential rotation. Do not roll back to plaintext-capable code.
- Every credential rotation must generate a fresh random salt/hash, including when keeping the same password. Do not restore/reuse an old hash: doing so could revalidate its still-unexpired signed sessions. Any rollback must keep the current credential hash. No destructive password migration or database migration is required.

No deployment or push was performed.

## Passwords and protected administrator

Both staff and administrator use `verifyPassword`: validate the hash format, derive the existing PBKDF2 digest, then compare equal-size buffers using Node's `timingSafeEqual`. Existing application-generated hashes remain compatible; the work factor and password UX are unchanged. Malformed stored hashes fail closed.

The protected break-glass email remains an explicit server-side identity with admin role. User-management POST/PATCH cannot reset, demote, or disable it, including an accidental matching database row. Its credential is exclusively `ADMIN_PASSWORD_HASH`. Ordinary database-backed admin users retain normal staff lifecycle rules.

New protected-admin cookies contain a fresh random token plus an HMAC-SHA256 signature bound to the configured credential hash and an application-specific context. Validation requires an unexpired matching database session and a valid signature under the current hash. Rotation/removal invalidates prior admin cookies; legacy unsigned administrator sessions require fresh login at rollout. Invalidated rows can remain until ordinary cleanup; they do not authorize access under the new credential. Logout deletes the presented session as before.

Cookie name `gas_session`, 30-day TTL, HttpOnly, production Secure, SameSite=Lax and Path=/ are unchanged. Staff token format remains unchanged. Only SHA-256 digests of complete tokens are stored in `login_sessions`.

## Staff lifecycle and atomicity

- Password reset updates the hash, deletes **all** sessions for the email, and records the existing audit event in one database transaction. A failure rolls back all three operations, including self-reset.
- Disabling deletes all sessions atomically with the active-state update and audit event. Reactivation also deletes any legacy sessions instead of reviving them. Fresh login is required.
- Validation checks the current staff active state; deleted or inactive staff identities fail closed.
- Login, reset and active-state updates acquire the same staff row lock. A login authenticated using the old password cannot insert a session after reset/disable commits.
- Every successful login issues a fresh random token, atomically deletes the presented prior session and inserts the new session, then replaces the cookie. Independent device sessions survive ordinary login, but all are deleted by reset/disable.
- GET logout still redirects to `/login`; POST still returns success JSON. Both delete the server session and clear the cookie. Missing, malformed, expired and already-revoked cookies are safe. A database failure returns a generic 503 rather than claiming successful server revocation.

Auth routes and user-management routes use a dedicated error response that never inspects or logs underlying errors. Only trusted route, request ID, stage and generic category are emitted; existing timing diagnostics remain. Session/authorization exceptions are sanitized before reaching other callers. Existing protected audit-trail records retain their business purpose; credentials and session values are not added. Global non-auth error logging remains a later-phase audit item.

## Validation

`node --test tests/security-audit.test.mjs tests/reports.test.mjs tests/preorder-workflow.test.mjs`

The isolated PGlite harness uses synthetic credentials/cookies only and never loads `.env` or connects remotely. It covers hash-only admin login, generic failure, independent legacy hash compatibility, staff login, admin credential rotation/removal, legacy admin rejection, session rotation, expiry, invalid tokens, logout, all-device reset/revocation, disable/reactivate, protected identity, transaction rollback and sanitized auth failures. Existing reports/preorder regression coverage also runs. It does not exercise a live Supabase connection or multi-connection concurrency; serialization is enforced by matching transactional row locks in the implementation.

Also run `npx tsc --noEmit`, `npm run build` and `git diff --check`. No pool settings, role model, booking logic, rate limiting, CSP, dependencies, infrastructure or Phase 3 origin/logout behavior are changed.

## Files changed in this phase

- `app/email-auth.ts`: shared timing-safe verification, hash-only administrator, credential-bound admin sessions, staff active checks and transactional session replacement.
- `app/admin-identity.ts`: shared protected server identity.
- `app/auth-errors.ts`: sanitized auth error abstraction/response.
- `app/authz.ts`: shared admin identity and sanitized authorization failures.
- `app/api/auth/login/route.ts`, `app/api/auth/signout/route.ts`, `app/api/me/route.ts`: safe auth diagnostics.
- `app/api/users/route.ts`: atomic password reset/session revocation.
- `app/api/users/[id]/route.ts`: atomic disable/reactivate session revocation and protected admin guard.
- `tests/security-audit.test.mjs`: hardened lifecycle regression expectations and new failure/rollback coverage.
- `README.md`, `docs/security-phase-1.md`: mandatory hash configuration and deployment policy.

The existing untracked audit report and dependency inventory were preserved. Validation completed successfully: 30 targeted tests passed (15 security, 7 reports, 8 preorder), TypeScript check, production build and whitespace check.
