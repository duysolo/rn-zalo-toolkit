#!/usr/bin/env node
/**
 * Pack thật rồi soi tarball. Kiểm những thứ mà `npm publish` KHÔNG kiểm hộ.
 *
 * Mỗi bài kiểm dưới đây tương ứng một cách hỏng đã biết:
 *   - thiếu `android/src/main/AndroidManifest.xml` ⇒ app im lặng mất `BrowserLoginActivity`,
 *     đăng nhập qua trình duyệt mở được nhưng không quay lại app.
 *   - thiếu `consumer-rules.pro` ⇒ bản release có minify chết `ClassNotFoundException`,
 *     và chỉ ở bản release, nên không lộ ra khi chạy debug.
 *   - lọt `android/build/` hay `ios/build/` ⇒ tarball phình gấp nhiều lần.
 *   - còn `+` trong version SDK ⇒ build không reproducible, đúng lỗi của thư viện cũ.
 *   - thiếu điều kiện `require` trong `exports` ⇒ jest của app tiêu thụ vấp ESM.
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PKG_DIR = path.join(ROOT, 'packages', 'rn-zalo-toolkit')

const REQUIRED_FILES = [
  'package/README.md',
  'package/LICENSE',
  'package/RnZaloToolkit.podspec',
  'package/android/build.gradle',
  'package/android/consumer-rules.pro',
  'package/android/src/main/AndroidManifest.xml',
  'package/ios/PrivacyInfo.xcprivacy',
  'package/ios/RnZaloToolkit.mm',
  'package/ios/ZaloSDKBinary/Package.swift',
  'package/src/errorTable.json',
  'package/dist/commonjs/index.js',
  'package/dist/module/index.js',
  'package/dist/typescript/commonjs/index.d.ts',
]

const FORBIDDEN_PREFIXES = [
  'package/android/build/',
  'package/android/.gradle/',
  'package/ios/build/',
  'package/example/',
]

const problems = []
const fail = message => problems.push(message)

// ── kiểm manifest của package ────────────────────────────────────────────────

const pkg = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8'))

if (!pkg.exports?.['.']?.require) {
  fail(
    'thiếu `exports["."].require` - jest của app tiêu thụ sẽ resolve nhánh ESM và vấp ' +
      '`SyntaxError: Unexpected token export`, vì tên package không nằm trong ' +
      '`transformIgnorePatterns` mặc định của họ.',
  )
}
if (!pkg.peerDependencies?.['react-native']) {
  fail('thiếu peerDependency `react-native`')
}
if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
  fail(`package này phải KHÔNG có runtime dependency, đang có: ${Object.keys(pkg.dependencies)}`)
}
if (!pkg.sdkVersions?.android?.zaloSdk || !pkg.sdkVersions?.ios?.zaloSdk) {
  fail('thiếu `sdkVersions` - gradle và podspec đều đọc từ đó')
}

// ── version SDK phải nhất quán giữa package.json và build.gradle ─────────────

/**
 * Bỏ chú thích trước khi grep.
 *
 * Không có bước này thì chính dòng comment cảnh báo *"thư viện cũ dùng `me.zalo:sdk-core:+`"*
 * cũng bị tính là vi phạm - một script kiểm tra mà báo sai thì tệ hơn không có.
 */
const stripGroovyComments = text =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n')

const buildGradle = stripGroovyComments(
  fs.readFileSync(path.join(PKG_DIR, 'android', 'build.gradle'), 'utf8'),
)
if (/me\.zalo:[a-z-]+:\+/.test(buildGradle)) {
  fail('android/build.gradle còn dùng version range `+` cho me.zalo - build không reproducible')
}
if (!buildGradle.includes('sdkVersions.zaloSdk')) {
  fail('android/build.gradle không đọc version từ package.json ⇒ hai nguồn version sẽ lệch')
}

const podspec = fs
  .readFileSync(path.join(PKG_DIR, 'RnZaloToolkit.podspec'), 'utf8')
  .split('\n')
  .filter(line => !line.trim().startsWith('#'))
  .join('\n')
if (/^\s*s\.dependency\s+["']ZaloSDK["']/m.test(podspec)) {
  fail(
    'podspec khai `s.dependency "ZaloSDK"` - đó chính là ràng buộc CocoaPods mà package này ' +
      'tồn tại để loại bỏ. SDK Zalo phải đến từ ios/ZaloSDKBinary.',
  )
}

const manifest = fs.readFileSync(
  path.join(PKG_DIR, 'android', 'src', 'main', 'AndroidManifest.xml'),
  'utf8',
)
if (!manifest.includes('${zaloAppId}')) {
  fail(
    'AndroidManifest.xml mất placeholder `${zaloAppId}` - scheme sẽ cứng hoặc rỗng, và ' +
      'aapt2 chấp nhận chuỗi rỗng nên lỗi chỉ lộ khi người dùng thật bấm đăng nhập.',
  )
}
if (!manifest.includes('android:exported="false"')) {
  fail('ContentProvider phải khai `android:exported="false"` tường minh')
}

// ── pack thật ────────────────────────────────────────────────────────────────

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-zalo-toolkit-verify-'))
try {
  const output = execFileSync('npm', ['pack', '--pack-destination', tmp], {
    cwd: PKG_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const tarball = path.join(tmp, output.trim().split('\n').at(-1))
  const listing = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)

  for (const required of REQUIRED_FILES) {
    if (!listing.includes(required)) fail(`tarball thiếu ${required}`)
  }
  for (const prefix of FORBIDDEN_PREFIXES) {
    const leaked = listing.filter(entry => entry.startsWith(prefix))
    if (leaked.length > 0) fail(`tarball lọt ${leaked.length} file dưới ${prefix}`)
  }

  const xcframeworks = listing.filter(entry => entry.includes('.xcframework/'))
  if (xcframeworks.length === 0) {
    fail(
      'tarball KHÔNG có xcframework nào. SDK Zalo được vendor vào ios/ZaloSDKBinary/Frameworks; ' +
        'thiếu nó thì app tiêu thụ không link được và lỗi chỉ lộ lúc build iOS.',
    )
  }

  const sizeMb = (fs.statSync(tarball).size / 1024 / 1024).toFixed(1)
  console.log(`· tarball: ${listing.length} file, ${sizeMb} MB`)
  console.log(`· xcframework: ${xcframeworks.length} entry`)
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}

if (problems.length === 0) {
  console.log('✔ package sẵn sàng publish')
  process.exit(0)
}
console.error(`\n✖ ${problems.length} vấn đề:`)
for (const problem of problems) console.error(`  - ${problem}`)
process.exit(1)
