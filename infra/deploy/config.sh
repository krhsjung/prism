#!/usr/bin/env bash
# 배포 공통 설정. 값은 환경변수로 주입하고, 합리적 기본값을 둔다.
# 레지스트리 호스트/계정·시크릿은 기본값 없이 env로만 주입한다(개인 정보 미포함).
set -euo pipefail

export PRISM_SERVICE_DOMAIN="${PRISM_SERVICE_DOMAIN:?PRISM_SERVICE_DOMAIN must be set}"
export PRISM_REGISTRY="${PRISM_REGISTRY:?set PRISM_REGISTRY (image registry host)}"
export PRISM_REGISTRY_USER="${PRISM_REGISTRY_USER:?set PRISM_REGISTRY_USER}"
export PRISM_IMAGE_TAG="${PRISM_IMAGE_TAG:-latest}"
export PRISM_AUTH_NODEPORT="${PRISM_AUTH_NODEPORT:-30000}"
export PRISM_API_NODEPORT="${PRISM_API_NODEPORT:-30001}"
export PRISM_WEB_DEPLOYMENT_PATH="${PRISM_WEB_DEPLOYMENT_PATH:?set PRISM_WEB_DEPLOYMENT_PATH (e.g. /var/www/prism)}"
export KIND_CLUSTER="${KIND_CLUSTER:-kind}"

# 레포 경로
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export ROOT
export SERVER_DIR="$ROOT/apps/server"
export WEB_DIR="$ROOT/apps/web"
export K8S_DIR="$ROOT/infra/k8s"
