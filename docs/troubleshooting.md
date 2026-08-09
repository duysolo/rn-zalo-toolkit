# Xử lý sự cố

Trước hết chạy cái này - nó đọc file chứ không đoán:

```sh
npx rn-zalo-toolkit-doctor
```

---

## Đăng nhập treo, không có lỗi gì

**Không nên xảy ra nữa.** Mọi entry point native đều settle, có trần thời gian. Nếu vẫn gặp:

1. Có thấy `TIMEOUT` sau `timeoutMs` không? Nếu có thì không phải treo - SDK thật sự không phản
   hồi. Kiểm mạng, và kiểm xem người dùng có bị kẹt ở màn Zalo không.
2. Trên iOS, đã có `ZaloToolkit.handle(...)` chưa? Với `via: 'app'` mà thiếu bước này thì Zalo
   không gọi ngược về được. `verifyInstallation()` báo `URL_HANDLER_NOT_WIRED`.
3. Nếu thấy treo **quá** `timeoutMs` trên iOS: timer là `DispatchQueue.main.asyncAfter`, nó không
   chạy khi app bị suspend. Giữ một `withTimeout` ở JS cao hơn làm lưới cuối.

## `INVALID_CONFIG` khi đăng nhập

Lỗi này đã kèm sẵn thứ bạn cần:

```ts
catch (error) {
  if (ZaloError.is(error, 'INVALID_CONFIG')) {
    console.log(error.signatureHashKey)  // dán lên portal
    console.log(error.packageName)
    console.log(error.bundleId)
    console.log(error.nativeCode)
  }
}
```

Ba nguyên nhân, theo tần suất:

**1. Hash key chưa đăng ký** (`nativeCode: -5008`). Mỗi loại build ký bằng khoá khác nhau. Bản từ
Play Store dùng **App Signing key của Google**, không phải upload key - lấy SHA-1 ở
Play Console → Test and release → App integrity → **App signing key certificate**.

**2. Package name / bundle ID chưa đăng ký** (`-5006` / `-5005`).

**3. App trên portal chưa duyệt hoặc bị tắt** (`-7004`).

## Hộp thoại "Bản Zalo không tương thích"

Thông báo này **gây hiểu nhầm**: nó xuất hiện ở cả hai nguyên nhân hoàn toàn khác nhau.

1. **Hash key sai** - phổ biến hơn nhiều. Kiểm trước.
2. Ứng dụng Zalo trên máy thật sự quá cũ.

Cách tách: gọi `login()` và xem mã. `INVALID_CONFIG` → nguyên nhân 1. `ZALO_OUT_OF_DATE` →
nguyên nhân 2.

## `PROFILE_RESTRICTED` khi lấy hồ sơ

Zalo chặn `graph.zalo.me` theo IP nguồn. Thiết bị ngoài Việt Nam **luôn** gặp.

Đây là hành vi bình thường, không phải lỗi cấu hình. Đừng để nó làm hỏng đăng nhập: token đã lấy
được rồi, và backend chạy IP Việt Nam tự lấy được đúng hồ sơ đó.

## Android: build đỏ `Unresolved reference: zing`

Đúng như dự kiến khi migrate. Thư viện dùng `implementation` (không phải `api`), nên lớp
`com.zing.zalo.*` không còn trên compile classpath của app. Xoá glue native cũ - xem
[hướng dẫn chuyển đổi](./guides/migrate-from-react-native-zalo-kit.md#2-xoá-glue-native).

## Android: `Could not find me.zalo:sdk-auth`

Thư viện tự tiêm repo Maven của Zalo vào app. Gặp lỗi này nghĩa là việc tiêm bị chặn - kiểm xem
app có đặt `ext.rnZaloToolkitSkipRepoInjection = true` không, hoặc `settings.gradle` có bật
`RepositoriesMode.FAIL_ON_PROJECT_REPOS` không. Cách khai thủ công ở
[setup-android](./guides/setup-android.md#muốn-tự-quản-repo-maven).

## Android: `Attribute meta-data#com.zing.zalo.zalosdk.appID@value ... tools:replace`

App còn tự khai `meta-data` đó trong lúc thư viện cũng khai. Xoá khối của app - **đừng** thêm
`tools:replace`, vì làm vậy là ghi đè giá trị mà thư viện sinh từ `zaloAppId`.

## Android: bản release chết `ClassNotFoundException`

Chỉ xảy ra khi minify. SDK Zalo phản chiếu lớp của nó theo tên, nên R8 đổi tên là hỏng. Thư viện
đã ship `consumer-rules.pro` - nếu vẫn gặp, kiểm xem app có rule nào loại trừ `com.zing.zalo.**`
không.

⚠️ Luôn kiểm thử **bản release có minify** trước khi phát hành. Hạng lỗi này không bao giờ lộ ra
khi chạy debug.

## iOS: `pod install` hỏng

Thư viện **không** khai dependency CocoaPods nào lên SDK Zalo, và **không** có khối `raise` kiểu
`$RNFirebaseDisableSPM`. Nếu `pod install` hỏng với lý do nói về Firebase thì đó là pod khác,
không phải pod này.

## iOS: app dùng SceneDelegate, đăng nhập hỏng khi mở từ trạng thái tắt hẳn

Cần `ZaloToolkit.handle(...)` ở **hai** chỗ. Thiếu chỗ thứ hai thì chỉ cold start hỏng, còn khi
app đang chạy thì vẫn ổn - nên rất dễ bỏ sót:

```swift
func scene(_ scene: UIScene, willConnectTo session: UISceneSession,
           options connectionOptions: UIScene.ConnectionOptions) {
  connectionOptions.urlContexts.forEach { _ = ZaloToolkit.handle($0) }
}
```

## Người dùng bấm Huỷ mà app bung alert lỗi

Lớp service của app chưa dịch `CANCELLED` sang quy ước sẵn có. Xem
[mục 5 của hướng dẫn chuyển đổi](./guides/migrate-from-react-native-zalo-kit.md).

## jest: `SyntaxError: Unexpected token 'export'`

Thêm `rn-zalo-toolkit` vào `transformIgnorePatterns`, hoặc dùng bản mock ship kèm:

```ts
jest.mock('rn-zalo-toolkit', () => require('rn-zalo-toolkit/jest'))
```

---

## Ma trận nghiệm thu

Kết quả chạy trên máy thật ghi vào `docs/acceptance/<YYYY-MM-DD>-<version>.md`, **một file mỗi
lần chạy**, không ghi đè. Ba trạng thái, không có trạng thái thứ tư: `PASS` · `FAIL` ·
`CHƯA CHẠY`. Cột "thời gian settle" là bắt buộc - nó là dữ liệu duy nhất so được giữa hai lần
chạy, và là thứ chứng minh "không treo".

Subset SMOKE (8 ô, ~25 phút/nền tảng) phải chạy lại khi: nâng version SDK Zalo, nâng React Native
major/minor, hoặc bất kỳ thay đổi nào chạm `android/` hay `ios/`.
