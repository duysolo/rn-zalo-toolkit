/**
 * Mô phỏng tầng native ở mức HỢP ĐỒNG THẬT, không phải ở mức tiện cho test.
 *
 * Nghĩa là: vào/ra bằng JSON string đúng như spec, và reject bằng đúng hình dạng mà
 * React Native dựng lại từ `promise.reject(code, message, userInfo)`. Nhờ vậy test đi qua
 * chính đoạn parse/normalize mà máy thật sẽ đi - nếu đoạn đó sai thì test đỏ, chứ không
 * phải "xanh ở CI, đỏ trên thiết bị".
 */

export interface NativeRejectionShape {
  code: string
  message: string
  userInfo: { details: string }
}

export const nativeReject = (
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): NativeRejectionShape => ({
  code,
  message,
  userInfo: { details: JSON.stringify(details) },
})

export const createNativeMock = () => {
  const listeners = new Set<(payload: { attemptId: string }) => void>()

  return {
    login: jest.fn(async (_optionsJson: string) =>
      JSON.stringify({
        exchange: 'device',
        oauthCode: 'code-1',
        accessToken: 'access-1',
        expiresAt: 4102444800000,
        channel: 'zalo',
        isNewUser: false,
      }),
    ),
    exchangeOAuthCode: jest.fn(async (_code: string, _verifier: string) =>
      JSON.stringify({ accessToken: 'a', refreshToken: 'r', expiresAt: 1 }),
    ),
    refreshTokens: jest.fn(async (_refreshToken: string) =>
      JSON.stringify({ accessToken: 'a2', refreshToken: 'r2', expiresAt: 2 }),
    ),
    isRefreshTokenValid: jest.fn(async (_refreshToken: string) => true),
    logout: jest.fn(async () => undefined),
    getProfile: jest.fn(async (_optsJson: string) =>
      JSON.stringify({
        id: 'zid',
        name: 'Tên',
        picture: { url: 'https://example.invalid/a.png' },
        birthday: null,
        gender: null,
        phoneNumber: null,
        raw: { id: 'zid' },
      }),
    ),
    verifyInstallation: jest.fn(async () =>
      JSON.stringify({
        ok: true,
        platform: 'android',
        appId: '123',
        nativeSdkVersion: '4.24.1101',
        issues: [],
        details: { zaloAppInstalled: true },
      }),
    ),
    getApplicationHashKey: jest.fn(async () => 'hash=='),
    getSdkVersion: jest.fn(async () =>
      JSON.stringify({ toolkit: '0.1.0', native: '4.24.1101' }),
    ),
    onOauthCodeReceived: jest.fn((listener: (payload: { attemptId: string }) => void) => {
      listeners.add(listener)
      return { remove: () => listeners.delete(listener) }
    }),
    __emit: (attemptId = 'attempt-1') => {
      for (const listener of listeners) listener({ attemptId })
    },
    __listenerCount: () => listeners.size,
  }
}

export type NativeMock = ReturnType<typeof createNativeMock>
