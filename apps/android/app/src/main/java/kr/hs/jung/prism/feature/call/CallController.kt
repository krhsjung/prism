package kr.hs.jung.prism.feature.call

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.isActive
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kr.hs.jung.prism.core.calling.CallMedia
import kr.hs.jung.prism.core.calling.CallStats
import kr.hs.jung.prism.core.calling.MediaDeviceOption
import kr.hs.jung.prism.core.calling.MediaErrorKind
import kr.hs.jung.prism.core.calling.SignalDirection
import kr.hs.jung.prism.core.calling.SignalLog
import kr.hs.jung.prism.core.calling.SignalLogEntry
import kr.hs.jung.prism.core.calling.StatsSampler
import kr.hs.jung.prism.core.calling.isLogError
import kr.hs.jung.prism.core.calling.logDetail
import kr.hs.jung.prism.core.calling.logType
import kr.hs.jung.prism.core.network.SessionSocket
import kr.hs.jung.prism.core.util.AppLog
import kr.hs.jung.prism.domain.model.CallClientMessage
import kr.hs.jung.prism.domain.model.CallEndReason
import kr.hs.jung.prism.domain.model.CallErrorCode
import kr.hs.jung.prism.domain.model.CallServerMessage
import kr.hs.jung.prism.domain.model.IceServer
import kr.hs.jung.prism.domain.model.SessionRef
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.RtpReceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.VideoTrack
import kotlin.coroutines.coroutineContext
import kotlin.coroutines.resume

/**
 * 통화의 상태. **배지 여섯 변형과 1:1**이다(plan/webrtc.md §4) — 화면이 배지를 그리려고
 * 상태를 다시 조합하지 않게, 여기서 이미 그 모양으로 나눠 둔다.
 *
 * `NOTIFIED`(푸시로 깨웠다)는 아직 도달할 수 없다 — 소켓이 없는 기기는 서버가
 * `unreachable`로 거절하고, 푸시 경로는 push 슬라이스와 함께 붙는다(§8-11).
 */
/**
 * 통화의 상태. **배지 여섯 변형과 1:1**이다(plan/webrtc.md §4).
 *
 * `RINGING`과 `NOTIFIED`를 갈라 두는 이유는 기다리는 성격이 다르기 때문이다: 푸시
 * 경로는 알림이 뜨고 사람이 기기를 집어 앱을 여는 시간까지 창 안에 들어간다.
 */
enum class CallStatus { RINGING, NOTIFIED, CONNECTING, CONNECTED, RECONNECTING, FAILED }

/** ICE 정책. 화면에서 바꿀 수 있는 두 가지 중 하나다(§4). */
enum class IcePolicy { ALL, RELAY }

/**
 * 로비에 띄우는 한 줄. **통화가 끝난 뒤에도 남는 것은 이것뿐이다** — 부재중 목록을
 * 두지 않기로 했고(§2), 저장이 생기면 그 저장은 세션보다 오래 살기 때문이다.
 */
sealed interface CallNotice {
    data object Declined : CallNotice

    data class Ended(val reason: CallEndReason) : CallNotice

    data class Error(val code: CallErrorCode) : CallNotice

    /**
     * 알림을 늦게 열었다. [from]은 없을 수 있다 — 서버가 그 통화를 더는 기억하지
     * 못하거나 애초에 내 통화가 아니었으면 기기 종류를 지어내지 않는다(§6).
     */
    data class Expired(val from: SessionRef?) : CallNotice
}

data class ActiveCall(
    /** 서버가 발급한다. `call`을 보내고 `ringing`을 받기 전까지는 **없다**. */
    val callId: String? = null,
    /** 상대. 루프백에서는 없다 — 상대가 나 자신이라 기기 종류를 말할 것이 없다. */
    val peer: SessionRef? = null,
    val status: CallStatus,
    /** 건 쪽인가. **offer를 내는 역할이 여기서 나온다**(§6). */
    val isCaller: Boolean,
    /** 한 화면 안의 두 PeerConnection — 소켓도 서버도 지나지 않는다(§4). */
    val isLoopback: Boolean,
    val connectedAtMs: Long? = null,
)

/** 화면이 읽는 전부. 트랙만은 Compose 상태로 두지 않는다(아래 [CallController] 참고). */
data class CallUiState(
    val mediaError: MediaErrorKind? = null,
    val cameras: List<MediaDeviceOption> = emptyList(),
    val microphones: List<MediaDeviceOption> = emptyList(),
    val cameraId: String? = null,
    val microphoneId: String? = null,
    val micOn: Boolean = true,
    val cameraOn: Boolean = true,
    val hasMedia: Boolean = false,
    val call: ActiveCall? = null,
    /** 걸려 온 통화. **앱 어디서든** 뜬다(§4). */
    val incoming: Incoming? = null,
    val notice: CallNotice? = null,
    val stats: CallStats? = null,
    val log: List<SignalLogEntry> = emptyList(),
    val icePolicy: IcePolicy = IcePolicy.ALL,
    /** 받는 쪽이 수락했다 — 화면을 통화로 옮겨야 한다(웹의 `navigate('/webrtc')`). */
    val wantsCallScreen: Boolean = false,
    /**
     * 걸기를 눌렀고 카메라를 여는 중이다.
     *
     * 그동안에는 아직 통화가 없어서 [call]이 비어 있다 — 화면이 이 값으로 버튼을 잠그지
     * 않으면 두 번 누른 사람이 통화를 두 개 걸고, 두 번째가 받는 `busy`가 첫 통화를 지운다.
     */
    val starting: Boolean = false,
) {
    data class Incoming(val callId: String, val from: SessionRef)
}

/**
 * 통화 하나를 붙들고 있는 자리(웹 `lib/webrtc/CallProvider.tsx`와 같은 역할).
 *
 * **화면이 아니라 세션에 매단다.** 걸려 온 통화는 통화 화면이 아니라 앱 위에 떠야
 * 하고(plan/webrtc.md §4), 대시보드를 보고 있어도 울려야 한다 — 소켓이 세션 수명을
 * 갖는 것과 같은 이유이며, 실제로 이것은 그 소켓 위에 얹힌다.
 *
 * **미디어도 여기서 연다.** 수락은 카메라를 먼저 얻은 **뒤에** 서버로 나간다 —
 * 반대로 하면 `offer`가 스트림보다 먼저 도착해 트랙 없는 응답을 만들고, 카메라가
 * 실패한 통화를 이미 수락해 버린 상태가 된다.
 */
