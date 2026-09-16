// GENERATED FILE — DO NOT EDIT.
// 원본: apps/server/libs/common/src/types/contracts.ts
// 재생성: apps/server에서 `pnpm sync:contracts`
//
// 서비스 워커(firebase-messaging-sw.js)가 importScripts로 읽는다 — 워커는 모듈을
// import할 수 없어 사본이 필요한데, 손으로 베끼면 언젠가 하나만 어긋난다.
self.PRISM_PUSH_CONTRACT = Object.freeze({
  dataKeys: Object.freeze({
    KIND: 'kind',
    CALL_ID: 'callId',
    DEVICE: 'device',
    LINK: 'link',
    ACTIONS: 'actions',
    IMAGE: 'image',
    TITLE: 'title',
    BODY: 'body',
  }),
  actionSets: Object.freeze(['none', 'open', 'open-dismiss']),
});
