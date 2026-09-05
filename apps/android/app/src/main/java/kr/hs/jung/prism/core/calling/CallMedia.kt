package kr.hs.jung.prism.core.calling

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import androidx.core.content.ContextCompat
import kr.hs.jung.prism.R
import kr.hs.jung.prism.core.i18n.withVars
import kr.hs.jung.prism.core.util.AppLog
import org.webrtc.AudioTrack
import org.webrtc.Camera2Enumerator
import org.webrtc.CameraVideoCapturer
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.MediaConstraints
import org.webrtc.PeerConnectionFactory
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import org.webrtc.audio.JavaAudioDeviceModule

/*
 * 카메라·마이크를 여는 자리. `PeerConnection`은 여기를 지나지 않는다 — 미디어를 얻는
 * 일과 그것을 나르는 일을 갈라 두면, 권한 실패가 통화 실패와 섞이지 않는다
 * (웹 `lib/webrtc/media.ts`와 같은 경계).
 */

/** 선택 메뉴 한 줄. */
data class MediaDeviceOption(val id: String, val label: String)

/**
 * 미디어를 얻지 못한 이유. 화면이 갈라 그려야 하는 것은 이 셋뿐이다.
 *  - DENIED:      사용자가 거부했다 → 화면의 **목적이** 통화 시작에서 권한 고치기로 바뀐다
 *  - NOT_FOUND:   카메라·마이크가 없다 → 고칠 수 있는 것은 기기 쪽이다
 *  - UNAVAILABLE: 다른 앱이 쥐고 있거나 하드웨어가 답하지 않는다 → 다시 시도가 뜻이 있다
 */
enum class MediaErrorKind { DENIED, NOT_FOUND, UNAVAILABLE }

/**
 * 카메라·마이크·트랙을 쥐고 있는 자리.
 *
 * **팩토리는 하나뿐이다.** [PeerConnectionFactory]는 무겁고(인코더·디코더·오디오 장치를
 * 통째로 세운다) 여러 개를 만들면 오디오 장치를 서로 뺏는다. 통화가 끝나도 팩토리는
 * 남기고 **트랙과 캡처만** 놓는다.
 */
class CallMedia(private val context: Context) {

    /**
     * 해상도를 **고르게 하지 않는다**(plan/webrtc.md §4). 원하는 값만 주고 실제로 무엇이
     * 잡혔는지는 진단의 `Video` 지표가 말한다 — 고르게 하면 기기가 지원하지 않는 조합에서
     * 조용히 실패하고, 그 실패를 설명하는 화면을 또 만들어야 한다.
     */
    companion object {
        private const val IDEAL_WIDTH = 1_280
        private const val IDEAL_HEIGHT = 720
        private const val IDEAL_FPS = 30

        /** 통화가 시작되는 순간에만 묻는다(plan/webrtc.md §7). */
        val PERMISSIONS = arrayOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)