class CallController(
    context: Context,
    private val socket: SessionSocket,
) {
    private companion object {
        /**
         * 지표를 읽는 간격. 1초보다 촘촘하면 숫자가 읽기 전에 바뀌고, 느리면 통화 품질이
         * 무너지는 순간을 놓친다.
         */
        const val STATS_INTERVAL_MS = 1_000L

        /**
         * `연결 중`이 이보다 오래 가면 실패로 본다.
         *
         * 벨의 상한(45초)은 **붙기 전에만** 도는 서버 시계라, 수락한 뒤 협상이 멈춘
         * 통화는 아무도 끝내 주지 않는다. TURN까지 도는 ICE는 느려도 십수 초면 끝난다.
         */
        const val CONNECT_TIMEOUT_MS = 30_000L

        /**
         * 보낸 `call`의 답(`Ringing`·`Error`)을 기다리는 상한.
         *
         * 서버는 `call` 하나에 **정확히 한 번** 답하지만, 그 프레임이 상한에 걸려
         * 버려지면 답이 영영 오지 않는다. 그동안 다음 통화를 막아 두므로([starting]),
         * 풀어 주는 시계가 없으면 화면이 걸린 채로 남는다.
         */
        const val ANSWER_TIMEOUT_MS = 10_000L
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val media = CallMedia(context.applicationContext)

    private val _state = MutableStateFlow(CallUiState())
    val state: StateFlow<CallUiState> get() = _state.asStateFlow()

    /**
     * 렌더러에 붙일 트랙.
     *
     * 상태 객체에 담지 않는 이유: `VideoTrack`은 값이 아니라 **네이티브 자원의 손잡이**라
     * data class의 동등성 비교에 넣으면 같은 트랙이 매번 "바뀐 것"으로 읽힌다. 별도
     * 흐름으로 두고 화면은 이것만 본다.
     */
    private val _localTrack = MutableStateFlow<VideoTrack?>(null)
    val localTrack: StateFlow<VideoTrack?> get() = _localTrack.asStateFlow()
    private val _remoteTrack = MutableStateFlow<VideoTrack?>(null)
    val remoteTrack: StateFlow<VideoTrack?> get() = _remoteTrack.asStateFlow()

    /** 렌더러가 캡처와 **같은 EGL 문맥**을 써야 한다. */
    val eglBaseContext: EglBase.Context get() = media.eglBase.eglBaseContext

    private var peer: PeerConnection? = null
    /** 루프백의 두 연결. 한 화면 안에서 서로에게 offer/answer를 넘긴다. */
    private var loopback: List<PeerConnection> = emptyList()
    private var iceServers: List<IceServer> = emptyList()
    /** `setRemoteDescription` 전에 온 후보는 넣을 수 없다 — 붙들고 있다가 나중에 넣는다. */
    private val pendingRemote = mutableListOf<IceCandidate>()
    private val sampler = StatsSampler()
    private var statsJob: Job? = null
    /** 이번 로비 방문에서 장치 목록을 이미 읽었는가. */
    private var probed = false
    /** 내가 낸 offer의 답을 기다리는 중인가. **glare(양쪽이 동시에 재협상)를 가르는 값이다.** */
    private var offering = false
    /** `연결 중`에 상한을 두는 시계. */
    private var connectTimer: Job? = null
    /** `ringing`을 기다리는 사이에 취소했다. id를 알게 되는 순간 서버에도 알려야 한다. */
    private var cancelPending = false
    /**
     * 보낸 `call`이 아직 답을 못 받았다 — 두 번째 누름을 막는 문.
     *
     * ⚠️ **취소한 뒤에도 답이 올 때까지 닫혀 있다.** `Ringing`과 `Error`에는 어느
     * 시도의 답인지가 실려 있지 않아서, 취소하자마자 새로 걸면 앞 시도의 `Ringing`이
     * 새 통화의 것으로 읽힌다(그리고 앞 통화는 서버에 남아 상대 벨을 계속 울린다).
     * 한 번에 하나만 떠 있게 하면 그 모호함이 아예 생기지 않는다.
     */
    private var starting = false
    private var answerTimer: Job? = null

    /**
     * 지금 돌고 있는 "카메라를 열고 그다음 무엇을 한다" 한 벌.
     *
     * 이것을 붙들지 않으면 `카메라 켜기`·`걸기`를 누른 **직후** 화면을 벗어났을 때
     * 정리할 것을 찾지 못한다 — 그 순간에는 트랙도 통화도 아직 없기 때문이다. 뒤늦게
     * 획득이 끝나면 카메라가 켜진 채 남거나, 보이지도 끊기지도 않는 통화가 시작된다(§4).
     */
    private var pending: Job? = null

    /**
     * 미디어를 여는 작업을 **한 번에 하나만** 돌린다. 앞의 것이 남아 있으면 취소한다 —
     * 프리뷰를 연타하거나 열자마자 걸면 두 획득이 같은 카메라를 두고 겹친다.
     */
    private fun launchMedia(block: suspend () -> Unit) {
        pending?.cancel()
        pending = scope.launch { block() }
    }

    init {
        socket.onCallMessage = { message -> scope.launch { handle(message) } }
        // 소켓이 끊기면 서버는 이미 통화를 끝냈다 — 그 `ended`는 없어진 소켓으로 가므로
        // 이쪽은 영영 받지 못한다. 스스로 접지 않으면 카메라를 쥔 채 `연결됨`을 그리고
        // 있는데 상대는 로비로 돌아간 화면이 된다. 루프백은 소켓을 쓰지 않는다.
        socket.onDisconnected = {
            // 기다리던 `call`의 답도 오지 않는다 — 소켓이 없으면 서버는 답할 길이 없다.
            // 문을 열어 두지 않으면 재연결(또는 재로그인) 뒤에도 걸 수 없다.
            settleAttempt()
            cancelPending = false
            val call = _state.value.call
            if (call != null && !call.isLoopback) finish(CallNotice.Ended(CallEndReason.PEER_GONE))
        }
    }

    // ── 미디어 ────────────────────────────────────────────────────────────────

    /**
     * 카메라·마이크를 연다. 얻지 못하면 `mediaError`가 서고 false가 돌아온다.
     *
     * **트랙을 먼저 얻고 그 다음에 통화를 건다.** 반대로 하면 상대의 벨만 울리고
     * 이쪽은 붙을 수 없는 통화가 된다.
     */
    private suspend fun acquire(cameraId: String? = null): Boolean {
        val current = _state.value
        // 카메라를 여는 일은 몇백 ms가 걸린다 — 메인 스레드에서 하면 화면이 멈춘다.
        //
        // `NonCancellable`인 이유: 중간에 취소되면 이 코루틴이 곧바로 풀려 **연 카메라를
        // 놓을 코드에 닿지 못한다**(표시등이 켜진 채 남는다). 끝까지 열게 두고, 그 뒤에
        // 취소됐는지 보고 판단한다.
        val failure = withContext(NonCancellable + Dispatchers.IO) {
            media.open(cameraId ?: current.cameraId, current.microphoneId)
        }
        // 여는 동안 화면을 벗어났다면 연 것을 그대로 놓는다.
        if (!coroutineContext.isActive) {
            withContext(NonCancellable) { media.release() }
            _state.update { it.copy(hasMedia = false) }
            _localTrack.value = null
            return false
        }
        if (failure != null) {
            // 화면은 세 갈래로만 말하므로, 무엇이 났는지는 개발 로그가 갖는다.
            AppLog.e("media_failed: $failure")
            _state.update { it.copy(mediaError = failure) }
            return false
        }
        // 지금의 음소거·카메라 상태를 새 트랙에도 그대로 입힌다.
        media.setEnabled(video = current.cameraOn, audio = current.micOn)
        _localTrack.value = media.localVideoTrack
        val devices = media.devices()
        _state.update {
            it.copy(
                mediaError = null,
                hasMedia = true,
                cameraId = media.cameraId,
                cameras = devices.first,
                microphones = devices.second,
            )
        }

        // 통화 중이라면 보내는 트랙도 갈아 끼운다(재협상 없이 되는 유일한 교체다).
        peer?.senders?.forEach { sender ->
            when (sender.track()?.kind()) {
                "video" -> sender.setTrack(media.localVideoTrack, false)
                "audio" -> sender.setTrack(media.localAudioTrack, false)
            }
        }
        return true
    }

    /**
     * 로비에 들어오면 **장치 목록만** 읽는다.
     *
     * 카메라를 열지 않으므로 권한 창도 뜨지 않고 표시등도 켜지지 않는다. 이미 허용한
     * 적이 있으면 목록이 채워지고, 그때 시안대로 선택 메뉴가 그려진다. 허용한 적이
     * 없으면 아무것도 그리지 않고 타일에 "카메라 켜기" 버튼 하나만 둔다.
     */
    fun enterLobby() {
        if (probed) return
        probed = true
        if (!media.isAuthorized()) return
        val devices = media.devices()
        _state.update { it.copy(cameras = devices.first, microphones = devices.second) }
    }

    /**
     * 로비에서 미리 켜 본다(= 권한을 처음 묻는다). 통화 시작과 같은 경로를 타므로
     * **자동으로는 켜지지 않는다**(§7).
     */
    fun startPreview() {
        launchMedia { acquire() }
    }

    /**
     * 권한 창에서 거부당했다 — 화면의 목적이 통화 시작에서 권한 고치기로 바뀐다.
     *
     * **벨이 울리는 중이었으면 사실대로 거절한다.** 아무 말도 하지 않으면 거는 쪽이
     * 45초를 다 기다리고, 이쪽에는 벨 창이 그대로 남아 다시 눌러도 같은 자리를 맴돈다
     * (웹·iOS는 카메라 획득이 실패하는 같은 자리에서 이미 거절을 보낸다).
     */
    fun reportPermissionDenied() {
        val pending = _state.value.incoming
        if (pending != null) send(CallClientMessage.Decline(pending.callId))
        _state.update {
            it.copy(
                mediaError = MediaErrorKind.DENIED,
                incoming = null,
                // 이유를 그릴 수 있는 화면으로 옮긴다 — 대시보드에서 거부했으면 벨 창이
                // 사라진 것 말고는 아무 일도 없었던 것으로 보인다.
                wantsCallScreen = it.wantsCallScreen || pending != null,
            )
        }
    }

    fun selectCamera(id: String) {
        _state.update { it.copy(cameraId = id) }
        if (_state.value.hasMedia) media.switchCamera(id) else launchMedia { acquire(id) }
    }

    fun selectMicrophone(id: String) {
        _state.update { it.copy(microphoneId = id) }
        // 카메라와 같은 모양이다 — 이미 열려 있으면 장치만 갈아 끼우고(재협상 없음),
        // 아직 아니면 다음 `open()`이 이 값을 들고 간다.
        if (_state.value.hasMedia) media.switchMicrophone(id)
    }

    fun toggleMic() {
        _state.update { it.copy(micOn = !it.micOn) }
        media.setEnabled(audio = _state.value.micOn)
    }

    fun toggleCamera() {
        _state.update { it.copy(cameraOn = !it.cameraOn) }
        media.setEnabled(video = _state.value.cameraOn)
    }

    /** 카메라·마이크를 **놓는다**(표시등이 꺼진다). */
    private fun releaseMedia() {
        _localTrack.value = null
        media.release()
        _state.update { it.copy(hasMedia = false, mediaError = null) }
    }

    // ── 피어 연결 ─────────────────────────────────────────────────────────────

    private fun teardownPeer() {
        connectTimer?.cancel()
        connectTimer = null
        offering = false
        // ⚠️ 루프백에서는 `peer`가 `loopback[0]`과 **같은 객체**다(지표를 거는 쪽에서
        // 읽으려고 caller를 peer에 넣는다). 그대로 둘을 각각 dispose하면 같은 네이티브
        // 자원을 두 번 놓아 abort한다 — 신원으로 걸러 한 번만 놓는다.
        val connections = (listOfNotNull(peer) + loopback).distinctBy { System.identityHashCode(it) }
        connections.forEach { it.dispose() }
        peer = null
        loopback = emptyList()
        pendingRemote.clear()
        sampler.reset()
        _remoteTrack.value = null
        statsJob?.cancel()
        statsJob = null
        _state.update { it.copy(stats = null) }
    }

    /**
     * 새 [PeerConnection]을 만든다. **있던 것은 버린다** — offer를 받을 때마다 새로
     * 만드는 것이 재협상(ICE 정책 전환)까지 한 규칙으로 덮는 가장 단순한 길이다.
     */
    private fun buildPeer(callId: String): PeerConnection? {
        peer?.dispose()
        pendingRemote.clear()
        sampler.reset()

        val config = PeerConnection.RTCConfiguration(
            iceServers.map { server ->
                PeerConnection.IceServer.builder(server.urls)
                    .setUsername(server.username ?: "")
                    .setPassword(server.credential ?: "")
                    .createIceServer()
            },
        ).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            continualGatheringPolicy =
                PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
            // 화면에서 바꿀 수 있는 두 가지 중 하나(§4). `RELAY`는 일부러 직접 경로를
            // 막아 TURN이 실제로 값을 하는지 보여 준다.
            iceTransportsType = if (_state.value.icePolicy == IcePolicy.RELAY) {
                PeerConnection.IceTransportsType.RELAY
            } else {
                PeerConnection.IceTransportsType.ALL
            }
        }

        val created = media.factory.createPeerConnection(
            config,
            observer(
                onCandidate = { candidate ->
                    send(
                        CallClientMessage.Ice(
                            callId = callId,
                            candidate = candidate.toPayload(),
                        ),
                    )
                },
                onRemoteTrack = { track -> _remoteTrack.value = track },
                onConnectionState = ::applyConnectionState,
            ),
        ) ?: run {
            AppLog.e("peer_connection_failed")
            return null
        }
        attachLocalTracks(created)
        peer = created
        return created
    }

    private fun attachLocalTracks(connection: PeerConnection) {
        media.localVideoTrack?.let { connection.addTrack(it, listOf("prism")) }
        media.localAudioTrack?.let { connection.addTrack(it, listOf("prism")) }
    }

    private fun applyConnectionState(newState: PeerConnection.PeerConnectionState) {
        _state.update { current ->
            val call = current.call ?: return@update current
            val next = when (newState) {
                PeerConnection.PeerConnectionState.CONNECTED -> call.copy(
                    status = CallStatus.CONNECTED,
                    connectedAtMs = call.connectedAtMs ?: System.currentTimeMillis(),
                )
                // 끊김은 **실패가 아니다** — ICE가 스스로 되찾는 경우가 흔하다.
                PeerConnection.PeerConnectionState.DISCONNECTED ->
                    call.copy(status = CallStatus.RECONNECTING)
                PeerConnection.PeerConnectionState.FAILED ->
                    call.copy(status = CallStatus.FAILED)
                else -> return@update current
            }
            current.copy(call = next)
        }
    }

    private fun drainRemoteCandidates(connection: PeerConnection) {
        // 한 후보가 못 들어가도 통화는 다른 후보로 붙는다.
        pendingRemote.forEach { connection.addIceCandidate(it) }
        pendingRemote.clear()
    }

    /**
     * 협상이 더 갈 수 없다 — 배지가 `연결 실패`를 말하게 한다.
     *
     * 그냥 돌아서면 화면이 `연결 중`에 영원히 갇힌다: 벨 상한(45초)은 붙기 **전에만**
     * 도는 서버 시계라, 협상이 깨진 통화를 끝내 주지 않는다.
     */
    private fun failCall() {
        connectTimer?.cancel()
        connectTimer = null
        offering = false
        _state.update { it.copy(call = it.call?.copy(status = CallStatus.FAILED)) }
    }

    /**
     * 서버가 보낸 `call`에 답했다 — `ringing`(소켓으로 울렸다)이든 `notified`(알림으로
     * 알렸다)든 이후 흐름은 같고, 화면에 그릴 상태만 다르다.
     */
    private fun answerToCall(callId: String, status: CallStatus) {
        // 어느 쪽으로 갈리든 다음 통화를 열어 준다.
        settleAttempt()
        // 기다리는 사이에 취소했다 — 이제야 id를 알았으니 그때 못 보낸 것을 보낸다.
        if (cancelPending) {
            cancelPending = false
            send(CallClientMessage.Cancel(callId))
            return
        }
        _state.update { current ->
            val call = current.call ?: return@update current
            if (call.callId != null) current else current.copy(
                call = call.copy(callId = callId, status = status),
            )
        }
    }

    /** 보낸 `call`의 답이 왔다(또는 더 기다리지 않는다) — 다음 통화를 열어 준다. */
    private fun settleAttempt() {
        answerTimer?.cancel()
        answerTimer = null
        starting = false
        _state.update { it.copy(starting = false) }
    }

    /** `연결 중`에 상한을 둔다 — 협상이 조용히 멈춘 통화를 끝내 주는 것은 이것뿐이다. */
    private fun armConnectTimeout() {
        connectTimer?.cancel()
        connectTimer = scope.launch {
            delay(CONNECT_TIMEOUT_MS)
            if (_state.value.call?.status != CallStatus.CONNECTED) failCall()
        }
    }

    /**
     * 연결을 새로 세우고 offer를 낸다 — 통화 시작과 재협상이 **같은 길**을 쓴다.
     *
     * [offering]을 세우는 것이 두 번째 일이다: 답을 기다리는 중인지가 glare를 가르는
     * 값이고, 늦게 온 answer를 버리는 근거이기도 하다.
     */
    private suspend fun offerNow(callId: String): Boolean {
        val connection = buildPeer(callId) ?: return false
        val offer = connection.createOfferOrNull() ?: return false
        if (!alive(connection)) return false
        connection.setLocalOrNull(offer) ?: return false
        if (!alive(connection)) return false
        offering = true
        send(CallClientMessage.Offer(callId, offer.description))
        return true
    }

    /**
     * 이 연결이 **아직 그 통화의 연결인가.**
     *
     * ⚠️ SDP 연산은 전부 정지 지점이다. 그 사이에 통화가 끝나거나(`Ended`·`hangUp`) 새
     * 협상이 시작되면 [teardownPeer]·[buildPeer]가 `dispose()`를 부르는데, 네이티브
     * 객체를 해제한 뒤에 다시 만지면 예외가 아니라 **프로세스가 죽는다**. 웹은 닫힌
     * 연결이 던지기만 하고 iOS는 ARC가 붙들고 있어, 이 확인이 필요한 것은 여기뿐이다.
     */
    private fun alive(connection: PeerConnection): Boolean = peer === connection

    /** 루프백의 두 연결이 아직 그 통화의 것인가. [alive]와 같은 이유다. */
    private fun aliveLoopback(caller: PeerConnection, callee: PeerConnection): Boolean =
        loopback.size == 2 && loopback[0] === caller && loopback[1] === callee

    // ── 통화 끝내기 ───────────────────────────────────────────────────────────

    private fun finish(next: CallNotice?) {
        teardownPeer()
        _state.update { it.copy(call = null, notice = next) }
        // 통화가 끝나면 **장치도 놓는다.** 로비로 돌아왔다고 카메라를 쥐고 있을 이유가
        // 없고, 다음 통화는 어차피 다시 연다(권한은 한 번 준 뒤로 다시 묻지 않는다).
        releaseMedia()
    }

    // ── 보내기 / 받기 ─────────────────────────────────────────────────────────

    /**
     * **보내지 못한 것은 로그에 남기지 않는다.** 로그는 "무슨 일이 있었나"인데, 나가지
     * 않은 줄이 섞이면 상대가 왜 못 받았는지를 로그가 설명하지 못한다.
     */
    private fun send(message: CallClientMessage): Boolean {
        val ok = socket.send(message)
        if (ok) {
            _state.update {
                it.copy(
                    log = SignalLog.append(
                        it.log,
                        SignalLog.entry(
                            SignalDirection.SENT,
                            message.logType,
                            message.logDetail,
                            isError = false,
                        ),
                    ),
                )
            }
        } else {
            AppLog.d("call_send_dropped")
        }
        return ok
    }

    private suspend fun handle(message: CallServerMessage) {
        _state.update {
            it.copy(
                log = SignalLog.append(
                    it.log,
                    SignalLog.entry(
                        SignalDirection.RECEIVED,
                        message.logType,
                        message.logDetail,
                        message.isLogError,
                    ),
                ),
            )
        }

        when (message) {
            // **자동 수락은 없다.** 내 기기라도 카메라가 말없이 켜지면 안 된다(§4).
            is CallServerMessage.Incoming -> _state.update {
                it.copy(incoming = CallUiState.Incoming(message.callId, message.from))
            }

            // 둘은 **같은 답이고 다른 상태다**: 서버가 상대에게 닿는 방법을 골랐고
            // (소켓이냐 알림이냐), 그 선택이 화면의 배지와 문구를 가른다(§4).
            // 클라이언트는 경로를 요청하지 않는다 — 그러면 푸시를 강제로 쏘는 길이 열린다.
            is CallServerMessage.Ringing -> answerToCall(message.callId, CallStatus.RINGING)

            is CallServerMessage.Notified -> answerToCall(message.callId, CallStatus.NOTIFIED)

            is CallServerMessage.Accepted -> {
                val call = _state.value.call ?: return
                if (call.callId != message.callId) return
                iceServers = message.iceServers
                _state.update {
                    it.copy(
                        incoming = null,
                        call = it.call?.copy(status = CallStatus.CONNECTING),
                    )
                }
                armConnectTimeout()
                startStatsLoop()
                // **`accepted`를 받은 거는 쪽이 offer를 낸다** — 첫 협상의 방향은 여기서
                // 확정되므로 glare가 없다(§6). 받는 쪽은 offer를 기다린다.
                //
                // **붙이지 못한 기술은 내보내지 않는다.** 보내 버리면 상대는 내가 설치한
                // 적 없는 offer로 협상을 이어가고, 이쪽은 ICE 수집도 시작하지 못해 양쪽이
                // `연결 중`에 갇힌다.
                if (!call.isCaller) return
                if (!offerNow(message.callId)) return failCall()
            }

            is CallServerMessage.Offer -> {
                val call = _state.value.call ?: return
                if (call.callId != message.callId) return
                // ⚠️ **glare**: 양쪽이 동시에 재협상을 낼 수 있다(ICE 정책은 각자 바꾼다).
                // 서로의 offer가 서로의 연결을 갈아 치우면 뒤이은 answer가 갈 곳을 잃는다.
                //
                // 그래서 역할로 가른다 — **거는 쪽이 무례하고 받는 쪽이 정중하다.** 무례한
                // 쪽은 자기 offer를 지키고 상대 것을 버리며, 정중한 쪽은 자기 것을 접고
                // 상대 offer에 답한다. 정중한 쪽의 정책 변경도 사라지지 않는다 —
                // `iceTransportPolicy`는 각 연결의 지역 설정이고 아래에서 다시 세운다.
                if (offering && call.isCaller) {
                    AppLog.d("call_offer_ignored_glare")
                    return
                }
                offering = false
                // offer가 올 때마다 연결을 새로 세운다 — 통화 시작과 ICE 정책 전환에
                // 따른 재협상을 **한 규칙**으로 덮는다.
                val connection = buildPeer(message.callId) ?: return failCall()
                connection.setRemoteOrNull(
                    SessionDescription(SessionDescription.Type.OFFER, message.sdp),
                ) ?: return failCall()
                // 정지 지점을 지날 때마다 이 연결이 아직 그 통화의 것인지 본다 —
                // 해제된 네이티브 객체를 만지면 예외가 아니라 프로세스가 죽는다.
                if (!alive(connection)) return
                drainRemoteCandidates(connection)
                val answer = connection.createAnswerOrNull() ?: return failCall()
                if (!alive(connection)) return
                connection.setLocalOrNull(answer) ?: return failCall()
                if (!alive(connection)) return
                send(CallClientMessage.Answer(message.callId, answer.description))
                _state.update { it.copy(call = it.call?.copy(status = CallStatus.CONNECTING)) }
                armConnectTimeout()
                startStatsLoop()
            }

            is CallServerMessage.Answer -> {
                val connection = peer ?: return
                if (_state.value.call?.callId != message.callId) return
                // 내가 낸 offer의 답이 아니면 버린다 — 늦게 온 답이나 버려진 offer의 답이
                // `stable`인 연결에 들어가면 그대로 실패한다.
                if (!offering) {
                    AppLog.d("call_answer_ignored")
                    return
                }
                offering = false
                connection.setRemoteOrNull(
                    SessionDescription(SessionDescription.Type.ANSWER, message.sdp),
                ) ?: return failCall()
                if (!alive(connection)) return
                drainRemoteCandidates(connection)
            }

            is CallServerMessage.Ice -> {
                if (_state.value.call?.callId != message.callId) return
                val candidate = IceCandidate(
                    message.candidate.sdpMid,
                    message.candidate.sdpMLineIndex ?: 0,
                    message.candidate.candidate,
                )
                val connection = peer
                // 원격 기술이 아직 없으면 넣을 수 없다 — 붙들고 있다가 넣는다.
                if (connection?.remoteDescription == null) {
                    pendingRemote.add(candidate)
                } else {
                    connection.addIceCandidate(candidate)
                }
            }

            // 다른 기기가 먼저 받았다. **끝이 아니라 "내 차례가 아니었다"라서** 벨만
            // 닫고 알림은 남기지 않는다 — 통화는 이 기기의 것이 아니었다.
            is CallServerMessage.Claimed -> {
                if (_state.value.incoming?.callId == message.callId) {
                    _state.update { it.copy(incoming = null) }
                }
            }

            is CallServerMessage.Declined -> {
                // 거절은 **벨을 함께 받았던 기기에도** 온다 — 그 창을 닫아 주는 것이 이 줄이다.
                if (_state.value.incoming?.callId == message.callId) {
                    _state.update { it.copy(incoming = null) }
                }
                if (_state.value.call?.callId != message.callId) return
                finish(CallNotice.Declined)
            }

            is CallServerMessage.Ended -> {
                // 벨을 받고 있던 다른 화면에도 온다 — 그 창을 닫아 주는 것이 이 줄이다.
                if (_state.value.incoming?.callId == message.callId) {
                    _state.update { it.copy(incoming = null) }
                }
                if (_state.value.call?.callId != message.callId) return
                finish(CallNotice.Ended(message.reason))
            }

            is CallServerMessage.Expired -> {
                // **내 통화에 대한 답일 때만 끝낸다.** callId를 보지 않으면 지난 통화에
                // 대한 늦은 답 하나가 지금 붙어 있는 통화를 끊는다.
                if (_state.value.incoming?.callId == message.callId) {
                    _state.update { it.copy(incoming = null) }
                }
                val call = _state.value.call
                if (call != null && call.callId != message.callId) return
                finish(CallNotice.Expired(message.from))
            }

            // 화면 전환 없이 알림 한 줄로 받는다 — 아직 통화가 아니었다(§3.2).
            //
            // **아직 callId를 받지 못한 통화의 답이다.** 이미 callId가 있는 통화를 이걸로
            // 끝내면, 두 번째 시도가 받은 `busy` 하나가 울리고 있는 첫 통화를 지운다.
            is CallServerMessage.Error -> {
                if (_state.value.call?.callId != null) return
                // 서버는 `call` 하나에 `Ringing`이나 `Error` **하나로만** 답한다.
                settleAttempt()
                // 오류로 답했다면 취소할 통화가 애초에 서지 않았으니 기다리던 취소도 접는다.
                if (cancelPending) {
                    cancelPending = false
                    // 사용자는 이미 취소했다 — 그 뒤에 온 오류를 알림으로 띄우지 않는다.
                    return
                }
                finish(CallNotice.Error(message.code))
            }
        }
    }

    // ── 사용자가 하는 것 ──────────────────────────────────────────────────────

    fun startCall(target: SessionRef) {
        // ⚠️ **문을 먼저 닫는다.** 카메라를 얻는 동안에는 아직 통화가 없어서, 두 번
        // 누르면 두 획득이 겹치고 `call`이 두 번 나간다 — 두 번째가 받는 `busy` 하나가
        // 울리고 있는 첫 통화를 지운다. 화면도 이 값으로 버튼을 잠근다.
        if (starting || _state.value.call != null) return
        starting = true
        cancelPending = false
        _state.update { it.copy(starting = true) }
        launchMedia {
            _state.update { it.copy(notice = null) }
            // 카메라를 **먼저** 얻는다. 얻지 못하면 걸지 않는다 — 상대의 벨만 울리고
            // 이쪽은 붙을 수 없는 통화가 되기 때문이다.
            if (!_state.value.hasMedia && !acquire()) return@launchMedia settleAttempt()
            _state.update {
                it.copy(
                    call = ActiveCall(
                        peer = target,
                        status = CallStatus.RINGING,
                        isCaller = true,
                        isLoopback = false,
                    ),
                )
            }
            if (!send(CallClientMessage.Call(target.id))) {
                settleAttempt()
                return@launchMedia finish(CallNotice.Error(CallErrorCode.UNREACHABLE))
            }
            // 나갔다 — 이제 문은 **서버의 답이 열어 준다**(위 `starting` 주석).
            answerTimer = scope.launch {
                delay(ANSWER_TIMEOUT_MS)
                // 자기 자신을 취소하지 않게 먼저 놓는다 — `settleAttempt`이 붙들고 있는
                // 시계를 끄는데, 그게 지금 돌고 있는 이 작업이다.
                answerTimer = null
                settleAttempt()
                cancelPending = false
                // 답 없이 시간이 지났다 — 서 있던 통화가 있으면 그 자리에서 접는다.
                val call = _state.value.call
                if (call != null && call.callId == null) {
                    finish(CallNotice.Error(CallErrorCode.UNREACHABLE))
                }
            }
        }
    }

    /**
     * 알림을 열고 들어왔다 — **이 통화가 아직 살아 있나**(§6).
     *
     * 늦게 온 기기의 유일한 질문이다. 살아 있으면 서버가 `incoming`으로 답해 벨이 다시
     * 울리고, 아니면 `expired`로 "이미 끝난 통화"를 그린다 — 그것이 **푸시 경로의 정상
     * 결말**이다(§8-10).
     *
     * 이미 통화 중이거나 벨이 울리는 중이면 아무것도 하지 않는다 — 그 화면이 이미 답이다.
     */
    fun resumeCall(callId: String) {
        val current = _state.value
        if (current.call != null || current.incoming != null) return
        send(CallClientMessage.Resume(callId))
    }

    fun acceptIncoming() {
        val request = _state.value.incoming ?: return
        launchMedia {
            _state.update { it.copy(notice = null) }
            if (!_state.value.hasMedia && !acquire()) {
                // 카메라를 얻지 못하면 수락할 수 없다. 아무 말도 하지 않으면 상대가
                // 45초를 다 기다리므로 **사실대로 거절**하되, 여기서 끝내면 받는 쪽에는
                // 창이 사라진 것 말고 아무 일도 없다 — "받기를 눌렀는데 거절됐다"로
                // 보인다. 그래서 이유를 그릴 수 있는 화면으로 옮긴다.
                send(CallClientMessage.Decline(request.callId))
                _state.update { it.copy(incoming = null, wantsCallScreen = true) }
                return@launchMedia
            }
            _state.update {
                it.copy(
                    call = ActiveCall(
                        callId = request.callId,
                        peer = request.from,
                        status = CallStatus.CONNECTING,
                        isCaller = false,
                        isLoopback = false,
                    ),
                    incoming = null,
                    // 대시보드에서 받았을 수 있다 — 통화는 통화 화면에서 그린다.
                    wantsCallScreen = true,
                )
            }
            send(CallClientMessage.Accept(request.callId))
            startStatsLoop()
        }
    }

    fun declineIncoming() {
        val pending = _state.value.incoming ?: return
        send(CallClientMessage.Decline(pending.callId))
        _state.update { it.copy(incoming = null) }
    }

    /**
     * 통화를 접으면서 서버에도 끝을 알린다. `Cancel`과 `Hangup`이 나눠 쓰는 몸통이다.
     *
     * ⚠️ **아직 callId가 없는 자리를 여기서 함께 본다** — `call`은 보냈고 `Ringing`은
     * 오지 않은 왕복 사이다. 그냥 지우면 서버의 통화는 살아 있어 상대 벨이 45초를 마저
     * 울리고, 상대가 받으면 offer를 낼 사람이 없는 통화가 선다. 그래서 **끝낼 뜻을
     * 기억했다가** `Ringing`이 오는 순간 보낸다. 취소 버튼만이 아니라 화면을 벗어나는
     * 길도 이 자리를 지나야 한다 — 서버가 보기에는 같은 사건이다.
     */
    private fun endCall(verb: (String) -> CallClientMessage) {
        val call = _state.value.call
        if (call != null && !call.isLoopback) {
            // 기억해 두는 동사는 언제나 `Cancel`이다 — 그 시점의 서버 통화는 반드시
            // 벨 단계이고, 거는 쪽이 벨을 접는 동사가 그것이다.
            if (call.callId != null) send(verb(call.callId)) else cancelPending = true
        }
        finish(null)
    }

    /** 벨을 접는다(거는 쪽). 붙은 뒤로는 [hangUp]의 자리다. */
    fun cancelCall() = endCall(CallClientMessage::Cancel)

    fun hangUp() = endCall(CallClientMessage::Hangup)

    /**
     * 실패한 통화를 **같은 상대에게** 다시 건다(§4: "타일에는 `Try again`만 둔다").
     *
     * 새로 거는 것이지 되살리는 것이 아니다 — 서버의 통화는 이미 끝났고 `callId`도
     * 새로 받는다. 끊는 길을 먼저 지나야 피어와 장치가 정리된다(웹 `retryCall`).
     */
    fun retryCall() {
        val current = _state.value.call ?: return
        hangUp()
        if (current.isLoopback) startLoopback() else current.peer?.let { startCall(it) }
    }

    /** 화면이 통화로 옮겨 갔다 — 신호를 내린다. */
    fun consumeCallScreenRequest() {
        _state.update { it.copy(wantsCallScreen = false) }
    }

    fun clearLog() {
        _state.update { it.copy(log = emptyList()) }
    }

    // ── 루프백 ────────────────────────────────────────────────────────────────

    /**
     * 한 화면 안의 두 연결. **소켓도 서버도 지나지 않는다** — 그래서 시그널링 로그가
     * 비어 있는 것이 정상이고, 진단이 그 자리에 그렇게 적는다(§4).
     */
    fun startLoopback() {
        launchMedia {
            _state.update { it.copy(notice = null) }
            if (!_state.value.hasMedia && !acquire()) return@launchMedia
            teardownPeer()

            val config = PeerConnection.RTCConfiguration(emptyList()).apply {
                sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            }
            // ⚠️ 후보 콜백은 **네이티브 스레드에서 늦게** 온다 — 통화가 끝나 두 연결을
            // 이미 `dispose()`한 뒤에도 한 번 더 들어올 수 있고, 그때 상대 연결을 만지면
            // 예외가 아니라 프로세스가 죽는다.
            //
            // 그래서 두 가지를 한다: 지역 변수를 붙들지 않고 **지금의 `loopback`을 통해**
            // 건네고, 그 읽기와 사용을 **정리와 같은 스레드**(Main)에서 한다. 읽고 나서
            // 쓰기 전에 정리가 끼어들면 `loopback`을 봐도 소용이 없기 때문이다.
            val relay = { to: Int, candidate: IceCandidate ->
                scope.launch { loopback.getOrNull(to)?.addIceCandidate(candidate) }
                Unit
            }
            val caller = media.factory.createPeerConnection(
                config,
                observer(
                    // 거는 쪽의 후보는 받는 쪽으로 — 목록의 1번이다.
                    onCandidate = { candidate -> relay(1, candidate) },
                    onRemoteTrack = {},
                    onConnectionState = ::applyConnectionState,
                ),
            )
            val callee = media.factory.createPeerConnection(
                config,
                observer(
                    onCandidate = { candidate -> relay(0, candidate) },
                    onRemoteTrack = { track -> _remoteTrack.value = track },
                    onConnectionState = {},
                ),
            )
            if (caller == null || callee == null) {
                AppLog.e("loopback_peer_failed")
                caller?.dispose()
                callee?.dispose()
                return@launchMedia
            }
            loopback = listOf(caller, callee)
            attachLocalTracks(caller)

            // 지표는 보내는 쪽에서 읽는다 — 화면의 `Video`가 상대 타일의 값이어야 한다.
            peer = caller
            _state.update {
                it.copy(
                    call = ActiveCall(
                        status = CallStatus.CONNECTING,
                        isCaller = true,
                        isLoopback = true,
                    ),
                )
            }
            // 루프백도 같은 시계를 쓴다 — 한 화면 안이라도 붙지 못하면 `연결 중`에 갇힌다.
            armConnectTimeout()
            startStatsLoop()

            // 정지 지점마다 두 연결이 아직 그 통화의 것인지 본다 — 릴레이 경로의
            // `alive`와 같은 이유다(해제된 네이티브 객체를 만지면 프로세스가 죽는다).
            val offer = caller.createOfferOrNull() ?: return@launchMedia failCall()
            if (!aliveLoopback(caller, callee)) return@launchMedia
            caller.setLocalOrNull(offer) ?: return@launchMedia failCall()
            if (!aliveLoopback(caller, callee)) return@launchMedia
            callee.setRemoteOrNull(offer) ?: return@launchMedia failCall()
            if (!aliveLoopback(caller, callee)) return@launchMedia
            val answer = callee.createAnswerOrNull() ?: return@launchMedia failCall()
            if (!aliveLoopback(caller, callee)) return@launchMedia
            callee.setLocalOrNull(answer) ?: return@launchMedia failCall()
            if (!aliveLoopback(caller, callee)) return@launchMedia
            caller.setRemoteOrNull(answer) ?: return@launchMedia failCall()
        }
    }

    // ── ICE 정책 ──────────────────────────────────────────────────────────────

    fun setIcePolicy(policy: IcePolicy) {
        _state.update { it.copy(icePolicy = policy) }
        val call = _state.value.call ?: return
        val callId = call.callId ?: return
        if (call.isLoopback) return
        // 통화 중이면 **다시 붙인다** — 정책은 연결을 세울 때만 쓰이므로 지금 것에는
        // 소급되지 않는다. 서버는 offer의 방향을 강제하지 않아 어느 쪽이든 재협상을 낸다.
        scope.launch {
            if (!offerNow(callId)) return@launch failCall()
            _state.update {
                it.copy(
                    call = it.call?.copy(status = CallStatus.CONNECTING, connectedAtMs = null),
                )
            }
            armConnectTimeout()
        }
    }

    // ── 지표 ──────────────────────────────────────────────────────────────────

    private fun startStatsLoop() {
        statsJob?.cancel()
        statsJob = scope.launch {
            while (true) {
                val connection = peer
                if (connection != null) {
                    val report = suspendCancellableCoroutine { continuation ->
                        connection.getStats { continuation.resume(it) }
                    }
                    // 콜백을 기다리는 사이에 통화가 끝났을 수 있다 — 해제된 연결의
                    // 상태를 물으면 예외가 아니라 프로세스가 죽는다.
                    if (alive(connection)) {
                        val next = sampler.read(report, connection.iceConnectionState())
                        _state.update { it.copy(stats = next) }
                    }
                }
                delay(STATS_INTERVAL_MS)
            }
        }
    }

    /**
     * 통화 화면을 벗어나면 **통화를 끝내고 장치를 놓는다.**
     *
     * 통화만 남기고 미디어를 놓을 수는 없다(상대에게 검은 화면과 침묵이 간다). 통화를
     * 남기는 쪽도 안 된다 — 이 앱에는 축소된 통화 UI가 없어서, 다른 화면에서는 통화를
     * 보거나 끝낼 방법이 없는 **유령 상태**가 된다. 그래서 나가는 것이 곧 끊는 것이다.
     */
    fun leaveLobby() {
        probed = false
        // **진행 중인 획득을 먼저 취소한다.** 이것이 없으면 방금 누른 `걸기`가 화면이
        // 사라진 뒤에 끝나면서 통화를 시작해 버린다 — 보이지도 끊기지도 않는 유령 통화다.
        val wasPending = pending?.isActive == true
        pending?.cancel()
        pending = null
        when {
            _state.value.call != null -> hangUp()
            _state.value.hasMedia || wasPending -> releaseMedia()
        }
    }

    /** 세션이 끝났다 — 통화도 상태도 남기지 않는다. */
    fun dispose() {
        pending?.cancel()
        pending = null
        settleAttempt()
        cancelPending = false
        socket.onCallMessage = null
        socket.onDisconnected = null
        teardownPeer()
        media.dispose()
        scope.cancel()
    }

    // ── SDP 콜백을 코루틴으로 접는다 ──────────────────────────────────────────

    private suspend fun PeerConnection.createOfferOrNull(): SessionDescription? =
        suspendCancellableCoroutine { continuation ->
            createOffer(
                sdpObserver(
                    onCreated = { continuation.resume(it) },
                    onFailed = {
                        AppLog.e("create_offer_failed: $it")
                        continuation.resume(null)
                    },
                ),
                MediaConstraints(),
            )
        }

    private suspend fun PeerConnection.createAnswerOrNull(): SessionDescription? =
        suspendCancellableCoroutine { continuation ->
            createAnswer(
                sdpObserver(
                    onCreated = { continuation.resume(it) },
                    onFailed = {
                        AppLog.e("create_answer_failed: $it")
                        continuation.resume(null)
                    },
                ),
                MediaConstraints(),
            )
        }

    private suspend fun PeerConnection.setLocalOrNull(sdp: SessionDescription): Unit? =
        suspendCancellableCoroutine { continuation ->
            setLocalDescription(
                sdpObserver(
                    onSet = { continuation.resume(Unit) },
                    onFailed = {
                        AppLog.e("set_local_failed: $it")
                        continuation.resume(null)
                    },
                ),
                sdp,
            )
        }

    private suspend fun PeerConnection.setRemoteOrNull(sdp: SessionDescription): Unit? =
        suspendCancellableCoroutine { continuation ->
            setRemoteDescription(
                sdpObserver(
                    onSet = { continuation.resume(Unit) },
                    onFailed = {
                        AppLog.e("set_remote_failed: $it")
                        continuation.resume(null)
                    },
                ),
                sdp,
            )
        }
}

