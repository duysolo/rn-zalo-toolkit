package com.rnzalotoolkit

import android.util.Base64
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Sinh PKCE theo RFC 7636, `method=S256`.
 *
 * SDK Zalo KHÔNG sinh hộ: `authenticateZaloWithAuthenType(..., codeChallenge, ...)` nhận
 * challenge từ người gọi, còn `getAccessTokenByOAuthCode(..., codeVerifier, ...)` đòi lại
 * verifier. Nghĩa là việc này thuộc về thư viện.
 *
 * `codeVerifier` = 32 byte CSPRNG → base64url không padding = **đúng 43 ký tự**, tức cận
 * dưới của RFC (43-128). `codeChallenge` = base64url(SHA-256(bytes ASCII của verifier)).
 *
 * ⚠️ Cờ Base64 là BẮT BUỘC đủ ba: `URL_SAFE or NO_WRAP or NO_PADDING`. Thiếu `NO_WRAP` thì
 * chuỗi dính ký tự xuống dòng và bước đổi token hỏng IM LẶNG. Đừng chép mẫu từ hàm tính
 * hash key chữ ký - hàm đó cố tình dùng `Base64.DEFAULT` vì Zalo muốn đúng định dạng ấy.
 */
internal object Pkce {
  private const val FLAGS = Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING

  data class Pair(val verifier: String, val challenge: String)

  fun generate(): Pair {
    val bytes = ByteArray(32)
    SecureRandom().nextBytes(bytes)
    val verifier = Base64.encodeToString(bytes, FLAGS)
    val digest = MessageDigest.getInstance("SHA-256")
      .digest(verifier.toByteArray(Charsets.US_ASCII))
    return Pair(verifier, Base64.encodeToString(digest, FLAGS))
  }
}
