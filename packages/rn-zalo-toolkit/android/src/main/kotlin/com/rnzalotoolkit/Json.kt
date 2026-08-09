package com.rnzalotoolkit

import org.json.JSONObject

/**
 * Hai cái bẫy của `org.json` trên Android, cả hai đều im lặng.
 *
 * BẪY 1 - ĐỌC. `JSONObject.optString(key)` với giá trị JSON `null` trả về **chuỗi `"null"`**
 * (4 ký tự), KHÔNG phải chuỗi rỗng: bên trong nó là `String.valueOf(JSONObject.NULL)`.
 * Nghĩa là `opts.optString("accessToken").ifEmpty { fallback }` **không bao giờ** chạy
 * nhánh fallback, và SDK bị gọi với token là chuỗi `"null"`.
 *
 * BẪY 2 - GHI. `JSONObject.put(key, null)` **XOÁ** mapping. Một field khai
 * `string | null` ở TypeScript sẽ thành `undefined` sau `JSON.parse`, nên
 * `profile.name === null` luôn sai. Muốn có `null` thật thì phải ghi `JSONObject.NULL`.
 *
 * ⚠️ Và điều nguy hiểm nhất: **unit test KHÔNG bắt được cả hai**. Test JVM chạy trên
 * `org.json:json` của Maven, còn thiết bị chạy bản AOSP - hai bản khác nhau đúng ở chỗ này.
 * Vì vậy mọi chỗ đọc/ghi JSON phải đi qua các helper dưới đây, không dùng API gốc.
 */
internal object Json {

  /** Đọc chuỗi, coi JSON `null` và chuỗi rỗng đều là "không có". */
  fun JSONObject.stringOrNull(key: String): String? =
    if (isNull(key)) null else optString(key).ifEmpty { null }

  /** Ghi chuỗi, dùng `JSONObject.NULL` để giữ đúng `null` thay vì xoá khoá. */
  fun JSONObject.putOrNull(key: String, value: String?): JSONObject =
    put(key, value ?: JSONObject.NULL)

  fun JSONObject.putOrNull(key: String, value: Any?): JSONObject =
    put(key, value ?: JSONObject.NULL)
}
