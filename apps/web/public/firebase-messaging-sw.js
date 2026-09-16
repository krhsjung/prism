// FCM 웹 푸시의 배경 수신기. **Vite가 손대지 않고 그대로 복사하는 파일이다** —
// classic 워커라 `import.meta.env`를 읽을 수 없다.
//
// 그래서 배포 설정은 **등록할 때 쿼리로 넘긴다**(src/lib/push/registration.ts):
//   navigator.serviceWorker.register('/firebase-messaging-sw.js?apiKey=…')
// 값을 이 파일에 박아 두면 배포마다 다른 값이 레포에 들어온다.
importScripts(
  'https://www.gstatic.com/firebasejs/12.18.0/firebase-app-compat.js',
);
importScripts(
  'https://www.gstatic.com/firebasejs/12.18.0/firebase-messaging-compat.js',
);
// 알림 페이로드의 data 키와 버튼 조합 — 서버 계약에서 생성한 사본이다
// (apps/server의 `pnpm sync:contracts`). 여기 문자열을 손으로 적지 않는다.
importScripts('/push-contract.gen.js');
const { dataKeys: KEY, actionSets: ACTION_SETS } = self.PRISM_PUSH_CONTRACT;

const params = new URL(self.location.href).searchParams;
firebase.initializeApp({
  apiKey: params.get('apiKey'),
  projectId: params.get('projectId'),
  messagingSenderId: params.get('messagingSenderId'),
  appId: params.get('appId'),
});

// 알림 버튼의 **문구는 서버가 보내지 않는다** — 여기서 그린다(plan/push.md §5-13).
// iOS가 등록 시점에 문구를 굳혀야 해서 서버가 언어를 알 수 없고, 그 하나 때문에 서버
// 문구 마스터에 사본을 두면 client.csv와 갈라진다.
//
// 워커는 앱의 i18n 번들을 읽을 수 없으므로(별도 실행 문맥) 세 언어를 여기 담고
// 기기 언어로 고른다. **여기 있는 문구는 client.csv의 push.action_* 과 같은 값이다.**
const ACTION_LABELS = {
  en: { open: 'Open', dismiss: 'Dismiss' },
  ko: { open: '열기', dismiss: '닫기' },
  ja: { open: '開く', dismiss: '閉じる' },
};

function labelsFor(language) {
  const tag = (language || 'en').toLowerCase().split('-')[0];
  return ACTION_LABELS[tag] || ACTION_LABELS.en;
}

// 계약의 조합(`none` · `open` · `open-dismiss`)을 버튼 목록으로 편다. 모르는 값은
// 버튼 없음이다 — 계약이 늘어도 옛 워커가 알림 자체를 떨어뜨리지는 않는다.
function actionsFor(set, language) {
  if (!ACTION_SETS.includes(set) || set === 'none') return [];
  const labels = labelsFor(language);
  const actions = [{ action: 'open', title: labels.open }];
  if (set === 'open-dismiss') {
    actions.push({ action: 'dismiss', title: labels.dismiss });
  }
  return actions;
}

