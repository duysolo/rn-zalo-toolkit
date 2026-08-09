/**
 * Kiểu công khai của `rn-zalo-toolkit`.
 *
 * LƯU Ý KIẾN TRÚC: file này KHÔNG được import vào `src/specs/NativeRnZaloToolkit.ts`.
 * Codegen của React Native chỉ đỡ được một tập kiểu hẹp - `Record<K, V>` chẳng hạn
 * làm build chết (`UnsupportedGenericParserError`), không phải cảnh báo. Vì vậy spec
 * native chỉ nhận/trả JSON string, còn hình dạng thật sống ở đây.
 */

/** Cách mở màn đăng nhập Zalo. */
export type ZaloLoginVia = 'app' | 'web' | 'app_or_web'

/**
 * Kênh đăng nhập Zalo trả về.
 *
 * v0.1 chỉ làm login Zalo nên trên thực tế luôn là `'zalo'`. Field được giữ vì cả hai
 * SDK đều trả nó và nó hữu ích khi debug - ĐỪNG xây logic phân nhánh dựa vào nó.
 */
export type ZaloChannel = 'zalo' | 'guest' | 'facebook' | 'google' | 'zingme' | 'unknown'

export interface ZaloLoginOptions {
  /** Mặc định `'app_or_web'`. */
  via?: ZaloLoginVia
  /**
   * Trần thời gian áp Ở NATIVE, mặc định 120_000ms.
   *
   * Đây là lưới duy nhất cho nhánh "user rời sang Zalo rồi không quyết gì": SDK iOS
   * không có cơ chế đối soát nào khi app quay lại foreground (`handleDidBecomeActive`
   * là no-op), nên không ai khác phát hiện được tình trạng đó.
   */
  timeoutMs?: number
  /** `extInfo` gửi kèm cho Zalo (`app_name`, `app_ver`, ...). */
  extInfo?: { [key: string]: string }
  /**
   * Mặc định `false`.
   *
   * `refreshToken` sống lâu hơn `accessToken` rất nhiều. Hiện KHÔNG app nào tiêu thụ nó
   * (cả hai app chỉ gửi `accessToken` lên backend rồi đổi lấy phiên Firebase). Bí mật
   * không có người dùng thì không được lộ ra JS - cùng lý lẽ với việc không persist token.
   */
  includeRefreshToken?: boolean
  /**
   * `'device'` (mặc định): SDK đổi `oauthCode` → token ngay trên máy.
   *
   * `'none'` (THỬ NGHIỆM, KHÔNG dùng cho production): trả `oauthCode` + `codeVerifier`
   * để backend tự đổi qua `/v4/access_token`.
   *
   * ⚠️ ĐÂY KHÔNG PHẢI CHẾ ĐỘ AN TOÀN HƠN. Nó đưa THÊM bí mật ra JS: trước chỉ có
   * `accessToken` (TTL 1h), giờ thêm cặp `{oauthCode, codeVerifier}`. PKCE chỉ bảo vệ
   * KÊNH REDIRECT; khi code và verifier đi cùng một kênh JS → backend thì PKCE không
   * bảo vệ kênh đó.
   *
   * ⚠️ Hiện chưa có backend nào nhận: cả hai backend đều đòi `accessToken` và tự gọi
   * `graph.zalo.me/me`. Option này tồn tại để giữ hình dạng cho đường lui, không phải
   * để dùng ngay.
   */
  exchange?: 'device' | 'none'
}

/**
 * Kết quả `login()`, phân nhánh theo `exchange`.
 *
 * Nhánh `'device'` đảm bảo CÓ token ở mức kiểu - người gọi không phải viết
 * `if (!accessToken) throw` nữa.
 */
export type ZaloLoginResult =
  | {
      exchange: 'device'
      oauthCode: string
      accessToken: string
      /** Chỉ có khi bật `includeRefreshToken`. */
      refreshToken?: string
      /** epoch ms. */
      expiresAt: number
      channel: ZaloChannel
      isNewUser: boolean
    }
  | {
      exchange: 'none'
      oauthCode: string
      codeVerifier: string
      channel: ZaloChannel
      isNewUser: boolean
    }

