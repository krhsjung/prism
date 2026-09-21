#!/usr/bin/env bash
# Play 스토어 등록정보용 이미지를 앱 아이콘에서 만들어 낸다(디자인 원천은 Figma → 앱 아이콘).
#   ./generate.sh
# 만드는 것: icon.png(512x512) · feature-graphic.png(1024x500).
# 스크린샷은 여기서 만들지 않는다 — 실제 화면이라 에뮬레이터에서 찍는다(capture-screenshots.sh).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
ROOT="$(cd ../../../../.. && pwd)"
SRC="$ROOT/apps/ios/prism/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png"
[[ -f "$SRC" ]] || { echo "error: no source icon at $SRC" >&2; exit 1; }

# 아이콘: Play는 512x512 32비트 PNG를 요구한다.
sips -z 512 512 "$SRC" --out icon.png >/dev/null
echo "icon.png            $(sips -g pixelWidth -g pixelHeight icon.png | tr -d ' \n' | sed 's/.*pixelWidth:/ /;s/pixelHeight:/x/')"

# 그래픽 이미지: 1024x500. 아이콘 타일을 왼쪽에 놓고 오른쪽에 이름을 둔다.
# 배경은 앱 아이콘과 같은 감청 그라데이션(--color-primary 계열)이고, **알파가 없어야** 한다.
ICON_B64=$(openssl base64 -A -in icon.png)
cat > /tmp/prism-feature.svg <<SVG
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1024" height="500">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#22314d"/>
      <stop offset="100%" stop-color="#16233a"/>
    </linearGradient>
    <clipPath id="tile"><rect x="88" y="130" width="240" height="240" rx="54"/></clipPath>
  </defs>
  <rect width="1024" height="500" fill="url(#bg)"/>
  <image x="88" y="130" width="240" height="240" clip-path="url(#tile)"
         xlink:href="data:image/png;base64,$ICON_B64"/>
  <text x="392" y="248" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
        font-size="86" font-weight="700" fill="#ffffff" letter-spacing="-1">Prism</text>
  <text x="394" y="306" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
        font-size="30" font-weight="400" fill="#aebbd2">Your signed-in devices, in one list</text>
</svg>
SVG
rsvg-convert -w 1024 -h 500 -b '#16233a' /tmp/prism-feature.svg -o feature-graphic.png
rm -f /tmp/prism-feature.svg
echo "feature-graphic.png $(sips -g pixelWidth -g pixelHeight feature-graphic.png | tr -d ' \n' | sed 's/.*pixelWidth:/ /;s/pixelHeight:/x/')"
