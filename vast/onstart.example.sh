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

exec bash "$ROOT/vast/bootstrap_all.sh"
