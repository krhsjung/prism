import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api } from '../api';
import { useAuth } from '../auth-context';
import { I18nContext } from '../i18n/i18n-context';
import { useSessions } from '../sessions-context';
import { PushRegistrationContext, type PushRegistrationValue } from './push-registration-context';
import {
  PUSH_WANTED_KEY,
  beginIntent,
  currentPermission,
  disablePending,
  ensureOwner,
  intentIs,
  pushSupported,
  pushWanted,
  rememberDisablePending,
  rememberPushWanted,
  requestPermissionAndToken,
  syncWorkerLocale,
  type PushPermission,
  settleIntent,
  currentIntent,
  currentIntentDirection,
} from './registration';

// 서비스 워커가 구독 변경(`pushsubscriptionchange`)을 알려 올 때 쓰는 메시지.
// 워커는 앱의 모듈을 읽을 수 없어 문자열이 양쪽에 있다(firebase-messaging-sw.js).
const SUBSCRIPTION_CHANGED = 'prism.push.subscriptionchange';

/**
 * 이 기기의 알림 등록을 **앱에 하나만** 둔다 — 등록의 수명을 갖는 자리다.
 *
 * 등록은 세션에 붙으므로 로그아웃과 함께 사라진다(plan/push.md §5-2). 그래서 로그인할
 * 때마다 기기에 남긴 선택(`pushWanted`)대로 조용히 다시 붙여야 하고(§5-16), 권한이
 * 밖(브라우저·OS 설정)에서 꺼지면 서버의 등록도 떼어 내야 하며, FCM이 토큰을 돌리면
 * 새 값을 다시 붙여야 한다. 셋 다 "지금 상태와 있어야 할 상태를 맞추는 일"이라
 * 한 함수(`reconcile`)로 두고, 그것을 부르는 계기만 여럿이다 — 로그인 · 목록 도착 ·
 * 탭 복귀 · 워커의 구독 변경.
 *
 * **한 번에 하나만 돈다.** 되살리기와 화면의 켜기·끄기가 각자 출발하면 늦게 끝난 쪽이
 * 먼저 끝난 쪽을 조용히 덮는다 — "끄기" 뒤에 옛 등록 요청이 끝나 토큰이 되살아나는
 * 식이다. 그래서 모든 일을 한 줄로 세우고, 사용자가 바뀌면(세대) 진행 중이던 일의
 * 결과를 버린다.
 *
 * ⚠️ **`SessionsProvider` 안쪽에 선다.** 붙이고 나면 목록을 다시 받아야 하는데, 목록은
 * 그쪽이 쥔다. 등록이 목록 조회와 나란히 출발해 거의 항상 늦게 끝나므로, 다시 받지
 * 않으면 화면이 쥔 목록에 `pushRegistered: false`가 남아 켜 둔 기기가 **꺼진 것처럼**
 * 보인다.
 */
