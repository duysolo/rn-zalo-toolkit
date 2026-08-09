import { createNativeMock, nativeReject, type NativeMock } from './nativeMock'

let native: NativeMock

jest.mock('../specs/NativeRnZaloToolkit', () => ({
  __esModule: true,
  get default() {
    return native
  },
}))

// Import SAU jest.mock để không kéo `react-native` thật vào môi trường node.
import {
  ZaloError,
  addListener,
  exchangeOAuthCode,
  getApplicationHashKey,
  getProfile,
  getSdkVersion,
  isRefreshTokenValid,
  login,
  logout,
  refreshTokens,
  verifyInstallation,
} from '../index'

beforeEach(() => {
  native = createNativeMock()
})

describe('login', () => {
  it('serialise options thành JSON và parse kết quả', async () => {
    const result = await login({ via: 'web', timeoutMs: 90_000 })

    expect(native.login).toHaveBeenCalledWith(JSON.stringify({ via: 'web', timeoutMs: 90_000 }))
    expect(result).toEqual({
      exchange: 'device',
      oauthCode: 'code-1',
      accessToken: 'access-1',
      expiresAt: 4102444800000,
      channel: 'zalo',
      isNewUser: false,
    })
  })

  it('gọi không tham số vẫn truyền chuỗi JSON hợp lệ, không phải undefined', async () => {
    await login()
    expect(native.login).toHaveBeenCalledWith('{}')
  })

  it('nhánh device đảm bảo có accessToken ở mức KIỂU - không cần if (!accessToken) throw', async () => {
    const result = await login()
    // Thu hẹp kiểu bằng discriminant, không bằng optional chaining.
    if (result.exchange !== 'device') throw new Error('phải là nhánh device')
    const token: string = result.accessToken
    expect(token).toBe('access-1')
  })

  it('nhánh none trả codeVerifier và KHÔNG có accessToken', async () => {
    native.login.mockResolvedValueOnce(
      JSON.stringify({
        exchange: 'none',
        oauthCode: 'code-2',
        codeVerifier: 'verifier-2',
        channel: 'zalo',
        isNewUser: true,
      }),
    )

    const result = await login({ exchange: 'none' })
    if (result.exchange !== 'none') throw new Error('phải là nhánh none')
    expect(result.codeVerifier).toBe('verifier-2')
    expect('accessToken' in result).toBe(false)
  })

  it('chuẩn hoá reject của native thành ZaloError đầy đủ', async () => {
    native.login.mockRejectedValueOnce(
      nativeReject('ZALO_NOT_INSTALLED', 'Chưa cài ứng dụng Zalo trên máy này', {
        phase: 'authorize',
        nativeCode: -7014,
        nativeMessage: 'ERR_ZALO_APP_NOT_INSTALLED',
      }),
    )

    await expect(login({ via: 'app' })).rejects.toMatchObject({
      code: 'ZALO_NOT_INSTALLED',
      phase: 'authorize',
      nativeCode: -7014,
      message: 'Chưa cài ứng dụng Zalo trên máy này',
    })
  })

  it('huỷ là ZaloError CANCELLED, không phải một loại lỗi riêng', async () => {
    native.login.mockRejectedValueOnce(
      nativeReject('CANCELLED', 'Người dùng đã huỷ', { nativeCode: -7008 }),
    )

    // Người gọi chỉ cần biết MỘT loại lỗi và MỘT tập mã - không phải nhớ tên class riêng
    // cho từng nhánh như `ZaloCancelledError` mà hai app tiêu thụ đang phải tự định nghĩa.
    const error = await login().catch((e: unknown) => e)
    expect(ZaloError.is(error, 'CANCELLED')).toBe(true)
    expect((error as ZaloError).nativeCode).toBe(-7008)
  })

  it('native trả JSON hỏng vẫn ra ZaloError chứ không ném SyntaxError', async () => {
    native.login.mockResolvedValueOnce('<không phải json>')
    await expect(login()).rejects.toBeInstanceOf(ZaloError)
  })
})

describe('isRefreshTokenValid', () => {
  it('resolve false thay vì reject khi native ném', async () => {
    native.isRefreshTokenValid.mockRejectedValueOnce(nativeReject('INVALID_TOKEN', 'hỏng'))
    await expect(isRefreshTokenValid('rác')).resolves.toBe(false)
  })

  it('truyền thẳng giá trị native trả về - cả true lẫn false', async () => {
    // Hai ca. Chỉ assert `false` thì một cài đặt `return false` cứng cũng pass.
    native.isRefreshTokenValid.mockResolvedValueOnce(false)
    await expect(isRefreshTokenValid('x')).resolves.toBe(false)

    native.isRefreshTokenValid.mockResolvedValueOnce(true)
    await expect(isRefreshTokenValid('y')).resolves.toBe(true)
  })
})

