/**
 * 平台防腐层证据（脱敏部分）：Windows 路径必须被替换、非路径文本必须原样保留。
 *
 * 走产品同一函数 `redactText` / `sensitiveFindings`；用例表与断言同源，输出
 * docs/evidence/platform-seam/redaction.json（serializeEvidence）。
 *
 * 用法：`npx vitest run --config vitest.platformseam.config.ts`
 *
 * 注意：macOS 路径用例只在单测里断言（`src/agent/redact.test.ts`），不写进证据 JSON ——
 * 证据守卫禁止 JSON 里出现机器绝对路径。
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { redactText, sensitiveFindings } from '../src/agent/redact'
import { serializeEvidence } from './evidence-json'

const OUT = path.join(process.cwd(), 'docs', 'evidence', 'platform-seam')

interface Case {
  id: string
  input: string
  expected: string
  /** 期望被脱敏（true）还是原样保留（false）。 */
  redacted: boolean
}

const cases: Case[] = [
  { id: 'drive-backslash', input: 'C:\\Users\\aston\\报告.pdf', expected: '<path>', redacted: true },
  { id: 'drive-other-letter', input: 'D:\\data\\raw\\a.csv', expected: '<path>', redacted: true },
  { id: 'drive-forward-slash', input: 'C:/work/project/a.txt', expected: '<path>', redacted: true },
  { id: 'drive-dir-with-space', input: 'C:\\Program Files\\Cunlian\\app.exe', expected: '<path>', redacted: true },
  { id: 'unc-share', input: '\\\\server\\share\\docs\\a.pdf', expected: '<path>', redacted: true },
  { id: 'unc-inline', input: '打开 \\\\nas-01\\design\\2026\\b.dxf 后', expected: '打开 <path> 后', redacted: true },
  { id: 'env-appdata', input: '%APPDATA%\\vendor\\keys.json', expected: '<path>', redacted: true },
  { id: 'env-localappdata', input: '%LOCALAPPDATA%\\Temp\\x.log', expected: '<path>', redacted: true },
  { id: 'env-lowercase', input: '%appdata%\\lower\\case.json', expected: '<path>', redacted: true },
  { id: 'env-userprofile', input: '%USERPROFILE%\\Documents\\a.pdf', expected: '<path>', redacted: true },
  { id: 'env-temp-bare', input: '%TEMP%', expected: '<path>', redacted: true },
  { id: 'prose-after-path', input: '已保存到 C:\\Users\\aston\\a.txt 请查看', expected: '已保存到 <path> 请查看', redacted: true },
  { id: 'prose-after-path-cjk-punct', input: 'C:\\Users\\aston\\a.txt，请查看', expected: '<path>，请查看', redacted: true },
  { id: 'not-a-drive-three-letters', input: 'ABC:\\x', expected: 'ABC:\\x', redacted: false },
  { id: 'not-a-drive-ratio', input: '比例 a:b，时间 12:30', expected: '比例 a:b，时间 12:30', redacted: false },
  { id: 'not-a-path-url', input: '见 https://example.com/a/b', expected: '见 https://example.com/a/b', redacted: false },
  { id: 'not-a-path-bare-drive-root', input: '驱动器 C:\\ 未就绪', expected: '驱动器 C:\\ 未就绪', redacted: false },
  { id: 'not-a-path-relative', input: 'docs/evidence/a.json', expected: 'docs/evidence/a.json', redacted: false },
  { id: 'not-a-path-escapes', input: '换行符写成 \\n，转义写成 \\"', expected: '换行符写成 \\n，转义写成 \\"', redacted: false },
  { id: 'dimension-text', input: 'H 52.2 ±0.02 / B1 20 ±0.01', expected: 'H 52.2 ±0.02 / B1 20 ±0.01', redacted: false },
]

describe('平台防腐层证据：脱敏补 Windows 路径', () => {
  it('用例表逐条断言并落 JSON', async () => {
    const rows = cases.map((item) => {
      const output = redactText(item.input)
      expect(output, `${item.id} 的脱敏结果`).toBe(item.expected)
      const findings = [...new Set(sensitiveFindings(item.input))]
      if (item.redacted) expect(findings, `${item.id} 的 sensitiveFindings`).toContain('absolute path')
      else expect(findings, `${item.id} 的 sensitiveFindings`).not.toContain('absolute path')
      return { id: item.id, input: item.input, output, redacted: item.redacted, findings }
    })
    const report = {
      generator: 'platform-seam-redaction-1',
      note: 'macOS 路径（用户主目录、私有临时目录根）用例在 src/agent/redact.test.ts 断言，不写进本 JSON（证据守卫禁止机器绝对路径）',
      cases: rows,
      summary: {
        total: rows.length,
        redacted: rows.filter((row) => row.redacted).length,
        untouched: rows.filter((row) => !row.redacted).length,
        failures: rows.filter((row) => row.output !== row.input && !row.redacted).length,
      },
    }
    await fsp.mkdir(OUT, { recursive: true })
    const text = serializeEvidence(report)
    expect(serializeEvidence(JSON.parse(text))).toBe(text)
    await fsp.writeFile(path.join(OUT, 'redaction.json'), text)
  })
})
