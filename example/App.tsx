/**
 * Example app cho `rn-zalo-toolkit`.
 *
 * Màn hình này cố tình bày ra ĐÚNG những nhánh mà thư viện tồn tại để xử lý, chứ không chỉ
 * đường hạnh phúc: huỷ, Zalo chưa cài, Zalo bản cũ, hết giờ, cấu hình sai. Mỗi nút chạy
 * một ô trong ma trận nghiệm thu.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import {
  ZaloError,
  addListener,
  getApplicationHashKey,
  getProfile,
  getSdkVersion,
  login,
  logout,
  verifyInstallation,
  type ZaloInstallReport,
} from 'rn-zalo-toolkit'

type LogLine = { at: string; text: string; tone: 'info' | 'ok' | 'warn' | 'err' }

/**
 * Che bí mật trước khi hiển thị hoặc ghi log.
 *
 * Kết quả `login()` chứa `accessToken`, `oauthCode` (và `refreshToken`/`codeVerifier` tuỳ
 * chế độ); `getProfile()` trả `raw` là PII. Example là thứ được copy-paste đầu tiên, nên nó
 * phải làm gương chứ không phải làm mẫu cho một thói quen xấu.
 */
const SECRET_KEYS = new Set([
  'accessToken',
  'refreshToken',
  'oauthCode',
  'codeVerifier',
  'phoneNumber',
  'birthday',
])

const redact = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redact)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      if (SECRET_KEYS.has(key) && typeof item === 'string') {
        return [key, item.length > 0 ? `<đã che, ${item.length} ký tự>` : '']
      }
      if (key === 'raw' && item && typeof item === 'object') {
        return [key, `<đã che, các khoá: ${Object.keys(item as object).join(', ')}>`]
      }
      return [key, redact(item)]
    }),
  )
}

