package com.rnzalotoolkit

import com.rnzalotoolkit.Json.putOrNull
import org.json.JSONObject

/**
 * Chuẩn hoá hồ sơ Zalo về ĐÚNG hình dạng mà iOS trả về.
 *
 * Thư viện cũ để hai nền tảng trả hai hình dạng khác nhau (iOS trả `response.data`, Android
 * trả nguyên JSON kèm cả `error`/`message`) trong khi TypeScript khai một kiểu duy nhất -
 * tức phần khai báo kiểu nói dối. Ở đây cả hai phía đi qua cùng một hợp đồng.
 */
internal object ProfileMapper {

  fun toJson(data: JSONObject): JSONObject {
    // Zalo sao chép hình dạng `picture.data.url` của Facebook Graph. Ta làm phẳng nó ở bề
    // mặt công khai và giữ nguyên bản gốc trong `raw` để app cần field lạ vẫn lấy được.
    val pictureUrl = data.optJSONObject("picture")
      ?.optJSONObject("data")
      ?.optString("url")
      ?.takeIf { it.isNotEmpty() }

    // `putOrNull` chứ không `put(key, null)`: `put` với null XOÁ mapping, và một field khai
    // `string | null` ở TypeScript sẽ thành `undefined` sau JSON.parse - `profile.name ===
    // null` sẽ luôn sai. Xem `Json.kt`.
    return JSONObject().apply {
      put("id", data.optString("id"))
      putOrNull("name", data.optString("name").ifEmpty { null })
      put("picture", JSONObject().apply { putOrNull("url", pictureUrl) })
      putOrNull("birthday", data.optString("birthday").ifEmpty { null })
      putOrNull("gender", data.optString("gender").ifEmpty { null })
      putOrNull("phoneNumber", data.optString("phoneNumber").ifEmpty { null })
      put("raw", data)
    }
  }
}
