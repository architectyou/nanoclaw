#!/usr/bin/env bash
# Start the GLM proxy server for NanoClaw.
# Reads ZHIPU_API_KEY, ZHIPU_MODEL, GLM_PROXY_PORT from .env or environment.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
PROXY_DIR="$PROJECT_ROOT/proxy"

# Source .env if present
if [ -f "$PROJECT_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_ROOT/.env"
  set +a
fi

# Validate required env vars
if [ -z "${ZHIPU_API_KEY:-}" ]; then
  echo "Error: ZHIPU_API_KEY is not set. Add it to .env or export it." >&2
  exit 1
fi

# Install dependencies if needed
if [ ! -d "$PROXY_DIR/node_modules" ]; then
  echo "[glm-proxy] Installing dependencies..."
  (cd "$PROXY_DIR" && npm install --silent)
fi

echo "[glm-proxy] Starting proxy (model: ${ZHIPU_MODEL:-glm-5}, port: ${GLM_PROXY_PORT:-4000})..."
cd "$PROXY_DIR" && exec npx tsx src/index.ts
