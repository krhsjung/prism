package kr.hs.jung.prism.feature.auth.social

import android.app.Activity
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import androidx.credentials.GetCredentialRequest
import kotlinx.coroutines.CancellationException
import kr.hs.jung.prism.core.network.ApiError
import kr.hs.jung.prism.core.util.AppLog

/**
 * Google 네이티브 로그인 — Credential Manager + "Sign in with Google".
 *
 * 웹 redirect가 아니라 앱 안에서 완결되는 시스템 UI로 계정을 고르고 **id_token**을 받는다.
 * 이렇게 해야 Android에서 redirect가 다른 앱에 가로채이는 문제(구글 앱 선택 창)를 피한다.
 * id_token의 audience는 서버가 검증하는 값과 같아야 하므로 [serverClientId]에 **웹(서버)
 * 클라이언트 ID**를 넣는다(Google Cloud Console의 OAuth 2.0 클라이언트 중 "Web").
 */
class GoogleSignInClient(
    private val serverClientId: String,
) {
    suspend fun idToken(activity: Activity): String {
        if (serverClientId.isBlank()) {
            // 키가 없으면 네이티브 경로 자체가 불가능하다 — 조용한 실패 대신 명확히 알린다.
            throw ApiError.providerUnavailable
        }
        // filterByAuthorizedAccounts 대신 "항상 계정 선택"을 여는 흐름 — 웹의 prompt=select_account와
        // 같은 의도(직전 계정 자동 재선택 금지, 계정 전환 가능).
        val option = GetSignInWithGoogleOption.Builder(serverClientId).build()
        val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
        val manager = CredentialManager.create(activity)

        val result = try {
            manager.getCredential(activity, request)
        } catch (e: GetCredentialCancellationException) {
            // 사용자가 닫은 것만 여기 오는 게 아니다 — Play 서비스는 콘솔 설정 오류
            // (패키지+SHA-1 미등록 → UNREGISTERED_ON_API_CONSOLE)도 시트를 그냥 닫아
            // **취소로** 돌려준다. 그러면 앱에는 아무 흔적도 남지 않아, "눌러도 아무 일이
            // 없다"가 취소인지 설정 오류인지 구분되지 않는다. type만 남겨 그 구분을 남긴다.
            AppLog.d("google sign-in cancelled (${e.type})")
            throw CancellationException("google sign-in cancelled")
        } catch (e: GetCredentialException) {
            // SDK Throwable(스택/메시지)은 라이브러리 제어라 남기지 않는다 — 라이브러리가
            // 정의한 type 상수만 남긴다(사용자 데이터가 아니고, 원인 구분에 꼭 필요하다).
            AppLog.e("google credential request failed (${e.type})")
            throw ApiError(0, kr.hs.jung.prism.domain.model.AuthErrorCode.SIGNIN_FAILED)
        }

        val credential = result.credential
        if (credential is CustomCredential &&
            credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
        ) {
            return GoogleIdTokenCredential.createFrom(credential.data).idToken
        }
        AppLog.e("unexpected google credential type")
        throw ApiError.invalidResponse
    }
}
