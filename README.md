# JoshBox — private AI video studio

The primary UI is now a dark, responsive single page written in vanilla HTML and JavaScript with Tailwind CSS via CDN. It is served at `/studio.html` on the existing private ChatGPT Site. The root redirects there after sign-in. The existing Sites server, D1 records, private R2 gallery, and authenticated media routes remain in place; the daily UI has no ComfyUI node graph.

## Current state

The recovered hosted version had a real interface and a generic ComfyUI adapter, but no production GPU URL, access token, checkpoint, or workflow settings. GitHub initially contained only a README. This revision adds the vanilla dashboard, an authenticated FastAPI proxy, SSE progress, and the Ubuntu startup script. It does not start a Vast rental, install models, or claim that unconfigured presets are installed.

The native MiniMax H3 setup is preserved. New model quick picks are draft settings until corresponding, verified API workflow files are configured on the GPU.

## Dashboard

- Starting-image upload, drag/drop, and private-gallery selection.
- Positive prompt, collapsible negative prompt, and local context-sensitive suggestions. Suggestions change the prompt only when tapped; no additional model provider is involved.
- 16:9 (1024×576), 9:16 (576×1024), and 1:1 (768×768) presets; approximate 5/10/15-second picks; numeric/range controls for frames, FPS, steps, motion bucket, and motion scale.
- Seed input and randomization; Fast/Quality and Boost. Boost selects the configured Fast workflow for the selected model. No automatic model downloads or speculative speed claims.
- Quick picks: MiniMax H3, Wan 2.2 14B 4-step I2V, Wan 2.2 14B quality, Wan 2.2 5B TI2V, LTX 2.3 I2V, and HunyuanVideo 1.5. Selecting one loads a draft, not an installation.
- POST `/api/generate` with multipart image and JSON settings. Its response is an SSE stream carrying real status, active node name, and per-node sampling step/total values. The percentage is per node, not an invented overall-workflow estimate.
- Video player, native controls, loop, fullscreen, MP4 download, collapsible execution log, and a private gallery.
- Extend Video decodes the saved video's final presentation frame in the browser, previews it as the starting image, and generates a separate next clip. Automatic stitching, motion-context extension, and audio continuation are not implemented.
- Generation, Boost, and model-dependent controls fail closed when their proxy/workflow mappings are unavailable.

## Backend path

`Private browser → Sites /api/generate → authenticated HTTPS FastAPI :8080 → local ComfyUI :8188`

The Site supplies the signed-in owner ID; the proxy token never enters browser code. The proxy uses SQLite receipts and one active job per owner. A repeated request UUID returns the existing job instead of rendering twice. It connects to the ComfyUI websocket before submitting, then confirms completion through history. Network-ambiguous jobs are reconciled without automatic resubmission.

Completed MP4s are first copied into the wrapper's persistent data directory. The Site copies them into private R2 before exposing a saved gallery entry. Keep JoshBox open, or reopen it, before stopping the GPU. There is no unattended Site archive collector. Each video is capped at 512 MB; D1/R2 archive routes are scoped to the signed-in owner. Existing saved legacy images and videos remain available in the gallery.

## Set up on the existing Vast Ubuntu instance

This setup requires a manually started instance. Run it only when ready to incur the existing GPU rental cost. No account or rental control is included in the app or script.

1. Keep the existing ComfyUI installation and model files. Do not replace or update them as part of installing the wrapper.
2. Place this repository at `/workspace/joshbox`. Create an isolated Python environment for the wrapper:

```bash
python3 -m venv /workspace/joshbox/.venv
/workspace/joshbox/.venv/bin/python -m pip install -r /workspace/joshbox/vast/requirements.lock
```

3. Configure the runtime values from `vast/proxy.env.example` using private environment settings. Set a random `VIDEO_PROXY_TOKEN` of at least 32 characters, keep it out of shell history/source, and use the same token as a protected Site runtime secret. `COMFY_PYTHON` must be the Python environment that already runs the installed ComfyUI. Set `APP_PYTHON=/workspace/joshbox/.venv/bin/python`.
4. Configure `WORKFLOW_MINIMAX_QUALITY_PATH` to a verified API-format workflow export. An existing `WORKFLOW_QUALITY_PATH` is also accepted for MiniMax. Fast uses a separate verified `WORKFLOW_MINIMAX_FAST_PATH` (or legacy `WORKFLOW_FAST_PATH`). The Fast graph must already contain the correct acceleration model/LoRA and sampling settings; the wrapper does not infer or install them.
5. Start the entrypoint:

```bash
bash /workspace/joshbox/vast/start_vast.sh
```

The script checks NVIDIA availability, sets CUDA variables while preserving explicit overrides, refuses occupied service ports, starts ComfyUI with `--listen 127.0.0.1 --port 8188 --disable-auto-launch`, waits for `/system_stats`, and launches one Uvicorn worker on `0.0.0.0:8080`. Both process groups are stopped on SIGTERM/SIGINT or service exit. Timestamped logs append to `/workspace/logs/comfyui.log` and `/workspace/logs/app.log` with owner-only permissions.

