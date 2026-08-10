# Xử lý sự cố

Chạy cái này trước, nó đọc file config chứ không suy đoán:

```sh
npx rn-zalo-toolkit-doctor
```

## Đăng nhập treo, không có error nào

Mọi entry point native đều settle và đều có timeout, nên trường hợp này không nên xảy ra nữa.
Nếu vẫn gặp:

1. Có thấy `TIMEOUT` sau `timeoutMs` không? Nếu có thì không phải treo, mà là SDK thật sự không
   phản hồi. Kiểm tra network, và kiểm tra xem user có bị kẹt ở màn hình Zalo không.
2. Trên iOS, đã forward `ZaloToolkit.handle(...)` chưa? Với `via: 'app'` mà thiếu bước này thì
   Zalo không gọi ngược về được, và bạn sẽ nhận `NOT_WIRED` khi hết timeout.
3. Nếu treo lâu hơn cả `timeoutMs` trên iOS: timer là `DispatchQueue.main.asyncAfter` nên không
   chạy khi app bị suspend. Giữ thêm một `withTimeout` ở JS với giá trị lớn hơn.

## `INVALID_CONFIG` khi đăng nhập

Error này đã kèm sẵn thứ bạn cần:

```ts
catch (error) {
  if (ZaloError.is(error, ZaloErrorCode.INVALID_CONFIG)) {
    console.log(error.signatureHashKey)  // dán lên portal
    console.log(error.packageName)
    console.log(error.bundleId)
    console.log(error.nativeCode)
  }
}
```

Ba nguyên nhân, xếp theo tần suất:

1. **Hash key chưa đăng ký** (`nativeCode: -5008`). Mỗi loại build ký bằng key khác nhau. Bản từ
   Play Store dùng App Signing key của Google chứ không phải upload key, lấy SHA-1 ở Play Console
   → Test and release → App integrity → **App signing key certificate**.
2. **Package name hoặc bundle ID chưa đăng ký** (`-5006` / `-5005`).
3. **App trên portal chưa duyệt hoặc đang bị tắt** (`-7004`).

## Hộp thoại "Bản Zalo không tương thích"

Thông báo này gây hiểu nhầm vì nó xuất hiện ở hai nguyên nhân khác hẳn nhau:

1. Hash key sai. Phổ biến hơn nhiều, kiểm tra trước.
2. App Zalo trên máy thật sự quá cũ.

Cách phân biệt: gọi `login()` rồi xem error code. `INVALID_CONFIG` là nguyên nhân 1,
`ZALO_OUT_OF_DATE` là nguyên nhân 2.

## `PROFILE_RESTRICTED` khi lấy profile

Zalo chặn `graph.zalo.me` theo IP nguồn, nên thiết bị ngoài Việt Nam luôn gặp.

Đây là hành vi bình thường chứ không phải lỗi config. Đừng để nó làm hỏng luồng đăng nhập: token
đã lấy được rồi, và backend chạy IP Việt Nam sẽ lấy được đúng profile đó.

## Android: `Could not find me.zalo:sdk-auth`

Thư viện tự thêm Maven repo của Zalo vào app. Gặp lỗi này nghĩa là phần đó bị chặn. Kiểm tra:

- App có đặt `ext.rnZaloToolkitSkipRepoInjection = true` không.
- `settings.gradle` có bật `RepositoriesMode.FAIL_ON_PROJECT_REPOS` không.

Cách khai thủ công có ở [setup-android](./guides/setup-android.md#tự-quản-maven-repo).

## Android: `Attribute meta-data#com.zing.zalo.zalosdk.appID@value ... tools:replace`

App còn tự khai `meta-data` đó trong khi thư viện cũng khai. Xoá khối của app đi.

Đừng thêm `tools:replace` để dập lỗi, vì làm vậy là ghi đè lên giá trị mà thư viện sinh ra từ
`zaloAppId`.

## Android: build release chết vì `ClassNotFoundException`

Chỉ xảy ra khi bật minify. SDK Zalo load class của nó bằng reflection theo tên nên R8 đổi tên là
hỏng. Thư viện đã ship `consumer-rules.pro`; nếu vẫn gặp thì kiểm tra xem app có rule nào loại
trừ `com.zing.zalo.**` không.

Luôn test bản release có minify trước khi phát hành, vì lỗi loại này không bao giờ lộ ra ở build
debug.

## iOS: `pod install` hỏng

Thư viện không khai dependency CocoaPods nào lên SDK Zalo, và không có khối `raise` kiểu
`$RNFirebaseDisableSPM`. Nếu `pod install` hỏng với thông báo nhắc tới Firebase thì đó là pod
khác, không phải pod này.

## iOS: app dùng SceneDelegate, đăng nhập hỏng khi mở từ trạng thái tắt hẳn

Cần `ZaloToolkit.handle(...)` ở cả hai chỗ. Thiếu chỗ thứ hai thì chỉ cold start hỏng còn app
đang chạy vẫn ổn, nên rất dễ bỏ sót:

```swift
func scene(_ scene: UIScene, willConnectTo session: UISceneSession,
           options connectionOptions: UIScene.ConnectionOptions) {
  connectionOptions.urlContexts.forEach { _ = ZaloToolkit.handle($0) }
}
```

## User bấm Huỷ mà app bung alert lỗi

Service layer của app đang coi mọi rejection là lỗi. `CANCELLED` là kết quả bình thường, bắt
riêng và return sớm:

```ts
if (ZaloError.is(error, ZaloErrorCode.CANCELLED)) return
```

## jest: `SyntaxError: Unexpected token 'export'`

Thêm `rn-zalo-toolkit` vào `transformIgnorePatterns`, hoặc dùng mock ship sẵn:

```ts
jest.mock('rn-zalo-toolkit', () => require('rn-zalo-toolkit/jest'))
```

## Nghiệm thu trước khi phát hành

Kết quả chạy trên máy thật ghi vào `docs/acceptance/<YYYY-MM-DD>-<version>.md`, một file cho mỗi
lần chạy, không ghi đè. Template ở [`docs/acceptance/TEMPLATE.md`](./acceptance/TEMPLATE.md).

Ba trạng thái: `PASS`, `FAIL`, `CHƯA CHẠY`. Cột thời gian settle là bắt buộc, vì đó là dữ liệu so
sánh được giữa hai lần chạy và là thứ chứng minh không có promise nào treo.

Chạy lại nhóm smoke khi: nâng version SDK Zalo, nâng React Native major/minor, hoặc có thay đổi
chạm vào `android/` hay `ios/`.
