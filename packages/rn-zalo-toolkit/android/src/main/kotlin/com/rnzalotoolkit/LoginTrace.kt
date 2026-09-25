package com.rnzalotoolkit

import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import com.zing.zalo.zalosdk.core.SettingsManager
import com.zing.zalo.zalosdk.core.helper.AppInfo
import com.zing.zalo.zalosdk.oauth.ZaloSDK
import java.util.Locale
import org.json.JSONArray
import org.json.JSONObject

/**
 * Nhật ký của MỘT lượt `login()`, đính vào `userInfo.details.diagnostics` khi lượt đó reject.
 *
 * Mã công khai gộp nhiều mã native khác nghĩa (`UNKNOWN` = -5018 state lệch, -8000, -7003,
 * -7010, exception khi mở activity...), còn app tiêu thụ thường chỉ giữ được thứ đi theo lỗi.
 * Nhật ký trả lời ba câu mà mã lỗi không trả lời được:
 *  - SDK đã đi đường nào. App Zalo và WebView cùng trả về `requestCode` 64725 (khi lỗi thì
 *    không tách được hai đường này bằng Intent), nên phải nhìn thêm `activityCreated`:
 *    `WebLoginActivity` = WebView, `BrowserLoginActivity` = trình duyệt gọi ngược về. Kết quả
 *    của trình duyệt KHÔNG đi qua `onActivityResult` của module (`BrowserLoginActivity` gọi
 *    thẳng vào SDK), nên nó chỉ được ghi ở `activityCreated`;
 *  - Zalo trả gì NGUYÊN BẢN, trước khi bị ánh xạ;
 *  - máy nhìn thấy gì: Zalo có hiện với PackageManager không, activity nhận uỷ quyền và
 *    service trạng thái của Zalo có resolve được không, cờ phía máy chủ của SDK đang bật gì.
 *
 * KHÔNG BAO GIỜ ghi: oauth code, access token, uid, tên hiển thị, ngày sinh, giới tính, chuỗi
 * `data` thô của Zalo. Chỉ ghi mã lỗi, câu lỗi của SDK, cờ có/không, DẠNG của giá trị và TÊN khoá.
 *
 * Mọi thao tác đều nuốt lỗi của chính nó: nhật ký hỏng không bao giờ được làm hỏng lượt đăng
 * nhập - kể cả lượt đang reject.
 */
internal class LoginTrace(private val attemptId: String) {
  private val startedAt = SystemClock.elapsedRealtime()
  private val events = JSONArray()
  private var environment: JSONObject? = null
  private var noisy = 0
  private var dropped = 0

  /**
   * Giờ đồng hồ tường ngay trước khi gọi SDK. `state` của SDK CHÍNH LÀ `currentTimeMillis()` lúc
   * nó mở app/trình duyệt, nên `state - authWallMs` cho biết state Zalo trả về có phải của lượt
   * này không: 0-6000 ms là của lượt này (có thể trễ ~5 s vì SDK chờ service của Zalo), âm lớn là
   * kết quả lạc của một lượt trước.
   */
  @Volatile
  var authWallMs: Long = 0L

  @Synchronized
  fun setEnvironment(env: JSONObject) {
    environment = env
  }

  /**
   * `noisy` = sự kiện vòng đời có thể lặp (pause/resume trên máy gập, activity tạo lại). Chỉ
   * chúng bị giới hạn: sự kiện kết thúc (`authenError`, `reject`...) là phần quan trọng nhất và
   * tự bị chặn trên bởi luồng (gate chỉ settle một lần), không được để trần cắt mất.
   */
  @Synchronized
  fun event(name: String, noisy: Boolean = false, fill: JSONObject.() -> Unit = {}) {
    if (noisy && this.noisy++ >= MAX_NOISY_EVENTS) {
      dropped++
      return
    }
    val entry = JSONObject()
    runCatching {
      entry.put("t", SystemClock.elapsedRealtime() - startedAt)
      entry.put("e", name)
      entry.fill()
    }
    events.put(entry)
  }

  /** Bản chụp để gửi đi - chép sâu ngay nên sự kiện đến sau không làm đổi nó. */
  @Synchronized
  fun toJson(): JSONObject = JSONObject().apply {
    runCatching {
      put("attemptId", attemptId)
      put("elapsedMs", SystemClock.elapsedRealtime() - startedAt)
      if (dropped > 0) put("droppedNoisyEvents", dropped)
      environment?.let { put("env", JSONObject(it.toString())) }
      put("events", JSONArray(events.toString()))
    }
  }

