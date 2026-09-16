import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { AppShell } from '../components/AppShell';
import { Button } from '../components/Button';
import { DeviceIcon } from '../components/DeviceIcon';
import { api, ApiError } from '../lib/api';
import { DEVICE_LABELS } from '../lib/devices';
import { useI18n } from '../lib/i18n/i18n-context';
import { useSessions } from '../lib/sessions-context';
import { usePushRegistration } from '../lib/push/push-registration-context';
import { PUSH_SAMPLE_IMAGES } from '../lib/push/samples';
import {
  MAX_PUSH_CONTENT_BYTES,
  MAX_PUSH_MESSAGE_LENGTH,
  MAX_PUSH_TITLE_LENGTH,
  MAX_PUSH_TARGETS,
  PUSH_ACTION_SETS,
  type PushActionSet,
  type PushSendResult,
} from '../lib/contracts.gen';
import type { MessageKey } from '../lib/i18n/messages.gen';

// 줄마다 붙는 결말 한 줄. **FCM이 알려 주는 것은 "받아들였다"까지다** — 배달도 열람도
// 모르므로 화면이 그 이상을 말하지 않는다(plan/push.md §7).
const RESULT_KEYS: { [R in PushSendResult]: MessageKey } = {
  accepted: 'push.result_accepted',
  'no-token': 'push.result_no_token',
  rejected: 'push.result_rejected',
  failed: 'push.result_failed',
  duplicate: 'push.result_duplicate',
  unknown: 'push.result_unknown',
};

