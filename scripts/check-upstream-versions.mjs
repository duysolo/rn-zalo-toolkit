#!/usr/bin/env node
/**
 * Báo khi Zalo phát hành SDK mới.
 *
 * Đây là cơ chế DUY NHẤT phát hiện các trigger phải xem lại kiến trúc mà không cần ai nhớ:
 *   - SDK Android đứng yên quá lâu (bản cuối 4.24.1101, 2024-11) trong khi Google nâng
 *     targetSdk bắt buộc.
 *   - SDK iOS ra bản mới có privacy manifest (bản 4.1.0120 hiện KHÔNG có).
 *
 * Luôn exit 0: đây là THÔNG BÁO, không phải cổng chặn. Một bản SDK mới không làm hỏng build
 * đang chạy, và chặn CI vì nó là cách nhanh nhất để cả đội học cách bỏ qua cảnh báo.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'packages', 'rn-zalo-toolkit', 'package.json'), 'utf8'),
)

const TIMEOUT_MS = 20_000

const fetchText = async url => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) return null
    return await response.text()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

const checkAndroid = async () => {
  const pinned = pkg.sdkVersions.android.zaloSdk
  const url = `${pkg.sdkVersions.android.zaloMavenUrl}/me/zalo/sdk-auth/maven-metadata.xml`
  const xml = await fetchText(url)
  if (!xml) return { name: 'Android me.zalo:sdk-auth', pinned, latest: null, note: 'không tải được maven-metadata' }

  const latest = xml.match(/<release>([^<]+)<\/release>/)?.[1] ?? null
  const lastUpdated = xml.match(/<lastUpdated>(\d{4})(\d{2})(\d{2})/)
  const updatedNote = lastUpdated
    ? `phát hành gần nhất ${lastUpdated[1]}-${lastUpdated[2]}-${lastUpdated[3]}`
    : undefined
  return { name: 'Android me.zalo:sdk-auth', pinned, latest, note: updatedNote }
}

const checkIOS = async () => {
  const pinned = pkg.sdkVersions.ios.zaloSdk
  const json = await fetchText('https://trunk.cocoapods.org/api/v1/pods/ZaloSDK')
  if (!json) return { name: 'iOS pod ZaloSDK', pinned, latest: null, note: 'không tải được CocoaPods trunk' }
  try {
    const versions = JSON.parse(json).versions ?? []
    return { name: 'iOS pod ZaloSDK', pinned, latest: versions.at(-1)?.name ?? null }
  } catch {
    return { name: 'iOS pod ZaloSDK', pinned, latest: null, note: 'không parse được phản hồi' }
  }
}

const results = await Promise.all([checkAndroid(), checkIOS()])

let anyNewer = false
for (const { name, pinned, latest, note } of results) {
  if (!latest) {
    console.log(`?  ${name}: đang pin ${pinned}${note ? ` (${note})` : ''}`)
    continue
  }
  if (latest === pinned) {
    console.log(`✔  ${name}: ${pinned} là bản mới nhất${note ? ` (${note})` : ''}`)
  } else {
    anyNewer = true
    console.log(`↑  ${name}: đang pin ${pinned}, upstream có ${latest}${note ? ` (${note})` : ''}`)
  }
}

if (anyNewer) {
  console.log('')
  console.log('Có bản SDK mới. Quy trình nâng:')
  console.log('  1. Sửa `sdkVersions` trong packages/rn-zalo-toolkit/package.json')
  console.log('  2. iOS: chạy lại `npm run vendor:sync` để nạp xcframework mới')
  console.log('  3. Chạy lại TOÀN BỘ ma trận nghiệm thu, không chỉ subset smoke -')
  console.log('     bảng mã lỗi có thể đổi, và test parity sẽ bắt được điều đó.')
}

process.exit(0)
