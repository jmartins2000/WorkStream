#!/bin/bash
#
# WorkStream installer (macOS). Distribution option C: clone the repo into a
# managed directory, build a real WorkStream.app, and place it in
# /Applications. Because the app is BUILT on this machine (not downloaded as a
# finished binary) macOS doesn't quarantine it — so it opens with no
# "unidentified developer" prompt despite being unsigned.
#
# One-line install:
#   curl -fsSL https://raw.githubusercontent.com/jmartins2000/WorkStream/main/scripts/install.sh | bash
#
set -euo pipefail

REPO_URL="https://github.com/jmartins2000/WorkStream.git"
CLONE_DIR="$HOME/.workstream"
APP_DEST="/Applications/WorkStream.app"

say()  { printf '\033[1;36m▸ %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$1"; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

# --- Prerequisites --------------------------------------------------------
[ "$(uname)" = "Darwin" ] || die "WorkStream is macOS-only."
command -v git >/dev/null 2>&1 || die "git is required (install Xcode Command Line Tools: xcode-select --install)."
command -v node >/dev/null 2>&1 || die "Node.js 22+ is required (https://nodejs.org)."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || die "Node.js 22+ required; found $(node -v)."

# xcodebuild/clang are needed to compile native modules (sharp, etc.).
xcode-select -p >/dev/null 2>&1 || die "Xcode Command Line Tools required: run 'xcode-select --install' then retry."

# --- Clone or update ------------------------------------------------------
if [ -d "$CLONE_DIR/.git" ]; then
  say "Existing install found at $CLONE_DIR — updating it."
  git -C "$CLONE_DIR" fetch origin main
  # Unshallow a previously shallow clone so the build number (commit count) is right.
  git -C "$CLONE_DIR" rev-parse --is-shallow-repository 2>/dev/null | grep -q true \
    && git -C "$CLONE_DIR" fetch --unshallow origin 2>/dev/null
  git -C "$CLONE_DIR" reset --hard origin/main
else
  say "Cloning WorkStream into $CLONE_DIR"
  rm -rf "$CLONE_DIR"
  # Full clone (not shallow) so the build number = commit count works.
  git clone "$REPO_URL" "$CLONE_DIR"
fi

cd "$CLONE_DIR"

# --- Build ----------------------------------------------------------------
say "Installing dependencies (this also fetches the Stremio engine, ~150MB the first time)…"
npm install

say "Building WorkStream.app (a few minutes)…"
npm run package:local

# electron-builder --dir output lives under release/mac* depending on arch.
BUILT_APP="$(find release -maxdepth 2 -name 'WorkStream.app' -type d | head -1)"
[ -n "$BUILT_APP" ] || die "Build finished but WorkStream.app was not found under release/."

say "Installing to $APP_DEST"
rm -rf "$APP_DEST"
cp -R "$BUILT_APP" "$APP_DEST"

printf '\033[1;32m\n✓ WorkStream installed.\033[0m Open it from your Applications folder or Spotlight.\n'
