package com.rnzalotoolkit

import com.zing.zalo.zalosdk.ZaloOAuthResultCode
import org.json.JSONObject

/** Mã lỗi công khai. Giữ ĐỒNG BỘ với `src/errors.ts` và `ErrorMapping.swift`. */
enum class ZaloErrorCode {
  CANCELLED,
  LOGIN_IN_PROGRESS,
  ZALO_NOT_INSTALLED,
  ZALO_OUT_OF_DATE,
  INVALID_CONFIG,
  NOT_WIRED,
  NETWORK,
  TIMEOUT,
  TOKEN_EXCHANGE_FAILED,
  INVALID_TOKEN,
  PROFILE_RESTRICTED,
  RATE_LIMITED,
  UNKNOWN,
}

enum class ZaloErrorPhase { config, authorize, exchange, profile }

/**
 * Lỗi đã chuẩn hoá.
 *
 * `humanMessage` là thứ NGƯỜI DÙNG CUỐI sẽ đọc - app tiêu thụ bung thẳng nó ra alert - nên
 * nó không bao giờ được chứa JSON, token hay chuỗi kỹ thuật. Mọi chi tiết máy đọc đi qua
 * `detailsJson` → `userInfo.details`.
 */
class ZaloThrowable(
  val code: ZaloErrorCode,
  val phase: ZaloErrorPhase,
  val humanMessage: String,
  val nativeCode: Int? = null,
  val nativeMessage: String? = null,
  val signatureHashKey: String? = null,
  val packageName: String? = null,
  val appId: String? = null,
  cause: Throwable? = null,
) : Throwable(humanMessage, cause) {

  fun detailsJson(): String =
    JSONObject().apply {
      put("phase", phase.name)
      nativeCode?.let { put("nativeCode", it) }
      nativeMessage?.let { put("nativeMessage", it) }
      signatureHashKey?.let { put("signatureHashKey", it) }
      packageName?.let { put("packageName", it) }
      appId?.let { put("appId", it) }
    }.toString()
}

object ErrorMapping {

  /**
   * Ánh xạ mã lỗi của SDK Android sang mã công khai.
   *
   * ⚠️ BẢNG NÀY CHỈ ĐÚNG CHO ANDROID. Cùng một con số mang nghĩa KHÁC hẳn trên iOS:
   *   -7014  Android = ZALO_APP_NOT_INSTALLED  |  iOS = AuthenticationFailed
   *   -7015  Android = ZALO_OUT_OF_DATE        |  iOS = AuthenticationExceeded (rate limit)
   *
   * Ai gộp hai nền tảng vào một bảng sẽ khiến người dùng Android chưa cài Zalo nhận thông
   * báo "xác thực thất bại", và người dùng iOS bị giới hạn tần suất nhận "Zalo bản cũ".
   *
   * Các hằng số được đọc từ `ZaloOAuthResultCode` của chính SDK thay vì viết số bằng tay:
   * ngày Zalo đổi số, test sẽ đỏ chứ không phải production đỏ.
   * Nguồn duy nhất của bảng: `src/errorTable.json`; `ErrorMappingTest` đối chiếu hai bên.
   */
  fun codeForNative(native: Int, phase: ZaloErrorPhase): ZaloErrorCode = when (native) {
    ZaloOAuthResultCode.ERR_USER_BACK,
    ZaloOAuthResultCode.ERR_USER_REJECT,
    ZaloOAuthResultCode.ERR_USER_NOT_CONSENT -> ZaloErrorCode.CANCELLED

    ZaloOAuthResultCode.ERR_ZALO_APP_NOT_INSTALLED -> ZaloErrorCode.ZALO_NOT_INSTALLED
    ZaloOAuthResultCode.ERR_ZALO_OUT_OF_DATE -> ZaloErrorCode.ZALO_OUT_OF_DATE
    ZaloOAuthResultCode.ERR_NO_NETWORK -> ZaloErrorCode.NETWORK

    ZaloOAuthResultCode.ERR_APP_ID_IS_INVALID,
    ZaloOAuthResultCode.ERR_INVALID_CALLBACK_URL,
    ZaloOAuthResultCode.ERR_INVALID_CLIENT_SECRET,
    ZaloOAuthResultCode.ERR_INVALID_ANDROID_PACKAGE,
    ZaloOAuthResultCode.ERR_INVALID_ANDROID_SIGN_KEY,
    ZaloOAuthResultCode.ERR_INVALID_CODE_CHALLENGE,
    ZaloOAuthResultCode.ERR_INVALID_CODE_VERIFIER,
    ZaloOAuthResultCode.ERR_WEB_VIEW_LOGIN_NOT_ALLOWED,
    ZaloOAuthResultCode.ERR_USER_BANNED,
    ZaloOAuthResultCode.ERR_APPLICATION_IS_NOT_APPROVED -> ZaloErrorCode.INVALID_CONFIG

    ZaloOAuthResultCode.ERR_INVALID_OAUTHORIZED_CODE,
    ZaloOAuthResultCode.ERR_INVALID_ACCESS_TOKEN,
    ZaloOAuthResultCode.ERR_INVALID_SESSION,
    ZaloOAuthResultCode.ERR_INVALID_REFRESH_TOKEN,
    ZaloOAuthResultCode.ERR_AUTHORIZED_CODE_EXPIRED,
    ZaloOAuthResultCode.ERR_REFRESH_TOKEN_EXPIRED,
    ZaloOAuthResultCode.ERR_OAUTH_CODE_INVALID,
    ZaloOAuthResultCode.ERR_USER_NOT_LOGIN -> ZaloErrorCode.INVALID_TOKEN

    // CSRF - state không khớp. Đáng log riêng: có thể là dấu hiệu bị cướp scheme.
    ZaloOAuthResultCode.ERR_INVALID_STATE,
    ZaloOAuthResultCode.ERR_ZALO_WEBVIEW_COOKIE_ERROR,
    ZaloOAuthResultCode.ERR_UNKNOWN_ERROR -> ZaloErrorCode.UNKNOWN

    // Zalo chặn theo IP nguồn: thiết bị ngoài Việt Nam luôn nhận mã này ở bước lấy hồ sơ.
    -501 -> ZaloErrorCode.PROFILE_RESTRICTED
    12000, 12002, 12003, 12004, 12010 -> ZaloErrorCode.RATE_LIMITED

    else -> if (phase == ZaloErrorPhase.exchange) ZaloErrorCode.TOKEN_EXCHANGE_FAILED
            else ZaloErrorCode.UNKNOWN
  }

