# Cài đặt - iOS

## SDK Zalo đến từ đâu

Không từ CocoaPods. Zalo **không** phát hành SDK iOS qua Swift Package Manager (repo chính hãng
`VNG-Zalo/ZaloSDK-iOS` chỉ có `ZaloSDK.podspec`), nên thư viện này tự bọc xcframework thành một
Swift Package:

```
node_modules/rn-zalo-toolkit/ios/ZaloSDKBinary/Package.swift
```

Podspec của thư viện **không khai một `s.dependency` bên thứ ba nào** - nó chỉ trỏ
`vendored_frameworks` vào đúng xcframework mà `Package.swift` kia mô tả. Bạn không cần thêm gì
vào `Podfile`.

> React Native 0.85 vẫn autolink native module qua CocoaPods, nên podspec vẫn phải tồn tại.
> Điều đã loại bỏ được là **dependency CocoaPods lên SDK Zalo**. Ngày React Native hỗ trợ
> autolink bằng SPM, podspec bỏ đi được mà không đụng dòng Swift nào.

## Info.plist

Ba khoá:

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

**Không** gọi `ZaloSDK.sharedInstance()?.initialize(withAppId:)` trong `AppDelegate` nữa. Thư
viện đọc `ZaloAppID` và khởi tạo trong một `__attribute__((constructor))`, tức **sớm hơn**
`didFinishLaunching`. Đó không
phải tiện tay: `initializeWithAppId:` kích một lượt mạng nạp settings quyết định luồng đăng nhập
nào sẽ chạy, nên khởi tạo muộn khiến **lần đăng nhập đầu sau cold start có thể đi luồng khác các
lần sau**.

## Một dòng bạn phải tự viết

iOS không cho pod chen vào `UIApplicationDelegate`/`UISceneDelegate` một cách sạch sẽ, nên phần
này không tự động hoá được.

**AppDelegate:**

```swift
import RnZaloToolkit

func application(_ app: UIApplication, open url: URL,
                 options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
  if ZaloToolkit.handle(url: url, options: options) { return true }
  return GIDSignIn.sharedInstance.handle(url)   // chuỗi của bạn giữ nguyên
}
```

`handle` trả về **giá trị thật** của SDK, không phải `true` vô điều kiện - nên chuỗi xử lý phía
sau vẫn nhận được URL không phải của Zalo.

**SceneDelegate - cần CẢ HAI chỗ:**

```swift
func scene(_ scene: UIScene, openURLContexts contexts: Set<UIOpenURLContext>) {
  contexts.forEach { _ = ZaloToolkit.handle($0) }
}

// Thiếu chỗ này thì cold start qua Zalo hỏng im lặng
func scene(_ scene: UIScene, willConnectTo session: UISceneSession,
           options connectionOptions: UIScene.ConnectionOptions) {
  connectionOptions.urlContexts.forEach { _ = ZaloToolkit.handle($0) }
}
```

Quên bước này thì `verifyInstallation()` báo `URL_HANDLER_NOT_WIRED` - nhưng chỉ **sau** một lần
đăng nhập qua ứng dụng Zalo, và chỉ khi đủ ba tiền đề. Lý do nó không đoán sớm hơn: hai trong ba
luồng đăng nhập của SDK (`WKWebView` trong app, và `SFAuthenticationSession`) **không sinh
`openURL` nào cả**, mà việc chọn luồng do máy chủ Zalo quyết lúc chạy. Kết luận sớm sẽ giết một
phiên đăng nhập đang sống.

Cách chắc chắn hơn là chạy `npx rn-zalo-toolkit-doctor` - nó đọc file, không đoán.

## Privacy manifest

SDK Zalo `4.1.0120` **không có** `PrivacyInfo.xcprivacy`. Thư viện ship manifest cho mã của
chính nó, nhưng phần của SDK thì **app phải tự khai**:

| Category | Reason | Vì SDK đụng gì |
|---|---|---|
| `NSPrivacyAccessedAPICategoryUserDefaults` | `CA92.1` | `NSUserDefaults` để lưu token/state |
| `NSPrivacyAccessedAPICategoryFileTimestamp` | `C617.1` | `attributesOfItemAtPath:` + `NSFileCreationDate` để định danh thiết bị |

**Không** cần `SystemBootTime`, `DiskSpace`, `ActiveKeyboards`. Keychain `SecItem*` không thuộc
danh sách required-reason.

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

**App Store Connect - Data Collection:** Apple tính cả dữ liệu do SDK bên thứ ba thu. SDK Zalo có
`ZDKDeviceTracker`, đọc `identifierForVendor`, `CTTelephonyNetworkInfo`, và gọi
`centralized.zaloapp.com`. Tối thiểu khai **Identifiers → Device ID** và
**Usage Data → Product Interaction**.

## Nâng version SDK Zalo

```sh
# 1. Sửa sdkVersions.ios.zaloSdk trong packages/rn-zalo-toolkit/package.json
# 2. Nạp lại xcframework (tự cắt slice chết)
npm run vendor:sync
# 3. Kiểm binary
npm run check:zalosdk
```

`npm run check:upstream` báo khi Zalo ra bản mới - chạy sẵn theo lịch trong CI.

## Hai thứ đang canh trong binary

`npm run check:zalosdk` cảnh báo hai điều, và chúng là **trigger phải xem lại quyết định bọc SDK
chính hãng**:

1. Slice thiết bị còn dùng `LC_VERSION_MIN_IPHONEOS` (minos 9.0) - định dạng tiền-Xcode-11.
2. Binary tham chiếu cứng `SFAuthenticationSession`, deprecated từ iOS 12. Nếu Apple gỡ khỏi
   runtime thì app **chết lúc launch** (dyld) - không phải lỗi build, nên không CI nào bắt được.

Slice `armv7`/`i386` thì **không** phải vấn đề: script vendor đã cắt, và kể cả còn thì linker
chọn `arm64`.
