package kr.hs.jung.prism.core.push

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kr.hs.jung.prism.domain.model.PushDataKey

/**
 * 알림이 열어 달라고 한 통화.
 *
 * 두 경로가 여기로 모인다: 앱이 꺼져 있을 때 시스템이 그린 알림을 누른 경우
 * (`MainActivity`의 인텐트 엑스트라)와, 앱이 떠 있을 때 온 메시지
 * (`PrismMessagingService`). 화면은 이 값을 **한 번만** 소비하고 비운다 —
 * 남겨 두면 화면을 되돌아올 때마다 같은 통화를 다시 열려 한다.
 *
 * 프로세스 메모리다. 앱이 죽으면 사라지고, 그러면 알림을 다시 누르는 것이 유일한
 * 경로가 된다 — **부재중 기록을 만들지 않기로 한 결정**과 같은 자리다(plan/webrtc.md §2).
 */
object PushLinks {
    private val _pendingCallId = MutableStateFlow<String?>(null)
    val pendingCallId: StateFlow<String?> = _pendingCallId

    fun offer(callId: String) {
        _pendingCallId.value = callId
    }

    /** 인텐트 엑스트라에서 통화 알림을 읽는다. 통화가 아니면 아무것도 하지 않는다. */
    fun offerFrom(extras: android.os.Bundle?) {
        offerFrom(
            kind = extras?.getString(PushDataKey.KIND),
            callId = extras?.getString(PushDataKey.CALL_ID),
        )
    }

    /**
     * 판단만 하는 자리 — `Bundle`을 만들 수 없는 JVM 테스트가 여기를 본다.
     *
     * 데모 알림은 통화 화면을 열지 않는다. `callId` 없는 통화 알림도 마찬가지다 —
     * 열어 봐야 물을 것이 없다.
     */
    fun offerFrom(kind: String?, callId: String?) {
        if (kind != PUSH_KIND_CALL) return
        if (callId.isNullOrBlank()) return
        offer(callId)
    }

    fun consume() {
        _pendingCallId.value = null
    }
}

/** 계약의 `PUSH_KINDS` 중 통화 갈래. */
const val PUSH_KIND_CALL = "call"
