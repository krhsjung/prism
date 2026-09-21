#!/usr/bin/env bash
# 서명된 AAB를 Google Play의 테스트 트랙에 올린다(기본: internal = 내부 테스트).
#
#   ./infra/deploy/android-play-upload.sh                    # 최신 AAB → internal 트랙
#   ./infra/deploy/android-play-upload.sh --track alpha       # 비공개(closed) 테스트
#   ./infra/deploy/android-play-upload.sh --aab <경로> --notes-dir <디렉터리>
#   ./infra/deploy/android-play-upload.sh --list              # 트랙과 올라간 버전만 보여준다
#
# iOS의 testflight-distribute.sh와 같은 자리다 — 서명 키가 아니라 **API 자격증명**만 쓰므로
# 키체인이 필요 없고 어느 셸에서나 돈다. AAB를 만드는 것은 android-bundle.sh다.
#
# 자격증명: Google Cloud **서비스 계정 JSON 키**. Play Console에서 그 계정에 앱 권한을
# 주어야 한다(infra/deploy/README.md "Android — Play 내부 테스트"의 준비 표).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

PACKAGE="${PRISM_ANDROID_PACKAGE:-kr.hs.jung.prism}"
PUB="https://androidpublisher.googleapis.com/androidpublisher/v3/applications/$PACKAGE"
UPLOAD="https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/$PACKAGE"

# 트랙 이름은 Play의 것을 그대로 쓴다: internal=내부, alpha=비공개, beta=공개, production=프로덕션.
TRACK="internal"; AAB=""; NOTES_DIR=""; LIST_ONLY=0; PROMOTE=""; STATUS="completed"
while (( $# )); do
  case "$1" in
    --track) TRACK="${2:?--track needs a name (internal|alpha|beta|production)}"; shift 2 ;;
    --aab) AAB="${2:?--aab needs a path}"; shift 2 ;;
    --notes-dir) NOTES_DIR="${2:?--notes-dir needs a path}"; shift 2 ;;
    --promote) PROMOTE="${2:?--promote needs a versionCode}"; shift 2 ;;
    --draft) STATUS="draft"; shift ;;
    --list) LIST_ONLY=1; shift ;;
    *) echo "unknown option: $1 (--track | --aab | --notes-dir | --promote | --list)" >&2; exit 2 ;;
  esac
done

# ── 자격증명 → 액세스 토큰 ───────────────────────────────────────────────────
SA_KEY="${PRISM_PLAY_SERVICE_ACCOUNT:-$HOME/certs/google/play-service-account.json}"
[[ -f "$SA_KEY" ]] || {
  echo "error: no Play service account key at $SA_KEY (set PRISM_PLAY_SERVICE_ACCOUNT)." >&2
  echo "       Google Cloud ▸ IAM ▸ 서비스 계정에서 JSON 키를 만들고, Play Console ▸ 사용자 및 권한에서" >&2
  echo "       그 계정에 이 앱의 릴리스 권한을 준다(infra/deploy/README.md 참고)." >&2
  exit 1
}

# 비공개 키는 파일로 잠깐 꺼냈다가 반드시 지운다(openssl이 파일을 요구한다).
PEM="$(mktemp)"; chmod 600 "$PEM"
trap 'rm -f "$PEM"' EXIT
jq -r '.private_key' "$SA_KEY" > "$PEM"
CLIENT_EMAIL="$(jq -r '.client_email' "$SA_KEY")"
TOKEN_URI="$(jq -r '.token_uri // "https://oauth2.googleapis.com/token"' "$SA_KEY")"
[[ -s "$PEM" && -n "$CLIENT_EMAIL" ]] || { echo "error: $SA_KEY is not a service account key (no private_key/client_email)" >&2; exit 1; }

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
now=$(date +%s); exp=$((now + 3600))
# RS256이라 서명이 그대로 들어간다 — ES256(App Store Connect)처럼 DER을 풀 필요가 없다.
JWT_H=$(printf '{"alg":"RS256","typ":"JWT"}' | b64url)
JWT_P=$(printf '{"iss":"%s","scope":"https://www.googleapis.com/auth/androidpublisher","aud":"%s","iat":%s,"exp":%s}' \
  "$CLIENT_EMAIL" "$TOKEN_URI" "$now" "$exp" | b64url)
