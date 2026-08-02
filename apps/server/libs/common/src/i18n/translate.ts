import { MESSAGES, type Locale, type MessageKey } from './messages.gen';

// 서버가 직접 그리는 문구(HTML 페이지·문서 제목)를 요청 언어로 꺼낸다.
//
// API 오류는 여기를 거치지 않는다 — 서버는 오류 "코드"만 반환하고 문구는 클라이언트가
// 고른다(contracts.ts의 AUTH_ERROR_CODES). 그래야 웹·iOS·Android가 각자의 화면 문맥에
// 맞는 문장을 쓸 수 있고, 서버가 문구를 바꿔도 클라이언트 분기가 깨지지 않는다.
export function translate(locale: Locale, key: MessageKey): string {
  return MESSAGES[locale][key];
}
