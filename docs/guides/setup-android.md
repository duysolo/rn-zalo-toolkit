# Setup Android

## Bước 1 - khai app id

`android/gradle.properties`:

```properties
zaloAppId=1234567890123456789
```

Nếu quên bước này, build sẽ dừng và in ra hướng dẫn. Không có trường hợp build thành công rồi lỗi
âm thầm trên máy user.

## Bước 2 - đăng ký app trên Zalo

Vào [Zalo for Developers](https://developers.zalo.me), mở app của bạn và khai hai thứ:

- **Package name** của app Android
- **Hash key** của certificate dùng để ký app

Lấy hash key bằng:

```ts
import { getApplicationHashKey } from 'rn-zalo-toolkit'

console.log(await getApplicationHashKey())
```

Dán đúng chuỗi in ra vào portal.

Xong hai bước là dùng được. Phần dưới là những thứ chỉ cần đọc khi gặp vấn đề.

## Bạn không cần làm những việc này

Thư viện tự lo, nên nếu app bạn đang có sẵn thì xoá đi cho gọn:

| Việc | Ai làm |
|---|---|
| Khởi tạo SDK lúc app chạy | thư viện |
| `onActivityResult` cho luồng đăng nhập | thư viện |
| Khai `meta-data` app id trong manifest | thư viện |
| Khai activity đăng nhập + URL scheme | thư viện |
| Proguard rule cho SDK Zalo | thư viện |
| Thêm Maven repo của Zalo | thư viện |

## Hash key - nguyên nhân lỗi phổ biến nhất

Mỗi loại build ký bằng một key khác nhau, nên thường phải đăng ký **nhiều** hash key:

| Loại build | Key ký |
|---|---|
| Chạy debug trên máy | `android/app/debug.keystore` |
| APK tự ký | keystore của bạn |
| Bản tải từ Play Store | App Signing key của Google |

Bản trên Play Store là chỗ hay sai nhất, vì Google ký lại app bằng key riêng. Lấy SHA-1 ở:

**Play Console → Test and release → App integrity → App signing key certificate**

Không phải "Upload key certificate".

Nếu hash key chưa khớp, `login()` sẽ trả về lỗi `INVALID_CONFIG`, và trong lỗi đó có sẵn giá trị
cần dán lên portal:

```ts
catch (error) {
  if (ZaloError.is(error, ZaloErrorCode.INVALID_CONFIG)) {
    console.log(error.signatureHashKey)
    console.log(error.packageName)
  }
}
```

Lưu ý: hash key sai đôi khi làm Zalo hiện hộp thoại *"Bản Zalo không tương thích"*. Thông báo đó
nghe như lỗi phiên bản, nhưng thường là lỗi hash key.

## Nếu bạn dùng nhiều app id

Ví dụ nhiều bản app dùng chung một codebase, mỗi bản một app id. Chỉ cần ghi lại một dòng trong
`android/gradle.properties` trước khi build:

```bash
zaloAppId=<app id của bản này>
```

Sau khi đổi, chạy `npx rn-zalo-toolkit-doctor` để chắc app id của Android và iOS khớp nhau. Lỗi
lệch app id giữa hai nền tảng không thể phát hiện lúc chạy, vì mỗi lần chạy chỉ có một nền tảng.

## Build release

Thư viện đã kèm sẵn proguard rule cần thiết, bạn không phải thêm gì.

Dù vậy vẫn nên **thử đăng nhập trên bản release có bật minify** trước khi phát hành. SDK Zalo tìm
class theo tên nên nhóm lỗi này chỉ xuất hiện khi minify, không bao giờ thấy ở bản debug.

## Permission được thêm vào app

SDK Zalo tự thêm hai permission. Biết trước để khỏi bất ngờ khi review:

- `android.permission.INTERNET`
- `com.zing.zalo.permission.ACCESS_THIRD_PARTY_APP_AUTHORIZATION`

## Khai báo dữ liệu trên Play Console

Google tính cả dữ liệu do SDK bên thứ ba thu thập. SDK Zalo đọc thông tin định danh thiết bị, nên
tối thiểu cần khai **Device or other IDs**.
