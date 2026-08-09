package com.rnzalotoolkit

import java.io.File
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Đối chiếu `ErrorMapping.kt` với `src/errorTable.json` - NGUỒN DUY NHẤT dùng chung cho cả
 * TypeScript, Kotlin và Swift.
 *
 * Vì sao bài test này đáng có: bảng ánh xạ sống ở ba nơi (một bản JSON, hai bản cài đặt
 * native). Không có gì buộc chúng khớp nhau ngoài trí nhớ, và một dòng lệch chỉ lộ ra khi
 * người dùng thật gặp đúng mã lỗi đó trên đúng nền tảng đó. Thêm mã mới mà quên một phía
 * ⇒ test này đỏ ngay trên CI.
 */
class ErrorMappingTest {

  private val rows: List<JSONObject> by lazy {
    // File nằm ngoài `src/test/resources` nên đọc thẳng theo đường dẫn tương đối của module.
    val file = File("../src/errorTable.json")
    assertTrue(
      "Không tìm thấy ${file.absolutePath} - nguồn duy nhất của bảng lỗi đã bị di chuyển?",
      file.exists(),
    )
    val codes: JSONArray = JSONObject(file.readText()).getJSONArray("codes")
    (0 until codes.length()).map { codes.getJSONObject(it) }
  }

  private fun androidRows() =
    rows.filter { it.getString("platform") in setOf("android", "both") }

  @Test
  fun `moi dong Android trong bang deu map dung`() {
    val mismatches = mutableListOf<String>()
    for (row in androidRows()) {
      val native = row.getInt("native")
      val expected = row.getString("code")
      val phase = ZaloErrorPhase.valueOf(row.getString("phase"))
      val actual = ErrorMapping.codeForNative(native, phase).name
      if (actual != expected) {
        mismatches += "native=$native (${row.optString("symbol")}) mong đợi $expected, nhận $actual"
      }
    }
    assertEquals("Lệch giữa errorTable.json và ErrorMapping.kt", emptyList<String>(), mismatches)
  }

  /**
   * Bài test quan trọng nhất của file.
   *
   * `-7014` và `-7015` là hai mã mà Android và iOS dùng cho những chuyện HOÀN TOÀN khác nhau.
   * Nếu ai đó "dọn dẹp" bằng cách gộp hai bảng làm một, người dùng Android chưa cài Zalo sẽ
   * nhận thông báo "xác thực thất bại" - và không ai phát hiện ra cho tới khi có người dùng
   * thật báo lỗi.
   */
  @Test
  fun `ma -7014 va -7015 mang nghia RIENG cua Android`() {
    assertEquals(
      ZaloErrorCode.ZALO_NOT_INSTALLED,
      ErrorMapping.codeForNative(-7014, ZaloErrorPhase.authorize),
    )
    assertEquals(
      ZaloErrorCode.ZALO_OUT_OF_DATE,
      ErrorMapping.codeForNative(-7015, ZaloErrorPhase.authorize),
    )

    // Và bảng nguồn phải ghi rõ rằng iOS hiểu khác - nếu không, lần dọn dẹp sau sẽ gộp lại.
    val iosRows = rows.filter { it.getString("platform") == "ios" }
    val ios7014 = iosRows.firstOrNull { it.getInt("native") == -7014 }
    val ios7015 = iosRows.firstOrNull { it.getInt("native") == -7015 }
    assertNotNull("errorTable.json thiếu dòng iOS cho -7014", ios7014)
    assertNotNull("errorTable.json thiếu dòng iOS cho -7015", ios7015)
    assertTrue(
      "-7014 phải map KHÁC nhau giữa hai nền tảng",
      ios7014!!.getString("code") != ZaloErrorCode.ZALO_NOT_INSTALLED.name,
    )
    assertTrue(
      "-7015 phải map KHÁC nhau giữa hai nền tảng",
      ios7015!!.getString("code") != ZaloErrorCode.ZALO_OUT_OF_DATE.name,
    )
  }

  @Test
  fun `moi ma huy cua Android deu ra CANCELLED`() {
    for (native in listOf(-7008, -7009, -6003)) {
      assertEquals(
        "native=$native phải là huỷ - rơi vào UNKNOWN nghĩa là nút Huỷ sẽ bung alert lỗi",
        ZaloErrorCode.CANCELLED,
        ErrorMapping.codeForNative(native, ZaloErrorPhase.authorize),
      )
    }
  }

  @Test
  fun `ma la roi ve UNKNOWN, rieng buoc doi token roi ve TOKEN_EXCHANGE_FAILED`() {
    assertEquals(
      ZaloErrorCode.UNKNOWN,
      ErrorMapping.codeForNative(-999999, ZaloErrorPhase.authorize),
    )
    assertEquals(
      ZaloErrorCode.TOKEN_EXCHANGE_FAILED,
      ErrorMapping.codeForNative(-999999, ZaloErrorPhase.exchange),
    )
  }

  @Test
  fun `chan IP ngoai Viet Nam ra PROFILE_RESTRICTED`() {
    assertEquals(
      ZaloErrorCode.PROFILE_RESTRICTED,
      ErrorMapping.codeForNative(-501, ZaloErrorPhase.profile),
    )
  }

  @Test
  fun `moi ma deu co cau tieng Viet doc duoc, khong lot chuoi ky thuat`() {
    for (code in ZaloErrorCode.values()) {
      val message = ErrorMapping.humanMessage(code)
      assertTrue("$code thiếu thông điệp", message.isNotBlank())
      // Thông điệp này được app tiêu thụ bung thẳng ra alert cho người dùng cuối.
      assertTrue("$code lọt JSON vào thông điệp hiển thị", !message.contains("{"))
      assertTrue("$code lọt tên mã vào thông điệp hiển thị", !message.contains(code.name))
    }
  }

  /**
   * Chi tiết máy đọc đi qua `userInfo.details`, KHÔNG qua `message`. Và bí mật thì không đi
   * đâu cả - đường đi của chuỗi này có thật: một app tiêu thụ persist mọi ERROR xuống file
   * trên đĩa ở production, app còn lại đẩy `error.message` lên Crashlytics.
   */
  @Test
  fun `detailsJson mang du chi tiet va KHONG mang bi mat`() {
    val error = ZaloThrowable(
      code = ZaloErrorCode.INVALID_CONFIG,
      phase = ZaloErrorPhase.config,
      humanMessage = "Cấu hình Zalo chưa đúng.",
      nativeCode = -5008,
      nativeMessage = "invalid android signkey",
      signatureHashKey = "wPx3lPXQIBf/WDEx6jMC1TZa0+k=",
      packageName = "vn.estations.app",
    )

    val details = JSONObject(error.detailsJson())
    assertEquals("config", details.getString("phase"))
    assertEquals(-5008, details.getInt("nativeCode"))
    assertEquals("wPx3lPXQIBf/WDEx6jMC1TZa0+k=", details.getString("signatureHashKey"))

    val serialised = error.detailsJson() + error.humanMessage
    for (secret in listOf("SECRET_ACCESS_TOKEN", "SECRET_REFRESH", "SECRET_VERIFIER")) {
      assertTrue("Rò bí mật vào lỗi", !serialised.contains(secret))
    }
  }
}
