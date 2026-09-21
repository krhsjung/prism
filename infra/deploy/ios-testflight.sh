#!/usr/bin/env bash
# iOS Release 아카이브를 만들어 App Store Connect(TestFlight)로 올린다.
#
#   PRISM_SERVICE_DOMAIN=<도메인> ./infra/deploy/ios-testflight.sh
#   ./infra/deploy/ios-testflight.sh --export-only   # 지난 아카이브를 그대로 써서 업로드만
#
# 앱이 붙을 주소는 PRISM_SERVICE_DOMAIN에서 만든다(https://<도메인> · wss://<도메인>/socket —
# 웹 빌드와 같은 규칙). 다른 주소가 필요하면 PRISM_API_URL · PRISM_SOCKET_URL로 직접 준다.
# 값은 Info.plist로 들어간다(apps/ios/README.md "API 주소").
#
# 서명 키와 App Store Connect 인증은 **로그인 키체인**에 있다. Terminal.app 같은 GUI 세션이면
# 처음 한 번 뜨는 키 접근 창에서 "항상 허용"을 누른다. ssh·원격 터미널·에이전트 셸처럼 GUI
# 세션이 아니면 그 세션에서는 키체인이 잠겨 있어 codesign이 errSecInternalComponent로 죽으므로,
# 먼저 잠금을 푼다(macOS 로그인 비밀번호를 한 번 입력한다 — 저장하지 않는다).
#
# 하는 일
#   1. Release 구성으로 실기기(generic/platform=iOS) 아카이브 → apps/ios/build/prism.xcarchive
#   2. apps/ios/Config/ExportOptions.plist(app-store-connect · destination=upload)로 내보내며
#      곧장 업로드. 배포 인증서·App Store 프로파일이 없으면 -allowProvisioningUpdates가 만들고,
#      빌드 번호는 이미 올라간 것과 겹치지 않게 Xcode가 올린다(manageAppVersionAndBuildNumber).
#
# 전제: App Store Connect에 번들 ID kr.hs.jung.prism의 앱 레코드가 있어야 한다. 없으면 2단계가
#       "App record … not found"로 거절된다 — 사이트에서 한 번 만들고 --export-only로 다시 한다.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT/apps/ios"

EXPORT_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --export-only) EXPORT_ONLY=1 ;;
    *) echo "unknown option: $arg (only --export-only)" >&2; exit 2 ;;
  esac
done

# 전체 출력을 로그에도 남긴다(apps/ios/build/ 는 .gitignore). xcodebuild의 실패 요약에는 원인
# 줄이 없어서, 실패하면 로그에서 원인이 될 만한 줄을 뽑아 보여 준다.
LOG="build/upload-testflight.log"
mkdir -p build
exec > >(tee "$LOG") 2>&1
on_error() {
  echo
  echo "── failed — likely cause (from apps/ios/$LOG) ──"
  grep -nE "error:|errSec|not allowed|No signing|no identity|Provisioning profile|doesn't (include|match)|unable to build chain|detritus|Signing Identity:" "$LOG" \
    | grep -vE "Werror|ivfsstatcache" | tail -15
  if grep -q "errSecInternalComponent" "$LOG"; then
    cat <<'HINT'

errSecInternalComponent = codesign이 키체인의 서명 키를 쓰지 못했다.
  · GUI 세션(Terminal.app)이면 키체인 접근 창에서 "항상 허용"을 눌렀는지 확인한다.
  · ssh/원격이면 잠금 해제 뒤에도 실패할 때 **한 번만** 키 ACL을 열어 준다(비밀번호 입력):
      security set-key-partition-list -S apple-tool:,apple:,codesign: -s ~/Library/Keychains/login.keychain-db
HINT
  fi
}
trap on_error ERR

if [[ "$(launchctl managername 2>/dev/null || true)" != "Aqua" ]]; then
  echo "note: not a GUI login session — unlocking the login keychain for this session (enter your macOS login password)."
  if [[ ! -t 0 ]]; then
    echo "error: no terminal to read the password from — run from Terminal.app or an interactive ssh shell." >&2
    exit 1
  fi
  security unlock-keychain "$HOME/Library/Keychains/login.keychain-db"
