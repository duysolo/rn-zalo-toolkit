package com.rnzalotoolkit

import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.Intent
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.module.annotations.ReactModule
import com.rnzalotoolkit.Json.putOrNull
import com.rnzalotoolkit.Json.stringOrNull
import com.zing.zalo.zalosdk.core.helper.AppInfo
import com.zing.zalo.zalosdk.oauth.LoginChannel
import com.zing.zalo.zalosdk.oauth.LoginVia
import com.zing.zalo.zalosdk.oauth.OAuthCompleteListener
import com.zing.zalo.zalosdk.oauth.OauthResponse
import com.zing.zalo.zalosdk.oauth.ZaloSDK
import com.zing.zalo.zalosdk.oauth.model.ErrorResponse
import java.lang.ref.WeakReference
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import org.json.JSONObject

@ReactModule(name = RnZaloToolkitModule.NAME)
class RnZaloToolkitModule(reactContext: ReactApplicationContext) :
  NativeRnZaloToolkitSpec(reactContext) {

  private val loginInFlight = AtomicBoolean(false)
  private val pendingGate = AtomicReference<PromiseGate?>(null)
  /** Access token của phiên gần nhất, CHỈ trong RAM. Không có gì được ghi xuống đĩa. */
  private val sessionAccessToken = AtomicReference<String?>(null)
  /**
   * Giữ listener bằng field của chính module.
   *
   * `Authenticator.getOAuthCompleteListener()` khi tham chiếu đã mất **trả về một listener
   * RỖNG** thay vì null - SDK sẽ gọi vào hư không, promise không bao giờ settle, không log,
   * không crash. Đó là một đường treo im lặng, và cách duy nhất để chắc chắn không rơi vào
   * là tự giữ tham chiếu mạnh.
   */
  private val activeListener = AtomicReference<OAuthCompleteListener?>(null)
  /** Nhật ký của lượt `login()` đang chạy - xem [LoginTrace]. Null khi không có lượt nào. */
  private val activeTrace = AtomicReference<LoginTrace?>(null)
  /** Activity đã mở lượt đăng nhập, để biết kết quả có quay về đúng nó không (máy gập tạo lại activity). */
  private val authActivity = AtomicReference<WeakReference<Activity>?>(null)

  /**
   * Mốc app rời/về tiền cảnh trong lúc chờ Zalo - thường là dấu hiệu app Zalo hay trình duyệt
   * đã mở ra, và khoảng cách từ `authenticateReturned` tới `hostPause` lộ ra việc SDK chờ
   * service của Zalo (~5 s khi ROM chặn bind). KHÔNG coi việc thiếu `hostPause` là bằng chứng:
   * máy gập/chia màn hình (multi-resume, Android 10+) có thể không pause app khi Zalo mở cạnh bên.
   */
  private val lifecycleListener = object : LifecycleEventListener {
    override fun onHostResume() { activeTrace.get()?.event("hostResume", noisy = true) }
    override fun onHostPause() { activeTrace.get()?.event("hostPause", noisy = true) }
    override fun onHostDestroy() { activeTrace.get()?.event("hostDestroy", noisy = true) }
  }

  private val activityEventListener = object : BaseActivityEventListener() {
    override fun onActivityResult(
      activity: Activity,
      requestCode: Int,
      resultCode: Int,
      data: Intent?,
    ) {
      // LỌC requestCode. `ReactContext.onActivityResult` phát cho MỌI listener với MỌI
      // requestCode - image picker, camera, in-app-update... Không lọc thì mọi kết quả
      // của activity khác đều chạy vào SDK Zalo.
      if (requestCode != REQ_ZALO_APP && requestCode != REQ_ZALO_WEB) return

      // Không có phiên nào đang chờ ⇒ bỏ qua im lặng. `BrowserLoginActivity` phải
      // `exported="true"` để trình duyệt gọi ngược về được, nên app khác cũng gửi intent
      // vào được; không có chốt này thì chúng bơm được state rác vào SDK.
      val gate = pendingGate.get()
      if (gate == null || gate.isSettled) return

      // Ghi TRƯỚC khi chuyển cho SDK: SDK gọi listener đồng bộ, ghi sau thì thứ tự sai.
      activeTrace.get()?.let { trace ->
        trace.event("activityResult") {
          put("requestCode", requestCode)
          put("resultCode", resultCode)
          put("sameActivity", authActivity.get()?.get() === activity)
          putActivityResult(data, trace.authWallMs)
        }
      }

      runCatching { ZaloSDK.Instance.onActivityResult(activity, requestCode, resultCode, data) }

      // CỐ Ý KHÔNG suy ra CANCELLED từ `resultCode`.
      // `Authenticator.onActivityResult` bỏ qua hẳn `resultCode`, và nhánh
      // `receiveOAuthDataV4(activity, null)` (user bấm back / từ chối) ĐÃ tự gọi
      // `onAuthenError(-7008/-7009)`. Suy diễn thêm ở đây vừa thừa vừa là một heuristic
      // mới - đúng thứ thư viện này sinh ra để dẹp.
    }
  }

  init {
    reactContext.addActivityEventListener(activityEventListener)
    reactContext.addLifecycleEventListener(lifecycleListener)
  }

  override fun getName(): String = NAME

  override fun invalidate() {
    reactApplicationContext.removeActivityEventListener(activityEventListener)
    reactApplicationContext.removeLifecycleEventListener(lifecycleListener)
    pendingGate.get()?.reject(
      ErrorMapping.simple(
        ZaloErrorCode.CANCELLED,
        ZaloErrorPhase.authorize,
        "Phiên đăng nhập bị huỷ vì React context đã bị huỷ.",
      )
    )
    releaseListener()
    super.invalidate()
  }

  // ── login ──────────────────────────────────────────────────────────────────

  override fun login(optionsJson: String, promise: Promise) {
    val options = runCatching { JSONObject(optionsJson) }.getOrDefault(JSONObject())
    val via = when (options.optString("via", "app_or_web")) {
      "app" -> LoginVia.APP
      "web" -> LoginVia.WEB
      else -> LoginVia.APP_OR_WEB
    }
    val exchangeMode = options.optString("exchange", "device")
    val includeRefresh = options.optBoolean("includeRefreshToken", false)
    val timeoutMs = options.optLong("timeoutMs", 120_000L)
    val extInfo = options.optJSONObject("extInfo") ?: JSONObject()

    // Single-flight: `Authenticator` chỉ có MỘT ô listener, nên lần gọi thứ hai sẽ ghi đè
    // lần thứ nhất và gate cũ chỉ chết bằng timeout.
    if (!loginInFlight.compareAndSet(false, true)) {
      rejectWithDetails(
        promise, ErrorMapping.simple(ZaloErrorCode.LOGIN_IN_PROGRESS, ZaloErrorPhase.authorize)
      )
      return
    }

    val pkce = Pkce.generate()
    val attemptId = UUID.randomUUID().toString()
    val trace = LoginTrace(attemptId)
    trace.event("login") {
      put("via", via.name)
      put("exchange", exchangeMode)
    }
    val application = reactApplicationContext.applicationContext as? Application
    val activityCallbacks = TraceActivityCallbacks(trace)
    // THỨ TỰ QUAN TRỌNG: nhả listener TRƯỚC khi mở cổng single-flight.
    // Đảo lại thì `login()` #2 có thể chen vào giữa, gán `activeListener = listener2`, rồi
    // `releaseListener()` của phiên #1 mới chạy và xoá mất listener của phiên #2 - promise
    // #2 treo im lặng tới timeout.
    val gate = PromiseGate(
      promise, timeoutMs, ZaloErrorPhase.authorize,
      onSettle = {
        releaseListener()
        pendingGate.set(null)
        activeTrace.compareAndSet(trace, null)
        runCatching { application?.unregisterActivityLifecycleCallbacks(activityCallbacks) }
        loginInFlight.set(false)
      },
      diagnostics = { error ->
        trace.event("reject") {
          put("code", error.code.name)
          put("phase", error.phase.name)
          error.nativeCode?.let { put("nativeCode", it) }
          error.cause?.let { put("cause", "${it.javaClass.name}: ${it.message}") }
        }
        trace.toJson()
      },
    )
    activeTrace.set(trace)
    pendingGate.set(gate)
    runCatching { application?.registerActivityLifecycleCallbacks(activityCallbacks) }
    // SAU khi có gate: bản chụp gọi ~15 câu hỏi PackageManager qua binder; một câu treo thì
    // timeout của gate vẫn settle lượt này và mở lại cổng single-flight.
    runCatching {
      trace.setEnvironment(
        LoginEnvironment.snapshot(reactApplicationContext, reactApplicationContext.currentActivity)
      )
    }
    // Gate đã settle trong lúc chụp (binder treo tới timeout, hoặc `logout()` chen vào) -
    // promise đã reject, đừng mở Zalo cho một lượt không còn ai chờ. Gỡ lại callbacks vì
    // `onSettle` có thể đã chạy TRƯỚC khi chúng được đăng ký.
    if (gate.isSettled) {
      runCatching { application?.unregisterActivityLifecycleCallbacks(activityCallbacks) }
      return
    }

    val listener = buildListener(gate, trace, attemptId, pkce.verifier, exchangeMode, includeRefresh)
    activeListener.set(listener)

    PromiseGate.runWithActivity(gate, reactApplicationContext.currentActivity) { activity ->
      authActivity.set(WeakReference(activity))
      trace.authWallMs = System.currentTimeMillis()
      trace.event("authenticate") { put("activity", activity.javaClass.simpleName) }
      // Đặt cờ NGAY TRƯỚC `authenticate`, trên cùng thread đọc nó. `Authenticator` khởi tạo
      // `useWeakReferenceCallback = true`, và field đó không volatile - đặt ở JS thread thì
      // UI thread có thể vẫn thấy `true`, lưu WeakReference, listener bị GC, và
      // `getOAuthCompleteListener()` trả về một listener RỖNG (treo im lặng).
      ZaloSDK.Instance.setUseWeakReferenceCallback(false)
      ZaloSDK.Instance.authenticateZaloWithAuthenType(
        activity, via, pkce.challenge, extInfo, listener
      )
      // Đồng bộ trừ khi cờ `useWebViewForUnloginZalo` bật: khi đó SDK hỏi service của Zalo
      // trên thread riêng (tới 5 s) rồi mới mở app hoặc trình duyệt.
      trace.event("authenticateReturned")
    }
  }

  /**
   * Override đúng **5** callback có thật.
   *
   * `OAuthCompleteListener` khai 10 method, nhưng quét bytecode cả ba AAR
   * (`sdk-auth`/`sdk-core`/`sdk-openapi` 4.24.1101) cho thấy `onStartLoading`,
   * `onGetPermissionData`, `onProtectAccComplete`, `onSkipProtectAcc` **không có call site
   * nào**, còn `onRequestAccountProtect` chỉ đi qua `getLoginFormOAuthCompleteListener()`
   * mà setter của nó là `protected` - ngoài package không đăng ký được.
   *
   * Tập gây treo thật sự chỉ là HAI: `onZaloNotInstalled` và `onZaloOutOfDate`. Thư viện cũ
   * bỏ đúng hai cái đó, và đó là lý do "Zalo chưa cài / bản cũ" khiến promise treo vĩnh viễn.
   *
   * Không gọi `super` là an toàn tuyệt đối: bản mặc định của hai callback ấy chỉ dựng một
   * `AlertDialog` (nút thuận → `launchMarketApp("com.zing.zalo")`, nút nghịch → `dismiss()`),
   * không đụng field nội bộ nào. Ta mất cái dialog đó - và đó là chủ đích, app tự quyết
   * hiển thị gì.
   */
  private fun buildListener(
    gate: PromiseGate,
    trace: LoginTrace,
    attemptId: String,
    verifier: String,
    exchangeMode: String,
    includeRefresh: Boolean,
  ) = object : OAuthCompleteListener() {

    override fun onGetOAuthComplete(response: OauthResponse) {
      val oauthCode = response.oauthCode
      trace.event("oauthComplete") {
        put("hasCode", !oauthCode.isNullOrEmpty())
        put("channel", channelName(response.channel))
        put("isRegister", response.isRegister)
      }
      if (oauthCode.isNullOrEmpty()) {
        gate.reject(
          ErrorMapping.simple(ZaloErrorCode.UNKNOWN, ZaloErrorPhase.authorize)
        )
        return
      }

      // Chỉ báo khi phiên còn sống. Kết quả lạc của một phiên đã hết giờ không được làm UI
      // đổi nhãn. Và bọc runCatching: `emitOnOauthCodeReceived` gọi thẳng
      // `mEventEmitterCallback` (nullable, không guard) - ném ở đây sẽ nổi lên tận trong
      // SDK và làm mất luôn nhánh settle ngay bên dưới.
      if (!gate.isSettled) {
        runCatching {
          emitOnOauthCodeReceived(Arguments.createMap().apply { putString("attemptId", attemptId) })
        }
      }

      val channel = channelName(response.channel)
      if (exchangeMode == "none") {
        gate.resolve(
          JSONObject().apply {
            put("exchange", "none")
            put("oauthCode", oauthCode)
            put("codeVerifier", verifier)
            put("channel", channel)
            put("isNewUser", response.isRegister)
          }.toString()
        )
        return
      }

      trace.event("exchange")
      PromiseGate.runWithContext(gate, reactApplicationContext) { context ->
        ZaloSDK.Instance.getAccessTokenByOAuthCode(context, oauthCode, verifier) { data ->
          trace.event("tokenResult") {
            put("hasData", data != null)
            if (data != null) {
              put("error", data.optInt("error", 0))
              put("extCode", data.optInt("extCode", 0))
              put("hasAccessToken", data.optString("access_token").isNotEmpty())
              data.optString("error_description").ifEmpty { data.optString("message") }
                .takeIf { it.isNotEmpty() }?.let { put("message", it) }
            }
          }
          handleTokenResult(gate, data, oauthCode, channel, response.isRegister, includeRefresh)
        }
      }
    }

    override fun onAuthenError(errorResponse: ErrorResponse) {
      // Nguyên bản trước ánh xạ: `fromSource` (app / browser / web_view / web_login) là thứ
      // duy nhất cho biết SDK đã đi đường nào, và `ZaloThrowable` không mang nó.
      trace.event("authenError") {
        put("errorCode", errorResponse.errorCode)
        put("extCode", errorResponse.extCode)
        errorResponse.errorMsg?.let { put("errorMsg", it) }
        errorResponse.errorReason?.takeIf { it.isNotEmpty() }?.let { put("errorReason", it) }
        errorResponse.errorDescription?.takeIf { it.isNotEmpty() }?.let { put("errorDescription", it) }
        errorResponse.fromSource?.takeIf { it.isNotEmpty() }?.let { put("fromSource", it) }
      }
      gate.reject(nativeError(errorResponse, ZaloErrorPhase.authorize))
    }

    // ← Trước đây TREO: SDK chạy nhánh mặc định, listener không bao giờ được gọi.
    override fun onZaloNotInstalled(context: Context?) {
      trace.event("zaloNotInstalled")
      gate.reject(
        ErrorMapping.simple(ZaloErrorCode.ZALO_NOT_INSTALLED, ZaloErrorPhase.authorize)
      )
    }

    // ← Trước đây TREO.
    override fun onZaloOutOfDate(context: Context?) {
      trace.event("zaloOutOfDate")
      gate.reject(
        ErrorMapping.simple(ZaloErrorCode.ZALO_OUT_OF_DATE, ZaloErrorPhase.authorize)
      )
    }

    override fun onFinishLoading() {
      // Chỉ để đánh dấu mốc khi debug - không đụng gate.
    }
  }

  private fun handleTokenResult(
    gate: PromiseGate,
    data: JSONObject?,
    oauthCode: String,
    channel: String,
    isNewUser: Boolean,
    includeRefresh: Boolean,
  ) {
    // Nhánh lỗi ở đây rất dễ bị bỏ quên (err != 0 mà không resolve cũng
    // không reject) → promise treo vĩnh viễn → JS diễn giải nhầm thành "người dùng huỷ".
    if (data == null) {
      gate.reject(ErrorMapping.simple(ZaloErrorCode.TOKEN_EXCHANGE_FAILED, ZaloErrorPhase.exchange))
      return
    }

    val err = data.optInt("error", data.optInt("extCode", 0))
    val accessToken = data.optString("access_token")
    if (err != 0 || accessToken.isEmpty()) {
      gate.reject(
        ZaloThrowable(
          ErrorMapping.codeForNative(err, ZaloErrorPhase.exchange),
          ZaloErrorPhase.exchange,
          ErrorMapping.humanMessage(
            ErrorMapping.codeForNative(err, ZaloErrorPhase.exchange)
          ),
          nativeCode = err,
          nativeMessage = data.optString("error_description").ifEmpty { data.optString("message") },
        )
      )
      return
    }

    sessionAccessToken.set(accessToken)
    gate.resolve(
      JSONObject().apply {
        put("exchange", "device")
        put("oauthCode", oauthCode)
        put("accessToken", accessToken)
        put("expiresAt", expiresAtMillis(data))
        put("channel", channel)
        put("isNewUser", isNewUser)
        if (includeRefresh) put("refreshToken", data.optString("refresh_token"))
      }.toString()
    )
  }

  // ── token ──────────────────────────────────────────────────────────────────

  override fun exchangeOAuthCode(oauthCode: String, codeVerifier: String, promise: Promise) {
    val gate = PromiseGate(promise, 60_000L, ZaloErrorPhase.exchange)
    PromiseGate.runWithContext(gate, reactApplicationContext) { context ->
      ZaloSDK.Instance.getAccessTokenByOAuthCode(context, oauthCode, codeVerifier) { data ->
        resolveTokens(gate, data)
      }
    }
  }

  override fun refreshTokens(refreshToken: String, promise: Promise) {
    val gate = PromiseGate(promise, 60_000L, ZaloErrorPhase.exchange)
    PromiseGate.runWithContext(gate, reactApplicationContext) { context ->
      ZaloSDK.Instance.getAccessTokenByRefreshToken(context, refreshToken) { data ->
        resolveTokens(gate, data)
      }
    }
  }

  /** Không bao giờ reject - một câu hỏi boolean không được bắt người gọi viết try/catch. */
  override fun isRefreshTokenValid(refreshToken: String, promise: Promise) {
    if (refreshToken.isEmpty()) {
      promise.resolve(false)
      return
    }
    val gate = PromiseGate(promise, 30_000L, ZaloErrorPhase.exchange)
    runCatching {
      ZaloSDK.Instance.isAuthenticate(refreshToken) { validated, _, _ ->
        gate.resolve(validated)
      }
    }.onFailure { gate.resolve(false) }
  }

  override fun logout(promise: Promise) {
    // Huỷ phiên login đang dở TRƯỚC khi xoá token: nếu không, bước đổi token của phiên đó
    // có thể về sau `logout()` và ghi lại `sessionAccessToken` - token sống qua đăng xuất.
    pendingGate.get()?.reject(
      ErrorMapping.simple(
        ZaloErrorCode.CANCELLED, ZaloErrorPhase.authorize,
        "Đăng xuất trong lúc đang đăng nhập.",
      )
    )
    // Trên UI thread như mọi lời gọi SDK khác - quy tắc là "không có ngoại lệ", kể cả cho
    // hàm trông nhẹ. Đây chính xác là dòng đã làm corrupt bộ nhớ Hermes ở bản iOS cũ.
    UiThreadUtil.runOnUiThread {
      runCatching { ZaloSDK.Instance.unauthenticate() }
      sessionAccessToken.set(null)
      promise.resolve(null)
    }
  }

  // ── profile ────────────────────────────────────────────────────────────────

  override fun getProfile(optsJson: String, promise: Promise) {
    val opts = runCatching { JSONObject(optsJson) }.getOrDefault(JSONObject())
    // `optString` trả chuỗi "null" cho JSON null trên Android - xem `Json.kt`.
    val token = opts.stringOrNull("accessToken") ?: sessionAccessToken.get().orEmpty()
    if (token.isEmpty()) {
      rejectWithDetails(
        promise,
        ErrorMapping.simple(
          ZaloErrorCode.INVALID_TOKEN, ZaloErrorPhase.profile,
          "Chưa có phiên Zalo trong lần chạy này - hãy đăng nhập trước hoặc truyền accessToken.",
        )
      )
      return
    }

    val fieldsArray = opts.optJSONArray("fields")
    val fields = if (fieldsArray == null) DEFAULT_PROFILE_FIELDS else
      Array(fieldsArray.length()) { fieldsArray.optString(it) }

    val gate = PromiseGate(promise, 30_000L, ZaloErrorPhase.profile)
    PromiseGate.runWithContext(gate, reactApplicationContext) { context ->
      ZaloSDK.Instance.getProfile(context, token, { data ->
        if (data == null) {
          gate.reject(ErrorMapping.simple(ZaloErrorCode.UNKNOWN, ZaloErrorPhase.profile))
          return@getProfile
        }
        val err = data.optInt("error", 0)
        if (err != 0) {
          val code = ErrorMapping.codeForNative(err, ZaloErrorPhase.profile)
          gate.reject(
            ZaloThrowable(
              code, ZaloErrorPhase.profile, ErrorMapping.humanMessage(code),
              nativeCode = err, nativeMessage = data.optString("message"),
            )
          )
          return@getProfile
        }
        gate.resolve(ProfileMapper.toJson(data).toString())
      }, fields)
    }
  }

  // ── chẩn đoán ──────────────────────────────────────────────────────────────

  override fun verifyInstallation(promise: Promise) {
    promise.resolve(InstallCheck.report(reactApplicationContext).toString())
  }

  /**
   * Trả về ĐÚNG giá trị mà SDK gửi lên Zalo trong tham số `sign_key`.
   *
   * Không tự cài đặt lại: `AppInfo.getApplicationHashKey` dùng `GET_SIGNATURES` → `SHA-1`
   * → `Base64.DEFAULT` → `trim()`. Nếu ta tự tính bằng `signingInfo.apkContentsSigners`
   * (đường "hiện đại"), thì trên máy đã rotate khoá hai giá trị sẽ KHÁC NHAU, và người dùng
   * sẽ dán nhầm chuỗi lên portal - mất đúng số thời gian mà hàm này hứa tiết kiệm.
   */
  override fun getApplicationHashKey(promise: Promise) {
    promise.resolve(
      runCatching { AppInfo.getApplicationHashKey(reactApplicationContext) }.getOrNull()
    )
  }

  override fun getSdkVersion(promise: Promise) {
    promise.resolve(
      JSONObject().apply {
        put("toolkit", BuildConfig.TOOLKIT_VERSION)
        put("native", runCatching { ZaloSDK.Instance.version }.getOrDefault("unknown"))
      }.toString()
    )
  }

  // ── trợ giúp ───────────────────────────────────────────────────────────────

  /** Mọi reject sớm cũng phải mang `userInfo.details`, không chỉ reject qua gate. */
  private fun rejectWithDetails(promise: Promise, error: ZaloThrowable) {
    val userInfo = Arguments.createMap().apply { putString("details", error.detailsJson()) }
    promise.reject(error.code.name, error.humanMessage, error, userInfo)
  }

  private fun releaseListener() {
    activeListener.set(null)
    runCatching { ZaloSDK.Instance.setOauthCompletedListener(null) }
  }

  private fun resolveTokens(gate: PromiseGate, data: JSONObject?) {
    if (data == null) {
      gate.reject(ErrorMapping.simple(ZaloErrorCode.TOKEN_EXCHANGE_FAILED, ZaloErrorPhase.exchange))
      return
    }
    val err = data.optInt("error", 0)
    val accessToken = data.optString("access_token")
    if (err != 0 || accessToken.isEmpty()) {
      val code = ErrorMapping.codeForNative(err, ZaloErrorPhase.exchange)
      gate.reject(
        ZaloThrowable(
          code, ZaloErrorPhase.exchange, ErrorMapping.humanMessage(code),
          nativeCode = err, nativeMessage = data.optString("error_description"),
        )
      )
      return
    }
    sessionAccessToken.set(accessToken)
    gate.resolve(
      JSONObject().apply {
        put("accessToken", accessToken)
        put("refreshToken", data.optString("refresh_token"))
        put("expiresAt", expiresAtMillis(data))
      }.toString()
    )
  }

  private fun nativeError(response: ErrorResponse, phase: ZaloErrorPhase): ZaloThrowable {
    val native = if (response.errorCode != 0) response.errorCode else response.extCode
    val code = ErrorMapping.codeForNative(native, phase)
    val isConfig = code == ZaloErrorCode.INVALID_CONFIG
    return ZaloThrowable(
      code = code,
      phase = phase,
      humanMessage = ErrorMapping.humanMessage(code),
      nativeCode = native,
      nativeMessage = response.errorMsg ?: response.errorDescription ?: response.errorReason,
      // Người đọc lỗi cấu hình cần đúng ba thứ này để đi sửa trên Zalo portal, và có sẵn
      // trong lỗi nghĩa là không phải chạy script riêng.
      signatureHashKey = if (isConfig) {
        runCatching { AppInfo.getApplicationHashKey(reactApplicationContext) }.getOrNull()
      } else null,
      packageName = if (isConfig) reactApplicationContext.packageName else null,
      appId = if (isConfig) runCatching { ZaloSDK.Instance.appID.toString() }.getOrNull() else null,
    )
  }

  /**
   * epoch ms. Trả `Long` chứ KHÔNG phải `Double`: giá trị này vượt 2^31 và đi qua JSON
   * string chính là để tránh việc bridge ép nó thành số thực rồi mất chính xác.
   */
  private fun expiresAtMillis(data: JSONObject): Long {
    val expiresIn = data.optLong("expires_in", 0L)
    return if (expiresIn > 0) System.currentTimeMillis() + expiresIn * 1000L else 0L
  }

  private fun channelName(channel: LoginChannel?): String = when (channel) {
    LoginChannel.ZALO -> "zalo"
    LoginChannel.GUEST -> "guest"
    LoginChannel.FACEBOOK -> "facebook"
    LoginChannel.GOOGLE -> "google"
    LoginChannel.ZINGME -> "zingme"
    else -> "unknown"
  }

  companion object {
    const val NAME = "RnZaloToolkit"

    /**
     * requestCode mà `Authenticator` thật sự dùng (đọc từ bytecode `sdk-auth 4.24.1101`).
     * Lọc theo hai giá trị này là cách duy nhất để không đụng vào kết quả của activity khác.
     */
    private const val REQ_ZALO_APP = 64725
    private const val REQ_ZALO_WEB = 64728

    private val DEFAULT_PROFILE_FIELDS =
      arrayOf("id", "name", "picture", "birthday", "gender")
  }
}
