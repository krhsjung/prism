// 메시지에 런타임 값을 끼워 넣는다 — `{name}` 형태의 단일 중괄호만 치환한다.
//
// 문장을 조각내 이어 붙이지 않기 위한 최소 장치다. 조각내면 언어마다 어순이 달라
// 번역이 불가능해진다("Signed in as {name}" ↔ "{name} 님으로 로그인했습니다").
// 빌드 시점 변수(`{{platform}}`)는 생성기가 이미 치환했으므로 여기 남아 있지 않다.

export type MessageVars = Readonly<Record<string, string | number>>;

export function interpolate(template: string, vars?: MessageVars): string {
  if (!vars) return template;
  // 이중 중괄호를 먼저 통째로 집어 건너뛴다 — 안쪽만 보면 `{{platform}}`이
  // `{platform}`으로 읽혀 빌드 시점 변수가 런타임에 훼손된다.
  return template.replace(
    /\{\{\w+\}\}|\{(\w+)\}/g,
    (placeholder: string, name?: string) => {
      if (name === undefined) return placeholder;
      // 값이 없는 자리는 그대로 둔다 — 빈칸으로 삼키면 번역 실수가 화면에서 사라진다.
      const value = vars[name];
      return value === undefined ? placeholder : String(value);
    },
  );
}