  /** Câu tiếng Việt hiển thị được cho người dùng cuối. */
  fun humanMessage(code: ZaloErrorCode): String = when (code) {
    ZaloErrorCode.CANCELLED -> "Bạn đã huỷ đăng nhập Zalo."
    ZaloErrorCode.LOGIN_IN_PROGRESS -> "Đang có một phiên đăng nhập Zalo chạy dở."
    ZaloErrorCode.ZALO_NOT_INSTALLED -> "Thiết bị chưa cài ứng dụng Zalo."
    ZaloErrorCode.ZALO_OUT_OF_DATE -> "Ứng dụng Zalo trên máy đã cũ, cần cập nhật."
    ZaloErrorCode.INVALID_CONFIG -> "Cấu hình Zalo chưa đúng."
    ZaloErrorCode.NOT_WIRED -> "Ứng dụng chưa chuyển tiếp kết quả đăng nhập cho Zalo."
    ZaloErrorCode.NETWORK -> "Không kết nối được máy chủ Zalo."
    ZaloErrorCode.TIMEOUT -> "Đăng nhập Zalo quá thời gian chờ."
    ZaloErrorCode.TOKEN_EXCHANGE_FAILED -> "Không lấy được thông tin đăng nhập từ Zalo."
    ZaloErrorCode.INVALID_TOKEN -> "Phiên đăng nhập Zalo đã hết hạn."
    ZaloErrorCode.PROFILE_RESTRICTED ->
      "Zalo giới hạn thông tin cá nhân với kết nối ngoài Việt Nam."
    ZaloErrorCode.RATE_LIMITED -> "Zalo đang giới hạn số lần gọi, vui lòng thử lại sau."
    ZaloErrorCode.UNKNOWN -> "Đăng nhập Zalo không thành công."
  }

  fun simple(
    code: ZaloErrorCode,
    phase: ZaloErrorPhase,
    message: String? = null,
    cause: Throwable? = null,
  ) = ZaloThrowable(code, phase, message ?: humanMessage(code), cause = cause)
}