  companion object {
    private const val MAX_NOISY_EVENTS = 30
  }
}

/**
 * Ghi mọi activity được tạo trong tiến trình app suốt lượt đăng nhập.
 *
 * Đây là chỗ DUY NHẤT nhìn thấy kết quả của đường trình duyệt: `BrowserLoginActivity.onCreate`
 * gọi `ZaloSDK.onActivityResult` trực tiếp, không qua `ReactContext`. `onActivityCreated` chạy
 * bên trong `super.onCreate`, tức TRƯỚC `handleBrowserCallback`, nên thứ tự trong nhật ký đúng.
 * Cũng bắt được activity chính bị tạo lại (máy gập mở/gập màn hình).
 */
internal class TraceActivityCallbacks(private val trace: LoginTrace) : Application.ActivityLifecycleCallbacks {
  override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {
    trace.event("activityCreated", noisy = true) {
      put("activity", activity.javaClass.simpleName)
      put("restored", savedInstanceState != null)
      if (activity.javaClass.name == BROWSER_LOGIN_ACTIVITY) {
        putBrowserCallback(activity.intent?.data, trace.authWallMs)
      }
    }
  }

  override fun onActivityStarted(activity: Activity) {}
  override fun onActivityResumed(activity: Activity) {}
  override fun onActivityPaused(activity: Activity) {}
  override fun onActivityStopped(activity: Activity) {}
  override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
  override fun onActivityDestroyed(activity: Activity) {}

  companion object {
    const val BROWSER_LOGIN_ACTIVITY = "com.zing.zalo.zalosdk.oauth.BrowserLoginActivity"
  }
}

/**
 * Chụp môi trường mà SDK sẽ nhìn thấy khi bắt đầu một lượt đăng nhập.
 *
 * Mỗi nhóm tự bọc lỗi riêng: một câu hỏi PackageManager ném (ROM lạ, quyền lạ) chỉ làm nhóm đó
 * mang `error`, các nhóm khác vẫn đủ.
 */
internal object LoginEnvironment {
  private const val ZALO_PACKAGE = "com.zing.zalo"

  /** Action mà `Authenticator.loginViaApp` mở (đọc từ bytecode `sdk-auth 4.24.1101`). */
  private const val AUTHORIZE_ACTION = "com.zing.zalo.intent.action.THIRD_PARTY_APP_AUTHORIZATION"

  /** Quyền do CHÍNH app Zalo khai, AAR `sdk-auth` xin sẵn trong manifest. */
  private const val AUTHORIZE_PERMISSION = "com.zing.zalo.permission.ACCESS_THIRD_PARTY_APP_AUTHORIZATION"

  /**
   * Service mà SDK bind để hỏi "Zalo đã đăng nhập chưa" khi cờ `useWebViewForUnloginZalo` bật
   * (`NativeProtocol.createPlatformServiceIntent`). Không resolve được → SDK rớt sang web NGAY;
   * resolve được nhưng ROM chặn bind → SDK chờ 5 s rồi mới rớt sang web.
   */
  private const val PLATFORM_SERVICE_ACTION = "com.zing.zalo.action.PlatformService"

  fun snapshot(context: Context, activity: Activity?): JSONObject = JSONObject().apply {
    put("device", group { device(context) })
    put("zalo", group { zalo(context) })
    put("host", group { host(context, activity) })
    put("sdk", group { sdk(context) })
  }

  private fun group(block: () -> JSONObject): JSONObject =
    runCatching(block).getOrElse { t ->
      JSONObject().apply { put("error", "${t.javaClass.simpleName}: ${t.message}") }
    }

  private fun device(context: Context) = JSONObject().apply {
    put("manufacturer", Build.MANUFACTURER)
    put("brand", Build.BRAND)
    put("model", Build.MODEL)
    put("device", Build.DEVICE)
    put("sdkInt", Build.VERSION.SDK_INT)
    put("release", Build.VERSION.RELEASE)
    // Bản ROM (vd `...(CN01)`) - chỗ phân biệt ROM Trung Quốc với ROM quốc tế.
    put("display", Build.DISPLAY)
    put("fingerprint", Build.FINGERPRINT)
    put("locale", Locale.getDefault().toLanguageTag())
    val config = context.resources.configuration
    put("screenDp", "${config.screenWidthDp}x${config.screenHeightDp}")
  }

