The uploaded `wan22-5b-api (1).json` is bundled as `workflows/wan22-5b-quality.json`. The JoshBox integration adds the verified starting-image bridge at node 56 → node 55.

Exact substitutions: node 6 text → `$prompt`; 7 text → `$negative`; 3 seed/steps → `$seed`/`$steps`; 55 width/height/length → `$width`/`$height`/`$frames`; 57 fps → `$fps`. Loaders 37/38/39 retain `wan2.2_ti2v_5B_fp16.safetensors`, `umt5_xxl_fp8_e4m3fn_scaled.safetensors`, and `wan2.2_vae.safetensors`. All other inputs, node IDs, links, CFG 5, uni_pc/simple sampling, shift 8, and SaveVideo settings remain as exported.

The installed graph now maps node 56 `LoadImage.image` to `$image` and node 55 `start_image` to `["56", 0]`, enabling the required starting-image bridge. No accelerated Fast profile has been inferred. SaveVideo retains auto settings; MP4 output and GPU node compatibility require a real render before being claimed verified.

The one-command setup automatically copies the graph beside the private env file into `joshbox-workflows/wan22-5b-quality.json` and fills a missing or empty `WORKFLOW_WAN5_QUALITY_PATH`. Existing custom paths and Fast settings are preserved. Reruns refresh only the bundled installed copy. No secrets are included in the workflow.
