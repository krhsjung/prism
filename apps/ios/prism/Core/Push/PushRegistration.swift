//
//  PushRegistration.swift
//  prism
//
//  Path: Core/Push/PushRegistration.swift
//

import Foundation

/// 이 기기의 알림 등록을 **앱에 하나만** 둔다 — 등록의 수명을 갖는 자리다.
///
/// 등록은 세션에 붙으므로 로그아웃과 함께 사라진다(plan/push.md §5-2). 그래서 로그인할
/// 때마다 기기에 남긴 선택(`wanted`)대로 조용히 다시 붙여야 하고(§5-16), 권한이 밖(설정)에서
/// 꺼지면 서버의 등록도 떼어 내야 하며, FCM이 토큰을 돌리면 새 값을 다시 붙여야 한다.
/// 셋 다 "지금 상태와 있어야 할 상태를 맞추는 일"이라 한 함수(`reconcile`)로 두고,
/// 그것을 부르는 계기만 여럿이다 — 로그인 · 앱이 앞으로 옴 · 내 줄의 등록 여부 변화 ·
/// 토큰 회전(`AppDelegate`).
///
/// **한 번에 하나만 돈다.** 되살리기(`RootView`)와 화면의 켜기·끄기(`PushView`)가 각자
/// 출발하면 늦게 끝난 쪽이 먼저 끝난 쪽을 조용히 덮는다 — "끄기" 뒤에 옛 등록 요청이
/// 끝나 토큰이 되살아나는 식이다. 그래서 모든 일을 한 줄로 세우고, 세션이 바뀌면(세대)
/// 진행 중이던 일의 결과를 버린다(`SessionStore.reset`과 같은 수법).
///
/// **수명은 세션이다.** 컨테이너가 들고 있어 화면 전환에는 살아남고, 로그아웃에서
/// `reset()`으로 비운다(소켓·통화·목록이 같은 자리에서 같은 일을 한다 — `RootView`).
@MainActor
final class PushRegistration {
    private let device: PushDevice
    private let service: PushServicing
    private let accessToken: () -> String?
    private let store: SessionStore

    /// 이번 세션에서 서버에 붙인 토큰. **회전을 알아채는 기준**이다 — 같은 값을 다시
    /// 붙이는 왕복을 아끼고, 다른 값이면 FCM이 토큰을 돌린 것이다.
    private var registeredToken: String?
    /// 세션의 세대. `reset()`이 올린다 — 줄 안의 일은 시작할 때의 값을 기억했다가 매
    /// await 뒤에 대조하고, 달라졌으면 결과를 버린다(앞 세션의 등록이 다음 세션에 붙지 못하게).
    private var generation = 0
    /// 한 줄로 세운 일들의 꼬리. 앞의 일이 끝나야 다음이 시작된다.
    private var tail: Task<Void, Never>?

    init(
        device: PushDevice,
        service: PushServicing,
        accessToken: @escaping () -> String?,
        store: SessionStore,
    ) {
        self.device = device
        self.service = service
        self.accessToken = accessToken
        self.store = store
    }

    /// 지금 상태와 있어야 할 상태를 맞춘다.
    ///
    ///  - 받을 수 없는데(권한 없음·미지원) 등록돼 있다 → 뗀다. **선택은 건드리지 않는다**:
    ///    사람이 끈 것이 아니라 받을 수 없게 된 것이다 — 권한이 돌아오면 그대로 살아난다
    ///  - 받을 수 있고 켜 뒀는데 이번 세션에서 아직 안 붙였거나 토큰이 바뀌었다 → 붙인다.
    ///    권한 창은 뜨지 않는다 — 이미 허용된 경우에만 토큰을 받는다
    ///
    /// 목록이 아직 없어도 붙이는 쪽은 간다 — 로그인 직후가 그 순간이고, 목록을 기다리면
    /// 그만큼 늦게 붙는다. 떼는 쪽은 목록이 있어야 한다(등록돼 있는지를 목록만 안다).
    func reconcile() {
        Task { _ = await run { gen in await self.reconcileNow(generation: gen) } }
    }

    /// 화면의 `알림 켜기` — 권한 창은 화면이 연 뒤다(명시적 제스처 뒤에만). 토큰을 받아
    /// 붙이고, **성공했을 때만** 선택을 기억한다: 실패했는데 선택만 남기면 화면은
    /// `Notifications off`를 말하면서 다음 로그인에 조용히 켜진다.
    func enable() async -> Bool {
        await run { gen in
            guard let token = await self.device.current(), gen == self.generation else {
                return false
            }
            guard await self.attach(token, generation: gen) else { return false }
            // 선택을 기기에 남긴다 — 다음 로그인에서 이 값을 보고 조용히 다시 붙는다(§5-16).
            self.device.rememberWanted(true)
            // 붙는 데 성공한 켜기는 끄다 만 것을 덮는다 — 남기면 다음 맞추기가 방금 붙인 것을 뗀다.
            self.device.rememberDisablePending(false)
            return true
        } ?? false
    }

