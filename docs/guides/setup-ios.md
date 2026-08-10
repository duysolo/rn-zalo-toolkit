# Setup - iOS

## SDK Zalo đến từ đâu

Không từ CocoaPods. Zalo không phát hành SDK iOS qua Swift Package Manager (repo chính hãng
`VNG-Zalo/ZaloSDK-iOS` chỉ có `ZaloSDK.podspec`), nên thư viện tự bọc xcframework thành một Swift
Package:

```
node_modules/rn-zalo-toolkit/ios/ZaloSDKBinary/Package.swift
```

Podspec của thư viện không khai `s.dependency` bên thứ ba nào, nó chỉ trỏ `vendored_frameworks`
vào xcframework mà `Package.swift` mô tả. Bạn không cần thêm gì vào `Podfile`.

React Native 0.85 vẫn autolink native module qua CocoaPods nên podspec vẫn phải tồn tại. Thứ đã
bỏ được là dependency CocoaPods lên SDK Zalo. Khi React Native hỗ trợ autolink bằng SPM thì xoá
podspec đi được, không đụng dòng Swift nào.

## Info.plist

Ba key:

```xml
<key>ZaloAppID</key>
<string>1993903030729882479</string>

<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLName</key><string>zalo</string>
    <key>CFBundleURLSchemes</key>
    <array><string>zalo-1993903030729882479</string></array>
  </dict>
</array>

<key>LSApplicationQueriesSchemes</key>
<array>
  <string>zalosdk</string>
  <string>zaloshareext</string>
</array>
```

Không cần gọi `ZaloSDK.sharedInstance()?.initialize(withAppId:)` trong `AppDelegate`. Thư viện
đọc `ZaloAppID` và khởi tạo trong một `__attribute__((constructor))`, tức chạy trước
`didFinishLaunching`.

Sớm như vậy là có lý do: `initializeWithAppId:` kích một request nạp settings từ server, và
settings đó quyết định luồng đăng nhập nào sẽ chạy. Khởi tạo muộn thì lần login đầu tiên sau cold
start có thể đi luồng khác với các lần sau.

## Một dòng bạn phải tự viết

iOS không cho pod chen vào `UIApplicationDelegate`/`UISceneDelegate` một cách sạch sẽ, nên phần
này không tự động hoá được.

**AppDelegate:**

```swift
import RnZaloToolkit

func application(_ app: UIApplication, open url: URL,
                 options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
  if ZaloToolkit.handle(url: url, options: options) { return true }
  return GIDSignIn.sharedInstance.handle(url)   // chain của bạn giữ nguyên
}
```

`handle` trả về giá trị thật của SDK chứ không phải `true` vô điều kiện, nên các handler phía sau
vẫn nhận được URL không phải của Zalo.

**SceneDelegate - cần cả hai chỗ:**

```swift
func scene(_ scene: UIScene, openURLContexts contexts: Set<UIOpenURLContext>) {
  contexts.forEach { _ = ZaloToolkit.handle($0) }
}

// Thiếu hàm này thì cold start qua Zalo hỏng, mà app đang chạy thì vẫn ổn - rất dễ bỏ sót.
func scene(_ scene: UIScene, willConnectTo session: UISceneSession,
           options connectionOptions: UIScene.ConnectionOptions) {
  connectionOptions.urlContexts.forEach { _ = ZaloToolkit.handle($0) }
}
```

Quên bước này thì `login({ via: 'app' })` sẽ trả `NOT_WIRED` khi hết timeout, và
`verifyInstallation()` báo `URL_HANDLER_NOT_WIRED`.

Lưu ý là thư viện chỉ kết luận sau khi đã thử một lần login qua app Zalo, chứ không đoán sớm hơn.
Lý do: hai trong ba luồng đăng nhập của SDK (`WKWebView` nhúng trong app, và
`SFAuthenticationSession`) không sinh `openURL` nào cả, mà việc chọn luồng thì do server Zalo
quyết lúc chạy. Kết luận sớm sẽ giết nhầm một phiên đăng nhập đang chạy bình thường.

Muốn biết chắc mà không cần login thử thì chạy `npx rn-zalo-toolkit-doctor`, nó đọc file config
chứ không suy đoán.

## Privacy manifest

SDK Zalo `4.1.0120` không có `PrivacyInfo.xcprivacy`. Thư viện ship manifest cho code của chính
nó, còn phần thuộc SDK thì app phải tự khai:

| Category | Reason | SDK dùng để làm gì |
|---|---|---|
| `NSPrivacyAccessedAPICategoryUserDefaults` | `CA92.1` | `NSUserDefaults` lưu token và state |
| `NSPrivacyAccessedAPICategoryFileTimestamp` | `C617.1` | `attributesOfItemAtPath:` + `NSFileCreationDate` để định danh thiết bị |

Không cần `SystemBootTime`, `DiskSpace` hay `ActiveKeyboards`. Keychain `SecItem*` không nằm
trong danh sách required-reason.

```xml
<key>NSPrivacyAccessedAPITypes</key>
<array>
  <dict>
    <key>NSPrivacyAccessedAPIType</key>
    <string>NSPrivacyAccessedAPICategoryUserDefaults</string>
    <key>NSPrivacyAccessedAPITypeReasons</key>
    <array><string>CA92.1</string></array>
  </dict>
  <dict>
    <key>NSPrivacyAccessedAPIType</key>
    <string>NSPrivacyAccessedAPICategoryFileTimestamp</string>
    <key>NSPrivacyAccessedAPITypeReasons</key>
    <array><string>C617.1</string></array>
  </dict>
</array>
```

**App Store Connect - Data Collection.** Apple tính cả dữ liệu do SDK bên thứ ba thu thập. SDK
Zalo có `ZDKDeviceTracker` đọc `identifierForVendor`, `CTTelephonyNetworkInfo` và gọi
`centralized.zaloapp.com`. Tối thiểu khai **Identifiers → Device ID** và **Usage Data → Product
Interaction**.

## Nâng version SDK Zalo

```sh
# 1. Sửa sdkVersions.ios.zaloSdk trong packages/rn-zalo-toolkit/package.json
# 2. Tải lại xcframework (script tự cắt slice không dùng)
npm run vendor:sync
# 3. Kiểm tra binary
npm run check:zalosdk
```

`npm run check:upstream` báo khi Zalo ra bản mới, và đã chạy sẵn theo lịch trong CI.

## Hai thứ đang theo dõi trong binary

`npm run check:zalosdk` cảnh báo hai điểm. Chúng không chặn build, nhưng nếu chuyển thành lỗi
thật thì phải xem lại việc bọc SDK chính hãng:

1. Slice cho thiết bị vẫn dùng `LC_VERSION_MIN_IPHONEOS` (minos 9.0), là định dạng có từ trước
   Xcode 11.
2. Binary tham chiếu cứng `SFAuthenticationSession`, deprecated từ iOS 12. Nếu Apple gỡ khỏi
   runtime thì app chết ngay lúc launch (dyld). Đây không phải lỗi build nên không CI nào bắt
   được.

Slice `armv7`/`i386` thì không phải vấn đề: script vendor đã cắt bỏ, mà kể cả còn thì linker vẫn
chọn `arm64`.