export function PushRegistrationProvider({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const { sessions, refresh, notifyChanged } = useSessions();
  const userId = state.status === 'authenticated' ? state.user.id : null;

  const [permission, setPermission] = useState<PushPermission>(currentPermission);
  // FCM이 이 브라우저를 지원하는가. **`null`은 "아직 안 봤다"**이고 어떤 갈래도 아니다.
  const [fcmSupported, setFcmSupported] = useState<boolean | null>(null);
  const effective: PushPermission = fcmSupported === false ? 'unsupported' : permission;

  // 지금 세션의 줄. 목록이 아직 없으면 undefined — 그때는 맞출 것이 없고, 목록이 오면
  // 아래 효과가 다시 부른다.
  const current = sessions?.find((session) => session.isCurrent);

  // 큐 안의 일은 **ref로 읽는다** — 줄을 서는 동안 상태가 바뀔 수 있고, 클로저에 잡힌
  // 값은 그 순간의 것이다. 렌더 뒤에 맞춘다(렌더 중에 ref를 쓰지 않는다) — 큐의 일은
  // 언제나 그보다 늦게(마이크로태스크 뒤에) 돌므로 최신 값을 본다.
  const currentRef = useRef(current);
  const permissionRef = useRef(effective);
  const userRef = useRef(userId);
  useEffect(() => {
    currentRef.current = current;
    permissionRef.current = effective;
    userRef.current = userId;
  });

  // 한 줄로 세운 일들. 앞의 일이 끝나야 다음이 시작된다.
  const queue = useRef<Promise<void>>(Promise.resolve());
  // 세대 — 사용자가 바뀔 때마다 오른다. 큐 안의 일은 시작할 때의 세대를 기억했다가
  // 매 await 뒤에 대조하고, 달라졌으면 결과를 버린다(앞 세션의 등록이 다음 세션에
  // 붙지 못하게).
  const generation = useRef(0);
  // 마지막으로 서버에 붙인 토큰. **회전을 알아채는 기준**이다 — 같은 값을 다시 붙이는
  // 왕복을 아끼고, 다른 값이면 FCM이 토큰을 돌린 것이다.
  const registeredToken = useRef<string | null>(null);
  // 마지막으로 본 "내 줄"의 id — 같은 사람의 다른 세션을 알아채는 기준(아래 효과).
  const seenCurrentId = useRef<string | undefined>(undefined);

  const run = useCallback((task: (generation: number) => Promise<void>) => {
    const started = generation.current;
    const next = queue.current
      .then(() => {
        // 줄을 서는 동안 사용자가 바뀌었다 — 앞 세션의 일을 새 세션의 자격증명으로
        // 보내면 안 된다(끄기가 다음 사람의 등록을 떼는 식). 시작조차 하지 않는다.
        if (started !== generation.current) return;
        return task(started);
      })
      .catch(() => {
        // 실패해도 줄은 계속 선다 — 화면은 목록으로 사실을 말한다.
      });
    queue.current = next;
    return next;
  }, []);

  // 토큰을 서버에 붙이고 목록과 다른 기기에 알린다. **응답의 `registered`를 본다** —
  // 서버는 그사이 그 세션이 사라졌거나 남의 것이면 던지지 않고 `{ registered: false }`를
  // 돌려준다. 던지지 않았다고 붙은 것이 아니고, 거기서 알리면 안 일어난 일을 알리는
  // 셈이다.
  const attach = useCallback(
    async (token: string, started: number): Promise<boolean> => {
      if (started !== generation.current) return false;
      const { registered } = await api.registerPush(token);
      if (started !== generation.current || !registered) return false;
      registeredToken.current = token;
      // 내 목록과 다른 기기의 목록이 함께 알아야 한다 — **스윕이 메워 주지 않는다**
      // (세션 id 목록만 대조한다). 목록을 기다리는 사이 세션이 바뀌었으면 알리지도 않는다.
      await refresh(true);
      if (started !== generation.current) return false;
      notifyChanged();
      return true;
    },
    [refresh, notifyChanged],
  );

  // 서버에서 뗀다 — 알리기(`announce`)와 갈라 둔다: 끄다 만 것을 이어서 뗄 때는 뗀 **직후**에
  // 다른 탭이 그사이 켜기에 성공했는지 봐야 한다(네이티브의 `unregister`와 같은 자리).
  const unregister = useCallback(async (started: number): Promise<boolean> => {
    if (started !== generation.current) return false;
    await api.unregisterPush();
    if (started !== generation.current) return false;
    registeredToken.current = null;
    return true;
  }, []);

  // 목록과 다른 기기에 알린다. 떼는 쪽이 더 중요하다 — 낡은 값은 "이 기기는 알림으로 깨울 수
  // 있다"는 거짓이 된다.
  const announce = useCallback(
    async (started: number): Promise<boolean> => {
      await refresh(true);
      if (started !== generation.current) return false;
      notifyChanged();
      return true;
    },
    [refresh, notifyChanged],
  );

  const detach = useCallback(
    async (started: number): Promise<boolean> =>
      (await unregister(started)) && (await announce(started)),
    [unregister, announce],
  );

  // 지금 상태와 있어야 할 상태를 맞춘다.
  //
  //  - 받을 수 없는데(권한 없음·미지원) 등록돼 있다 → 뗀다. **선택은 건드리지 않는다**:
  //    사람이 끈 것이 아니라 받을 수 없게 된 것이다 — 권한이 돌아오면 그대로 살아난다
  //  - 받을 수 있고 켜 뒀는데 이번 로그인에서 아직 안 붙였거나 토큰이 바뀌었다 → 붙인다.
  //    권한이 이미 `granted`라 `requestPermission()`은 묻지 않고 곧바로 돌아온다 —
  //    진입만으로 묻지 않는다는 규칙(plan/webrtc.md §7)은 지켜진다
  //
  // 목록이 아직 없어도 붙이는 쪽은 간다 — 로그인 직후가 그 순간이고, 목록을 기다리면
  // 그만큼 늦게 붙는다. 떼는 쪽은 목록이 있어야 한다(등록돼 있는지를 목록만 안다).
  const reconcile = useCallback(
    () =>
      run(async (started) => {
        if (!userRef.current) return;
        // 끄다 만 것 — 떼는 도중 창이 닫혔거나 떼지 못했다(그때 선택은 켜진 채로 되돌렸다).
        // 권한·선택·목록과 무관하게 **먼저** 이어서 뗀다 — 등록이 없어도 떼기는 무해하다.
        // 성공하면 그때 선택이 꺼진다(네이티브와 같은 규칙).
        if (disablePending()) {
          if (!(await unregister(started))) return;
          // 떼는 사이 다른 탭이 켜기에 성공해 표식을 지웠으면 이 끄기는 **뒤집힌 것**이다 —
          // 선택을 덮지 않는다(덮으면 그 탭의 다음 맞추기가 방금 붙인 것을 뗀다). 서버에서는
          // 이미 뗐으므로 그 탭의 목록이 "꺼짐"을 말하고 켜기 버튼이 다시 선다.
          if (disablePending()) {
            rememberPushWanted(false);
            rememberDisablePending(false);
            // 이어서 뗀 것도 끄기의 성공이다 — 뜻을 매듭짓는다. 아니면 이 끄기를 시작한 다른 탭의
            // 요청이 나중에 실패했을 때 표식이 아직 그쪽 것이라 선택을 켜 놓고, 이 탭이 그 신호에
            // 다시 붙인다.
            settleIntent('off');
          }
          await announce(started);
          return;
        }
        const registered = currentRef.current?.pushRegistered === true;
        if (permissionRef.current !== 'granted') {
          if (registered) await detach(started);
          return;
        }
        if (!pushWanted()) {
          // 껐는데 **이 탭이 붙인** 등록이 남아 있다 — 다른 탭이 끄는 사이 이 탭의
          // 되살리기가 붙였을 수 있다. 뗀다(다른 탭이 이미 뗐어도 한 번 더는 무해하다).
          // 이 탭이 붙이지 않은 등록은 건드리지 않는다(끄다 만 것은 위에서 먼저 뗐다).
          if (registered && registeredToken.current !== null) await detach(started);
          return;
        }
        const token = await requestPermissionAndToken();
        if (started !== generation.current || !token) return;
        // **선택을 다시 읽는다.** 탭은 각자 줄을 서지만 선택은 브라우저에 하나다 — 토큰을
        // 받는 사이에 다른 탭이 껐으면, 여기서 붙이는 것이 그 끄기를 되돌리는 셈이다.
        if (!pushWanted()) return;
        // 이번 로그인에서 이미 이 토큰을 붙였다 — 목록이 아직 그 사실을 모를 뿐이다.
        if (registeredToken.current === token) return;
        // 자동으로 붙인 것도 켜기의 **성공**이다 — 다른 탭의 켜기가 "켜짐"을 남겨 이 맞추기를
        // 불렀는데 그쪽 요청이 실패하면, 그 탭이 선택을 되돌리고 이 탭이 방금 붙인 것을 뗀다.
        // 그래서 성공하면 뜻을 매듭짓고, 붙이는 사이 아무도 새 뜻을 세우지 않았으면(그 탭의
        // 되돌림이 이미 왔을 수 있다) 선택을 다시 남긴다. 새 뜻이 섰으면 그쪽이 더 최근이다.
        const seen = currentIntent();
        if (!(await attach(token, started))) return;
        // 새 뜻이 섰어도 **같은 방향(켜기)**이면 다시 남긴다 — 그 켜기가 먼저 실패해 선택을
        // 되돌렸을 수 있고, 둘 다 켜자는 뜻이다. 반대 방향(끄기)만 그쪽이 더 최근이다.
        if (currentIntent() === seen || currentIntentDirection() === 'on') {
          rememberPushWanted(true);
        }
        settleIntent('on');
      }),
    [run, attach, detach, unregister, announce],
  );

  // 화면의 `알림 켜기` — 권한과 등록을 함께 끝낸다. 예전에는 토큰이 로그인 요청에만
  // 실려서 여기서 권한을 켜도 그 세션은 재로그인 전까지 대상이 아니었다(§5-2를 뒤집었다).
  const enable = useCallback(
    () =>
      run(async (started) => {
        const token = await requestPermissionAndToken();
        setPermission(currentPermission());
        if (started !== generation.current || !token) return;
        // 선택은 **붙이기 전에** 남긴다(§5-16) — 그래야 그사이 다른 탭이 "꺼져 있다"고
        // 읽고 방금 붙인 등록을 떼지 않는다. 붙이지 못하면 되돌린다: 실패했는데 선택만
        // 남기면 화면은 `Notifications off`를 말하면서 다음 로그인에 조용히 켜진다.
        // 되돌리는 것은 **이 뜻이 아직 마지막일 때만** — 그사이 다른 탭이 켜기·끄기를 세웠으면
        // 그 탭의 성공을 이 탭의 실패가 뒤집게 된다.
        const intent = beginIntent('on');
        rememberPushWanted(true);
        // 던진 실패(네트워크·409)도 실패다 — 되돌리지 않고 새면 선택만 켜진 채 남는다.
        let attached = false;
        try {
          attached = await attach(token, started);
        } finally {
          // 붙는 데 성공한 켜기는 **선택을 다시 남기고** 끄다 만 것을 덮고 뜻을 매듭짓는다.
          // 다시 남기는 이유: 이보다 늦게 시작한 다른 탭의 켜기가 **먼저** 실패해 선택을 되돌렸을
          // 수 있다(그때는 그쪽 표식이 마지막이었다) — 성공이 그 되돌림을 바로잡는다. 매듭짓는
          // 이유: 그 실패가 **나중에** 오면 표식이 바뀌어 되돌리지 않는다.
          if (attached) {
            // 그사이 반대 방향(끄기)의 새 뜻이 섰으면 그쪽이 더 최근이라 선택은 그대로 둔다.
            if (intentIs(intent) || currentIntentDirection() === 'on') {
              rememberPushWanted(true);
            }
            rememberDisablePending(false);
            settleIntent('on');
          } else if (started === generation.current && intentIs(intent)) {
            rememberPushWanted(false);
          }
        }
      }),
    [run, attach],
  );

  // 화면의 `알림 끄기` — 끄는 것은 등록이지 권한이 아니다(§5-15). 기기의 토큰은 그대로
  // 둔다: 다시 켤 때 권한 창이 뜨지 않는다.
  const disable = useCallback(
    () =>
      run(async (started) => {
        // 선택은 **떼기 전에** 지운다 — 그사이 다른 탭의 되살리기가 다시 붙이지 않게.
        // 떼지 못하면 되돌린다(서버에는 등록이 남아 있으니 선택도 남아야 맞다) — 단 이 뜻이
        // 아직 마지막일 때만(켜기와 같은 이유).
        const intent = beginIntent('off');
        rememberPushWanted(false);
        // 떼는 도중 창이 닫혀도 다음 맞추기가 이어서 뗀다(위 `reconcile`).
        rememberDisablePending(true);
        let detached = false;
        try {
          detached = await detach(started);
        } finally {
          // 켜기와 같은 이유로 성공은 선택을 다시 남기고 매듭짓는다.
          if (detached) {
            if (intentIs(intent) || currentIntentDirection() === 'off') {
              rememberPushWanted(false);
            }
            rememberDisablePending(false);
            settleIntent('off');
          } else if (started === generation.current && intentIs(intent)) {
            rememberPushWanted(true);
          }
        }
      }),
    [run, detach],
  );

  useEffect(() => {
    let cancelled = false;
    void pushSupported().then((supported) => {
      if (!cancelled) setFcmSupported(supported);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 사용자가 바뀌었다 — 앞 세션의 일은 버리고, 붙인 토큰의 기억도 비운다(새 세션에는
  // 아직 아무것도 붙지 않았다).
  //
  // **다른 사람이 왔으면 토큰을 돌린다.** 앞 사람의 세션이 확인되지 않은 채 로그인 화면이
  // 떴고 거기서 다른 계정으로 들어온 경우, 앞 세션은 서버에 살아 있고 그 토큰은 이
  // 브라우저를 가리킨다 — 로그아웃이 없었으니 토큰도 버려지지 않았다. 돌리면 그 세션의
  // 토큰은 죽은 값이 되고, 아래 되살리기가 새 값을 붙인다(plan/push.md §5-21). 줄 안에서
  // 하므로 되살리기보다 먼저 끝나고, 주인은 **돌린 뒤에야** 바뀐다.
  useEffect(() => {
    generation.current += 1;
    registeredToken.current = null;
    // 앞 사람의 세션 id는 이 사람과 견줄 것이 아니다.
    seenCurrentId.current = undefined;
    // 돌리지 못했으면 보류로 남는다 — 토큰을 받는 자리가 먼저 다시 돌린다.
    if (userId) void run(async () => void (await ensureOwner(userId)));
  }, [userId, run]);

  // 맞출 계기: 로그인 · 목록 도착 · 내 줄의 등록 여부 변화 · 권한 변화.
  const currentId = current?.id;
  const currentRegistered = current?.pushRegistered;

  // **같은 사람의 다른 세션**도 세션이 바뀐 것이다 — 다른 탭이 다시 로그인해 쿠키를 갈아
  // 끼우면 이 탭의 "내 줄"이 다른 id로 바뀐다. 사용자만 보면 붙인 토큰의 기억이 앞 세션의
  // 것으로 남아, 같은 토큰이면 새 세션에 붙이지 않는다(다른 탭의 첫 등록이 실패했으면 그
  // 세션은 영영 `Notifications off`다). 줄 서 있던 앞 세션의 일(끄기)도 새 세션으로 나가면
  // 안 되므로 세대도 올린다. 처음 목록이 와서 id가 **생긴** 것은 바뀐 것이 아니다. 목록이
  // **잠깐 비는** 것(재조회 실패 뒤 다시 시도, `SessionsProvider.reload`)도 바뀐 것이 아니다 —
  // 마지막으로 본 id를 그대로 들고 있다가 다음 id와 견준다. 사용자가 바뀌면 그때 잊는다.
  useEffect(() => {
    if (currentId === undefined) return;
    const previous = seenCurrentId.current;
    seenCurrentId.current = currentId;
    if (previous === undefined || previous === currentId) return;
    generation.current += 1;
    registeredToken.current = null;
  }, [currentId]);

  useEffect(() => {
    if (!userId) return;
    void reconcile();
  }, [userId, currentId, currentRegistered, effective, reconcile]);

  // **탭으로 돌아올 때마다 권한을 다시 읽는다.** 사람은 앱 밖(브라우저·OS 설정)에서
  // 권한을 끌 수 있는데, 진입할 때 한 번만 읽으면 화면은 계속 "받는다"고 말하고 다른
  // 기기의 로비는 이 기기를 `Will notify`로 그린다(§5-17). 권한이 그대로라도 토큰이
  // 돌았을 수 있으므로 맞추기는 매번 한 번 돈다(같은 토큰이면 왕복 없이 끝난다).
  //
  // **지원 확인도 다시 한다** — SDK의 확인은 IndexedDB를 열어 보는 것이라 잠깐 실패할 수 있고,
  // 한 번 본 값으로 굳히면 이 탭은 새로고침까지 `unsupported`로 남아 등록을 떼고 켜기 버튼을
  // 감춘다. 지원이 돌아오면 `effective`가 바뀌어 위 효과가 맞춘다 — 그때까지의 맞추기는
  // "지원 안 됨"으로 도는 셈이라 건너뛴다.
  useEffect(() => {
    const reread = () => {
      setPermission(currentPermission());
      if (fcmSupported === false) {
        void pushSupported().then((supported) => setFcmSupported(supported));
        return;
      }
      void reconcile();
    };
    document.addEventListener('visibilitychange', reread);
    window.addEventListener('focus', reread);
    return () => {
      document.removeEventListener('visibilitychange', reread);
      window.removeEventListener('focus', reread);
    };
  }, [reconcile, fcmSupported]);

  // 다른 탭이 선택을 바꿨다(`storage`는 **다른** 탭의 쓰기에만 온다). 껐으면 이 탭이
  // 붙인 등록을 떼고, 켰으면 이 탭에서 붙인다 — 어느 쪽이든 맞추기 한 번이다.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== PUSH_WANTED_KEY) return;
      void reconcile();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [reconcile]);

  // 언어를 바꾸면 워커를 그 언어로 다시 등록한다 — 워커는 버튼 문구를 등록 주소의 `locale`로
  // 그리므로, 맞추기의 계기(로그인·목록·권한)만으로는 다음 등록까지 옛 언어로 남는다.
  // 첫 렌더는 건너뛴다: 그때의 등록은 맞추기가 한다. I18n 밖(테스트)이면 들을 것이 없다.
  const locale = useContext(I18nContext)?.locale;
  const seenLocale = useRef(locale);
  useEffect(() => {
    if (locale === undefined || locale === seenLocale.current) return;
    seenLocale.current = locale;
    void syncWorkerLocale();
  }, [locale]);

  // 워커가 구독 변경을 알려 오면 붙인 토큰의 기억을 비우고 다시 맞춘다 — FCM에서 지금
  // 값을 받아 붙인다. 워커 API가 없는 환경(테스트·비보안 출처)에서는 들을 것이 없다.
  useEffect(() => {
    const worker = navigator.serviceWorker;
    if (!worker) return;
    const onMessage = (event: MessageEvent<{ type?: string }>) => {
      if (event.data?.type !== SUBSCRIPTION_CHANGED) return;
      registeredToken.current = null;
      void reconcile();
    };
    worker.addEventListener('message', onMessage);
    return () => worker.removeEventListener('message', onMessage);
  }, [reconcile]);

  const value = useMemo<PushRegistrationValue>(
    () => ({ permission: effective, enable, disable }),
    [effective, enable, disable],
  );

  return (
    <PushRegistrationContext.Provider value={value}>{children}</PushRegistrationContext.Provider>
  );
}
