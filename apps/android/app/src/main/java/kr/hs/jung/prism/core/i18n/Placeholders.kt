package kr.hs.jung.prism.core.i18n

/**
 * `{device}` 같은 **이름 있는 자리표시자**를 채운다.
 *
 * 생성기(`i18n/client.csv` → 세 플랫폼)가 내는 문법이 `{name}`이라 Android의
 * `stringResource(id, vararg)`로는 채울 수 없다 — 그쪽은 `%s`를 기대하는 `String.format`이고,
 * 자리표시자가 그대로 남아 화면에 `Calling {device}…`가 그려진다(실제로 그렇게 나왔다).
 *
 * 이름으로 채우는 것이 위치(`%1$s`)보다 나은 이유는 번역이 어순을 바꾸기 때문이다 —
 * `{device} is calling.`이 ko에서는 기기가 뒤로 갈 수 있고, 위치 인자는 그때 어긋난다.
 *
 * 웹의 `t(key, vars)` · iOS의 `LocalizationStore.callAsFunction(key, values)`와 같은 규칙이다.
 */
fun String.withVars(vararg values: Pair<String, String>): String =
    values.fold(this) { text, (name, value) -> text.replace("{$name}", value) }
