#!/usr/bin/env bash
# Install JoshBox beside a fresh/reused ComfyUI. No GPU rental/account actions.
set -Eeuo pipefail
umask 077
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export JOSHBOX_DIR="${JOSHBOX_DIR:-$project_dir}"
export COMFY_DIR="${COMFY_DIR:-/workspace/ComfyUI}"
export JOSHBOX_DATA_DIR="${JOSHBOX_DATA_DIR:-/workspace/joshbox-data}"
export JOSHBOX_MODEL_DIR="${JOSHBOX_MODEL_DIR:-/workspace/joshbox-models}"
export LOG_DIR="${LOG_DIR:-/workspace/logs}"
export APP_DIR="$JOSHBOX_DIR/vast"
export JOSHBOX_BOOTSTRAP_MODELS=1
export JOSHBOX_MODEL_MANIFEST="$JOSHBOX_DIR/config/models.json"
export JOSHBOX_BOOTSTRAP_PROFILES="${JOSHBOX_BOOTSTRAP_PROFILES:-wan22-fast,wan22-quality}"
export JOSHBOX_BOOT_STATE="$JOSHBOX_DATA_DIR/bootstrap-state.json"
export HF_HUB_DISABLE_TELEMETRY=1
export HF_DEBUG=0
export VIDEO_PROXY_TOKEN="${VIDEO_PROXY_TOKEN:-}"
for utility in python3 git nvidia-smi curl setsid flock; do command -v "$utility" >/dev/null || { printf 'Required utility missing: %s\n' "$utility" >&2; exit 1; }; done
[[ ${#VIDEO_PROXY_TOKEN} -ge 32 ]] || { printf 'Set the protected VIDEO_PROXY_TOKEN before setup.\n' >&2; exit 1; }
nvidia-smi >/dev/null 2>&1 || { printf 'A usable NVIDIA GPU is required.\n' >&2; exit 1; }
mkdir -p "$JOSHBOX_DATA_DIR" "$LOG_DIR"
exec 9>"$JOSHBOX_DATA_DIR/setup.lock"
flock -n 9 || { printf 'JoshBox setup is already running.\n' >&2; exit 1; }
state(){ python3 - "$JOSHBOX_BOOT_STATE" "$1" "$2" <<'PY'
import json,os,sys,time
from pathlib import Path
path=Path(sys.argv[1]);temp=path.with_suffix('.tmp');temp.write_text(json.dumps({'state':sys.argv[2],'message':sys.argv[3],'updated_at':time.time()}));os.chmod(temp,0o600);temp.replace(path)
PY
}
trap 'state Error "Setup failed. See the private setup log."' ERR
state Starting 'Preparing Python environments and ComfyUI.'
if [[ ! -f "$COMFY_DIR/main.py" ]]; then
  [[ ! -e "$COMFY_DIR" ]] || { printf 'COMFY_DIR exists but is not a ComfyUI installation; preserved.\n' >&2; exit 1; }
  comfy_revision="$(python3 -c 'import json,os; print(json.load(open(os.environ["JOSHBOX_MODEL_MANIFEST"]))["comfyui"]["revision"])')"
  [[ "$comfy_revision" =~ ^[a-f0-9]{40}$ ]] || exit 1
  git clone --no-checkout https://github.com/Comfy-Org/ComfyUI.git "$COMFY_DIR"
  git -C "$COMFY_DIR" checkout --detach "$comfy_revision"
  python3 -m venv --system-site-packages "$JOSHBOX_DIR/.comfy-venv"
  export COMFY_PYTHON="$JOSHBOX_DIR/.comfy-venv/bin/python"
  "$COMFY_PYTHON" -m pip install -r "$COMFY_DIR/requirements.txt"
else
  # Keep the installed environment and code; do not pull/reset a working ComfyUI.
  export COMFY_PYTHON="${COMFY_PYTHON:-python3}"
fi
if [[ ! -x "$JOSHBOX_DIR/.venv/bin/python" ]]; then python3 -m venv "$JOSHBOX_DIR/.venv"; fi
export APP_PYTHON="$JOSHBOX_DIR/.venv/bin/python"
"$APP_PYTHON" -m pip install -r "$APP_DIR/bootstrap-requirements.lock"
"$COMFY_PYTHON" -c 'import torch; assert torch.cuda.is_available(), "CUDA is unavailable in ComfyUI Python"'
state Starting 'Wrapper dependencies ready. Starting monitored model setup.'
# The service supervisor starts the proxy before syncing models so health is visible.
exec bash "$APP_DIR/start_vast.sh"
