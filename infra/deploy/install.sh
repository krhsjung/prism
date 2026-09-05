#!/usr/bin/env bash
# Helm 차트 설치 (env 치환 방식).
#   ./install.sh <prism-auth|prism-api|prism-socket>  # 설치/업그레이드
#   ./install.sh <chart> --template                 # 렌더 미리보기 (클러스터 불필요)
#   ./install.sh <chart> --uninstall                # 제거
#
# 시크릿/도메인은 환경변수로 주입 (예: ~/.zshenv):
#   PRISM_SERVICE_DOMAIN, AUTH_JWT_SECRET, PRISM_REGISTRY_PASSWORD
set -euo pipefail
source ~/.zshenv 2>/dev/null || true

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NS="${PRISM_NAMESPACE:-prism}"
CHART="${1:?usage: install.sh <prism-auth|prism-api|prism-socket> [--template|--uninstall]}"
ACTION="${2:-install}"
CHART_PATH="$HERE/charts/$CHART"
[ -d "$CHART_PATH" ] || { echo "chart not found: $CHART_PATH"; exit 1; }

if [ "$ACTION" = "--uninstall" ]; then
  helm uninstall "$CHART" -n "$NS" 2>/dev/null || echo "not installed"
  exit 0
fi

: "${PRISM_SERVICE_DOMAIN:?set PRISM_SERVICE_DOMAIN}"

# 배포 리비전 — 파드 템플릿 애노테이션으로 들어가 롤아웃을 **트리거하는 역할**을 한다.
#
# 이미지 태그가 `latest`로 고정이라, 새 이미지를 밀어 넣어도 Deployment 스펙이 그대로면
# 쿠버네티스는 "바뀐 게 없다"고 보고 파드를 그대로 둔다 — helm이 "Upgrade complete"를
# 내는데도 예전 코드가 계속 도는 상태가 된다(실제로 겪었다).
#
# 시각이 아니라 **커밋 해시**를 쓴다: 시각으로 찍으면 코드가 그대로여도 upgrade마다
# 파드가 죽었다 살아난다. 해시면 바뀌었을 때만 돌고, `kubectl describe`만 봐도 지금
# 무엇이 도는지 알 수 있다(`latest`만으로는 알 수 없는 정보다).
# 커밋되지 않은 변경이 섞인 빌드는 해시가 같아도 내용이 다르므로 `-dirty`를 붙여 구분한다.
if [ -z "${PRISM_DEPLOY_REVISION:-}" ]; then
  if git -C "$HERE" rev-parse --git-dir >/dev/null 2>&1; then
    PRISM_DEPLOY_REVISION="$(git -C "$HERE" rev-parse --short HEAD)"
    git -C "$HERE" diff --quiet HEAD -- 2>/dev/null ||
      PRISM_DEPLOY_REVISION="$PRISM_DEPLOY_REVISION-dirty-$(date +%s)"
  else
    # 저장소 밖에서 돌린 경우 — 되돌릴 근거가 없으니 매번 새로 띄운다.
    PRISM_DEPLOY_REVISION="unknown-$(date +%s)"
  fi
fi
export PRISM_DEPLOY_REVISION
echo "==> revision $PRISM_DEPLOY_REVISION"

# env 치환된 values 생성 (사용 후 삭제 → 시크릿 비영속).
# trap을 생성 전에 걸어, 치환 실패 시에도 잔여 파일이 남지 않게 한다.
#
# ⚠️ **백틱과 $(...)를 먼저 막는다.** heredoc은 ${VAR} 뿐 아니라 명령 치환도 실행하므로,
# values.yaml **주석 안의** `이런 표기`가 그대로 셸 명령이 된다. 실제로 주석의
# `kubectl get pod -o yaml`이 실행돼 그 출력이 YAML 한가운데 끼어들어 파싱이 깨졌다.
# 우리가 원하는 것은 변수 치환뿐이므로 나머지 둘만 무력화한다(${VAR:-기본값} 문법은 그대로 산다).
GEN="$CHART_PATH/values.generated.yaml"
trap 'rm -f "$GEN"' EXIT
eval "cat <<EOF
$(sed -e 's/`/\\`/g' -e 's/\$(/\\$(/g' "$CHART_PATH/values.yaml")
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
