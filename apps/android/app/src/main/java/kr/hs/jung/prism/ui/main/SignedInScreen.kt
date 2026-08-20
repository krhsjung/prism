package kr.hs.jung.prism.ui.main

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import kr.hs.jung.prism.R
import kr.hs.jung.prism.core.i18n.LocaleStore
import kr.hs.jung.prism.core.theme.PrismDimensions
import kr.hs.jung.prism.core.theme.PrismTheme
import kr.hs.jung.prism.core.theme.ThemeStore
import kr.hs.jung.prism.domain.model.User
import kr.hs.jung.prism.ui.component.LocaleSwitcher
import kr.hs.jung.prism.ui.component.PrismButton
import kr.hs.jung.prism.ui.component.PrismButtonVariant
import kr.hs.jung.prism.ui.component.PrismCard
import kr.hs.jung.prism.ui.component.ThemeSwitcher

/**
 * 로그인 뒤에 착지하는 자리 — **임시 화면**이다.
 *
 * 대시보드(세션 목록·Revoke 등)는 별도 슬라이스이고(plan/dashboard.md §7), 여기서는
 * 로그인이 끝까지 갔는지 눈으로 확인하고 되돌아올 수 있는 최소한만 그린다.
 * 문구는 이미 마스터에 있는 대시보드 키를 그대로 쓴다.
 */
@Composable
fun SignedInScreen(
    user: User,
    themeStore: ThemeStore,
    localeStore: LocaleStore,
    onSignOut: () -> Unit,
) {
    val colors = PrismTheme.colors
    var signingOut by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(colors.surface)
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
        PrismCard {
            Text(
                text = stringResource(R.string.dashboard_title),
                color = colors.heading,
                fontSize = PrismDimensions.fontTitle,
                fontWeight = FontWeight.ExtraBold,
            )
            Text(
                // 마스터는 `{name}` 형식의 런타임 변수를 쓴다(웹·iOS와 공통). Android의
                // `%s` 포맷이 아니므로 raw 문자열을 읽어 직접 치환한다.
                text = stringResource(R.string.dashboard_signed_in_as)
                    .replace("{name}", user.displayName),
                color = colors.muted,
                fontSize = PrismDimensions.fontBody,
            )
            Text(
                text = stringResource(R.string.dashboard_placeholder_body),
                color = colors.muted,
                fontSize = PrismDimensions.fontBody,
            )
            PrismButton(
                text = stringResource(
                    if (signingOut) R.string.dashboard_logging_out else R.string.dashboard_log_out,
                ),
                variant = PrismButtonVariant.SECONDARY,
                enabled = !signingOut,
                onClick = {
                    signingOut = true
                    onSignOut()
                },
            )
        }

        Row(horizontalArrangement = Arrangement.spacedBy(PrismDimensions.spacingSm)) {
            ThemeSwitcher(themeStore)
            LocaleSwitcher(localeStore)
        }
    }
}
