/**
 * 真实文档基线回归测试（专用配置 vitest.realdocs.config.ts，不进默认 npm test）。
 *
 * 三件事：
 * 1. 语料按 manifest 的字节数/SHA-256 校验；缺失报 CORPUS_MISSING，被替换报 CORPUS_MISMATCH，
 *    绝不静默跳过、绝不用别的文件顶替。
 * 2. 用真实提取器重跑度量，与 docs/evidence/real-doc-baseline/baseline.json 逐项比对。
 *    数字一变测试就红：必须显式 `--update-baseline --reason "..."` 并说明原因。
 * 3. 提交的 metrics.json 必须与当前度量一致，防止手改证据。
 *
 * 不依赖网络。本机需自备 6 份真实 PDF（REAL_DOC_CORPUS，默认 ~/DSH/tmp/cunlian-v36/real-docs）；
 * CI 上没有语料时这个专用套件会以 CORPUS_MISSING 失败——这是有意的，不是跳过。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import {
  BASELINE_RELATIVE_PATH,
  CorpusError,
  MANIFEST_RELATIVE_PATH,
  METRICS_RELATIVE_PATH,
  defaultCorpusDir,
  diffMeasured,
  loadManifest,
  measuredPayload,
  measureCorpus,
  verifyCorpus,
} from './metrics.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const manifestPath = path.join(repoRoot, MANIFEST_RELATIVE_PATH)
const corpusDir = process.env.REAL_DOC_CORPUS ?? defaultCorpusDir()
const tempDirs: string[] = []

/** 与 metrics.mjs 的 diffMeasured 返回结构一致；显式标注，避免 any 漏进断言消息。 */
type DiffRow = { path: string; expected: unknown; actual: unknown }

const formatDiffs = (diffs: DiffRow[], limit: number, labelA: string, labelB: string): string =>
  diffs
    .slice(0, limit)
    .map(
      (diff: DiffRow) =>
        `  ${diff.path}: ${labelA}=${JSON.stringify(diff.expected)} ${labelB}=${JSON.stringify(diff.actual)}`,
    )
    .join('\n')

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

describe('真实文档语料校验', () => {
  it('manifest 的 6 份文件字节数与 SHA-256 必须全部吻合', () => {
    const manifest = loadManifest(manifestPath)
    const verified = verifyCorpus(manifest, corpusDir)
    expect(verified.map((item) => item.doc.id)).toEqual(['r1', 'r2', 'r3', 'r4', 'r5', 'r6'])
    for (const item of verified) {
      expect(item.sha256).toBe(item.doc.sha256)
      expect(item.bytes.byteLength).toBe(item.doc.bytes)
    }
  })

  it('语料缺失报 CORPUS_MISSING，不跳过', () => {
    const emptyDir = tempDir('real-doc-empty-')
    const manifest = loadManifest(manifestPath)
    let error: unknown
    try {
      verifyCorpus(manifest, emptyDir)
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(CorpusError)
    expect((error as CorpusError).code).toBe('CORPUS_MISSING')
    expect((error as CorpusError).message).toContain('r1-assembly-course.pdf')
  })

  it('语料被替换（字节数相同、内容不同）报 CORPUS_MISMATCH', () => {
    const tamperedDir = tempDir('real-doc-tampered-')
    const manifest = loadManifest(manifestPath)
    for (const doc of manifest.documents) {
      const sourcePath = path.join(corpusDir, doc.file)
      const targetPath = path.join(tamperedDir, doc.file)
      if (doc.id === 'r3') {
        mkdirSync(path.dirname(targetPath), { recursive: true })
        // 只翻一个字节：字节数不变，SHA-256 变化 —— 正是 CORPUS_MISMATCH 要抓的情形
        const bytes = readFileSync(sourcePath)
        const index = Math.floor(bytes.length / 2)
        bytes[index] = bytes[index] ^ 0xff
        writeFileSync(targetPath, bytes)
      } else {
        symlinkSync(sourcePath, targetPath)
      }
    }
    let error: unknown
    try {
      verifyCorpus(manifest, tamperedDir)
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(CorpusError)
    expect((error as CorpusError).code).toBe('CORPUS_MISMATCH')
    expect((error as CorpusError).message).toContain('r3-rv-3dcs.pdf')
  })
})

describe('真实文档度量与基线', () => {
  it(
    '度量必须与 baseline.json 完全一致（数字变化须显式更新基线并说明原因）',
    async () => {
      const measured = await measureCorpus({ manifestPath, corpusDir })
      const baseline = JSON.parse(readFileSync(path.join(repoRoot, BASELINE_RELATIVE_PATH), 'utf8'))
      expect(typeof baseline.baselineReason).toBe('string')
      expect(baseline.baselineReason.trim()).not.toBe('')
      const diffs = diffMeasured(measuredPayload(measured), measuredPayload(baseline))
      if (diffs.length > 0) {
        throw new Error(
          `真实文档度量与基线差 ${diffs.length} 处；数字变化必须显式更新基线并说明原因：\n` +
            `${formatDiffs(diffs, 40, '基线', '实测')}\n` +
            '确认是有意的规则/阈值/语料/依赖变化后运行：\n' +
            '  node scripts/real-doc-metrics.mjs --update-baseline --reason "<为什么变化>"',
        )
      }
      expect(diffs).toEqual([])
      expect(measured.summary.correctness).toEqual({pendingChecked:19,wrongPending:0,wrongRate:0})
      expect(measured.summary.documents).toBe(6)
      expect(measured.summary.candidates.confirmed).toBe(0)
    },
    180_000,
  )

  it(
    '提交的 metrics.json 必须与当前度量一致（防止手改证据）',
    async () => {
      const measured = await measureCorpus({ manifestPath, corpusDir })
      const committed = JSON.parse(readFileSync(path.join(repoRoot, METRICS_RELATIVE_PATH), 'utf8'))
      const diffs = diffMeasured(measuredPayload(measured), measuredPayload(committed))
      if (diffs.length > 0) {
        throw new Error(
          `metrics.json 与当前度量差 ${diffs.length} 处；请重新运行 node scripts/real-doc-metrics.mjs：\n` +
            formatDiffs(diffs, 20, '文件', '实测'),
        )
      }
      expect(diffs).toEqual([])
    },
    180_000,
  )
})
