package kr.hs.jung.prism.core.push

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kr.hs.jung.prism.core.security.SessionTokens
import kr.hs.jung.prism.core.session.SessionStore

/**
 * 이 기기의 알림 등록을 **세션에 하나만** 둔다 — 등록의 수명을 갖는 자리다.
 *
 * 등록은 세션에 붙으므로 로그아웃과 함께 사라진다(plan/push.md §5-2). 그래서 로그인할
 * 때마다 기기에 남긴 선택(`wanted`)대로 조용히 다시 붙여야 하고(§5-16), 권한이 밖(설정)에서
 * 꺼지면 서버의 등록도 떼어 내야 하며, FCM이 토큰을 돌리면 새 값을 다시 붙여야 한다.
 * 셋 다 "지금 상태와 있어야 할 상태를 맞추는 일"이라 한 함수([reconcile])로 두고,
 * 그것을 부르는 계기만 여럿이다 — 로그인 · 앱이 앞으로 옴 · 내 줄의 등록 여부 변화 ·
 * 토큰 회전.
 *
 * **한 번에 하나만 돈다.** 되살리기와 화면의 켜기·끄기가 각자 출발하면 늦게 끝난 쪽이
 * 먼저 끝난 쪽을 조용히 덮는다 — "끄기" 뒤에 옛 등록 요청이 끝나 토큰이 되살아나는
 * 식이다. 예전에는 그 둘이 `RootScreen`과 `PushViewModel`에 한 벌씩 있었다.
 *
 * **수명은 세션이다.** [SessionStore]와 같은 저장소(`ui/SessionScope.kt`)에 살아
 * 로그아웃하면 코루틴째 버려진다 — 앞 세션의 등록이 다음 세션에 붙지 못하게.
 */
