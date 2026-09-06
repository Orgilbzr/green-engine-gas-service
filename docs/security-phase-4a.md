# Security hardening Phase 4A

## Outcome and scope

Production npm audit findings reduced from **4 high to 0**. Full audit reduced from **14 (9 high, 4 moderate, 1 low) to 10 (5 high, 4 moderate, 1 low)**, all remaining findings outside the production-only audit. These are npm package findings, not counts of independently exploitable application vulnerabilities.

Only `package.json`, `package-lock.json`, this report and `docs/security-phase-4a-evidence.json` changed. No application code, authentication/session rules, rate limits, origin/CSP policy, database pool/schema, or business logic changed. No deployment, push, overrides, force audit fixes or major framework migration.

Baseline: Node **v24.11.0**, npm **11.6.2**. `npm ls --depth=0` recorded Next/eslint-config-next 16.2.6; React/react-dom/react-server-dom-webpack 19.2.6; Drizzle ORM 0.45.2, Drizzle Kit 0.31.10; Tailwind/@tailwindcss/postcss 4.2.1; Speed Insights 2.0.0; PGlite 0.5.8; TypeScript 5.9.3; ESLint 9.39.4; postgres 3.4.9; write-excel-file 4.1.1; @types/node 22.19.19, @types/react 19.2.14, @types/react-dom 19.2.3. An existing local extraneous @emnapi/runtime 1.11.3 was also reported. The final listing also reports an optional Sharp WASM package as extraneous locally; these are installation-tree observations, not additional package.json dependencies. Deployment should use the committed lockfile with normal clean installation.

Audit commands: `npm audit --omit=dev --json` and `npm audit --json`, before and after. The initial sandbox DNS failure was retried with registry network access. Full version/advisory/range evidence is preserved in the companion JSON.

## Safe update path

| Package | Before → after | Vulnerable range / nearest patch | Relationship and exposure | Risk |
| --- | --- | --- | --- | --- |
| Next | 16.2.6 → **16.3.0** | Framework advisories: >=16.0.0 <16.2.11. 16.2.11 patches framework findings but retains vulnerable PostCSS 8.4.31 and Sharp ^0.34.5. 16.3.0 is the first stable 16.3 parent checked that resolves those without overrides. | Direct production framework; App Router, route handlers, metadata and headers exercised. | Moderate framework minor update; no major migration. |
| eslint-config-next | 16.2.6 → **16.3.0** | Alignment with selected Next release, not a separate production finding. | Direct development tooling; matching @next/eslint-plugin-next updates too. | Low; compiler/lint integration alignment. |
| PostCSS | Next nested 8.4.31 and shared 8.5.14 → shared **8.5.23** | Combined current findings cover <=8.5.22; nearest fully patched 8.5.23. | Transitive via Next (production-classified) and Tailwind tooling; primarily CSS build processing. New Next pins 8.5.23; npm dedupes compatible Tailwind usage. | Low-to-moderate minor/patch; build passed. |
| Sharp | 0.34.5 → **0.35.4** | <0.35.0 vulnerable; nearest patched 0.35.0. Selected Next declares ^0.35.3; lock resolves 0.35.4. | Optional production Next image-optimization dependency; native libvips/platform binaries update with it. | Moderate pre-1.0 minor/native update; parent-supported range and PNG smoke test passed. |
| Nanoid | 3.3.12 → **3.3.18** | Findings <3.3.16 and <3.3.18; nearest complete patch 3.3.18. | Transitive PostCSS dependency; refreshed within existing 3.x semver range. | Low patch; no application ID behavior change. |

Kept React and React DOM **19.2.6**, compatible with Next 16.3.0's published peers. No codemod was needed because the app already follows the Next 16 App Router API patterns. Registry metadata for 16.2.11, 16.3.0 and 16.3.4 was compared; choosing the later 16.3.4 was unnecessary for the recorded findings. See [Next 16 upgrade guidance](https://nextjs.org/docs/app/guides/upgrading/version-16).

## Advisory applicability

The recorded Next advisories include Server Actions DoS/SSRF, locale middleware/proxy bypass, rewrites SSRF, cache confusion, SVG optimization DoS and Server Function disclosure. The prior audited implementation uses route-handler authorization, not custom middleware/proxy/locale authorization; no Server Actions, custom server or dynamic external rewrite flow was identified. Those feature-specific prerequisites are absent in the reviewed application. Cache/image framework reachability is not ruled out simply by the absence of application image widgets, so the framework was patched rather than declaring every advisory inapplicable.

PostCSS issues involve CSS/source-map processing, including untrusted sourceMappingURL input. No public CSS ingestion pipeline was identified; the production npm classification does not imply ordinary booking requests invoke PostCSS. Nanoid advisories involve special non-secure/custom generator size cases; application sessions use crypto.randomUUID, not those APIs. Sharp's [libvips advisory](https://github.com/advisories/GHSA-f88m-g3jw-g9cj) is relevant to untrusted image processing; no application upload/next/image use was identified in the prior audit, but default framework image infrastructure warrants patching. These exposure statements are source-review conclusions, not proof of universal non-exploitability.

