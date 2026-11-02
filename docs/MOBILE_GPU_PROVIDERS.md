# JoshBox on Android and other phones (Google Cloud or Vast.ai)

The JoshBox mobile browser UI is a front end. ComfyUI does the GPU work on a remote machine. The phone never runs ComfyUI or downloads models.

## What the phone does

Open the **authenticated JoshBox studio** in Chrome or another modern mobile browser. Use the bottom **Create / Render / Gallery** navigation, choose your GPU from the provider selector, upload a starting image from your phone, enter a prompt, render, and retrieve finished MP4s from the private gallery. After authenticating, Chrome on Android can add the site to the home screen. Video playback uses `playsinline` and the media endpoint supports HTTP byte ranges.

Existing recordings remain associated with the backend used when the job was submitted. Switching the provider only changes *new* generations and connection checks. It does not rent, wake, or shut down a GPU, and never submits an existing job to another backend. If a job is running, stay on the current profile until it is saved; when you reopen JoshBox the pending job can resume its status checks.

## Provision either GPU

Both Google Cloud VM and Vast.ai run the **same** private wrapper and a local ComfyUI server:
```text
Phone -> authenticated JoshBox Site / HTTPS -> Site API -> authenticated HTTPS tunnel -> FastAPI video wrapper :8080 -> localhost ComfyUI :8188
```
ComfyUI must bind only to localhost. Do not publish port 8188 or put a wrapper token into the browser. The wrapper's `VIDEO_PROXY_TOKEN` must be a random secret at least 32 characters long, stored privately on the GPU and in your Site runtime environment. Use a distinct token per machine.

### Vast.ai

Use `vast/bootstrap_all.sh` with your existing Vast ComfyUI environment, as detailed in [MOBILE_SETUP.md](../vast/MOBILE_SETUP.md) and [the README](../README.md). The script does not rent a Vast instance. Keep the persistent model and output directories mounted so stopping a rental does not delete your video data.

### Google Cloud

Use a suitable GPU-capable Compute Engine VM with installed NVIDIA driver/CUDA, Python, the required ComfyUI custom nodes, and your **verified** API-format video workflow. The same `vast/app.py` FastAPI wrapper works on a Linux GCP VM despite its directory name; point `COMFY_DIR`, `COMFY_PYTHON`, `APP_PYTHON`, `JOSHBOX_DATA_DIR`, and `WORKFLOW_..._PATH` at the GCP paths in a private service environment. Install its pinned dependencies from `vast/requirements.lock`, run the wrapper with one worker, and use a supervised service rather than a desktop SSH tunnel.

The GCP wrapper must reach ComfyUI on `http://127.0.0.1:8188`. Publish the wrapper via a trusted HTTPS tunnel/reverse proxy requiring the server-side bearer token, not via an open unauthenticated public port. Do not copy models from Vast unnecessarily if both can read a persistent volume or if downloads already exist.

## Configure the hosted Site (protected environment variables)

```dotenv
# Keep existing connections working
VIDEO_PROXY_URL=https://legacy-wrapper.example
VIDEO_PROXY_TOKEN=(legacy private token)

# Additional independently configurable named profiles
VIDEO_PROXY_GCP_URL=https://gcp-wrapper.example
VIDEO_PROXY_GCP_TOKEN=(private GCP token)
VIDEO_PROXY_VAST_URL=https://vast-wrapper.example
VIDEO_PROXY_VAST_TOKEN=(private Vast token)
```

The `Current GPU` option uses legacy `VIDEO_PROXY_URL` and `VIDEO_PROXY_TOKEN`. The `Google Cloud` and `Vast.ai` options use their respective URL/token pairs. Only profiles that have been configured and are online will report a healthy connection. The selector is not a rental/start/stop control.

All proxy URLs must be public, trusted HTTPS destinations without embedded credentials, and all tokens live only in protected server variables. Never enable arbitrary browser-supplied backend URLs or public ComfyUI access.

## Authentication and hosting warning

The current JoshBox server is built for **ChatGPT Sites identity**, Cloudflare D1 and R2 bindings. A regular Vercel deployment of the repository does not automatically provide those user identity headers or storage bindings. Before distributing a mobile URL, deploy JoshBox behind a working, verified owner-login mechanism and configure the required database/object storage bindings, or use the authenticated Sites deployment. **A successful Vercel build alone does not make the studio functional or safely accessible on mobile.**

## Verification on an actual phone

1. Sign in on the mobile URL. Confirm unauthorized users cannot call `/api/connection` or access saved media.
2. Connect to Vast.ai; verify the dashboard reports Vast online and that a real configured workflow is marked available.
3. Submit a short test image-to-video generation, put the phone to sleep briefly, reopen it, and confirm job status continues without a second GPU submission.
4. Save and download the MP4 over mobile data. Check Android's player and the gallery after the GPU is off.
5. Repeat the connection and generation checks on Google Cloud when its wrapper and verified workflow are configured.
6. Rotate tokens privately if either machine's token has been exposed; do not place them in query strings, screenshots, or client-side storage.
