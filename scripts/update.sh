#!/bin/bash
#
# WorkStream self-updater (macOS). Spawned DETACHED by the app (see
# src/main/update/runner.ts), which then quits so this can rebuild and swap
# the .app safely. Pulls the latest code, rebuilds, and — only on success —
# replaces /Applications/WorkStream.app, keeping the previous build as a
# rollback. Relaunches WorkStream when done.
#
# Runs from the managed clone ($HOME/.workstream); logs to update.log there.
#
set -uo pipefail

CLONE_DIR="$HOME/.workstream"
APP_DEST="/Applications/WorkStream.app"
BACKUP="/Applications/WorkStream.app.prev"

log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$1"; }

relaunch() { open -a "$APP_DEST" >/dev/null 2>&1 || open "$APP_DEST" >/dev/null 2>&1 || true; }

fail_rollback() {
  log "UPDATE FAILED: $1"
  # Restore the previous app if we'd already moved it aside.
  if [ ! -d "$APP_DEST" ] && [ -d "$BACKUP" ]; then
    mv "$BACKUP" "$APP_DEST"
    log "rolled back to previous build"
  fi
  relaunch
  exit 1
}

cd "$CLONE_DIR" 2>/dev/null || { log "no clone at $CLONE_DIR — cannot self-update"; exit 1; }

# The app spawns us with a minimal GUI PATH (/usr/bin:/bin:…) that lacks
# node/npm — that's the "npm: command not found" self-update failure. Restore
# a usable PATH: common install dirs, then version managers, then the user's
# shell profile as a last resort.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.volta/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
command -v fnm >/dev/null 2>&1 && eval "$(fnm env 2>/dev/null)"
if ! command -v npm >/dev/null 2>&1; then
  for rc in "$HOME/.zshrc" "$HOME/.zprofile" "$HOME/.bash_profile" "$HOME/.profile"; do
    [ -f "$rc" ] && . "$rc" >/dev/null 2>&1
  done
fi
command -v npm >/dev/null 2>&1 || fail_rollback "node/npm not found — update needs Node.js on PATH"

# Give the quitting app a moment to fully exit and release the .app.
sleep 1

log "fetching latest…"
git fetch origin main || fail_rollback "git fetch failed"
# Full history (not shallow) so the build number = commit count is accurate.
git rev-parse --is-shallow-repository 2>/dev/null | grep -q true && git fetch --unshallow origin 2>/dev/null
# Managed clone is app-owned — hard reset guarantees a clean, conflict-free update.
git reset --hard origin/main || fail_rollback "git reset failed"

log "installing dependencies…"
npm install || fail_rollback "npm install failed"

log "building app…"
npm run package:local || fail_rollback "build failed"

BUILT_APP="$(find release -maxdepth 2 -name 'WorkStream.app' -type d | head -1)"
[ -n "$BUILT_APP" ] || fail_rollback "WorkStream.app not found after build"

log "swapping in the new build…"
rm -rf "$BACKUP"
[ -d "$APP_DEST" ] && mv "$APP_DEST" "$BACKUP"
if cp -R "$BUILT_APP" "$APP_DEST"; then
  rm -rf "$BACKUP"
  log "update complete"
else
  fail_rollback "could not copy the new build into place"
fi

relaunch
log "relaunched"
