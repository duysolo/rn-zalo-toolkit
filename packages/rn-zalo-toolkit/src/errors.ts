/**
 * Mô hình lỗi của `rn-zalo-toolkit`.
 *
 * Nguyên tắc bất di bất dịch: **mọi lời gọi đều kết thúc**. Không có đường nào để promise
 * treo, nên JS không bao giờ phải đoán trạng thái bằng `AppState` hay bằng đồng hồ.
 */

/**
 * Tập error code hữu hạn. `switch` trên nó được TypeScript kiểm tra đủ nhánh.
 *
 * Khai bằng object `as const` chứ không dùng `enum` của TypeScript: React Native transpile
 * bằng Babel, nơi `const enum` không chạy được, còn `enum` thường thì sinh code runtime và
 * vi phạm `erasableSyntaxOnly`. Cách này cho autocomplete y hệt enum
 * (`ZaloErrorCode.CANCELLED`) mà vẫn nhận string literal, nên `'CANCELLED'` viết tay vẫn hợp lệ.
 *
 * `CANCELLED` là giá trị bình thường chứ không phải sự cố - user bấm huỷ thì rơi vào đây.
 */
export const ZaloErrorCode = {
  CANCELLED: 'CANCELLED',
  LOGIN_IN_PROGRESS: 'LOGIN_IN_PROGRESS',
  ZALO_NOT_INSTALLED: 'ZALO_NOT_INSTALLED',
  ZALO_OUT_OF_DATE: 'ZALO_OUT_OF_DATE',
  INVALID_CONFIG: 'INVALID_CONFIG',
  NOT_WIRED: 'NOT_WIRED',
  NETWORK: 'NETWORK',
  TIMEOUT: 'TIMEOUT',
  TOKEN_EXCHANGE_FAILED: 'TOKEN_EXCHANGE_FAILED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  PROFILE_RESTRICTED: 'PROFILE_RESTRICTED',
  RATE_LIMITED: 'RATE_LIMITED',
  UNKNOWN: 'UNKNOWN',
} as const

export type ZaloErrorCode = (typeof ZaloErrorCode)[keyof typeof ZaloErrorCode]

/** Giai đoạn phát sinh lỗi, giúp phân biệt "chưa đăng nhập được" với "đăng nhập rồi nhưng...". */
export const ZaloErrorPhase = {
  CONFIG: 'config',
  AUTHORIZE: 'authorize',
  EXCHANGE: 'exchange',
  PROFILE: 'profile',
} as const

export type ZaloErrorPhase = (typeof ZaloErrorPhase)[keyof typeof ZaloErrorPhase]

const ALL_CODES: readonly ZaloErrorCode[] = Object.values(ZaloErrorCode)

const CODE_SET = new Set<string>(ALL_CODES)

export const isZaloErrorCode = (value: unknown): value is ZaloErrorCode =>
  typeof value === 'string' && CODE_SET.has(value)

/** Dùng cho test bảng - giữ đồng bộ với `ZaloErrorCode` bằng kiểu, không bằng trí nhớ. */
export const zaloErrorCodes = ALL_CODES

/**
 * Chi tiết đi kèm lỗi.
 *
 * Chúng đi qua `userInfo.details` (JSON) chứ KHÔNG qua `message`: `message` được cả hai app
 * tiêu thụ bung thẳng ra alert cho người dùng cuối, nên nó phải luôn là câu đọc được.
 */
export interface ZaloErrorDetails {
  phase?: ZaloErrorPhase
  /** Mã gốc của SDK Zalo, giữ nguyên để tra tài liệu. */
  nativeCode?: number
  /** Thông điệp gốc của SDK. */
  nativeMessage?: string
  /**
   * Chỉ có ở `INVALID_CONFIG` trên Android: hash key SDK đang gửi lên Zalo.
   * Dán thẳng giá trị này lên portal, không cần chạy script riêng.
   */
  signatureHashKey?: string
  packageName?: string
  bundleId?: string
  appId?: string
}

export class ZaloError extends Error {
  public readonly code: ZaloErrorCode
  public readonly phase: ZaloErrorPhase
  public readonly nativeCode?: number
  public readonly nativeMessage?: string
  public readonly signatureHashKey?: string
  public readonly packageName?: string
  public readonly bundleId?: string
  public readonly appId?: string

  public constructor(code: ZaloErrorCode, message: string, details: ZaloErrorDetails = {}) {
    super(message)
    this.name = 'ZaloError'
    this.code = code
    this.phase = details.phase ?? 'authorize'
    this.nativeCode = details.nativeCode
    this.nativeMessage = details.nativeMessage
    this.signatureHashKey = details.signatureHashKey
    this.packageName = details.packageName
    this.bundleId = details.bundleId
    this.appId = details.appId
    // Giữ prototype chain khi transpile xuống ES5 (một số app tiêu thụ vẫn dùng target cũ).
    Object.setPrototypeOf(this, ZaloError.prototype)
  }

  /** Tiện cho `catch (e) { if (ZaloError.is(e, 'CANCELLED')) ... }`. */
  public static is(error: unknown, code?: ZaloErrorCode): error is ZaloError {
    if (!(error instanceof ZaloError)) return false
    return code === undefined || error.code === code
  }
}

/** Hình dạng lỗi mà React Native dựng lại ở JS từ `promise.reject(code, message, userInfo)`. */
interface NativeRejection {
  code?: unknown
  message?: unknown
  userInfo?: { details?: unknown } | null
}

const parseDetails = (raw: unknown): ZaloErrorDetails => {
  if (typeof raw !== 'string' || raw.length === 0) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return {}
    return parsed as ZaloErrorDetails
  } catch {
    // Native gửi chuỗi không phải JSON - không được để việc dựng lỗi tự nó ném lỗi.
    return {}
  }
}

/**
 * Dựng `ZaloError` từ giá trị mà native reject.
 *
 * Bất kỳ thứ gì cũng dựng được thành `ZaloError` - kể cả một lỗi hoàn toàn lạ. Hàm này
 * không bao giờ ném.
 */
export const zaloErrorFrom = (error: unknown, fallbackPhase: ZaloErrorPhase): ZaloError => {
  if (error instanceof ZaloError) return error

  const rejection = (error ?? {}) as NativeRejection
  const code = isZaloErrorCode(rejection.code) ? rejection.code : 'UNKNOWN'
  const details = parseDetails(rejection.userInfo?.details)
  const message =
    typeof rejection.message === 'string' && rejection.message.length > 0
      ? rejection.message
      : `Zalo: ${code}`

  return new ZaloError(code, message, { phase: fallbackPhase, ...details })
}
