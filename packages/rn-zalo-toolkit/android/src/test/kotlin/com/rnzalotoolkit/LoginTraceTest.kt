package com.rnzalotoolkit

import android.content.Intent
import android.net.Uri
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Nhật ký đăng nhập đi thẳng vào file log mà người dùng gửi cho người lạ đọc. Hai bất biến:
 *  1. KHÔNG một giá trị nhạy cảm nào của Zalo (code, uid, tên, ngày sinh) lọt vào.
 *  2. Dạng của `state`/`ext_info` ghi ĐÚNG luật mà SDK dùng để ra -5018, vì đó là thứ duy nhất
 *     phân biệt được "state lệch" với các nguyên nhân khác của `UNKNOWN`.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class LoginTraceTest {

  private val secrets = listOf("SECRET-CODE", "987654321", "Nguyen Van A", "1990-01-01")
  private val authWallMs = 1_790_000_000_000L

  private fun assertNoSecrets(json: JSONObject) {
    val text = json.toString()
    for (secret in secrets) assertFalse("lộ '$secret' trong $text", text.contains(secret))
  }

  @Test
  fun `callback trinh duyet V4 - chi ghi ten tham so va dang gia tri`() {
    val uri = Uri.parse(
      "zalo-123://oauth?code=SECRET-CODE&uid=987654321&display_name=Nguyen%20Van%20A&dob=1990-01-01" +
        "&state=${authWallMs + 42}&ext_info=%7B%22viewer%22%3A%22v%22%7D"
    )
    val out = JSONObject().apply { putBrowserCallback(uri, authWallMs) }

    assertNoSecrets(out)
    assertTrue(out.getBoolean("hasCode"))
    assertEquals("object", out.getString("extInfo"))
    assertEquals("set", out.getString("state"))
    assertEquals(42L, out.getLong("stateDeltaMs"))
    assertTrue(out.getJSONArray("params").toString().contains("display_name"))
  }

  @Test
  fun `callback trinh duyet thieu ext_info - ghi absent, day la duong ra -5018`() {
    val uri = Uri.parse("zalo-123://oauth?code=SECRET-CODE&state=${authWallMs + 10}")
    val out = JSONObject().apply { putBrowserCallback(uri, authWallMs) }

    assertEquals("absent", out.getString("extInfo"))
    assertEquals("set", out.getString("state"))
  }

  @Test
  fun `callback trinh duyet bao loi - giu nguyen ma va cau loi cua Zalo`() {
    val uri = Uri.parse("zalo-123://oauth?error=-1000&errorMsg=he%20thong%20ban")
    val out = JSONObject().apply { putBrowserCallback(uri, authWallMs) }

    assertEquals("-1000", out.getString("error"))
    assertEquals("he thong ban", out.getString("errorMsg"))
    assertFalse(out.getBoolean("hasCode"))
  }

  @Test
  fun `ket qua app Zalo - khong chep data tho, ext_info dang chuoi khong phai V4`() {
    val payload = JSONObject().put(
      "data",
      JSONObject()
        .put("ext_info", "{\"viewer\":\"v\"}")
        .put("state", (authWallMs + 7).toString())
        .put("display_name", "Nguyen Van A")
    )
    val data = Intent()
      .putExtra("code", "SECRET-CODE")
      .putExtra("uid", 987654321L)
      .putExtra("data", payload.toString())
    val out = JSONObject().apply { putActivityResult(data, authWallMs) }

    assertNoSecrets(out)
    // SDK dùng `optJSONObject`: chuỗi JSON KHÔNG làm nó thành V4.
    assertEquals("string", out.getString("extInfo"))
    assertEquals("set", out.getString("state"))
    assertEquals(7L, out.getLong("stateDeltaMs"))
    assertTrue(out.getJSONArray("extras").toString().contains("uid"))
  }

  @Test
  fun `ket qua app Zalo bao loi - ghi ma nguyen ban truoc anh xa`() {
    val payload = JSONObject().put("data", JSONObject().put("errorMsg", "Phien khong hop le").put("from_source", "app"))
    val data = Intent().putExtra("error", -1006).putExtra("data", payload.toString())
    val out = JSONObject().apply { putActivityResult(data, authWallMs) }

    assertEquals(-1006, out.getInt("error"))
    assertEquals("Phien khong hop le", out.getString("errorMsg"))
    assertEquals("app", out.getString("from_source"))
  }

  @Test
  fun `tran chi cat su kien vong doi, khong cat su kien ket thuc`() {
    val trace = LoginTrace("a")
    repeat(45) { trace.event("hostPause", noisy = true) }
    trace.event("reject") { put("code", "UNKNOWN") }
    val json = trace.toJson()

    val events = json.getJSONArray("events")
    assertEquals("reject", events.getJSONObject(events.length() - 1).getString("e"))
    assertEquals(15, json.getInt("droppedNoisyEvents"))
  }
}
