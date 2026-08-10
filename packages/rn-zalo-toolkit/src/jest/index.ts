/**
 * Bản cài đặt in-memory của `rn-zalo-toolkit` dành cho test của app tiêu thụ.
 *
 * Vì sao ship kèm thay vì để mỗi app tự mock: `TurboModuleRegistry.getEnforcing` ném NGAY
 * lúc import trong môi trường Node, nên app nào cũng buộc phải mock, và kết quả là mỗi app
 * dựng một bản mock khác nhau, lệch dần khỏi hợp đồng thật.
 *
 * Dùng:
 *   jest.mock('rn-zalo-toolkit', () => require('rn-zalo-toolkit/jest'))
 *
 * Bản mock này mô phỏng ĐÚNG hợp đồng thật - kể cả việc `logout()`/`isRefreshTokenValid()`
 * không bao giờ reject - để test đi qua đúng nhánh mà máy thật sẽ đi.
 */

import { ZaloError, ZaloErrorCode } from '../errors'
import type { ZaloErrorDetails } from '../errors'
import { ZaloChannel, ZaloEventName, ZaloExchangeMode, ZaloPlatform } from '../types'
import type {
  ZaloEventListener,
  ZaloInstallReport,
  ZaloLoginOptions,
  ZaloLoginResult,
  ZaloProfile,
  ZaloProfileOptions,
  ZaloSdkVersion,
  ZaloSubscription,
  ZaloTokens,
} from '../types'

export * from '../types'
export {
  ZaloError,
  zaloErrorFrom,
  zaloErrorCodes,
  isZaloErrorCode,
  ZaloErrorCode,
  type ZaloErrorDetails,
  ZaloErrorPhase,
} from '../errors'

const DEFAULT_LOGIN: ZaloLoginResult = {
  exchange: ZaloExchangeMode.DEVICE,
  oauthCode: 'mock-oauth-code',
  accessToken: 'mock-access-token',
  expiresAt: 4102444800000, // 2100-01-01, cố định để test không phụ thuộc đồng hồ
  channel: ZaloChannel.ZALO,
  isNewUser: false,
}

const DEFAULT_PROFILE: ZaloProfile = {
  id: 'mock-zalo-id',
  name: 'Người dùng Mock',
  picture: { url: 'https://example.invalid/avatar.png' },
  birthday: null,
  gender: null,
  phoneNumber: null,
  raw: { id: 'mock-zalo-id', name: 'Người dùng Mock' },
}

const DEFAULT_TOKENS: ZaloTokens = {
  accessToken: 'mock-access-token',
  refreshToken: 'mock-refresh-token',
  expiresAt: 4102444800000,
}

interface PendingFailure {
  code: ZaloErrorCode
  message: string
  details: ZaloErrorDetails
}

interface MockState {
  loginResult: ZaloLoginResult
  profile: ZaloProfile
  tokens: ZaloTokens
  refreshTokenValid: boolean
  installReport: ZaloInstallReport
  hashKey: string | null
  nextFailure: PendingFailure | null
  listeners: Set<ZaloEventListener>
  calls: { login: ZaloLoginOptions[]; getProfile: ZaloProfileOptions[]; logout: number }
}

const freshState = (): MockState => ({
  loginResult: DEFAULT_LOGIN,
  profile: DEFAULT_PROFILE,
  tokens: DEFAULT_TOKENS,
  refreshTokenValid: true,
  installReport: {
    ok: true,
    platform: ZaloPlatform.ANDROID,
    appId: '0000000000000000000',
    nativeSdkVersion: 'mock',
    issues: [],
    details: { zaloAppInstalled: true, packageName: 'com.example.mock' },
  },
  hashKey: 'bW9jay1oYXNoLWtleQ==',
  nextFailure: null,
  listeners: new Set(),
  calls: { login: [], getProfile: [], logout: 0 },
})

let state = freshState()

const takeFailure = (): PendingFailure | null => {
  const failure = state.nextFailure
  state.nextFailure = null
  return failure
}

const rejectIfArmed = async (): Promise<void> => {
  const failure = takeFailure()
  if (failure) throw new ZaloError(failure.code, failure.message, failure.details)
}

// ── điều khiển từ test ────────────────────────────────────────────────────────

/** Trả mọi thứ về mặc định. Gọi trong `beforeEach`. */
export const __reset = (): void => {
  state = freshState()
}

