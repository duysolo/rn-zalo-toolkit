# Setup iOS

## Bước 1 - Info.plist

Thay `1234567890123456789` bằng app id của bạn:

```xml
<key>ZaloAppID</key>
<string>1234567890123456789</string>

<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLName</key><string>zalo</string>
    <key>CFBundleURLSchemes</key>
    <array><string>zalo-1234567890123456789</string></array>
  </dict>
</array>

<key>LSApplicationQueriesSchemes</key>
<array>
  <string>zalosdk</string>
  <string>zaloshareext</string>
</array>
```

URL scheme phải là `zalo-` cộng app id, viết liền.

Không cần gọi hàm khởi tạo SDK trong `AppDelegate`. Thư viện đọc `ZaloAppID` và tự khởi tạo.

## Bước 2 - nhận URL callback

Sau khi user đăng nhập, Zalo mở lại app bạn qua URL scheme. App phải chuyển URL đó cho thư viện.

**AppDelegate:**

```swift
import RnZaloToolkit

func application(_ app: UIApplication, open url: URL,
                 options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
  if ZaloToolkit.handle(url: url, options: options) { return true }
  return false
}
```

Nếu app bạn đã có sẵn Google Sign-In hay tương tự, cứ để chúng nối tiếp phía sau:

```swift
  if ZaloToolkit.handle(url: url, options: options) { return true }
  return GIDSignIn.sharedInstance.handle(url)
```

`ZaloToolkit.handle` chỉ trả `true` khi URL thật sự là của Zalo, nên handler phía sau vẫn nhận
được URL của chúng.

**Nếu app dùng SceneDelegate**, cần thêm ở cả hai hàm:

```swift
func scene(_ scene: UIScene, openURLContexts contexts: Set<UIOpenURLContext>) {
  contexts.forEach { _ = ZaloToolkit.handle($0) }
}

func scene(_ scene: UIScene, willConnectTo session: UISceneSession,
           options connectionOptions: UIScene.ConnectionOptions) {
  connectionOptions.urlContexts.forEach { _ = ZaloToolkit.handle($0) }
}
```

Hàm thứ hai xử lý trường hợp app đang tắt hẳn. Thiếu nó thì đăng nhập vẫn chạy khi app đang mở,
chỉ hỏng khi mở app từ đầu - rất dễ bỏ sót.

Quên bước 2 thì `login({ via: 'app' })` sẽ trả lỗi `NOT_WIRED`.

## Bước 3 - đăng ký app trên Zalo

Vào [Zalo for Developers](https://developers.zalo.me) và khai **Bundle ID** của app iOS.

## Bước 4 - privacy manifest

Apple yêu cầu khai lý do dùng một số API. SDK Zalo không tự khai nên app bạn phải khai, thêm vào
`PrivacyInfo.xcprivacy`:

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

Trong **App Store Connect → Data Collection**, Apple tính cả dữ liệu do SDK bên thứ ba thu thập.
SDK Zalo đọc thông tin định danh thiết bị, nên tối thiểu khai:

- Identifiers → Device ID
- Usage Data → Product Interaction

## CocoaPods

Bạn không cần thêm gì vào `Podfile`. SDK Zalo đi kèm trong package dưới dạng Swift Package, không
tải từ CocoaPods.

React Native 0.85 vẫn dùng CocoaPods để tự nối native module, nên `pod install` vẫn chạy như bình
thường. Chỉ là nó không kéo SDK Zalo về nữa.

## Kiểm tra lại

```sh
npx rn-zalo-toolkit-doctor
```

Lệnh này đọc file cấu hình của app và báo thiếu gì. Nó không cần build và không cần thiết bị.
