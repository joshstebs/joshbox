#!/usr/bin/env bash
# Copy to /root/onstart.sh on a compatible Vast SSH template, or use as its custom command.
# Supply secrets through protected container environment settings, never in this file.
set -Eeuo pipefail
umask 077
JOSHBOX_DIR="${JOSHBOX_DIR:-/workspace/joshbox}"
JOSHBOX_REF="${JOSHBOX_REF:-main}"
LOG_DIR="${LOG_DIR:-/workspace/logs}"
mkdir -p "$LOG_DIR"
if [[ ! -f "$JOSHBOX_DIR/scripts/setup-vast.sh" ]]; then
  [[ ! -e "$JOSHBOX_DIR" ]] || { printf 'Existing JOSHBOX_DIR preserved; missing setup script.\n' >&2; exit 1; }
  git clone --branch "$JOSHBOX_REF" --single-branch https://github.com/joshstebs/joshbox.git "$JOSHBOX_DIR"
fi
# Remain in the foreground so the container/custom-command supervisor owns shutdown.
exec bash "$JOSHBOX_DIR/scripts/setup-vast.sh" >> "$LOG_DIR/setup.log" 2>&1
