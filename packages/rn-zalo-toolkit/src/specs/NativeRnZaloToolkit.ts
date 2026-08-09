import { TurboModuleRegistry, type TurboModule } from 'react-native'
import type { EventEmitter } from 'react-native/Libraries/Types/CodegenTypes'

/**
 * Spec TurboModule - KHÔNG phải public API.
 *
 * Mọi thứ có hình dạng tự do đi qua JSON string, có chủ đích. Hai lý do, mỗi lý do đủ:
 *
 * 1. Codegen của React Native chỉ đỡ một tập kiểu hẹp. `Record<K, V>` không nằm trong
 *    `typeMap` của `parsers-primitives.js`, nên `emitCommonTypes` trả `null` và parser
 *    ném `UnsupportedGenericParserError` - **build chết**, không phải cảnh báo im lặng.
 * 2. Bridge ép số: `expiresAt` là epoch ms (vượt 2^31) và Zalo trả `uid` dạng số lớn.
 *    Đi qua map của bridge là có nguy cơ bị coerce thành double.
 *
 * Hệ quả: KHÔNG import kiểu nào từ `../types` vào file này. Kiểu công khai sống ở đó,
 * việc dịch JSON ↔ kiểu nằm ở `../index.ts`.
 *
 * Cũng KHÔNG có tham số optional nào: chỗ nào cần vắng mặt thì dùng `| null` tường minh.
 */
export interface Spec extends TurboModule {
  /**
   * `optionsJson`: `{ via, exchange, extInfo, timeoutMs, includeRefreshToken }`.
   * Luôn truyền chuỗi, `'{}'` nếu không có gì.
   * Trả JSON của `ZaloLoginResult`.
   */
  login(optionsJson: string): Promise<string>

  /** Trả JSON của `ZaloTokens`. */
  exchangeOAuthCode(oauthCode: string, codeVerifier: string): Promise<string>

  /** Trả JSON của `ZaloTokens`. */
  refreshTokens(refreshToken: string): Promise<string>

  /** Resolve `false` khi token rỗng/rác. KHÔNG BAO GIỜ reject vì "chưa đăng nhập". */
  isRefreshTokenValid(refreshToken: string): Promise<boolean>

  logout(): Promise<void>

  /**
   * `optsJson`: `{ accessToken: string | null, fields: string[] | null }`.
   * Trả JSON của `ZaloProfile`.
   */
  getProfile(optsJson: string): Promise<string>

  /** Trả JSON của `ZaloInstallReport`. */
  verifyInstallation(): Promise<string>

  /** Android: `base64(SHA-1(cert ký))`. iOS: `null`. Không bao giờ ném. */
  getApplicationHashKey(): Promise<string | null>

  /** Trả JSON của `ZaloSdkVersion`. */
  getSdkVersion(): Promise<string>

  /**
   * Fire khi SDK đã có oauth code, tức user ĐÃ hoàn tất đăng nhập và chỉ còn chờ đổi token
   * qua mạng. Chỉ để UI đổi nhãn loading.
   *
   * API vẫn ĐÚNG khi không ai nghe event này - nó không phải cơ chế phát hiện cancel như
   * bản vá cũ của `react-native-zalo-kit`. `attemptId` để bỏ event lạc của lần login đã
   * hết giờ.
   */
  readonly onOauthCodeReceived: EventEmitter<{ attemptId: string }>
}

export default TurboModuleRegistry.getEnforcing<Spec>('RnZaloToolkit')
