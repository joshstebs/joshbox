#!/usr/bin/env bash
# Idempotent Vast bootstrap for an existing ComfyUI installation.
set -Eeuo pipefail
umask 077

ROOT="${JOSHBOX_ROOT:-/workspace/joshbox}"
COMFY_DIR="${COMFY_DIR:-/workspace/ComfyUI}"
APP_DIR="${APP_DIR:-$ROOT/vast}"
ENV_FILE="${JOSHBOX_ENV_FILE:-/workspace/joshbox.env}"
APP_PYTHON="${APP_PYTHON:-$ROOT/.venv/bin/python}"
PUBLIC_URL="${VIDEO_PROXY_URL:-${PUBLIC_URL:-}}"
VIDEO_PROXY_TOKEN="${VIDEO_PROXY_TOKEN-}"
LOG_DIR="${LOG_DIR:-/workspace/logs}"
CLOUDFLARED_BIN="${CLOUDFLARED_BIN:-cloudflared}"
CLOUDFLARED_TUNNEL_TOKEN="${CLOUDFLARED_TUNNEL_TOKEN:-${TUNNEL_TOKEN:-}}"

note(){ printf '[joshbox-bootstrap] %s\n' "$*"; }
die(){ note "ERROR: $*"; exit 1; }
[[ -f "$ROOT/vast/start_vast.sh" ]] || die "JoshBox checkout not found at $ROOT."
command -v curl >/dev/null || die 'curl is required for local and tunnel health checks.'
command -v flock >/dev/null || die 'flock is required to prevent overlapping bootstrap runs.'
mkdir -p "$(dirname "$ENV_FILE")"
exec 9>"${ENV_FILE}.bootstrap.lock"
flock -n 9 || die 'Another JoshBox bootstrap is already running.'

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  command -v openssl >/dev/null || die 'openssl is required to create the private runtime file.'
  mkdir -p "$(dirname "$ENV_FILE")"
  token="$(openssl rand -hex 32)"
  cat > "$ENV_FILE" <<EOF
VIDEO_PROXY_TOKEN=$token
VIDEO_PROXY_URL=${VIDEO_PROXY_URL:-}
COMFY_DIR=$COMFY_DIR
APP_DIR=$APP_DIR
COMFY_PYTHON=python3
APP_PYTHON=$APP_PYTHON
JOSHBOX_DATA_DIR=/workspace/joshbox-data
WORKFLOW_WAN5_QUALITY_PATH=
WORKFLOW_WAN5_FAST_PATH=
EOF
  chmod 600 "$ENV_FILE"
  note 'Created the private runtime file with a new local proxy token.'
  set -a
  source "$ENV_FILE"
  set +a
fi
PUBLIC_URL="${VIDEO_PROXY_URL:-${PUBLIC_URL:-}}"
CLOUDFLARED_TUNNEL_TOKEN="${CLOUDFLARED_TUNNEL_TOKEN:-${TUNNEL_TOKEN:-}}"
[[ "${HEALTH_TIMEOUT:-180}" =~ ^[1-9][0-9]*$ ]] || die 'HEALTH_TIMEOUT must be a positive integer.'
[[ -d "$COMFY_DIR" ]] || die "ComfyUI not found at $COMFY_DIR."

mkdir -p "$LOG_DIR"
chmod 700 "$LOG_DIR"

validate_configured_workflows() {
  local key value
  while IFS= read -r key; do
    value="${!key:-}"
    [[ -z "$value" || -f "$value" ]] || die "$key points to a missing workflow: $value"
  done < <(compgen -A variable | awk '/^WORKFLOW_.*_PATH$/')
}

start_tunnel() {
  pgrep -f '[c]loudflared.*tunnel' >/dev/null 2>&1 && { note 'Reusing an existing Cloudflare tunnel process.'; return; }
  [[ -n "$CLOUDFLARED_TUNNEL_TOKEN" ]] || { note 'No tunnel token supplied; assuming the existing protected tunnel is managed externally.'; return; }
  command -v "$CLOUDFLARED_BIN" >/dev/null || die "cloudflared was not found; install it or set CLOUDFLARED_BIN."
  touch "$LOG_DIR/cloudflared.log"
  chmod 600 "$LOG_DIR/cloudflared.log"
  TUNNEL_TOKEN="$CLOUDFLARED_TUNNEL_TOKEN" nohup "$CLOUDFLARED_BIN" tunnel --no-autoupdate run >>"$LOG_DIR/cloudflared.log" 2>&1 < /dev/null 9>&- &
  printf '%s\n' "$!" > "$LOG_DIR/cloudflared.pid"
  chmod 600 "$LOG_DIR/cloudflared.pid"
  note 'Started the Cloudflare tunnel using the existing protected token.'
}

if [[ ! -x "$APP_PYTHON" ]]; then
  note 'Creating the wrapper virtual environment.'
  python3 -m venv "$ROOT/.venv"
fi
"$APP_PYTHON" -m pip install --disable-pip-version-check -q -r "$ROOT/vast/requirements.lock"

note 'Installing selected video models, node dependencies, and workflows.'
export COMFY_DIR
"$APP_PYTHON" "$ROOT/vast/model_setup.py" --env-file "$ENV_FILE" --sync
set -a
source "$ENV_FILE"
set +a
PUBLIC_URL="${VIDEO_PROXY_URL:-${PUBLIC_URL:-}}"
validate_configured_workflows

note 'Starting or reusing ComfyUI and the authenticated JoshBox wrapper.'
if ! curl --fail --silent --max-time 2 http://127.0.0.1:8080/healthz >/dev/null 2>&1; then
  touch "$LOG_DIR/start_vast.log"
  chmod 600 "$LOG_DIR/start_vast.log"
  nohup bash "$ROOT/vast/start_vast.sh" >>"$LOG_DIR/start_vast.log" 2>&1 < /dev/null 9>&- &
  printf '%s\n' "$!" > "$LOG_DIR/start_vast.pid"
  chmod 600 "$LOG_DIR/start_vast.pid"
fi
deadline=$((SECONDS + ${HEALTH_TIMEOUT:-180}))
until curl --fail --silent --max-time 3 http://127.0.0.1:8080/healthz >/dev/null; do
  (( SECONDS < deadline )) || die 'JoshBox wrapper health check timed out. See /workspace/logs/start_vast.log.'
  sleep 2
done

start_tunnel

if [[ -z "$PUBLIC_URL" ]]; then
  die 'Local wrapper is healthy. Set VIDEO_PROXY_URL to the existing protected tunnel URL and rerun to verify readiness.'
fi

command -v curl >/dev/null || die 'curl is required for tunnel verification.'
deadline=$((SECONDS + ${HEALTH_TIMEOUT:-180}))
until curl --fail --silent --show-error --max-time 5 "$PUBLIC_URL/healthz" >/dev/null; do
  (( SECONDS < deadline )) || die "Tunnel health check timed out: $PUBLIC_URL/healthz"
  sleep 2
done

[[ ${#VIDEO_PROXY_TOKEN} -ge 32 ]] || die 'VIDEO_PROXY_TOKEN must be set to verify /api/capabilities.'
export VIDEO_PROXY_TOKEN
until "$APP_PYTHON" "$ROOT/vast/verify_capabilities.py" "$PUBLIC_URL"; do
  (( SECONDS < deadline )) || die "Capability check timed out or was not connected: $PUBLIC_URL/api/capabilities"
  sleep 2
done

note "Verified $PUBLIC_URL/healthz and authenticated /api/capabilities."
printf 'JoshBox Ready\n'
