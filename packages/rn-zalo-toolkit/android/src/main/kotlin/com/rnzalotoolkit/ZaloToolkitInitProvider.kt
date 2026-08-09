package com.rnzalotoolkit

import android.app.Application
import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.util.Log
import com.zing.zalo.zalosdk.oauth.ZaloSDKApplication

/**
 * Khởi tạo ZaloSDK mà app KHÔNG phải sửa `MainApplication`.
 *
 * Đây là pattern chuẩn - `androidx.startup` và `FirebaseInitProvider` dùng đúng cách này, và
 * `${applicationId}` trong manifest của thư viện hoạt động (kiểm bằng AAR thật của
 * `androidx.startup:1.1.1` và `firebase-common:22.1.0`, cả hai giữ nguyên placeholder).
 *
 * ⚠️ `ZaloSDKApplication.wrap()` KHÔNG idempotent: `init()` là một chuỗi thẳng không có
 * early-return, và nó kéo theo `DeviceTracking.getDeviceId()` - một lượt I/O mạng. App nào
 * quên gỡ lời gọi `wrap()` cũ trong `MainApplication` sẽ chạy toàn bộ chuỗi đó hai lần.
 */
class ZaloToolkitInitProvider : ContentProvider() {

  override fun onCreate(): Boolean {
    // `as?` chứ không phải `as`: ép kiểu cứng ở đây là đánh cược vào một chi tiết cài đặt
    // của framework, và nếu sai thì app crash ngay lúc khởi động - trước cả khi có chỗ nào
    // để báo lỗi tử tế.
    val application = context?.applicationContext as? Application
    if (application == null) {
      Log.e(TAG, "Không lấy được Application - gọi ZaloSDKApplication.wrap(this) thủ công.")
      return false
    }

    runCatching { ZaloSDKApplication.wrap(application) }
      .onFailure {
        Log.e(TAG, "ZaloSDKApplication.wrap() thất bại - gọi thủ công trong MainApplication.", it)
      }
    return true
  }

  override fun query(u: Uri, p: Array<String>?, s: String?, a: Array<String>?, o: String?): Cursor? =
    throw UnsupportedOperationException("ZaloToolkitInitProvider không phục vụ dữ liệu")

  override fun getType(uri: Uri): String? =
    throw UnsupportedOperationException("ZaloToolkitInitProvider không phục vụ dữ liệu")

  override fun insert(uri: Uri, values: ContentValues?): Uri? =
    throw UnsupportedOperationException("ZaloToolkitInitProvider không phục vụ dữ liệu")

  override fun delete(uri: Uri, selection: String?, args: Array<String>?): Int =
    throw UnsupportedOperationException("ZaloToolkitInitProvider không phục vụ dữ liệu")

  override fun update(u: Uri, v: ContentValues?, s: String?, a: Array<String>?): Int =
    throw UnsupportedOperationException("ZaloToolkitInitProvider không phục vụ dữ liệu")

  private companion object {
    const val TAG = "rn-zalo-toolkit"
  }
}
