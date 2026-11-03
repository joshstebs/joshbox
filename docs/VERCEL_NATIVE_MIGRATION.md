# Vercel-native JoshBox migration

**Status (2026-11-02):** Native Next.js preview deployment passed Vercel build and reached READY on feature branch `feature/vercel-native-next`. No production deployment or domain cutover has been performed and an authenticated video render has not yet been verified.

## Why the earlier deployment failed

The original `package.json` build calls Vinext/Vite, targeting the Cloudflare Workers and ChatGPT Sites runtime. Vercel's project is configured as a Next.js project. Vinext emits Worker output under `dist/server`; it does **not** create `.next/routes-manifest.json`. Vercel then reports `NEXT_NO_ROUTES_MANIFEST`, even when the Vinext build itself succeeds.

This branch uses **`pnpm exec next build`** via `vercel.json` and the package scripts. Unlike serving only `dist/client`, this deploys the server route handlers too.

## Preserved architecture

- **UI:** the current JoshBox HTML/JS mobile studio remains under `public/studio.html`. The Next.js App Router serves existing API routes.
- **Authentication:** `app/chatgpt-auth.ts` verifies the signed `cf-access-jwt-assertion` against your Cloudflare Access team's JWKS, issuer and audience using `jose`, then checks the owner email allowlist. The old unverified ChatGPT Sites user headers are **never trusted on Vercel**. Cloudflare Access must protect the production custom domain and forward its signed assertion. Vercel's preview SSO alone does **not** supply this assertion, so previews without an Access-protected domain intentionally cannot access private APIs.
- **Durable database:** `db/index.ts` uses Drizzle's SQLite proxy to query the existing protected Cloudflare Worker `DATA_SERVICE_URL/query` with the server-only `DATA_SERVICE_TOKEN`. Its D1 database is already provisioned with `jobs` and `characters` tables. It is not recreated.
- **Private media:** Vercel Blob's *existing private store* is used via the server-only `BLOB_READ_WRITE_TOKEN`; private downloads still validate owner-scoped job/media records and stream through the Next.js media route. Never expose Blob credentials to the browser or switch to a public bucket.
- **GPU:** video requests go to the existing HTTPS GPU proxy using `VIDEO_PROXY_URL` or the existing `VIDEO_PROXY_UPSTREAM_URL`, with the protected bearer `VIDEO_PROXY_TOKEN`. Google Cloud and Vast profiles remain separately configurable. The local FastAPI `vast/app.py` worker **does not run on Vercel**; it runs where ComfyUI, models, persistent SQLite job receipts, and media files reside.
- **Timeout prevention:** `/api/generate` returns HTTP 202 and a job ID after GPU acknowledgement. Rendering progresses on the GPU; the UI polls the corresponding job and archives the result. A browser disconnect must not trigger another submission of the same request ID.

## Build and operational checks

1. Run `pnpm install --no-frozen-lockfile` and `pnpm exec next build`, or use the automatic Vercel Git preview. During migration the install command is intentionally non-frozen because the dependency lockfile needs a reviewed regeneration for `jose` and `@vercel/blob` before reverting to `--frozen-lockfile`.
2. Verify Vercel reports **READY**, not merely a green GitHub Actions check. Ensure the deployment contains Next.js API functions, not just static assets.
3. Verify an Access-authenticated request on the custom domain can obtain a `/api/studio` response with the correct owner and existing jobs. Verify unsigned requests receive HTTP 401. Never bypass the owner check to make previews appear ready.
4. Verify all server-only production secrets exist and are scoped appropriately. Existing Vercel environment *names* were verified; no secrets were copied or printed as part of this migration.
5. Verify one short render on a connected GPU: POST returns quickly with a receipt; mobile polling works after closing/reopening; the video appears in the owner-scoped private Blob gallery and supports a download.
6. Verify start/stop buttons fail safely when cloud credentials are absent and refuse to stop on active or uncertain jobs. Do not start cloud instances as part of CI.
7. Only after successful end-to-end checks, merge stacked PR #5, #6 and the Vercel native PR into main, deploy/promote the tested build, and monitor timeouts.

**Security:** Cloudflare Access is essential for the production domain. Do not use Vercel authentication SSO alone as the application's API owner identity. The same-origin owner check remains in the API layer, and static preview pages cannot generate without a signed Access identity.

**Known remaining limits:** A READY build is not proof of a working production sign-in or GPU render. Large MP4 archiving through serverless Functions may still face transfer or duration limits; a direct private storage upload protocol could improve it later. Existing Site R2 media is *not* automatically copied to Vercel Blob; preexisting Vercel D1 records in the same service were preserved, but any separate Sites data would require a deliberate migration.
