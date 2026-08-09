# Chuyển từ `react-native-zalo-kit`

Bề mặt thay đổi nhỏ hơn vẻ ngoài: thường chỉ **một file service** của app, cộng việc **xoá**
glue native.

⚠️ **Đây là một commit nguyên tử, không tách được.** Manifest merger sẽ dừng build nếu app còn
khai `meta-data com.zing.zalo.zalosdk.appID` trong lúc thư viện cũng khai. Nghĩa là không có
trạng thái trung gian chạy được cả hai thư viện - và cũng vì thế, canary/A-B ở tầng native là
bất khả thi. Rollback thật là revert commit rồi phát hành lại.

## 1. Dependency

```sh
npm uninstall react-native-zalo-kit
npm install rn-zalo-toolkit
```

Nếu app dùng yarn patch cho `react-native-zalo-kit`: xoá **cả** entry `resolutions` **và** file
`.yarn/patches/react-native-zalo-kit-*.patch`. Còn `resolutions` mà mất patch thì `yarn install`
hỏng.

Thêm vào `transformIgnorePatterns` của jest (tên package không khớp nhánh `react-native-.*` nào):

```js
transformIgnorePatterns: [
  'node_modules/(?!(react-native|@react-native|rn-zalo-toolkit|...)/)',
]
```

## 2. Xoá glue native

**Android** - build sẽ **đỏ** cho tới khi xoá hết (thư viện dùng `implementation`, không phải
`api`, nên lớp `com.zing.zalo.*` không còn trên compile classpath của app). Thông báo bạn sẽ gặp:
`Unresolved reference: zing` - đừng tưởng package hỏng.

| File | Xoá |
|---|---|
| `MainApplication.kt` | `import ...ZaloSDKApplication` + `ZaloSDKApplication.wrap(this)` |
| `MainActivity.kt` | `import ...ZaloSDK` + `ZaloSDK.Instance.onActivityResult(...)` |
| `AndroidManifest.xml` | khối `<meta-data com.zing.zalo.zalosdk.appID>` |
| `AndroidManifest.xml` | khối `<activity BrowserLoginActivity>` |
| `AndroidManifest.xml` | **chỉ dòng** `<package android:name="com.zing.zalo" />` |
| `proguard-rules.pro` | khối `-keep class com.zing.zalo.**` |
| `res/values/strings.xml` | `<string name="appID">` (hoặc tên tương đương) |

⚠️ Ở dòng `<queries>`: xoá **đúng dòng** `com.zing.zalo`, giữ nguyên phần còn lại của khối. Nhiều
app dùng chung khối đó cho speech recognition, `http`, `tel`, `mailto` - xoá cả khối là gãy
`canOpenURL`.

Thêm `android/gradle.properties`: `zaloAppId=<APP_ID>` (giá trị cũ nằm ở `strings.xml`).

**iOS**

| File | Việc |
|---|---|
| `AppDelegate.swift` | xoá `import ZaloSDK` + `initialize(withAppId:)` |
| `AppDelegate.swift` / `SceneDelegate` | đổi `ZDKApplicationDelegate.sharedInstance().application(...)` → `ZaloToolkit.handle(...)` |
| `Info.plist` | **giữ nguyên** - `ZaloAppID`, URL scheme, `LSApplicationQueriesSchemes` không đổi |

## 3. Sửa lớp service

Cả `login`/`logout`/`getUserProfile` đều đổi tên hoặc đổi shape. Bảng đối chiếu đầy đủ:

| `react-native-zalo-kit` | `rn-zalo-toolkit` | Ghi chú |
|---|---|---|
| `login('AUTH_VIA_APP')` | `login({ via: 'app' })` | giá trị đổi tên |
| `login('AUTH_VIA_WEB')` | `login({ via: 'web' })` | |
| `login('AUTH_VIA_APP_OR_WEB')` | `login({ via: 'app_or_web' })` | mặc định |
| `logout(): void` | `logout(): Promise<void>` | không bao giờ reject |
| `isAuthenticated()` | ❌ **không có tương ứng** | xem mục 4 |
| `getUserProfile()` | `getProfile()` | `picture.data.url` → `picture.url` |
| `getApplicationHashKey(): string` | `getApplicationHashKey(): Promise<string \| null>` | iOS trả `null` thay vì ném |
| event `ZaloKit_onOAuthCodeReceived` | `addListener('oauthCodeReceived', cb)` | |

