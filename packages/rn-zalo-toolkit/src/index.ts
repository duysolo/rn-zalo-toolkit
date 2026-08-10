/**
 * `rn-zalo-toolkit` - đăng nhập Zalo cho React Native.
 *
 * PHẠM VI: **chỉ xác thực**. Không có share/feed/message, không login qua
 * Facebook/Apple/Google, không guest login. Đó là giới hạn có chủ đích, không phải
 * "chưa làm".
 *
 * HAI ĐẢM BẢO mà thư viện này tồn tại để cung cấp:
 *   1. Mọi lời gọi đều KẾT THÚC - mọi nhánh, có trần thời gian áp ở native.
 *      JS không bao giờ phải đoán trạng thái bằng `AppState`.
 *   2. Sai cấu hình LÊN TIẾNG - bằng lỗi đọc được, hoặc bằng build fail, không phải treo.
 */

import NativeZaloToolkit from './specs/NativeRnZaloToolkit'
import { ZaloError, ZaloErrorCode, ZaloErrorPhase, zaloErrorFrom } from './errors'
import { ZaloEventName } from './types'
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
} from './types'

export * from './types'
export {
  ZaloError,
  zaloErrorFrom,
  zaloErrorCodes,
  isZaloErrorCode,
  ZaloErrorCode,
  type ZaloErrorDetails,
  ZaloErrorPhase,
} from './errors'

/** Bọc lời gọi native: parse JSON kết quả, và chuẩn hoá MỌI lỗi thành `ZaloError`. */
const call = async <T>(phase: ZaloErrorPhase, run: () => Promise<string>): Promise<T> => {
  let raw: string
  try {
    raw = await run()
  } catch (error) {
    throw zaloErrorFrom(error, phase)
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    // Native trả chuỗi không phải JSON - lỗi lập trình của chính thư viện này, không phải
    // của người dùng. Vẫn phải là ZaloError để người gọi chỉ cần bắt một loại.
    throw new ZaloError(ZaloErrorCode.UNKNOWN, 'rn-zalo-toolkit: native trả về JSON không hợp lệ', {
      phase,
      nativeMessage: raw,
    })
  }
}

/**
 * Mở luồng đăng nhập Zalo.
 *
 * Reject `CANCELLED` khi người dùng huỷ - đó là kết quả BÌNH THƯỜNG, hãy nuốt nó ở tầng UI.
 * Nếu app của bạn đã có quy ước mã huỷ riêng (ví dụ `SIGN_IN_CANCELLED` dùng chung cho
 * Google/Apple), hãy **dịch** ở lớp service của app thay vì để mã của thư viện chảy lên UI.
 */
export const login = (options: ZaloLoginOptions = {}): Promise<ZaloLoginResult> =>
  call<ZaloLoginResult>(ZaloErrorPhase.AUTHORIZE, () => NativeZaloToolkit.login(JSON.stringify(options)))

/**
 * Đổi `oauthCode` lấy token. Chỉ cần khi dùng `login({ exchange: 'none' })`.
 *
 * `codeVerifier` là bí mật một lần của phiên PKCE: đừng log, đừng lưu, đổi ngay.
 */
export const exchangeOAuthCode = (oauthCode: string, codeVerifier: string): Promise<ZaloTokens> =>
  call<ZaloTokens>(ZaloErrorPhase.EXCHANGE, () => NativeZaloToolkit.exchangeOAuthCode(oauthCode, codeVerifier))

/** Lấy access token mới từ refresh token do app tự lưu. */
export const refreshTokens = (refreshToken: string): Promise<ZaloTokens> =>
  call<ZaloTokens>(ZaloErrorPhase.EXCHANGE, () => NativeZaloToolkit.refreshTokens(refreshToken))

/**
 * Hỏi xem refresh token còn dùng được không.
 *
 * Resolve `false` - KHÔNG reject - khi token rỗng, rác hoặc hết hạn. Trả lời một câu hỏi
 * boolean thì không được bắt người gọi viết `try/catch`.
 *
 * Thư viện KHÔNG lưu token xuống đĩa, nên `refreshToken` phải do app tự giữ. Nếu app bạn
 * không giữ nó (cả hai app tiêu thụ hiện tại đều không), hàm này không dùng tới.
 */
export const isRefreshTokenValid = async (refreshToken: string): Promise<boolean> => {
  try {
    return await NativeZaloToolkit.isRefreshTokenValid(refreshToken)
  } catch {
    return false
  }
}

