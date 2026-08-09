#!/usr/bin/env node
/**
 * Nạp ZaloSDK xcframework vào `packages/rn-zalo-toolkit/ios/Frameworks/`.
 *
 * VÌ SAO PHẢI VENDOR: Zalo KHÔNG phát hành SDK iOS qua Swift Package Manager - repo
 * `VNG-Zalo/ZaloSDK-iOS` chỉ có `ZaloSDK.podspec`, không có `Package.swift` (kiểm 09/08/2026,
 * raw.githubusercontent trả 404). Muốn thoát CocoaPods thì phải tự bọc binary thành SPM
 * package, mà `binaryTarget` chỉ nhận đường dẫn local hoặc URL zip có checksum.
 *
 * VÌ SAO ĐƯỢC PHÉP: ZaloSDK phát hành theo giấy phép MIT (xem LICENSE đi kèm, được sao chép
 * sang `ios/Frameworks/LICENSE-ZaloSDK`). MIT cho phép phân phối lại kèm giấy phép.
 *
 * VÌ SAO CẮT SLICE: các framework này là STATIC (`file` báo `ar archive`), nên chúng không
 * được nhúng và không bị kiểm chữ ký lúc chạy - linker rút object ra lúc build. Cắt slice
 * bằng `lipo` là thao tác an toàn, khác hẳn với framework động.
 *   - `armv7`: thiết bị 32-bit cuối cùng dừng ở iOS 10. React Native 0.85 yêu cầu iOS 15.1+.
 *   - `i386`  : simulator 32-bit, chết từ Xcode 11.
 * Giữ lại: `arm64` (thiết bị), `arm64` + `x86_64` (simulator - Apple Silicon và Intel).
 *
 * Dùng:
 *   node scripts/sync-vendored-zalosdk.mjs --from <thư-mục-chứa-*.xcframework>
 *   node scripts/sync-vendored-zalosdk.mjs --check      # chỉ kiểm, không ghi
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PKG_DIR = path.join(ROOT, 'packages', 'rn-zalo-toolkit')
const DEST = path.join(PKG_DIR, 'ios', 'ZaloSDKBinary', 'Frameworks')

/** Chỉ hai framework này. `ZingAnalytics` là subspec riêng, ngoài phạm vi auth. */
const FRAMEWORKS = ['ZaloSDK', 'ZaloSDKCoreKit']

const KEEP = {
  device: ['arm64'],
  simulator: ['arm64', 'x86_64'],
}

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim()

const fail = msg => {
  console.error(`\n[sync-vendored-zalosdk] ${msg}\n`)
  process.exit(1)
}

const readPlist = plistPath => JSON.parse(sh('plutil', ['-convert', 'json', '-o', '-', plistPath]))

const writePlist = (plistPath, value) => {
  const tmp = `${plistPath}.json`
  fs.writeFileSync(tmp, JSON.stringify(value))
  // `xml1` chứ KHÔNG phải `binary1`.
  //
  // Bản gốc của Zalo là XML, và CocoaPods đọc `Info.plist` của xcframework để biết có
  // những slice nào. Ghi lại dạng binary khiến `pod install` chết với
  // `ArgumentError - invalid byte sequence in UTF-8 | Parsing binary plist` - một thông báo
  // không hề nhắc tới xcframework, nên rất tốn thời gian để lần ra.
  sh('plutil', ['-convert', 'xml1', '-o', plistPath, tmp])
  fs.rmSync(tmp)
}

const expectedVersion = () =>
  JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8')).sdkVersions.ios.zaloSdk

/** Tự dò xcframework trong các Pods đã cài quanh workspace, để khỏi phải gõ --from. */
const autoDetectSource = () => {
  const candidates = [
    path.resolve(ROOT, '../../charging/charging-app/ios/Pods/ZaloSDK/ZaloSDK/Frameworks'),
    path.resolve(ROOT, '../../tramev/tramev.vn-driver-app/ios/Pods/ZaloSDK/ZaloSDK/Frameworks'),
    path.resolve(ROOT, '../refs/ZaloSDK-iOS-4/ZaloSDK/Frameworks'),
  ]
  return candidates.find(dir => FRAMEWORKS.every(f => fs.existsSync(path.join(dir, `${f}.xcframework`))))
}

const sliceVariant = entry => (entry.SupportedPlatformVariant === 'simulator' ? 'simulator' : 'device')

const stripSlice = (frameworkDir, name, archsToKeep) => {
  const binary = path.join(frameworkDir, name)
  const present = sh('lipo', ['-archs', binary]).split(/\s+/)
  const keep = archsToKeep.filter(a => present.includes(a))
  if (keep.length === 0) fail(`${name}: không còn arch nào để giữ (có: ${present.join(', ')})`)

  const drop = present.filter(a => !keep.includes(a))
  if (drop.length > 0) {
    // Mỗi arch cần MỘT cờ `-remove` riêng. `lipo -remove a b bin -output out` sẽ coi `b`
    // là tên file đầu vào và chết. Hiện chỉ phải bỏ 1 arch/slice nên bug này chưa lộ - bản
    // SDK sau thêm một arch chết là script hỏng.
    sh('lipo', [...drop.flatMap(a => ['-remove', a]), binary, '-output', binary])
  }

  // Chữ ký cũ không còn khớp sau khi lipo. Framework STATIC không bị kiểm chữ ký lúc chạy,
  // nhưng để lại một thư mục chữ ký sai thì gây hiểu nhầm khi ai đó đi điều tra sau này.
  const codeSignature = path.join(frameworkDir, '_CodeSignature')
  if (fs.existsSync(codeSignature)) fs.rmSync(codeSignature, { recursive: true })

  return { kept: keep, dropped: drop }
}

