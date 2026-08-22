/**
 * 사용자 아바타 — 디자인의 `Atom/Avatar`.
 *
 * 이미지를 쓰지 않는다. provider가 준 프로필 사진을 저장·중계하면 개인정보 미저장
 * 원칙이 깨지고(plan/auth.md §7), 원격 이미지를 그대로 걸면 리뷰어의 방문이 provider
 * 쪽에 남는다. 표시 이름에서 뽑은 이니셜로 대신한다 — 이름은 세션 한정 값이라 화면에
 * 그리는 것까지가 끝이다.
 */
export function Avatar({ name }: { name: string }) {
  return (
    <span className="avatar" aria-hidden="true">
      {initials(name)}
    </span>
  );
}

/**
 * 표시 이름 → 최대 두 글자.
 *
 * 라틴 이름은 단어별 첫 글자를 모으고(`Alex Kim` → `AK`), 한글·일본어처럼 띄어쓰기가
 * 없거나 한 글자가 이미 한 단어인 문자는 앞 한 글자만 쓴다 — `정희석`을 `정희`로
 * 자르면 이름이 아니라 다른 단어로 읽힌다. 코드 포인트 단위로 잘라 이모지·서로게이트
 * 쌍이 깨지지 않게 한다.
 */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = [...(words[0] ?? '')];
  if (words.length === 1) return (first[0] ?? '?').toUpperCase();
  const second = [...(words[1] ?? '')];
  // 두 단어여도 CJK면 첫 글자 하나로 충분하다(약자 관습이 없다).
  if (isCjk(first[0])) return (first[0] ?? '?').toUpperCase();
  return `${first[0] ?? ''}${second[0] ?? ''}`.toUpperCase();
}

function isCjk(ch: string | undefined): boolean {
  if (!ch) return false;
  const cp = ch.codePointAt(0) ?? 0;
  return (
    (cp >= 0x3040 && cp <= 0x30ff) || // 히라가나·가타카나
    (cp >= 0x3400 && cp <= 0x9fff) || // 한자
    (cp >= 0xac00 && cp <= 0xd7af) // 한글 음절
  );
}
