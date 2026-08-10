# API

Mọi hàm đều trả về Promise, và khi lỗi thì reject bằng [`ZaloError`](./errors.md).

## `login(options?)`

Mở màn đăng nhập Zalo.

```ts
const result = await login()
```

| Tham số | Mặc định | Ý nghĩa |
|---|---|---|
| `via` | `'app_or_web'` | Đăng nhập bằng app Zalo (`'app'`), bằng web (`'web'`), hoặc thử app trước rồi web (`'app_or_web'`) |
| `timeoutMs` | `120000` | Sau khoảng này mà chưa có kết quả thì reject `TIMEOUT` |
| `includeRefreshToken` | `false` | Có trả kèm `refreshToken` hay không |
| `extInfo` | `{}` | Thông tin phụ gửi cho Zalo |

Kết quả:

```ts
{
  exchange: 'device',
  oauthCode: '...',      // gửi cái này cho backend
  accessToken: '...',
  expiresAt: 1786800000000,
  channel: 'zalo',
  isNewUser: false,
}
```

**Nên gửi `oauthCode` cho backend** thay vì `accessToken`. Backend đổi code lấy token bằng
`secret_key` của app, và secret đó không nên nằm trong app.

## `getProfile(options?)`

Lấy thông tin user đang đăng nhập.

```ts
const profile = await getProfile()
// { id, name, picture: { url }, birthday, gender, phoneNumber, raw }
```

| Tham số | Ý nghĩa |
|---|---|
| `accessToken` | Không truyền thì dùng token của lần `login()` gần nhất |
| `fields` | Danh sách field muốn lấy |

Hai điều cần biết:

**Zalo chỉ trả profile cho IP ở Việt Nam.** Thiết bị ở nước ngoài luôn nhận lỗi
`PROFILE_RESTRICTED`. Vì vậy đừng đặt `getProfile()` vào đường bắt buộc của luồng đăng nhập:

```ts
let profile = null
try {
  profile = await getProfile()
} catch {
  // vẫn đăng nhập được, backend sẽ lấy profile
}
```

**Đừng dùng `profile.id` làm khoá định danh user.** Giá trị này đến từ thiết bị nên không đáng
tin. Hãy dùng id mà backend nhận được khi nó tự gọi Zalo.

## `logout()`

```ts
await logout()
```

Xoá phiên đăng nhập trên máy. Không bao giờ reject.

## Token

```ts
await exchangeOAuthCode(oauthCode, codeVerifier)  // -> { accessToken, refreshToken, expiresAt }
await refreshTokens(refreshToken)                 // -> { accessToken, refreshToken, expiresAt }
await isRefreshTokenValid(refreshToken)           // -> boolean, không bao giờ reject
```

Thư viện **không lưu token xuống đĩa**. Nếu app cần giữ token qua các lần mở app thì tự lưu bằng
Keychain (iOS) hoặc `EncryptedSharedPreferences` (Android). Đừng dùng `AsyncStorage` vì nó lưu
dạng plaintext.

Cách đơn giản nhất là đừng giữ token Zalo. Dùng nó một lần để đổi lấy session của backend, rồi
quên đi.

## Kiểm tra cấu hình

```ts
const report = await verifyInstallation()
// { ok, platform, appId, issues: [{ code, severity, message }] }

const hashKey = await getApplicationHashKey()   // Android; iOS trả null
const version = await getSdkVersion()           // { toolkit, native }
```

`verifyInstallation()` dùng để chẩn đoán lúc phát triển, nên bọc trong `if (__DEV__)`.

Nó chỉ đọc được cấu hình trên máy, không biết bạn đã đăng ký app trên Zalo portal hay chưa. Phần
đó chỉ lộ ra khi đăng nhập thật.

## Sự kiện

```ts
const sub = addListener(ZaloEventName.OAUTH_CODE_RECEIVED, () => {
  setLabel('Đang lấy thông tin...')
})

sub.remove()
```

Bắn khi user vừa đăng nhập xong và thư viện đang đổi code lấy token. Chỉ dùng để đổi nhãn loading;
không nghe cũng không sao.

## Enum

Mọi giá trị chuỗi trong API đều có enum kèm theo, để không phải viết tay:

```ts
import { ZaloErrorCode, ZaloLoginVia, ZaloExchangeMode } from 'rn-zalo-toolkit'

await login({ via: ZaloLoginVia.WEB })
```

Danh sách: `ZaloErrorCode`, `ZaloErrorPhase`, `ZaloLoginVia`, `ZaloExchangeMode`, `ZaloChannel`,
`ZaloPlatform`, `ZaloEventName`, `ZaloInstallIssueCode`, `ZaloIssueSeverity`.

Chúng không phải `enum` của TypeScript mà là object thường, nên chuỗi và enum dùng lẫn được:
`via: 'web'` và `via: ZaloLoginVia.WEB` là một.

## Test

Thư viện có sẵn mock, không cần tự viết:

```ts
jest.mock('rn-zalo-toolkit', () => require('rn-zalo-toolkit/jest'))
```

```ts
import * as zalo from 'rn-zalo-toolkit'

beforeEach(() => zalo.__reset())

it('xử lý được khi user huỷ', async () => {
  zalo.__failNextWith('CANCELLED')
  // ...
})
```

| Helper | Dùng để |
|---|---|
| `__reset()` | Trả mock về mặc định, gọi trong `beforeEach` |
| `__setLoginResult(partial)` | Đặt kết quả `login()` |
| `__setProfile(partial)` / `__setTokens(partial)` | Đặt dữ liệu trả về |
| `__setRefreshTokenValid(bool)` | |
| `__failNextWith(code)` | Cho lời gọi tiếp theo lỗi |
| `__emitOauthCodeReceived()` | Bắn sự kiện |
| `__getCalls()` | Xem tham số đã truyền vào |
