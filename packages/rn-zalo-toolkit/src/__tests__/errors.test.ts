import { ZaloError, zaloErrorFrom, isZaloErrorCode } from '../errors'

describe('ZaloError', () => {
  it('giữ được instanceof sau khi transpile', () => {
    const error = new ZaloError('CANCELLED', 'huỷ')
    expect(error).toBeInstanceOf(ZaloError)
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('ZaloError')
  })

  it('ZaloError.is lọc theo mã', () => {
    const error = new ZaloError('TIMEOUT', 'hết giờ')
    expect(ZaloError.is(error)).toBe(true)
    expect(ZaloError.is(error, 'TIMEOUT')).toBe(true)
    expect(ZaloError.is(error, 'CANCELLED')).toBe(false)
    expect(ZaloError.is(new Error('khác'))).toBe(false)
    expect(ZaloError.is(null)).toBe(false)
  })

  it('phase mặc định là authorize', () => {
    expect(new ZaloError('UNKNOWN', 'x').phase).toBe('authorize')
  })
})

describe('zaloErrorFrom', () => {
  it('dựng lại đầy đủ từ userInfo.details', () => {
    const error = zaloErrorFrom(
      {
        code: 'INVALID_CONFIG',
        message: 'Hash key chưa được đăng ký trên Zalo portal',
        userInfo: {
          details: JSON.stringify({
            phase: 'config',
            nativeCode: -5008,
            nativeMessage: 'invalid android signkey',
            signatureHashKey: 'wPx3lPXQIBf/WDEx6jMC1TZa0+k=',
            packageName: 'vn.estations.app',
          }),
        },
      },
      'authorize',
    )

    expect(error.code).toBe('INVALID_CONFIG')
    expect(error.phase).toBe('config')
    expect(error.nativeCode).toBe(-5008)
    expect(error.signatureHashKey).toBe('wPx3lPXQIBf/WDEx6jMC1TZa0+k=')
    expect(error.packageName).toBe('vn.estations.app')
    // message phải là câu đọc được: cả hai app tiêu thụ bung thẳng nó ra alert.
    expect(error.message).toBe('Hash key chưa được đăng ký trên Zalo portal')
  })

  it('mã lạ từ native rơi về UNKNOWN thay vì làm vỡ kiểu', () => {
    const error = zaloErrorFrom({ code: 'SOMETHING_NEW', message: 'lạ' }, 'exchange')
    expect(error.code).toBe('UNKNOWN')
    expect(error.phase).toBe('exchange')
  })

  it('details không phải JSON thì bỏ qua, không ném', () => {
    const error = zaloErrorFrom(
      { code: 'NETWORK', message: 'mất mạng', userInfo: { details: 'không-phải-json' } },
      'authorize',
    )
    expect(error.code).toBe('NETWORK')
    expect(error.nativeCode).toBeUndefined()
  })

  it('nuốt được cả giá trị hoàn toàn lạ', () => {
    for (const weird of [null, undefined, 42, 'chuỗi', [], new Error('boom')]) {
      const error = zaloErrorFrom(weird, 'profile')
      expect(error).toBeInstanceOf(ZaloError)
      expect(error.code).toBe('UNKNOWN')
    }
  })

  it('trả nguyên ZaloError nếu đã là ZaloError', () => {
    const original = new ZaloError('CANCELLED', 'huỷ', { phase: 'authorize' })
    expect(zaloErrorFrom(original, 'profile')).toBe(original)
  })

  /**
   * Quy tắc nội dung lỗi (bất biến). Đường đi của chuỗi này là có thật:
   * một app tiêu thụ bung `message` ra alert cho user VÀ persist mọi WARN/ERROR xuống file
   * trên đĩa ở production; app còn lại đẩy `error.message` lên Crashlytics.
   */
  it('KHÔNG rò bí mật ra bất kỳ trường nào của lỗi', () => {
    const secrets = {
      accessToken: 'SECRET_ACCESS_TOKEN',
      refreshToken: 'SECRET_REFRESH_TOKEN',
      oauthCode: 'SECRET_OAUTH_CODE',
      codeVerifier: 'SECRET_CODE_VERIFIER',
    }

    // Điều duy nhất được phép có trong lỗi là định danh cấu hình CÔNG KHAI.
    const error = zaloErrorFrom(
      {
        code: 'TOKEN_EXCHANGE_FAILED',
        message: 'Không đổi được oauth code lấy access token',
        userInfo: {
          details: JSON.stringify({
            phase: 'exchange',
            nativeCode: -5020,
            nativeMessage: 'invalid oauth code',
            packageName: 'vn.estations.app',
          }),
        },
      },
      'exchange',
    )

    const serialised = JSON.stringify({
      message: error.message,
      nativeMessage: error.nativeMessage,
      signatureHashKey: error.signatureHashKey,
      packageName: error.packageName,
      stack: error.stack,
    })

    for (const secret of Object.values(secrets)) {
      expect(serialised).not.toContain(secret)
    }
  })
})

describe('isZaloErrorCode', () => {
  it('nhận đúng mã và từ chối phần còn lại', () => {
    expect(isZaloErrorCode('CANCELLED')).toBe(true)
    expect(isZaloErrorCode('cancelled')).toBe(false)
    expect(isZaloErrorCode(undefined)).toBe(false)
    expect(isZaloErrorCode(-7008)).toBe(false)
  })
})
