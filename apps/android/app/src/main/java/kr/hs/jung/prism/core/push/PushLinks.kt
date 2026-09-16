package kr.hs.jung.prism.core.push

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kr.hs.jung.prism.domain.model.PushDataKey
import kr.hs.jung.prism.domain.model.PushKind

/** 알림 링크가 가리키는 **앱 안의** 화면 — 웹 라우트를 옮긴 것이다(`/push` · `/webrtc` · 나머지). */
enum class PushDestination { DASHBOARD, PUSH, WEBRTC }

/** 알림을 눌렀을 때 할 일. */
sealed interface PushOpen {
    /** 아무것도 열지 않는다 — 통화(자기 화면으로 연다)거나 링크가 없다(앱만 앞으로 온다). */
    data object Nothing : PushOpen

    /** 우리 주소다 — 앱 안의 그 화면으로 간다(딥링크). 브라우저로 나가면 같은 것을 두 번 본다. */
    data class Page(val destination: PushDestination) : PushOpen

    /** 바깥 주소다 — 시스템에 넘긴다. */
    data class External(val link: String) : PushOpen
}

/**
 * 알림이 열어 달라고 한 것 — **하나만** 남는다. 통화가 화면보다 우선이다.
 *
 * [seq]는 요청마다 다르다 — 같은 통화를 다시 열어 달라고 하면 **새 요청**이다. 같은 값이면
 * StateFlow가 접고(`Call("c")` → null → `Call("c")`를 한 번의 변화로), 화면의 효과가 다시
 * 돌지 않아 요청이 칸에 갇힌 채 남는다.
 */
sealed interface PushRequest {
    val seq: Long

    data class Call(val callId: String, override val seq: Long = nextSeq()) : PushRequest

    data class Page(val destination: PushDestination, override val seq: Long = nextSeq()) : PushRequest

    companion object {
        private val counter = java.util.concurrent.atomic.AtomicLong()

        fun nextSeq(): Long = counter.incrementAndGet()
    }
}

/**
 * 알림이 열어 달라고 한 것 — 통화, 또는 앱 안의 화면.
 *
 * 두 경로가 여기로 모인다: 앱이 꺼져 있을 때 시스템이 그린 알림을 누른 경우
 * (`MainActivity`의 인텐트 엑스트라)와, 앱이 떠 있을 때 온 메시지
 * (`PrismMessagingService`, **FCM의 작업 스레드**). 화면은 이 값을 **한 번만** 소비하고
 * 비운다 — 남겨 두면 화면을 되돌아올 때마다 같은 것을 다시 열려 한다.
 *
 * 값은 **한 칸**이다 — 통화와 화면을 따로 두면 두 스레드가 각자 쓴 뒤 둘 다 남아, 화면의
 * 두 효과가 서로를 덮는다(화면이 통화 화면을 지운다). 한 칸을 원자적으로 갱신하고 통화가
 * 이기게 한다.
 *
 * 프로세스 메모리다. 앱이 죽으면 사라지고, 그러면 알림을 다시 누르는 것이 유일한
 * 경로가 된다 — **부재중 기록을 만들지 않기로 한 결정**과 같은 자리다(plan/webrtc.md §2).
 */
object PushLinks {
    private val _pending = MutableStateFlow<PushRequest?>(null)

    /** 열어 달라고 한 것. `RootScreen`이 처리한 뒤 `consume`으로 비운다. */
    val pending: StateFlow<PushRequest?> = _pending

    /** 판단용 읽기 — 테스트가 본다. */
    val pendingCallId: String?
        get() = (_pending.value as? PushRequest.Call)?.callId

    val pendingPage: PushDestination?
        get() = (_pending.value as? PushRequest.Page)?.destination

    /** 통화는 언제나 이긴다 — 기다리던 화면이 있어도 덮는다. */
    fun offer(callId: String) {
        _pending.update { PushRequest.Call(callId) }
    }

    /**
     * 인텐트 엑스트라에서 알림을 읽는다 — 통화면 통화를, 우리 주소의 링크면 그 화면을 연다.
     * [base]는 우리 주소(API 출처)다.
     */
    fun offerFrom(extras: android.os.Bundle?, base: String) {
        offerFrom(
            kind = extras?.getString(PushDataKey.KIND),
            callId = extras?.getString(PushDataKey.CALL_ID),
            link = extras?.getString(PushDataKey.LINK),
            base = base,
        )
    }

