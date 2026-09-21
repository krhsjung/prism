#!/usr/bin/env bash
# Play 스토어용 스크린샷을 **실제 앱 화면**에서 찍는다(에뮬레이터 또는 연결된 기기).
#
#   ./capture-screenshots.sh ko-KR          # 그 언어로 바꿔 4장
#   ./capture-screenshots.sh en-US ja-JP    # 여러 언어를 잇달아
#
# 찍는 것: 로그인 · 대시보드 · 푸시 · 통화. 저장 위치는 ../<언어>/_assets/screenshots/phone/.
#
# 화면 문구는 생성된 문자열 리소스에서 읽어 **텍스트로 눌러** 좌표를 박지 않는다 — 기기
# 해상도·언어가 달라도 같은 흐름이 돈다(i18n/ 이 원천이고 values*/ 는 그 산출물이다).
#
# 전제: 기기 하나가 붙어 있고 디버그 APK가 깔려 있다. 데모 로그인을 쓰므로 서버가 떠 있어야 한다.
#   ./gradlew :app:installDebug
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
LISTING_DIR="$(cd .. && pwd)"
ROOT="$(cd ../../../../.. && pwd)"
RES="$ROOT/apps/android/app/src/generated/res"
ADB="${ADB:-$HOME/Library/Android/sdk/platform-tools/adb}"
PKG="${PRISM_ANDROID_PACKAGE:-kr.hs.jung.prism}"

(( $# )) || { echo "usage: $0 <language>... (e.g. ko-KR en-US ja-JP)" >&2; exit 2; }
[[ -x "$ADB" ]] || { echo "error: no adb at $ADB (set ADB=)" >&2; exit 1; }
[[ -n "$("$ADB" devices | sed -n '2p')" ]] || { echo "error: no device — start an emulator first" >&2; exit 1; }

# 언어 코드 → values 디렉터리. 기본 언어(en)는 values/ 다.
res_dir() {
  case "$1" in
    ko-KR) echo "$RES/values-ko" ;;
    ja-JP) echo "$RES/values-ja" ;;
    en-US) echo "$RES/values" ;;
    *) echo "error: unknown language $1 (ko-KR | en-US | ja-JP)" >&2; return 1 ;;
  esac
}
# 문구 하나를 리소스에서 읽는다. 번역이 비어 있으면 기본 언어로 떨어진다(앱과 같은 규칙).
msg() {
  local dir="$1" key="$2" v
  v=$(grep -ohE "<string name=\"$key\">[^<]*" "$dir"/*.xml 2>/dev/null | head -1 | sed 's/.*">//')
  [[ -n "$v" ]] || v=$(grep -ohE "<string name=\"$key\">[^<]*" "$RES/values"/*.xml | head -1 | sed 's/.*">//')
  printf '%s' "$v"
}

dump() { "$ADB" shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 && "$ADB" shell cat /sdcard/ui.xml; }
# 화면에 그 문구가 나올 때까지 기다린다(애니메이션·네트워크를 재는 대신 상태를 본다).
wait_text() {
  local needle="$1" n=0
  until dump | grep -qF "text=\"$needle\""; do
    n=$((n + 1)); (( n < 60 )) || { echo "error: '$needle' never appeared" >&2; return 1; }
    sleep 2
  done
}
# 문구가 든 노드의 가운데를 누른다. bounds="[x1,y1][x2,y2]" 를 풀어 중심을 계산한다.
tap_text() {
  local needle="$1" bounds x1 y1 x2 y2
  bounds=$(dump | tr '>' '\n' | grep -F "text=\"$needle\"" | grep -oE 'bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' | head -1)
  [[ -n "$bounds" ]] || { echo "error: no node with text '$needle'" >&2; return 1; }
  read -r x1 y1 x2 y2 <<< "$(echo "$bounds" | grep -oE '[0-9]+' | tr '\n' ' ')"
  "$ADB" shell input tap $(( (x1 + x2) / 2 )) $(( (y1 + y2) / 2 ))
}
shoot() { "$ADB" exec-out screencap -p > "$1"; echo "    $(basename "$1")"; }

for LANG_CODE in "$@"; do
  DIR="$(res_dir "$LANG_CODE")"
  OUT="$LISTING_DIR/$LANG_CODE/_assets/screenshots/phone"
  mkdir -p "$OUT"
  echo "==> $LANG_CODE"

  # 매번 같은 자리에서 시작한다 — 앱 데이터를 지우면 로그아웃 + 언어 선택까지 초기화된다.
  "$ADB" shell pm clear "$PKG" >/dev/null
  "$ADB" shell am start -n "$PKG/.MainActivity" >/dev/null
  wait_text "$(msg "$RES/values" auth_try_the_demo)"

  # 언어 전환: 로그인 화면 아래의 스위처에서 고른다(기본은 기기 언어를 따른다).
  case "$LANG_CODE" in
    ko-KR) LABEL="한국어" ;;
    ja-JP) LABEL="日本語" ;;
    en-US) LABEL="English" ;;
  esac
  if ! dump | grep -qF "text=\"$(msg "$DIR" auth_try_the_demo)\""; then
    tap_text "English" 2>/dev/null || tap_text "한국어" 2>/dev/null || tap_text "日本語"
    wait_text "$LABEL"; tap_text "$LABEL"
    wait_text "$(msg "$DIR" auth_try_the_demo)"
  fi
  shoot "$OUT/01-login.png"

  tap_text "$(msg "$DIR" auth_try_the_demo)"
  wait_text "$(msg "$DIR" dashboard_active_sessions)"
  shoot "$OUT/02-dashboard.png"

  open_drawer() { tap_text "Prism"; sleep 1; }
  for pair in "push_title:03-push" "webrtc_title:04-call"; do
    key="${pair%%:*}"; name="${pair##*:}"
    # 드로어는 상단 바의 메뉴 버튼이다 — 텍스트가 없으므로 오른쪽 위 모서리를 누른다.
    read -r W H <<< "$("$ADB" shell wm size | grep -oE '[0-9]+x[0-9]+' | tr 'x' ' ')"
    "$ADB" shell input tap $(( W - 110 )) 140
    wait_text "$(msg "$DIR" "$key")"
    tap_text "$(msg "$DIR" "$key")"
    sleep 2
    shoot "$OUT/$name.png"
  done
done
echo "==> done — ./infra/deploy/android-play-listing.sh 로 올린다."
