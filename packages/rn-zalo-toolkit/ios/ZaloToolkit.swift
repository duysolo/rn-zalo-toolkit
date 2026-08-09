import Foundation
import UIKit
import ZaloSDK
import ZaloSDKCoreKit

/// Bề mặt Swift công khai mà app tiêu thụ gọi tới.
///
/// Chỉ có ĐÚNG MỘT việc app phải tự làm trên iOS: chuyển tiếp URL callback. iOS không cho
/// pod chen vào `UIApplicationDelegate`/`UISceneDelegate` một cách sạch sẽ (swizzling thì
/// có, nhưng đó là món nợ đắt hơn một dòng code rất nhiều), nên thư viện lo hết phần còn
/// lại - appId, khởi tạo SDK, delegate, vòng đời - và chỉ xin lại một dòng này.
///
/// AppDelegate:
///
///     import RnZaloToolkit
///     func application(_ app: UIApplication, open url: URL,
///                      options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
///         if ZaloToolkit.handle(url: url, options: options) { return true }
///         return GIDSignIn.sharedInstance.handle(url)   // chuỗi xử lý của bạn giữ nguyên
///     }
///
/// SceneDelegate - cần CẢ HAI chỗ, thiếu chỗ thứ hai thì cold start qua Zalo sẽ im lặng hỏng:
///
///     func scene(_ scene: UIScene, openURLContexts contexts: Set<UIOpenURLContext>) {
///         contexts.forEach { _ = ZaloToolkit.handle($0) }
///     }
///     func scene(_ scene: UIScene, willConnectTo session: UISceneSession,
///                options connectionOptions: UIScene.ConnectionOptions) {
///         connectionOptions.urlContexts.forEach { _ = ZaloToolkit.handle($0) }
///     }
@objc(ZaloToolkit)
public final class ZaloToolkit: NSObject {
    /// Trả về **đúng** giá trị mà `ZDKApplicationDelegate` trả về.
    ///
    /// ⚠️ TUYỆT ĐỐI không trả `true` vô điều kiện. App tiêu thụ dựa vào chuỗi
    /// `Zalo → Google → ...`; trả `true` mù sẽ nuốt URL của nhà cung cấp khác và làm gãy
    /// đăng nhập Google. SDK vốn trả `NO` khi URL không phải của nó.
    @discardableResult
    @objc public static func handle(
        url: URL,
        options: [UIApplication.OpenURLOptionsKey: Any] = [:]
    ) -> Bool {
        RnZaloToolkitCore.markURLHandled()
        return ZDKApplicationDelegate.sharedInstance().application(
            UIApplication.shared, open: url, options: options
        )
    }

    @discardableResult
    @objc public static func handle(url: URL) -> Bool {
        handle(url: url, options: [:])
    }

    /// Dạng dùng cho `UIScene`. Thư viện tự dựng dictionary options - nếu không có overload
    /// này thì mỗi app dùng SceneDelegate lại phải tự viết 5 dòng chuyển đổi kiểu, đúng thứ
    /// mà thư viện này sinh ra để dẹp.
    @discardableResult
    @available(iOS 13.0, *)
    public static func handle(_ context: UIOpenURLContext) -> Bool {
        var options: [UIApplication.OpenURLOptionsKey: Any] = [:]
        if let source = context.options.sourceApplication {
            options[.sourceApplication] = source
        }
        if let annotation = context.options.annotation {
            options[.annotation] = annotation
        }
        return handle(url: context.url, options: options)
    }
}

/// Khởi tạo SDK SỚM, trước cả `didFinishLaunching`.
///
/// Vì sao không đợi TurboModule được dựng (lazy, lần JS gọi đầu tiên):
/// `-[ZaloSDK initializeWithAppId:]` kích `ZDKSettingManager loadSettings` - một lượt mạng
/// quyết định `loginZaloAppWebViewEnabled` / `loginBrowser`, tức quyết định luồng đăng nhập
/// nào sẽ chạy. Khởi tạo muộn khiến **lần đăng nhập đầu sau cold start có thể đi luồng khác
/// các lần sau** - đúng hạng lỗi "lúc chạy lúc không" mà thư viện này tồn tại để dẹp.
@objc(RnZaloToolkitBootstrap)
public final class RnZaloToolkitBootstrap: NSObject {
    @objc public override init() {
        super.init()
    }

    @objc public static func bootstrap() {
        RnZaloToolkitCore.shared.bootstrap()
    }
}