    /**
     * 판단만 하는 자리 — `Bundle`을 만들 수 없는 JVM 테스트가 여기를 본다.
     *
     * 데모 알림은 통화 화면을 열지 않는다. `callId` 없는 통화 알림도 마찬가지다 —
     * 열어 봐야 물을 것이 없다. 통화가 아닌 알림의 링크가 우리 주소면 그 화면으로 간다 —
     * 단 통화가 기다리고 있으면 화면은 남기지 않는다(원자적으로 견준다).
     */
    fun offerFrom(kind: String?, callId: String?, link: String? = null, base: String = "") {
        if (PushKind.from(kind) == PushKind.CALL) {
            if (!callId.isNullOrBlank()) offer(callId)
            return
        }
        val open = resolve(link, kind, base)
        if (open is PushOpen.Page) {
            _pending.update { current -> if (current is PushRequest.Call) current else PushRequest.Page(open.destination) }
        }
    }

    /** 처리한 것을 비운다 — 그사이 다른 것이 들어왔으면(통화) 그것은 남긴다. */
    fun consume(handled: PushRequest) {
        _pending.compareAndSet(handled, null)
    }

    /**
     * 사람이 통화 화면을 떠났다 — **그때 묻지 못해 남긴 그 요청**을 버린다. 남겨 두면 다시 붙는
     * 순간 통화 화면으로 끌려가고, 그때까지 화면 요청은 통화에 밀려 버려진다. 떠나는 사이에
     * 들어온 다른 통화는 다른 요청이라 남는다(`compareAndSet`).
     */
    fun dropCall(retained: PushRequest) {
        _pending.compareAndSet(retained, null)
    }

    /** 전부 비운다 — 테스트의 초기화. */
    fun clear() {
        _pending.value = null
    }

    /**
     * 알림의 링크로 할 일을 정한다 — **우리 주소면 앱 안의 화면으로**, 바깥 주소면 브라우저로.
     *
     * 통화 알림은 열지 않는다(통화는 `callId`로 연다). 링크가 없으면 앱만 앞으로 온다. 서버는
     * 링크가 없으면 기본 주소(푸시 페이지)를 싣는다 — 우리 주소라 앱 안의 푸시 화면으로 간다.
     */
    fun resolve(link: String?, kind: String?, base: String): PushOpen {
        if (PushKind.from(kind) == PushKind.CALL) return PushOpen.Nothing
        if (link.isNullOrBlank()) return PushOpen.Nothing
        if (!isSameOrigin(link, base)) return PushOpen.External(link)
        val path = runCatching { java.net.URI(link).path }.getOrNull().orEmpty()
        return PushOpen.Page(destinationFor(path))
    }

    /**
     * 웹 라우트 → 앱 화면. 경로 **전체**로 견준다(끝의 `/`만 무시) — `/push/settings`처럼 웹에도
     * 없는 경로는 대시보드다(앱에는 그 화면이 없다).
     */
    fun destinationFor(path: String): PushDestination = when (path.trimEnd('/')) {
        "/push" -> PushDestination.PUSH
        "/webrtc" -> PushDestination.WEBRTC
        else -> PushDestination.DASHBOARD
    }
}

/**
 * 두 주소가 **같은 출처**(스킴·호스트·포트)인가 — `startsWith`로 보면
 * `https://prism.example.evil/`이 `https://prism.example`로 시작해 앱 링크로 읽힌다.
 * 기본 주소가 비었으면 어떤 링크도 앱 링크가 아니다.
 */
internal fun isSameOrigin(link: String, base: String): Boolean {
    if (base.isBlank()) return false
    val a = runCatching { java.net.URI(link) }.getOrNull() ?: return false
    val b = runCatching { java.net.URI(base) }.getOrNull() ?: return false
    if (a.scheme == null || a.host == null || b.scheme == null || b.host == null) return false
    // 스킴은 대소문자를 가리지 않는다 — `HTTPS://`도 기본 포트가 443이다.
    fun port(u: java.net.URI): Int =
        if (u.port != -1) u.port else if (u.scheme.equals("https", ignoreCase = true)) 443 else 80
    return a.scheme.equals(b.scheme, ignoreCase = true) &&
        a.host.equals(b.host, ignoreCase = true) &&
        port(a) == port(b)
}