  private fun zalo(context: Context) = JSONObject().apply {
    val pm = context.packageManager
    // ĐÚNG câu hỏi SDK dùng để chọn app hay web (`AppInfo.isPackageExists`, flag GET_META_DATA).
    put("sdkSeesZalo", AppInfo.isPackageExists(context, ZALO_PACKAGE))

    @Suppress("DEPRECATION")
    val info = runCatching { pm.getPackageInfo(ZALO_PACKAGE, 0) }.getOrNull()
    put("packageInfo", info != null)
    if (info != null) {
      put("versionName", info.versionName)
      @Suppress("DEPRECATION")
      put("versionCode", if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong())
      put("enabled", info.applicationInfo?.enabled)
      put("installer", installerOf(pm, ZALO_PACKAGE))
    }
    // Cách hỏi khác: ROM chặn đọc danh sách app có thể trả lời lệch nhau giữa các cách.
    put("launchIntent", runCatching { pm.getLaunchIntentForPackage(ZALO_PACKAGE) != null }.getOrDefault(false))
    @Suppress("DEPRECATION")
    val authorize = runCatching { pm.queryIntentActivities(Intent(AUTHORIZE_ACTION), 0) }.getOrDefault(emptyList())
    // Hơn một kết quả = có bản Zalo nhân bản (App Clone) hoặc app lạ nhận cùng action.
    put("authorizeActivities", JSONArray(authorize.map { "${it.activityInfo?.packageName}/${it.activityInfo?.name}" }))
    put("authorizePermissionDefined", runCatching { pm.getPermissionInfo(AUTHORIZE_PERMISSION, 0); true }.getOrDefault(false))
    put("authorizePermissionGranted", context.checkSelfPermission(AUTHORIZE_PERMISSION) == PackageManager.PERMISSION_GRANTED)
    val platformService = Intent(PLATFORM_SERVICE_ACTION).setPackage(ZALO_PACKAGE).addCategory(Intent.CATEGORY_DEFAULT)
    @Suppress("DEPRECATION")
    put("platformService", runCatching { pm.resolveService(platformService, 0) != null }.getOrDefault(false))
  }

  private fun host(context: Context, activity: Activity?) = JSONObject().apply {
    val pm = context.packageManager
    put("packageName", context.packageName)
    @Suppress("DEPRECATION")
    put("versionName", runCatching { pm.getPackageInfo(context.packageName, 0).versionName }.getOrNull())
    put("installer", installerOf(pm, context.packageName))
    put("activity", activity?.javaClass?.simpleName)
    put("multiWindow", activity?.isInMultiWindowMode)
    // ĐÚNG câu hỏi của `Utilities.canUseBrowserLogin`: resolve scheme `zalo-<appId>://` trong
    // CHÍNH app và so tên lớp. Khác `BrowserLoginActivity` (hoặc null) → SDK dùng WebView
    // thay cho trình duyệt.
    put(
      "browserLoginResolvesTo",
      runCatching {
        val intent = Intent().setPackage(context.packageName)
          .setData(Uri.parse("zalo-${AppInfo.getAppId(context)}://"))
        intent.resolveActivity(pm)?.className
      }.getOrNull()
    )
    // Trình duyệt sẽ nhận trang đăng nhập web. `android` = hộp chọn (chưa đặt mặc định);
    // null = package visibility che mất hoặc không có trình duyệt.
    put(
      "defaultBrowser",
      runCatching {
        @Suppress("DEPRECATION")
        pm.resolveActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://oauth.zaloapp.com/")), PackageManager.MATCH_DEFAULT_ONLY)
          ?.activityInfo?.packageName
      }.getOrNull()
    )
  }

  private fun sdk(context: Context) = JSONObject().apply {
    put("appId", runCatching { ZaloSDK.Instance.appID.toString() }.getOrNull())
    put("native", runCatching { ZaloSDK.Instance.version }.getOrNull())
    put("toolkit", BuildConfig.TOOLKIT_VERSION)
    // Cờ SDK nhận từ máy chủ Zalo. Bật thì `APP_OR_WEB` hỏi app Zalo (qua `platformService`)
    // xem đã đăng nhập chưa, và rớt sang đăng nhập web nếu không hỏi được - ROM chặn khởi chạy
    // liên kết sẽ đẩy lượt đăng nhập sang trình duyệt dù Zalo có cài.
    put("useWebViewForUnloginZalo", runCatching { SettingsManager.getInstance().isUseWebViewUnLoginZalo(context) }.getOrNull())
  }

