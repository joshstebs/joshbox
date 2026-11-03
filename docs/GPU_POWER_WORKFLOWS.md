# JoshBox GPU power and creative workflow library

## Daily phone workflow

1. Open the authenticated JoshBox studio, select **Vast.ai** or **Google Cloud**, and tap **Check instance**.
2. Tap **Start instance**. Confirm the provider and displayed instance. This starts the **existing** configured rental or VM only, not a new machine. Starting may incur GPU charges.
3. Tap **Check GPU** once its ComfyUI wrapper is available. No auto-start or background rental is implied.
4. Choose a model. Pick its registered workflow, optionally select an installed and compatible LoRA, and set LoRA strength (0 to 2).
5. Generate, watch the render, and **wait until the MP4 is saved in the private JoshBox gallery**.
6. Tap **Stop instance**. The server refuses the stop while the account has any uncompleted, uncertain or archiving job.

A stopped Vast instance retains data but continues storage charges and may not have a GPU available when restarted. Stopping a Google Cloud VM stops VM compute charges, but persistent disk and other allocated resources can continue billing. Spot VMs may fail to restart when capacity is unavailable. No destructive delete/destroy operation is exposed.

## Protected server instance settings

In the **authenticated JoshBox Site's server-only environment**, configure only the machines JoshBox may control:

```dotenv
# Google Cloud existing VM (NOT a generic instance picker):
GCP_INSTANCE_PROJECT=replace-with-your-project-id
GCP_INSTANCE_ZONE=us-central1-c
GCP_INSTANCE_NAME=joshbox-gcp
GCP_SERVICE_ACCOUNT_JSON={"type":"service_account","client_email":"...","private_key":"..."}

# Vast.ai existing rental (integer instance ID):
VAST_INSTANCE_ID=12345678
VAST_API_KEY=stored-only-in-private-runtime
```

The examples above are placeholders, **not discovered VM identifiers**. Assign the Google Cloud service account only the permissions needed for `compute.instances.get`, `compute.instances.start`, and `compute.instances.stop` on the specific resource where possible. Keep its JSON key in a protected secret store and restrict access/rotate if exposed. JoshBox signs an OAuth JWT on the server. For Vast use an API key with appropriate instance management permissions, stored only on the server.

Each instance's separate **ComfyUI wrapper** also needs its `VIDEO_PROXY_GCP_URL` or `VIDEO_PROXY_VAST_URL` and server-only token from [MOBILE_GPU_PROVIDERS.md](MOBILE_GPU_PROVIDERS.md). Power controls are deliberately independent of the GPU's health: they must work when the GPU is off.

The mobile UI never chooses arbitrary cloud project IDs, Vast IDs, URLs, credentials, or destructive actions. POST requires same-origin owner authentication and a matching action/provider confirmation string. Never run the production Site without its authenticated owner identity and Cloudflare D1/R2 bindings. The current Vercel build is incompatible with the Cloudflare/vinext app until hosting is reconciled.

## Register per-model workflows and LoRAs

This is a catalogue, not an automatic LoRA download or workflow editor. On each GPU, make **one private, operator-controlled JSON file**. Example (illustrative file paths and names; replace only with actual confirmed exports and installed filenames):

```json
{
  "workflows": [
    {
      "id": "h3-pov",
      "name": "MiniMax H3 · POV",
      "model": "minimax_h3",
      "mode": "quality",
      "path": "/workspace/joshbox-workflows/h3-pov-api.json"
    }
  ],
  "loras": [
    {
      "id": "h3-pov-lora",
      "name": "MiniMax H3 · POV",
      "model": "minimax_h3",
      "filename": "actual-installed-pov.safetensors"
    }
  ]
}
```

Set `JOSHBOX_WORKFLOW_CATALOG_PATH=/workspace/joshbox-creative-catalog.json` in the private runtime on **each GPU** and restart the JoshBox FastAPI wrapper to reload its environment. Each named workflow uses its own API-format export. Existing `WORKFLOW_MINIMAX_QUALITY_PATH`, `WORKFLOW_MINIMAX_FAST_PATH` and other model defaults still work without any catalogue. Only named, installed model-compatible workflow options become available in the phone UI.

**Editable LoRA slot**: The trusted API graph must include a *real* `LoraLoaderModelOnly` or `LoraLoader` node whose `inputs.lora_name` is exactly `"$lora_name"` and whose `inputs.strength_model` is exactly `"$lora_strength"`. Wire the loader's model output to the sampler. The backend substitutes the approved installed filename and the requested strength only in this explicit slot, never inserts nodes or swaps diffusion families automatically. Workflows that already bake in turbo LoRAs can be registered as their own named workflow; do **not** stack another turbo LoRA unless the workflow explicitly supports it.

The backend checks workflow node registry and loader choices through ComfyUI's `/object_info`. An uninstalled LoRA does not appear as selectable. Each GPU keeps its own catalogue because their disk contents may differ.

### Muse/Milo files to reconcile on the GPU

The latest provided notes report a 20 GB diffusion model, 2.7 GB video VAE, 578 MB audio VAE, a 15 GB Qwen encoder, three 1.9 GB turbo LoRAs, and two 126 MB POV LoRAs. **These sizes alone do not prove their model family, node compatibility, or exact filenames.** Check `/object_info`, the ComfyUI model folders, and API graph links before adding entries. **M3_V1 is still gated** and should stay marked unavailable until legitimately accessible and installed.

A useful initial set after verifying files is: H3 Quality, H3 Turbo (with its required fixed turbo LoRA), H3 POV, and a quality version of any actually working LTX workflow. No arbitrary GPU downloads or model installation are triggered by the UI.

## Verification

```bash
node --experimental-strip-types --test tests/instance-controls.test.mjs tests/video-provider.test.mjs
python -m unittest discover -s vast -p 'test_*.py' -v
```

Then verify an actual authenticated mobile test for the two providers, including a completed gallery archive before stopping. Until runtime credentials, hosted authentication, verified API workflows, and phone QA are complete, this is a **source-code implementation**, not a live production feature.