JWT_S=$(printf '%s' "$JWT_H.$JWT_P" | openssl dgst -sha256 -sign "$PEM" | b64url)
TOKEN=$(curl -sS -X POST "$TOKEN_URI" \
  --data-urlencode 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer' \
  --data-urlencode "assertion=$JWT_H.$JWT_P.$JWT_S" | jq -r '.access_token // empty')
rm -f "$PEM"; trap - EXIT
[[ -n "$TOKEN" ]] || { echo "error: could not get an access token for $CLIENT_EMAIL — is the Google Play Android Developer API enabled for its project?" >&2; exit 1; }

# 실패를 삼키지 않는다 — Play API의 이유는 본문 error.message에 있다.
play() {
  local method="$1" url="$2" body="${3:-}" ctype="${4:-application/json}" out code
  if [[ -n "$body" && "$ctype" == application/json ]]; then
    out=$(curl -sS -w $'\n%{http_code}' -X "$method" "$url" \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: $ctype" -d "$body")
  elif [[ -n "$body" ]]; then
    out=$(curl -sS -w $'\n%{http_code}' -X "$method" "$url" \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: $ctype" --data-binary "@$body")
  else
    out=$(curl -sS -w $'\n%{http_code}' -X "$method" "$url" -H "Authorization: Bearer $TOKEN")
  fi
  code="${out##*$'\n'}"; body="${out%$'\n'*}"
  if [[ "$code" != 2* ]]; then
    echo "error: $method ${url#https://androidpublisher.googleapis.com} → HTTP $code" >&2
    jq -r '.error.message // .' <<< "$body" 2>/dev/null | sed 's/^/  /' >&2
    return 1
  fi
  printf '%s' "$body"
}

# ── 편집 세션 ────────────────────────────────────────────────────────────────
# Play는 모든 변경을 edit 안에서 모았다가 commit할 때 한꺼번에 반영한다. 중간에 죽으면
# 그 edit은 버려지므로(커밋 전에는 아무 영향이 없다) 따로 정리할 것이 없다.
EDIT_ID=$(play POST "$PUB/edits" '{}' | jq -r '.id')
echo "==> edit $EDIT_ID ($PACKAGE)"

if (( LIST_ONLY )); then
  play GET "$PUB/edits/$EDIT_ID/tracks" \
    | jq -r '.tracks[] | "    \(.track)\t\([.releases[]? | "\(.status) \(.versionCodes // [] | join(","))"] | join(" · "))"' \
    | column -t -s $'\t'
  play DELETE "$PUB/edits/$EDIT_ID" >/dev/null || true
  exit 0
fi

# ── AAB ──────────────────────────────────────────────────────────────────────
if [[ -n "$PROMOTE" ]]; then
  # 이미 올라간 빌드를 다른 트랙으로 **승격**한다. 같은 AAB를 다시 올릴 수는 없다 —
  # Play는 한 번 쓴 versionCode를 영구히 기억하고 재사용을 거절한다.
  VERSION_CODE="$PROMOTE"
  play GET "$PUB/edits/$EDIT_ID/bundles" \
    | jq -e --arg v "$VERSION_CODE" '[.bundles[]? | select(.versionCode == ($v|tonumber))] | length > 0' >/dev/null \
    || { echo "error: versionCode $VERSION_CODE has not been uploaded to this app" >&2; exit 1; }
  echo "==> promoting existing versionCode $VERSION_CODE"
else
  [[ -n "$AAB" ]] || AAB="$ROOT/apps/android/app/build/outputs/bundle/release/app-release.aab"
  [[ -f "$AAB" ]] || { echo "error: no AAB at $AAB — run ./infra/deploy/android-bundle.sh first" >&2; exit 1; }
  # 서명되지 않은 번들은 Play가 받아 주지 않는다. 올리기 전에 여기서 걸러 낸다.
  jarsigner -verify "$AAB" | grep -q "jar verified" || { echo "error: $AAB is not signed" >&2; exit 1; }

  echo "==> uploading $(basename "$AAB") ($(du -h "$AAB" | cut -f1))"
  BUNDLE=$(play POST "$UPLOAD/edits/$EDIT_ID/bundles?uploadType=media" "$AAB" "application/octet-stream")
  VERSION_CODE=$(jq -r '.versionCode' <<< "$BUNDLE")
  echo "    versionCode $VERSION_CODE"
fi

# ── 출시 노트 ────────────────────────────────────────────────────────────────
# <언어>.txt 파일 하나가 한 언어다(ko-KR.txt · en-US.txt …). 없으면 노트 없이 올린다.
# 릴리스마다 내용을 갱신할 것 — 스크립트가 보낼 내용을 그대로 출력하는 이유다.
[[ -n "$NOTES_DIR" ]] || NOTES_DIR="$ROOT/infra/deploy/release-notes/android"
NOTES_JSON='[]'
if [[ -d "$NOTES_DIR" ]]; then
  for f in "$NOTES_DIR"/*.txt; do
    [[ -e "$f" ]] || continue
    lang="$(basename "$f" .txt)"
    # 상한은 **바이트가 아니라 글자**다(한글·일본어는 바이트가 훨씬 크다).
    chars=$(wc -m < "$f" | tr -d ' ')
    (( chars <= 500 )) || { echo "error: $f is $chars characters — Play allows 500 per language" >&2; exit 1; }
    NOTES_JSON=$(jq --arg l "$lang" --rawfile t "$f" '. + [{language:$l, text:$t}]' <<< "$NOTES_JSON")
    echo "    notes $lang ($chars chars)"
  done
fi

echo "==> assigning to track '$TRACK'"
play PUT "$PUB/edits/$EDIT_ID/tracks/$TRACK" \
  "$(jq -nc --arg t "$TRACK" --arg v "$VERSION_CODE" --argjson n "$NOTES_JSON" \
     --arg st "$STATUS" \
     '{track:$t, releases:[{versionCodes:[$v], status:$st} + (if ($n|length)>0 then {releaseNotes:$n} else {} end)]}')" >/dev/null

# **초안 앱에서는 internal 말고는 정식(completed) 릴리스를 만들 수 없다** — 커밋이
# "Only releases with status draft may be created on draft app"으로 거절된다. 앱이 한 번도
# 게시된 적이 없기 때문이고, 스토어 등록정보·앱 콘텐츠 설문을 채워 첫 게시를 해야 풀린다.
# 그때까지는 --draft 로 빌드만 트랙에 걸어 둘 수 있다.
if ! play POST "$PUB/edits/$EDIT_ID:commit" '{}' >/dev/null; then
  if [[ "$STATUS" == completed && "$TRACK" != internal ]]; then
    echo "hint: 앱이 아직 Play 초안 상태라면 --draft 로 걸어 두거나, Play Console에서 스토어" >&2
    echo "      등록정보·앱 콘텐츠를 채워 첫 게시를 마쳐야 이 트랙이 열린다." >&2
  fi
  exit 1
fi
echo "==> committed ($STATUS) — Play Console ▸ 테스트 ▸ $TRACK 에서 확인."
