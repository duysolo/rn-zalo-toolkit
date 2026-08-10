#!/usr/bin/env node
/**
 * Kiểm cấu hình Zalo của một app React Native - TĨNH, không cần thiết bị, không cần build.
 *
 * VÌ SAO CÓ CẢ CÁI NÀY LẪN `verifyInstallation()`:
 * `verifyInstallation()` chạy trên máy nên chỉ thấy được MỘT nền tảng mỗi lần, và chỉ khi
 * app đã build xong rồi chạy lên. Script này đọc thẳng `Info.plist` + `AndroidManifest.xml`
 * + `gradle.properties`, nên nó bắt được thứ mà runtime KHÔNG BAO GIỜ thấy:
 * **appId lệch giữa iOS và Android**. Nó cũng chạy được trong CI và trong prebuild.
 *
 * Dùng:
 *   npx rn-zalo-toolkit-doctor            # dò từ thư mục hiện tại
 *   npx rn-zalo-toolkit-doctor <đường-dẫn-app>
 */

import fs from 'node:fs'
import path from 'node:path'

const problems = []
const notes = []

const fail = (title, detail, fix) => problems.push({ title, detail, fix })
const note = text => notes.push(text)

const readText = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null)

/**
 * Bỏ chú thích trước khi dò "tàn dư cấu hình cũ".
 *
 * Không có bước này thì một dòng comment kiểu "KHÔNG gọi initialize(withAppId:) ở đây nữa"
 * cũng bị tính là tàn dư - và script chẩn đoán mà báo sai thì tệ hơn không có.
 */
const stripComments = (text) =>
  (text ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n')

/** Đọc một khoá trong Info.plist mà không cần PlistBuddy (để chạy được cả trên Linux CI). */
const plistValue = (plistText, key) => {
  const pattern = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`)
  return plistText.match(pattern)?.[1]?.trim() || null
}

const plistArray = (plistText, key) => {
  // Gom TẤT CẢ các mảng cùng khoá, không chỉ mảng đầu tiên: một app thật thường có nhiều
  // khối `CFBundleURLSchemes` (Google Sign-In một khối, Zalo một khối). Lấy mảng đầu rồi
  // kết luận "thiếu scheme" là báo sai - đúng lỗi bản đầu của script này mắc phải.
  const pattern = new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`, 'g')
  return [...plistText.matchAll(pattern)].flatMap(match =>
    [...match[1].matchAll(/<string>([^<]*)<\/string>/g)].map(m => m[1].trim()),
  )
}

const findAppRoot = start => {
  let dir = path.resolve(start)
  for (let i = 0; i < 6; i += 1) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'android'))) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

// ── Android ──────────────────────────────────────────────────────────────────

