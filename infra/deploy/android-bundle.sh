#!/usr/bin/env bash
# Android Release 앱 번들(AAB)을 만든다 — Play Console 내부 테스트에 올릴 파일.
#
#   PRISM_SERVICE_DOMAIN=<도메인> ./infra/deploy/android-bundle.sh
#
# 주소 규칙은 ios-testflight.sh와 같다(PRISM_SERVICE_DOMAIN → https/wss, PRISM_API_URL ·
# PRISM_SOCKET_URL로 덮어쓰기). 릴리스는 두 주소가 없거나 형태가 틀리면 Gradle이 빌드 시점에
# 거절한다(apps/android/app/build.gradle.kts).
#
# 서명은 apps/android/keystore.properties가 가리키는 업로드 키스토어로 한다(템플릿은
# keystore.example.properties). 파일이 없으면 서명 없이 빌드돼 Play에 올릴 수 없으므로 여기서
# 멈춘다. 업로드는 Play Console 웹에서 한다(README "모바일 스토어 배포") — 올릴 때마다
# app/build.gradle.kts의 versionCode를 올린다.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT/apps/android"

[[ -f keystore.properties ]] || {
  echo "error: apps/android/keystore.properties not found — copy keystore.example.properties and fill it (the release would be unsigned)." >&2
  exit 1
}

API_URL="${PRISM_API_URL:-}"; SOCKET_URL="${PRISM_SOCKET_URL:-}"
if [[ -z "$API_URL" || -z "$SOCKET_URL" ]]; then
  : "${PRISM_SERVICE_DOMAIN:?set PRISM_SERVICE_DOMAIN (or both PRISM_API_URL and PRISM_SOCKET_URL)}"
  API_URL="${API_URL:-https://$PRISM_SERVICE_DOMAIN}"
  SOCKET_URL="${SOCKET_URL:-wss://$PRISM_SERVICE_DOMAIN/socket}"
fi

echo "==> bundleRelease (api: $API_URL · socket: $SOCKET_URL)"
PRISM_API_URL="$API_URL" PRISM_SOCKET_URL="$SOCKET_URL" ./gradlew :app:bundleRelease --console=plain

AAB="app/build/outputs/bundle/release/app-release.aab"
echo "==> verify signature"
# jarsigner는 서명이 없어도 0으로 끝나므로("jar is unsigned.") 출력으로 판정한다.
jarsigner -verify "$AAB" | grep -q "jar verified" || { echo "error: $AAB is not signed" >&2; exit 1; }
echo "    $(jarsigner -verify -verbose -certs "$AAB" | grep -m1 -oE 'CN=[^,]+')"
grep -oE 'version(Code|Name) = [^\n]+' app/build.gradle.kts | sed 's/^/    /'

echo "==> $ROOT/apps/android/$AAB"

# 서비스 계정 키가 있으면 업로드까지 이어서 한다(iOS가 업로드 뒤 배정까지 가는 것과 같다).
# 없으면 파일 경로만 알려 주고, 사람이 Play Console 웹에서 올리면 된다.
UPLOAD_SH="$ROOT/infra/deploy/android-play-upload.sh"
SA_KEY="${PRISM_PLAY_SERVICE_ACCOUNT:-$HOME/certs/google/play-service-account.json}"
if [[ -f "$SA_KEY" ]]; then
  echo "==> uploading to Play (track: ${PRISM_PLAY_TRACK:-internal})"
  "$UPLOAD_SH" --track "${PRISM_PLAY_TRACK:-internal}" --aab "$ROOT/apps/android/$AAB"
else
  echo "    Play Console ▸ 테스트 ▸ 내부 테스트 ▸ 새 릴리스 만들기에 올린다."
  echo "    (서비스 계정 키를 두면 여기서 바로 올라간다 — infra/deploy/README.md 참고)"
fi
