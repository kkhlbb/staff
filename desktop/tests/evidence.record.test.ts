/**
 * D 证据生成的回归：只校验“生成出来的字节符合预期”。
 *
 * 证据写临时目录（os.tmpdir()），跑完删掉；仓库里的
 * `docs/evidence/V3-D/commit/` 一个字节都不碰。
 * 需要真正刷新仓库证据时，人工运行 `npm run evidence:record`。
 */
import { createHash } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { decodeProjectFile } from '../../src/project-file/codec'
import { SPACER_PARAMETER_IDS } from '../../src/drawing/types'
import { recordEvidence, type EvidenceRecordResult } from './helpers/evidenceRecord'

const REPO_EVIDENCE = fileURLToPath(new URL('../../docs/evidence/V3-D/', import.meta.url))
const COMMITTED = ['commit/before.cunlian', 'commit/after.cunlian', 'commit/summary.json']

async function sha256(file: string): Promise<string> {
  return createHash('sha256').update(await fsp.readFile(file)).digest('hex')
}

describe('D 证据生成：字节可校验，且单测不写仓库', () => {
  let outDir = ''
  const repoBefore = new Map<string, string>()
  let result: EvidenceRecordResult

  beforeAll(async () => {
    for (const relative of COMMITTED) {
      repoBefore.set(relative, await sha256(path.join(REPO_EVIDENCE, relative)))
    }
    outDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cunlian-evidence-'))
    result = await recordEvidence(outDir)
  })

  afterAll(async () => {
    if (outDir !== '') await fsp.rm(outDir, { recursive: true, force: true })
  })

  it('生成 5 个文件，全部位于给定临时目录', () => {
    expect([...result.files].sort()).toEqual([
      'commit/after.cunlian',
      'commit/before.cunlian',
      'commit/compare-diff.json',
      'commit/summary.json',
      'drawing-compare.html',
    ])
    for (const relative of result.files) {
      expect(path.isAbsolute(path.join(outDir, relative))).toBe(true)
      expect(path.relative(outDir, path.join(outDir, relative))).toBe(relative)
    }
  })

  it('before/after 字节与哈希：两版不同，哈希与文件内容一致', async () => {
    const before = new Uint8Array(await fsp.readFile(path.join(outDir, 'commit/before.cunlian')))
    const after = new Uint8Array(await fsp.readFile(path.join(outDir, 'commit/after.cunlian')))
    expect(before.byteLength).toBe(result.beforeBytes)
    expect(after.byteLength).toBe(result.afterBytes)
    expect(createHash('sha256').update(before).digest('hex')).toBe(result.beforeSha256)
    expect(createHash('sha256').update(after).digest('hex')).toBe(result.afterSha256)
    expect(result.afterSha256).not.toBe(result.beforeSha256)
  })

  it('after 文件可解码：长度 140000q、参数修订 2、父版本 rev-a1', async () => {
    const after = new Uint8Array(await fsp.readFile(path.join(outDir, 'commit/after.cunlian')))
    const decoded = await decodeProjectFile(after)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    const project = decoded.value.snapshot.project
    const length = project.parameters.find(
      (item) => item.parameterId === SPACER_PARAMETER_IDS.length,
    )
    expect(length?.valueQ).toBe(140000)
    expect(length?.parameterRevision).toBe(2)
    const term = project.dimensionChain.terms.find((item) => item.id === 't-s')
    expect(term?.nominalQ).toBe(140000)
    expect(project.drawings[0]?.templateVersion).toBe(1)

    const summary = JSON.parse(
      await fsp.readFile(path.join(outDir, 'commit/summary.json'), 'utf8'),
    ) as {
      beforeSha256: string
      afterSha256: string
      revisionId: string
      parentId: string | null
      currentRevisionId: string
      spacerNominalQ: number
      parameters: { parameterId: string; valueQ: number; parameterRevision: number }[]
      analysisSnapshotId: string | null
      eventIds: string[]
      fileRevisions: number
    }
    expect(summary.beforeSha256).toBe(result.beforeSha256)
    expect(summary.afterSha256).toBe(result.afterSha256)
    expect(summary.parentId).toBe('rev-a1')
    expect(summary.currentRevisionId).toBe(summary.revisionId)
    expect(summary.spacerNominalQ).toBe(140000)
    expect(summary.parameters).toContainEqual({
      parameterId: SPACER_PARAMETER_IDS.length,
      valueQ: 140000,
      parameterRevision: 2,
    })
    expect(summary.analysisSnapshotId).not.toBeNull()
    expect(summary.eventIds.length).toBeGreaterThan(0)
    expect(summary.fileRevisions).toBe(2)
  })

  it('双图 HTML 与 compare-diff.json：由真实 DrawingData 渲染', async () => {
    const html = await fsp.readFile(path.join(outDir, 'drawing-compare.html'), 'utf8')
    expect(html).toContain('旧版本 rev-a1')
    expect(html.match(/<svg/g)?.length).toBe(2)
    const diff = JSON.parse(
      await fsp.readFile(path.join(outDir, 'commit/compare-diff.json'), 'utf8'),
    ) as { scope: string; field: string }[]
    expect(Array.isArray(diff)).toBe(true)
    expect(diff.some((row) => row.scope === 'parameter')).toBe(true)
  })

  it('仓库里已提交的三个证据文件字节未变（单测不覆盖证据）', async () => {
    for (const relative of COMMITTED) {
      expect(await sha256(path.join(REPO_EVIDENCE, relative))).toBe(repoBefore.get(relative))
    }
  })
})
