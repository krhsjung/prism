#!/usr/bin/env bash
# 설치용 APK를 만들어 웹 루트의 `/dl/`에 놓는다 — `/download` 안내 페이지의 버튼이
# 내려받게 할 파일이다(plan/distribution.md §2-1).
#
#   PRISM_SERVICE_DOMAIN=<도메인> ./infra/deploy/android-apk.sh
#   PRISM_SERVICE_DOMAIN=<도메인> ./infra/deploy/android-apk.sh --no-publish   # 빌드만
#
# **android-bundle.sh와 갈라 둔 이유**: 그쪽은 Play에 올릴 **AAB**를 만들고 이쪽은 사람이
# 직접 설치할 **APK**를 만든다. 산출물도 목적지도 다르다 — AAB는 설치할 수 없다.
#
# 주소 규칙은 android-bundle.sh와 같다(PRISM_SERVICE_DOMAIN → https/wss, PRISM_API_URL ·
# PRISM_SOCKET_URL로 덮어쓰기). 릴리스는 두 주소가 없으면 Gradle이 빌드 시점에 거절한다.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

PUBLISH=1
while (( $# )); do
  case "$1" in
    --no-publish) PUBLISH=0; shift ;;
    *) echo "unknown option: $1 (--no-publish)" >&2; exit 2 ;;
  esac
done

cd "$ROOT/apps/android"

# 서명 없는 APK는 **설치 자체가 되지 않는다.** AAB와 달리 "일단 만들어 두는" 의미가 없으므로
# 키스토어가 없으면 여기서 멈춘다.
[[ -f keystore.properties ]] || {
  echo "error: apps/android/keystore.properties not found — copy keystore.example.properties and fill it." >&2
  echo "       서명 없는 APK는 기기에 설치되지 않는다." >&2
  exit 1
}

API_URL="${PRISM_API_URL:-}"; SOCKET_URL="${PRISM_SOCKET_URL:-}"
if [[ -z "$API_URL" || -z "$SOCKET_URL" ]]; then
  : "${PRISM_SERVICE_DOMAIN:?set PRISM_SERVICE_DOMAIN (or both PRISM_API_URL and PRISM_SOCKET_URL)}"
  API_URL="${API_URL:-https://$PRISM_SERVICE_DOMAIN}"
  SOCKET_URL="${SOCKET_URL:-wss://$PRISM_SERVICE_DOMAIN/socket}"
fi

echo "==> assembleRelease (api: $API_URL · socket: $SOCKET_URL)"
PRISM_API_URL="$API_URL" PRISM_SOCKET_URL="$SOCKET_URL" ./gradlew :app:assembleRelease --console=plain

APK="app/build/outputs/apk/release/app-release.apk"
[[ -f "$APK" ]] || { echo "error: $APK was not produced" >&2; exit 1; }

echo "==> verify signature"
# **jarsigner도 keytool -printcert -jarfile도 쓸 수 없다.** 둘 다 v1(JAR) 서명만 읽는데,
# minSdk가 24라 AGP는 v1을 끄고 APK Signature Scheme v2로만 서명한다 — 그 도구들은 제대로
# 서명된 APK를 "unsigned"라고 말한다(AAB는 v1이라 android-bundle.sh는 jarsigner로 맞다).
# APK를 보는 도구는 Android SDK build-tools의 apksigner다.
APKSIGNER="$(ls -d "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"/build-tools/*/apksigner 2>/dev/null | sort -V | tail -1)"
[[ -n "$APKSIGNER" ]] || {
  echo "error: apksigner not found — install Android SDK build-tools (set ANDROID_HOME)." >&2
  echo "       서명을 확인하지 못한 APK는 내보내지 않는다." >&2
  exit 1
}
CERTS="$("$APKSIGNER" verify --verbose --print-certs "$APK")"
grep -qE '^Verified using v[0-9.]+ scheme[^:]*: true' <<< "$CERTS" || {
  echo "error: $APK is not signed" >&2; exit 1
}
echo "    $(grep -m1 'certificate DN:' <<< "$CERTS" | sed 's/.*certificate DN: //')"

# 이 APK는 **업로드 키**로 서명된다 — Play가 배포하는 APK(Play 앱 서명 키)와 지문이 다르다.
# 소셜 로그인은 지문으로 앱을 알아보므로, SHA-1을 Google Cloud의 Android OAuth 클라이언트에,
# 키 해시를 Kakao에 등록해야 한다(apps/android/README.md). 등록 전에는 데모·리다이렉트
# 로그인만 된다 — 그래서 빌드할 때마다 눈앞에 띄운다.
SHA1="$(grep -m1 'certificate SHA-1 digest:' <<< "$CERTS" | sed 's/.*digest: //')"
SHA256="$(grep -m1 'certificate SHA-256 digest:' <<< "$CERTS" | sed 's/.*digest: //')"
echo "    upload key fingerprints (register these for social login):"
echo "      SHA-1       $SHA1"
echo "      SHA-256     $SHA256"
# Kakao가 받는 것은 16진수가 아니라 **SHA-1 원본 바이트의 base64**다.
echo "      Kakao hash  $(printf '%s' "$SHA1" | tr -d ':' | xxd -r -p | base64)"

VERSION_NAME="$(sed -n 's/.*versionName = "\([^"]*\)".*/\1/p' app/build.gradle.kts | head -1)"
VERSION_CODE="$(sed -n 's/.*versionCode = \([0-9]*\).*/\1/p' app/build.gradle.kts | head -1)"
echo "    versionName $VERSION_NAME · versionCode $VERSION_CODE"
echo "==> $ROOT/apps/android/$APK"

(( PUBLISH )) || exit 0

# 웹 루트가 설정돼 있으면 거기까지 옮긴다. `/dl/`은 **deploy-web.sh의 rsync에서 제외된 자리**라
# 웹을 다시 배포해도 지워지지 않는다(그 스크립트의 --exclude).
#
# 파일을 둘로 둔다: 버전이 붙은 사본(어떤 빌드를 받았는지 나중에 확인)과, 안내 페이지와
# 이력서가 가리키는 **고정 이름**. 링크는 한 번 나가면 못 고치므로 주소가 버전을 물면 안 된다.
WEB_ROOT="${PRISM_WEB_DEPLOYMENT_PATH:-}"
if [[ -z "$WEB_ROOT" ]]; then
  echo "    (PRISM_WEB_DEPLOYMENT_PATH가 없어 배치는 건너뛴다 — 위 경로의 파일을 직접 옮긴다)"
  exit 0
fi

DL="$WEB_ROOT/dl"
mkdir -p "$DL"
install -m 644 "$APK" "$DL/prism-$VERSION_NAME.apk"
install -m 644 "$APK" "$DL/prism.apk"
echo "==> $DL/prism.apk (and prism-$VERSION_NAME.apk)"
echo "    안내 페이지: /download — 버튼이 /dl/prism.apk를 가리킨다."