const main = () => {
  const args = process.argv.slice(2)
  const checkOnly = args.includes('--check')
  const fromIndex = args.indexOf('--from')
  const source = fromIndex >= 0 ? args[fromIndex + 1] : autoDetectSource()

  if (checkOnly) {
    if (!fs.existsSync(DEST)) fail(`Chưa vendor: thiếu ${path.relative(ROOT, DEST)}`)
    let ok = true
    for (const name of FRAMEWORKS) {
      const xc = path.join(DEST, `${name}.xcframework`)
      if (!fs.existsSync(xc)) {
        console.error(`✖ thiếu ${name}.xcframework`)
        ok = false
        continue
      }
      const plist = readPlist(path.join(xc, 'Info.plist'))
      for (const entry of plist.AvailableLibraries) {
        const archs = entry.SupportedArchitectures
        const stale = archs.filter(a => a === 'armv7' || a === 'i386')
        if (stale.length > 0) {
          console.error(`✖ ${name}/${entry.LibraryIdentifier} còn arch chết: ${stale.join(', ')}`)
          ok = false
        }
      }
      // Bump `sdkVersions.ios.zaloSdk` mà quên `vendor:sync` thì mọi thứ vẫn xanh còn
      // `getSdkVersion()` báo một đằng binary một nẻo. Binary có mang version - dùng nó.
      const slice = plist.AvailableLibraries[0]
      const fwPlist = path.join(xc, slice.LibraryIdentifier, `${name}.framework`, 'Info.plist')
      const actual = fs.existsSync(fwPlist) ? readPlist(fwPlist).CFBundleShortVersionString : null
      if (actual && actual !== expectedVersion()) {
        console.error(
          `✖ ${name}: binary là ${actual} nhưng package.json khai ${expectedVersion()}.` +
            ' Chạy `npm run vendor:sync`.',
        )
        ok = false
      }
      console.log(`✔ ${name}.xcframework (${actual ?? 'không đọc được version'})`)
    }
    process.exit(ok ? 0 : 1)
  }

  if (!source) {
    fail(
      'Không tìm thấy nguồn xcframework.\n' +
        'Truyền --from <thư-mục>, hoặc chạy `pod install` ở một app có ZaloSDK rồi chạy lại.',
    )
  }
  if (!fs.existsSync(source)) fail(`Nguồn không tồn tại: ${source}`)

  console.log(`[sync] nguồn: ${source}`)
  fs.mkdirSync(DEST, { recursive: true })

  for (const name of FRAMEWORKS) {
    const src = path.join(source, `${name}.xcframework`)
    const dst = path.join(DEST, `${name}.xcframework`)
    if (!fs.existsSync(src)) fail(`Thiếu ${name}.xcframework trong nguồn`)

    fs.rmSync(dst, { recursive: true, force: true })
    fs.cpSync(src, dst, { recursive: true })

    const plistPath = path.join(dst, 'Info.plist')
    const plist = readPlist(plistPath)
    const kept = []

    for (const entry of plist.AvailableLibraries) {
      // Mac Catalyst không phải nền tảng mà app React Native này nhắm tới.
      if (entry.SupportedPlatformVariant === 'maccatalyst') {
        fs.rmSync(path.join(dst, entry.LibraryIdentifier), { recursive: true, force: true })
        console.log(`  - bỏ slice maccatalyst`)
        continue
      }

      const variant = sliceVariant(entry)
      const frameworkDir = path.join(dst, entry.LibraryIdentifier, `${name}.framework`)
      const { kept: archs, dropped } = stripSlice(frameworkDir, name, KEEP[variant])

      // Đổi tên thư mục cho khớp arch thật, tránh việc 6 tháng sau ai đó đọc
      // `ios-arm64_armv7` rồi tưởng armv7 vẫn còn.
      const newId = variant === 'simulator' ? `ios-${archs.join('_')}-simulator` : `ios-${archs.join('_')}`
      if (newId !== entry.LibraryIdentifier) {
        fs.renameSync(path.join(dst, entry.LibraryIdentifier), path.join(dst, newId))
      }

      kept.push({ ...entry, LibraryIdentifier: newId, SupportedArchitectures: archs })
      console.log(
        `  - ${name}/${newId}: giữ ${archs.join(', ')}${dropped.length ? ` | bỏ ${dropped.join(', ')}` : ''}`,
      )
    }

    plist.AvailableLibraries = kept
    writePlist(plistPath, plist)
  }

  const licenseSrc = path.resolve(source, '../../LICENSE')
  if (fs.existsSync(licenseSrc)) {
    fs.copyFileSync(licenseSrc, path.join(DEST, 'LICENSE-ZaloSDK'))
    console.log('  - sao chép LICENSE-ZaloSDK (MIT)')
  } else {
    console.warn('  ! không tìm thấy LICENSE của ZaloSDK - PHẢI thêm tay trước khi publish')
  }

  const total = sh('du', ['-sh', DEST]).split(/\s+/)[0]
  console.log(`[sync] xong. Kỳ vọng SDK ${expectedVersion()}. Tổng dung lượng: ${total}`)
}

main()