// **알림은 우리가 그린다 — 언제나.**
//
// ⚠️ 이 리스너는 `firebase.messaging()`보다 **먼저** 등록돼야 한다. push 이벤트의
// 리스너는 등록 순서대로 불리므로, SDK가 먼저 등록되면 그쪽이 이미 그린 뒤라
// `stopImmediatePropagation()`이 아무것도 막지 못한다.
//
// SDK에 맡기지 않는 이유는 **탭이 앞에 있을 때 SDK가 알림을 그리지 않기 때문이다.**
// 그때는 페이지의 `onMessage`로 넘기는데, 우리는 그 핸들러를 두지 않았다 — 그래서
// 자기 자신에게 보내 보는 이 앱의 기본 시연에서 아무것도 뜨지 않았다.
// 우리가 늘 그리면 앞/뒤 구분 없이 한 번만 뜬다.
self.addEventListener('push', (event) => {
  let payload;
  try {
    payload = event.data ? event.data.json() : null;
  } catch {
    return;
  }
  const data = (payload && payload.data) || {};
  const notification = (payload && payload.notification) || {};
  // 문구는 **data에서 먼저** 꺼낸다. 서버가 최상위 `notification`을 더는 보내지 않고
  // (Android에 그 블록이 가면 FCM SDK가 대신 그려 버리므로 — plan/push.md §5-20) 웹은
  // `webpush.notification`으로 받는데, FCM이 그것을 이 이벤트의 어느 자리로 펼치는지에
  // 기대지 않는다. 제목·문구는 언제나 data에도 실린다 — 이미지·링크와 같은 이유다.
  const title = data[KEY.TITLE] || notification.title;
  if (!title) return;

  // 언어는 앱이 등록 주소로 넘긴 것을 먼저 쓴다 — 기기 언어와 앱에서 고른 언어는 자주 다르다.
  const actions = actionsFor(
    data[KEY.ACTIONS],
    params.get('locale') || self.navigator.language,
  );
  // SDK가 같은 알림을 또 그리지 않게 한다(위 순서 주석 참고).
  event.stopImmediatePropagation();
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data[KEY.BODY] || notification.body || '',
      // FCM이 공통 notification.image를 웹으로 어떻게 펼치는지에 기대지 않는다 —
      // 서버가 data에도 같은 주소를 넣는다(계약의 PUSH_DATA_KEYS.IMAGE).
      image: data[KEY.IMAGE] || notification.image,
      icon: '/apple-touch-icon.png',
      // 버튼이 있으면 사용자가 고를 때까지 남는다 — 고를 것이 있는데 사라지면 안 된다.
      requireInteraction: actions.length > 0,
      actions,
      data: { link: data[KEY.LINK] },
    }),
  );
});

// 브라우저가 구독을 갈아 끼웠다(만료·키 회전). 세션에 남은 옛 토큰으로는 알림이 오지
// 않는데 목록은 여전히 `Will notify`를 그린다 — 열려 있는 탭에 알려 FCM에서 지금 값을
// 받아 다시 붙이게 한다(lib/push/PushRegistrationProvider.tsx). 탭이 없으면 다음 방문의
// 되살리기가 같은 일을 한다. 문자열은 양쪽에 있다 — 워커는 앱의 모듈을 읽을 수 없다.
//
// **FCM SDK가 토큰을 돌린 뒤에 알린다.** 같은 이벤트에 SDK의 리스너도 걸려 있어 옛 토큰을
// 지우고 새 토큰을 만드는데, 그 전에 탭이 토큰을 받으면 곧 죽을 값을 서버에 붙인다 — 그 뒤
// SDK가 돌려도 아무도 다시 알리지 않는다. SDK의 완료를 직접 기다릴 길은 없으므로, SDK가
// 토큰을 두는 저장소(IndexedDB)의 값이 바뀔 때까지 지켜본 뒤 알린다. 상한 안에서만 —
// 바뀌지 않으면(돌릴 토큰이 없었다) 그때 알린다.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(watchTokenRotation(notifyTabs));
});

function notifyTabs() {
  return self.clients
    .matchAll({ type: 'window', includeUncontrolled: true })
    .then((windows) => {
      for (const client of windows) {
        client.postMessage({ type: 'prism.push.subscriptionchange' });
      }
    });
}

// 돌리기를 지켜보다 알린다. 상한 안에 안 끝나면 일단 알리고 — 탭이 기다리다 지치는 것보다
// 낫다 — **그 뒤에도 더 지켜본다**: SDK가 늦게 돌리면 탭이 방금 붙인 토큰이 죽은 값이 되는데,
// 다시 알리지 않으면 다음 맞추기(탭 복귀·새로고침)까지 서버가 그 값을 든다.
async function watchTokenRotation(notify) {
  const before = await storedToken();
  const rotated = await afterTokenRotation(before);
  await notify();
  if (rotated || before === null || before === '') return;
  // 견주는 기준은 **돌리기 전의 토큰**이다. 알린 뒤에 다시 읽어 기준으로 삼으면, 알리는 사이에
  // 끝난 돌리기가 기준 안으로 흡수돼 다시 알리지 않는다 — 탭은 그 직전에 옛 값을 읽었을 수
  // 있다. 이미 끝나 있었으면 한 번 더 알리는 셈이고, 그것은 맞추기 한 번이라 무해하다.
  for (let i = 0; i < LATE_ROTATION_WAIT_TICKS; i += 1) {
    await sleep(ROTATION_WAIT_TICK_MS);
    const now = await storedToken();
    if (now !== null && now !== '' && now !== before) {
      await notify();
      return;
    }
  }
}