PostCSS and Nanoid advisory references and all exact Next advisory URLs are included in the evidence JSON, including [PostCSS source-map disclosure](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) and [Nanoid zero-size loop](https://github.com/advisories/GHSA-2v37-7h3g-55p8).

## Lockfile and install scripts

Used targeted `npm install --save-exact next@16.3.0 eslint-config-next@16.3.0 --ignore-scripts`, then `npm update nanoid --ignore-scripts`. Preserved the lockfile; no graph-wide regeneration. Reverted incidental Fastq resolution to its original lock entry and synchronized installation. The lock diff is 448 lines (230 additions/218 removals), largely integrity/resolved URLs and optional platform binaries, with 43 version-path additions/removals/changes. The exact inventory follows below; the evidence file preserves it in machine-readable form. No unrelated direct package was upgraded.

No allow-all script approval or persistent npm configuration change was made. The install deliberately skipped lifecycle scripts. Sharp 0.35.4 has no install/postinstall lifecycle script; its platform packages supply binaries. esbuild's `postinstall` selects/validates its binary and can provide fallback installation. unrs-resolver's `postinstall` uses napi-postinstall to check native bindings. On this machine the prebuilt packages worked without those scripts: Sharp generated a PNG, esbuild transformed JavaScript, and unrs-resolver imported successfully. Production build passed. The user's already-successful Vercel deployments establish that the prior configuration works; this session did not access Vercel build logs or prove script approval settings there. No project configuration change is justified by the warnings alone. Existing normal Vercel package-install policy remains unchanged; cross-platform source-build fallbacks were not tested.

## Remaining development-only audit findings

- `@babel/core` — **low**, affected installed range `<=7.29.0`.
- `@esbuild-kit/core-utils` — **moderate**, affected installed range `*`.
- `@esbuild-kit/esm-loader` — **moderate**, affected installed range `*`.
- `brace-expansion` — **high**, affected installed range `<=1.1.17 || 3.0.0 - 5.0.8`.
- `browserslist` — **high**, affected installed range `<=4.28.6`.
- `drizzle-kit` — **moderate**, affected installed range `0.19.0 - 1.0.0-beta.1-fd8bfcc`.
- `esbuild` — **moderate**, affected installed range `<=0.24.2 || 0.27.3 - 0.28.0`.
- `fast-uri` — **high**, affected installed range `3.0.0 - 3.1.5`.
- `js-yaml` — **high**, affected installed range `4.0.0 - 4.3.0`.
- `react-server-dom-webpack` — **high**, affected installed range `19.2.0 - 19.2.7`.

The Drizzle Kit → @esbuild-kit → old esbuild chain has an npm-suggested breaking downgrade to Drizzle Kit 0.18.1; it was not applied. Other dev-tool patch opportunities remain for a separately scoped cleanup. The direct development react-server-dom-webpack 19.2.6 finding has a 19.2.8 fix, but changing it and its React peers was not necessary for the zero-production result. Next ships its own framework RSC implementation; do not treat the dev-package classification alone as evidence that all React/Server Action advisories are harmless. No Server Actions were identified here.

## Regression results

- `npx tsc --noEmit`: passed.
- `npm run build`: passed on Next 16.3.0; 14 static generation entries completed. Expected routes remain: auth login/signout, me, bookings/[id]/duplicate-check, preorder/preorders/[id], products/[id], users/[id], reports, audit-logs, login, preorder and manifest.webmanifest.
- All 61 security/input/origin/auth/rate-limit/preorder/report tests passed using the six focused test files from Phase 3B.
- `git diff --check`: passed.
- Local headless Chrome: **390, 430, 720, 721, 1280px passed** for login interaction, dashboard, new booking, reports, public preorder, manifest and security headers/CSP. No page runtime errors or console errors. Mobile booking actions remained static and checked views had no horizontal overflow.
- Browser API responses were synthetic fixtures; reports used the real report handler/query fixture against isolated PGlite. Browser login did not contact production auth or Redis. Production-server HTML/assets/headers/manifest were real. Local Speed Insights requests were intercepted to avoid an expected local-only telemetry endpoint error. External telemetry delivery and physical Safari/standalone PWA installation/offline behavior were not exercised.
- The browser CLI was unavailable; existing Playwright and installed headless Chrome were used without adding repository dependencies. Screenshots are in `/tmp/green-engine-mobile/phase4a-{width}.png`; results are included in the evidence JSON.

## Deployment risk and rollback

No new environment variables or database migrations. Overall risk is **moderate**, driven by the framework minor and native Sharp update, reduced by the passing regression/build/browser checks. Before an authorized production release, use a normal clean lockfile install on Vercel and smoke-test actual login/Redis/database-backed workflows and Safari/PWA. No deployment or push was performed.

If rollback is required, revert **package.json and package-lock.json together** to the Phase 1–3 deployed revision, reinstall from that lockfile and rebuild; keep all Phase 1–3 code and production credential/security settings intact. A dependency rollback reintroduces the four known production findings, so use it only as a temporary recovery measure while investigating the regression. Do not roll back credentials or restore plaintext authentication.

## Exact lockfile version-path changes

| Lockfile path | Before | After |
| --- | --- | --- |
| `node_modules/@img/sharp-darwin-arm64` | 0.34.5 | 0.35.4 |
| `node_modules/@img/sharp-darwin-x64` | 0.34.5 | 0.35.4 |
| `node_modules/@img/sharp-libvips-darwin-arm64` | 1.2.4 | 1.3.3 |
| `node_modules/@img/sharp-libvips-darwin-x64` | 1.2.4 | 1.3.3 |
| `node_modules/@img/sharp-libvips-linux-arm` | 1.2.4 | 1.3.3 |
| `node_modules/@img/sharp-libvips-linux-arm64` | 1.2.4 | 1.3.3 |
| `node_modules/@img/sharp-libvips-linux-ppc64` | 1.2.4 | 1.3.3 |
| `node_modules/@img/sharp-libvips-linux-riscv64` | 1.2.4 | 1.3.3 |
| `node_modules/@img/sharp-libvips-linux-s390x` | 1.2.4 | 1.3.3 |
| `node_modules/@img/sharp-libvips-linux-x64` | 1.2.4 | 1.3.3 |
| `node_modules/@img/sharp-libvips-linuxmusl-arm64` | 1.2.4 | 1.3.3 |
| `node_modules/@img/sharp-libvips-linuxmusl-x64` | 1.2.4 | 1.3.3 |
| `node_modules/@img/sharp-linux-arm` | 0.34.5 | 0.35.4 |
| `node_modules/@img/sharp-linux-arm64` | 0.34.5 | 0.35.4 |
| `node_modules/@img/sharp-linux-ppc64` | 0.34.5 | 0.35.4 |
| `node_modules/@img/sharp-linux-riscv64` | 0.34.5 | 0.35.4 |
| `node_modules/@img/sharp-linux-s390x` | 0.34.5 | 0.35.4 |
| `node_modules/@img/sharp-linux-x64` | 0.34.5 | 0.35.4 |
| `node_modules/@img/sharp-linuxmusl-arm64` | 0.34.5 | 0.35.4 |
| `node_modules/@img/sharp-linuxmusl-x64` | 0.34.5 | 0.35.4 |
| `node_modules/@img/sharp-wasm32` | 0.34.5 | 0.35.4 |
| `node_modules/@img/sharp-win32-arm64` | 0.34.5 | 0.35.4 |
| `node_modules/@img/sharp-win32-ia32` | 0.34.5 | 0.35.4 |
| `node_modules/@img/sharp-win32-x64` | 0.34.5 | 0.35.4 |
| `node_modules/@next/env` | 16.2.6 | 16.3.0 |
| `node_modules/@next/eslint-plugin-next` | 16.2.6 | 16.3.0 |
| `node_modules/@next/swc-darwin-arm64` | 16.2.6 | 16.3.0 |
| `node_modules/@next/swc-darwin-x64` | 16.2.6 | 16.3.0 |
| `node_modules/@next/swc-linux-arm64-gnu` | 16.2.6 | 16.3.0 |
| `node_modules/@next/swc-linux-arm64-musl` | 16.2.6 | 16.3.0 |
| `node_modules/@next/swc-linux-x64-gnu` | 16.2.6 | 16.3.0 |
| `node_modules/@next/swc-linux-x64-musl` | 16.2.6 | 16.3.0 |
| `node_modules/@next/swc-win32-arm64-msvc` | 16.2.6 | 16.3.0 |
| `node_modules/@next/swc-win32-x64-msvc` | 16.2.6 | 16.3.0 |
| `node_modules/eslint-config-next` | 16.2.6 | 16.3.0 |
| `node_modules/nanoid` | 3.3.12 | 3.3.18 |
| `node_modules/next` | 16.2.6 | 16.3.0 |
| `node_modules/next/node_modules/postcss` | 8.4.31 | removed/deduped |
| `node_modules/postcss` | 8.5.14 | 8.5.23 |
| `node_modules/sharp` | 0.34.5 | 0.35.4 |
| `node_modules/sharp/node_modules/semver` | 7.8.0 | 7.8.5 |
| `node_modules/@img/sharp-freebsd-wasm32` | — | 0.35.4 |
| `node_modules/@img/sharp-webcontainers-wasm32` | — | 0.35.4 |
