/**
 * Bản mock ship kèm phải giữ ĐÚNG hợp đồng của bản thật, nếu không nó chỉ dịch chuyển
 * chỗ sai từ app sang thư viện.
 */
// `../index` kéo theo spec TurboModule, mà spec import `react-native` - thứ không nạp được
// trong môi trường node. Mock spec để so sánh được bề mặt export của hai bản.
jest.mock('../specs/NativeRnZaloToolkit', () => ({ __esModule: true, default: {} }))

import * as mock from '../jest'
import { ZaloError } from '../errors'

beforeEach(() => {
  mock.__reset()
})

describe('rn-zalo-toolkit/jest', () => {
  it('phơi đúng những export mà bản thật phơi', async () => {
    const real = await import('../index')
    const realNames = Object.keys(real).sort()
    const mockNames = Object.keys(mock)

    const missing = realNames.filter(name => !mockNames.includes(name))
    expect(missing).toEqual([])
  })

  it('login trả kết quả mặc định dùng được ngay', async () => {
    const result = await mock.login()
    expect(result.exchange).toBe('device')
    expect(result.oauthCode).toBeTruthy()
  })

  it('__failNextWith chỉ ảnh hưởng ĐÚNG một lời gọi', async () => {
    mock.__failNextWith('ZALO_OUT_OF_DATE')
    await expect(mock.login()).rejects.toBeInstanceOf(ZaloError)
    await expect(mock.login()).resolves.toMatchObject({ exchange: 'device' })
  })

  it('logout và isRefreshTokenValid KHÔNG reject, kể cả khi đã armed lỗi', async () => {
    mock.__failNextWith('UNKNOWN')
    await expect(mock.logout()).resolves.toBeUndefined()

    mock.__failNextWith('UNKNOWN')
    await expect(mock.isRefreshTokenValid('token')).resolves.toBe(true)
  })

  it('isRefreshTokenValid trả false với token rỗng', async () => {
    await expect(mock.isRefreshTokenValid('')).resolves.toBe(false)
  })

  it('getApplicationHashKey không ném', async () => {
    mock.__failNextWith('UNKNOWN')
    await expect(mock.getApplicationHashKey()).resolves.toBeTruthy()
  })

  it('__getCalls cho phép assert tham số đã truyền', async () => {
    await mock.login({ via: 'web' })
    await mock.getProfile({ fields: ['id'] })
    expect(mock.__getCalls().login).toEqual([{ via: 'web' }])
    expect(mock.__getCalls().getProfile).toEqual([{ fields: ['id'] }])
  })

  it('__emitOauthCodeReceived bắn tới listener đang đăng ký', () => {
    const listener = jest.fn()
    const subscription = mock.addListener('oauthCodeReceived', listener)

    mock.__emitOauthCodeReceived()
    expect(listener).toHaveBeenCalledTimes(1)

    subscription.remove()
    mock.__emitOauthCodeReceived()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('__reset xoá cả listener lẫn lỗi đang armed', async () => {
    const listener = jest.fn()
    mock.addListener('oauthCodeReceived', listener)
    mock.__failNextWith('TIMEOUT')

    mock.__reset()

    mock.__emitOauthCodeReceived()
    expect(listener).not.toHaveBeenCalled()
    await expect(mock.login()).resolves.toBeDefined()
  })

  it("exchange:'none' không được kèm accessToken - đó là hình dạng native không bao giờ trả về", async () => {
    mock.__setLoginResult({ exchange: 'none' })
    const result = await mock.login()

    expect(result.exchange).toBe('none')
    expect('accessToken' in result).toBe(false)
    expect('expiresAt' in result).toBe(false)
    expect('refreshToken' in result).toBe(false)
    expect(result.oauthCode).toBeTruthy()
  })

  it('vẫn ép được accessToken lên exchange:none nếu test cố tình muốn dựng ca lạ', async () => {
    mock.__setLoginResult({ exchange: 'none', accessToken: 'x' } as never)
    const result = await mock.login()

    expect((result as { accessToken?: string }).accessToken).toBe('x')
  })
})
