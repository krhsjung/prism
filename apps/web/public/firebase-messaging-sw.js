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
firebase.messaging();

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

// 버튼이 있는 알림은 **우리가 그린다.**
//
// FCM SDK의 자동 표시는 `notification` 페이로드만 그리고 버튼을 붙이지 못한다. 그래서
// 버튼이 있을 때만 여기서 가로채 직접 띄운다 — 버튼이 없으면 SDK에 맡긴다(두 번 그리면
// 알림이 두 개 뜬다).
self.addEventListener('push', (event) => {
  let payload;
  try {
    payload = event.data ? event.data.json() : null;
  } catch {
    return;
  }
  const data = payload && payload.data;
  const notification = payload && payload.notification;
  if (!data || !notification) return;
  const actions = actionsFor(data.actions, self.navigator.language);
  if (actions.length === 0) return;

  event.stopImmediatePropagation();
  event.waitUntil(
    self.registration.showNotification(notification.title || '', {
      body: notification.body || '',
      image: notification.image,
      icon: '/apple-touch-icon.png',
      requireInteraction: true,
      actions,
      data: { link: data.link },
    }),
  );
});

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
