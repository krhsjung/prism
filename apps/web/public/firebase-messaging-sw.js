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

function actionsFor(set, language) {
  if (set !== 'open' && set !== 'open-dismiss') return [];
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
  const notification = payload && payload.notification;
  if (!notification) return;

  // SDK가 같은 알림을 또 그리지 않게 한다(위 순서 주석 참고).
  event.stopImmediatePropagation();
  event.waitUntil(
    self.registration.showNotification(notification.title || '', {
      body: notification.body || '',
      // FCM이 공통 notification.image를 웹으로 어떻게 펼치는지에 기대지 않는다 —
      // 서버가 data에도 같은 주소를 넣는다(계약의 PUSH_DATA_KEYS.IMAGE).
      image: data.image || notification.image,
      icon: '/apple-touch-icon.png',
      // 버튼이 있으면 사용자가 고를 때까지 남는다 — 고를 것이 있는데 사라지면 안 된다.
      requireInteraction: data.actions === 'open' || data.actions === 'open-dismiss',
      actions: actionsFor(data.actions, self.navigator.language),
      data: { link: data.link },
    }),
  );
});

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