// 실패로 읽혀야 하는 것은 **토큰이 죽었을 때와 지금 못 보냈을 때다.** `duplicate`는
// "한 번만 보냈다"는 사실이고, `no-token`은 그 기기가 아직 등록되지 않았다는 상태다(§5-10).
const RESULT_IS_ERROR: { [R in PushSendResult]: boolean } = {
  accepted: false,
  'no-token': false,
  rejected: true,
  failed: true,
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
 *
 * **등록의 수명은 이 화면에 없다.** 권한 재확인·되살리기·토큰 회전·권한이 사라졌을 때의
 * 해제는 앱에 하나 있는 `PushRegistrationProvider`가 맞춘다 — 이 화면은 그 상태를 읽고
 * 켜기·끄기를 시킬 뿐이다. 화면에 두면 화면이 떠 있을 때만 맞춰지고, 되살리기와 겹쳐
 * 돌아 늦게 끝난 쪽이 먼저 끝난 쪽을 덮는다.
 */
export function PushPage() {
  const { t } = useI18n();
  // 목록은 대시보드·통화 로비와 **같은 것 하나**다 — 조회와 소켓 신호는
  // `SessionsProvider`가 한 자리에서 처리한다(lib/SessionsProvider.tsx).
  const { sessions: loaded, refresh, notifyChanged } = useSessions();
  const { permission, enable, disable } = usePushRegistration();
  const sessions = useMemo(() => loaded ?? [], [loaded]);
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [link, setLink] = useState('');
  const [actions, setActions] = useState<PushActionSet>('none');
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<{ [id: string]: PushSendResult }>({});
  const [failed, setFailed] = useState(false);

  // 고른 대상 중 **지금 보낼 수 있는 것**만 남는다 — 사라진 세션도, 방금 알림을 끈
  // 세션도 빠진다. 후자를 빼지 않으면 그 줄의 체크박스는 사라지는데 전송 목록에는 남아,
  // **보이는 선택과 보내는 선택이 어긋난다**(고른 것이 그것 하나뿐이면 끌 길도 없다).
  //
  // 지우는 것이 아니라 **걸러서 읽는다**: 목록은 이제 이 화면 밖에서도 바뀌고(소켓 신호·
  // 다른 화면의 해제), 그때마다 골라 둔 것을 고쳐 쓰면 목록이 잠깐 비는 순간(재조회 실패·
  // 로그아웃)에 선택이 통째로 날아간다. 그 기기가 다시 켜면 선택도 그대로 돌아온다.
  const targets = useMemo(
    () => selected.filter((id) => sessions.some((s) => s.id === id && s.pushRegistered)),
    [selected, sessions],
  );

  const registered = sessions.filter((session) => session.pushRegistered);
  const current = sessions.find((session) => session.isCurrent);

  // 권한은 켜졌는데 이 세션이 아직 등록 전인 경우. 예전에는 재로그인 말고는 길이
  // 없었지만(§5-2), 지금은 여기서 바로 붙일 수 있다 — 그래서 안내가 아니라
  // **켜기 버튼**을 다시 내놓는다.
  const staleRegistration =
    permission === 'granted' && current !== undefined && !current.pushRegistered;

  // 모두 선택은 **상한까지**다 — 등록 기기가 상한보다 많으면 "모두"는 처음 상한만큼이고, 그만큼
  // 골랐으면 해제로 바뀐다. 전체 수와 견주면 21대부터 버튼이 영영 "모두 선택"으로 남는다.
  const allSelected =
    targets.length >= Math.min(registered.length, MAX_PUSH_TARGETS);

  function toggle(id: string) {
    setSelected((ids) => {
      // 사람이 고치는 순간에는 사라진 줄을 걷어낸다 — 걸러서 읽기만 하면(위 `targets`) 보이지
      // 않는 옛 선택이 상한을 차지해 남은 기기를 고를 수 없게 된다.
      const live = ids.filter((each) =>
        sessions.some((s) => s.id === each && s.pushRegistered),
      );
      if (live.includes(id)) return live.filter((each) => each !== id);
      // 서버도 같은 상한으로 400을 낸다 — 여기서 먼저 막아 왕복을 아낀다.
      return live.length >= MAX_PUSH_TARGETS ? live : [...live, id];
    });
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
        // 비우면 아예 싣지 않는다 — 서버가 받는 기기의 언어로 그린다(§5-14).
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(imageUrl.trim() ? { imageUrl: imageUrl.trim() } : {}),
        ...(link.trim() ? { link: link.trim() } : {}),
        actions,
      });
      setResults(
        Object.fromEntries(response.results.map((r) => [r.sessionId, r.result])),
      );
      // 목록의 `pushRegistered`가 낡았을 수 있다(그 기기가 방금 로그아웃했다).
      if (response.results.some((r) => r.result !== 'accepted')) void refresh(true);
      // 거부된 토큰은 **서버가 그 세션에서 뗐다** — 그 줄은 이제 `Notifications off`이고,
      // 다른 기기의 목록·로비도 그것을 알아야 한다(스윕은 이 변화를 못 잡는다).
      if (response.results.some((r) => r.result === 'rejected')) notifyChanged();
    } catch (e) {
      // 400(형식)·502(이 배포에 전송기가 없다) 모두 사용자가 할 일은 같다 — 고쳐서
      // 다시 해 본다. FCM의 일시적 실패는 여기로 오지 않는다(그 줄의 `failed`다).
      setFailed(e instanceof ApiError);
    } finally {
      setSending(false);
    }
  }

  // 사람이 적은 것의 UTF-8 바이트 합이 상한을 넘는가 — 필드마다는 상한 안이어도 합이 FCM의
  // 4 KB를 넘길 수 있고, 그 요청은 서버가 400으로 접는다. 화면이 먼저 막고 이유를 말한다.
  const tooLong =
    new TextEncoder().encode(
      message.trim() + title.trim() + imageUrl.trim() + link.trim(),
    ).length > MAX_PUSH_CONTENT_BYTES;
  const canSend =
    targets.length > 0 && message.trim().length > 0 && !sending && !tooLong;

  // 안내는 **권한에 대해** 한 번에 하나만 뜬다 — 권한의 세 상태가 서로 배타적이다.
  //
  // ⚠️ **끄기는 그 갈래에 속하지 않는다.** 끄는 것은 등록이지 권한이 아니므로(§5-15)
  // 등록돼 있으면 권한이 어떻든 끌 수 있어야 한다. 예전에는 `denied`가 끄기를 가려서,
  // 설정에서 권한을 끈 사람은 **남아 있는 등록을 지울 길이 화면에 없었다** — 서버는
  // 계속 이 기기를 푸시 대상으로 들고 있는데도.
  let notice: ReactNode = null;
  // 권한이 없으면 묻고, 있는데 이 세션이 등록 전이면 등록만 한다 — **같은 버튼**이다.
  // 사용자가 할 일은 어느 쪽이든 "켜기" 하나뿐이라 컨트롤을 둘로 두지 않는다.
  if (permission === 'default' || staleRegistration) {
    notice = (
      <div className="push__permission">
        <p className="card__note">{t('push.allow_desc')}</p>
        <Button
          variant="outline"
          className="btn--compact"
          onClick={() => void enable()}
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
  }

  // 끄는 길은 **등록돼 있으면 언제나** 같은 자리에 선다. 설명이 "권한은 그대로"라고
  // 말하므로 못 지킬 약속도 아니다(§5-15).
  const turnOff = current?.pushRegistered ? (
    <div className="push__permission">
      <p className="card__note">{t('push.allow_off_desc')}</p>
      <Button
        variant="outline"
        className="btn--compact"
        onClick={() => void disable()}
      >
        {t('push.allow_off')}
      </Button>
    </div>
  ) : null;

  return (
    <AppShell page="push">
      <section className="card push">
        <header className="push__head">
          <h1>{t('push.title')}</h1>
          <p>{t('push.desc')}</p>
        </header>

        {(notice || turnOff) && (
          <div className="push__notice">
            {notice}
            {turnOff}
          </div>
        )}

        {/* 두 열이다 — 작성이 왼쪽, 기기 목록이 오른쪽. 오른쪽 열은 통화 로비의
            `.setup`을 그대로 쓴다: 같은 기기 목록이 화면마다 좌우를 바꾸면
            같은 부품으로 읽히지 않는다(§4). */}
        <div className="push__body">
          <div className="push__columns">
            <div className="push__compose">
              {/* 제목이 문구보다 위다 — 알림에서 읽히는 순서가 그렇다. 비워 두면
                  서버가 받는 기기의 언어로 그리므로 필수 표시를 두지 않는다(§5-14). */}
              <div className="setup__field">
                <label className="setup__label" htmlFor="push-title">
                  {t('push.title_label')}
                </label>
                <input
                  id="push-title"
                  className="input"
                  type="text"
                  maxLength={MAX_PUSH_TITLE_LENGTH}
                  placeholder={t('push.title_placeholder')}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

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
                {/* **그리는 것은 결국 OS다.** 주소도 페이로드도 맞는데 데스크톱에서는
                    그림이 빠진다 — macOS Chrome이 시스템 알림 센터를 쓰고 거기엔 큰
                    그림 자리가 없다(§5-11). 화면이 먼저 말하지 않으면 배관이 깨진
                    것으로 읽힌다(실제로 그렇게 읽혔다). */}
                <p className="setup__hint">{t('push.image_desktop_note')}</p>
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
                {/* 어디에 보이는지는 **받는 기기**가 정한다 — 접힌 알림에는 안 뜨는
                    기기가 있어, 안내가 없으면 기능이 고장 난 것으로 읽힌다(§5-13).
                    이미지의 `image_desktop_note`와 같은 자리·같은 규칙이다. */}
                <p className="setup__hint">{t('push.actions_hint')}</p>
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
                          setSelected(
                            allSelected
                              ? []
                              : registered
                                  .slice(0, MAX_PUSH_TARGETS)
                                  .map((session) => session.id),
                          )
                        }
                      >
                        {t(
                          allSelected
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

          {tooLong && <p className="card__note">{t('push.content_too_long')}</p>}

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
