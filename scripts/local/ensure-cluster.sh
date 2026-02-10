#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT_DIR="$ROOT/out"
KUBECONFIG_PATH="$OUT_DIR/local-kubeconfig"
OS_NAME="$(uname)"
PROVIDER="${ARK_K8S_PROVIDER:-auto}"

mkdir -p "$OUT_DIR"

bootstrap_kubectl() {
  if [[ -n "${ARK_BOOTSTRAP_KUBECONFIG:-}" ]]; then
    kubectl --kubeconfig "${ARK_BOOTSTRAP_KUBECONFIG}" "$@"
    return
  fi
  env -u KUBECONFIG kubectl "$@"
}

orbstack_installed() {
  command -v orb >/dev/null 2>&1 || command -v orbctl >/dev/null 2>&1
}

orbstack_running() {
  if command -v orbctl >/dev/null 2>&1; then
    orbctl status >/dev/null 2>&1
    return $?
  fi
  return 1
}

use_orbstack() {
  if bootstrap_kubectl config get-contexts -o name 2>/dev/null | grep -qx orbstack; then
    if bootstrap_kubectl --context orbstack cluster-info >/dev/null 2>&1; then
      bootstrap_kubectl config view --minify --flatten --context orbstack > "$KUBECONFIG_PATH"
      return 0
    fi
  fi
  return 1
}

use_existing_context() {
  if bootstrap_kubectl config current-context >/dev/null 2>&1; then
    bootstrap_kubectl config view --minify --flatten > "$KUBECONFIG_PATH"
    if kubectl --kubeconfig "$KUBECONFIG_PATH" cluster-info >/dev/null 2>&1; then
      return 0
    fi
  fi
  return 1
}

use_kind() {
  if ! command -v kind >/dev/null 2>&1; then
    return 1
  fi
  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker is required for kind"
    exit 1
  fi
  if kind get clusters | grep -qx ark-local; then
    kind get kubeconfig --name ark-local > "$KUBECONFIG_PATH"
  else
    kind create cluster --name ark-local --kubeconfig "$KUBECONFIG_PATH"
  fi
  kubectl --kubeconfig "$KUBECONFIG_PATH" cluster-info >/dev/null 2>&1
  return 0
}

if [[ "$PROVIDER" == "orbstack" ]]; then
  if use_orbstack; then
    exit 0
  fi
  if orbstack_installed && ! orbstack_running; then
    echo "OrbStack is installed but not running"
    echo "Start it with: orbctl start (or open the OrbStack app)"
  fi
  echo "OrbStack context not available"
  echo "Install OrbStack (brew install orbstack), open the app, and enable Kubernetes"
  echo "Or set local.k8sProvider to kind/existing"
  exit 1
fi

if [[ "$PROVIDER" == "existing" ]]; then
  if use_existing_context; then
    exit 0
  fi
  echo "No reachable existing Kubernetes context detected"
  exit 1
fi

if [[ "$PROVIDER" == "kind" ]]; then
  if use_kind; then
    exit 0
  fi
  echo "kind is not available"
  exit 1
fi

if [[ "$OS_NAME" == "Darwin" ]]; then
  if use_orbstack; then
    exit 0
  fi
  if orbstack_installed && ! orbstack_running; then
    echo "OrbStack is installed but not running"
    echo "Start it with: orbctl start (or open the OrbStack app)"
  fi
  if use_existing_context; then
    echo "OrbStack not detected, using current Kubernetes context"
    exit 0
  fi
  if use_kind; then
    exit 0
  fi
else
  if use_existing_context; then
    exit 0
  fi
  if use_kind; then
    exit 0
  fi
fi

echo "No Kubernetes cluster detected"
echo "If using OrbStack: install/open OrbStack and enable Kubernetes"
echo "If using another cluster: ensure kubectl current-context is reachable"
echo "Fallback: install kind and docker"
exit 1
