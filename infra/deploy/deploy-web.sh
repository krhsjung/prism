#!/usr/bin/env bash
# 웹(prism 빌드)을 정적 웹 루트로 배포. nginx가 `/`에서 서빙.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/config.sh"

echo "==> build web (prism mode)"
pnpm -C "$WEB_DIR" build

echo "==> deploy dist -> $PRISM_WEB_DEPLOYMENT_PATH"
mkdir -p "$PRISM_WEB_DEPLOYMENT_PATH"
rsync -a --delete "$WEB_DIR/dist/" "$PRISM_WEB_DEPLOYMENT_PATH/"
echo "==> done"
