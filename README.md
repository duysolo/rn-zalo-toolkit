# rn-zalo-toolkit

Đăng nhập Zalo cho React Native, dùng SDK chính hãng của Zalo trên cả Android và iOS.

Trên iOS, SDK Zalo được lấy qua Swift Package Manager, không qua CocoaPods.

```ts
import { login } from 'rn-zalo-toolkit'

const result = await login()
await sendToBackend(result.oauthCode)
```

## Cài đặt

```sh
npm install rn-zalo-toolkit
```

Cần React Native 0.85 trở lên (New Architecture).

### Android

Thêm app id vào `android/gradle.properties`:

```properties
zaloAppId=1234567890123456789
```

Xong. Không cần sửa `MainApplication`, `MainActivity` hay `AndroidManifest`.

### iOS

Thêm 3 key vào `Info.plist` (thay `1234567890123456789` bằng app id của bạn):

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

Rồi thêm một dòng vào `AppDelegate` để nhận URL callback từ Zalo:

```swift
import RnZaloToolkit

func application(_ app: UIApplication, open url: URL,
                 options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
  if ZaloToolkit.handle(url: url, options: options) { return true }
  return false
}
```

Chi tiết đầy đủ: [setup Android](docs/guides/setup-android.md) ·
[setup iOS](docs/guides/setup-ios.md)

Kiểm tra đã cấu hình đúng chưa, không cần build:

```sh
npx rn-zalo-toolkit-doctor
```

## Dùng

```ts
import { login, ZaloError, ZaloErrorCode } from 'rn-zalo-toolkit'

async function signIn() {
  try {
    const result = await login()

    // Gửi oauthCode cho backend để backend đổi lấy token.
    await sendToBackend(result.oauthCode)
  } catch (error) {
    if (ZaloError.is(error, ZaloErrorCode.CANCELLED)) {
      return // user bấm huỷ, không phải lỗi
    }
    if (ZaloError.is(error, ZaloErrorCode.ZALO_NOT_INSTALLED)) {
      // gợi ý cài Zalo, hoặc gọi lại login({ via: 'web' })
    }
    throw error
  }
}
```

Mọi hàm đều reject bằng `ZaloError` với một `code` cố định, nên bạn xử lý được từng trường hợp mà
không phải đọc chuỗi message.

## Có gì trong package

- `login`, `logout`, `getProfile`, `refreshTokens`, `exchangeOAuthCode`, `isRefreshTokenValid`
- `ZaloError` với tập mã lỗi cố định
- Mock cho jest: `jest.mock('rn-zalo-toolkit', () => require('rn-zalo-toolkit/jest'))`
- CLI kiểm tra cấu hình: `npx rn-zalo-toolkit-doctor`

Phạm vi hiện tại là đăng nhập. Không có share, feed hay message.

## Tài liệu

- [API](docs/reference/api.md) - danh sách hàm và tham số
- [Mã lỗi](docs/reference/errors.md) - từng mã nghĩa là gì và nên làm gì
- [Xử lý sự cố](docs/troubleshooting.md) - gặp lỗi thì tra ở đây
- [Setup Android](docs/guides/setup-android.md) · [Setup iOS](docs/guides/setup-ios.md)

Nếu bạn muốn sửa hoặc đóng góp cho thư viện, [ghi chú nội bộ](docs/internals.md) giải thích lý do
đằng sau các quyết định kỹ thuật.

## Yêu cầu

| | |
|---|---|
| React Native | 0.85+ |
| Android | minSdk 24 |
| iOS | 15.1+ |

## Giấy phép

Apache-2.0. SDK Zalo đi kèm theo giấy phép MIT của chính nó, xem
`ios/ZaloSDKBinary/Frameworks/LICENSE-ZaloSDK`.
