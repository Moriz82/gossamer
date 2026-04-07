#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

mkdir -p data uploads exports
export GOSSAMER_DATABASE_PATH="$REPO_ROOT/data/graph.sqlite"
export GOSSAMER_UPLOADS_DIR="$REPO_ROOT/uploads"
export GOSSAMER_EXPORTS_DIR="$REPO_ROOT/exports"

if [[ ! -d backend/.venv ]]; then
  python3 -m venv backend/.venv
fi
# shellcheck source=/dev/null
source backend/.venv/bin/activate
pip install -e "backend[dev]"

(cd "$REPO_ROOT/backend" && python -m uvicorn gossamer.app:app --reload --host 127.0.0.1 --port 8000) &
UVICORN_PID=$!

cleanup() {
  kill "$UVICORN_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Waiting for API on http://127.0.0.1:8000 ..."
for _ in $(seq 1 80); do
  if curl -sf -u gossamer:gossamer "http://127.0.0.1:8000/api/health" >/dev/null; then
    echo "API is ready."
    break
  fi
  if ! kill -0 "$UVICORN_PID" 2>/dev/null; then
    echo "ERROR: uvicorn exited before becoming healthy. Check backend logs above." >&2
    exit 1
  fi
  sleep 0.25
done

cd "$REPO_ROOT/frontend"
if [[ ! -d node_modules ]]; then
  npm install
fi
npm run dev
