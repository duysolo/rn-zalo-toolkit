# API

Mọi hàm reject bằng `ZaloError` - xem [errors.md](./errors.md).

## `login(options?)`

```ts
login(options?: ZaloLoginOptions): Promise<ZaloLoginResult>
```

| Option | Mặc định | |
|---|---|---|
| `via` | `'app_or_web'` | `'app'` \| `'web'` \| `'app_or_web'` |
| `timeoutMs` | `120_000` | Trần thời gian **áp ở native**. Xem ghi chú dưới |
| `extInfo` | `{}` | Gửi kèm cho Zalo (`app_name`, `app_ver`...) |
| `includeRefreshToken` | `false` | Xem ghi chú dưới |
| `exchange` | `'device'` | `'none'` là THỬ NGHIỆM, xem dưới |

Kết quả là **discriminated union** theo `exchange`, nên nhánh mặc định đảm bảo có token ở mức kiểu:

```ts
const result = await login()
if (result.exchange === 'device') {
  result.accessToken   // string, không phải string | undefined
  result.expiresAt     // epoch ms
}
```

**`timeoutMs` là lưới duy nhất cho một nhánh.** SDK iOS không có cơ chế đối soát nào khi app quay
lại foreground (`handleDidBecomeActive` là no-op), nên nếu người dùng rời sang Zalo rồi không
quyết gì, không ai khác phát hiện được. Timer trên iOS là `DispatchQueue.main.asyncAfter` - nó
không chạy khi app bị suspend, nên hãy giữ thêm một `withTimeout` ở JS **cao hơn** giá trị này
làm lưới cuối.

**`includeRefreshToken` mặc định tắt.** `refreshToken` sống lâu hơn `accessToken` rất nhiều. Nếu
app không có ai tiêu thụ nó, đừng bật - bí mật không có người dùng thì không nên lộ ra JS.

**`exchange: 'none'` là THỬ NGHIỆM, không dùng cho production.** Nó **không** an toàn hơn: thay
vì chỉ `accessToken` (TTL 1 giờ), nó đưa thêm cặp `{oauthCode, codeVerifier}` ra JS. PKCE chỉ bảo
vệ **kênh redirect**; khi code và verifier đi cùng một kênh JS → backend thì PKCE không bảo vệ
kênh đó. Nó tồn tại để giữ hình dạng cho đường lui kiến trúc, và hiện chưa backend nào nhận.

## Ranh giới tin cậy - đọc trước khi gọi backend

Mọi giá trị thư viện này trả về đều đến từ **thiết bị**, tức từ phía không đáng tin. Không có
giá trị nào trong số đó chứng minh được danh tính người dùng cho backend của bạn.

**Backend phải tự xác minh, không được tin `id` hay `accessToken` mà client gửi lên.** Cụ thể:

- Gửi `oauthCode` (không phải `accessToken`) lên backend, để **backend** đổi lấy token bằng
  `secret_key` - secret không bao giờ được có mặt trong app. Đây là lý do `login()` mặc định
  trả `oauthCode`, và `exchange: 'none'` tồn tại.
- Khi gọi Graph API của Zalo từ server, đính kèm `appsecret_proof` (HMAC-SHA256 của access
  token với `secret_key` làm khoá). Thiếu nó thì một access token bị lộ dùng được ở bất kỳ
  đâu; có nó thì token chỉ dùng được từ nơi biết secret.
- **Fail-closed**: xác minh lỗi vì mạng/timeout thì từ chối đăng nhập, không "tạm cho qua".
  Một đường fallback cho qua khi xác minh lỗi chính là đường tấn công - kẻ tấn công chỉ cần
  làm cho bước xác minh thất bại.
- `getProfile()` phục vụ **hiển thị**. Đừng dùng `profile.id` từ client làm khoá định danh khi
  tạo tài khoản hay ghép ví - hãy dùng id mà backend nhận được từ chính lời gọi của nó.

## `getProfile(options?)`

```ts
getProfile(options?: { accessToken?: string; fields?: string[] }): Promise<ZaloProfile>
```

