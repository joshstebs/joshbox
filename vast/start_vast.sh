#!/usr/bin/env bash
# Run with Bash on Ubuntu. No installs, model downloads, rental, or billing actions.
set -Eeuo pipefail
umask 077

COMFY_DIR="${COMFY_DIR:-/workspace/ComfyUI}"
APP_DIR="${APP_DIR:-/workspace/joshbox/vast}"
LOG_DIR="${LOG_DIR:-/workspace/logs}"
COMFY_PYTHON="${COMFY_PYTHON:-python3}"
APP_PYTHON="${APP_PYTHON:-python3}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"
SHUTDOWN_TIMEOUT="${SHUTDOWN_TIMEOUT:-25}"
export COMFY_URL="http://127.0.0.1:8188"
export PYTHONUNBUFFERED=1
export VIDEO_PROXY_TOKEN="${VIDEO_PROXY_TOKEN:-}"
export CUDA_DEVICE_ORDER="${CUDA_DEVICE_ORDER:-PCI_BUS_ID}"
export CUDA_VISIBLE_DEVICES="${CUDA_VISIBLE_DEVICES:-0}"
export CUDA_HOME="${CUDA_HOME:-/usr/local/cuda}"
if [[ -d "$CUDA_HOME/bin" ]]; then export PATH="$CUDA_HOME/bin:$PATH"; fi
if [[ -d "$CUDA_HOME/lib64" ]]; then export LD_LIBRARY_PATH="$CUDA_HOME/lib64${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"; fi

note(){ printf '[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*" >&2; }
die(){ note "$*"; exit 1; }
for utility in nvidia-smi curl setsid awk "$COMFY_PYTHON" "$APP_PYTHON"; do command -v "$utility" >/dev/null || die "Missing required executable: $utility"; done
[[ "$HEALTH_TIMEOUT" =~ ^[1-9][0-9]*$ && "$SHUTDOWN_TIMEOUT" =~ ^[1-9][0-9]*$ ]] || die 'Timeouts must be positive integers.'
[[ -f "$COMFY_DIR/main.py" ]] || die 'ComfyUI main.py was not found. Set COMFY_DIR to the existing installation.'
[[ -f "$APP_DIR/app.py" ]] || die 'JoshBox app.py was not found. Set APP_DIR to the wrapper directory.'
[[ ${#VIDEO_PROXY_TOKEN} -ge 32 ]] || die 'Set VIDEO_PROXY_TOKEN to a private random token of at least 32 characters.'
nvidia-smi >/dev/null 2>&1 || die 'No usable NVIDIA GPU was detected.'
"$COMFY_PYTHON" -c 'import torch; assert torch.cuda.is_available(), "CUDA is unavailable in the existing ComfyUI Python environment"' || die 'ComfyUI Python cannot use CUDA. Check its existing environment and CUDA visibility.'
"$APP_PYTHON" -c 'import fastapi, uvicorn, httpx, websockets, multipart' || die 'Install the wrapper requirements before starting.'
# Refuse to attach to an unrelated process already occupying either port.
for port in 8188 8080; do
  if "$APP_PYTHON" - "$port" <<'PY'
import socket, sys
try:
    with socket.create_connection(('127.0.0.1', int(sys.argv[1])), timeout=1): pass
except OSError: sys.exit(1)
PY
  then die "Port $port is already in use. Stop this entrypoint and inspect the existing service."; fi
done

mkdir -p "$LOG_DIR"
touch "$LOG_DIR/comfyui.log" "$LOG_DIR/app.log"
chmod 600 "$LOG_DIR/comfyui.log" "$LOG_DIR/app.log"
pipe_dir="$(mktemp -d "$LOG_DIR/.joshbox-pipes.XXXXXX")"
mkfifo "$pipe_dir/comfy" "$pipe_dir/app"
comfy_pid=''; app_pid=''; log_pids=(); cleaned=0
cleanup(){
  (( cleaned == 0 )) || return 0
  cleaned=1
  trap '' TERM INT
  note 'Stopping JoshBox and ComfyUI…'
  for pid in "$app_pid" "$comfy_pid"; do [[ -n "$pid" ]] && kill -TERM -- "-$pid" 2>/dev/null || true; done
  deadline=$((SECONDS + SHUTDOWN_TIMEOUT))
  while ((SECONDS < deadline)); do
    alive=0
    for pid in "$app_pid" "$comfy_pid"; do [[ -n "$pid" ]] && kill -0 -- "-$pid" 2>/dev/null && alive=1 || true; done
    ((alive == 0)) && break
    sleep 1
  done
  for pid in "$app_pid" "$comfy_pid"; do [[ -n "$pid" ]] && kill -KILL -- "-$pid" 2>/dev/null || true; done
  for pid in "$app_pid" "$comfy_pid"; do [[ -n "$pid" ]] && wait "$pid" 2>/dev/null || true; done
  for pid in "${log_pids[@]}"; do kill -TERM "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; done
  rm -f -- "$pipe_dir/comfy" "$pipe_dir/app"
  rmdir -- "$pipe_dir" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

stamp(){ TZ=UTC awk '{ print "[" strftime("%Y-%m-%dT%H:%M:%SZ") "] " $0; fflush(); }'; }
stamp < "$pipe_dir/comfy" >> "$LOG_DIR/comfyui.log" & log_pids+=("$!")
stamp < "$pipe_dir/app" >> "$LOG_DIR/app.log" & log_pids+=("$!")
note 'Starting existing ComfyUI on localhost:8188…'
(cd "$COMFY_DIR"; exec setsid "$COMFY_PYTHON" -u main.py --listen 127.0.0.1 --port 8188 --disable-auto-launch) > "$pipe_dir/comfy" 2>&1 & comfy_pid=$!
deadline=$((SECONDS + HEALTH_TIMEOUT))
until curl --fail --silent --max-time 3 "$COMFY_URL/system_stats" >/dev/null; do
  kill -0 "$comfy_pid" 2>/dev/null || die "ComfyUI exited. See $LOG_DIR/comfyui.log."
  ((SECONDS < deadline)) || die "ComfyUI health check timed out. See $LOG_DIR/comfyui.log."
  sleep 2
done
kill -0 "$comfy_pid" 2>/dev/null || die 'The ComfyUI process exited during startup.'
note 'ComfyUI is healthy. Starting the authenticated wrapper on port 8080…'
(cd "$APP_DIR"; exec setsid "$APP_PYTHON" -u -m uvicorn app:app --host 0.0.0.0 --port 8080 --workers 1 --no-access-log --timeout-graceful-shutdown "$SHUTDOWN_TIMEOUT") > "$pipe_dir/app" 2>&1 & app_pid=$!
deadline=$((SECONDS + HEALTH_TIMEOUT))
until curl --fail --silent --max-time 3 http://127.0.0.1:8080/healthz >/dev/null; do
  kill -0 "$app_pid" 2>/dev/null || die "Wrapper exited. See $LOG_DIR/app.log."
  kill -0 "$comfy_pid" 2>/dev/null || die "ComfyUI exited. See $LOG_DIR/comfyui.log."
  ((SECONDS < deadline)) || die "Wrapper health check timed out. See $LOG_DIR/app.log."
  sleep 2
done
note "Ready. ComfyUI is local-only; expose port 8080 through your protected Vast proxy or SSH tunnel. Logs: $LOG_DIR"
set +e
wait -n "$comfy_pid" "$app_pid" "${log_pids[@]}"
status=$?
set -e
note "A service exited (status $status); stopping the remaining processes."
((status != 0)) || status=1
exit "$status"
