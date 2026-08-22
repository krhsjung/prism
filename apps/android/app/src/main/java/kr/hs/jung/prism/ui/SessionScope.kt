package kr.hs.jung.prism.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.viewmodel.compose.LocalViewModelStoreOwner
import androidx.lifecycle.viewmodel.compose.viewModel

/**
 * 로그인한 화면들의 ViewModel이 **세션과 함께 살고 죽게** 한다.
 *
 * 기본값(`LocalViewModelStoreOwner` = Activity)으로 두면 로그아웃해서 화면이 사라져도
 * ViewModel은 Activity에 남는다. 다시 로그인하면 팩토리를 부르지 않고 그 인스턴스를 그대로
 * 돌려주므로, **앞 세션의 목록이 새 세션의 화면에 그려진다**(`init`의 최초 로드도 다시
 * 돌지 않는다). 실제로 그렇게 보였다.
 *
 * 그렇다고 `viewModel(key = 세션)`만 주면 화면은 새로 만들어지지만 **앞 세션의 인스턴스가
 * Activity에 계속 쌓인다**. 그래서 key가 아니라 **저장소 자체**를 세션마다 갈아 끼우고,
 * 갈아 끼울 때 앞 저장소를 비운다(`clear()` → 각 ViewModel의 `onCleared()` → 코루틴 종료).
 *
 * 저장소를 쥐는 [SessionScopeHolder]는 Activity에 붙어 있어 **화면 회전에는 살아남는다** —
 * 세션이 바뀔 때만 갈린다. 회전할 때마다 목록을 다시 불러오면 그때마다 깜빡이기 때문이다.
 *
 * @param generation 세션의 세대(`AuthManager.State.SignedIn.generation`).
 */
@Composable
fun SessionScope(generation: Long, content: @Composable () -> Unit) {
    val holder: SessionScopeHolder = viewModel()
    val store = remember(holder, generation) { holder.storeFor(generation) }
    val owner = remember(store) {
        object : ViewModelStoreOwner {
            override val viewModelStore = store
        }
    }
    CompositionLocalProvider(LocalViewModelStoreOwner provides owner, content = content)
}

/**
 * 세션 하나짜리 ViewModel 저장소를 쥐고, 세션이 바뀌면 앞 것을 비운 뒤 새로 만든다.
 *
 * 이 홀더 자체는 Activity에 붙는다 — 회전에도 같은 저장소를 돌려주려면 그래야 한다.
 */
class SessionScopeHolder : ViewModel() {
    private var generation: Long? = null
    private var store = ViewModelStore()

    fun storeFor(generation: Long): ViewModelStore {
        if (this.generation != generation) {
            store.clear()
            store = ViewModelStore()
            this.generation = generation
        }
        return store
    }

    override fun onCleared() {
        store.clear()
    }
}
