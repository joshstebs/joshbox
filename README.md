# JoshBox — private AI video studio

The primary UI is now a dark, responsive single page written in vanilla HTML and JavaScript with Tailwind CSS via CDN. It is served at `/studio.html` on the existing private ChatGPT Site. The root redirects there after sign-in. The existing Sites server, D1 records, private R2 gallery, and authenticated media routes remain in place; the daily UI has no ComfyUI node graph.

## Current state

The recovered hosted version had a real interface and a generic ComfyUI adapter, but no production GPU URL, access token, checkpoint, or workflow settings. GitHub initially contained only a README. This revision adds the vanilla dashboard, an authenticated FastAPI proxy, SSE progress, and the Ubuntu startup script. It does not start a Vast rental, install models, or claim that unconfigured presets are installed.

Wan 2.2 14B is the default engine: Fast uses the official 4-step LoRAs, and Quality uses the base models with a higher-step profile. The MiniMax H3 API graph was recovered from the attached MP4 because the separate JSON attachments were empty; its exact model filenames, video/audio VAEs, and sampler choices are preserved in the Audio alternate. Your original prompt, seed, image filename, and personal workflow titles were removed before committing. Bundled workflows are structure-checked but still need a real GPU generation test.

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

## Fresh Vast bootstrap and reusable model library

`config/models.json` is the library manifest. Every public safetensors asset has an official Hugging Face repository, pinned commit, expected size, SHA-256, and ComfyUI target directory. Public base weights stay on their original repositories. Git contains the app, manifest, four parameterized API workflows, and setup scripts; weight extensions are ignored.

Default setup downloads only `wan22-fast,wan22-quality`: six files totaling 38,033,162,727 bytes (about 38 GB). Adding `minimax-h3` or `minimax-h3-fast` opts into the recovered audio-model family (about 44.4 GB including its turbo LoRA). The manifest defines all four profiles; it does not download unused families by default.

On a fresh PyTorch/CUDA instance with enough free disk space and a protected `VIDEO_PROXY_TOKEN`, place this checkout at `/workspace/joshbox`, then run:

```bash
bash /workspace/joshbox/scripts/setup-vast.sh
```

The installer clones the pinned official ComfyUI revision only when ComfyUI is absent. It reuses an existing installation without pulling/resetting its code or changing its models. Existing ComfyUI Python can be selected with `COMFY_PYTHON`. Its service ports must be free: JoshBox does not kill a template-owned ComfyUI process. Use a PyTorch/CUDA base template for full supervision.

The setup creates isolated Python environments, starts the authenticated wrapper early, and syncs the selected library before starting local ComfyUI. `vast/sync_models.py` resumes through the HF cache, verifies SHA-256/size, preserves conflicting existing files, checks disk space/download budget, and links the verified weight copy into the library and ComfyUI folders. Restarting the same disk reuses verified files. A new/destroyed machine still needs the cloud-to-datacenter transfer; there is no persistent mounted GPU volume.

`JOSHBOX_MODEL_DIR` defaults to `/workspace/joshbox-models`; `JOSHBOX_BOOTSTRAP_PROFILES` selects profiles; `JOSHBOX_MAX_DOWNLOAD_GB` limits selected asset size (default 100 GB). About 2 GiB extra free space is required as a minimum transfer margin; allow further capacity for ComfyUI, environments, and outputs. Plan without downloading:

```bash
/workspace/joshbox/.venv/bin/python /workspace/joshbox/vast/sync_models.py --manifest /workspace/joshbox/config/models.json --comfy-dir /workspace/ComfyUI --plan
```

