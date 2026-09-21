# play-api.sh — Google Play Developer API 호출 공통부. 실행 파일이 아니라 `source` 한다.
#
# 쓰는 쪽에 주는 것:
#   PLAY_TOKEN            OAuth 액세스 토큰
#   PLAY_PUB · PLAY_UPLOAD  앱 기준 URL(일반/업로드)
#   play <METHOD> <URL> [BODY] [CONTENT_TYPE]   호출 헬퍼(2xx가 아니면 이유를 찍고 실패)
#
# 자격증명은 서비스 계정 JSON 키다(infra/deploy/README.md "업로드 자동화"). 서명 키가
# 아니므로 키체인이 필요 없고 어느 셸에서나 돈다.
PRISM_ANDROID_PACKAGE="${PRISM_ANDROID_PACKAGE:-kr.hs.jung.prism}"
PLAY_PUB="https://androidpublisher.googleapis.com/androidpublisher/v3/applications/$PRISM_ANDROID_PACKAGE"
PLAY_UPLOAD="https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/$PRISM_ANDROID_PACKAGE"

play_authenticate() {
  local sa_key pem client_email token_uri now exp h p s
  sa_key="${PRISM_PLAY_SERVICE_ACCOUNT:-$HOME/certs/google/play-service-account.json}"
  [[ -f "$sa_key" ]] || {
    echo "error: no Play service account key at $sa_key (set PRISM_PLAY_SERVICE_ACCOUNT)." >&2
    echo "       Google Cloud ▸ IAM ▸ 서비스 계정에서 JSON 키를 만들고, Play Console ▸ 사용자 및 권한에서" >&2
    echo "       그 계정을 초대해 릴리스 권한을 준다(infra/deploy/README.md 참고)." >&2
    return 1
  }
  # 비공개 키는 파일로 잠깐 꺼냈다가 반드시 지운다(openssl이 파일을 요구한다).
  pem="$(mktemp)"; chmod 600 "$pem"
  jq -r '.private_key' "$sa_key" > "$pem"
  client_email="$(jq -r '.client_email' "$sa_key")"
  token_uri="$(jq -r '.token_uri // "https://oauth2.googleapis.com/token"' "$sa_key")"
  [[ -s "$pem" && -n "$client_email" ]] || { rm -f "$pem"; echo "error: $sa_key is not a service account key" >&2; return 1; }

  play_b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
  now=$(date +%s); exp=$((now + 3600))
  # RS256이라 서명이 그대로 들어간다 — ES256(App Store Connect)처럼 DER을 풀 필요가 없다.
  h=$(printf '{"alg":"RS256","typ":"JWT"}' | play_b64url)
  p=$(printf '{"iss":"%s","scope":"https://www.googleapis.com/auth/androidpublisher","aud":"%s","iat":%s,"exp":%s}' \
    "$client_email" "$token_uri" "$now" "$exp" | play_b64url)
  s=$(printf '%s' "$h.$p" | openssl dgst -sha256 -sign "$pem" | play_b64url)
  rm -f "$pem"
  PLAY_TOKEN=$(curl -sS -X POST "$token_uri" \
    --data-urlencode 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer' \
    --data-urlencode "assertion=$h.$p.$s" | jq -r '.access_token // empty')
  [[ -n "$PLAY_TOKEN" ]] || {
    echo "error: could not get an access token for $client_email — is the Google Play Android Developer API enabled for its project?" >&2
    return 1
  }
}

# 실패를 삼키지 않는다 — Play API의 이유는 본문 error.message에 있다.
play() {
  local method="$1" url="$2" body="${3:-}" ctype="${4:-application/json}" out code
  if [[ -n "$body" && "$ctype" == application/json ]]; then
    out=$(curl -sS -w $'\n%{http_code}' -X "$method" "$url" \
      -H "Authorization: Bearer $PLAY_TOKEN" -H "Content-Type: $ctype" -d "$body")
  elif [[ -n "$body" ]]; then
    out=$(curl -sS -w $'\n%{http_code}' -X "$method" "$url" \
      -H "Authorization: Bearer $PLAY_TOKEN" -H "Content-Type: $ctype" --data-binary "@$body")
  else
    out=$(curl -sS -w $'\n%{http_code}' -X "$method" "$url" -H "Authorization: Bearer $PLAY_TOKEN")
  fi
  code="${out##*$'\n'}"; body="${out%$'\n'*}"
  if [[ "$code" != 2* ]]; then
    echo "error: $method ${url#https://androidpublisher.googleapis.com} → HTTP $code" >&2
    jq -r '.error.message // .' <<< "$body" 2>/dev/null | sed 's/^/  /' >&2
    return 1
  fi
  printf '%s' "$body"
}
