// 통화 화면이 새로 쓰는 글리프들.
//
// 24 그리드 · stroke 2 — `design/README.md`가 이미 그렇게 적고 있었고 iOS
// `PrismGlyph.swift`·Android `ic_*.xml`도 24라, 이 슬라이스에서 시안을 그쪽으로
// 맞췄다(plan/webrtc.md §4). 색·굵기는 CSS(`.icon`)가 갖는다.

export function MicIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v4" />
    </svg>
  );
}

export function MicOffIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15 5a3 3 0 0 0-6 0v5" />
      <path d="M9 12v-1" />
      <path d="M5 11a7 7 0 0 0 10.5 6" />
      <path d="M19 11a7 7 0 0 1-.6 2.8" />
      <path d="M12 18v4" />
      {/* 사선은 "지금 꺼져 있다"를 말하는 유일한 획이다 — 굵기를 같게 둔다. */}
      <path d="M3 3l18 18" />
    </svg>
  );
}

export function CameraIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="6" width="14" height="12" rx="2" />
      <path d="m16 11 6-3v8l-6-3z" />
    </svg>
  );
}

export function CameraOffIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6h8a2 2 0 0 1 2 2v3" />
      <path d="M16 14v2a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2" />
      <path d="m16 11 6-3v8l-3-1.5" />
      <path d="M3 3l18 18" />
    </svg>
  );
}

export function PhoneOffIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      {/* 내려놓은 수화기 — 통화 글리프를 45도 돌린 모양이 관습이다. */}
      <path d="M3.5 14.5a16 16 0 0 1 17 0l-.6 2.6a1.6 1.6 0 0 1-1.9 1.2l-2.6-.6a1.6 1.6 0 0 1-1.2-1.4l-.2-1.6a10 10 0 0 0-4 0l-.2 1.6a1.6 1.6 0 0 1-1.2 1.4l-2.6.6a1.6 1.6 0 0 1-1.9-1.2z" />
      <path d="M3 3l18 18" />
    </svg>
  );
}

/** 셰브런은 **펴지는 방향**을 가리킨다(§4) — 접혀 있으면 아래, 펴져 있으면 위. */
export function ChevronIcon({ up = false }: { up?: boolean }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={up ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
    </svg>
  );
}