const checkAndroid = appRoot => {
  const androidDir = path.join(appRoot, 'android')
  if (!fs.existsSync(androidDir)) return null

  const gradleProps = readText(path.join(androidDir, 'gradle.properties')) ?? ''
  const rootGradle = readText(path.join(androidDir, 'build.gradle')) ?? ''

  const fromProps = gradleProps.match(/^\s*zaloAppId\s*=\s*(\S+)\s*$/m)?.[1]
  const fromExt = rootGradle.match(/zaloAppId\s*=\s*["']([^"']+)["']/)?.[1]
  const appId = fromProps || fromExt || null

  if (!appId) {
    fail(
      'Android: thiếu `zaloAppId`',
      'Không tìm thấy `zaloAppId` trong android/gradle.properties lẫn android/build.gradle. ' +
        'Build sẽ dừng với thông báo của thư viện, nhưng phát hiện ở đây thì nhanh hơn.',
      'Thêm vào android/gradle.properties:\n    zaloAppId=<APP_ID>',
    )
  } else if (!/^\d{6,}$/.test(appId)) {
    fail(
      'Android: `zaloAppId` không hợp lệ',
      `Giá trị hiện tại: "${appId}". App id của Zalo là một dãy số (thường 19 chữ số).`,
      'Lấy đúng App ID ở https://developers.zalo.me → chọn ứng dụng.',
    )
  }

  // Tàn dư của cách cấu hình cũ. Để lại thì manifest merger sẽ dừng build với thông báo khó đoán.
  const appManifest = readText(
    path.join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml'),
  )
  if (appManifest?.includes('com.zing.zalo.zalosdk.appID')) {
    fail(
      'Android: app còn tự khai `meta-data com.zing.zalo.zalosdk.appID`',
      'Thư viện đã khai khoá này. Trùng nhau ⇒ manifest merger dừng build với thông báo ' +
        '"Attribute meta-data#com.zing.zalo.zalosdk.appID@value ... Suggestion: add tools:replace".',
      'Xoá khối <meta-data android:name="com.zing.zalo.zalosdk.appID" .../> khỏi manifest của app.',
    )
  }
  if (appManifest?.includes('BrowserLoginActivity')) {
    fail(
      'Android: app còn tự khai `BrowserLoginActivity`',
      'Thư viện đã khai activity này kèm scheme `zalo-<appId>`.',
      'Xoá khối <activity android:name="com.zing.zalo.zalosdk.oauth.BrowserLoginActivity" .../>.',
    )
  }

  const mainApplication = [
    path.join(androidDir, 'app', 'src', 'main', 'java'),
    path.join(androidDir, 'app', 'src', 'main', 'kotlin'),
  ]
    .filter(fs.existsSync)
    .flatMap(dir => walk(dir))
    .filter(file => /MainApplication\.(kt|java)$/.test(file))
    .map(file => ({ file, text: stripComments(readText(file)) }))

  for (const { file, text } of mainApplication) {
    if (text.includes('ZaloSDKApplication')) {
      note(
        `Android: ${path.relative(appRoot, file)} còn gọi ZaloSDKApplication.wrap(). ` +
          'Thư viện đã tự làm qua ContentProvider - gọi hai lần chỉ tốn thêm một lượt mạng ' +
          'device-tracking, không hỏng gì, nhưng nên gỡ.',
      )
    }
  }

  return appId
}

const walk = dir =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })

// ── iOS ──────────────────────────────────────────────────────────────────────

const checkIOS = appRoot => {
  const iosDir = path.join(appRoot, 'ios')
  if (!fs.existsSync(iosDir)) return null

  const plists = walk(iosDir).filter(
    file =>
      path.basename(file) === 'Info.plist' &&
      !file.includes('/Pods/') &&
      !file.includes('/build/') &&
      !file.includes('Tests') &&
      // Info.plist BÊN TRONG framework vendor không phải của app. Thiếu bộ lọc này thì mọi
      // app có `ios/Frameworks/*.xcframework` (rất phổ biến) ăn lỗi giả "thiếu ZaloAppID".
      !file.includes('.framework/') &&
      !file.includes('.xcframework/') &&
      !file.includes('/DerivedData/') &&
      !file.includes('/Carthage/'),
  )

  if (plists.length === 0) {
    note('iOS: không tìm thấy Info.plist nào - bỏ qua phần iOS.')
    return null
  }

  let appId = null
  for (const plist of plists) {
    const text = readText(plist) ?? ''
    const value = plistValue(text, 'ZaloAppID')
    const rel = path.relative(appRoot, plist)

    if (!value) {
      fail(
        `iOS: thiếu \`ZaloAppID\` trong ${rel}`,
        'Không có khoá này thì mọi lời gọi Zalo trả INVALID_CONFIG ngay lập tức.',
        `Thêm vào ${rel}:\n    <key>ZaloAppID</key>\n    <string><APP_ID></string>`,
      )
      continue
    }
    appId = value

    const schemes = plistArray(text, 'CFBundleURLSchemes')
    const expected = `zalo-${value}`
    if (!schemes.includes(expected)) {
      fail(
        `iOS: thiếu URL scheme \`${expected}\``,
        'Zalo sẽ không gọi ngược được về app sau khi người dùng đồng ý, và đăng nhập dừng ở màn Zalo.',
        `Thêm \`${expected}\` vào CFBundleURLTypes → CFBundleURLSchemes trong ${rel}.`,
      )
    }

    const queries = plistArray(text, 'LSApplicationQueriesSchemes')
    const missing = ['zalosdk', 'zaloshareext'].filter(scheme => !queries.includes(scheme))
    if (missing.length > 0) {
      fail(
        `iOS: thiếu ${missing.join(', ')} trong LSApplicationQueriesSchemes`,
        'Đăng nhập qua ứng dụng Zalo sẽ không mở được và luôn rơi về web.',
        `Thêm zalosdk và zaloshareext vào LSApplicationQueriesSchemes trong ${rel}.`,
      )
    }
  }

  // Tàn dư của cách cũ.
  const swiftFiles = walk(iosDir).filter(
    file => file.endsWith('.swift') && !file.includes('/Pods/') && !file.includes('/build/'),
  )
  for (const file of swiftFiles) {
    const text = stripComments(readText(file))
    if (text.includes('initialize(withAppId')) {
      note(
        `iOS: ${path.relative(appRoot, file)} còn gọi initialize(withAppId:). ` +
          'Thư viện đã tự khởi tạo trong +load, tức SỚM HƠN. Gọi thêm lần nữa chạy lại cả ' +
          'lượt nạp settings qua mạng - nên gỡ.',
      )
    }
  }

  const forwardsURL = swiftFiles.some(file => stripComments(readText(file)).includes('ZaloToolkit.handle'))
  if (!forwardsURL) {
    fail(
      'iOS: chưa chuyển tiếp URL callback',
      'Không tìm thấy lời gọi `ZaloToolkit.handle(...)` nào. Đăng nhập qua ứng dụng Zalo sẽ ' +
        'mở được nhưng KHÔNG BAO GIỜ quay lại app - promise chỉ chết bằng timeout.',
      'AppDelegate:\n' +
        '    if ZaloToolkit.handle(url: url, options: options) { return true }\n' +
        'SceneDelegate (cần CẢ HAI chỗ):\n' +
        '    scene(_:openURLContexts:)               → ZaloToolkit.handle(context)\n' +
        '    scene(_:willConnectTo:options:)         → connectionOptions.urlContexts',
    )
  }

  return appId
}

