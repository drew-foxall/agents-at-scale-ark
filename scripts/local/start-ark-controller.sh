#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
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

cd "$ROOT/ark"
ENABLE_WEBHOOKS="${ENABLE_WEBHOOKS:-false}" \
go run ./cmd/main.go --health-probe-bind-address ":${ARK_CONTROLLER_HEALTH_PORT:-8081}"