fi

ARCHIVE="build/prism.xcarchive"
EXPORT_DIR="build/export"         # destination=upload 라 .ipa 는 남지 않고 로그만 남는다
APP_PLIST="$ARCHIVE/Products/Applications/prism.app/Info.plist"

if (( EXPORT_ONLY )); then
  [[ -f "$APP_PLIST" ]] || { echo "error: no archive at apps/ios/$ARCHIVE — run without --export-only first" >&2; exit 1; }
else
  API_URL="${PRISM_API_URL:-}"; SOCKET_URL="${PRISM_SOCKET_URL:-}"
  if [[ -z "$API_URL" || -z "$SOCKET_URL" ]]; then
    : "${PRISM_SERVICE_DOMAIN:?set PRISM_SERVICE_DOMAIN (or both PRISM_API_URL and PRISM_SOCKET_URL)}"
    API_URL="${API_URL:-https://$PRISM_SERVICE_DOMAIN}"
    SOCKET_URL="${SOCKET_URL:-wss://$PRISM_SERVICE_DOMAIN/socket}"
  fi
  case "$API_URL" in https://?*) ;; *) echo "error: PRISM_API_URL must be https:// — got '$API_URL'" >&2; exit 1 ;; esac
  case "$SOCKET_URL" in wss://?*) ;; *) echo "error: PRISM_SOCKET_URL must be wss:// — got '$SOCKET_URL'" >&2; exit 1 ;; esac

  echo "==> archive (api: $API_URL · socket: $SOCKET_URL)"
  rm -rf "$ARCHIVE"
  xcodebuild -project prism.xcodeproj -scheme prism -configuration Release \
    -destination 'generic/platform=iOS' \
    -archivePath "$ARCHIVE" \
    -allowProvisioningUpdates \
    "PRISM_API_URL=$API_URL" "PRISM_SOCKET_URL=$SOCKET_URL" \
    archive
fi

# 올리기 전에 들어간 값을 눈으로 확인한다 — 잘못된 주소를 올리고 나서 아는 것보다 낫다.
echo "==> archive contents"
printf '    bundle   %s\n' "$(plutil -extract CFBundleIdentifier raw -o - "$APP_PLIST")"
printf '    version  %s (%s)\n' \
  "$(plutil -extract CFBundleShortVersionString raw -o - "$APP_PLIST")" \
  "$(plutil -extract CFBundleVersion raw -o - "$APP_PLIST")"
printf '    api      %s\n' "$(plutil -extract PRISM_API_URL raw -o - "$APP_PLIST")"
printf '    socket   %s\n' "$(plutil -extract PRISM_SOCKET_URL raw -o - "$APP_PLIST")"

echo "==> export & upload"
rm -rf "$EXPORT_DIR"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportOptionsPlist Config/ExportOptions.plist \
  -exportPath "$EXPORT_DIR" \
  -allowProvisioningUpdates

echo "==> uploaded"

# 올라간 것만으로는 테스터에게 가지 않는다 — **외부 그룹에는 빌드가 자동으로 들어가지 않기
# 때문이다**(자동 배포 설정은 내부 그룹에만 있다). API 키가 설정돼 있으면 배정까지 여기서
# 이어서 한다(처리가 끝날 때까지 기다린다). 키가 없으면 사이트에서 손으로 추가하면 된다.
DISTRIBUTE="$ROOT/infra/deploy/testflight-distribute.sh"
if "$DISTRIBUTE" --list >/dev/null 2>&1; then
  echo "==> distributing to beta groups"
  "$DISTRIBUTE"
else
  echo "==> not distributed — no App Store Connect API key configured."
  echo "    App Store Connect ▸ TestFlight 에서 빌드를 그룹에 추가하거나,"
  echo "    키를 두고 ./infra/deploy/testflight-distribute.sh 를 실행한다(README 참고)."
fi
