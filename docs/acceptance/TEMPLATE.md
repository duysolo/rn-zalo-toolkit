# Nghiệm thu rn-zalo-toolkit &lt;version&gt; - &lt;YYYY-MM-DD&gt;

> Chép file này thành `docs/acceptance/<YYYY-MM-DD>-<version>.md`. **Một file cho mỗi lần
> chạy, không ghi đè** - giá trị của nó nằm ở chỗ so được hai lần chạy với nhau.

Người chạy: · Build (git sha): · Zalo appId: · Brand:

## Thiết bị

| id | OS | Model | Zalo app ver | Ghi chú |
|----|----|-------|--------------|---------|
| A | Android ... | | | có Play Services |
| B | Android ... | | | **KHÔNG** có Play Services (ROM Trung Quốc) |
| C | iOS ... | | | |
| D | iOS ... | | chưa cài | dành cho A3 |

## Quy ước

**Ba trạng thái, không có trạng thái thứ tư:** `PASS` · `FAIL` · `CHƯA CHẠY`.
Cấm dấu ✓ cho ô chưa chạy.

**Cột "thời gian settle" là BẮT BUỘC.** Nó là dữ liệu duy nhất so được giữa hai lần chạy, và
là thứ chứng minh "không treo" - chứ không phải cột PASS/FAIL.

## A. Luồng login

| Ô | Kịch bản | Thiết bị | Kết quả | Thời gian settle | Mã trả về | Ghi chú |
|---|---|---|---|---|---|---|
| A1 | Zalo đã cài + đã đăng nhập, `via:'app'` | | | | | |
| A2 | Zalo đã cài, chưa đăng nhập | | | | | |
| A3 | **Zalo chưa cài**, `via:'app'` | | | | | phải `ZALO_NOT_INSTALLED`, KHÔNG treo |
| A4 | **Zalo bản cũ**, `via:'app'` | | | | | có thể `CHƯA CHẠY` - xem ghi chú dưới |
| A5 | `via:'web'`, đóng webview | | | | | `CANCELLED` **ngay** |
| A6 | `via:'app'`, bấm Từ chối | | | | | |
| A7 | `via:'app_or_web'`, Zalo chưa cài | | | | | ghi `isAuthenViaWebView` |
| A8 | Bật máy bay **sau** khi có oauth code | | | | | trước đây treo → JS đoán nhầm CANCELLED |
| A9 | Mạng chậm, exchange > 5s | | | | | KHÔNG được phán cancel oan |
| A10 | Kill app lúc đang ở Zalo, mở lại, login | | | | | |
| A11 | Gọi `login()` 2 lần | | | | | lần 2 = `LOGIN_IN_PROGRESS` |
| A12 | Xoay màn hình giữa chừng | | | | | |
| A13 | Login lần đầu sau cài mới | | | | | ca hồi quy bug cũ |
| A14 | App khác gửi intent `zalo-<appId>://` lúc không có phiên | | | | | không crash, không emit |
| A15 | Login khi có RN modal đang mở (iOS) | | | | | |
| A16 | Android không có Play Services, `via:'web'` | | | | | |
| A17 | Bật "Don't keep activities", login | | | | | settle đúng một lần |

> **A4 nhiều khả năng không dựng lại được** - Zalo không phát hành bản cũ. Một cách rẻ: dựng
> APK giả cùng package name `com.zing.zalo` với `versionCode` thấp trên emulator (~1h). Nếu
> không làm được: ghi `CHƯA CHẠY`, **cấm** đánh dấu xanh.
> **Chạy D1 TRƯỚC A4**: dialog "Bản Zalo không tương thích" đến từ CẢ HAI nguyên nhân.

## B. Token

| Ô | Kịch bản | Kết quả | Thời gian | Ghi chú |
|---|---|---|---|---|
| B1 | `refreshTokens` token hợp lệ | | | |
| B2 | `refreshTokens` token rác | | | `INVALID_TOKEN` |
| B3 | `isRefreshTokenValid('')` | | | resolve `false`, KHÔNG reject |
| B4 | `logout` rồi `getProfile` | | | `INVALID_TOKEN`, không crash |
| B5 | `exchange:'none'` | | | kiểm KHÔNG có giá trị nào lọt vào log |
| B6 | **`logout()` 20 lần liên tiếp (iOS)** | | | **không crash Hermes** - bug đã có nạn nhân |
| B7 | `logout()` rồi `login()` ngay | | | |
| B8 | `login()` mặc định | | | **không** có `refreshToken` trong kết quả |

## C. Profile

| C1 | Trong VN | | | `raw` đủ field |
| C2 | Ngoài VN / VPN | | | `PROFILE_RESTRICTED`, KHÔNG làm hỏng login |
| C3 | `fields` tuỳ biến, **cả 2 nền** | | | iOS lọc phía client - so hai bên phải giống nhau |
| C4 | `getProfile` lỗi -501 | | | app vẫn login được |

## D. Cấu hình sai

| D1 | Android hash key chưa đăng ký | | | message phải chứa hash key hiện tại |
| D2 | Android package chưa đăng ký | | | |
| D3 | `zaloAppId` rỗng | | | build fail - **đã tự động hoá trong CI** |
| D4 | iOS thiếu `ZaloAppID` | | | |
| D5 | iOS thiếu URL scheme | | | |
| D6 | iOS thiếu `LSApplicationQueriesSchemes` | | | |
| D7a | iOS quên forward openURL + `via:'app'` | | | `NOT_WIRED` |
| D7b | iOS quên forward openURL + `via:'web'` | | | **vẫn login THÀNH CÔNG** |
| D8 | appId lệch iOS vs Android | | | `npx rn-zalo-toolkit-doctor` bắt được |

## E. Build

| E1 | `:app:dependencies \| grep me.zalo` | | | đúng `4.24.1101`, không có dòng `-> ` |
| E4 | Cold start Android | | | `adb shell am start -W` ×10, so trung vị có/không ContentProvider. Ngưỡng: >3% |
| E5 | **`assembleRelease` (minify+shrink), chạy A1/A5 trên bản release** | | | `ClassNotFoundException` CHỈ xuất hiện khi minify |
| E6 | App còn sót `meta-data appID` | | | lỗi manifest-merger có tên attribute |
| E7 | `pod install` ở app không có `$RNFirebaseDisableSPM` | | | |
| E8 | jest của app import thật `rn-zalo-toolkit` | | | không `SyntaxError` |

## F. Danh tính & nhiều app

| F1 | Đã login, gọi `login()` lần nữa không logout | | | token MỚI |
| F2 | Login X → logout → login Y | | | đúng danh tính Y |
| F3 | Hai app dùng hai appId khác nhau, cùng một máy | | | mỗi app nhận đúng appId của mình, không phá phiên của nhau |
| F5 | Token hết hạn giữa phiên → `refreshTokens()` | | | |
| F6 | `refreshToken` hết hạn | | | `INVALID_TOKEN`, phân biệt rõ với `NETWORK` |
| F7 | Gỡ Zalo giữa lúc `via:'app'` đang chờ | | | settle, không treo |

## Kết luận

- Tổng: __ PASS · __ FAIL · __ CHƯA CHẠY
- Chặn phát hành:
- Đã biết & chấp nhận:
