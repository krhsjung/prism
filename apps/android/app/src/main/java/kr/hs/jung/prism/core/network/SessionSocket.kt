package kr.hs.jung.prism.core.network

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.channels.Channel
import kotlin.random.Random
import kr.hs.jung.prism.BuildConfig
import kr.hs.jung.prism.core.security.SessionTokens
import kr.hs.jung.prism.core.util.AppLog
import kr.hs.jung.prism.domain.model.AuthErrorCode
import kr.hs.jung.prism.domain.model.SocketServerMessage
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

/**
 * 서버가 보낸 오류 코드에 대한 소켓의 대응.
 *
 * **따로 떼어 둔 이유**: 이것이 이 클라이언트에서 가장 틀리기 쉬운 판단이고, 틀리면
 * 오프라인이 곧 로그아웃이 되거나 "세션이 종료됐습니다"가 중복으로 뜬다.
 * 소켓을 띄우지 않고 못 박아 둔다(서버의 `authorizeUpgrade`와 같은 결).
 */
enum class SocketErrorAction {
    /** 갱신하면 살아난다 — **기존 공유 회전**을 타고 다시 붙는다. */
    REFRESH_AND_RECONNECT,

    /**
     * 갱신으로는 살아나지 않는다. 재연결을 멈추고 목록 재조회에 판단을 넘긴다 —
     * 그 요청의 401을 이미 있는 중앙 경로가 표식과 대조해 처리한다.
     * **여기서 로그아웃하지 않는다.**
     */
    STOP_AND_REFETCH,
    ;

    companion object {
        fun of(code: String): SocketErrorAction =
            if (code == AuthErrorCode.SESSION_EXPIRED) REFRESH_AND_RECONNECT else STOP_AND_REFETCH
    }
}

/**
 * 세션 소켓 클라이언트 — 붙어 있는 동안 "목록이 바뀌었다"는 신호를 받는다.
 *
 * **이 소켓은 데이터를 나르지 않는다.** [SocketServerMessage.SessionsChanged]를 받으면
 * 화면이 기존 `GET /auth/sessions`를 다시 부른다 — 스탬핑·공유 회전·확정 거절 처리가
 * 전부 그 HTTP 경로에 있고, 소켓이 목록을 직접 주입하면 그것을 통째로 우회한다.
 *
 * ⚠️ **이 타입은 인증 상태를 바꾸지 않는다.** 소켓이 끊기는 이유는 대부분 인증과
 * 무관하고(회선·프록시·파드 재시작), 그것으로 로그아웃하면 오프라인이 곧 로그아웃이 된다.
 * 서버가 확정 거절을 보내와도 여기서 판단하지 않고 **목록 재조회 한 번**을 시킨다 —
 * 그 요청의 401을 이미 있는 중앙 경로(ApiClient → SessionAuthority)가 처리한다.
 */
class SessionSocket(
    private val tokens: SessionTokens,
    private val authority: SessionAuthority,
    private val url: String = BuildConfig.PRISM_SOCKET_URL,
    private val client: OkHttpClient = OkHttpClient.Builder()
        // 프로토콜 ping — 반쯤 죽은 TCP를 OkHttp가 잡는다. app-level 하트비트(아래
        // silenceDeadline)와 역할이 다르다: 이쪽은 우리가 상대의 침묵을 알아채는 것이 아니라
        // 상대에게 우리가 살아 있음을 알리고 죽은 소켓을 빨리 실패시키는 쪽이다.
        .pingInterval(20, java.util.concurrent.TimeUnit.SECONDS)
        .build(),
) {
    /**
     * 소켓이 붙어 있는가.
     *
     * 화면은 이 값이 true일 때만 `SessionListItem.isConnected`를 믿는다. 붙어 있지 않으면
     * 서버가 내려준 presence가 "아무도 안 붙었다"인지 "소켓 서비스가 죽었다"인지 구별할 수
     * 없고, 후자를 전자로 읽으면 멀쩡한 기기들을 전부 "비활성"이라고 지어내게 된다.
     */
    val isReady: StateFlow<Boolean> get() = _isReady.asStateFlow()
    private val _isReady = MutableStateFlow(false)

    /** 목록이 바뀌었다는 신호가 온 횟수. 화면은 이 값이 늘면 다시 가져온다. */
    val changed: StateFlow<Int> get() = _changed.asStateFlow()
    private val _changed = MutableStateFlow(0)

    private var job: Job? = null

    /** 한 번이라도 붙은 적이 있는가 — 다음 `Ready`가 "첫 연결"인지 "재연결"인지 가른다. */
    private var everReady = false

    /** 소켓이 보내온 것들. 재연결 루프가 하나씩 꺼내 처리한다. */
    private sealed interface Event {
        data class Message(val text: String) : Event
        data object Closed : Event
    }

    fun start(scope: CoroutineScope) {
        if (job?.isActive == true) return
        job = scope.launch { runLoop() }
    }

    fun stop() {
        job?.cancel()
        job = null
        _isReady.value = false
    }

    private suspend fun runLoop() {
        var attempt = 0
        while (true) {
            // 토큰은 **그때그때 읽는다** — 사본을 들고 있으면 회전 뒤 옛 토큰으로 다시 붙는다.
            val token = tokens.access()
            if (token == null) {
                // 자격증명이 없으면 붙을 수 없다. 인증 상태를 바꾸지는 않는다 —
                // 로그인 여부의 판단은 AuthManager의 몫이다.
                delay(backoff(attempt++))
                continue
            }

            val events = Channel<Event>(Channel.UNLIMITED)
            val socket = connect(token, events)
            val outcome = try {
                pump(events, token)
            } finally {
                _isReady.value = false
                // 정상 종료를 알려 두면 서버가 TTL을 기다리지 않고 presence를 지운다.
                socket.close(NORMAL_CLOSURE, null)
                events.close()
            }

            when (outcome) {
                Outcome.STOP -> return
                Outcome.RECONNECT_NOW -> attempt = 0
                Outcome.RECONNECT_LATER -> Unit
            }
            delay(backoff(attempt++))
        }
    }

    private fun connect(token: String, events: Channel<Event>): WebSocket {
        // 브라우저와 달리 네이티브는 핸드셰이크에 헤더를 붙일 수 있다.
        // 서버는 HTTP와 **같은 규칙**으로 읽는다(Bearer 우선, 없으면 쿠키).
        val request = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $token")
            .build()
        return client.newWebSocket(
            request,
            object : WebSocketListener() {
                override fun onMessage(webSocket: WebSocket, text: String) {
                    events.trySend(Event.Message(text))
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    events.trySend(Event.Closed)
                }

                // 끊김은 **판정 불가**다 — 회선·프록시·파드 재시작이 대부분이고,
                // 여기서 세션을 건드리면 오프라인이 곧 로그아웃이 된다.
                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    AppLog.d("socket failure: ${t.javaClass.simpleName}")
                    events.trySend(Event.Closed)
                }
            },
        )
    }

    private enum class Outcome { STOP, RECONNECT_NOW, RECONNECT_LATER }

    /**
     * 소켓이 살아 있는 동안 이벤트를 처리한다.
     *
     * 서버가 20초마다 보내는 하트비트가 [SILENCE_DEADLINE_MS] 동안 끊기면 회선이 죽은
     * 것으로 본다 — 그렇지 않으면 죽은 소켓을 붙들고 앉아 목록이 영영 갱신되지 않는다.
     */
    private suspend fun pump(events: Channel<Event>, usedAccessToken: String): Outcome {
        while (true) {
            val event = withTimeoutOrNull(SILENCE_DEADLINE_MS) { events.receive() }
                ?: return Outcome.RECONNECT_LATER // 침묵 = 죽은 회선
            when (event) {
                is Event.Closed -> return Outcome.RECONNECT_LATER
                is Event.Message -> {
                    val outcome = handle(event.text, usedAccessToken)
                    if (outcome != null) return outcome
                }
            }
        }
    }

    /** 처리했으면 null, 루프를 끝내야 하면 그 이유를 돌려준다. */
    private suspend fun handle(text: String, usedAccessToken: String): Outcome? {
        // 계약에 없는 메시지는 무시한다 — 형식이 어긋났다고 연결을 끊을 이유는 없다.
        return when (val message = decodeSocketServerMessage(text)) {
            null, SocketServerMessage.Heartbeat -> null
            SocketServerMessage.Ready -> {
                // 붙었다 = 소켓 서비스가 살아 있다 = presence를 믿어도 된다.
                _isReady.value = true
                // **첫 연결에서는 가져오지 않는다.** 화면이 이미 가져왔고 그 데이터는
                // 정확하다 — 다른 기기의 presence는 각자의 소켓이 쓴 값이라 우리가 붙는
                // 것과 무관하고, 우리 자신의 행은 isCurrent로 그려져 isConnected를 읽지도
                // 않는다. 여기서 바뀌는 것은 배지가 두 갈래에서 세 갈래가 되는 것뿐이다.
                //
                // **재연결이라면 가져온다.** 끊겨 있던 동안에는 sessionsChanged가 우리에게
                // 닿지 못해, 다른 기기의 변화를 통째로 놓쳤을 수 있다.
                if (everReady) _changed.update { it + 1 }
                everReady = true
                null
            }
            SocketServerMessage.SessionsChanged -> {
                _changed.update { it + 1 }
                null
            }
            is SocketServerMessage.Error -> onError(message.code, usedAccessToken)
        }
    }

    private suspend fun onError(code: String, usedAccessToken: String): Outcome {
        if (SocketErrorAction.of(code) == SocketErrorAction.STOP_AND_REFETCH) {
            // 확정 거절 — **여기서 로그아웃하지 않는다.** 목록을 다시 부르게 하고, 그
            // 요청의 401을 중앙 경로가 표식과 대조해 처리한다. 소켓이 직접 세션을 끝내면
            // 공지가 중복되거나, 이미 끝난 세션의 오류로 새 세션을 끊는다(endSession은
            // 여는 시점의 토큰이 아직 현재값일 것을 요구하는데, 몇 시간 사는 소켓의
            // 그 토큰은 이미 회전으로 갈렸다).
            _changed.update { it + 1 }
            return Outcome.STOP
        }

        // **직접 회전하지 않는다.** refreshForRetry는 restore·선제 갱신·HTTP 401이
        // 공유하는 회전이라, 여러 곳이 동시에 만료를 만나도 회전은 한 번만 나간다.
        // 리프레시 자격증명은 1회용이고 서버가 응답 전에 회전시키므로, 두 번째 회전은
        // 재사용 탐지에 걸려 멀쩡한 세션을 죽인다.
        val mark = authority.sessionMark(usedAccessToken)
            // 이 소켓은 **지난 세션**의 것이다. 조용히 물러난다.
            ?: return Outcome.STOP
        val rotated = try {
            authority.refreshForRetry(mark, usedAccessToken)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            null
        }
        // 갱신하지 못한 이유가 확정 거절인지 일시적 실패인지 여기서는 알 수 없다 —
        // 어느 쪽이든 백오프로 다시 시도하고, 확정이라면 다음 HTTP 요청이 정리한다.
        return if (rotated != null) Outcome.RECONNECT_NOW else Outcome.RECONNECT_LATER
    }

    /**
     * 지터를 섞는다 — 서버가 재시작하면 모든 클라이언트가 같은 순간에 끊긴다.
     * 정확히 같은 간격으로 재시도하면 그 무리가 유지돼 복구 직후를 다시 두드린다.
     */
    private fun backoff(attempt: Int): Long {
        val base = BACKOFF_MS[attempt.coerceIn(0, BACKOFF_MS.lastIndex)]
        return (base * Random.nextDouble(0.8, 1.2)).toLong()
    }

    private companion object {
        const val NORMAL_CLOSURE = 1000

        /**
         * 서버 하트비트는 20초 간격이다. 두 번을 놓칠 때까지 기다린 뒤 죽었다고 본다 —
         * 한 번의 지연으로 끊으면 느린 회선에서 재연결만 반복한다.
         */
        const val SILENCE_DEADLINE_MS = 45_000L

        val BACKOFF_MS = longArrayOf(1_000, 2_000, 4_000, 8_000, 15_000)
    }
}
