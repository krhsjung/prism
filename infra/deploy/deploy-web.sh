#!/usr/bin/env bash
# 웹(prism 빌드)을 정적 웹 루트로 배포. nginx가 `/`에서 서빙.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/config.sh"

echo "==> build web (prism mode)"
pnpm -C "$WEB_DIR" build

echo "==> deploy dist -> $PRISM_WEB_DEPLOYMENT_PATH"
mkdir -p "$PRISM_WEB_DEPLOYMENT_PATH"
# `/dl/`은 웹 빌드 산출물이 아니라 **Android 릴리스 산출물**이 사는 자리다
# (android-apk.sh가 거기에 APK를 놓는다). --delete는 dist에 없는 것을 지우므로 제외하지
# 않으면 웹을 배포할 때마다 APK가 조용히 사라진다 — 제외된 경로는 삭제 대상에서도 빠진다.
rsync -a --delete --exclude=/dl/ "$WEB_DIR/dist/" "$PRISM_WEB_DEPLOYMENT_PATH/"
echo "==> done"
