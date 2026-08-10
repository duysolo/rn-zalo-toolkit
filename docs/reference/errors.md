# Error code

Mọi hàm reject bằng một loại duy nhất là `ZaloError`. Tập error code hữu hạn nên `switch` trên nó
được TypeScript kiểm tra đủ nhánh.

```ts
import { ZaloError, ZaloErrorCode } from 'rn-zalo-toolkit'

catch (error) {
  if (ZaloError.is(error, ZaloErrorCode.CANCELLED)) return

  if (ZaloError.is(error)) {
    error.code             // ZaloErrorCode
    error.phase            // ZaloErrorPhase
    error.nativeCode       // code gốc của SDK Zalo, để tra tài liệu
    error.nativeMessage
    error.signatureHashKey // chỉ có ở INVALID_CONFIG trên Android
    error.packageName
    error.bundleId
  }
}
```

Cột Code bên dưới vừa là giá trị chuỗi vừa là thành viên của enum `ZaloErrorCode`, ví dụ
`ZaloErrorCode.CANCELLED`. Hai cách viết dùng lẫn được.

## Tập error code

| Code | Nghĩa | Nên làm gì |
|---|---|---|
| `CANCELLED` | User huỷ, đóng webview, bấm back, hoặc từ chối cấp quyền | Bỏ qua im lặng. Đây là kết quả bình thường |
| `LOGIN_IN_PROGRESS` | Đã có một `login()` đang chạy | Disable nút, đừng gọi chồng |
| `ZALO_NOT_INSTALLED` | Máy chưa cài app Zalo | Gợi ý cài, hoặc gọi lại với `via: 'web'` |
| `ZALO_OUT_OF_DATE` | App Zalo trên máy quá cũ | Gợi ý cập nhật, hoặc `via: 'web'` |
| `INVALID_CONFIG` | App id / package / bundle ID / hash key sai hoặc chưa đăng ký portal | Đọc `signatureHashKey` + `packageName` trong error rồi dán lên portal |
| `NOT_WIRED` | iOS: app chưa forward URL callback | Thêm `ZaloToolkit.handle(...)`, xem setup-ios |
| `NETWORK` | Không kết nối được server Zalo | Cho retry |
| `TIMEOUT` | Quá `timeoutMs` (mặc định 120s) | Cho retry |
| `TOKEN_EXCHANGE_FAILED` | Có oauth code nhưng đổi lấy token thất bại | Cho retry; lặp lại thì kiểm tra network hoặc tài khoản |
| `INVALID_TOKEN` | Token hỏng hoặc hết hạn | Đăng nhập lại |
| `PROFILE_RESTRICTED` | Zalo chặn thông tin cá nhân với IP ngoài Việt Nam | Đừng để hỏng luồng đăng nhập, để backend lấy profile |
| `RATE_LIMITED` | Zalo giới hạn tần suất | Chờ rồi retry |
| `UNKNOWN` | Ngoài các nhánh trên | Log `nativeCode` + `nativeMessage` |

## Cùng một số, hai nền tảng nghĩa khác nhau

Đây là chỗ dễ sai nhất khi tự map error code, và là lý do thư viện giữ hai bảng riêng cho hai nền
tảng:

| Native code | Android | iOS |
|---|---|---|
| `-7014` | `ERR_ZALO_APP_NOT_INSTALLED` → `ZALO_NOT_INSTALLED` | `kZaloSDKErrorCodeAuthenticationFailed` → `UNKNOWN` |
| `-7015` | `ERR_ZALO_OUT_OF_DATE` → `ZALO_OUT_OF_DATE` | `kZaloSDKErrorCodeAuthenticationExceeded` → `RATE_LIMITED` |

Nếu gộp hai nền tảng vào một bảng thì user Android chưa cài Zalo sẽ nhận thông báo "xác thực thất
bại", còn user iOS đang bị rate limit lại đi cập nhật app một cách vô ích.

Trên iOS, "chưa cài" và "bản cũ" nằm ở hai code khác hẳn: `-7023` và `-7022`.

## Single source of truth

Bảng mapping nằm ở `src/errorTable.json`. Ba bộ test đọc chính file đó:

| Bộ test | Kiểm tra |
|---|---|
| `src/__tests__/errorTable.test.ts` | union `ZaloErrorCode` phủ đúng bảng, không trùng lặp |
| `android/src/test/kotlin/.../ErrorMappingTest.kt` | `ErrorMapping.kt` khớp mọi dòng Android |
| `ios/Tests/ErrorMappingTests.swift` | `ErrorMapping.swift` khớp mọi dòng iOS |

Thêm code mới mà quên một phía thì CI đỏ ngay, không phải chờ user thật gặp đúng code đó trên
đúng nền tảng đó.

## Tập code huỷ là tập mở

Trên iOS, `-1001` không có trong `ZDKZaloError.h`, nhưng demo chính hãng của Zalo lại dùng chính
nó làm mốc "không phải cancel". Nghĩa là header không phải nguồn đầy đủ. Nếu bạn gặp một code ra
`UNKNOWN` mà thực tế là user huỷ, báo lại kèm `nativeCode` để bổ sung vào bảng.

## Quy tắc nội dung error

`message` và `nativeMessage` chỉ chứa: error code, mô tả của Zalo, và định danh config công khai
(`appId`, `packageName`, `bundleId`, hash key).

Không bao giờ chứa `accessToken`, `refreshToken`, `oauthCode`, `codeVerifier`, hay bất kỳ field
nào của `ZaloProfile`. Cả ba nền tảng đều có test canh điều này.

Lý do là `message` thường được app bung thẳng ra alert, và nhiều app persist mọi log ERROR xuống
file hoặc đẩy lên crash reporting.

Hệ quả cho bạn: đừng log nguyên `ZaloProfile`, vì `raw` là PII (tên, ngày sinh, giới tính, số
điện thoại).