/** Đặt kết quả `login()` cho MỌI lời gọi tiếp theo, tới khi `__reset()`. */
export const __setLoginResult = (result: Partial<ZaloLoginResult>): void => {
  const merged = { ...DEFAULT_LOGIN, ...result } as ZaloLoginResult

  // `exchange: 'none'` nghĩa là KHÔNG có bước đổi code lấy token, nên không thể có
  // `accessToken`/`expiresAt`. Trộn thẳng với DEFAULT_LOGIN sẽ đẻ ra một hình dạng mà native
  // không bao giờ trả về - và test của app sẽ xanh cho một nhánh code chết. Mock mà dựng
  // được trạng thái bất khả thi thì tệ hơn không có mock.
  if (merged.exchange === ZaloExchangeMode.NONE && !('accessToken' in result)) {
    delete (merged as { accessToken?: string }).accessToken
    delete (merged as { expiresAt?: number }).expiresAt
    delete (merged as { refreshToken?: string }).refreshToken
  }

  state.loginResult = merged
}

export const __setProfile = (profile: Partial<ZaloProfile>): void => {
  state.profile = { ...DEFAULT_PROFILE, ...profile }
}

export const __setTokens = (tokens: Partial<ZaloTokens>): void => {
  state.tokens = { ...DEFAULT_TOKENS, ...tokens }
}

export const __setRefreshTokenValid = (valid: boolean): void => {
  state.refreshTokenValid = valid
}

export const __setInstallReport = (report: Partial<ZaloInstallReport>): void => {
  state.installReport = { ...state.installReport, ...report }
}

export const __setApplicationHashKey = (hashKey: string | null): void => {
  state.hashKey = hashKey
}

/**
 * Lời gọi TIẾP THEO của một hàm CÓ THỂ reject sẽ ném `ZaloError` này.
 *
 * `logout()`, `isRefreshTokenValid()` và `getApplicationHashKey()` không bao giờ reject nên
 * chúng KHÔNG tiêu thụ lỗi đang armed - nếu tiêu thụ thì
 * `__failNextWith('X'); await logout(); await login()` sẽ khiến `login` thành công bất ngờ.
 */
export const __failNextWith = (
  code: ZaloErrorCode,
  message = `mock: ${code}`,
  details: ZaloErrorDetails = {},
): void => {
  state.nextFailure = { code, message, details }
}

/** Bắn sự kiện `oauthCodeReceived` tới mọi listener đang đăng ký. */
export const __emitOauthCodeReceived = (attemptId = 'mock-attempt'): void => {
  for (const listener of state.listeners) listener({ attemptId })
}

/** Đọc lại các tham số đã được truyền vào - để assert `via`, `timeoutMs`, `fields`... */
export const __getCalls = (): MockState['calls'] => state.calls

// ── bề mặt công khai, khớp `src/index.ts` ─────────────────────────────────────

export const login = async (options: ZaloLoginOptions = {}): Promise<ZaloLoginResult> => {
  state.calls.login.push(options)
  await rejectIfArmed()
  return state.loginResult
}

export const exchangeOAuthCode = async (
  _oauthCode: string,
  _codeVerifier: string,
): Promise<ZaloTokens> => {
  await rejectIfArmed()
  return state.tokens
}

export const refreshTokens = async (_refreshToken: string): Promise<ZaloTokens> => {
  await rejectIfArmed()
  return state.tokens
}

/** Không bao giờ reject - giống bản thật. KHÔNG tiêu thụ lỗi đang armed. */
export const isRefreshTokenValid = async (refreshToken: string): Promise<boolean> =>
  refreshToken.length > 0 && state.refreshTokenValid

/** Không bao giờ reject - giống bản thật. KHÔNG tiêu thụ lỗi đang armed. */
export const logout = async (): Promise<void> => {
  state.calls.logout += 1
}

export const getProfile = async (options: ZaloProfileOptions = {}): Promise<ZaloProfile> => {
  state.calls.getProfile.push(options)
  await rejectIfArmed()
  return state.profile
}

export const verifyInstallation = async (): Promise<ZaloInstallReport> => {
  await rejectIfArmed()
  return state.installReport
}

/** Không bao giờ ném - giống bản thật. KHÔNG tiêu thụ lỗi đang armed. */
export const getApplicationHashKey = async (): Promise<string | null> => state.hashKey

export const getSdkVersion = async (): Promise<ZaloSdkVersion> => {
  await rejectIfArmed()
  return { toolkit: '0.1.0-mock', native: 'mock' }
}

export const addListener = (
  event: ZaloEventName,
  listener: ZaloEventListener,
): ZaloSubscription => {
  if (event !== ZaloEventName.OAUTH_CODE_RECEIVED) {
    throw new ZaloError(ZaloErrorCode.UNKNOWN, `rn-zalo-toolkit: sự kiện không tồn tại "${String(event)}"`, {
      phase: 'config',
    })
  }
  state.listeners.add(listener)
  return {
    remove: () => {
      state.listeners.delete(listener)
    },
  }
}
