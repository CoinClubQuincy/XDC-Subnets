#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(pwd)"   # default: current dir
PORT=3000
CMD="dev"

# ---------- args ----------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --root) ROOT_DIR="$2"; shift 2;;
    --port) PORT="$2"; shift 2;;
    dev|prod) CMD="$1"; shift;;
    *) echo "Usage: $0 [--root DIR] [--port PORT] dev|prod"; exit 1;;
  esac
done

REPO_DIR="$ROOT_DIR/uniswap-interface"

log() { printf "\n\033[1;36m==> %s\033[0m\n" "$*"; }

# ---------- sanity checks ----------
need_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing '$1'. Install it and re-run."; exit 1; }
}
need_cmd git
need_cmd node
need_cmd npm

# Check at least ~4GB free (interfaces can be big)
if command -v df >/dev/null 2>&1; then
  FREE_KB=$(df -k . | awk 'NR==2{print $4}')
  if [[ "${FREE_KB:-0}" -lt 4000000 ]]; then
    echo "Error: Low disk space (<4GB free). Free up space and try again."
    exit 1
  fi
fi

# ---------- yarn 4 via corepack ----------
log "Enabling Corepack + Yarn 4.3.1"
(corepack enable >/dev/null 2>&1 || true)
corepack prepare yarn@4.3.1 --activate || {
  echo "Corepack failed; trying npm fallback..."
  npm i -g corepack >/dev/null 2>&1 || true
  corepack prepare yarn@4.3.1 --activate
}

# Make Yarn ignore any global Yarn versions
export YARN_IGNORE_PATH=1

# ---------- clone / update ----------
mkdir -p "$ROOT_DIR"
if [[ ! -d "$REPO_DIR/.git" ]]; then
  log "Cloning Uniswap Interface into: $REPO_DIR"
  git clone https://github.com/Uniswap/interface "$REPO_DIR"
else
  log "Repo exists; pulling latest"
  (cd "$REPO_DIR" && git pull --rebase)
fi

cd "$REPO_DIR"

# ---------- install ----------
log "Installing dependencies (this can take a while)"
# Yarn 4 sometimes complains about legacy git protocol settings. Ensure clean local config.
if [[ -f ".yarnrc.yml" ]]; then
  # Remove legacy gitProtocol if present
  if grep -q '^gitProtocol:' .yarnrc.yml 2>/dev/null; then
    cp .yarnrc.yml .yarnrc.yml.bak
    grep -v '^gitProtocol:' .yarnrc.yml.bak > .yarnrc.yml || true
  fi
fi

# Retry once on transient failures
if ! yarn install; then
  log "Retrying install once…"
  yarn install
fi

# ---------- run ----------
if [[ "$CMD" == "dev" ]]; then
  log "Starting dev server on http://localhost:$PORT"
  cd apps/web
  # yarn dev supports -p PORT in this repo
  yarn dev -p "$PORT"
elif [[ "$CMD" == "prod" ]]; then
  log "Building production"
  (cd apps/web && yarn build)
  log "Starting prod server on http://localhost:$PORT"
  (cd apps/web && yarn start -p "$PORT")
else
  echo "Usage: $0 [--root DIR] [--port PORT] dev|prod"
  exit 1
fi