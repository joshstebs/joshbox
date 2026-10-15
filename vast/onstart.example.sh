#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${JOSHBOX_ROOT:-/workspace/joshbox}"

note(){ printf '[joshbox-onstart] %s\n' "$*"; }

if [[ -d "$ROOT/.git" ]]; then
  note "JoshBox already exists; updating code."
  git -C "$ROOT" pull --ff-only || note "Update skipped; using existing checkout."
else
  note "JoshBox is not cloned yet."
  note "For a private repo, clone once with a read-only GitHub token, then this on-start helper can be reused."
  exit 2
fi

bash "$ROOT/vast/setup_mobile.sh"

if [[ -n "${WORKFLOW_WAN5_QUALITY_PATH:-}" || -n "${WORKFLOW_WAN5_FAST_PATH:-}" ]]; then
  note "Wan workflow configured; starting JoshBox."
  set -a
  [[ -f /workspace/joshbox.env ]] && source /workspace/joshbox.env
  set +a
  exec bash "$ROOT/vast/start_vast.sh"
fi

note "Models and wrapper are ready. Add a verified Wan 2.2 API workflow path before generation."
