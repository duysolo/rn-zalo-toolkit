# API

Mọi hàm đều reject bằng `ZaloError`, xem [errors.md](./errors.md).

Mọi giá trị dạng chuỗi trong API đều có enum đi kèm: `ZaloErrorCode`, `ZaloErrorPhase`,
`ZaloLoginVia`, `ZaloExchangeMode`, `ZaloChannel`, `ZaloPlatform`, `ZaloEventName`,
`ZaloInstallIssueCode`, `ZaloIssueSeverity`.

Chúng là object `as const` chứ không phải `enum` của TypeScript, vì React Native transpile bằng
Babel - `const enum` không chạy được, còn `enum` thường thì sinh code runtime. Hệ quả tiện cho
bạn: enum và string literal dùng lẫn được, nên `via: 'app'` và `via: ZaloLoginVia.APP` là một.

## `login(options?)`

```ts
login(options?: ZaloLoginOptions): Promise<ZaloLoginResult>
```

| Option | Mặc định | |
|---|---|---|
| `via` | `'app_or_web'` | `'app'` \| `'web'` \| `'app_or_web'` |
| `timeoutMs` | `120_000` | Timeout áp ở native, xem ghi chú bên dưới |
| `extInfo` | `{}` | Gửi kèm cho Zalo (`app_name`, `app_ver`...) |
| `includeRefreshToken` | `false` | Xem ghi chú bên dưới |
| `exchange` | `'device'` | `'none'` là experimental, xem bên dưới |

Kết quả là discriminated union theo `exchange`, nên nhánh mặc định có token ở mức type:

```ts
const result = await login()
if (result.exchange === ZaloExchangeMode.DEVICE) {
  result.accessToken   // string, không phải string | undefined
  result.expiresAt     // epoch ms
}
```

**Về `timeoutMs`.** SDK iOS không tự đối chiếu gì khi app quay lại foreground
(`handleDidBecomeActive` là no-op), nên nếu user chuyển sang Zalo rồi bỏ ngang thì timeout này là
thứ duy nhất kết thúc promise. Timer trên iOS là `DispatchQueue.main.asyncAfter` nên không chạy
khi app bị suspend - nếu app của bạn cần chắc chắn hơn thì giữ thêm một `withTimeout` ở JS với
giá trị lớn hơn.

**Về `includeRefreshToken`.** Mặc định tắt vì `refreshToken` sống lâu hơn `accessToken` rất
nhiều. Nếu app không có chỗ nào dùng tới thì đừng bật.

**Về `exchange: 'none'`.** Đây là option experimental, chưa dùng cho production. Nó không an
toàn hơn mặc định: thay vì chỉ đưa `accessToken` (TTL 1 giờ) ra JS, nó đưa thêm cặp
`{oauthCode, codeVerifier}`. PKCE chỉ bảo vệ kênh redirect, nên khi code và verifier cùng đi một
đường JS → backend thì PKCE không giúp gì cho đường đó. Option này tồn tại để giữ chỗ cho hướng
kiến trúc backend-exchange, và hiện chưa backend nào nhận.

## Trust boundary

Mọi giá trị thư viện trả về đều đến từ thiết bị, tức từ phía không đáng tin. Không giá trị nào
trong đó chứng minh được danh tính user với backend của bạn.

Backend phải tự verify, không tin `id` hay `accessToken` mà client gửi lên:

- Gửi `oauthCode` (không phải `accessToken`) lên backend, để backend đổi lấy token bằng
  `secret_key`. Secret không bao giờ nên có mặt trong app.
- Khi gọi Graph API của Zalo từ server, đính kèm `appsecret_proof` - HMAC-SHA256 của access token
  với `secret_key` làm key. Không có nó thì một access token bị lộ dùng được từ bất kỳ đâu.
- Fail-closed: verify lỗi vì network hay timeout thì từ chối đăng nhập, đừng cho qua tạm. Một
  nhánh fallback cho qua khi verify lỗi chính là đường tấn công dễ nhất.
