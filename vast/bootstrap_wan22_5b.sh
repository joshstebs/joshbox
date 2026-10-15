#!/usr/bin/env bash
set -Eeuo pipefail

COMFY_DIR="${COMFY_DIR:-/workspace/ComfyUI}"
MODEL_ROOT="$COMFY_DIR/models"
WAN_REPO="https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files"

note(){ printf '[joshbox] %s\n' "$*"; }
die(){ note "ERROR: $*"; exit 1; }

command -v curl >/dev/null || die "curl is required."
[[ -d "$COMFY_DIR" ]] || die "ComfyUI not found at $COMFY_DIR"

mkdir -p   "$MODEL_ROOT/diffusion_models"   "$MODEL_ROOT/text_encoders"   "$MODEL_ROOT/vae"

download() {
  local url="$1"
  local out="$2"
  local min_bytes="$3"

  if [[ -f "$out" ]]; then
    local size
    size="$(stat -c %s "$out" 2>/dev/null || echo 0)"
    if (( size >= min_bytes )); then
      note "Already present: $(basename "$out")"
      return 0
    fi
    note "Removing incomplete file: $(basename "$out")"
    rm -f "$out"
  fi

  note "Downloading $(basename "$out")..."
  curl -L --fail --show-error --retry 8 --retry-delay 3 --continue-at -     -o "$out" "$url"

  local size
  size="$(stat -c %s "$out" 2>/dev/null || echo 0)"
  (( size >= min_bytes )) || die "Download looks incomplete: $out"
}

free_kb="$(df -Pk /workspace | awk 'NR==2 {print $4}')"
(( free_kb >= 25000000 )) || die "At least ~25 GB free under /workspace is recommended."

download   "$WAN_REPO/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors"   "$MODEL_ROOT/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors"   9000000000

download   "$WAN_REPO/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors"   "$MODEL_ROOT/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors"   6000000000

download   "$WAN_REPO/vae/wan2.2_vae.safetensors"   "$MODEL_ROOT/vae/wan2.2_vae.safetensors"   1200000000

note "Wan 2.2 5B files are ready."
ls -lh   "$MODEL_ROOT/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors"   "$MODEL_ROOT/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors"   "$MODEL_ROOT/vae/wan2.2_vae.safetensors"

note "Next: refresh/restart ComfyUI and load a verified Wan 2.2 5B workflow."
