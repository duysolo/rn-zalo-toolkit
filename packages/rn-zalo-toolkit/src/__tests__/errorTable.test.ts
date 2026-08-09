import table from '../errorTable.json'
import { isZaloErrorCode, zaloErrorCodes } from '../errors'

type Row = {
  native: number
  platform: 'android' | 'ios' | 'both'
  symbol: string
  code: string
  phase: string
  note?: string
}

const rows = table.codes as Row[]

describe('errorTable.json', () => {
  it('mọi `code` đều nằm trong union ZaloErrorCode', () => {
    const invalid = rows.filter(row => !isZaloErrorCode(row.code))
    expect(invalid.map(r => `${r.native}:${r.code}`)).toEqual([])
  })

  it('mọi `phase` đều hợp lệ', () => {
    const phases = new Set(['config', 'authorize', 'exchange', 'profile'])
    const invalid = rows.filter(row => !phases.has(row.phase))
    expect(invalid.map(r => `${r.native}:${r.phase}`)).toEqual([])
  })

  it('mọi `platform` đều hợp lệ', () => {
    const platforms = new Set(['android', 'ios', 'both'])
    const invalid = rows.filter(row => !platforms.has(row.platform))
    expect(invalid.map(r => `${r.native}:${r.platform}`)).toEqual([])
  })

  it('không có cặp (native, platform) trùng lặp - trùng là một trong hai dòng chết im lặng', () => {
    const seen = new Map<string, Row>()
    const duplicates: string[] = []
    for (const row of rows) {
      const key = `${row.native}@${row.platform}`
      if (seen.has(key)) duplicates.push(key)
      seen.set(key, row)
    }
    expect(duplicates).toEqual([])
  })

  it('không có dòng `both` nào đè lên dòng riêng nền tảng của cùng một mã', () => {
    const specific = new Set(
      rows.filter(r => r.platform !== 'both').map(r => `${r.native}@${r.platform}`),
    )
    const conflicting = rows
      .filter(r => r.platform === 'both')
      .filter(r => specific.has(`${r.native}@android`) || specific.has(`${r.native}@ios`))
      .map(r => r.native)
    expect(conflicting).toEqual([])
  })

  /**
   * Đây là bài test quan trọng nhất của file.
   *
   * `-7014` và `-7015` là hai mã mà Android và iOS dùng cho những chuyện HOÀN TOÀN khác nhau.
   * Bất kỳ ai gộp hai nền tảng vào một bảng sẽ khiến người dùng Android chưa cài Zalo nhận
   * thông báo "xác thực thất bại", và người dùng iOS bị rate-limit nhận "Zalo bản cũ".
   *
   * Nguồn: `javap -constants com.zing.zalo.zalosdk.ZaloOAuthResultCode` (sdk-core 4.24.1101)
   *        vs `ZDKZaloError.h:28,32` (pod 4.1.0120).
   */
  it.each([
    [-7014, 'ZALO_NOT_INSTALLED', 'UNKNOWN'],
    [-7015, 'ZALO_OUT_OF_DATE', 'RATE_LIMITED'],
  ])('mã %i map KHÁC NHAU giữa Android và iOS', (native, androidCode, iosCode) => {
    const android = rows.find(r => r.native === native && r.platform === 'android')
    const ios = rows.find(r => r.native === native && r.platform === 'ios')

    expect(android).toBeDefined()
    expect(ios).toBeDefined()
    expect(android?.code).toBe(androidCode)
    expect(ios?.code).toBe(iosCode)
    expect(android?.code).not.toBe(ios?.code)
  })

  it('mọi mã huỷ của Android đều có mặt - thiếu là cancel rơi vào UNKNOWN', () => {
    const androidCancels = rows
      .filter(r => r.code === 'CANCELLED' && (r.platform === 'android' || r.platform === 'both'))
      .map(r => r.native)
    expect(androidCancels).toEqual(expect.arrayContaining([-7008, -7009]))
  })

  it('mọi mã huỷ của iOS đều có mặt, kể cả -1001 không có trong header', () => {
    const iosCancels = rows
      .filter(r => r.code === 'CANCELLED' && (r.platform === 'ios' || r.platform === 'both'))
      .map(r => r.native)
    expect(iosCancels).toEqual(expect.arrayContaining([-7021, -7035, -1011, -1005, -1001]))
  })

  it('có mã -501 cho việc Zalo chặn IP ngoài Việt Nam', () => {
    const row = rows.find(r => r.native === -501)
    expect(row?.code).toBe('PROFILE_RESTRICTED')
    expect(row?.phase).toBe('profile')
  })

  it('mỗi ZaloErrorCode do native sinh ra đều được ít nhất một dòng phủ', () => {
    // Ba mã dưới đây do CHÍNH thư viện sinh, không đến từ bảng của Zalo.
    const producedByToolkit = new Set(['LOGIN_IN_PROGRESS', 'NOT_WIRED', 'TOKEN_EXCHANGE_FAILED'])
    const covered = new Set(rows.map(r => r.code))
    const missing = zaloErrorCodes.filter(
      code => !covered.has(code) && !producedByToolkit.has(code),
    )
    expect(missing).toEqual([])
  })
})
