# Mã lỗi

Mọi hàm khi lỗi đều reject bằng `ZaloError`. Bạn kiểm tra bằng `code` chứ không phải đọc message:

```ts
import { ZaloError, ZaloErrorCode } from 'rn-zalo-toolkit'

try {
  await login()
} catch (error) {
  if (ZaloError.is(error, ZaloErrorCode.CANCELLED)) return

  if (ZaloError.is(error)) {
    error.code      // mã lỗi, xem bảng dưới
    error.message   // câu tiếng Việt, hiện được cho user
    error.phase     // lỗi xảy ra ở bước nào
  }
}
```

## Bảng mã lỗi

| Mã | Nghĩa | Nên làm gì |
|---|---|---|
| `CANCELLED` | User bấm huỷ, đóng màn đăng nhập, hoặc từ chối cấp quyền | Bỏ qua, đây không phải lỗi |
| `LOGIN_IN_PROGRESS` | Đang có một `login()` chạy dở | Vô hiệu hoá nút để tránh bấm hai lần |
| `ZALO_NOT_INSTALLED` | Máy chưa cài app Zalo | Gợi ý cài, hoặc gọi lại với `via: 'web'` |
| `ZALO_OUT_OF_DATE` | App Zalo trên máy quá cũ | Gợi ý cập nhật, hoặc `via: 'web'` |
| `INVALID_CONFIG` | App id, package name, bundle ID hoặc hash key chưa đúng | Xem [xử lý sự cố](../troubleshooting.md) |
| `NOT_WIRED` | iOS chưa chuyển URL callback cho thư viện | Làm bước 2 của [setup iOS](../guides/setup-ios.md) |
| `NETWORK` | Không kết nối được Zalo | Cho thử lại |
| `TIMEOUT` | Quá lâu không có kết quả | Cho thử lại |
| `TOKEN_EXCHANGE_FAILED` | Đăng nhập xong nhưng đổi token thất bại | Cho thử lại |
| `INVALID_TOKEN` | Token hết hạn hoặc không hợp lệ | Đăng nhập lại |
| `PROFILE_RESTRICTED` | Zalo không trả profile cho IP ngoài Việt Nam | Đừng để hỏng luồng đăng nhập, để backend lấy profile |
| `RATE_LIMITED` | Gọi quá nhiều lần | Chờ rồi thử lại |
| `UNKNOWN` | Trường hợp chưa phân loại | Log `error.nativeCode` và `error.nativeMessage` |

Tập mã này cố định, nên `switch (error.code)` sẽ được TypeScript nhắc nếu bạn thiếu nhánh.

## Các trường trong `ZaloError`

| Trường | |
|---|---|
| `code` | Mã trong bảng trên |
| `message` | Câu tiếng Việt, hiện được cho user |
| `phase` | `'config'`, `'authorize'`, `'exchange'` hoặc `'profile'` |
| `nativeCode` | Mã gốc từ SDK Zalo, dùng khi cần tra tài liệu Zalo |
| `nativeMessage` | Thông báo gốc từ SDK Zalo |
| `signatureHashKey` | Chỉ có ở `INVALID_CONFIG` trên Android - dán giá trị này lên portal |
| `packageName` | Android |
| `bundleId` | iOS |

## `CANCELLED` không phải lỗi

User bấm huỷ là hành vi bình thường. Bắt riêng và return sớm, đừng hiện alert:

```ts
if (ZaloError.is(error, ZaloErrorCode.CANCELLED)) return
```

## Đừng log cả object profile

`ZaloProfile.raw` chứa thông tin cá nhân (tên, ngày sinh, giới tính, số điện thoại). Nếu app bạn
đẩy log lên crash reporting thì những dữ liệu đó sẽ đi theo.

Bản thân `ZaloError` thì an toàn: `message` và `nativeMessage` không bao giờ chứa token hay thông
tin cá nhân, chỉ có mã lỗi và các giá trị cấu hình công khai.

## Cùng một mã, hai nền tảng nghĩa khác nhau

Nếu bạn từng tự map mã lỗi của SDK Zalo thì để ý chỗ này. Cùng con số `-7014` và `-7015` nhưng
Android và iOS hiểu khác hẳn nhau:

| Mã gốc | Android | iOS |
|---|---|---|
| `-7014` | chưa cài Zalo | xác thực thất bại |
| `-7015` | Zalo bản cũ | gọi quá nhiều lần |

Thư viện giữ hai bảng riêng cho hai nền tảng nên bạn không phải lo. Nêu ra để bạn biết vì sao
không nên tự dịch `nativeCode` thành thông báo cho user.
