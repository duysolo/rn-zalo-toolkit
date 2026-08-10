# rn-zalo-toolkit

Đăng nhập Zalo cho React Native. Bọc SDK chính hãng của Zalo trên Android và iOS, và lấy SDK iOS
qua Swift Package Manager thay vì CocoaPods.

Phạm vi: chỉ có auth. Không có share/feed/message, không đăng nhập qua Facebook/Apple/Google,
không guest login.

## Điểm chính

- **Promise luôn settle.** Mọi entry point native đều có timeout áp ở native, nên app không cần
  theo dõi `AppState` để đoán user đã cancel hay chưa.
- **Config sai thì build fail** kèm thông báo chỉ chỗ sửa. App chỉ khai app id, không phải đụng
  `MainApplication`, `MainActivity` hay `AndroidManifest`.
- **Một error model cho cả hai nền tảng.** Một class `ZaloError` với tập error code hữu hạn, nên
  `switch` trên nó được TypeScript kiểm tra đủ nhánh.
- Có sẵn jest mock và CLI `npx rn-zalo-toolkit-doctor` để kiểm tra config.

## SDK iOS lấy qua SPM

Zalo không phát hành SDK iOS qua Swift Package Manager, repo chính hãng chỉ có podspec. Nên thư
viện tự bọc xcframework thành một Swift Package:

```
ios/ZaloSDKBinary/Package.swift    → binaryTarget cho ZaloSDK + ZaloSDKCoreKit
```

Podspec của thư viện không khai `s.dependency` bên thứ ba nào, nên app không còn kéo SDK Zalo từ
CocoaPods trunk.

React Native 0.85 vẫn autolink native module qua CocoaPods nên podspec vẫn phải tồn tại, nhưng nó
chỉ trỏ `vendored_frameworks` vào xcframework mà `Package.swift` mô tả. Khi React Native hỗ trợ
autolink bằng SPM thì bỏ podspec đi được, không phải sửa dòng Swift nào.

## Cài đặt

```sh
npm install rn-zalo-toolkit
```

**Android** - thêm một dòng vào `android/gradle.properties`:

```properties
zaloAppId=1993903030729882479
```

**iOS** - thêm `ZaloAppID`, URL scheme `zalo-<appId>` và `LSApplicationQueriesSchemes` vào
`Info.plist`, rồi forward URL callback trong `AppDelegate`:

```swift
func application(_ app: UIApplication, open url: URL,
                 options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
  if ZaloToolkit.handle(url: url, options: options) { return true }
  return false   // chain hiện có của bạn (Google Sign-In...) giữ nguyên
}
```

Chi tiết: [setup Android](docs/guides/setup-android.md) ·
[setup iOS](docs/guides/setup-ios.md)

Kiểm tra config bất cứ lúc nào, không cần build:

```sh
npx rn-zalo-toolkit-doctor
```

## Dùng

```ts
import { login, ZaloError, ZaloErrorCode, ZaloExchangeMode, ZaloLoginVia } from 'rn-zalo-toolkit'

try {
  const result = await login({ via: ZaloLoginVia.APP_OR_WEB })

  // Kết quả là discriminated union, nên nhánh DEVICE có token ở mức type.
  if (result.exchange === ZaloExchangeMode.DEVICE) {
    await sendToBackend(result.accessToken)
  }
} catch (error) {
  if (ZaloError.is(error, ZaloErrorCode.CANCELLED)) return

  if (ZaloError.is(error, ZaloErrorCode.INVALID_CONFIG)) {
    // Lỗi config mang sẵn giá trị cần dán lên Zalo portal.
    console.log(error.signatureHashKey, error.packageName)
  }
}
```

Các giá trị dạng chuỗi đều có sẵn enum: `ZaloErrorCode`, `ZaloLoginVia`, `ZaloExchangeMode`,
`ZaloErrorPhase`, `ZaloEventName`, `ZaloChannel`, `ZaloPlatform`, `ZaloInstallIssueCode`. Chúng
là object `as const` chứ không phải `enum` của TypeScript, nên vẫn nhận string literal - code cũ
viết `'CANCELLED'` không vỡ.

API đầy đủ: [api.md](docs/reference/api.md) · Error code: [errors.md](docs/reference/errors.md) ·
[Xử lý sự cố](docs/troubleshooting.md)

## Yêu cầu

| | |
|---|---|
| React Native | 0.85+ (New Architecture, TurboModule) |
| iOS | 15.1+ · SDK Zalo `4.1.0120`, vendored qua SPM |
| Android | minSdk 24 · SDK Zalo `me.zalo:sdk-auth` + `sdk-core` `4.24.1101`, pin cứng |

## Giấy phép

Apache-2.0. SDK Zalo đi kèm theo giấy phép MIT của chính nó, xem
`ios/ZaloSDKBinary/Frameworks/LICENSE-ZaloSDK`.