export interface ZaloTokens {
  accessToken: string
  refreshToken: string
  /** epoch ms. */
  expiresAt: number
}

export interface ZaloProfile {
  id: string
  name: string | null
  /**
   * ĐÃ LÀM PHẲNG so với `react-native-zalo-kit` (trả `picture.data.url`).
   * `picture.data.url` là hình dạng Facebook Graph mà Zalo sao chép lại.
   * App nào cần hình dạng cũ thì map ở lớp đệm của mình.
   */
  picture: { url: string | null }
  birthday: string | null
  gender: string | null
  phoneNumber: string | null
  /**
   * JSON gốc Zalo trả về, để app cần field lạ vẫn lấy được.
   *
   * ⚠️ ĐÂY LÀ PII (tên, ngày sinh, giới tính, số điện thoại). Đừng log nguyên object -
   * cả hai app tiêu thụ đều persist log xuống đĩa hoặc đẩy lên crash reporting.
   */
  raw: { [key: string]: unknown }
}

export interface ZaloProfileOptions {
  /** Bỏ trống thì dùng access token của phiên `login()` gần nhất TRONG CÙNG process. */
  accessToken?: string
  /**
   * Mặc định `['id', 'name', 'picture', 'birthday', 'gender']`.
   *
   * SDK iOS **không** nhận danh sách field (`getZaloUserProfileWithAccessToken:callback:`
   * chỉ có một dạng), nên trên iOS thư viện lọc kết quả ở phía mình - kể cả trong `raw` -
   * để hai nền tảng trả cùng một tập dữ liệu. Nghĩa là xin ít field thì thật sự nhận ít,
   * nhưng trên iOS dữ liệu vẫn đã đi qua mạng.
   */
  fields?: string[]
}

export type ZaloInstallIssueCode =
  | 'MISSING_APP_ID'
  | 'URL_SCHEME_MISSING'
  | 'QUERIES_SCHEMES_MISSING'
  | 'BROWSER_ACTIVITY_MISSING'
  | 'SDK_NOT_INITIALIZED'
  | 'URL_HANDLER_NOT_WIRED'

export interface ZaloInstallIssue {
  code: ZaloInstallIssueCode
  severity: 'error' | 'warn'
  /** Tiếng Việt, mô tả HIỆN TƯỢNG sẽ gặp nếu bỏ qua - không phải mô tả kỹ thuật. */
  message: string
  /** Đoạn config cần dán vào đâu. */
  fix: string
}

export interface ZaloInstallReport {
  ok: boolean
  platform: 'ios' | 'android'
  appId: string | null
  nativeSdkVersion: string
  issues: ZaloInstallIssue[]
  details: {
    zaloAppInstalled: boolean
    /**
     * Android: ĐÚNG giá trị SDK gửi lên trong tham số `sign_key`, tức cái phải dán lên
     * Zalo portal. Lấy thẳng từ `AppInfo.getApplicationHashKey` của SDK để không thể lệch.
     */
    signatureHashKey?: string
    /**
     * Android API 28+: TOÀN BỘ chứng chỉ ký mà hệ thống biết.
     *
     * Khi khoá đã rotate, danh sách này **chứa** `signatureHashKey` chứ không "khác" nó -
     * `GET_SIGNATURES` (thứ SDK dùng) trả chứng chỉ GỐC, còn đây là toàn bộ lineage.
     * CHỈ để chẩn đoán; chuỗi phải dán lên portal luôn là `signatureHashKey`.
     */
    signersAll?: string[]
    packageName?: string
    bundleId?: string
  }
}

export interface ZaloSdkVersion {
  /** Version của `rn-zalo-toolkit`. */
  toolkit: string
  /** Version SDK Zalo native đang link. */
  native: string
}

export type ZaloEventName = 'oauthCodeReceived'

/** Định danh lần `login()` sinh ra sự kiện - để app tự ghép nếu cần. */
export interface ZaloEventPayload {
  attemptId: string
}

export type ZaloEventListener = (payload: ZaloEventPayload) => void

export interface ZaloSubscription {
  remove(): void
}
