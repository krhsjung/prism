#!/usr/bin/env bash
# Play 스토어 등록정보(텍스트 · 이미지)를 레포의 파일에서 밀어 넣는다.
#
#   ./infra/deploy/android-play-listing.sh            # 모든 언어 + 이미지
#   ./infra/deploy/android-play-listing.sh --show     # 지금 Play에 있는 것만 보여준다
#   ./infra/deploy/android-play-listing.sh --lang ko-KR
#
# 원천은 store-listing/android/ 다:
#   <언어>/title.txt · short.txt · full.txt   (제목 30자 · 간단한 설명 80자 · 자세한 설명 4000자)
#   _assets/icon.png(512x512) · feature-graphic.png(1024x500) · screenshots/phone/*.png
# 이미지는 언어마다 따로 올라가므로 같은 파일을 모든 언어에 넣는다(언어별로 다르게 하려면
# <언어>/_assets/ 를 두면 그쪽이 우선한다).
#
# **설문은 API가 없다** — 콘텐츠 등급 · 데이터 보안 · 타겟 층 · 개인정보처리방침은
# Play Console에서만 채울 수 있다(README "초안 앱에서는 internal 트랙만 열린다").
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/play-api.sh"

LISTING_DIR="$HERE/store-listing/android"
ONLY_LANG=""; SHOW_ONLY=0
while (( $# )); do
  case "$1" in
    --lang) ONLY_LANG="${2:?--lang needs a language code}"; shift 2 ;;
    --show) SHOW_ONLY=1; shift ;;
    *) echo "unknown option: $1 (--lang | --show)" >&2; exit 2 ;;
  esac
done

play_authenticate
EDIT_ID=$(play POST "$PLAY_PUB/edits" '{}' | jq -r '.id')
echo "==> edit $EDIT_ID ($PRISM_ANDROID_PACKAGE)"

if (( SHOW_ONLY )); then
  play GET "$PLAY_PUB/edits/$EDIT_ID/listings" \
    | jq -r '.listings[]? | "    \(.language)\ttitle \(.title|length)\tshort \(.shortDescription|length)\tfull \(.fullDescription|length)"' \
    | column -t -s $'\t'
  for lang in $(play GET "$PLAY_PUB/edits/$EDIT_ID/listings" | jq -r '.listings[]?.language'); do
    for type in icon featureGraphic phoneScreenshots; do
      n=$(play GET "$PLAY_PUB/edits/$EDIT_ID/listings/$lang/$type" | jq -r '(.images // []) | length')
      printf '    %s %s: %s\n' "$lang" "$type" "$n"
    done
  done
  play DELETE "$PLAY_PUB/edits/$EDIT_ID" >/dev/null || true
  exit 0
fi

# 언어 하나를 올린다. 길이 상한은 **바이트가 아니라 글자**다(한글·일본어는 바이트가 훨씬 크다).
push_text() {
  local lang="$1" dir="$LISTING_DIR/$lang" title short full
  [[ -f "$dir/title.txt" && -f "$dir/short.txt" && -f "$dir/full.txt" ]] || {
    echo "error: $dir needs title.txt, short.txt and full.txt" >&2; return 1; }
  title=$(cat "$dir/title.txt"); short=$(cat "$dir/short.txt"); full=$(cat "$dir/full.txt")
  local tn sn fn
  tn=$(printf '%s' "$title" | wc -m | tr -d ' ')
  sn=$(printf '%s' "$short" | wc -m | tr -d ' ')
  fn=$(printf '%s' "$full"  | wc -m | tr -d ' ')
  (( tn <= 30 ))   || { echo "error: $lang title is $tn characters (max 30)" >&2; return 1; }
  (( sn <= 80 ))   || { echo "error: $lang short description is $sn characters (max 80)" >&2; return 1; }
  (( fn <= 4000 )) || { echo "error: $lang full description is $fn characters (max 4000)" >&2; return 1; }
  play PUT "$PLAY_PUB/edits/$EDIT_ID/listings/$lang" \
    "$(jq -nc --arg l "$lang" --arg t "$title" --arg s "$short" --arg f "$full" \
       '{language:$l, title:$t, shortDescription:$s, fullDescription:$f}')" >/dev/null
  echo "    $lang text — title $tn · short $sn · full $fn chars"
}

# 언어별 파일이 있으면 그것을, 없으면 공용(_assets)을 쓴다 — **파일 단위**로 고른다.
# 디렉터리 단위로 고르면 스크린샷만 언어별로 두려 해도 아이콘까지 복사해야 한다.
pick_asset() {
  local lang="$1" rel="$2"
  [[ -f "$LISTING_DIR/$lang/_assets/$rel" ]] && { printf '%s' "$LISTING_DIR/$lang/_assets/$rel"; return; }
  printf '%s' "$LISTING_DIR/_assets/$rel"
}

# 이미지는 종류마다 통째로 갈아 끼운다(부분 갱신이 없다 — 지우고 다시 올린다).
push_images() {
  local lang="$1"
  local icon feature shots_dir
  icon="$(pick_asset "$lang" icon.png)"
  feature="$(pick_asset "$lang" feature-graphic.png)"
  shots_dir="$LISTING_DIR/$lang/_assets/screenshots/phone"
  [[ -d "$shots_dir" ]] || shots_dir="$LISTING_DIR/_assets/screenshots/phone"
  local shots=("$shots_dir"/*.png)

  if [[ -f "$icon" ]]; then
    play DELETE "$PLAY_PUB/edits/$EDIT_ID/listings/$lang/icon" >/dev/null
    play POST "$PLAY_UPLOAD/edits/$EDIT_ID/listings/$lang/icon?uploadType=media" "$icon" "image/png" >/dev/null
    echo "    $lang icon"
  fi
  if [[ -f "$feature" ]]; then
    play DELETE "$PLAY_PUB/edits/$EDIT_ID/listings/$lang/featureGraphic" >/dev/null
    play POST "$PLAY_UPLOAD/edits/$EDIT_ID/listings/$lang/featureGraphic?uploadType=media" "$feature" "image/png" >/dev/null
    echo "    $lang featureGraphic"
  fi
  # 글롭이 안 맞으면 패턴 문자열 그대로 남으므로 실제 파일인지 본다.
  if [[ -f "${shots[0]:-}" ]]; then
    play DELETE "$PLAY_PUB/edits/$EDIT_ID/listings/$lang/phoneScreenshots" >/dev/null
    local n=0
    for shot in "${shots[@]}"; do
      play POST "$PLAY_UPLOAD/edits/$EDIT_ID/listings/$lang/phoneScreenshots?uploadType=media" "$shot" "image/png" >/dev/null
      n=$((n + 1))
    done
    echo "    $lang phoneScreenshots ($n)"
  fi
}

LANGS=()
if [[ -n "$ONLY_LANG" ]]; then
  LANGS=("$ONLY_LANG")
else
  while IFS= read -r d; do LANGS+=("$(basename "$d")"); done \
    < <(find "$LISTING_DIR" -mindepth 1 -maxdepth 1 -type d -not -name '_*' | sort)
fi
(( ${#LANGS[@]} )) || { echo "error: no language directories under $LISTING_DIR" >&2; exit 1; }

for lang in "${LANGS[@]}"; do
  push_text "$lang"
  push_images "$lang"
done

play POST "$PLAY_PUB/edits/$EDIT_ID:commit" '{}' >/dev/null
echo "==> committed — Play Console ▸ 기본 스토어 등록정보에서 확인."