describe('logout', () => {
  it('không bao giờ reject, kể cả khi native ném', async () => {
    native.logout.mockRejectedValueOnce(nativeReject('UNKNOWN', 'boom'))
    await expect(logout()).resolves.toBeUndefined()
  })
})

describe('getApplicationHashKey', () => {
  it('trả null thay vì ném khi native không hỗ trợ', async () => {
    native.getApplicationHashKey.mockRejectedValueOnce(new Error('iOS'))
    await expect(getApplicationHashKey()).resolves.toBeNull()
  })
})

describe('getProfile', () => {
  /**
   * BỎ HẲN khoá khi vắng mặt - KHÔNG gửi `null`.
   *
   * `JSONObject.optString(key)` trên Android trả về chuỗi `"null"` (4 ký tự) cho JSON null
   * chứ không phải chuỗi rỗng. Bản đầu gửi `accessToken: null` và native đọc bằng
   * `optString(...).ifEmpty { session }` ⇒ nhánh fallback KHÔNG BAO GIỜ chạy, và SDK bị gọi
   * với token là chuỗi `"null"`. Native giờ đã dùng `isNull()`, nhưng không gửi khoá thì
   * không có gì để hiểu nhầm ngay từ đầu.
   */
  it('BỎ khoá khi vắng mặt, không gửi null', async () => {
    await getProfile()
    expect(native.getProfile).toHaveBeenCalledWith('{}')
  })

  it('chỉ truyền khoá thật sự có', async () => {
    await getProfile({ fields: ['id', 'name'] })
    expect(native.getProfile).toHaveBeenCalledWith(JSON.stringify({ fields: ['id', 'name'] }))
  })

  it('truyền accessToken khi app tự giữ token', async () => {
    await getProfile({ accessToken: 'tok' })
    expect(native.getProfile).toHaveBeenCalledWith(JSON.stringify({ accessToken: 'tok' }))
  })

  it('lỗi chặn IP ngoài Việt Nam ra đúng mã PROFILE_RESTRICTED', async () => {
    native.getProfile.mockRejectedValueOnce(
      nativeReject(
        'PROFILE_RESTRICTED',
        'Zalo giới hạn thông tin cá nhân với IP ngoài Việt Nam',
        { phase: 'profile', nativeCode: -501 },
      ),
    )

    await expect(getProfile()).rejects.toMatchObject({
      code: 'PROFILE_RESTRICTED',
      phase: 'profile',
      nativeCode: -501,
    })
  })
})

describe('các hàm còn lại', () => {
  it('exchangeOAuthCode / refreshTokens parse JSON', async () => {
    await expect(exchangeOAuthCode('c', 'v')).resolves.toEqual({
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: 1,
    })
    await expect(refreshTokens('r')).resolves.toEqual({
      accessToken: 'a2',
      refreshToken: 'r2',
      expiresAt: 2,
    })
  })

  it('verifyInstallation / getSdkVersion parse JSON', async () => {
    await expect(verifyInstallation()).resolves.toMatchObject({ ok: true, platform: 'android' })
    await expect(getSdkVersion()).resolves.toEqual({ toolkit: '0.1.0', native: '4.24.1101' })
  })
})

describe('addListener', () => {
  it('đăng ký, nhận payload, và huỷ đăng ký được', () => {
    const listener = jest.fn()
    const subscription = addListener('oauthCodeReceived', listener)

    native.__emit('attempt-xyz')
    expect(listener).toHaveBeenCalledTimes(1)
    // Payload phải tới được người gọi - native chỉ emit cho phiên còn sống, nhưng app vẫn
    // cần `attemptId` nếu muốn tự ghép sự kiện với lần `login()` của mình.
    expect(listener).toHaveBeenCalledWith({ attemptId: 'attempt-xyz' })

    subscription.remove()
    native.__emit()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(native.__listenerCount()).toBe(0)
  })

  it('sự kiện không tồn tại thì ném ZaloError chứ không im lặng', () => {
    expect(() => addListener('không-có' as 'oauthCodeReceived', jest.fn())).toThrow(ZaloError)
  })
})
