# JoshBox build + generation timeout incident (2026-11-02)

## Verified evidence

- Vercel Project `joshbox` (`prj_KV7xjVCdTm5ageemfgMPJp4PM8uu`) selects framework `nextjs`.
- Recent feature branch Vercel deployments end with `NEXT_NO_ROUTES_MANIFEST`. The log says `Build complete. Run vinext start` before the Vercel Next adapter fails to find `.next/routes-manifest.json`.
- JoshBox `package.json` invokes `scripts/run-framework.mjs build`; outside managed-linux preview that executes `vinext build`. The source uses `cloudflare:workers` identity/bindings (D1 `DB`, R2 `BUCKET`) and `@cloudflare/vite-plugin`. A standard Next.js Vercel runtime cannot replace these bindings by a framework flag alone.
- Vercel grouped runtime error record: 30 `Vercel Runtime Timeout Error: Task timed out after 300 seconds`, 23 users, routes `/api/generate` and `/fastapi`, first 2026-10-26T03:58:53Z and last 2026-11-02T01:07:47Z. The last associated deployment `dpl_5jD9rj8Gxx4s7ireoHvNuGfEmbgP` is an **older CLI production** deployment, not a mobile PR deployment. Older per-request log retention was insufficient for a deeper trace.
- PR #5 and stacked PR #6 are both open/unmerged at the time of inspection; there is no validated Android production release.

## Code mitigation: finish the request, not the GPU job

The Site's POST `/api/generate` now:

1. Requires signed-in owner identity and same-origin POST and validates form input as before.
2. Stores a request-ID-keyed D1 receipt in `submitting` before sending to the authenticated FastAPI wrapper.
3. Waits for the wrapper to acknowledge the request with an SSE response. That wrapper starts a separate, persisted SQLite-tracked background task before returning its streaming response.
4. Updates the Site receipt to `queued`, **closes the upstream SSE stream**, then returns `202 application/json` with the original request ID immediately.
5. Never submits an ID already recorded as active/unknown/completed. Existing IDs return the stored status; only new IDs are submitted. Ambiguous errors remain `uncertain` and must be reconciled before creating a new request.

The phone now accepts JSON receipts, polls `/api/video/jobs/:id` and resumes from its job history on reopen. Legacy SSE is accepted for backwards compatibility. The site-to-wrapper connection handshake is capped at 25 seconds, while the actual GPU task is never given a 25-second deadline.

**Scope:** This addresses the risk of keeping a web function open for a long video render. It does not prove that historical 30 errors were all due to streaming (the aggregate includes a legacy `/fastapi` route), nor does it solve a down GPU, ComfyUI driver problems, archive transfer timeouts or a missing workflow.

## Fix hosting instead of faking a successful Vercel check

There are two valid, non-interchangeable release approaches:

**Preferred: ChatGPT Sites / Cloudflare-native runtime**. Publish the full vinext Worker build on the authenticated Sites infrastructure with its true request-auth context, D1, R2, and protected GPU tokens. Validate `dist/server/wrangler.json`, signed-in owner IDs, media isolation, the external HTTPS wrapper and a real short render. Do not assume your personal Cloudflare account's existing data Worker is the same runtime as a ChatGPT Site.

**Alternative: complete native Vercel migration**. Explicitly implement a Next.js Vercel build, secure owner authentication, durable database/object storage alternatives for D1/R2, protected GPU proxy credentials and long-job polling. Only then change the Vercel project to use the appropriate build/runtime and test private media access. Selecting `framework: null`, pointing Vercel at `dist/client`, or generating an empty routes manifest would create a misleading green build while the server APIs remain broken.

Keep the existing Vercel production deployment and project settings unchanged until the replacement host is fully validated. If preview failures are noisy, consider disabling automatic Vercel previews *only after deciding on the canonical host*, rather than publishing a static partial app.

## Required release checks

- [ ] Current PR #5 then #6 merge checks and source builds pass on intended host
- [ ] Authenticated Android login and owner-scoped API/media authorization pass
- [ ] Both provider instances are reachable through private HTTPS FastAPI wrappers
- [ ] Generation POST returns status 202 with job ID promptly, with no 300-second SSE connection
- [ ] Closing/reopening mobile Chrome leaves a running GPU render intact and does not submit it twice
- [ ] Progress polling continues and finished MP4 is archived into private R2 before GPU shutdown
- [ ] Backend downtime produces an uncertain receipt rather than blind retry/duplicate billing
- [ ] Actual deployment telemetry shows no new `/api/generate` 300-second timeout errors
