# Xử lý sự cố

Trước khi tra bảng dưới, chạy lệnh này. Nó đọc file cấu hình của app và chỉ ra chỗ thiếu:

```sh
npx rn-zalo-toolkit-doctor
```

## Lỗi `INVALID_CONFIG` khi đăng nhập

Nghĩa là Zalo chưa nhận ra app của bạn. Lỗi này mang sẵn thông tin cần thiết:

```ts
catch (error) {
  if (ZaloError.is(error, ZaloErrorCode.INVALID_CONFIG)) {
    console.log(error.signatureHashKey)  // dán lên Zalo portal
    console.log(error.packageName)
    console.log(error.bundleId)
    console.log(error.nativeCode)
  }
}
```

Ba nguyên nhân, xếp theo thứ tự hay gặp:

1. **Hash key chưa đăng ký** (`nativeCode` là `-5008`). Xem [setup Android](./guides/setup-android.md#hash-key---nguyên-nhân-lỗi-phổ-biến-nhất).
2. **Package name hoặc bundle ID chưa đăng ký** (`-5006` hoặc `-5005`).
3. **App trên portal chưa được duyệt hoặc đang tắt** (`-7004`).

## Hiện hộp thoại "Bản Zalo không tương thích"

Thông báo này gây hiểu nhầm, nó xuất hiện ở hai trường hợp khác nhau:

- Hash key chưa đúng - hay gặp hơn nhiều, kiểm tra trước.
- App Zalo trên máy thật sự quá cũ.

Cách phân biệt: xem `error.code`. `INVALID_CONFIG` là trường hợp thứ nhất, `ZALO_OUT_OF_DATE` là
trường hợp thứ hai.

## Lỗi `PROFILE_RESTRICTED` khi gọi `getProfile()`

Zalo chỉ trả profile cho IP ở Việt Nam, nên thiết bị ở nước ngoài luôn gặp lỗi này.

Đây là hành vi bình thường, không phải lỗi cấu hình. Đừng để nó làm hỏng luồng đăng nhập - token
đã lấy được rồi, backend sẽ lấy profile giúp bạn.

## Lỗi `NOT_WIRED` trên iOS

App chưa chuyển URL callback cho thư viện. Làm
[bước 2 của setup iOS](./guides/setup-ios.md#bước-2---nhận-url-callback).

## Đăng nhập được khi app đang mở, nhưng hỏng khi mở app từ đầu (iOS)

App bạn dùng SceneDelegate và thiếu `ZaloToolkit.handle` trong `scene(_:willConnectTo:options:)`:

```swift
func scene(_ scene: UIScene, willConnectTo session: UISceneSession,
           options connectionOptions: UIScene.ConnectionOptions) {
  connectionOptions.urlContexts.forEach { _ = ZaloToolkit.handle($0) }
}
```

## Đăng nhập treo, không thấy lỗi gì

Thư viện có timeout nên trường hợp này không nên xảy ra. Nếu vẫn gặp:

- Chờ hết `timeoutMs` (mặc định 2 phút) xem có ra `TIMEOUT` không. Nếu có thì không phải treo, mà
  là Zalo không phản hồi - kiểm tra mạng.
- Trên iOS, kiểm tra đã làm bước 2 của setup chưa.
- Nếu app bạn có thể bị hệ điều hành tạm dừng khi chạy nền, thêm một timeout ở phía JS làm lớp
  bảo vệ cuối.

## Android: build lỗi `Could not find me.zalo:sdk-auth`

Thư viện tự thêm Maven repo của Zalo vào app, nhưng có hai thứ có thể chặn:

- App đặt `ext.rnZaloToolkitSkipRepoInjection = true`.
- `settings.gradle` bật `RepositoriesMode.FAIL_ON_PROJECT_REPOS`.

Nếu bạn muốn tự quản repo, khai thủ công trong `android/build.gradle` của app:

```gradle
ext { rnZaloToolkitSkipRepoInjection = true }

allprojects {
  repositories {
    maven {
      url "https://gitlab.com/api/v4/projects/50747855/packages/maven"
      content { includeGroup "me.zalo" }
    }
  }
}
```

## Android: build lỗi manifest, nhắc `tools:replace` và `com.zing.zalo.zalosdk.appID`

App bạn đang tự khai `meta-data` app id trong `AndroidManifest.xml`, trùng với thư viện. Xoá khối
đó của app đi.

Đừng thêm `tools:replace` để dập lỗi, vì làm vậy là ghi đè lên giá trị thư viện sinh từ
`zaloAppId`.

## Android: bản release bị crash `ClassNotFoundException`

Chỉ xảy ra khi bật minify. Thư viện đã kèm proguard rule cần thiết, nên nếu vẫn gặp thì kiểm tra
xem app có rule nào loại trừ `com.zing.zalo.**` không.

## iOS: `pod install` báo lỗi

Thư viện không phụ thuộc pod nào của Zalo. Nếu thông báo lỗi nhắc tới Firebase hay pod khác thì
nguyên nhân nằm ở đó, không phải ở đây.

## User bấm huỷ mà app hiện alert lỗi

Code của bạn đang coi mọi lỗi là như nhau. Bắt riêng `CANCELLED`:

```ts
if (ZaloError.is(error, ZaloErrorCode.CANCELLED)) return
```

## jest báo `SyntaxError: Unexpected token 'export'`

Dùng mock có sẵn:

```ts
jest.mock('rn-zalo-toolkit', () => require('rn-zalo-toolkit/jest'))
```

Hoặc thêm `rn-zalo-toolkit` vào `transformIgnorePatterns`.
