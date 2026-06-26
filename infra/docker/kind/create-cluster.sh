#!/bin/bash
set -e

CLUSTER_NAME="${1:-kind}"
CONFIG_FILE="$(dirname "$0")/kind-config-full-port-range.yaml"

echo "==> Kind 클러스터 생성 중: $CLUSTER_NAME"
kind create cluster --name "$CLUSTER_NAME" --config "$CONFIG_FILE"

echo "==> host.docker.internal DNS 설정 중..."

# Docker Desktop의 host.docker.internal IP 가져오기
HOST_IP=$(docker run --rm alpine sh -c "getent hosts host.docker.internal | awk '{print \$1}'" 2>/dev/null || \
          docker run --rm alpine nslookup host.docker.internal 2>/dev/null | grep 'Address' | tail -1 | awk '{print $2}')

if [ -z "$HOST_IP" ]; then
    echo "WARNING: host.docker.internal IP를 찾을 수 없습니다. 호스트 게이트웨이 IP 사용"
    HOST_IP="host-gateway"
fi

echo "==> Host IP: $HOST_IP"

# CoreDNS ConfigMap 패치
kubectl get configmap coredns -n kube-system -o yaml | \
sed '/kubernetes cluster.local/i\
\        hosts {\
\           '"$HOST_IP"' host.docker.internal\
\           fallthrough\
\        }' | \
kubectl apply -f -

# CoreDNS 재시작
echo "==> CoreDNS 재시작 중..."
kubectl rollout restart deployment coredns -n kube-system
kubectl rollout status deployment coredns -n kube-system

echo "==> 완료! Pod에서 host.docker.internal 사용 가능"
echo ""
echo "테스트 명령어:"
echo "  kubectl run test --rm -it --image=alpine --restart=Never -- nslookup host.docker.internal"
