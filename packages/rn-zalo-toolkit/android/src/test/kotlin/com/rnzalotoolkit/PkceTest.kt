package com.rnzalotoolkit

import java.security.MessageDigest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * PKCE là thứ DUY NHẤT bảo vệ luồng đăng nhập khỏi việc app khác cướp `oauthCode`:
 * `BrowserLoginActivity` buộc phải `exported="true"` để trình duyệt gọi ngược về được, và
 * custom scheme trên Android không độc quyền. Code bị cướp vô dụng nếu không có
 * `codeVerifier` - nên công thức sinh nó phải đúng, và phải có test canh.
 *
 * Chạy bằng Robolectric vì `android.util.Base64` là stub trong JVM thuần.
 */
@RunWith(RobolectricTestRunner::class)
class PkceTest {

  @Test
  fun `codeVerifier dai dung 43 ky tu - can duoi cua RFC 7636`() {
    // 32 byte → base64 = 44 ký tự (gồm 1 ký tự padding) → bỏ padding = 43.
    // RFC 7636 §4.1 yêu cầu 43-128. Ngắn hơn 43 là vi phạm chuẩn; ta đang ở đúng cận dưới.
    repeat(20) {
      assertEquals(43, Pkce.generate().verifier.length)
    }
  }

  @Test
  fun `codeChallenge dai dung 43 ky tu`() {
    // SHA-256 cho 32 byte digest → cùng phép base64url không padding → cũng 43.
    repeat(20) {
      assertEquals(43, Pkce.generate().challenge.length)
    }
  }

  @Test
  fun `charset nam tron trong tap unreserved cua RFC 7636`() {
    // RFC 7636: verifier = 43*128 unreserved = ALPHA / DIGIT / "-" / "." / "_" / "~"
    // base64url dùng A-Za-z0-9-_ nên nằm trọn trong đó.
    val allowed = Regex("^[A-Za-z0-9._~-]+$")
    repeat(50) {
      val pair = Pkce.generate()
      assertTrue("verifier lọt ký tự lạ: ${pair.verifier}", allowed.matches(pair.verifier))
      assertTrue("challenge lọt ký tự lạ: ${pair.challenge}", allowed.matches(pair.challenge))
      // Đặc biệt: KHÔNG được có '+', '/', '=' (base64 thường) và không có xuống dòng.
      // Thiếu cờ NO_WRAP là dính '\n' và bước đổi token hỏng IM LẶNG.
      for (bad in listOf("+", "/", "=", "\n", "\r")) {
        assertTrue("verifier chứa '$bad'", !pair.verifier.contains(bad))
        assertTrue("challenge chứa '$bad'", !pair.challenge.contains(bad))
      }
    }
  }

  @Test
  fun `hai lan goi lien tiep ra hai verifier khac nhau`() {
    val seen = mutableSetOf<String>()
    repeat(100) { seen.add(Pkce.generate().verifier) }
    assertEquals("verifier bị lặp - nguồn ngẫu nhiên hỏng", 100, seen.size)
    assertNotEquals(Pkce.generate().verifier, Pkce.generate().verifier)
  }

  /**
   * Vector cố định của RFC 7636 phụ lục B.
   *
   * Đây là bài duy nhất chứng minh công thức S256 đúng chứ không chỉ "trông hợp lệ": nó dùng
   * verifier có sẵn trong chuẩn và so với challenge mà chuẩn công bố.
   */
  @Test
  fun `vector RFC 7636 phu luc B`() {
    val verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    val expectedChallenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"

    // Dựng lại đúng công thức của `Pkce.generate`, chỉ thay nguồn ngẫu nhiên bằng vector.
    val digest = MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII))
    val challenge = android.util.Base64.encodeToString(
      digest,
      android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP or android.util.Base64.NO_PADDING,
    )

    assertEquals(expectedChallenge, challenge)
    assertEquals(43, verifier.length)
    assertEquals(43, expectedChallenge.length)
  }

  @Test
  fun `challenge la S256 cua chinh verifier`() {
    repeat(20) {
      val pair = Pkce.generate()
      val digest = MessageDigest.getInstance("SHA-256")
        .digest(pair.verifier.toByteArray(Charsets.US_ASCII))
      val expected = android.util.Base64.encodeToString(
        digest,
        android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP or android.util.Base64.NO_PADDING,
      )
      assertEquals(expected, pair.challenge)
    }
  }
}