  @Suppress("DEPRECATION")
  private fun installerOf(pm: PackageManager, pkg: String): String? = runCatching {
    if (Build.VERSION.SDK_INT >= 30) pm.getInstallSourceInfo(pkg).installingPackageName
    else pm.getInstallerPackageName(pkg)
  }.getOrNull()
}

/**
 * Tóm tắt Intent kết quả Zalo gửi về (đường app Zalo / WebView), KHÔNG chép giá trị nhạy cảm.
 *
 * Đọc đúng những trường mà `Authenticator.receiveOAuthDataV4` đọc, để biết nó sẽ rẽ nhánh nào:
 * `error` ≠ 0 → nhánh lỗi; thiếu `code` → -5020; state lệch → -5018. Luật state của SDK:
 * `ext_info` là OBJECT (`optJSONObject`) → state phải bằng state đã gửi; còn lại (vắng, null,
 * chuỗi) → state phải là chuỗi RỖNG, vắng hay có giá trị đều hỏng.
 */
internal fun JSONObject.putActivityResult(data: Intent?, authWallMs: Long) {
  put("hasData", data != null)
  if (data == null) return
  val extras = runCatching { data.extras?.keySet()?.sorted() }.getOrNull()
  put("extras", JSONArray(extras ?: emptyList<String>()))
  put("error", runCatching { data.getIntExtra("error", 0) }.getOrDefault(0))
  put("hasCode", !runCatching { data.getStringExtra("code") }.getOrNull().isNullOrEmpty())
  put("isWebview", runCatching { data.getBooleanExtra("isWebview", false) }.getOrDefault(false))
  val payload = runCatching { JSONObject(data.getStringExtra("data").orEmpty()).optJSONObject("data") }.getOrNull()
  put("hasPayload", payload != null)
  if (payload != null) {
    put("extInfo", shapeOf(payload, "ext_info"))
    putState(if (payload.has("state")) payload.opt("state")?.toString() else null, payload.has("state"), authWallMs)
    for (key in listOf("from_source", "errorMsg", "error_description", "error_reason")) {
      payload.optString(key).takeIf { it.isNotEmpty() }?.let { put(key, it) }
    }
  }
}

/**
 * Tóm tắt URI trình duyệt gọi ngược về `BrowserLoginActivity`. Chỉ TÊN tham số và dạng giá trị:
 * URI này mang `code`, `uid`, `display_name`, `dob`, `gender` thật.
 *
 * Luật của `BrowserLoginActivity`: `ext_info` parse được thành object → V4, state phải khớp;
 * không có → state phải rỗng, mà activity chỉ chép state khi nó KHÁC rỗng → hỏng -5018.
 */
internal fun JSONObject.putBrowserCallback(uri: Uri?, authWallMs: Long) {
  put("hasUri", uri != null)
  if (uri == null) return
  put("scheme", uri.scheme)
  runCatching {
    put("params", JSONArray(uri.queryParameterNames.sorted()))
    put("error", uri.getQueryParameter("error"))
    put("hasCode", !uri.getQueryParameter("code").isNullOrEmpty())
    val extInfo = uri.getQueryParameter("ext_info")
    put(
      "extInfo",
      when {
        extInfo == null -> "absent"
        extInfo.isEmpty() -> "empty"
        runCatching { JSONObject(extInfo) }.isSuccess -> "object"
        else -> "unparseable"
      }
    )
    val state = uri.getQueryParameter("state")
    putState(state, state != null, authWallMs)
    for (key in listOf("errorMsg", "error_description", "error_reason")) {
      uri.getQueryParameter(key)?.takeIf { it.isNotEmpty() }?.let { put(key, it) }
    }
  }
}

private fun JSONObject.putState(value: String?, present: Boolean, authWallMs: Long) {
  put("state", when {
    !present -> "absent"
    value.isNullOrEmpty() -> "empty"
    // JSON null: `optString` của SDK trả chuỗi "null" - tức KHÁC rỗng.
    value == "null" -> "null"
    else -> "set"
  })
  val stateMs = value?.toLongOrNull()
  if (stateMs != null && authWallMs > 0) put("stateDeltaMs", stateMs - authWallMs)
}

private fun shapeOf(obj: JSONObject, key: String): String = when {
  !obj.has(key) -> "absent"
  obj.isNull(key) -> "null"
  obj.opt(key) is JSONObject -> "object"
  obj.opt(key) is String -> "string"
  else -> obj.opt(key)?.javaClass?.simpleName ?: "null"
}
