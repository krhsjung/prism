#!/usr/bin/env bash
# Helm 차트 설치 (env 치환 방식).
#   ./install.sh <prism-auth|prism-api>             # 설치/업그레이드
#   ./install.sh <chart> --template                 # 렌더 미리보기 (클러스터 불필요)
#   ./install.sh <chart> --uninstall                # 제거
#
# 시크릿/도메인은 환경변수로 주입 (예: ~/.zshenv):
#   PRISM_SERVICE_DOMAIN, AUTH_JWT_SECRET, PRISM_REGISTRY_PASSWORD
set -euo pipefail
source ~/.zshenv 2>/dev/null || true

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NS="${PRISM_NAMESPACE:-prism}"
CHART="${1:?usage: install.sh <prism-auth|prism-api> [--template|--uninstall]}"
ACTION="${2:-install}"
CHART_PATH="$HERE/charts/$CHART"
[ -d "$CHART_PATH" ] || { echo "chart not found: $CHART_PATH"; exit 1; }

if [ "$ACTION" = "--uninstall" ]; then
  helm uninstall "$CHART" -n "$NS" 2>/dev/null || echo "not installed"
  exit 0
fi

: "${PRISM_SERVICE_DOMAIN:?set PRISM_SERVICE_DOMAIN}"

# env 치환된 values 생성 (사용 후 삭제 → 시크릿 비영속).
# trap을 생성 전에 걸어, 치환 실패 시에도 잔여 파일이 남지 않게 한다.
GEN="$CHART_PATH/values.generated.yaml"
trap 'rm -f "$GEN"' EXIT
eval "cat <<EOF
$(cat "$CHART_PATH/values.yaml")
EOF" > "$GEN"

if [ "$ACTION" = "--template" ]; then
  helm template "$CHART" "$CHART_PATH" -n "$NS" -f "$GEN"
  exit 0
fi

# 네임스페이스 + 레지스트리 pull 시크릿 (공유, 멱등)
kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f -
: "${PRISM_REGISTRY_PASSWORD:?set PRISM_REGISTRY_PASSWORD}"
kubectl create secret docker-registry prism-registry \
  --docker-server="${PRISM_REGISTRY:?set PRISM_REGISTRY}" \
  --docker-username="${PRISM_REGISTRY_USER:?set PRISM_REGISTRY_USER}" \
  --docker-password="$PRISM_REGISTRY_PASSWORD" \
  -n "$NS" --dry-run=client -o yaml | kubectl apply -f -

helm upgrade --install "$CHART" "$CHART_PATH" -n "$NS" -f "$GEN" --wait --timeout 120s
echo "==> $CHART installed (ns: $NS)"
