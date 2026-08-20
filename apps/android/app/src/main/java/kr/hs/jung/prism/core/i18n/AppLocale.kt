package kr.hs.jung.prism.core.i18n

/**
 * 지원 언어 — i18n/locales.json의 순서 그대로이며, 첫 항목이 기본 언어다.
 *
 * `tag`는 안드로이드 리소스가 쓰는 BCP 47 코드(= `values-{tag}`)이고, `label`은 목록에
 * 그리는 이름이다. 각 언어를 **그 언어로** 적는다 — 지금 화면 언어를 못 읽는 사용자가
 * 쓰는 장치라, 현재 언어로 번역해 두면 정작 필요한 사람이 자기 언어를 찾지 못한다.
 */
enum class AppLocale(val tag: String, val label: String) {
    EN("en", "English"),
    KO("ko", "한국어"),
    JA("ja", "日本語");

    companion object {
        /** 기본 언어(첫 항목). */
        val fallback: AppLocale get() = entries.first()

        /**
         * BCP 47 태그를 지원 언어로 좁힌다 — 하위 태그를 뒤에서부터 하나씩 떼며 맞춰 본다
         * (`ko-KR` → `ko`). 시스템이 주는 값은 거의 항상 지역까지 붙어 있어 정확히
         * 일치하는 경우가 오히려 드물다. 웹의 `toLocale`과 같은 규칙이다.
         */
        fun matching(tag: String): AppLocale? {
            var candidate = tag.trim().lowercase()
            while (candidate.isNotEmpty()) {
                entries.firstOrNull { it.tag.lowercase() == candidate }?.let { return it }
                val cut = candidate.lastIndexOf('-')
                if (cut < 0) return null
                candidate = candidate.substring(0, cut)
            }
            return null
        }

        /** 선호 순서대로 훑어 처음 지원되는 언어를 고른다. 하나도 없으면 기본 언어. */
        fun negotiated(preferred: List<String>): AppLocale =
            preferred.firstNotNullOfOrNull { matching(it) } ?: fallback
    }
}
