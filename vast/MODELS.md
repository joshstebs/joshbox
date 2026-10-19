# Local video model packs

JoshBox includes the following local image-to-video packs. Existing operator workflow paths remain authoritative. A bundled graph is an integration recipe, not proof of a successful GPU render. The authenticated capability endpoint checks the actual running ComfyUI node registry and loader file choices before enabling it.

| Pack ID | Model and dependencies | Bundled modes |
| --- | --- | --- |
| `minimax_h3` | MiniMax H3 pruned INT8 FL2VA, Qwen3-VL NVFP4 encoder, video INT8 VAE, audio FP32 VAE | Quality; Fast with official FL2V eight-step turbo LoRA |
| `ltx13b` | LTX-Video 0.9.8 13B distilled FP8 checkpoint, T5 XXL FP16, pinned official Lightricks nodes | Fast, fixed eight-step sigma schedule |
| `hunyuan15` | HunyuanVideo 1.5 720p I2V CFG-distilled FP8, Qwen 2.5 VL FP8, ByT5, SigCLIP vision, Hunyuan 1.5 VAE | Quality, fixed 50 steps / CFG 1 / shift 7 |
| `wan22_14b` | High- and low-noise I2V FP8 experts, UMT5 FP8, Wan 2.1 VAE | Quality, 20 steps split at step 10 |
| `wan22_5b` | Existing verified TI2V 5B FP16, UMT5 FP8, Wan 2.2 VAE | Existing Quality graph |

LTX 13B is separate from LTX 2.3. HunyuanVideo **1.5** is separate from the original HunyuanVideo model and its older GGUF files. No GGUF checkpoint is substituted into a safetensors loader. Native ComfyUI supports the bundled H3, Hunyuan, and Wan paths; Kijai wrappers are not required for these graphs. Other wrapper workflows may still be selected through private runtime settings.

## One-command setup

After updating the repository checkout on the already rented instance:

```bash
bash /workspace/joshbox/vast/bootstrap_all.sh
```

By default, the bootstrap detects complete catalog packs already present in ComfyUI and selects only those; it does not download other families. To install packs explicitly, set `JOSHBOX_MODELS` in `/workspace/joshbox.env`. The complete catalog totals well over 100 GB; use a suitably sized persistent model volume.

For the instance listing in this setup, keep its existing GGUF files and model folders intact. The current Wan 14B bundled graph uses FP8 safetensors dual experts and does not load GGUF through ComfyUI-GGUF, so Wan 14B remains unavailable until a matching GGUF graph is provided. The existing Wan 5B graph can be selected only if all three expected 5B/UMT5/Wan VAE files are present; the instance notes alone do not confirm that pack.

Example to add only known local model packs; adjust after checking the files:

```bash
JOSHBOX_MODELS=wan22_5b
JOSHBOX_MODEL_ROOT=/workspace/persistent/joshbox-models
```

`JOSHBOX_MODEL_ROOT` is optional. By default models live under `COMFY_DIR/models`. Existing valid ComfyUI files are reused. New files on a separate persistent volume are linked into the appropriate ComfyUI folders. Existing conflicting files are preserved for inspection rather than silently replaced by symlinks. The LTX checkpoint includes its VAE and belongs in `models/checkpoints`; diffusion-only models, text encoders, LoRAs, vision encoders, and separate VAEs use their respective model folders.

Each download uses a pinned Hugging Face revision, exact byte size, and SHA-256 from publisher metadata. Verified files receive a size/mtime/hash receipt so reruns avoid repeated network transfers and hashing. Interrupted downloads remain `.part` files and are never installed as finished models. Gated downloads can use an existing `HF_TOKEN` in the private environment. No token belongs in source, shell arguments, or URLs.

The official Lightricks custom node repository is installed only when absent, at the revision in `model_catalog.json` that still contains its LTX-Video 13B nodes. Existing custom-node installations and ComfyUI itself are not reset or updated. Custom-node dependencies install into `COMFY_PYTHON`; point that at ComfyUI's actual Python environment.

Restart ComfyUI after adding custom nodes, and restart the wrapper after updating its Python source. A healthy existing process is reused, so bootstrapping does not automatically terminate a running render. Fresh on-start runs use the new files. If node classes or files remain absent from `/object_info`, Studio keeps the affected mode unavailable. A short MP4 render, audio playback for H3, private gallery save, and download must still be checked on the GPU.

## Controls and LoRAs

H3 uses 24 FPS and `17k+5` frames. LTX uses `8k+1` frames. Wan and Hunyuan use `4k+1`. Hunyuan supports 16-pixel dimension alignment, including 1280×720; the other bundled models use 32-pixel alignment. Fixed schedules omit `$steps`, so Studio disables the step control. Fast/Boost requires a ready Fast workflow and its models. CFG distillation alone is not a four- or eight-step acceleration method.

The H3 Fast graph explicitly loads the matching official eight-step FL2V turbo LoRA at strength 1. Other compatible, general-purpose style LoRAs can be connected in an operator-selected API export using ComfyUI's `LoraLoaderModelOnly` or the appropriate model-specific node. Its `lora_name` must be present in ComfyUI's loader choices before readiness passes. Arbitrary LoRAs are not injected across model families, and no adult-focused LoRA packs are bundled.

## Provenance

- Native reference schemas: [ComfyUI](https://github.com/Comfy-Org/ComfyUI/tree/8f04fd6ecf4a548937971e840af2a985529fab76).
- H3 and Wan: the I2V quality branches of [official workflow templates](https://github.com/Comfy-Org/workflow_templates/tree/59a3b48bf369c5a15f29a1308bae3e279fa15505/templates). Editor subgraphs and quality/turbo switches are flattened into explicit graphs. Frames map directly to conditioning nodes. H3 Fast follows the FL2V eight-step LoRA branch.
- LTX: the base stage of [Lightricks' distilled FP8 I2V example](https://github.com/Lightricks/ComfyUI-LTXVideo/blob/445e087a43b95b57ef765874b6787446ec72546c/example_workflows/13b-distilled/ltxv-13b-dist-i2v-base-fp8.json). Uses the compatible 0.9.8 distilled checkpoint, native ManualSigmas instead of float-list utility nodes, and native MP4 saving instead of the optional video-combine/upscale/grain stages.
- Hunyuan: the base I2V branch of the official template, with the CFG-distilled checkpoint and [Tencent's required CFG 1 / shift 7 / 50-step settings](https://github.com/Tencent-Hunyuan/HunyuanVideo-1.5#optimal-inference-configurations). Optional super-resolution is omitted.
- Exact model revisions, sizes and hashes: [model_catalog.json](model_catalog.json), from `Comfy-Org/MiniMax-H3`, `Comfy-Org/HunyuanVideo_1.5_repackaged`, `Comfy-Org/Wan_2.2_ComfyUI_Repackaged`, `Lightricks/LTX-Video`, and `comfyanonymous/flux_text_encoders`. Publisher model licenses continue to govern their weights.
