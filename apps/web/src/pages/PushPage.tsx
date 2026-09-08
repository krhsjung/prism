import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppShell } from '../components/AppShell';
import { Button } from '../components/Button';
import { DeviceIcon } from '../components/DeviceIcon';
import { api, ApiError } from '../lib/api';
import { DEVICE_LABELS } from '../lib/devices';
import { useI18n } from '../lib/i18n/i18n-context';
import { useSessionSocket } from '../lib/session-socket-context';
import {
  currentPermission,
  readSentToken,
  requestPermissionAndToken,
} from '../lib/push/registration';
import { PUSH_SAMPLE_IMAGES } from '../lib/push/samples';
import {
  MAX_PUSH_MESSAGE_LENGTH,
  MAX_PUSH_TARGETS,
  PUSH_ACTION_SETS,
  type PushActionSet,
  type PushSendResult,
  type SessionListItem,
} from '../lib/contracts.gen';
import type { MessageKey } from '../lib/i18n/messages.gen';

// 줄마다 붙는 결말 한 줄. **FCM이 알려 주는 것은 "받아들였다"까지다** — 배달도 열람도
// 모르므로 화면이 그 이상을 말하지 않는다(plan/push.md §7).
const RESULT_KEYS: { [R in PushSendResult]: MessageKey } = {
  accepted: 'push.result_accepted',
  'no-token': 'push.result_no_token',
  rejected: 'push.result_rejected',
  duplicate: 'push.result_duplicate',
  unknown: 'push.result_unknown',
};

// 실패로 읽혀야 하는 것은 **토큰이 죽었을 때뿐이다.** `duplicate`는 "한 번만 보냈다"는
// 사실이고, `no-token`은 그 기기가 아직 등록되지 않았다는 상태다(§5-10).
const RESULT_IS_ERROR: { [R in PushSendResult]: boolean } = {
  accepted: false,
  'no-token': false,
  rejected: true,
  duplicate: false,
  unknown: true,
};

const ACTION_LABELS: { [S in PushActionSet]: MessageKey } = {
  none: 'push.actions_none',
  open: 'push.actions_open',
  'open-dismiss': 'push.actions_open_dismiss',
};

/**
 * 푸시 화면 — 내 기기들에서 대상을 골라 **알림을 보내 본다**(plan/push.md §3).
 *
 * 목록은 대시보드·WebRTC 로비와 **같은 데이터·같은 부품**이고, 로비와 **같은 자리**
 * (오른쪽 열)에 선다. 다른 것은 할 수 있는 일뿐이다 — 여기서는 현재 세션도 대상이고,
 * **여럿 고를 수 있다**. 같은 설치가 여러 세션에 걸리면 서버가 토큰 기준으로 합쳐 한 번만
 * 보낸다(§5-10).
 */