    /// 화면의 `알림 끄기` — **끄는 것은 등록이지 권한이 아니다**(§5-15). 기기의 토큰은
    /// 그대로 두므로 다시 켤 때 권한 창이 뜨지 않는다. 서버에서 떼지 못했으면 기억도 바꾸지
    /// 않는다 — 바꿔 두면 지금은 등록된 채로 남으면서 다음 로그인부터 조용히 꺼진다. 대신
    /// **끄다 만 표식**이 남아 다음 맞추기가 이어서 뗀다(그때 선택이 꺼진다).
    func disable() async -> Bool {
        await run { gen in
            self.device.rememberDisablePending(true)
            guard await self.unregister(generation: gen) else { return false }
            // 선택은 서버에서 뗀 **직후**에 남긴다 — 뒤따르는 목록 재조회를 기다리다 앱이 죽으면
            // 선택이 켜진 채 남아 다음 실행이 조용히 다시 붙인다.
            self.device.rememberWanted(false)
            self.device.rememberDisablePending(false)
            await self.announce(generation: gen)
            return true
        } ?? false
    }

    /// FCM이 토큰을 돌렸다(`AppDelegate`) — 붙인 토큰의 기억을 비우고 지금 값을 받아 붙인다.
    func tokenRotated() {
        registeredToken = nil
        reconcile()
    }

    /// 세션이 끝났다 — 진행 중이던 일의 결과를 버리고, 붙인 토큰의 기억도 비운다(새 세션에는
    /// 아직 아무것도 붙지 않았다).
    func reset() {
        generation += 1
        registeredToken = nil
    }

    // MARK: - Private

    private func reconcileNow(generation gen: Int) async {
        // 끄다 만 것 — 떼는 도중 앱이 죽었거나 떼지 못했다. 권한·선택과 무관하게 이어서 뗀다
        // (서버에 등록이 없어도 떼기는 무해하다 — 목록을 기다릴 이유가 없다).
        if device.disablePending {
            if await unregister(generation: gen) {
                device.rememberWanted(false)
                device.rememberDisablePending(false)
                await announce(generation: gen)
            }
            return
        }
        let registered = store.sessions?.first(where: \.isCurrent)?.pushRegistered == true
        let permission = await device.permission()
        guard gen == generation else { return }
        guard permission == .granted else {
            if registered { _ = await detach(generation: gen) }
            return
        }
        guard device.wanted else { return }
        guard let token = await device.current(), gen == generation else { return }
        // 토큰을 받는 사이에 화면에서 껐을 수 있다 — 선택을 다시 읽는다.
        guard device.wanted else { return }
        // 이번 세션에서 이미 이 토큰을 붙였다 — 목록이 아직 그 사실을 모를 뿐이다.
        if token == registeredToken { return }
        _ = await attach(token, generation: gen)
    }

    /// 토큰을 서버에 붙이고 목록과 다른 기기에 알린다.
    ///
    /// ⚠️ **`true`라야 성공이다.** 서버는 그사이 그 세션이 사라졌거나 남의 것이면 던지지
    /// 않고 `false`를 돌려준다(`attachPushToken`) — 던지지 않았다고 붙은 것이 아니고,
    /// 거기서 목록을 다시 받고 남을 깨우면 안 일어난 일을 알리는 셈이다.
    private func attach(_ token: String, generation gen: Int) async -> Bool {
        // 세션이 바뀐 뒤에는 새 세션의 자격증명으로 앞 세션의 일을 보내지 않는다.
        guard gen == generation, let access = accessToken() else { return false }
        let registered = try? await service.register(token: token, accessToken: access)
        guard gen == generation, registered == true else { return false }
        registeredToken = token
        // 내 목록과 다른 기기의 목록이 함께 알아야 한다 — **스윕이 메워 주지 않는다**
        // (세션 id 목록만 대조하므로 구성원이 그대로인 변화는 보이지 않는다).
        await store.refresh(background: true)
        // 목록을 기다리는 사이 세션이 바뀌었으면 알리지도 않는다.
        guard gen == generation else { return false }
        store.notifyChanged()
        return true
    }

    /// 서버에서 뗀다 — 알리기(`announce`)와 갈라 둔다: 끄기는 뗀 직후에 선택을 남겨야 한다.
    private func unregister(generation gen: Int) async -> Bool {
        guard gen == generation, let access = accessToken() else { return false }
        do { try await service.unregister(accessToken: access) } catch { return false }
        guard gen == generation else { return false }
        registeredToken = nil
        return true
    }

    /// 목록과 다른 기기에 알린다. 떼는 쪽이 더 중요하다 — 낡은 값은 "이 기기는 알림으로 깨울
    /// 수 있다"는 거짓이 된다.
    private func announce(generation gen: Int) async {
        await store.refresh(background: true)
        guard gen == generation else { return }
        store.notifyChanged()
    }

    private func detach(generation gen: Int) async -> Bool {
        guard await unregister(generation: gen) else { return false }
        await announce(generation: gen)
        return true
    }

    /// 줄의 끝에 일을 하나 세운다. 앞의 일이 끝난 뒤에야 돌고, 줄을 선 시점의 세대를 받는다.
    /// 줄을 서는 동안 세션이 바뀌었으면 **시작조차 하지 않는다** — 앞 세션의 끄기가 다음
    /// 사람의 등록을 떼는 식의 일을 막는다. 그 경우 `nil`을 돌려준다.
    private func run<T: Sendable>(_ body: @escaping @MainActor (Int) async -> T) async -> T? {
        let previous = tail
        let gen = generation
        let task = Task { () -> T? in
            await previous?.value
            guard gen == self.generation else { return nil }
            return await body(gen)
        }
        tail = Task { _ = await task.value }
        return await task.value
    }
}