// ── main ─────────────────────────────────────────────────────────────────────

const target = process.argv[2] ?? process.cwd()
const appRoot = findAppRoot(target)

if (!appRoot) {
  console.error(
    `[doctor] Không tìm thấy thư mục app React Native từ "${target}".\n` +
      'Chạy trong thư mục app, hoặc truyền đường dẫn: npx rn-zalo-toolkit-doctor <app>',
  )
  process.exit(2)
}

console.log(`[doctor] app: ${appRoot}\n`)

const androidAppId = checkAndroid(appRoot)
const iosAppId = checkIOS(appRoot)

/**
 * Đây là kiểm tra mà `verifyInstallation()` trên máy KHÔNG BAO GIỜ làm được: nó chỉ chạy
 * trên một nền tảng mỗi lần, nên hai bên lệch nhau thì cả hai đều "ok".
 */
if (androidAppId && iosAppId && androidAppId !== iosAppId) {
  fail(
    'appId LỆCH giữa hai nền tảng',
    `Android: ${androidAppId}\niOS:     ${iosAppId}\n` +
      'Người dùng hai nền tảng sẽ đăng nhập vào hai ứng dụng Zalo khác nhau, và uid trả về ' +
      'khác nhau ⇒ cùng một người thành hai tài khoản.',
    'Chốt một app id, sửa cho khớp ở cả android/gradle.properties lẫn Info.plist.',
  )
}

for (const line of notes) console.log(`  · ${line}\n`)

if (problems.length === 0) {
  console.log('✔ Không phát hiện vấn đề cấu hình nào.')
  console.log('  Lưu ý: script này chỉ đọc cấu hình TRÊN MÁY. Nó không biết Zalo portal đã')
  console.log('  đăng ký package name / bundle ID / hash key hay chưa - chuyện đó chỉ lộ khi')
  console.log('  đăng nhập thật, và khi ấy lỗi INVALID_CONFIG sẽ kèm sẵn giá trị để dán lên portal.')
  process.exit(0)
}

console.error(`✖ ${problems.length} vấn đề:\n`)
for (const [index, problem] of problems.entries()) {
  console.error(`${index + 1}. ${problem.title}`)
  console.error(`   ${problem.detail.split('\n').join('\n   ')}`)
  console.error(`   → ${problem.fix.split('\n').join('\n     ')}\n`)
}
process.exit(1)
