package kr.hs.jung.prism.ui.component

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.font.FontWeight
import kr.hs.jung.prism.core.theme.PrismDimensions
import kr.hs.jung.prism.core.theme.PrismTheme

/**
 * 사용자 아바타 — 디자인의 `Atom/Avatar`.
 *
 * 이미지를 쓰지 않는다. provider의 프로필 사진을 저장·중계하면 개인정보 미저장 원칙이
 * 깨지고(plan/auth.md §7), 원격 이미지를 그대로 걸면 리뷰어의 방문이 provider 쪽에
 * 남는다. 표시 이름에서 뽑은 이니셜로 대신한다(웹 `Avatar`와 같은 규칙).
 *
 * 스크린리더에는 읽히지 않게 한다 — 이니셜은 옆의 이름을 줄인 장식이라, 읽어 주면
 * 같은 이름이 두 번 나온다.
 */
@Composable
fun PrismAvatar(name: String, modifier: Modifier = Modifier) {
    val colors = PrismTheme.colors
    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier
            .size(PrismDimensions.avatarSize)
            .background(colors.primary, CircleShape)
            .clearAndSetSemantics {},
    ) {
        Text(
            text = initials(name),
            color = colors.primaryForeground,
            fontSize = PrismDimensions.fontLabel,
            fontWeight = FontWeight.Bold,
        )
    }
}

/**
 * 표시 이름 → 최대 두 글자.
 *
 * 라틴 이름은 단어별 첫 글자를 모으고(`Alex Kim` → `AK`), 한글·일본어는 앞 한 글자만
 * 쓴다 — `정희석`을 `정희`로 자르면 이름이 아니라 다른 단어로 읽힌다. 코드 포인트
 * 단위로 잘라 이모지·서로게이트 쌍이 깨지지 않게 한다(웹 `Avatar`와 같은 규칙).
 */
internal fun initials(name: String): String {
    val words = name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
    val first = words.getOrNull(0)?.codePoints()?.findFirst()?.orElse(-1) ?: -1
    if (first < 0) return "?"
    val firstChar = String(Character.toChars(first))
    if (words.size == 1 || isCjk(first)) return firstChar.uppercase()
    val second = words[1].codePoints().findFirst().orElse(-1)
    if (second < 0) return firstChar.uppercase()
    return (firstChar + String(Character.toChars(second))).uppercase()
}

private fun isCjk(cp: Int): Boolean =
    (cp in 0x3040..0x30ff) || // 히라가나·가타카나
        (cp in 0x3400..0x9fff) || // 한자
        (cp in 0xac00..0xd7af) // 한글 음절