class PushRegistration(
    private val device: PushDevice,
    private val pushApi: PushApi,
    private val tokens: SessionTokens,
    private val store: SessionStore,
) : ViewModel() {
    private val mutex = Mutex()

    /**
     * 이번 세션에서 서버에 붙인 토큰. **회전을 알아채는 기준**이다 — 같은 값을 다시
     * 붙이는 왕복을 아끼고, 다른 값이면 FCM이 토큰을 돌린 것이다.
     */
    private var registeredToken: String? = null

    init {
        // 내 줄의 등록 여부가 바뀌었다(목록 도착·다른 화면의 해제·서버가 죽은 토큰을 뗌).
        viewModelScope.launch {
            store.state
                .map { it.sessions?.firstOrNull { s -> s.isCurrent }?.pushRegistered }
                .distinctUntilChanged()
                .drop(1)
                .collect { reconcile() }
        }
        // FCM이 토큰을 돌렸다 — 붙인 토큰의 기억을 비우고 지금 값을 받아 붙인다.
        viewModelScope.launch {
            PushTokenRotations.count.drop(1).collect {
                mutex.withLock { registeredToken = null }
                reconcile()
            }
        }
    }

    /**
     * 지금 상태와 있어야 할 상태를 맞춘다.
     *
     *  - 받을 수 없는데(권한 없음·미지원) 등록돼 있다 → 뗀다. **선택은 건드리지 않는다**:
     *    사람이 끈 것이 아니라 받을 수 없게 된 것이다 — 권한이 돌아오면 그대로 살아난다
     *  - 받을 수 있고 켜 뒀는데 이번 세션에서 아직 안 붙였거나 토큰이 바뀌었다 → 붙인다.
     *    권한 창은 뜨지 않는다 — 이미 허용된 경우에만 토큰을 받는다
     *
     * 목록이 아직 없어도 붙이는 쪽은 간다 — 로그인 직후가 그 순간이고, 목록을 기다리면
     * 그만큼 늦게 붙는다. 떼는 쪽은 목록이 있어야 한다(등록돼 있는지를 목록만 안다).
     */
    fun reconcile() {
        viewModelScope.launch { mutex.withLock { reconcileLocked() } }
    }

    private suspend fun reconcileLocked() {
        // 끄다 만 것 — 떼는 도중 앱이 죽었거나 떼지 못했다. 권한·선택과 무관하게 이어서 뗀다
        // (서버에 등록이 없어도 떼기는 무해하다 — 목록을 기다릴 이유가 없다).
        if (device.disablePending()) {
            if (unregister()) {
                device.rememberWanted(false)
                device.rememberDisablePending(false)
                announce()
            }
            return
        }
        val registered = store.state.value.sessions
            ?.any { it.isCurrent && it.pushRegistered } == true
        if (!device.enabled || !device.permissionGranted()) {
            if (registered) detach()
            return
        }
        if (!device.wanted()) return
        val fcm = device.current() ?: return
        // 이번 세션에서 이미 이 토큰을 붙였다 — 목록이 아직 그 사실을 모를 뿐이다.
        if (fcm == registeredToken) return
        attach(fcm)
    }

    /**
     * 화면의 `알림 켜기` — 권한은 이미 받은 뒤다(권한 창은 Activity가 있어야 떠서 화면이
     * 연다). 토큰을 받아 붙이고, **성공했을 때만** 선택을 기억한다: 실패했는데 선택만
     * 남기면 화면은 `Notifications off`를 말하면서 다음 로그인에 조용히 켜진다.
     */
    suspend fun enable(): Boolean = mutex.withLock {
        val fcm = device.current() ?: return false
        if (!attach(fcm)) return false
        // 선택을 기기에 남긴다 — 다음 로그인에서 이 값을 보고 조용히 다시 붙는다(§5-16).
        device.rememberWanted(true)
        // 붙는 데 성공한 켜기는 끄다 만 것을 덮는다 — 남기면 다음 맞추기가 방금 붙인 것을 뗀다.
        device.rememberDisablePending(false)
        true
    }

    /**
     * 화면의 `알림 끄기` — **끄는 것은 등록이지 권한이 아니다**(§5-15). 기기의 토큰은
     * 그대로 두므로 다시 켤 때 권한 창이 뜨지 않는다. 서버에서 떼지 못했으면 기억도 바꾸지
     * 않는다 — 바꿔 두면 지금은 등록된 채로 남으면서 다음 로그인부터 조용히 꺼진다.
     */
    suspend fun disable(): Boolean = mutex.withLock {
        // 끄기를 시작했다는 표식 — 떼는 도중 앱이 죽거나 떼지 못해도 다음 맞추기가 이어서 뗀다.
        device.rememberDisablePending(true)
        if (!unregister()) return false
        // 선택은 서버에서 뗀 **직후**에 남긴다 — 뒤따르는 목록 재조회를 기다리다 앱이 죽으면
        // 선택이 켜진 채 남아 다음 실행이 조용히 다시 붙인다.
        device.rememberWanted(false)
        device.rememberDisablePending(false)
        announce()
        true
    }

    /**
     * 토큰을 서버에 붙이고 목록과 다른 기기에 알린다.
     *
     * ⚠️ **`true`라야 성공이다.** 서버는 그사이 그 세션이 사라졌거나 남의 것이면 던지지
     * 않고 `false`를 돌려준다(`attachPushToken`) — 던지지 않았다고 붙은 것이 아니고,
     * 거기서 목록을 다시 받고 남을 깨우면 안 일어난 일을 알리는 셈이다.
     */
    private suspend fun attach(fcm: String): Boolean {
        val access = tokens.access() ?: return false
        val registered = runCatching { pushApi.register(access, fcm) }.getOrNull()
        if (registered != true) return false
        registeredToken = fcm
        // 내 목록과 다른 기기의 목록이 함께 알아야 한다 — **스윕이 메워 주지 않는다**
        // (세션 id 목록만 대조하므로 구성원이 그대로인 변화는 보이지 않는다).
        store.refresh(background = true)
        store.notifyChanged()
        return true
    }

    /** 서버에서 뗀다 — 알리기([announce])와 갈라 둔다: 끄기는 뗀 직후에 선택을 남겨야 한다. */
    private suspend fun unregister(): Boolean {
        val access = tokens.access() ?: return false
        if (runCatching { pushApi.unregister(access) }.isFailure) return false
        registeredToken = null
        return true
    }

    /** 목록과 다른 기기에 알린다. 끄는 쪽이 더 중요하다 — 낡은 값은 "이 기기는 알림으로 깨울 수 있다"는 거짓이 된다. */
    private suspend fun announce() {
        store.refresh(background = true)
        store.notifyChanged()
    }

    private suspend fun detach(): Boolean {
        if (!unregister()) return false
        announce()
        return true
    }
}