`scripts/onstart.sh` is the container-start hook. For a compatible SSH instance, place it at `/root/onstart.sh`; for a custom-command instance, run it as the container command. Preserve/review an existing hook rather than overwriting a template's startup behavior. It can clone JoshBox using `JOSHBOX_REF`; until this change is merged, use the reviewed `codex/wan-bootstrap` branch. After merge, the default `main` works. [Vast's official startup documentation](https://github.com/vast-ai/docs/blob/main/guides/reference/faq/instances.mdx) documents these hook forms.

The dashboard exposes Offline → Starting → Downloading Models → Ready → Generating. Download progress reports completed, verified files/bytes, not an invented transfer percentage. Ready requires ComfyUI health, required core nodes, and referenced model files; real rendering still needs testing. A template on a new host may need its protected `VIDEO_PROXY_URL` updated on the Site.

## Private Hugging Face assets and credentials

The empty, private repository is `GodofThrones/joshbox-assets`, created through your signed-in browser. It is reserved for custom LoRAs, private adaptations, and optional cached assets—not copies of the public base models. No model files or private source media were uploaded.

Optional private sync uses `HF_ASSETS_REPO`, `HF_TOKEN`, and a pinned `HF_ASSETS_REVISION`; the bootstrap downloads `HF_ASSETS_MANIFEST` (default `config/private-assets.json`) from that exact private repository. A local `HF_PRIVATE_MANIFEST` may override this. Leave the revision unset while the private repository is empty. Private entries must be marked private, pinned, checksum-verified, and scoped to that exact repository. Public downloads explicitly use `token=False`, so a private token is never sent to public model repositories. Bootstrap needs a fine-grained READ token. Keep a separate repository-only read/write token for uploads; do not grant billing, inference, or global repository access.

Do not paste tokens into chat, source, workflow JSON, URLs, or browser JavaScript. Configure the GPU token through protected container environment settings. Create and store tokens yourself through the provider's controls. The bootstrap token should be separate from an upload token.

On this Windows laptop, `scripts/save-hf-token.ps1` is an optional user-run, hidden-input prompt. It stores an existing NEW token using Windows DPAPI and a user-only file ACL. It does not create, print, or transmit the token and was not executed with a real credential. A Windows-encrypted credential is local storage; it is not automatically forwarded to Vast.

`VAST_API_KEY` is reserved as a server-only environment secret for a future rental controller. This release does not rent/start/stop/destroy instances, call HF inference, or spend money. Automatic GPU lifecycle management still needs offer/budget limits, explicit spending authorization, and real lifecycle verification.

## Standalone wrapper on an already prepared Vast Ubuntu instance

This setup requires a manually started instance. Run it only when ready to incur the existing GPU rental cost. No account or rental control is included in the app or script.

1. Keep the existing ComfyUI installation and model files. Do not replace or update them as part of installing the wrapper.
2. Place this repository at `/workspace/joshbox`. Create an isolated Python environment for the wrapper:

```bash
python3 -m venv /workspace/joshbox/.venv
/workspace/joshbox/.venv/bin/python -m pip install -r /workspace/joshbox/vast/requirements.lock
```

3. Configure the runtime values from `vast/proxy.env.example` using private environment settings. Set a random `VIDEO_PROXY_TOKEN` of at least 32 characters, keep it out of shell history/source, and use the same token as a protected Site runtime secret. `COMFY_PYTHON` must be the Python environment that already runs the installed ComfyUI. Set `APP_PYTHON=/workspace/joshbox/.venv/bin/python`.
4. Configure `WORKFLOW_MINIMAX_QUALITY_PATH` to a verified API-format workflow export. An existing `WORKFLOW_QUALITY_PATH` is also accepted for MiniMax. Fast uses a separate verified `WORKFLOW_MINIMAX_FAST_PATH` (or legacy `WORKFLOW_FAST_PATH`). The Fast graph must already contain the correct acceleration model/LoRA and sampling settings; the wrapper does not infer or install them.
5. For an already prepared instance, start the standalone entrypoint (the fresh bootstrap above calls it with model sync enabled):

```bash
bash /workspace/joshbox/vast/start_vast.sh
```

The script checks NVIDIA availability, sets CUDA variables while preserving explicit overrides, refuses occupied service ports, starts ComfyUI with `--listen 127.0.0.1 --port 8188 --disable-auto-launch`, waits for `/system_stats`, and launches one Uvicorn worker on `0.0.0.0:8080`. Both process groups are stopped on SIGTERM/SIGINT or service exit. Timestamped logs append to `/workspace/logs/comfyui.log` and `/workspace/logs/app.log` with owner-only permissions.

6. Expose only the authenticated wrapper via the existing protected Vast proxy with trusted HTTPS. A local SSH tunnel can be used for local-only access but is not reachable by the hosted Site. Do not expose ComfyUI itself. The entrypoint will refuse to start a duplicate ComfyUI process; do not run it alongside another launcher on port 8188.
7. Configure the existing Site's protected runtime `VIDEO_PROXY_URL` and `VIDEO_PROXY_TOKEN`. The URL is the wrapper base URL, with a supported path prefix if needed, without credentials/query secrets. The old `COMFY_*` settings remain available for the legacy adapter.
8. Check the GPU connection from the dashboard, generate a short clip, verify real step/node events, wait for private-gallery saving, download the MP4, and test Extend Video. Confirm downloads still work after stopping the GPU.

## Workflow mapping

The workflow files stay on the GPU and retain their model loaders and node links. Use exact placeholder strings only where that workflow supports the input:

`$prompt`, `$negative`, `$image`, `$width`, `$height`, `$frames`, `$fps`, `$steps`, `$split_steps`, `$seed`, `$motion_bucket`, `$motion_scale`.

`$prompt` and `$image` are required. Numeric substitutions retain their type. `$split_steps` resolves the Wan high/low-noise split; accelerated Wan and H3 profiles lock their verified 4/8-step counts. The image value comes from ComfyUI's upload receipt. Embedded substitutions such as `portrait of $prompt` are unsupported. Unmapped inputs keep their existing fixed values; related dashboard controls are disabled. Only trusted local GPU workflow graphs are accepted; common hosted API nodes are rejected. This validation is not a sandbox for custom Python nodes.

Native H3 uses 24 FPS and its 17k+5 frame grid (124/243/362 frames for approximately 5/10/15 seconds). Other model presets are starting points, not hardware performance promises. Export and verify each Fast/Quality workflow before assigning the corresponding environment path. Save MP4 output through ComfyUI history.

Additional model paths use `WORKFLOW_WAN14_{QUALITY,FAST}_PATH`, `WORKFLOW_WAN5_{QUALITY,FAST}_PATH`, `WORKFLOW_LTX23_{QUALITY,FAST}_PATH`, and `WORKFLOW_HUNYUAN15_{QUALITY,FAST}_PATH`. Their absence is shown as Setup needed. Configured indicates a valid local file; a real generation is still required to establish that its nodes, models, and outputs work.

## Development and checks

Use the pinned pnpm version and `pnpm install --frozen-lockfile`. On Windows, the Linux-only starter install script is not used. Run `node scripts/run-framework.mjs dev` for the local preview. The portable Sites profile has a localhost-only preview sign-in; production access is handled by Sites and API routes require identity. Do not expose the development server publicly.

```text
node --experimental-strip-types --test tests/engine.test.mjs tests/studio-controls.test.mjs tests/sse.test.mjs
node node_modules/typescript/bin/tsc --noEmit
python -m unittest discover -s vast -p 'test_*.py' -v
bash -n vast/start_vast.sh scripts/setup-vast.sh scripts/onstart.sh
```

Build using the Sites plugin's `build-site.mjs`. If editing browser utility TypeScript, regenerate the vanilla modules with:

```text
node node_modules/typescript/bin/tsc lib/last-frame.ts lib/prompt-suggestions.ts --target es2022 --lib dom,es2022 --module es2022 --skipLibCheck --outDir public
```

The focused checks cover SSE packet fragmentation, workflow grids/modes, opt-in suggestions, authenticated proxy requests, saved output receipts, owner separation, duplicate suppression, model-manifest/workflow consistency, cache reuse, checksums, path traversal, download budgets, and preservation of existing files. Proxy/model-sync tests use isolated ComfyUI/download fixtures, not a real GPU or large weight transfers. Windows link tests use small fixture copies; Linux tests exercise symlinks. The final-frame browser check uses a synthetic two-scene MP4. Responsive browser QA checks narrow phone and desktop widths; this is not a physical Android-device test. Bash syntax is checked; actual Ubuntu GPU process startup/signal behavior, multi-gigabyte download/resume, private-token sync, and real Wan rendering remain unverified until the instance is available.

## Sources

- [ComfyUI HTTP routes](https://docs.comfy.org/development/comfyui-server/comms_routes)
- [ComfyUI websocket messages](https://docs.comfy.org/development/comfyui-server/comms_messages)
- [Native H3](https://github.com/Comfy-Org/docs/blob/main/tutorials/video/minimax/minimax-h3-native.mdx)
- [Wan 2.2 workflows](https://docs.comfy.org/tutorials/video/wan/wan2_2)
- [LTX documentation](https://github.com/Comfy-Org/docs/blob/main/tutorials/video/ltx/ltx-2.mdx)
- [HunyuanVideo 1.5 workflows](https://github.com/Tencent-Hunyuan/HunyuanVideo-1.5/blob/main/ComfyUI/README.md)
- [Tailwind browser CDN](https://tailwindcss.com/docs/installation/play-cdn): included as requested; Tailwind describes this CDN runtime as a development tool. A compiled stylesheet is the appropriate later production hardening step.
