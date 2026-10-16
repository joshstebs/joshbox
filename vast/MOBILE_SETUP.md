# JoshBox mobile-first Vast setup

The goal is to avoid terminal choreography on a phone.

## First time on a fresh Vast instance

Use the ComfyUI template and enough disk for the model set. Clone the private JoshBox repository once, then run:

```bash
bash /workspace/joshbox/vast/setup_mobile.sh
```

That single command:

- verifies the NVIDIA GPU and ComfyUI path
- creates the JoshBox Python environment if needed
- installs the pinned wrapper requirements
- downloads/resumes the Wan 2.2 5B model, FP8 text encoder, and VAE directly into ComfyUI
- creates a private runtime env file with a random proxy token
- installs the bundled Wan 5B Quality workflow and fills an empty Quality path, preserving custom paths
- leaves existing files alone when they are already complete

It is safe to rerun after an interrupted download.

## What it intentionally does not do

It does not rent or stop a GPU, expose ComfyUI publicly, place secrets in GitHub, or invent a workflow mapping. The bundled export has no starting-image connection. JoshBox reports that limitation and keeps generation disabled until an image-connected API export is configured. Fast remains unconfigured. See `workflows/README.md`.

## Reusing a surviving instance

If the instance still has the repo and model files, rerun the same command. Completed model files are detected and skipped.

## Optional on-start helper

`vast/onstart.example.sh` can update an existing checkout and rerun setup automatically when an instance starts. A brand-new instance still needs authenticated access to the private GitHub repo at least once.

## Runtime start

After setup, start the private runtime using the generated settings (generation still requires an image-connected export):

```bash
set -a
source /workspace/joshbox.env
set +a
bash /workspace/joshbox/vast/start_vast.sh
```

Only the authenticated JoshBox wrapper on port 8080 should be exposed. Keep ComfyUI itself bound to localhost.