private fun IceCandidate.toPayload() = kr.hs.jung.prism.domain.model.IceCandidatePayload(
    candidate = sdp,
    sdpMid = sdpMid,
    sdpMLineIndex = sdpMLineIndex,
)

/**
 * `PeerConnection.Observer`를 클로저로 접는다.
 *
 * 루프백은 **연결이 둘**이라 한 관찰자로는 어느 쪽이 부른 것인지 가릴 수 없다 —
 * 연결마다 하나씩 둔다. 화면이 읽는 것은 후보·원격 트랙·연결 상태 셋뿐이라 나머지는
 * 계약이 요구하는 자리만 채운다.
 */
private fun observer(
    onCandidate: (IceCandidate) -> Unit,
    onRemoteTrack: (VideoTrack) -> Unit,
    onConnectionState: (PeerConnection.PeerConnectionState) -> Unit,
) = object : PeerConnection.Observer {
    override fun onIceCandidate(candidate: IceCandidate) = onCandidate(candidate)

    override fun onAddTrack(receiver: RtpReceiver?, streams: Array<out MediaStream>?) {
        (receiver?.track() as? VideoTrack)?.let(onRemoteTrack)
    }

    override fun onConnectionChange(newState: PeerConnection.PeerConnectionState) =
        onConnectionState(newState)

    override fun onSignalingChange(state: PeerConnection.SignalingState?) = Unit
    override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) = Unit
    override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
    override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) = Unit
    override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) = Unit
    override fun onAddStream(stream: MediaStream?) = Unit
    override fun onRemoveStream(stream: MediaStream?) = Unit
    override fun onDataChannel(channel: org.webrtc.DataChannel?) = Unit
    override fun onRenegotiationNeeded() = Unit
}

/** 만들기(`onCreateSuccess`)와 붙이기(`onSetSuccess`)가 한 인터페이스에 있다. */
private fun sdpObserver(
    onCreated: (SessionDescription) -> Unit = {},
    onSet: () -> Unit = {},
    onFailed: (String?) -> Unit,
) = object : SdpObserver {
    override fun onCreateSuccess(sdp: SessionDescription) = onCreated(sdp)
    override fun onSetSuccess() = onSet()
    override fun onCreateFailure(error: String?) = onFailed(error)
    override fun onSetFailure(error: String?) = onFailed(error)
}
