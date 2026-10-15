#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT="${JOSHBOX_ROOT:-/workspace/joshbox}"
VENV="$ROOT/.venv"
ENV_FILE="${JOSHBOX_ENV_FILE:-/workspace/joshbox.env}"
COMFY_DIR="${COMFY_DIR:-/workspace/ComfyUI}"

note(){ printf '[joshbox] %s\n' "$*"; }
die(){ note "ERROR: $*"; exit 1; }

[[ -d "$ROOT/.git" ]] || die "JoshBox repo not found at $ROOT"
[[ -d "$COMFY_DIR" ]] || die "ComfyUI not found at $COMFY_DIR"
command -v python3 >/dev/null || die "python3 is required"
command -v openssl >/dev/null || die "openssl is required"

note "Checking GPU..."
command -v nvidia-smi >/dev/null || die "nvidia-smi is required"
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader

if [[ ! -x "$VENV/bin/python" ]]; then
  note "Creating Python environment..."
  python3 -m venv "$VENV"
fi

note "Installing JoshBox wrapper requirements..."
"$VENV/bin/python" -m pip install -q -r "$ROOT/vast/requirements.lock"

note "Installing Wan 2.2 5B model files..."
bash "$ROOT/vast/bootstrap_wan22_5b.sh"

if [[ ! -f "$ENV_FILE" ]]; then
  token="$(openssl rand -hex 32)"
  cat > "$ENV_FILE" <<EOF
VIDEO_PROXY_TOKEN=$token
COMFY_DIR=$COMFY_DIR
APP_DIR=$ROOT/vast
COMFY_PYTHON=python3
APP_PYTHON=$VENV/bin/python
JOSHBOX_DATA_DIR=/workspace/joshbox-data
WORKFLOW_MINIMAX_QUALITY_PATH=
WORKFLOW_MINIMAX_FAST_PATH=
WORKFLOW_WAN14_QUALITY_PATH=
WORKFLOW_WAN14_FAST_PATH=
WORKFLOW_WAN5_QUALITY_PATH=
WORKFLOW_WAN5_FAST_PATH=
WORKFLOW_LTX23_QUALITY_PATH=
WORKFLOW_LTX23_FAST_PATH=
WORKFLOW_HUNYUAN15_QUALITY_PATH=
WORKFLOW_HUNYUAN15_FAST_PATH=
EOF
  chmod 600 "$ENV_FILE"
  note "Created private runtime file: $ENV_FILE"
else
  note "Keeping existing runtime file: $ENV_FILE"
fi

note "Setup complete."
note "Wan 2.2 model files: ready"
note "JoshBox wrapper: ready"
note "Workflow JSON: still required before generation"
note "Next command after adding a verified workflow path:"
printf '  set -a; source %q; set +a; bash %q\n' "$ENV_FILE" "$ROOT/vast/start_vast.sh"
