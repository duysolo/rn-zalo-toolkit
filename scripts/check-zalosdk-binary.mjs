#!/usr/bin/env node
/**
 * Canh những thứ trong binary iOS của Zalo sẽ chặn build TRONG TƯƠNG LAI.
 *
 * VÌ SAO KHÔNG ĐỂ TRONG `verify-package.mjs`: script đó soi tarball npm. Nếu về sau chuyển
 * sang `binaryTarget(url:checksum:)` thay vì vendor thì xcframework không còn nằm trong
 * tarball nữa, và bài kiểm sẽ im lặng không chạy. Tách ra để nó luôn soi thứ THẬT SỰ đang
 * được link.
 *
 * Cố ý KHÔNG cảnh báo về `armv7`/`i386`: chúng vô hại (linker chọn arm64) và script vendor
 * đã cắt sẵn. Hai thứ dưới đây mới là thứ có thể làm app chết:
 *
 *   1. Slice thiết bị còn dùng `LC_VERSION_MIN_IPHONEOS` thay vì `LC_BUILD_VERSION`.
 *      Đây là định dạng tiền-Xcode-11; Apple đã bỏ dần.
 *   2. Binary tham chiếu cứng `SFAuthenticationSession` - deprecated từ iOS 12. Nếu Apple
 *      gỡ khỏi runtime, app **chết lúc launch** (dyld), không phải lỗi lúc build. Đó là
 *      kịch bản tệ nhất: không CI nào bắt được, chỉ người dùng thật gặp.
 *
 * Luôn exit 0 - thông báo, không chặn. Chặn CI vì một API mà Apple CHƯA gỡ là tự làm khổ mình.
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FRAMEWORKS = path.join(
  ROOT, 'packages', 'rn-zalo-toolkit', 'ios', 'ZaloSDKBinary', 'Frameworks',
)

if (process.platform !== 'darwin') {
  console.log('· Bỏ qua: cần otool/lipo của macOS.')
  process.exit(0)
}
if (!fs.existsSync(FRAMEWORKS)) {
  console.log(`· Bỏ qua: chưa vendor xcframework (${path.relative(ROOT, FRAMEWORKS)}).`)
  process.exit(0)
}

const sh = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return ''
  }
}

const warnings = []
const facts = []

for (const entry of fs.readdirSync(FRAMEWORKS)) {
  if (!entry.endsWith('.xcframework')) continue
  const name = entry.replace('.xcframework', '')
  const xcPath = path.join(FRAMEWORKS, entry)

  const plistJson = sh('plutil', ['-convert', 'json', '-o', '-', path.join(xcPath, 'Info.plist')])
  if (!plistJson) continue
  const libraries = JSON.parse(plistJson).AvailableLibraries ?? []

  for (const library of libraries) {
    const isSimulator = library.SupportedPlatformVariant === 'simulator'
    const binary = path.join(xcPath, library.LibraryIdentifier, `${name}.framework`, name)
    if (!fs.existsSync(binary)) continue

    const arch = isSimulator ? 'x86_64' : 'arm64'
    const loadCommands = sh('otool', ['-l', '-arch', arch, binary])

    if (!isSimulator) {
      if (loadCommands.includes('LC_VERSION_MIN_IPHONEOS')) {
        const minos = loadCommands.match(/LC_VERSION_MIN_IPHONEOS[\s\S]{0,80}?version (\S+)/)?.[1]
        warnings.push(
          `${name}: slice thiết bị dùng LC_VERSION_MIN_IPHONEOS (minos ${minos ?? '?'}) thay vì ` +
            'LC_BUILD_VERSION. Định dạng tiền-Xcode-11, Apple đang bỏ dần.',
        )
      } else {
        facts.push(`${name}: slice thiết bị dùng LC_BUILD_VERSION ✔`)
      }
    }

    const sdk = loadCommands.match(/sdk (\d+\.\d+)/)?.[1]
    if (sdk) facts.push(`${name}/${library.LibraryIdentifier}: build bằng SDK ${sdk}`)
  }

  // API deprecated mà binary vẫn tham chiếu cứng.
  const undefinedSymbols = sh('nm', ['-u', path.join(xcPath, libraries[0]?.LibraryIdentifier ?? '', `${name}.framework`, name)])
  if (undefinedSymbols.includes('SFAuthenticationSession')) {
    warnings.push(
      `${name}: còn tham chiếu SFAuthenticationSession (deprecated từ iOS 12). Nếu Apple gỡ ` +
        'khỏi runtime, app CHẾT LÚC LAUNCH - không phải lỗi build, nên không CI nào bắt được.',
    )
  }

  if (!fs.existsSync(path.join(xcPath, 'PrivacyInfo.xcprivacy'))) {
    const found = sh('find', [xcPath, '-name', '*.xcprivacy']).trim()
    if (!found) {
      facts.push(
        `${name}: KHÔNG có privacy manifest (đã biết). App tiêu thụ phải tự khai ` +
          'UserDefaults CA92.1 + FileTimestamp C617.1 - xem docs/guides/setup-ios.md.',
      )
    }
  }
}

for (const fact of facts) console.log(`·  ${fact}`)
if (warnings.length > 0) {
  console.log('')
  for (const warning of warnings) console.log(`⚠  ${warning}`)
  console.log('')
  console.log('Những mục trên là TRIGGER phải xem lại quyết định "bọc SDK chính hãng".')
}
process.exit(0)
