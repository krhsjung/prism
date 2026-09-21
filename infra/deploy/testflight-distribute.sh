#!/usr/bin/env bash
# 올라간 TestFlight 빌드를 베타 그룹에 배정한다(필요하면 베타 심사 제출까지).
#
#   ./infra/deploy/testflight-distribute.sh                      # 최신 빌드 → 기본 그룹
#   ./infra/deploy/testflight-distribute.sh --build 3             # 빌드 번호 지정
#   ./infra/deploy/testflight-distribute.sh --group "Public" --group "Internal"
#   ./infra/deploy/testflight-distribute.sh --list                # 앱의 베타 그룹만 보여준다
#
# **외부(External) 그룹에는 새 빌드가 저절로 들어가지 않는다** — 자동 배포 설정은 내부
# 그룹에만 있고, 외부 그룹의 "Automatically notify testers"는 심사 통과 후 알림만 정한다.
# 그래서 업로드할 때마다 이 단계가 필요하고, 그것을 App Store Connect API로 대신한다.
#
# 서명 키가 아니라 **API 키**를 쓰므로 키체인이 필요 없다 — GUI 세션이 아니어도 돈다
# (업로드하는 ios-testflight.sh와 다른 점이다).
set -euo pipefail

BUNDLE_ID="${PRISM_IOS_BUNDLE_ID:-kr.hs.jung.prism}"
API="https://api.appstoreconnect.apple.com/v1"