// FCM SDK의 저장소 이름(firebase-messaging의 내부 규약, v8부터 그대로다). 읽기만 한다.
const FCM_DB_NAME = 'firebase-messaging-database';
const FCM_STORE_NAME = 'firebase-messaging-store';
const ROTATION_WAIT_TICKS = 40;
const LATE_ROTATION_WAIT_TICKS = 200;
const ROTATION_WAIT_TICK_MS = 250;

// 돌리기가 끝났는지(true) 상한에 걸렸는지(false)를 답한다.
async function afterTokenRotation(before) {
  // 읽지 못하거나 토큰이 없다 — 지켜볼 것이 없으니 SDK에 한 박자만 양보한다.
  if (before === null || before === '') {
    await sleep(ROTATION_WAIT_TICK_MS * 4);
    return true;
  }
  for (let i = 0; i < ROTATION_WAIT_TICKS; i += 1) {
    await sleep(ROTATION_WAIT_TICK_MS);
    const now = await storedToken();
    // **비어 있는 순간은 끝이 아니다** — SDK는 옛 토큰을 지운 뒤 새 토큰을 받아 넣으므로,
    // 그 사이의 빈 저장소를 완료로 읽으면 탭이 곧 죽을 값을 붙인다. 새 값이 들어와야 끝이다.
    if (now !== null && now !== '' && now !== before) return true;
  }
  return false;
}

// SDK가 **이 앱**에 둔 토큰. 레코드는 `appId`가 키다(firebase-messaging의 내부 규약) — 같은
// 출처에 다른 Firebase 앱의 레코드가 남아 있어도 그것의 변화를 우리 것으로 읽지 않는다.
// 없으면 빈 문자열, 읽지 못하면 null.
function storedToken() {
  return new Promise((resolve) => {
    let request;
    try {
      request = indexedDB.open(FCM_DB_NAME);
    } catch {
      resolve(null);
      return;
    }
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
    // 버전을 주지 않은 `open`도 **없는 DB는 만든다.** 만들면 SDK의 마이그레이션이 "토큰 저장소가
    // 이미 있다"고 가정한 채 돌아 저장소 없는 DB가 남는다 — 만들려는 순간 트랜잭션을 되돌려
    // 없던 그대로 둔다. SDK가 자기 스키마를 스스로 만든다.
    request.onupgradeneeded = () => {
      try {
        request.transaction.abort();
      } catch {
        // 되돌리지 못하면 아래 onsuccess가 빈 값으로 답한다.
      }
      // 빈 문자열 = 토큰 없음. 배열 같은 다른 값을 주면 완료 판정(`now !== before`)이 정체가
      // 다른 값을 "바뀌었다"로 읽어 한 박자 만에 알린다.
      resolve('');
    };
    request.onsuccess = () => {
      const db = request.result;
      try {
        if (!db.objectStoreNames.contains(FCM_STORE_NAME)) {
          db.close();
          resolve('');
          return;
        }
        const one = db
          .transaction(FCM_STORE_NAME, 'readonly')
          .objectStore(FCM_STORE_NAME)
          .get(params.get('appId') || '');
        one.onerror = () => {
          db.close();
          resolve(null);
        };
        one.onsuccess = () => {
          db.close();
          const record = one.result;
          resolve(record && typeof record.token === 'string' ? record.token : '');
        };
      } catch {
        db.close();
        resolve(null);
      }
    };
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 토큰 발급에 필요하다. **리스너 등록 뒤에 부른다** — 위 주석의 순서 문제다.
firebase.messaging();

// 누른 곳에 따라 연다. `dismiss`는 닫기만 하고 아무것도 열지 않는다 —
// 알림을 치우려고 누른 사람에게 창을 띄우면 버튼을 둔 의미가 반대로 뒤집힌다.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  const link = (event.notification.data && event.notification.data.link) || '/';
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windows) => {
        // 이미 열려 있는 탭이 있으면 그것을 쓴다 — 누를 때마다 탭이 하나씩 늘면
        // 알림 셋을 눌러 본 사람에게 창이 셋 남는다.
        for (const client of windows) {
          if (client.url === link && 'focus' in client) return client.focus();
        }
        return self.clients.openWindow(link);
      }),
  );
});

// 갱신된 워커가 **기다리지 않고** 일을 넘겨받는다. 없으면 탭을 전부 닫을 때까지
// 옛 워커가 남아, 고친 내용이 다음 방문에도 반영되지 않는다.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