/** Xoá phiên Zalo. An toàn khi gọi lúc chưa đăng nhập; không bao giờ reject. */
export const logout = async (): Promise<void> => {
  try {
    await NativeZaloToolkit.logout()
  } catch {
    // Đăng xuất là thao tác dọn dẹp. Không có tình huống nào mà việc nó thất bại đáng làm
    // hỏng luồng đăng xuất của app.
  }
}

/**
 * Lấy hồ sơ Zalo.
 *
 * ⚠️ ĐỪNG ĐẶT HÀM NÀY TRÊN ĐƯỜNG BẮT BUỘC CỦA ĐĂNG NHẬP. `graph.zalo.me` chặn theo IP:
 * thiết bị ở ngoài Việt Nam luôn nhận `PROFILE_RESTRICTED`. Backend chạy IP Việt Nam thì
 * tự lấy được đúng hồ sơ đó từ `accessToken`. Hãy coi kết quả ở đây là dữ liệu hiển thị
 * sớm, còn nguồn danh tính là server.
 *
 * Không truyền `accessToken` thì dùng phiên `login()` gần nhất TRONG CÙNG process - thư
 * viện không persist gì xuống đĩa, nên sau khi app khởi động lại sẽ là `INVALID_TOKEN`.
 */
export const getProfile = (options: ZaloProfileOptions = {}): Promise<ZaloProfile> => {
  // Bỏ HẲN khoá khi vắng mặt, không gửi `null`.
  //
  // `JSONObject.optString(key)` trên Android trả về chuỗi `"null"` (4 ký tự) cho JSON null,
  // nên native phải dùng `isNull()` để phân biệt. Native đã xử lý đúng, nhưng không gửi
  // khoá thì không có gì để hiểu nhầm ngay từ đầu.
  const payload: { accessToken?: string; fields?: string[] } = {}
  if (options.accessToken !== undefined) payload.accessToken = options.accessToken
  if (options.fields !== undefined) payload.fields = options.fields
  return call<ZaloProfile>(ZaloErrorPhase.PROFILE, () => NativeZaloToolkit.getProfile(JSON.stringify(payload)))
}

/**
 * Kiểm cấu hình LOCAL và trả về báo cáo đọc được.
 *
 * Giới hạn phải biết trước khi tin nó:
 *   - Chỉ thấy cấu hình trên máy (Info.plist, manifest, chữ ký, appId). Nó KHÔNG biết
 *     Zalo portal đã đăng ký package/bundleId/hash key hay chưa - chuyện đó chỉ lộ khi
 *     login, và khi ấy lỗi `INVALID_CONFIG` sẽ kèm sẵn hash key để bạn dán lên portal.
 *   - Trên Android không phân biệt được "Zalo chưa cài" với "chưa khai package visibility".
 *
 * Đây là hàm chẩn đoán - hãy bọc `if (__DEV__)`, đừng gọi trong luồng runtime bản phát hành.
 */
export const verifyInstallation = (): Promise<ZaloInstallReport> =>
  call<ZaloInstallReport>(ZaloErrorPhase.CONFIG, () => NativeZaloToolkit.verifyInstallation())

/**
 * Android: `base64(SHA-1(chứng chỉ ký))` - đúng giá trị SDK gửi lên Zalo, dán thẳng lên
 * portal được. iOS: `null`.
 *
 * Không ném trên bất kỳ nền tảng nào, nên gọi vô điều kiện được.
 */
export const getApplicationHashKey = async (): Promise<string | null> => {
  try {
    return await NativeZaloToolkit.getApplicationHashKey()
  } catch {
    return null
  }
}

export const getSdkVersion = (): Promise<ZaloSdkVersion> =>
  call<ZaloSdkVersion>(ZaloErrorPhase.CONFIG, () => NativeZaloToolkit.getSdkVersion())

/**
 * Nghe sự kiện "đã có oauth code".
 *
 * Chỉ dùng để đổi nhãn loading ("đang lấy thông tin..."). API vẫn đúng khi không ai nghe -
 * đây KHÔNG phải cơ chế phát hiện huỷ.
 */
export const addListener = (
  event: ZaloEventName,
  listener: ZaloEventListener,
): ZaloSubscription => {
  if (event !== ZaloEventName.OAUTH_CODE_RECEIVED) {
    throw new ZaloError(ZaloErrorCode.UNKNOWN, `rn-zalo-toolkit: sự kiện không tồn tại "${String(event)}"`, {
      phase: 'config',
    })
  }
  // Truyền nguyên payload. Native chỉ emit cho phiên còn sống, nhưng `attemptId` vẫn hữu
  // ích khi app tự ghép sự kiện với lần gọi `login()` của mình.
  return NativeZaloToolkit.onOauthCodeReceived(payload => listener(payload))
}
