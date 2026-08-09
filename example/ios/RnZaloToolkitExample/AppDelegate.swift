import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import RnZaloToolkit
import UIKit

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    // KHÔNG có `ZaloSDK.sharedInstance()?.initialize(withAppId:)` ở đây.
    //
    // Thư viện tự đọc `ZaloAppID` từ Info.plist và khởi tạo SDK trong `+load`, tức trước cả
    // hàm này. Đó không phải tiện tay: `initializeWithAppId:` kích một lượt mạng nạp settings
    // quyết định luồng đăng nhập nào sẽ chạy, nên khởi tạo muộn khiến lần đăng nhập ĐẦU sau
    // cold start có thể đi luồng khác các lần sau.

    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    factory.startReactNative(
      withModuleName: "RnZaloToolkitExample",
      in: window,
      launchOptions: launchOptions
    )

    return true
  }

  /// ĐÂY LÀ DÒNG DUY NHẤT app phải tự viết cho Zalo trên iOS.
  ///
  /// iOS không cho pod chen vào `UIApplicationDelegate` một cách sạch sẽ, nên phần này không
  /// tự động hoá được. Bù lại, `verifyInstallation()` sẽ báo `URL_HANDLER_NOT_WIRED` nếu ai
  /// đó quên - thay vì để đăng nhập treo im lặng.
  ///
  /// Lưu ý `handle` trả về giá trị THẬT: nếu URL không phải của Zalo nó trả `false` và chuỗi
  /// xử lý bên dưới (Google Sign-In chẳng hạn) vẫn nhận được.
  func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    if ZaloToolkit.handle(url: url, options: options) { return true }
    return false
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
