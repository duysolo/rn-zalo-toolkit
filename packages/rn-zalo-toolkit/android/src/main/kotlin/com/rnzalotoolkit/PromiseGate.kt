package com.rnzalotoolkit

import android.app.Activity
import android.content.Context
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.UiThreadUtil
import com.zing.zalo.zalosdk.core.exception.InitializedException
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONObject

/**
 * Bảo đảm MỘT promise settle đúng MỘT lần, trong mọi nhánh, và luôn có trần thời gian.
 *
 * Đây là xương sống của cả thư viện, và là thứ PHẢI làm trước `ActivityEventListener`:
 * chính nó khiến việc kết quả activity bị chuyển tiếp hai lần trở thành vô hại.
 */
class PromiseGate(
  private val promise: Promise,
  timeoutMs: Long,
  private val phase: ZaloErrorPhase,
  private val onSettle: (() -> Unit)? = null,
  /**
   * Chỉ `login()` dùng: trả nhật ký của lượt ([LoginTrace]) để đính vào
   * `userInfo.details.diagnostics`. Gọi ĐÚNG MỘT lần, ngay trước khi reject.
   */
  private val diagnostics: ((ZaloThrowable) -> JSONObject?)? = null,
) {
  private val settled = AtomicBoolean(false)
  private val handler = Handler(Looper.getMainLooper())

  @Volatile
  private var timeoutRunnable: Runnable? = null

  init {
    // `timeoutMs <= 0` sẽ tắt hẳn lưới an toàn và promise treo vĩnh viễn - đúng thứ thư viện
    // này tồn tại để dẹp. Kẹp về mặc định thay vì im lặng bỏ qua.
    val effective = if (timeoutMs > 0) timeoutMs else DEFAULT_TIMEOUT_MS
    val runnable = Runnable { reject(ErrorMapping.simple(ZaloErrorCode.TIMEOUT, phase)) }
    timeoutRunnable = runnable
    handler.postDelayed(runnable, effective)
  }

  val isSettled: Boolean get() = settled.get()

  fun resolve(value: Any?): Boolean {
    if (!settled.compareAndSet(false, true)) return false
    finish()
    promise.resolve(value)
    return true
  }

  fun reject(error: ZaloThrowable): Boolean {
    if (!settled.compareAndSet(false, true)) return false
    finish()
    // BẮT BUỘC dùng overload có `userInfo`. Overload ba tham số (code, message, throwable)
    // chỉ mang được mã và câu chữ sang JS - `phase`, `nativeCode`, `signatureHashKey` sẽ
    // mất sạch, trong khi chính chúng là thứ khiến lỗi cấu hình sửa được trong một phút.
    val userInfo = Arguments.createMap().apply { putString("details", detailsWithDiagnostics(error)) }
    promise.reject(error.code.name, error.humanMessage, error, userInfo)
    return true
  }

  /** Nhật ký hỏng thì vẫn reject bằng `details` gốc - chẩn đoán không được chặn đường settle. */
  private fun detailsWithDiagnostics(error: ZaloThrowable): String {
    val details = error.detailsJson()
    val provide = diagnostics ?: return details
    return runCatching {
      JSONObject(details).apply { provide(error)?.let { put("diagnostics", it) } }.toString()
    }.getOrDefault(details)
  }

  private fun finish() {
    timeoutRunnable?.let { handler.removeCallbacks(it) }
    timeoutRunnable = null
    onSettle?.invoke()
  }

  companion object {
    const val DEFAULT_TIMEOUT_MS = 120_000L

    /**
     * Chạy một lời gọi vào SDK Zalo sao cho MỌI nhánh đều settle.
     *
     * Gate chỉ bọc callback là chưa đủ: `ZaloSDK.authenticateZaloWithAuthenType` gọi
     * `checkInitialize()` NGAY DÒNG ĐẦU và ném `InitializedException` (một
     * `RuntimeException`, không ai bắt hộ) nếu `wrap()` chưa chạy. Không bọc thì mục tiêu
     * "sai cấu hình phải lên tiếng, không treo" biến thành CRASH.
     *
     * Chạy trên main thread vì các task nội bộ của SDK là `AsyncTask`, và vì cờ
     * `useWeakReferenceCallback` được đọc ở đúng thread này.
     */
    fun runOnUi(gate: PromiseGate, block: () -> Unit) {
      UiThreadUtil.runOnUiThread {
        try {
          block()
        } catch (e: InitializedException) {
          gate.reject(
            ZaloThrowable(
              ZaloErrorCode.INVALID_CONFIG,
              ZaloErrorPhase.config,
              "ZaloSDK chưa khởi tạo. Auto-init qua ContentProvider không chạy được.",
              nativeMessage = e.message,
              cause = e,
            )
          )
        } catch (t: Throwable) {
          gate.reject(
            ZaloThrowable(
              ZaloErrorCode.UNKNOWN,
              // Giữ ĐÚNG phase của gate. Gán cứng `authorize` sẽ khiến lỗi của
              // `getProfile`/`refreshTokens` báo sai giai đoạn, mà `phase` chính là thứ JS
              // dùng để phân nhánh.
              gate.phase,
              ErrorMapping.humanMessage(ZaloErrorCode.UNKNOWN),
              nativeMessage = t.message,
              cause = t,
            )
          )
        }
      }
    }

    /**
     * Như [runOnUi] nhưng đòi một `Activity` đang hiển thị.
     *
     * CHỈ `login()` cần cái này. `javap` xác nhận chỉ `authenticateZaloWithAuthenType` nhận
     * `Activity`; `getAccessTokenByOAuthCode`, `getAccessTokenByRefreshToken` và `getProfile`
     * đều nhận `Context`. Bắt cả bốn phải có Activity nghĩa là `refreshTokens()` - đúng
     * use-case "làm mới token dưới nền" - sẽ hỏng mỗi khi app không ở tiền cảnh.
     */
    fun runWithActivity(gate: PromiseGate, activity: Activity?, block: (Activity) -> Unit) {
      if (activity == null) {
        gate.reject(
          ZaloThrowable(
            ZaloErrorCode.INVALID_CONFIG,
            ZaloErrorPhase.config,
            "Không có màn hình nào đang hiển thị - hãy gọi login() khi ứng dụng ở tiền cảnh.",
          )
        )
        return
      }
      runOnUi(gate) { block(activity) }
    }

    /** Biến thể dùng `Context` cho các lời gọi không mở UI. */
    fun runWithContext(gate: PromiseGate, context: Context, block: (Context) -> Unit) {
      runOnUi(gate) { block(context) }
    }
  }
}
