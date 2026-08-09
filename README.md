# rn-zalo-toolkit

Đăng nhập Zalo cho React Native. Bọc SDK chính hãng của Zalo trên Android và iOS, **lấy SDK iOS
qua Swift Package Manager thay vì CocoaPods**, và bảo đảm mọi lời gọi đều kết thúc.

> **Phạm vi: chỉ xác thực.** Không có share/feed/message, không đăng nhập qua
> Facebook/Apple/Google, không guest login. Đó là giới hạn có chủ đích, không phải "chưa làm".

---

## Vì sao có thư viện này

Nó thay thế `react-native-zalo-kit` và giải đúng hai vấn đề khiến thư viện đó khó dùng trong
production:

**1. Promise treo.** Bốn đường dẫn tới trạng thái "không bao giờ settle": nhánh lỗi đổi token bị
nuốt hoàn toàn, hai callback `onZaloNotInstalled` / `onZaloOutOfDate` không được override, và
`currentActivity` null không được kiểm. Hệ quả ở tầng JS là app phải theo dõi `AppState` để
**đoán** xem người dùng có huỷ hay không - một heuristic sai thường xuyên khi mạng chậm.

Ở đây mỗi entry point native đi qua một `PromiseGate` settle-đúng-một-lần, bọc cả lời gọi đồng
bộ lẫn callback, và luôn có trần thời gian **áp ở native**. JS không bao giờ phải đoán.

**2. Cấu hình sai một cách im lặng.** Trước đây mỗi app phải tự viết ~5 mảnh glue native ở 4 file
khác nhau; thiếu một mảnh là đăng nhập treo, không thông báo gì. Ở đây thư viện tự lo vòng đời
native của mình, app chỉ khai app id - và khai sai thì **build fail** với thông báo chỉ đúng chỗ
cần sửa.

## SDK iOS qua SPM

Zalo **không** phát hành SDK iOS qua Swift Package Manager - repo chính hãng chỉ có podspec.
Nên thư viện này tự bọc xcframework thành một Swift Package thật:

```
ios/ZaloSDKBinary/Package.swift    ← binaryTarget cho ZaloSDK + ZaloSDKCoreKit
```

Kết quả: **không một `s.dependency` bên thứ ba nào** trong podspec. App của bạn không kéo SDK
Zalo từ CocoaPods trunk nữa.

Giới hạn phải nói rõ: React Native 0.85 vẫn autolink native module qua CocoaPods, nên podspec
vẫn tồn tại - nó chỉ trỏ `vendored_frameworks` vào đúng xcframework mà `Package.swift` mô tả.
Ngày React Native hỗ trợ autolink bằng SPM, xoá podspec là xong, không phải đụng một dòng Swift.

## Cài đặt

```sh
npm install rn-zalo-toolkit
```

**Android** - `android/gradle.properties`:

```properties
zaloAppId=1993903030729882479
```

Hết. Không sửa `MainApplication`, không sửa `MainActivity`, không sửa `AndroidManifest`.

**iOS** - `Info.plist` (`ZaloAppID`, URL scheme `zalo-<appId>`, `LSApplicationQueriesSchemes`)
và **một dòng** trong `AppDelegate`:

```swift
func application(_ app: UIApplication, open url: URL,
                 options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
  if ZaloToolkit.handle(url: url, options: options) { return true }
  return false   // chuỗi xử lý của bạn (Google Sign-In...) giữ nguyên
}
```

Chi tiết: [`docs/guides/setup-android.md`](docs/guides/setup-android.md) ·
[`docs/guides/setup-ios.md`](docs/guides/setup-ios.md)

Kiểm cấu hình bất cứ lúc nào, không cần build:

```sh
npx rn-zalo-toolkit-doctor
```

## Dùng

```ts
import { login, logout, getProfile, ZaloError } from 'rn-zalo-toolkit'

try {
  const result = await login({ via: 'app_or_web' })
  // Nhánh 'device' đảm bảo CÓ token ở mức kiểu - không cần `if (!accessToken) throw`
  if (result.exchange === 'device') {
    await sendToBackend(result.accessToken)
  }
} catch (error) {
  if (ZaloError.is(error, 'CANCELLED')) return          // bình thường, nuốt đi
  if (ZaloError.is(error, 'ZALO_NOT_INSTALLED')) { /* ... */ }
  if (ZaloError.is(error, 'INVALID_CONFIG')) {
    // Lỗi cấu hình kèm sẵn thứ cần dán lên Zalo portal
    console.log(error.signatureHashKey, error.packageName)
  }
}
```

API đầy đủ: [`docs/reference/api.md`](docs/reference/api.md) ·
Mã lỗi: [`docs/reference/errors.md`](docs/reference/errors.md)

## Chuyển từ `react-native-zalo-kit`

Xem [`docs/guides/migrate-from-react-native-zalo-kit.md`](docs/guides/migrate-from-react-native-zalo-kit.md).
Bề mặt thay đổi nhỏ hơn vẻ ngoài: thường chỉ một file service của app.

## Yêu cầu

| | |
|---|---|
| React Native | 0.85+ (New Architecture, TurboModule) |
| iOS | 16.0+ · SDK Zalo `4.1.0120` (vendored, qua SPM) |
| Android | minSdk 24 · SDK Zalo `me.zalo:sdk-auth:4.24.1101` (pin cứng) |

## Giấy phép

Apache-2.0. SDK Zalo được vendor kèm theo giấy phép MIT của chính nó -
xem `ios/ZaloSDKBinary/Frameworks/LICENSE-ZaloSDK`.
