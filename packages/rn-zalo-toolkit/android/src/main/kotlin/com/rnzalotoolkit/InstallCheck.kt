package com.rnzalotoolkit

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.util.Base64
import com.zing.zalo.zalosdk.core.helper.AppInfo
import com.rnzalotoolkit.Json.putOrNull
import com.zing.zalo.zalosdk.oauth.ZaloSDK
import java.security.MessageDigest
import org.json.JSONArray
import org.json.JSONObject

/**
 * Kiểm cấu hình LOCAL và trả về báo cáo đọc được.
 *
 * GIỚI HẠN - phải nói ra, đừng bán quá lời:
 *  - Chỉ thấy cấu hình trên máy. KHÔNG biết Zalo portal đã đăng ký package name / hash key
 *    hay chưa; chuyện đó chỉ lộ khi đăng nhập, và khi ấy lỗi `INVALID_CONFIG` đã kèm sẵn
 *    hash key + package name để dán lên portal.
 *  - Không phân biệt được "Zalo chưa cài" với "chưa khai package visibility" - cả hai đều
 *    ném `NameNotFoundException`. AAR của Zalo đã tự khai `<queries>` nên vế thứ hai gần như
 *    không xảy ra, nhưng thông điệp vẫn nói rõ để người đọc không kết luận nhầm.
 */
internal object InstallCheck {

  fun report(context: Context): JSONObject {
    val issues = JSONArray()
    val appId = runCatching { ZaloSDK.Instance.appID }.getOrDefault(0L)
    val appIdText = if (appId > 0) appId.toString() else null

    if (appIdText == null) {
      issues.put(
        issue(
          code = "SDK_NOT_INITIALIZED",
          severity = "error",
          message = "ZaloSDK chưa khởi tạo hoặc chưa nhận được app id. Mọi lời gọi Zalo sẽ báo lỗi cấu hình.",
          fix = "Thêm `zaloAppId=<APP_ID>` vào android/gradle.properties rồi build lại. " +
            "Thư viện tự khai meta-data và tự gọi wrap() - app không cần sửa MainApplication.",
        )
      )
    }

    if (appIdText != null && !isBrowserLoginActivityDeclared(context, appIdText)) {
      issues.put(
        issue(
          code = "BROWSER_ACTIVITY_MISSING",
          severity = "error",
          message = "Không có activity nào nhận scheme `zalo-$appIdText`. Đăng nhập qua trình duyệt sẽ mở được nhưng không quay lại được app.",
          fix = "Thư viện đã khai sẵn `BrowserLoginActivity`. Gặp lỗi này nghĩa là manifest " +
            "merger đã bỏ nó - kiểm xem app có `tools:node=\"remove\"` cho activity đó không.",
        )
      )
    }

    val hasError = (0 until issues.length()).any {
      issues.getJSONObject(it).optString("severity") == "error"
    }

    return JSONObject().apply {
      put("ok", !hasError)
      put("platform", "android")
      putOrNull("appId", appIdText)
      put("nativeSdkVersion", runCatching { ZaloSDK.Instance.version }.getOrDefault("unknown"))
      put("issues", issues)
      put(
        "details",
        JSONObject().apply {
          put("zaloAppInstalled", isZaloInstalled(context))
          // ĐÚNG giá trị SDK gửi lên Zalo trong `sign_key` - đây là chuỗi phải dán lên portal.
          putOrNull("signatureHashKey", runCatching { AppInfo.getApplicationHashKey(context) }.getOrNull())
          // Chứng chỉ HIỆN HÀNH. Khác giá trị trên khi khoá đã rotate. CHỈ để chẩn đoán -
          // đừng dán cái này lên portal.
          put("signersAll", JSONArray(allSigners(context)))
          put("packageName", context.packageName)
        }
      )
    }
  }

  private fun issue(code: String, severity: String, message: String, fix: String) =
    JSONObject().apply {
      put("code", code)
      put("severity", severity)
      put("message", message)
      put("fix", fix)
    }

  private fun isZaloInstalled(context: Context): Boolean =
    runCatching {
      context.packageManager.getPackageInfo(ZALO_PACKAGE, 0)
      true
    }.getOrDefault(false)

  private fun isBrowserLoginActivityDeclared(context: Context, appId: String): Boolean {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("zalo-$appId://oauth"))
    return runCatching {
      context.packageManager
        .queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)
        .any { it.activityInfo?.packageName == context.packageName }
    }.getOrDefault(false)
  }

  /**
   * TOÀN BỘ chứng chỉ ký mà hệ thống biết, chỉ để chẩn đoán việc đã rotate khoá.
   *
   * KHÔNG dùng giá trị này thay cho `AppInfo.getApplicationHashKey`. Khi khoá đã rotate,
   * `GET_SIGNATURES` (thứ SDK dùng) trả chứng chỉ GỐC, còn danh sách này là toàn bộ lineage
   * - tức nó CHỨA giá trị kia chứ không "khác" nó. Chuỗi phải dán lên portal luôn là
   * `signatureHashKey`.
   */
  @Suppress("DEPRECATION")
  private fun allSigners(context: Context): List<String> = runCatching {
    val pm = context.packageManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      val info = pm.getPackageInfo(context.packageName, PackageManager.GET_SIGNING_CERTIFICATES)
      val signingInfo = info.signingInfo ?: return@runCatching emptyList()
      val certs = if (signingInfo.hasMultipleSigners()) {
        signingInfo.apkContentsSigners
      } else {
        signingInfo.signingCertificateHistory
      }
      certs?.map { hashSignature(it.toByteArray()) } ?: emptyList()
    } else {
      val info = pm.getPackageInfo(context.packageName, PackageManager.GET_SIGNATURES)
      info.signatures?.map { hashSignature(it.toByteArray()) } ?: emptyList()
    }
  }.getOrDefault(emptyList())

  /**
   * Cùng công thức mà `AppInfo.getApplicationHashKey` dùng bên trong: SHA-1 → Base64.DEFAULT
   * → trim (đọc từ bytecode `sdk-core 4.24.1101`).
   *
   * ⚠️ `Base64.DEFAULT` sinh ký tự xuống dòng, và `.trim()` mới là thứ làm chuỗi dùng được -
   * đó là lý do KHÔNG được chép mẫu này sang chỗ sinh PKCE, nơi bắt buộc phải có `NO_WRAP`.
   */
  private fun hashSignature(bytes: ByteArray): String =
    Base64.encodeToString(MessageDigest.getInstance("SHA").digest(bytes), Base64.DEFAULT).trim()

  private const val ZALO_PACKAGE = "com.zing.zalo"
}