6. Expose only the authenticated wrapper via the existing protected Vast proxy with trusted HTTPS. A local SSH tunnel can be used for local-only access but is not reachable by the hosted Site. Do not expose ComfyUI itself. The entrypoint will refuse to start a duplicate ComfyUI process; do not run it alongside another launcher on port 8188.
7. Configure the existing Site's protected runtime `VIDEO_PROXY_URL` and `VIDEO_PROXY_TOKEN`. The URL is the wrapper base URL, with a supported path prefix if needed, without credentials/query secrets. The old `COMFY_*` settings remain available for the legacy adapter.
8. Check the GPU connection from the dashboard, generate a short clip, verify real step/node events, wait for private-gallery saving, download the MP4, and test Extend Video. Confirm downloads still work after stopping the GPU.

## Workflow mapping

The workflow files stay on the GPU and retain their model loaders and node links. Use exact placeholder strings only where that workflow supports the input:

`$prompt`, `$negative`, `$image`, `$width`, `$height`, `$frames`, `$fps`, `$steps`, `$seed`, `$motion_bucket`, `$motion_scale`.

`$prompt` and `$image` are required. Numeric substitutions retain their type. The image value comes from ComfyUI's upload receipt. Embedded substitutions such as `portrait of $prompt` are unsupported. Unmapped inputs keep their existing fixed values; related dashboard controls are disabled. Only trusted local GPU workflow graphs are accepted; common hosted API nodes are rejected. This validation is not a sandbox for custom Python nodes.

Native H3 uses 24 FPS and its 17k+5 frame grid (124/243/362 frames for approximately 5/10/15 seconds). Other model presets are starting points, not hardware performance promises. Export and verify each Fast/Quality workflow before assigning the corresponding environment path. Save MP4 output through ComfyUI history.

Additional model paths use `WORKFLOW_WAN14_{QUALITY,FAST}_PATH`, `WORKFLOW_WAN5_{QUALITY,FAST}_PATH`, `WORKFLOW_LTX23_{QUALITY,FAST}_PATH`, and `WORKFLOW_HUNYUAN15_{QUALITY,FAST}_PATH`. Their absence is shown as Setup needed. Configured indicates a valid local file; a real generation is still required to establish that its nodes, models, and outputs work.

## Development and checks

Use the pinned pnpm version and `pnpm install --frozen-lockfile`. On Windows, the Linux-only starter install script is not used. Run `node scripts/run-framework.mjs dev` for the local preview. The portable Sites profile has a localhost-only preview sign-in; production access is handled by Sites and API routes require identity. Do not expose the development server publicly.

```text
node --experimental-strip-types --test tests/engine.test.mjs tests/studio-controls.test.mjs tests/sse.test.mjs
node node_modules/typescript/bin/tsc --noEmit
python -m unittest discover -s vast -p test_proxy.py -v
bash -n vast/start_vast.sh
```

Build using the Sites plugin's `build-site.mjs`. If editing browser utility TypeScript, regenerate the vanilla modules with:

```text
node node_modules/typescript/bin/tsc lib/last-frame.ts lib/prompt-suggestions.ts --target es2022 --lib dom,es2022 --module es2022 --skipLibCheck --outDir public
```

The focused checks cover SSE packet fragmentation, workflow grids/modes, opt-in suggestions, authenticated proxy requests, saved output receipts, owner separation, and duplicate suppression. Proxy tests use a clearly isolated ComfyUI fixture, not a real GPU. The final-frame browser check uses a synthetic two-scene MP4. Responsive browser QA checks narrow phone and desktop widths; this is not a physical Android-device test. Bash syntax is checked; actual Ubuntu GPU process startup/signal behavior and real generation remain unverified until the instance is available.

## Sources

- [ComfyUI HTTP routes](https://docs.comfy.org/development/comfyui-server/comms_routes)
- [ComfyUI websocket messages](https://docs.comfy.org/development/comfyui-server/comms_messages)
- [Native H3](https://github.com/Comfy-Org/docs/blob/main/tutorials/video/minimax/minimax-h3-native.mdx)
- [Wan 2.2 workflows](https://docs.comfy.org/tutorials/video/wan/wan2_2)
- [LTX documentation](https://github.com/Comfy-Org/docs/blob/main/tutorials/video/ltx/ltx-2.mdx)
- [HunyuanVideo 1.5 workflows](https://github.com/Tencent-Hunyuan/HunyuanVideo-1.5/blob/main/ComfyUI/README.md)
- [Tailwind browser CDN](https://tailwindcss.com/docs/installation/play-cdn): included as requested; Tailwind describes this CDN runtime as a development tool. A compiled stylesheet is the appropriate later production hardening step.