⚠️ **Đừng đặt hàm này trên đường bắt buộc của đăng nhập.** `graph.zalo.me` chặn theo IP: thiết bị
ngoài Việt Nam **luôn** nhận `PROFILE_RESTRICTED`. Backend chạy IP Việt Nam tự lấy được đúng hồ sơ
đó từ `accessToken`, nên hãy coi kết quả ở đây là dữ liệu hiển thị sớm còn nguồn danh tính là
server.

```ts
let profile = null
try {
  profile = await getProfile()
} catch {
  // đi tiếp - backend sẽ resolve
}
```

Không truyền `accessToken` thì dùng phiên `login()` gần nhất **trong cùng process**. Thư viện
không lưu gì xuống đĩa, nên sau khi app khởi động lại sẽ là `INVALID_TOKEN`.

`picture` đã được làm phẳng: `picture.url`, không phải `picture.data.url` như thư viện cũ. Bản
gốc Zalo trả về vẫn còn nguyên trong `raw`.

## Token

```ts
exchangeOAuthCode(oauthCode: string, codeVerifier: string): Promise<ZaloTokens>
refreshTokens(refreshToken: string): Promise<ZaloTokens>
isRefreshTokenValid(refreshToken: string): Promise<boolean>   // KHÔNG BAO GIỜ reject
logout(): Promise<void>                                        // KHÔNG BAO GIỜ reject
```

Thư viện **không lưu token xuống đĩa**. Nếu app cần `refreshToken` sống qua các lần mở app thì
tự lưu bằng Keychain / `EncryptedSharedPreferences` - **không** `AsyncStorage` (plaintext trên cả
hai nền tảng).

Khuyến nghị mặc định: **đừng persist token Zalo**. Nó chỉ dùng một lần để đổi lấy phiên của backend;
phiên đó tự quản lý vòng đời của nó.

## Chẩn đoán

```ts
verifyInstallation(): Promise<ZaloInstallReport>
getApplicationHashKey(): Promise<string | null>   // Android; iOS trả null. Không ném
getSdkVersion(): Promise<{ toolkit: string; native: string }>
```

`verifyInstallation()` là hàm **chẩn đoán** - bọc `if (__DEV__)`, đừng gọi trong luồng runtime
của bản phát hành.

Giới hạn: nó chỉ thấy cấu hình **trên máy**. Nó KHÔNG biết Zalo portal đã đăng ký package /
bundle ID / hash key hay chưa - chuyện đó chỉ lộ khi đăng nhập, và khi ấy `INVALID_CONFIG` đã kèm
sẵn giá trị để dán lên portal.

Để bắt lỗi **appId lệch giữa iOS và Android** - thứ runtime không bao giờ thấy vì mỗi lần chỉ
chạy một nền tảng - dùng `npx rn-zalo-toolkit-doctor`.

## Sự kiện

```ts
addListener('oauthCodeReceived', () => setLabel('Đang lấy thông tin...')): ZaloSubscription
```

Fire khi SDK đã có oauth code, tức người dùng **đã hoàn tất** đăng nhập và chỉ còn chờ đổi token
qua mạng.

Chỉ dùng để đổi nhãn loading. **API vẫn đúng khi không ai nghe** - đây không phải cơ chế phát
hiện huỷ như bản vá cũ của `react-native-zalo-kit`.

## Test

```ts
jest.mock('rn-zalo-toolkit', () => require('rn-zalo-toolkit/jest'))
```

| Helper | |
|---|---|
| `__reset()` | gọi trong `beforeEach` |
| `__setNextLoginResult(partial)` | |
| `__setProfile(partial)` / `__setTokens(partial)` | |
| `__failNextWith(code, message?, details?)` | ảnh hưởng đúng **một** lời gọi |
| `__emitOauthCodeReceived()` | |
| `__getCalls()` | assert `via`, `timeoutMs`, `fields` đã truyền |

Bản mock mô phỏng đúng hợp đồng thật - kể cả việc `logout()` và `isRefreshTokenValid()` không bao
giờ reject - để test đi qua chính nhánh mà máy thật sẽ đi.