# ── 자격증명 ──────────────────────────────────────────────────────────────────
# 키 파일은 AuthKey_<KEYID>.p8 라 파일명이 곧 kid다. 디렉터리에 키가 하나면 그것을 쓴다.
ASC_KEY_DIR="${PRISM_ASC_KEY_DIR:-$HOME/certs/apple/app-store-connect-api}"
ASC_KEY="${PRISM_ASC_KEY_PATH:-}"
if [[ -z "$ASC_KEY" ]]; then
  # macOS는 bash 3.2라 mapfile이 없다 — while read로 담는다(공백 없는 경로라 안전하다).
  found=()
  while IFS= read -r line; do found+=("$line"); done < <(find "$ASC_KEY_DIR" -maxdepth 1 -name 'AuthKey_*.p8' 2>/dev/null | sort)
  (( ${#found[@]} == 1 )) || {
    echo "error: expected exactly one AuthKey_*.p8 in $ASC_KEY_DIR (found ${#found[@]}) — set PRISM_ASC_KEY_PATH" >&2
    exit 1
  }
  ASC_KEY="${found[0]}"
fi
[[ -f "$ASC_KEY" ]] || { echo "error: no API key at $ASC_KEY" >&2; exit 1; }
KEY_ID="${PRISM_ASC_KEY_ID:-$(basename "$ASC_KEY" .p8)}"; KEY_ID="${KEY_ID#AuthKey_}"

# Issuer ID는 키 파일에 없다 — App Store Connect ▸ Users and Access ▸ Integrations 의 UUID다.
# env로 주거나 키 옆에 issuer-id 파일로 둔다(둘 다 없으면 여기서 멈춘다).
ISSUER_ID="${PRISM_ASC_ISSUER_ID:-}"
if [[ -z "$ISSUER_ID" && -f "$ASC_KEY_DIR/issuer-id" ]]; then
  ISSUER_ID="$(tr -d '[:space:]' < "$ASC_KEY_DIR/issuer-id")"
fi
[[ -n "$ISSUER_ID" ]] || {
  echo "error: issuer id missing — put it in $ASC_KEY_DIR/issuer-id or set PRISM_ASC_ISSUER_ID." >&2
  echo "       App Store Connect ▸ Users and Access ▸ Integrations ▸ App Store Connect API 의 Issuer ID(UUID)." >&2
  exit 1
}

# ── ES256 JWT ────────────────────────────────────────────────────────────────
# openssl이 내는 서명은 DER(SEQUENCE{r,s})인데 JWS는 고정폭 R||S를 요구한다 — 파이썬
# 표준 라이브러리만으로 옮긴다(이 머신에 cryptography/pyjwt가 없다).
mint_jwt() {
  local now exp header payload signing_input sig
  now=$(date +%s); exp=$((now + 1200))
  b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
  header=$(printf '{"alg":"ES256","kid":"%s","typ":"JWT"}' "$KEY_ID" | b64url)
  payload=$(printf '{"iss":"%s","iat":%s,"exp":%s,"aud":"appstoreconnect-v1"}' "$ISSUER_ID" "$now" "$exp" | b64url)
  signing_input="$header.$payload"
  sig=$(printf '%s' "$signing_input" | openssl dgst -sha256 -sign "$ASC_KEY" | python3 -c '
import sys, base64
der = sys.stdin.buffer.read()
def read_int(b, i):
    assert b[i] == 0x02, "bad DER integer"
    ln = b[i+1]; v = b[i+2:i+2+ln]
    return int.from_bytes(v, "big"), i + 2 + ln
assert der[0] == 0x30, "bad DER sequence"
i = 2 if der[1] < 0x80 else 2 + (der[1] & 0x7f)
r, i = read_int(der, i)
s, _ = read_int(der, i)
raw = r.to_bytes(32, "big") + s.to_bytes(32, "big")
sys.stdout.write(base64.urlsafe_b64encode(raw).decode().rstrip("="))
')
  printf '%s.%s' "$signing_input" "$sig"
}

TOKEN="$(mint_jwt)"

# 실패를 조용히 넘기지 않는다 — API 오류는 본문의 errors[]에 이유가 있다.
asc() {
  local method="$1" path="$2" body="${3:-}" out code
  if [[ -n "$body" ]]; then
    out=$(curl -sS -w $'\n%{http_code}' -X "$method" "$API$path" \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$body")
  else
    out=$(curl -sS -w $'\n%{http_code}' -X "$method" "$API$path" -H "Authorization: Bearer $TOKEN")
  fi
  code="${out##*$'\n'}"; body="${out%$'\n'*}"
  if [[ "$code" != 2* ]]; then
    echo "error: $method $path → HTTP $code" >&2
    echo "$body" | jq -r '.errors[]? | "  \(.title): \(.detail // "")"' >&2 2>/dev/null || echo "$body" >&2
    return 1
  fi
  printf '%s' "$body"
}

# ── 인자 ─────────────────────────────────────────────────────────────────────
BUILD_NUMBER=""; LIST_ONLY=0; # 이름이 BETA_GROUPS인 이유: bash의 `GROUPS`는 **읽기 전용 특수 변수**(사용자가 속한 group id
# 배열)라 대입이 조용히 무시된다 — 그 이름을 쓰면 그룹 이름 대신 "20" 같은 gid를 그룹으로 찾는다.
BETA_GROUPS=(); found=()
while (( $# )); do
  case "$1" in
    --build) BUILD_NUMBER="${2:?--build needs a build number}"; shift 2 ;;
    --group) BETA_GROUPS+=("${2:?--group needs a name}"); shift 2 ;;
    --list) LIST_ONLY=1; shift ;;
    *) echo "unknown option: $1 (--build N | --group NAME | --list)" >&2; exit 2 ;;
  esac
done
# 기본 그룹은 env로 정한다(콤마 구분). 비어 있으면 앱의 **모든** 그룹에 배정한다 —
# 그룹을 만들어 둔 목적이 테스트이고, 빠뜨리는 쪽이 더 흔한 사고다.
if (( ${#BETA_GROUPS[@]} == 0 )) && [[ -n "${PRISM_TESTFLIGHT_GROUPS:-}" ]]; then
  IFS=',' read -r -a BETA_GROUPS <<< "$PRISM_TESTFLIGHT_GROUPS"
fi

# ── 앱 · 그룹 ────────────────────────────────────────────────────────────────
APP_JSON=$(asc GET "/apps?filter%5BbundleId%5D=$BUNDLE_ID&fields%5Bapps%5D=name,bundleId")
APP_ID=$(jq -r '.data[0].id // empty' <<< "$APP_JSON")
[[ -n "$APP_ID" ]] || { echo "error: no app with bundle id $BUNDLE_ID on App Store Connect" >&2; exit 1; }
echo "==> app $(jq -r '.data[0].attributes.name' <<< "$APP_JSON") ($BUNDLE_ID)"

GROUPS_JSON=$(asc GET "/apps/$APP_ID/betaGroups?limit=200&fields%5BbetaGroups%5D=name,isInternalGroup,publicLinkEnabled,publicLink")
if (( LIST_ONLY )); then
  jq -r '.data[] | "    \(.attributes.name)\t\(if .attributes.isInternalGroup then "internal" else "external" end)\t\(.attributes.publicLink // "")"' <<< "$GROUPS_JSON" \
    | column -t -s $'\t'
  exit 0
fi

if (( ${#BETA_GROUPS[@]} == 0 )); then
  while IFS= read -r line; do BETA_GROUPS+=("$line"); done < <(jq -r '.data[].attributes.name' <<< "$GROUPS_JSON")
  (( ${#BETA_GROUPS[@]} )) || { echo "error: the app has no beta groups — create one in App Store Connect first" >&2; exit 1; }
fi

# ── 빌드 고르기 ──────────────────────────────────────────────────────────────
# 최신 = 업로드 순(-uploadedDate). 처리 중이면 배정이 거절되므로 VALID가 될 때까지 기다린다.
if [[ -n "$BUILD_NUMBER" ]]; then
  BUILD_JSON=$(asc GET "/builds?filter%5Bapp%5D=$APP_ID&filter%5Bversion%5D=$BUILD_NUMBER&limit=1&fields%5Bbuilds%5D=version,processingState,expired")
else
  BUILD_JSON=$(asc GET "/builds?filter%5Bapp%5D=$APP_ID&sort=-uploadedDate&limit=1&fields%5Bbuilds%5D=version,processingState,expired")
fi
BUILD_ID=$(jq -r '.data[0].id // empty' <<< "$BUILD_JSON")
[[ -n "$BUILD_ID" ]] || { echo "error: no build found${BUILD_NUMBER:+ with number $BUILD_NUMBER}" >&2; exit 1; }

for attempt in $(seq 1 60); do
  STATE=$(jq -r '.data[0].attributes.processingState' <<< "$BUILD_JSON")
  VERSION=$(jq -r '.data[0].attributes.version' <<< "$BUILD_JSON")
  [[ "$(jq -r '.data[0].attributes.expired' <<< "$BUILD_JSON")" == "false" ]] || { echo "error: build $VERSION has expired" >&2; exit 1; }
  case "$STATE" in
    VALID) break ;;
    PROCESSING)
      echo "    build $VERSION is processing — waiting (attempt $attempt/60)"
      sleep 30
      BUILD_JSON=$(asc GET "/builds/$BUILD_ID?fields%5Bbuilds%5D=version,processingState,expired" | jq '{data:[.data]}')
      ;;
    *) echo "error: build $VERSION is $STATE — cannot distribute" >&2; exit 1 ;;
  esac
done
[[ "$(jq -r '.data[0].attributes.processingState' <<< "$BUILD_JSON")" == "VALID" ]] || { echo "error: build still processing after 30 minutes" >&2; exit 1; }
echo "==> build $VERSION (VALID)"

# ── 그룹에 배정 ──────────────────────────────────────────────────────────────
HAS_EXTERNAL=0
for name in "${BETA_GROUPS[@]}"; do
  gid=$(jq -r --arg n "$name" '.data[] | select(.attributes.name == $n) | .id' <<< "$GROUPS_JSON")
  [[ -n "$gid" ]] || { echo "error: no beta group named '$name' (--list to see them)" >&2; exit 1; }
  internal=$(jq -r --arg n "$name" '.data[] | select(.attributes.name == $n) | .attributes.isInternalGroup' <<< "$GROUPS_JSON")

  # 그룹이 이 빌드를 갖고 있는지는 그룹 쪽에서 본다 —
  # `/builds/{id}/relationships/betaGroups`는 CREATE/DELETE만 허용해 읽을 수 없다.
  present=$(asc GET "/betaGroups/$gid/builds?limit=200&fields%5Bbuilds%5D=version" \
    | jq -r --arg b "$BUILD_ID" '[.data[]? | select(.id == $b)] | length')

  if [[ "$internal" == true ]]; then
    # **내부 그룹에는 배정할 수 없다** — 시도하면 422(Cannot add internal group to a build)다.
    # 자동 배포가 켜진 내부 그룹은 처리가 끝난 빌드를 스스로 받는다. 그래서 여기서는 확인만 한다.
    if (( present )); then
      echo "    $name (internal) — has it (internal groups receive builds automatically)"
    else
      echo "    $name (internal) — not there yet; automatic distribution may be off for this group"
    fi
    continue
  fi

  HAS_EXTERNAL=1
  if (( present )); then
    echo "    $name (external) — already had it"
  else
    # 외부 그룹 배정은 멱등이다(이미 있으면 204). 실패하면 이유가 보여야 하므로 삼키지 않는다.
    asc POST "/builds/$BUILD_ID/relationships/betaGroups" \
      "$(jq -nc --arg id "$gid" '{data:[{type:"betaGroups",id:$id}]}')" >/dev/null
    echo "    $name (external) — added"
  fi
done

# ── 외부 그룹이면 베타 심사 ──────────────────────────────────────────────────
# 같은 마케팅 버전의 후속 빌드는 대개 자동 승인이라 몇 분이면 풀린다.
if (( HAS_EXTERNAL )); then
  EXT_STATE=$(asc GET "/builds/$BUILD_ID/buildBetaDetail?fields%5BbuildBetaDetails%5D=externalBuildState" \
    | jq -r '.data.attributes.externalBuildState')
  case "$EXT_STATE" in
    READY_FOR_BETA_SUBMISSION)
      asc POST "/betaAppReviewSubmissions" \
        "$(jq -nc --arg id "$BUILD_ID" '{data:{type:"betaAppReviewSubmissions",relationships:{build:{data:{type:"builds",id:$id}}}}}')" >/dev/null
      echo "==> submitted for Beta App Review"
      ;;
    *) echo "==> external state: $EXT_STATE (no submission needed)" ;;
  esac
fi
echo "==> done"
