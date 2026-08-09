import Foundation

/// Mã lỗi công khai. Giữ ĐỒNG BỘ với `src/errors.ts` và `ErrorMapping.kt`.
enum ZaloErrorCode: String {
    case cancelled = "CANCELLED"
    case loginInProgress = "LOGIN_IN_PROGRESS"
    case zaloNotInstalled = "ZALO_NOT_INSTALLED"
    case zaloOutOfDate = "ZALO_OUT_OF_DATE"
    case invalidConfig = "INVALID_CONFIG"
    case notWired = "NOT_WIRED"
    case network = "NETWORK"
    case timeout = "TIMEOUT"
    case tokenExchangeFailed = "TOKEN_EXCHANGE_FAILED"
    case invalidToken = "INVALID_TOKEN"
    case profileRestricted = "PROFILE_RESTRICTED"
    case rateLimited = "RATE_LIMITED"
    case unknown = "UNKNOWN"
}

enum ZaloErrorPhase: String {
    case config, authorize, exchange, profile
}

/// Lỗi chuẩn hoá. `humanMessage` là thứ người dùng cuối sẽ ĐỌC - app tiêu thụ bung thẳng
/// nó ra alert - nên nó không bao giờ được chứa JSON, token hay chuỗi kỹ thuật.
struct ZaloToolkitError: Error {
    let code: ZaloErrorCode
    let phase: ZaloErrorPhase
    let humanMessage: String
    var nativeCode: Int?
    var nativeMessage: String?
    var bundleId: String?
    var appId: String?

    /// Chi tiết đi qua `userInfo["details"]`, KHÔNG qua `message`.
    var detailsJSON: String {
        var payload: [String: Any] = ["phase": phase.rawValue]
        if let nativeCode { payload["nativeCode"] = nativeCode }
        if let nativeMessage { payload["nativeMessage"] = nativeMessage }
        if let bundleId { payload["bundleId"] = bundleId }
        if let appId { payload["appId"] = appId }
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8)
        else { return "{}" }
        return json
    }

    var asNSError: NSError {
        NSError(
            domain: "RnZaloToolkit",
            code: nativeCode ?? 0,
            userInfo: ["details": detailsJSON, NSLocalizedDescriptionKey: humanMessage]
        )
    }
}

enum ErrorMapping {
    /// Ánh xạ mã lỗi của SDK iOS sang mã công khai.
    ///
    /// ⚠️ BẢNG NÀY CHỈ ĐÚNG CHO iOS. Cùng một con số mang nghĩa KHÁC trên Android:
    ///   -7014  iOS = AuthenticationFailed      | Android = ZALO_APP_NOT_INSTALLED
    ///   -7015  iOS = AuthenticationExceeded    | Android = ZALO_OUT_OF_DATE
    /// Ai gộp hai nền tảng vào một bảng sẽ khiến người dùng Android chưa cài Zalo nhận
    /// thông báo "xác thực thất bại". `src/errorTable.json` là nguồn duy nhất; test
    /// `ios/Tests/ErrorMappingTests.swift` đối chiếu hàm này với file đó.
    static func code(forNative native: Int, phase: ZaloErrorPhase) -> ZaloErrorCode {
        switch native {
        // Huỷ - tập MỞ: -1001 không hề có trong `ZDKZaloError.h` nhưng demo chính hãng
        // dùng chính nó làm mốc "không phải cancel".
        case -7021, -7035, -1011, -1005, -1001, -6003:
            return .cancelled

        case -7023: return .zaloNotInstalled
        case -7022: return .zaloOutOfDate
        case -7024: return .network
        case -7025: return .timeout
        case -7015: return .rateLimited

        case -5000, -5001, -5002, -5005, -5006, -5008, -5009, -5010, -6005, -7004:
            return .invalidConfig

        case -5003, -5004, -5007, -5011, -5016, -5017, -5020, -6002:
            return .invalidToken

        // Zalo chặn theo IP: thiết bị ngoài Việt Nam luôn nhận mã này ở bước lấy hồ sơ.
        case -501: return .profileRestricted
        case 12000, 12002, 12003, 12004, 12010: return .rateLimited

        default:
            return phase == .exchange ? .tokenExchangeFailed : .unknown
        }
    }

    /// Câu tiếng Việt hiển thị được cho người dùng cuối.
    static func humanMessage(for code: ZaloErrorCode) -> String {
        switch code {
        case .cancelled: return "Bạn đã huỷ đăng nhập Zalo."
        case .loginInProgress: return "Đang có một phiên đăng nhập Zalo chạy dở."
        case .zaloNotInstalled: return "Thiết bị chưa cài ứng dụng Zalo."
        case .zaloOutOfDate: return "Ứng dụng Zalo trên máy đã cũ, cần cập nhật."
        case .invalidConfig: return "Cấu hình Zalo chưa đúng."
        case .notWired: return "Ứng dụng chưa chuyển tiếp URL callback cho Zalo."
        case .network: return "Không kết nối được máy chủ Zalo."
        case .timeout: return "Đăng nhập Zalo quá thời gian chờ."
        case .tokenExchangeFailed: return "Không lấy được thông tin đăng nhập từ Zalo."
        case .invalidToken: return "Phiên đăng nhập Zalo đã hết hạn."
        case .profileRestricted: return "Zalo giới hạn thông tin cá nhân với kết nối ngoài Việt Nam."
        case .rateLimited: return "Zalo đang giới hạn số lần gọi, vui lòng thử lại sau."
        case .unknown: return "Đăng nhập Zalo không thành công."
        }
    }

    static func error(
        native: Int,
        nativeMessage: String?,
        phase: ZaloErrorPhase
    ) -> ZaloToolkitError {
        let code = code(forNative: native, phase: phase)
        var error = ZaloToolkitError(
            code: code,
            phase: phase,
            humanMessage: humanMessage(for: code)
        )
        error.nativeCode = native
        error.nativeMessage = nativeMessage
        if code == .invalidConfig {
            // Người đọc lỗi này cần đúng hai thứ để đi sửa trên Zalo portal.
            error.bundleId = Bundle.main.bundleIdentifier
            error.appId = ZaloConfig.appIdFromInfoPlist
        }
        return error
    }

    static func simple(
        _ code: ZaloErrorCode,
        phase: ZaloErrorPhase,
        message: String? = nil
    ) -> ZaloToolkitError {
        ZaloToolkitError(
            code: code,
            phase: phase,
            humanMessage: message ?? humanMessage(for: code)
        )
    }
}
