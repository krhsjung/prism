#!/usr/bin/env bash
# auth·api 이미지를 빌드해 레지스트리에 푸시한다.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/config.sh"

: "${PRISM_REGISTRY_PASSWORD:?set PRISM_REGISTRY_PASSWORD (registry password for user '$PRISM_REGISTRY_USER')}"

echo "==> docker login $PRISM_REGISTRY (user: $PRISM_REGISTRY_USER)"
printf '%s' "$PRISM_REGISTRY_PASSWORD" | docker login "$PRISM_REGISTRY" -u "$PRISM_REGISTRY_USER" --password-stdin

for app in auth api; do
  img="$PRISM_REGISTRY/prism-$app:$PRISM_IMAGE_TAG"
  echo "==> build & push $img"
  docker build --build-arg "APP=$app" -t "$img" "$SERVER_DIR"
  docker push "$img"
done
echo "==> done"