export default function App(): React.JSX.Element {
  const isDark = useColorScheme() === 'dark'
  const [log, setLog] = useState<LogLine[]>([])
  const [busy, setBusy] = useState(false)

  const append = useCallback((text: string, tone: LogLine['tone'] = 'info') => {
    const at = new Date().toISOString().slice(11, 19)
    setLog(prev => [{ at, text, tone }, ...prev].slice(0, 60))
    // Prefix cố định để `adb logcat | grep` và `xcrun simctl spawn` lọc được.
    console.log(`[ZALO_DEMO] ${text}`)
  }, [])

  useEffect(() => {
    // Sự kiện này CHỈ để đổi nhãn loading. API vẫn đúng khi không ai nghe - nó không phải
    // cơ chế phát hiện huỷ như bản vá cũ của react-native-zalo-kit.
    const subscription = addListener('oauthCodeReceived', () => {
      append('đã có oauth code - đang đổi lấy token...', 'info')
    })
    return () => subscription.remove()
  }, [append])

  const run = useCallback(
    async (label: string, task: () => Promise<unknown>) => {
      if (busy) return
      setBusy(true)
      const startedAt = Date.now()
      append(`▶ ${label}`, 'info')
      try {
        const result = await task()
        append(
          `✔ ${label} (${Date.now() - startedAt}ms)\n${JSON.stringify(redact(result), null, 2)}`,
          'ok',
        )
      } catch (error) {
        const elapsed = Date.now() - startedAt
        if (ZaloError.is(error)) {
          // Huỷ là kết quả BÌNH THƯỜNG, không phải sự cố.
          const tone = error.code === 'CANCELLED' ? 'warn' : 'err'
          append(
            `${tone === 'warn' ? '⊘' : '✖'} ${label} (${elapsed}ms)\n` +
              `code=${error.code} phase=${error.phase} native=${error.nativeCode ?? '-'}\n` +
              `${error.message}` +
              (error.signatureHashKey ? `\nhash key: ${error.signatureHashKey}` : '') +
              (error.packageName ? `\npackage: ${error.packageName}` : ''),
            tone,
          )
        } else {
          append(`✖ ${label}: ${String(error)}`, 'err')
        }
      } finally {
        setBusy(false)
      }
    },
    [append, busy],
  )

  const actions = useMemo(
    () => [
      {
        label: 'Đăng nhập (app hoặc web)',
        run: () => run('login app_or_web', () => login({ via: 'app_or_web' })),
      },
      {
        label: 'Đăng nhập qua ứng dụng Zalo',
        hint: 'Chưa cài Zalo → phải ra ZALO_NOT_INSTALLED, KHÔNG được treo',
        run: () => run('login app', () => login({ via: 'app' })),
      },
      {
        label: 'Đăng nhập qua web',
        run: () => run('login web', () => login({ via: 'web' })),
      },
      {
        label: 'Hết giờ sau 5 giây',
        hint: 'Trần thời gian áp ở native, không phải setTimeout ở JS',
        run: () => run('login timeoutMs=5000', () => login({ timeoutMs: 5000 })),
      },
      {
        label: 'Gọi login() 2 lần liên tiếp',
        hint: 'Lần 2 phải ra LOGIN_IN_PROGRESS',
        run: () =>
          run('login x2', async () => {
            const first = login({ timeoutMs: 30000 })
            // Gắn handler NGAY, trước bất kỳ `await` nào - nếu không có một cửa sổ mà
            // promise thứ nhất reject khi chưa ai nghe (unhandled rejection).
            first.catch(() => undefined)
            return await login().catch((e: unknown) =>
              ZaloError.is(e) ? `lần 2: ${e.code}` : String(e),
            )
          }),
      },
      {
        label: 'Lấy hồ sơ',
        hint: 'Ngoài Việt Nam → PROFILE_RESTRICTED, và KHÔNG được làm hỏng đăng nhập',
        run: () => run('getProfile', () => getProfile()),
      },
      { label: 'Đăng xuất', run: () => run('logout', () => logout()) },
      {
        label: 'Kiểm cấu hình',
        // Hàm chẩn đoán - không có việc gì trong luồng runtime của bản phát hành.
        run: () =>
          run('verifyInstallation', async () => {
            if (!__DEV__) return { skipped: 'verifyInstallation chỉ chạy ở bản dev' }
            const report: ZaloInstallReport = await verifyInstallation()
            if (!report.ok) {
              report.issues.forEach(issue =>
                append(`  · [${issue.code}] ${issue.message}\n    → ${issue.fix}`, 'warn'),
              )
            }
            return report
          }),
      },
      {
        label: 'Hash key (Android)',
        hint: 'Dán đúng chuỗi này lên Zalo portal',
        run: () => run('getApplicationHashKey', () => getApplicationHashKey()),
      },
      { label: 'Phiên bản SDK', run: () => run('getSdkVersion', () => getSdkVersion()) },
    ],
    [append, run],
  )

  const theme = isDark ? darkTheme : lightTheme

  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.root, theme.root]}>
        <Text style={[styles.title, theme.text]}>rn-zalo-toolkit</Text>
        <Text style={[styles.subtitle, theme.dim]}>
          {Platform.OS === 'ios'
            ? 'iOS · SDK Zalo qua Swift Package, không CocoaPods'
            : 'Android · SDK Zalo pin cứng 4.24.1101'}
        </Text>

        <ScrollView style={styles.actions} contentContainerStyle={styles.actionsContent}>
          {actions.map(action => (
            <Pressable
              key={action.label}
              onPress={action.run}
              disabled={busy}
              style={({ pressed }) => [
                styles.button,
                theme.button,
                pressed && styles.buttonPressed,
                busy && styles.buttonDisabled,
              ]}>
              <Text style={[styles.buttonText, theme.text]}>{action.label}</Text>
              {action.hint ? (
                <Text style={[styles.buttonHint, theme.dim]}>{action.hint}</Text>
              ) : null}
            </Pressable>
          ))}
        </ScrollView>

        <ScrollView style={[styles.log, theme.log]}>
          {log.length === 0 ? (
            <Text style={[styles.logEmpty, theme.dim]}>Chưa có gì. Bấm một nút ở trên.</Text>
          ) : (
            log.map((line, index) => (
              <Text key={`${line.at}-${index}`} style={[styles.logLine, toneStyle[line.tone]]}>
                {line.at} {line.text}
              </Text>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 16 },
  title: { fontSize: 22, fontWeight: '700', marginTop: 8 },
  subtitle: { fontSize: 12, marginBottom: 8 },
  actions: { maxHeight: '46%' },
  actionsContent: { paddingBottom: 8 },
  button: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, marginBottom: 6 },
  buttonPressed: { opacity: 0.6 },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { fontSize: 15, fontWeight: '600' },
  buttonHint: { fontSize: 11, marginTop: 2 },
  log: { flex: 1, borderRadius: 10, padding: 10, marginBottom: 8 },
  logEmpty: { fontSize: 12 },
  logLine: { fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginBottom: 6 },
})

const toneStyle = StyleSheet.create({
  info: { color: '#7d8590' },
  ok: { color: '#3fb950' },
  warn: { color: '#d29922' },
  err: { color: '#f85149' },
})

const lightTheme = StyleSheet.create({
  root: { backgroundColor: '#ffffff' },
  text: { color: '#1f2328' },
  dim: { color: '#59636e' },
  button: { backgroundColor: '#f0f3f6' },
  log: { backgroundColor: '#f6f8fa' },
})

const darkTheme = StyleSheet.create({
  root: { backgroundColor: '#0d1117' },
  text: { color: '#e6edf3' },
  dim: { color: '#7d8590' },
  button: { backgroundColor: '#21262d' },
  log: { backgroundColor: '#161b22' },
})
