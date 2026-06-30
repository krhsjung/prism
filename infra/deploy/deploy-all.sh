#!/usr/bin/env bash
# 전체 배포: 이미지 빌드/푸시 → auth·api Helm 배포 → 웹 정적 배포.
# 필요한 env: PRISM_SERVICE_DOMAIN, PRISM_JWT_SECRET_KEY,
#             PRISM_JWT_REFRESH_SECRET_KEY, PRISM_REGISTRY_PASSWORD
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"$HERE/build-push.sh"
"$HERE/install.sh" prism-auth
"$HERE/install.sh" prism-api
"$HERE/deploy-web.sh"

echo "==> all deployed"