export function PushPage() {
  const { t } = useI18n();
  const { changed } = useSessionSocket();
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [targets, setTargets] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [link, setLink] = useState('');
  const [actions, setActions] = useState<PushActionSet>('none');
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<{ [id: string]: PushSendResult }>({});
  const [failed, setFailed] = useState(false);
  const [permission, setPermission] = useState(currentPermission);

  const load = useCallback(async (background: boolean) => {
    try {
      const list = await api.sessions(background);
      setSessions(list);
      // 사라진 대상은 골라 둔 목록에서도 놓는다 — 없는 세션에 보내면 그 줄이 `unknown`이다.
      setTargets((ids) => ids.filter((id) => list.some((s) => s.id === id)));
    } catch {
      // 목록을 못 가져오는 것은 이 화면의 오류가 아니다 — 세션이 끝났으면
      // api 계층이 이미 로그인으로 돌려보내고 있다.
    }
  }, []);

  // 마운트당 한 번만 보낸다 — 대시보드와 **같은 가드**다.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void load(false);
  }, [load]);

  // 소켓이 알린 변화는 **활동이 아니다**(plan/auth.md §6).
  const handled = useRef(0);
  useEffect(() => {
    if (changed === handled.current) return;
    handled.current = changed;
    void load(true);
  }, [changed, load]);

  const registered = sessions.filter((session) => session.pushRegistered);
  const current = sessions.find((session) => session.isCurrent);
  // 토큰은 **로그인 시점에만** 세션에 실린다(§5-2). 권한을 나중에 줬거나 FCM이 토큰을
  // 회전시키면 권한은 켜져 있는데 세션은 알림을 못 받는다 — 화면이 그 사실을 말한다.
  const staleRegistration =
    permission === 'granted' && current !== undefined && !current.pushRegistered;

  function toggle(id: string) {
    setTargets((ids) =>
      ids.includes(id)
        ? ids.filter((each) => each !== id)
        : // 서버도 같은 상한으로 400을 낸다 — 여기서 먼저 막아 왕복을 아낀다.
          ids.length >= MAX_PUSH_TARGETS
          ? ids
          : [...ids, id],
    );
  }

  async function allowNotifications() {
    await requestPermissionAndToken();
    setPermission(currentPermission());
  }

  async function send() {
    const text = message.trim();
    if (targets.length === 0 || !text || sending) return;
    setSending(true);
    setResults({});
    setFailed(false);
    try {
      const response = await api.sendPush({
        sessionIds: targets,
        message: text,
        ...(imageUrl.trim() ? { imageUrl: imageUrl.trim() } : {}),
        ...(link.trim() ? { link: link.trim() } : {}),
        actions,
      });
      setResults(
        Object.fromEntries(response.results.map((r) => [r.sessionId, r.result])),
      );
      // 목록의 `pushRegistered`가 낡았을 수 있다(그 기기가 방금 로그아웃했다).
      if (response.results.some((r) => r.result !== 'accepted')) void load(true);
    } catch (e) {
      // 400(형식)·502(FCM이 안 됨) 모두 사용자가 할 일은 같다 — 고쳐서 다시 해 본다.
      setFailed(e instanceof ApiError);
    } finally {
      setSending(false);
    }
  }

  const canSend = targets.length > 0 && message.trim().length > 0 && !sending;

  // 안내는 **한 번에 하나만** 뜬다 — 권한의 세 상태가 서로 배타적이고 재로그인 안내는
  // `granted`일 때만 나온다. 그래서 카드에서도 구획 하나를 차지한다.
  let notice: ReactNode = null;
  if (permission === 'default') {
    notice = (
      <div className="push__permission">
        <p className="card__note">{t('push.allow_desc')}</p>
        <Button
          variant="outline"
          className="btn--compact"
          onClick={() => void allowNotifications()}
        >
          {t('push.allow')}
        </Button>
      </div>
    );
  } else if (permission === 'denied') {
    notice = <div className="alert alert--info">{t('push.allow_denied')}</div>;
  } else if (permission === 'unsupported') {
    notice = (
      <div className="alert alert--info">{t('push.allow_unsupported')}</div>
    );
  } else if (staleRegistration && readSentToken() !== null) {
    notice = <div className="alert alert--info">{t('push.reauth_hint')}</div>;
  }

  return (
    <AppShell page="push">
      <section className="card push">
        <header className="push__head">
          <h1>{t('push.title')}</h1>
          <p>{t('push.desc')}</p>
        </header>

        {notice && <div className="push__notice">{notice}</div>}

        {/* 두 열이다 — 작성이 왼쪽, 기기 목록이 오른쪽. 오른쪽 열은 통화 로비의
            `.setup`을 그대로 쓴다: 같은 기기 목록이 화면마다 좌우를 바꾸면
            같은 부품으로 읽히지 않는다(§4). */}
        <div className="push__body">
          <div className="push__columns">
            <div className="push__compose">
              <div className="setup__field">
                <label className="setup__label" htmlFor="push-message">
                  {t('push.message_label')}
                </label>
                <textarea
                  id="push-message"
                  className="textarea"
                  rows={3}
                  maxLength={MAX_PUSH_MESSAGE_LENGTH}
                  placeholder={t('push.message_placeholder')}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </div>

              <div className="setup__field">
                <label className="setup__label" htmlFor="push-image">
                  {t('push.image_label')}
                </label>
                <p className="setup__hint">{t('push.image_hint')}</p>
                {/* 샘플은 이 사이트가 서빙한다 — 리뷰어가 아무 준비 없이 시연할 수 있게.
                    배포된 주소에서만 뜬다: FCM이 localhost를 가져올 수 없다(§5-11). */}
                <div className="push__samples">
                  <button
                    type="button"
                    className={`push__sample${imageUrl ? '' : ' push__sample--on'}`}
                    onClick={() => setImageUrl('')}
                  >
                    {t('push.image_none')}
                  </button>
                  {PUSH_SAMPLE_IMAGES.map((sample) => {
                    const url = new URL(sample.path, window.location.origin).toString();
                    return (
                      <button
                        key={sample.path}
                        type="button"
                        className={`push__sample${imageUrl === url ? ' push__sample--on' : ''}`}
                        style={{ background: sample.swatch }}
                        aria-label={sample.path}
                        onClick={() => setImageUrl(url)}
                      />
                    );
                  })}
                </div>
                <input
                  id="push-image"
                  className="input"
                  type="url"
                  inputMode="url"
                  placeholder={t('push.image_placeholder')}
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                />
              </div>

              <div className="setup__field">
                <label className="setup__label" htmlFor="push-link">
                  {t('push.link_label')}
                </label>
                <p className="setup__hint">{t('push.link_hint')}</p>
                <input
                  id="push-link"
                  className="input"
                  type="url"
                  inputMode="url"
                  placeholder={t('push.link_placeholder')}
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                />
              </div>

              <div className="setup__field">
                <p className="setup__label" id="push-actions">
                  {t('push.actions_label')}
                </p>
                {/* 조합은 **계약이 정한다** — iOS가 미리 등록한 것만 쓸 수 있어 임의 목록을
                    보낼 방법이 없다(§5-13). 셋뿐이라 드롭다운에 접지 않는다: 고른 것이
                    화면에 남아 있어야 이 알림에 버튼이 붙는다는 것이 보인다(§4). */}
                <div
                  className="push__choices"
                  role="group"
                  aria-labelledby="push-actions"
                >
                  {PUSH_ACTION_SETS.map((set) => (
                    <button
                      key={set}
                      type="button"
                      className={`push__choice${actions === set ? ' push__choice--on' : ''}`}
                      aria-pressed={actions === set}
                      onClick={() => setActions(set)}
                    >
                      {t(ACTION_LABELS[set])}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="setup">
              <div className="setup__field">
                <div className="push__listhead">
                  <p className="setup__label">{t('push.devices')}</p>
                  {/* 목록 머리의 컨트롤은 **고른 수를 말하고 한 번에 바꾼다** — 기기가
                      여럿일 때 줄마다 누르는 것이 유일한 길이면 손이 많이 간다. */}
                  {registered.length > 1 && (
                    <div className="push__bulk">
                      <span className="card__note">
                        {t('push.selected_count', { count: String(targets.length) })}
                      </span>
                      <Button
                        variant="ghost"
                        className="btn--compact"
                        onClick={() =>
                          setTargets(
                            targets.length === registered.length
                              ? []
                              : registered
                                  .slice(0, MAX_PUSH_TARGETS)
                                  .map((session) => session.id),
                          )
                        }
                      >
                        {t(
                          targets.length === registered.length
                            ? 'push.clear_all'
                            : 'push.select_all',
                        )}
                      </Button>
                    </div>
                  )}
                </div>
                {/* 어느 줄이 왜 흐린지는 **목록 옆에서** 말한다 — 카드 머리에 두면
                    목록까지 눈이 한 번 더 왕복한다(시안 Devices). */}
                <p className="setup__hint">{t('push.devices_desc')}</p>

                <ul className="targets">
                  {sessions.map((session, index) => {
                    const checked = targets.includes(session.id);
                    const result = results[session.id];
                    return (
                      <Fragment key={session.id}>
                        {index > 0 && (
                          <li className="targets__divider" aria-hidden="true" />
                        )}
                        <li
                          className={`target${session.pushRegistered ? '' : ' target--muted'}`}
                        >
                          <span className="target__chip">
                            <DeviceIcon device={session.device} className="icon" />
                          </span>
                          <span className="target__label">
                            {t(DEVICE_LABELS[session.device])}
                            {/* 결과는 **고른 줄 옆에** 그린다 — 어느 기기가 어떻게 됐는지를
                                목록 밖에서 다시 짝지어 읽게 하지 않는다(§5-10). */}
                            <span
                              className={`target__sub${result && RESULT_IS_ERROR[result] ? ' target__sub--error' : ''}${result ? '' : ' target__sub--code'}`}
                            >
                              {result
                                ? t(RESULT_KEYS[result])
                                : `#${session.id.slice(0, 8)}`}
                            </span>
                          </span>
                          {session.pushRegistered ? (
                            <label className="target__action check">
                              <input
                                type="checkbox"
                                className="check__box"
                                checked={checked}
                                onChange={() => toggle(session.id)}
                              />
                              <span className="check__label">
                                {t(checked ? 'push.selected' : 'push.select')}
                              </span>
                            </label>
                          ) : (
                            // 누를 수 없는 컨트롤을 두지 않는다 — 배지가 이유를 말한다(§4).
                            <span className="badge badge--neutral">
                              {t('webrtc.notifications_off')}
                            </span>
                          )}
                        </li>
                      </Fragment>
                    );
                  })}
                </ul>
              </div>
            </div>
          </div>

          {/* 진행 중에도 **글자를 바꾸지 않는다**(plan/dashboard.md §4). */}
          <Button disabled={!canSend} onClick={() => void send()}>
            {t('push.send')}
          </Button>

          {failed && (
            <div className="alert alert--error" role="alert">
              {t('error.generic')}
            </div>
          )}
        </div>

        <footer className="push__foot">{t('push.foot')}</footer>
      </section>
    </AppShell>
  );
}
