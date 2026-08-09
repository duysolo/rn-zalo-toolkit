# Mã lỗi

Mọi hàm reject bằng **một** loại: `ZaloError`. Tập mã là **hữu hạn** nên `switch` trên nó được
kiểm tra đủ nhánh bởi TypeScript.

```ts
import { ZaloError } from 'rn-zalo-toolkit'

catch (error) {
  if (ZaloError.is(error, 'CANCELLED')) return        // bình thường
  if (ZaloError.is(error)) {
    error.code            // ZaloErrorCode
    error.phase           // 'config' | 'authorize' | 'exchange' | 'profile'
    error.nativeCode      // mã gốc của SDK Zalo, để tra tài liệu
    error.nativeMessage
    error.signatureHashKey // chỉ ở INVALID_CONFIG trên Android
    error.packageName
    error.bundleId
  }
}
```

## Tập mã

| Mã | Nghĩa | Nên làm gì |
|---|---|---|
| `CANCELLED` | Người dùng huỷ, đóng webview, bấm back, hoặc từ chối cấp quyền | **Nuốt im lặng.** Đây là kết quả bình thường, không phải sự cố |
| `LOGIN_IN_PROGRESS` | Đã có một `login()` chạy dở | Chặn nút, đừng gọi chồng |
| `ZALO_NOT_INSTALLED` | Máy chưa cài ứng dụng Zalo | Gợi ý cài, hoặc gọi lại với `via: 'web'` |
| `ZALO_OUT_OF_DATE` | Ứng dụng Zalo trên máy quá cũ | Gợi ý cập nhật, hoặc `via: 'web'` |
| `INVALID_CONFIG` | App id / package / bundle ID / hash key sai hoặc chưa đăng ký portal | Xem `signatureHashKey` + `packageName` trong chính lỗi rồi dán lên portal |
| `NOT_WIRED` | iOS: app chưa chuyển tiếp URL callback | Thêm `ZaloToolkit.handle(...)` - xem setup-ios |
| `NETWORK` | Không kết nối được máy chủ Zalo | Cho thử lại |
| `TIMEOUT` | Quá `timeoutMs` (mặc định 120s) | Cho thử lại |
| `TOKEN_EXCHANGE_FAILED` | Có oauth code nhưng đổi lấy token thất bại | Cho thử lại; nếu lặp lại thì kiểm mạng/tài khoản |
| `INVALID_TOKEN` | Token hỏng hoặc hết hạn | Đăng nhập lại |
| `PROFILE_RESTRICTED` | Zalo chặn thông tin cá nhân với IP ngoài Việt Nam | **Đừng làm hỏng đăng nhập.** Để backend (IP Việt Nam) lấy hồ sơ |
| `RATE_LIMITED` | Zalo giới hạn tần suất | Chờ rồi thử lại |
| `UNKNOWN` | Ngoài các nhánh trên | Log `nativeCode` + `nativeMessage` |

## Bẫy: cùng một số, hai nền tảng nghĩa khác nhau

Đây là chỗ dễ sai nhất khi tự map mã lỗi, và là lý do thư viện giữ **hai** bảng riêng:

| Mã gốc | Android | iOS |
|---|---|---|
| `-7014` | `ERR_ZALO_APP_NOT_INSTALLED` → `ZALO_NOT_INSTALLED` | `kZaloSDKErrorCodeAuthenticationFailed` → `UNKNOWN` |
| `-7015` | `ERR_ZALO_OUT_OF_DATE` → `ZALO_OUT_OF_DATE` | `kZaloSDKErrorCodeAuthenticationExceeded` → `RATE_LIMITED` |

Ai gộp hai nền tảng vào một bảng sẽ khiến người dùng Android chưa cài Zalo nhận thông báo *"xác
thực thất bại"*, và người dùng iOS bị giới hạn tần suất đi cập nhật ứng dụng một cách vô ích.

Trên iOS, "chưa cài" và "bản cũ" nằm ở hai mã hoàn toàn khác: `-7023` và `-7022`.

## Nguồn duy nhất

Bảng ánh xạ sống ở `src/errorTable.json`. Ba bộ test đọc chính file đó:

| Bộ test | Kiểm |
|---|---|
| `src/__tests__/errorTable.test.ts` | union `ZaloErrorCode` phủ đúng bảng, không trùng lặp |
| `android/src/test/kotlin/.../ErrorMappingTest.kt` | `ErrorMapping.kt` khớp mọi dòng Android |
| `ios/Tests/ErrorMappingTests.swift` | `ErrorMapping.swift` khớp mọi dòng iOS |

Thêm một mã mới mà quên một phía ⇒ CI đỏ, không phải chờ người dùng thật gặp đúng mã đó trên
đúng nền tảng đó.

## Tập mã huỷ là tập MỞ

Trên iOS, `-1001` **không hề có** trong `ZDKZaloError.h`, nhưng demo chính hãng của Zalo lại dùng
chính nó làm mốc "không phải cancel". Nghĩa là header không phải nguồn đầy đủ. Nếu bạn gặp một mã
ra `UNKNOWN` mà thực tế là người dùng huỷ, hãy báo lại kèm `nativeCode`.

## Quy tắc nội dung lỗi

`message` và `nativeMessage` **chỉ** chứa: mã lỗi, mô tả của Zalo, và định danh cấu hình **công
khai** (`appId`, `packageName`, `bundleId`, hash key).

**Không bao giờ** chứa `accessToken`, `refreshToken`, `oauthCode`, `codeVerifier`, hay bất kỳ
field nào của `ZaloProfile`. Có test canh điều này ở cả ba nền tảng.

Lý do là đường đi có thật: `message` thường được app bung thẳng ra alert cho người dùng, và nhiều
app persist mọi ERROR xuống file trên đĩa hoặc đẩy lên crash reporting.

⚠️ Hệ quả cho bạn: **đừng log nguyên `ZaloProfile`** - `raw` là PII (tên, ngày sinh, giới tính,
số điện thoại).