- `getProfile()` là để hiển thị. Đừng dùng `profile.id` từ client làm khoá định danh khi tạo tài
  khoản hay ghép ví, hãy dùng id mà backend nhận được từ lời gọi của chính nó.

## `getProfile(options?)`

```ts
getProfile(options?: { accessToken?: string; fields?: string[] }): Promise<ZaloProfile>
```

`graph.zalo.me` chặn theo IP nguồn, nên thiết bị ngoài Việt Nam luôn nhận `PROFILE_RESTRICTED`.
Đừng đặt hàm này trên đường bắt buộc của luồng đăng nhập. Backend chạy IP Việt Nam lấy được đúng
profile đó từ `accessToken`, nên hãy coi kết quả ở đây là dữ liệu hiển thị sớm, còn nguồn danh
tính là server:

```ts
let profile = null
try {
  profile = await getProfile()
} catch {
  // đi tiếp, backend sẽ resolve
}
```

Không truyền `accessToken` thì dùng phiên `login()` gần nhất trong cùng process. Thư viện không
lưu gì xuống đĩa, nên sau khi app restart sẽ là `INVALID_TOKEN`.

`picture` đã được làm phẳng thành `picture.url`. Dữ liệu gốc Zalo trả về vẫn còn nguyên trong
`raw`.

## Token

```ts
exchangeOAuthCode(oauthCode: string, codeVerifier: string): Promise<ZaloTokens>
refreshTokens(refreshToken: string): Promise<ZaloTokens>
isRefreshTokenValid(refreshToken: string): Promise<boolean>   // không bao giờ reject
logout(): Promise<void>                                       // không bao giờ reject
```

Thư viện không lưu token xuống đĩa. Nếu app cần `refreshToken` sống qua các lần mở app thì tự lưu
bằng Keychain hoặc `EncryptedSharedPreferences`. Đừng dùng `AsyncStorage` vì nó là plaintext trên
cả hai nền tảng.

Mặc định nên chọn: đừng persist token Zalo. Nó chỉ cần dùng một lần để đổi lấy session của
backend, và session đó tự quản lý vòng đời của nó.

## Chẩn đoán

```ts
verifyInstallation(): Promise<ZaloInstallReport>
getApplicationHashKey(): Promise<string | null>   // Android; iOS trả null, không throw
getSdkVersion(): Promise<{ toolkit: string; native: string }>
```

`verifyInstallation()` là hàm chẩn đoán, nên bọc trong `if (__DEV__)` chứ đừng gọi ở runtime của
bản release.

Nó chỉ thấy config trên máy, không biết Zalo portal đã đăng ký package / bundle ID / hash key hay
chưa. Phần đó chỉ lộ khi đăng nhập thật, và lúc đó `INVALID_CONFIG` sẽ kèm sẵn giá trị cần dán
lên portal.

Để bắt lỗi app id lệch giữa iOS và Android - thứ runtime không thấy được vì mỗi lần chạy chỉ có
một nền tảng - dùng `npx rn-zalo-toolkit-doctor`.

## Sự kiện

```ts
addListener(ZaloEventName.OAUTH_CODE_RECEIVED, () => setLabel('...')): ZaloSubscription
```

Fire khi SDK đã nhận được oauth code, tức user đã hoàn tất đăng nhập và chỉ còn chờ đổi token qua
network.

Sự kiện này chỉ để đổi label loading. API vẫn hoạt động đúng khi không ai listen.

## Test

```ts
jest.mock('rn-zalo-toolkit', () => require('rn-zalo-toolkit/jest'))
```

| Helper | |
|---|---|
| `__reset()` | gọi trong `beforeEach` |
| `__setLoginResult(partial)` | |
| `__setProfile(partial)` / `__setTokens(partial)` | |
| `__failNextWith(code, message?, details?)` | ảnh hưởng đúng một lời gọi |
| `__emitOauthCodeReceived()` | |
| `__getCalls()` | assert `via`, `timeoutMs`, `fields` đã truyền |

Mock mô phỏng đúng hợp đồng thật, kể cả việc `logout()` và `isRefreshTokenValid()` không bao giờ
reject, để test đi qua đúng nhánh mà máy thật sẽ đi.
