#!/usr/bin/env bash
set -euo pipefail

missing=0

require_cmd() {
  local name="$1"
  local install="$2"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "Missing $name"
    echo "$install"
    missing=1
  fi
}

require_cmd process-compose "Install: brew install f1bonacc1/tap/process-compose (or: go install github.com/f1bonacc1/process-compose@latest)"
require_cmd kubectl "Install: https://kubernetes.io/docs/tasks/tools/"
require_cmd go "Install: https://go.dev/doc/install"
require_cmd node "Install: https://nodejs.org/en/download"
require_cmd npm "Install: https://nodejs.org/en/download"
require_cmd uv "Install: https://docs.astral.sh/uv/getting-started/installation/"

provider="${ARK_K8S_PROVIDER:-auto}"

if [[ "$(uname)" == "Darwin" ]]; then
  if [[ "$provider" == "orbstack" ]]; then
    if ! command -v orb >/dev/null 2>&1; then
      echo "Missing orb"
      echo "Install: brew install orbstack"
      missing=1
    fi
  elif [[ "$provider" == "kind" ]]; then
    require_cmd kind "Install: https://kind.sigs.k8s.io/docs/user/quick-start/"
    require_cmd docker "Install: https://docs.docker.com/desktop/"
  elif [[ "$provider" == "existing" ]]; then
    if ! kubectl config current-context >/dev/null 2>&1; then
      echo "No current Kubernetes context detected"
      missing=1
    fi
  else
    if command -v orb >/dev/null 2>&1; then
      :
    elif kubectl config get-contexts -o name 2>/dev/null | grep -qx orbstack; then
      :
    elif kubectl config current-context >/dev/null 2>&1; then
      echo "OrbStack is preferred on macOS. Install: brew install orbstack"
      echo "OrbStack not detected; using existing Kubernetes context"
    else
      require_cmd kind "Install: https://kind.sigs.k8s.io/docs/user/quick-start/"
      require_cmd docker "Install: https://docs.docker.com/desktop/"
    fi
  fi
else
  if [[ "$provider" == "kind" ]]; then
    require_cmd kind "Install: https://kind.sigs.k8s.io/docs/user/quick-start/"
    require_cmd docker "Install: https://docs.docker.com/engine/install/"
  elif [[ "$provider" == "existing" ]]; then
    if ! kubectl config current-context >/dev/null 2>&1; then
      echo "No current Kubernetes context detected"
      missing=1
    fi
  else
    if kubectl config current-context >/dev/null 2>&1; then
      :
    else
      require_cmd kind "Install: https://kind.sigs.k8s.io/docs/user/quick-start/"
      require_cmd docker "Install: https://docs.docker.com/engine/install/"
    fi
  fi
fi

if [[ "$missing" -ne 0 ]]; then
  exit 1
fi
