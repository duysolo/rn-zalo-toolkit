#!/usr/bin/env node
/**
 * Chép README + LICENSE của repo vào thư mục package ngay trước khi pack.
 *
 * npm chỉ hiển thị README nằm TRONG package, mà giữ hai bản README song song thì chúng sẽ
 * lệch nhau sau vài tháng. Bản trong package được `.gitignore` - nó là artefact, không phải
 * nguồn.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const target = process.argv[2]

if (!target) {
  console.error('dùng: node scripts/prepack-readme.mjs <đường-dẫn-package-tương-đối>')
  process.exit(2)
}

const destDir = path.join(ROOT, target)
if (!fs.existsSync(destDir)) {
  console.error(`không tìm thấy package: ${destDir}`)
  process.exit(2)
}

for (const file of ['README.md', 'LICENSE']) {
  const source = path.join(ROOT, file)
  if (!fs.existsSync(source)) {
    console.error(`thiếu ${file} ở gốc repo`)
    process.exit(1)
  }
  fs.copyFileSync(source, path.join(destDir, file))
  console.log(`· ${file} → ${target}/`)
}
