#!/usr/bin/env node
/**
 * 泄漏守卫：证据/日志里不许出现图片 base64 或 data URI。
 *
 * 只扫文本产物（json/md/log/txt/csv/svg），不扫 fixtures 下的二进制图片本身。
 * 判定：连续 ≥512 个 base64 字符，或出现 data:image/<fmt>;base64,。
 *
 * 运行：node scripts/sketch-leak-guard.mjs [目录...]
 * 退出码：0 = 无泄漏；1 = 有泄漏（打印文件与命中片段）。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

const roots = process.argv.slice(2)
const targets = roots.length > 0 ? roots : ['docs/evidence/sketch-input']
const TEXT = /\.(json|md|log|txt|csv|svg)$/iu
const BASE64_RUN = /[A-Za-z0-9+/]{512,}={0,2}/u
const DATA_URI = /data:image\/[a-z0-9.+-]+;base64,/iu
/** 图片魔数的 base64 前缀（PNG / JPEG / GIF）；后面还跟着成串 base64 就是泄漏。 */
const IMAGE_B64 = /(?:iVBORw0KGgo|\/9j\/(?:4AAQ|[A-Za-z0-9+/]{4})|R0lGODlh)[A-Za-z0-9+/=]{64,}/u

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
  const files = []
  for (const entry of entries) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'fixtures') continue // 合成图片本体，不是泄漏
      files.push(...await walk(full))
    } else if (TEXT.test(entry.name)) files.push(full)
  }
  return files
}

const leaks = []
for (const root of targets) {
  for (const file of await walk(root)) {
    const text = await fs.readFile(file, 'utf8')
    const base64 = BASE64_RUN.exec(text) ?? IMAGE_B64.exec(text)
    const dataUri = DATA_URI.exec(text)
    if (base64 !== null || dataUri !== null) {
      leaks.push({ file, kind: dataUri !== null ? 'data-uri' : 'base64-run',
        sample: (base64?.[0] ?? dataUri?.[0] ?? '').slice(0, 48) + '…' })
    }
  }
}

if (leaks.length > 0) {
  console.error(JSON.stringify({ verdict: 'fail', leaks }, null, 2))
  process.exitCode = 1
} else {
  console.log(JSON.stringify({ verdict: 'pass', scanned: targets,
    note: '证据/日志中没有图片 base64 或 data URI。' }, null, 2))
}
