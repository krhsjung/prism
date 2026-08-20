package kr.hs.jung.prism.core.security

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kr.hs.jung.prism.core.util.AppLog

/**
 * 암호화 키-값 저장소.
 *
 * 세션 자격증명(데모의 세션 쿠키)은 여기에만 둔다 — 일반 `SharedPreferences`는 평문
 * plist라 백업·파일 접근으로 새어 나간다(plan/auth.md §6: Android는 Keystore 기반
 * EncryptedSharedPreferences, 일반 preferences 금지). MasterKey(AES-256-GCM)는
 * 하드웨어 Keystore에 보관되고 키·값 모두 암호화된다.
 */
class SecureStore(context: Context) {
    private val prefs: SharedPreferences = create(context)

    fun getString(key: String): String? = try {
        prefs.getString(key, null)
    } catch (e: Exception) {
        AppLog.e("secure read failed for $key", e)
        null
    }

    fun putString(key: String, value: String) {
        try {
            prefs.edit().putString(key, value).apply()
        } catch (e: Exception) {
            AppLog.e("secure write failed for $key", e)
        }
    }

    fun remove(key: String) {
        try {
            prefs.edit().remove(key).apply()
        } catch (e: Exception) {
            AppLog.e("secure remove failed for $key", e)
        }
    }

    private companion object {
        const val FILE = "prism.secure"

        fun create(context: Context): SharedPreferences {
            val key = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            fun build() = EncryptedSharedPreferences.create(
                context,
                FILE,
                key,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
            return try {
                build()
            } catch (e: Exception) {
                // 키가 손상됐거나(앱 데이터 반쯤 지워짐 등) 스킴이 바뀌면 복호화가 깨진다.
                // 세션 하나 때문에 앱이 못 뜨는 것보다, 저장소를 비우고 다시 만드는 편이 낫다
                // — 사용자는 다시 로그인하면 된다.
                AppLog.e("recreating corrupt secure store", e)
                context.deleteSharedPreferences(FILE)
                build()
            }
        }
    }
}