        /**
         * 통화 입력으로 뜻이 있는 종류만.
         *
         * `getDevices`는 FM 튜너·텔레포니·루프백까지 함께 돌려주는데, 그것들을 목록에
         * 세우면 **고를 수 있지만 골라선 안 되는 줄**이 생긴다.
         *
         * `TYPE_USB_HEADSET`은 API 26에 생겼고 우리 하한은 24다. 상수는 컴파일에 값으로
         * 박히고 이 집합은 **런타임 값과 견주기만** 하므로, 낮은 기기에서는 그 값을
         * 보고하는 장치가 없어 그냥 걸리지 않는다 — 버전으로 가르면 분기만 늘고 결과는 같다.
         */
        @SuppressLint("InlinedApi")
        private val CALL_INPUT_TYPES = setOf(
            AudioDeviceInfo.TYPE_BUILTIN_MIC,
            AudioDeviceInfo.TYPE_WIRED_HEADSET,
            AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
            AudioDeviceInfo.TYPE_USB_DEVICE,
            AudioDeviceInfo.TYPE_USB_HEADSET,
        )
    }

    /** 렌더러와 캡처가 **같은 EGL 문맥**을 나눠 써야 프레임이 복사 없이 흐른다. */
    val eglBase: EglBase = EglBase.create()

    val factory: PeerConnectionFactory

    /** 마이크를 고를 수 있게 하는 자리 — 기본 모듈에는 이 손잡이가 없다. */
    private val audioModule: JavaAudioDeviceModule

    var localVideoTrack: VideoTrack? = null
        private set
    var localAudioTrack: AudioTrack? = null
        private set

    /** 지금 잡고 있는 카메라. 장치를 바꿀 때 같은 것을 다시 여는 일을 막는다. */
    var cameraId: String? = null
        private set
    var microphoneId: String? = null
        private set

    private var videoSource: VideoSource? = null
    private var capturer: CameraVideoCapturer? = null
    private var surfaceHelper: SurfaceTextureHelper? = null

    /** 통화 전의 오디오 모드. 끝나면 그대로 되돌린다 — 앱이 시스템 상태를 물려받지 않게. */
    private var previousAudioMode: Int? = null
    private var audioFocus: AudioFocusRequest? = null

    init {
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context)
                .createInitializationOptions(),
        )
        // **오디오 모듈을 직접 세운다.** 기본 모듈을 쓰면 녹음 장치에 손이 닿지 않아
        // 마이크를 고를 수 없다 — `setPreferredInputDevice`가 여기에만 있다.
        audioModule = JavaAudioDeviceModule.builder(context)
            .setUseHardwareAcousticEchoCanceler(true)
            .setUseHardwareNoiseSuppressor(true)
            .createAudioDeviceModule()
        factory = PeerConnectionFactory.builder()
            .setAudioDeviceModule(audioModule)
            .setVideoEncoderFactory(
                DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true),
            )
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglBase.eglBaseContext))
            .createPeerConnectionFactory()
    }

    /**
     * 이 앱이 **이미 카메라·마이크를 쓸 수 있는가.**
     *
     * 웹은 "장치 이름이 채워졌는가"로 이것을 알아내지만(브라우저가 허용 뒤에야 이름을
     * 준다), Android에는 상태를 직접 묻는 API가 있다 — 같은 질문에 대한 **더 정확한
     * 답**이라 그쪽을 쓴다. 어느 쪽이든 카메라를 열지 않으므로 표시등도 켜지지 않는다.
     */
    fun isAuthorized(): Boolean = PERMISSIONS.all {
        ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
    }

    /**
     * 고를 수 있는 장치들.
     *
     * 권한 전에도 부를 수 있지만 화면은 **허용된 뒤에만** 이것을 그린다 — 고를 수 없는
     * 목록을 띄우면 눌러도 아무 일이 없는 자리가 된다.
     *
     * 마이크는 [AudioManager]가 세고, 고른 것은 [JavaAudioDeviceModule.setPreferredInputDevice]로
     * 녹음 장치에 건다. **시스템이 꽂힌 장치로 알아서 옮겨 가는 것은 기본값일 뿐**이라,
     * 사용자가 그것을 덮어쓸 수 있다(웹·iOS와 같다).
     */
    fun devices(): Pair<List<MediaDeviceOption>, List<MediaDeviceOption>> {
        val enumerator = Camera2Enumerator(context)
        val cameras = enumerator.deviceNames.map { name ->
            MediaDeviceOption(
                id = name,
                // 이름은 카메라 id뿐이라(`0`·`1`) 앞/뒤를 사람이 읽을 말로 붙인다.
                // **번역을 거쳐야 한다** — iOS는 `localizedName`을, 웹은 브라우저가 준
                // 이름을 쓰는데 여기만 영어를 박아 두면 ko·ja에서 `Front camera`가 뜬다.
                label = when {
                    enumerator.isFrontFacing(name) ->
                        context.getString(R.string.webrtc_camera_front)
                    enumerator.isBackFacing(name) ->
                        context.getString(R.string.webrtc_camera_back)
                    else ->
                        context.getString(R.string.webrtc_camera_other).withVars("name" to name)
                },
            )
        }
        return cameras to microphones()
    }

    /**
     * 통화에 쓸 만한 입력 장치들.
     *
     * `getDevices`는 통화와 상관없는 것(FM 튜너·텔레포니·루프백)까지 돌려주므로 **쓸 수 있는
     * 종류만 남긴다.** 내장 마이크가 여러 개인 기기가 있어(위/아래) 종류+이름으로 접는다 —
     * 사용자에게 `내장 마이크`가 셋 보이는 것은 고르는 데 도움이 되지 않는다.
     */
    private fun microphones(): List<MediaDeviceOption> {
        val manager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
            ?: return emptyList()
        val seen = mutableSetOf<String>()
        return manager.getDevices(AudioManager.GET_DEVICES_INPUTS)
            .filter { it.type in CALL_INPUT_TYPES }
            .mapNotNull { info ->
                val label = label(info)
                if (!seen.add("${'$'}{info.type}:${'$'}label")) return@mapNotNull null
                MediaDeviceOption(id = info.id.toString(), label = label)
            }
    }

    /**
     * 장치 이름은 **종류로 부른다.**
     *
     * `productName`은 기기 모델명(`SM-G991N`)인 경우가 흔해 "어느 마이크인가"에 답하지 못한다.
     * iOS가 `portName`으로 `iPhone Microphone`을 주는 것과 같은 자리라, 종류를 번역해 쓴다.
     */
    private fun label(info: AudioDeviceInfo): String = when (info.type) {
        AudioDeviceInfo.TYPE_BUILTIN_MIC -> context.getString(R.string.webrtc_mic_builtin)
        AudioDeviceInfo.TYPE_WIRED_HEADSET -> context.getString(R.string.webrtc_mic_wired)
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> context.getString(R.string.webrtc_mic_bluetooth)
        AudioDeviceInfo.TYPE_USB_DEVICE, AudioDeviceInfo.TYPE_USB_HEADSET ->
            context.getString(R.string.webrtc_mic_usb)
        else -> context.getString(R.string.webrtc_mic_other)
            .withVars("name" to info.productName.toString())
    }

    /**
     * 고른 마이크를 녹음 장치에 건다.
     *
     * 녹음이 아직 시작되지 않았어도 안전하다 — 모듈이 값을 쥐고 있다가 `AudioRecord`를
     * 만들 때 얹는다. 이미 돌고 있으면 그 자리에서 갈아 끼운다.
     */
    private fun applyMicrophone(id: String?) {
        val manager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
        val chosen = id?.let { wanted ->
            manager.getDevices(AudioManager.GET_DEVICES_INPUTS)
                .firstOrNull { it.id.toString() == wanted && it.type in CALL_INPUT_TYPES }
        }
        // `null`이면 시스템 기본으로 되돌린다 — 고른 장치가 빠졌을 때의 정상 결말이다.
        audioModule.setPreferredInputDevice(chosen)
    }

    /**
     * 카메라·마이크를 연다. 실패하면 이유를 돌려주고 트랙은 그대로 둔다.
     *
     * **고른 장치가 없으면 기본 장치로 연다.** 사라진 장치를 고집하다 통화를 통째로
     * 포기하는 것은 과하다 — 어느 장치로 붙었는지는 진단이 말해 준다.
     */
    fun open(wantedCamera: String?, wantedMicrophone: String?): MediaErrorKind? {
        if (!isAuthorized()) return MediaErrorKind.DENIED
        enterCallAudio()

        val enumerator = Camera2Enumerator(context)
        val names = enumerator.deviceNames
        if (names.isEmpty()) return MediaErrorKind.NOT_FOUND
        // 앞면 카메라가 기본이다 — 통화의 기본 피사체는 내 얼굴이다.
        val name = names.firstOrNull { it == wantedCamera }
            ?: names.firstOrNull { enumerator.isFrontFacing(it) }
            ?: names[0]

        return try {
            if (cameraId != null && cameraId != name) {
                // 캡처러 하나가 두 장치를 동시에 열 수 없다 — 바꿀 때만 실제로 일어난다.
                stopCapture()
            }
            if (capturer == null) {
                val created = enumerator.createCapturer(name, null)
                    ?: return MediaErrorKind.UNAVAILABLE
                val source = factory.createVideoSource(false)
                val helper = SurfaceTextureHelper.create("PrismCapture", eglBase.eglBaseContext)
                // ⚠️ **소유권을 먼저 넘긴다.** `initialize`·`startCapture`는 던지는
                // 자리다(다른 앱이 카메라를 쥐고 있다). 지역 변수인 채로 던지면
                // `release()`가 이것들을 찾지 못해, 다시 시도할 때마다 EGL 스레드와
                // 카메라 핸들이 쌓인다 — 결국 카메라가 아예 열리지 않는다.
                capturer = created
                videoSource = source
                surfaceHelper = helper
                created.initialize(helper, context, source.capturerObserver)
                created.startCapture(IDEAL_WIDTH, IDEAL_HEIGHT, IDEAL_FPS)
                localVideoTrack = factory.createVideoTrack("prism-video", source)
            }
            if (localAudioTrack == null) {
                localAudioTrack = factory.createAudioTrack(
                    "prism-audio",
                    factory.createAudioSource(MediaConstraints()),
                )
            }
            cameraId = name
            microphoneId = wantedMicrophone
            applyMicrophone(wantedMicrophone)
            null
        } catch (error: RuntimeException) {
            // 카메라를 다른 앱이 쥐고 있거나 하드웨어가 답하지 않는다. 화면은 세 갈래로만
            // 말하므로 원래 사정은 개발 로그가 갖는다.
            AppLog.e("camera_capture_failed", error)
            // 반쯤 연 것을 그대로 두지 않는다 — 위에서 소유권을 넘겨 두었으므로
            // 여기서 놓을 수 있다.
            release()
            MediaErrorKind.UNAVAILABLE
        }
    }

    /** 카메라를 바꾼다 — 트랙은 그대로 두고 캡처만 갈아 끼운다(재협상이 필요 없다). */
    fun switchCamera(id: String) {
        val target = capturer ?: return
        target.switchCamera(object : CameraVideoCapturer.CameraSwitchHandler {
            override fun onCameraSwitchDone(isFront: Boolean) {
                cameraId = id
            }

            override fun onCameraSwitchError(message: String?) {
                // 못 바꿔도 통화는 지금 카메라로 이어진다 — 끊을 이유가 아니다.
                AppLog.e("camera_switch_failed: $message")
            }
        })
    }

    /** 마이크를 바꾼다 — 트랙은 그대로 두고 녹음 장치만 갈아 끼운다(재협상이 필요 없다). */
    fun switchMicrophone(id: String) {
        microphoneId = id
        applyMicrophone(id)
    }

    /**
     * 카메라·마이크를 **놓는다.** 표시등이 꺼지는 것이 이 함수의 관찰 가능한 결과다.
     *
     * 트랙을 `setEnabled(false)`로 끄는 것(음소거·카메라 오프)과 다르다 — 그쪽은 장치를
     * 계속 쥔 채 신호만 죽이므로 표시등이 켜져 있다. 통화가 끝났는데 표시등이 남으면
     * 사용자는 우리가 아직 보고 있다고 읽는다.
     */
    /**
     * 오디오를 **통화용으로** 세운다.
     *
     * 하지 않으면 모드가 `NORMAL`인 채로 남아 두 가지가 어긋난다: 소리가 귀에 대는
     * 수화기로 나가고(영상통화인데), 통화 모드가 아니라서 하드웨어 에코 제거가 물리지
     * 않아 상대에게 내 소리가 되돌아간다. 포커스를 청하는 것은 음악·알림을 함께
     * 조용하게 만드는 자리다.
     *
     * 실패해도 통화는 선다 — 라우팅이 기본값일 뿐이라 여기서 통화를 접지 않는다.
     */
    private fun enterCallAudio() {
        val manager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
        if (previousAudioMode == null) previousAudioMode = manager.mode
        runCatching {
            requestFocus(manager)
            manager.mode = AudioManager.MODE_IN_COMMUNICATION
            // 영상통화의 기본 출력은 스피커다(손에 들고 화면을 본다). 이어폰·블루투스가
            // 꽂혀 있으면 시스템이 그쪽을 고르므로, 이 값은 "아무것도 없을 때"의 답이다.
            speakerOn(manager)
        }.onFailure { AppLog.e("audio_route_failed", it) }
    }

    /** 음악·알림을 함께 조용하게 만든다. API 26 아래에는 요청 객체가 없다. */
    private fun requestFocus(manager: AudioManager) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            @Suppress("DEPRECATION")
            manager.requestAudioFocus(
                null,
                AudioManager.STREAM_VOICE_CALL,
                AudioManager.AUDIOFOCUS_GAIN,
            )
            return
        }
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            .build()
        manager.requestAudioFocus(request)
        audioFocus = request
    }

    private fun abandonFocus(manager: AudioManager) {
        val request = audioFocus
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || request == null) {
            @Suppress("DEPRECATION")
            manager.abandonAudioFocus(null)
            return
        }
        manager.abandonAudioFocusRequest(request)
    }

    private fun speakerOn(manager: AudioManager) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            @Suppress("DEPRECATION")
            manager.isSpeakerphoneOn = true
            return
        }
        // API 31부터 `isSpeakerphoneOn`은 무시될 수 있다 — 라우팅은 장치를 고르는 쪽이다.
        val speaker = manager.availableCommunicationDevices
            .firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
        // 이어폰·블루투스가 이미 골라져 있으면 그대로 둔다.
        val current = manager.communicationDevice?.type
        val wired = current == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
            current == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
            current == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
        if (!wired && speaker != null) manager.setCommunicationDevice(speaker)
    }

    /** 통화 전의 오디오 상태로 되돌린다. */
    private fun exitCallAudio() {
        val manager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                manager.clearCommunicationDevice()
            } else {
                @Suppress("DEPRECATION")
                manager.isSpeakerphoneOn = false
            }
            previousAudioMode?.let { manager.mode = it }
            abandonFocus(manager)
        }.onFailure { AppLog.e("audio_restore_failed", it) }
        previousAudioMode = null
        audioFocus = null
    }

    fun release() {
        exitCallAudio()
        stopCapture()
        localVideoTrack?.dispose()
        localVideoTrack = null
        localAudioTrack?.dispose()
        localAudioTrack = null
        videoSource?.dispose()
        videoSource = null
        cameraId = null
    }

    private fun stopCapture() {
        runCatching { capturer?.stopCapture() }
        capturer?.dispose()
        capturer = null
        surfaceHelper?.dispose()
        surfaceHelper = null
    }

    /** 트랙을 **멈추지 않고 끄기만** 한다 — 다시 켤 때 권한을 새로 묻지 않는다. */
    fun setEnabled(video: Boolean? = null, audio: Boolean? = null) {
        video?.let { localVideoTrack?.setEnabled(it) }
        audio?.let { localAudioTrack?.setEnabled(it) }
    }

    /** 앱이 통째로 사라질 때의 안전망. */
    fun dispose() {
        release()
        factory.dispose()
        audioModule.release()
        eglBase.release()
    }
}