**Xoá hết heuristic `AppState`.** `loginWithCancelDetection`, `CANCEL_GRACE_MS`, và mọi thứ liên
quan không còn lý do tồn tại: huỷ giờ ra `ZaloError` mã `CANCELLED`, và mọi nhánh lỗi đều settle.

**Giữ `withTimeout` ở JS làm lưới cuối**, đặt **cao hơn** `timeoutMs` của native (ví dụ 150s so
với 120s) để native luôn là bên báo lỗi trước. Lý do: timer native trên iOS là
`DispatchQueue.main.asyncAfter` - nó **không chạy khi app bị suspend**.

## 4. `isAuthenticated()` không có đường tương ứng

Thư viện cũ lưu token vào `SharedPreferences`/`NSUserDefaults` **plaintext**, và
`isAuthenticated()` đọc cache đó. Thư viện mới **không lưu gì xuống đĩa**.

Kiểm lại app bạn: rất có thể `isAuthenticated()` không có caller thật (cả hai app trong hệ này
đều không) - vì sau khi đăng nhập Zalo, phiên thật là phiên Firebase/backend chứ không phải phiên
Zalo. Nếu vậy thì **xoá hẳn**.

Nếu thật sự cần: app tự lưu `refreshToken` (Keychain / `EncryptedSharedPreferences`, **không**
`AsyncStorage`) rồi gọi `isRefreshTokenValid(token)` - hàm này resolve `false`, không reject.

## 5. Đừng để mã lỗi của thư viện chảy lên UI

Đây là chỗ dễ tạo regression nhất.

`SIGN_IN_CANCELLED` trong app của bạn nhiều khả năng là quy ước **dùng chung** cho Google, Apple
và Zalo. Nếu để `ZaloError.code === 'CANCELLED'` chảy thẳng lên `isUserCancelledError`, hàm đó
trả `false` và **alert lỗi sẽ bung ra mỗi lần người dùng bấm Huỷ**.

Dịch ở lớp service, đúng một chỗ:

```ts
catch (error) {
  if (ZaloError.is(error, 'CANCELLED')) {
    throw Object.assign(new Error('Zalo login cancelled by user'), {
      code: 'SIGN_IN_CANCELLED',   // quy ước sẵn có của app - KHÔNG đụng vào
    })
  }
  throw error
}
```

Màn hình đăng nhập không phải sửa một dòng nào.

## 6. Test

Đổi mock sang bản ship kèm - nó mô phỏng đúng hợp đồng thật:

```ts
jest.mock('rn-zalo-toolkit', () => require('rn-zalo-toolkit/jest'))
```

```ts
import { __reset, __failNextWith, __setNextLoginResult, __getCalls } from 'rn-zalo-toolkit/jest'

beforeEach(() => __reset())

it('huỷ được dịch sang quy ước của app', async () => {
  __failNextWith('CANCELLED')
  await expect(zaloAuthService.signIn()).rejects.toMatchObject({ code: 'SIGN_IN_CANCELLED' })
})
```

Trong bộ test cũ, **chỉ xoá những test kiểm heuristic `AppState`**. Những test khác thường là
giao ước thật của app và phải chuyển sang code mới - đặc biệt:

- test ép `via: 'web'` trên Android (nếu app bạn có) - đó là guard tự động duy nhất cho quyết
  định đó;
- test "profile lỗi thì vẫn đăng nhập được" - luật nghiệp vụ, không phải heuristic;
- test ánh xạ mã lỗi → alert nào.

## 7. Trước khi build phát hành

```sh
npx rn-zalo-toolkit-doctor
```

Nó bắt được tàn dư cấu hình cũ và - quan trọng nhất - **app id lệch giữa iOS và Android**, thứ mà
kiểm tra runtime không bao giờ thấy vì mỗi lần chỉ chạy một nền tảng.

Đừng "nhân tiện" dọn body gửi lên backend trong cùng đợt này. Bỏ một field khi backend cũ còn bắt
buộc nó là làm chết đăng nhập cho tất cả người dùng - dọn body là một đợt riêng, sau khi bản cũ
đã rụng.
