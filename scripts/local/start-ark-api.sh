#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
API_DIR="$ROOT/services/ark-api/ark-api"
DEFAULT_KUBECONFIG="$ROOT/out/local-kubeconfig"

if [[ -z "${KUBECONFIG:-}" ]]; then
  KUBECONFIG="$DEFAULT_KUBECONFIG"
fi

if [[ "${KUBECONFIG}" != /* ]]; then
  KUBECONFIG="$ROOT/$KUBECONFIG"
fi

if [[ ! -f "${KUBECONFIG}" && -f "${DEFAULT_KUBECONFIG}" ]]; then
  KUBECONFIG="$DEFAULT_KUBECONFIG"
fi

if [[ ! -f "${KUBECONFIG}" ]]; then
  echo "Kubeconfig not found at ${KUBECONFIG}"
  exit 1
fi

export KUBECONFIG

SDK_ARTIFACT="$(ls "$ROOT"/out/ark-sdk/py-sdk/dist/ark_sdk-*.whl 2>/dev/null | head -n1 || true)"
if [[ -z "$SDK_ARTIFACT" ]]; then
  SDK_ARTIFACT="$(ls "$ROOT"/out/ark-sdk/py-sdk/dist/ark_sdk-*.tar.gz 2>/dev/null | head -n1 || true)"
fi

if [[ -z "$SDK_ARTIFACT" ]]; then
  echo "Missing ark-sdk artifact under out/ark-sdk/py-sdk/dist"
  exit 1
fi

cd "$API_DIR"

SDK_VERSION="$(python - "$SDK_ARTIFACT" <<'PY'
import os
import re
import sys

name = os.path.basename(sys.argv[1])
match = re.match(r"^ark_sdk-([^-]+)(?:-.*)?\.whl$", name)
if match is None:
    match = re.match(r"^ark_sdk-([^-]+)\.tar\.gz$", name)
print(match.group(1) if match else "")
PY
)"

INSTALLED_VERSION="$(uv pip show ark-sdk 2>/dev/null | awk '/^Version: / {print $2}' || true)"
if [[ -z "$INSTALLED_VERSION" || -z "$SDK_VERSION" || "$INSTALLED_VERSION" != "$SDK_VERSION" ]]; then
  uv pip install "$SDK_ARTIFACT" --reinstall-package ark-sdk
fi

PYTHONPATH="$ROOT/lib/ark-sdk/gen_sdk/overlay/python:${PYTHONPATH:-}" \
CORS_ORIGINS="${CORS_ORIGINS:-http://localhost:3000}" \
uv run --no-sync python -m uvicorn --host 0.0.0.0 --port "${ARK_API_PORT:-8000}" --reload src.ark_api.main:app
