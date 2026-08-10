/**
 * Enum phải tồn tại ở RUNTIME, không chỉ ở tầng type.
 *
 * Chúng được khai bằng `export const X = {...} as const` cộng `export type X = ...`. Nếu ai đó
 * sửa export thành `type X` (rất dễ, vì IDE hay tự thêm khi chỉ thấy chỗ dùng làm type) thì
 * TypeScript vẫn xanh trong repo này, nhưng app tiêu thụ viết `ZaloErrorCode.CANCELLED` sẽ chết
 * lúc chạy với "Cannot read properties of undefined". Bộ test này chặn đúng ca đó.
 */
import errorTable from '../errorTable.json'
import { ZaloErrorCode, ZaloErrorPhase, zaloErrorCodes } from '../errors'
import {
  ZaloChannel,
  ZaloEventName,
  ZaloExchangeMode,
  ZaloInstallIssueCode,
  ZaloIssueSeverity,
  ZaloLoginVia,
  ZaloPlatform,
} from '../types'

describe('enum có mặt ở runtime', () => {
  const enums = {
    ZaloErrorCode,
    ZaloErrorPhase,
    ZaloLoginVia,
    ZaloExchangeMode,
    ZaloChannel,
    ZaloPlatform,
    ZaloEventName,
    ZaloInstallIssueCode,
    ZaloIssueSeverity,
  }

  it.each(Object.entries(enums))('%s là object có ít nhất một thành viên', (_name, value) => {
    expect(typeof value).toBe('object')
    expect(value).not.toBeNull()
    expect(Object.keys(value).length).toBeGreaterThan(0)
  })

  it.each(Object.entries(enums))('%s chỉ chứa giá trị string', (_name, value) => {
    for (const member of Object.values(value)) expect(typeof member).toBe('string')
  })

  it.each(Object.entries(enums))('%s không có giá trị trùng nhau', (_name, value) => {
    const values = Object.values(value)
    expect(new Set(values).size).toBe(values.length)
  })
})

describe('enum khớp với nguồn dữ liệu', () => {
  it('ZaloErrorCode phủ đúng `zaloErrorCodes`, không thừa không thiếu', () => {
    expect(Object.values(ZaloErrorCode).sort()).toEqual([...zaloErrorCodes].sort())
  })

  it('mọi code trong errorTable.json đều là thành viên của ZaloErrorCode', () => {
    const declared = new Set<string>(Object.values(ZaloErrorCode))

    for (const entry of errorTable.codes) {
      expect(declared.has(entry.code)).toBe(true)
    }
  })

  it('mọi phase trong errorTable.json đều là thành viên của ZaloErrorPhase', () => {
    const declared = new Set<string>(Object.values(ZaloErrorPhase))

    for (const entry of errorTable.codes) {
      expect(declared.has(entry.phase)).toBe(true)
    }
  })

  /**
   * `platform` trong errorTable.json KHÔNG phải `ZaloPlatform`.
   *
   * `ZaloPlatform` trả lời "báo cáo chẩn đoán này sinh ra ở đâu" nên chỉ có ios/android.
   * Còn ở đây nó trả lời "dòng mapping này áp dụng cho nền tảng nào", và có thêm `both` cho
   * các native code mà hai SDK dùng cùng một nghĩa. Gộp hai khái niệm lại là đúng cái bẫy
   * đã sinh ra vụ -7014/-7015, nên test giữ chúng tách bạch một cách có chủ đích.
   */
  const TABLE_SCOPES = [ZaloPlatform.ANDROID, ZaloPlatform.IOS, 'both'] as const

  it('mọi platform trong errorTable.json đều nằm trong tập scope hợp lệ', () => {
    const declared = new Set<string>(TABLE_SCOPES)

    for (const entry of errorTable.codes) {
      expect(declared.has(entry.platform)).toBe(true)
    }
  })

  it('key của ZaloErrorCode trùng luôn với giá trị - tra ngược được', () => {
    for (const [key, value] of Object.entries(ZaloErrorCode)) expect(key).toBe(value)
  })
})
