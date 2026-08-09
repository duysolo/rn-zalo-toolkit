import Foundation
import UIKit
import ZaloSDK

/// Kiểm cấu hình LOCAL và trả về báo cáo đọc được.
///
/// GIỚI HẠN - phải nói ra, đừng bán quá lời:
/// hàm này chỉ thấy những gì có trên máy. Nó KHÔNG biết Zalo portal đã đăng ký bundle ID
/// hay chưa - chuyện đó chỉ lộ khi đăng nhập, và khi ấy lỗi `INVALID_CONFIG` sẽ kèm sẵn
/// bundle ID + appId để dán lên portal.
enum InstallCheck {
    static func report() -> [String: Any] {
        var issues: [[String: Any]] = []
        let appId = ZaloConfig.appIdFromInfoPlist

        if appId == nil {
            issues.append([
                "code": "MISSING_APP_ID",
                "severity": "error",
                "message": "Chưa khai `ZaloAppID` trong Info.plist. Mọi lời gọi Zalo sẽ báo lỗi cấu hình.",
                "fix": "Thêm vào Info.plist:\n<key>ZaloAppID</key>\n<string>APP_ID_CUA_BAN</string>",
            ])
        }

        if let appId {
            let expected = ZaloConfig.expectedURLScheme(appId: appId)
            if !ZaloConfig.declaredURLSchemes.contains(expected) {
                issues.append([
                    "code": "URL_SCHEME_MISSING",
                    "severity": "error",
                    "message": "Thiếu URL scheme `\(expected)`. Zalo sẽ không gọi ngược được về app sau khi người dùng đồng ý, và đăng nhập sẽ dừng ở màn Zalo.",
                    "fix": "Info.plist → CFBundleURLTypes → CFBundleURLSchemes, thêm `\(expected)`.",
                ])
            }
        }

        let missingQueries = ZaloConfig.requiredQueriesSchemes.filter {
            !ZaloConfig.declaredQueriesSchemes.contains($0)
        }
        if !missingQueries.isEmpty {
            issues.append([
                "code": "QUERIES_SCHEMES_MISSING",
                "severity": "warn",
                "message": "Thiếu \(missingQueries.joined(separator: ", ")) trong LSApplicationQueriesSchemes. Đăng nhập qua ứng dụng Zalo sẽ không mở được và luôn rơi về web.",
                "fix": "Info.plist → LSApplicationQueriesSchemes, thêm `zalosdk` và `zaloshareext`.",
            ])
        }

        let sdkAppId = ZaloSDK.sharedInstance()?.appId()
        if sdkAppId == nil || sdkAppId?.isEmpty == true {
            issues.append([
                "code": "SDK_NOT_INITIALIZED",
                "severity": "error",
                "message": "ZaloSDK chưa khởi tạo. Thư viện tự làm việc này khi đọc được `ZaloAppID`, nên gặp lỗi này gần như chắc chắn là do thiếu khoá đó.",
                "fix": "Khai `ZaloAppID` trong Info.plist. Không cần gọi `initialize(withAppId:)` trong AppDelegate nữa.",
            ])
        }

        // Chỉ dám kết luận khi ĐỦ ba tiền đề: SDK đã báo rời app, app đã quay lại, và chưa
        // từng thấy URL nào được chuyển tiếp. Thiếu tiền đề đầu nghĩa là luồng đăng nhập
        // chạy NGAY TRONG app (`WKWebView` hoặc `SFAuthenticationSession`) - hai luồng đó
        // không sinh `openURL`, và suy diễn ở đây sẽ giết một phiên đang sống.
        if RnZaloToolkitURLTracking.looksUnwired {
            issues.append([
                "code": "URL_HANDLER_NOT_WIRED",
                "severity": "error",
                "message": "App đã mở Zalo rồi quay lại nhưng chưa lần nào chuyển tiếp URL callback. Đăng nhập qua ứng dụng Zalo sẽ không bao giờ hoàn tất.",
                "fix": "Trong AppDelegate: `if ZaloToolkit.handle(url: url, options: options) { return true }`\nHoặc SceneDelegate: `ZaloToolkit.handle(context)` trong `scene(_:openURLContexts:)` VÀ trong `connectionOptions.urlContexts` của `scene(_:willConnectTo:options:)`.",
            ])
        }

        let hasError = issues.contains { ($0["severity"] as? String) == "error" }

        return [
            "ok": !hasError,
            "platform": "ios",
            "appId": appId as Any,
            "nativeSdkVersion": ZaloSDK.sharedInstance()?.getVersion() ?? "unknown",
            "issues": issues,
            "details": [
                "zaloAppInstalled": isZaloInstalled(),
                "bundleId": Bundle.main.bundleIdentifier as Any,
            ],
        ]
    }

    /// `canOpenURL` chỉ trả đúng khi scheme nằm trong `LSApplicationQueriesSchemes`, nên
    /// kết quả `false` có thể là "chưa cài" HOẶC "chưa khai scheme". Báo cáo ở trên đã có
    /// mục riêng cho vế thứ hai để người đọc không kết luận nhầm.
    private static func isZaloInstalled() -> Bool {
        guard let url = URL(string: "zalosdk://") else { return false }
        return UIApplication.shared.canOpenURL(url)
    }
}
