package kr.hs.jung.prism.feature.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import android.app.Activity
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.compose.foundation.background
import androidx.compose.material3.Text
import kr.hs.jung.prism.R
import kr.hs.jung.prism.core.i18n.LocaleStore
import kr.hs.jung.prism.core.theme.PrismDimensions
import kr.hs.jung.prism.core.theme.PrismTheme
import kr.hs.jung.prism.core.theme.ThemeStore
import kr.hs.jung.prism.domain.model.AuthProvider
import kr.hs.jung.prism.ui.component.LocaleSwitcher
import kr.hs.jung.prism.ui.component.PrismButton
import kr.hs.jung.prism.ui.component.PrismButtonVariant
import kr.hs.jung.prism.ui.component.PrismCard
import kr.hs.jung.prism.ui.component.PreferenceControls
import kr.hs.jung.prism.ui.component.PreferenceControlsPlacement
import kr.hs.jung.prism.ui.component.PrismErrorAlert
import kr.hs.jung.prism.ui.component.ThemeSwitcher

/**
 * 로그인 화면.
 *
 * 구성은 웹 로그인 화면(apps/web/src/pages/LoginPage.tsx)과 같다: 워드마크 · 카드
 * (제목 · 부제 · 오류 · 버튼 셋 · 안내 문구) · 환경 설정 줄. **가입 화면이 없다** —
 * Google/Apple은 첫 로그인에 자동 가입되고 데모는 시드 계정을 쓰므로 푸터를 두지 않는다.
 */
@Composable
fun LoginScreen(
    authManager: AuthManager,
    themeStore: ThemeStore,
    localeStore: LocaleStore,
) {
    val viewModel: LoginViewModel = viewModel(
        factory = viewModelFactory { initializer { LoginViewModel(authManager) } },
    )
    val state by viewModel.state.collectAsStateWithLifecycle()
    // 사용자가 스스로 로그아웃한 것이 아니라 서버가 세션을 끊어 여기로 온 경우 —
    // 이유를 알려 주지 않으면 대시보드에서 그냥 튕긴 것으로 보인다.
    val endedUnexpectedly by authManager.endedUnexpectedly.collectAsStateWithLifecycle()
    val colors = PrismTheme.colors

    // 내용이 짧으면 세로 가운데(웹의 justify-content: center), 큰 글씨·작은 화면에서
    // 넘치면 스크롤된다.
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.surface)
            .verticalScroll(rememberScrollState())
            .padding(
                horizontal = PrismDimensions.screenHorizontalPadding,
                vertical = PrismDimensions.spacingXl,
            ),
        verticalArrangement = Arrangement.spacedBy(
            PrismDimensions.spacingXl,
            Alignment.CenterVertically,
        ),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // 워드마크는 번역하지 않는다 — 로고 텍스트는 언어와 무관한 고유명사다.
        Text(
            text = "Prism",
            color = colors.heading,
            fontSize = PrismDimensions.fontTitle,
            fontWeight = FontWeight.ExtraBold,
        )

        PrismCard {
            Text(
                text = stringResource(R.string.auth_welcome_back),
                color = colors.heading,
                fontSize = PrismDimensions.fontTitle,
                fontWeight = FontWeight.ExtraBold,
            )
            Text(
                text = stringResource(R.string.auth_sign_in_to_continue),
                color = colors.muted,
                fontSize = PrismDimensions.fontBody,
            )

            if (endedUnexpectedly) {
                PrismErrorAlert(message = stringResource(R.string.error_session_ended))
            }
            state.errorRes?.let { PrismErrorAlert(message = stringResource(it)) }

            Column(verticalArrangement = Arrangement.spacedBy(PrismDimensions.spacingSm)) {
                // 각 provider를 native(SDK)·redirect(웹) 두 방식으로 나눠 보여 준다(iOS와 동일).
                // **Apple은 redirect뿐이다** — 안드로이드에는 공식 네이티브 Sign in with
                // Apple SDK가 없어(plan/auth.md §8) native 버튼은 눌러도 "사용할 수 없다"만
                // 뜬다. 누를 수 없는 버튼을 두는 대신 되는 경로 하나만 남긴다.
                SignInButton(AuthProvider.GOOGLE, AuthMethod.NATIVE, PrismButtonVariant.OUTLINE, state, viewModel)
                SignInButton(AuthProvider.GOOGLE, AuthMethod.REDIRECT, PrismButtonVariant.OUTLINE, state, viewModel)
                SignInButton(AuthProvider.APPLE, AuthMethod.REDIRECT, PrismButtonVariant.PRIMARY, state, viewModel)
                SignInButton(AuthProvider.KAKAO, AuthMethod.NATIVE, PrismButtonVariant.KAKAO, state, viewModel)
                SignInButton(AuthProvider.KAKAO, AuthMethod.REDIRECT, PrismButtonVariant.KAKAO, state, viewModel)
                // 데모는 부차 액션이라 한 단계 낮은 위계로 둔다(웹과 같은 variant). native만 있다.
                SignInButton(AuthProvider.DEMO, AuthMethod.NATIVE, PrismButtonVariant.SECONDARY, state, viewModel)
            }

            Text(
                text = stringResource(R.string.auth_no_personal_data),
                color = colors.muted,
                fontSize = PrismDimensions.fontBody,
            )
        }

        PreferenceControls(themeStore, localeStore, PreferenceControlsPlacement.BAR)
    }
}

@Composable
private fun SignInButton(
    provider: AuthProvider,
    method: AuthMethod,
    variant: PrismButtonVariant,
    state: LoginUiState,
    viewModel: LoginViewModel,
) {
    // 네이티브 SDK(Google/Kakao)·브라우저 탭(redirect)은 Activity가 있어야 뜬다. Compose의
    // LocalContext는 이 화면을 호스팅하는 ComponentActivity다.
    val activity = LocalContext.current as? Activity
    val option = AuthOption(provider, method)
    val isConnecting = state.pending == option
    // 진행 중인 버튼만 "Connecting…"으로. 방식 태그(native/redirect)는 데모·진행중이 아닐 때만 붙인다.
    val label = when {
        isConnecting -> stringResource(R.string.auth_connecting)
        provider == AuthProvider.DEMO -> stringResource(provider.labelRes)
        else -> "${stringResource(provider.labelRes)} (${method.name.lowercase()})"
    }
    PrismButton(
        text = label,
        variant = variant,
        // 하나가 진행 중이면 전부 잠근다 — 두 흐름이 겹치면 나중 것이 앞선 세션을 덮어써
        // 어느 쪽으로 로그인됐는지 알 수 없게 된다.
        enabled = !state.isBusy,
        onClick = { viewModel.signIn(option, activity) },
    )
}
