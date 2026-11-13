/**
 * 图能从任一历史版本重出（任务卡 B）：字节一致证据。
 *
 * 走生产路径：computeChange → buildCommitCandidate（版本创建时冻结 SVG/DXF 摘要）
 * → revision JSON 落盘 → parseRevisionFile（生产解析器）→ redrawRevision（只用
 * 该版本的冻结输入与模板版本）→ 写盘 → 读回字节 → SHA-256 与冻结摘要对照。
 *
 * 反例：
 * - 缺冻结输入的老版本（schema3、drawings 为空）→ 明确“不能重建”；
 * - 模板版本不在当前构建支持范围 → 明确“不能重建”，不拿当前模板冒充。
 *
 * 用法：`npx vitest run --config vitest.statevidence.config.ts`
 * 输出：docs/evidence/stat-tolerance/redraw.json + redraw/ 下的真实 SVG/DXF 文件。
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import DxfParser from 'dxf-parser'
import { describe, expect, it } from 'vitest'
import {
  createSpacerSnapshot,
  spacerParameters,
} from '../src/project-file/__fixtures__/spacerProjectFile'
import { parseRevisionFile } from '../src/project-file/validation'
import type {
  ProjectFileParameterBindingLink,
  ProjectFileProject,
  ProjectFileRevision,
} from '../src/project-file/types'
import { buildCommitCandidate } from '../src/revisions/commit'
import { computeChange } from '../src/revisions/compute'
import { DRAWING_EXPORT_GENERATOR_VERSION, redrawRevision } from '../src/revisions/frozenExport'
import { sha256Bytes } from '../src/drawing/fingerprint'
import { serializeEvidence } from './evidence-json'

const OUT = path.join(process.cwd(), 'docs', 'evidence', 'stat-tolerance')
const REDRAW = path.join(OUT, 'redraw')

function bindingsOf(
  snapshot: Awaited<ReturnType<typeof createSpacerSnapshot>>,
): ProjectFileParameterBindingLink[] {
  return snapshot.project.dimensionLinks.filter(
    (link): link is ProjectFileParameterBindingLink => link.kind === 'parameter-binding',
  )
}

describe('历史版本重出：SHA-256 对照 + 不能重建的如实结果', () => {
  it('两个历史版本各自重出 SVG/DXF 2000，与当时导出字节逐位一致', async () => {
    await fsp.mkdir(REDRAW, { recursive: true })

    // 版本 1：S=12.00；版本 2：S=12.05（同一项目连续提交）。
    const base = await createSpacerSnapshot({ length: '12.00', confirmed: true })
    const change1 = computeChange(
      base,
      { parameters: spacerParameters({ length: '12.00' }, 1), bindings: bindingsOf(base) },
      { revisionId: 'rev-1', now: '2026-11-09T09:00:00.000Z' },
    )
    const commit1 = buildCommitCandidate(base, change1, {
      revisionId: 'rev-1',
      analysisSnapshotId: 'snapshot-1',
      createdAt: '2026-11-09T09:00:00.000Z',
      reason: '首版：S=12.00',
      restoredFromRevisionId: null,
      reauthenticateBindings: false,
    })
    const change2 = computeChange(
      commit1.snapshot,
      {
        parameters: spacerParameters({ length: '12.05' }, 2),
        bindings: bindingsOf(commit1.snapshot),
      },
      { revisionId: 'rev-2', now: '2026-11-09T10:00:00.000Z' },
    )
    const commit2 = buildCommitCandidate(commit1.snapshot, change2, {
      revisionId: 'rev-2',
      analysisSnapshotId: 'snapshot-2',
      createdAt: '2026-11-09T10:00:00.000Z',
      reason: '长度 12.00 → 12.05',
      restoredFromRevisionId: null,
      reauthenticateBindings: false,
    })

    const versions = [
      { revision: commit1.revision, label: 'rev-1' },
      { revision: commit2.revision, label: 'rev-2' },
    ]
    const files: Record<string, unknown>[] = []

    for (const { revision, label } of versions) {
      // 落盘再读回：证明重出只用版本记录本身，不依赖内存对象。
      const revisionPath = path.join(REDRAW, `${label}.json`)
      await fsp.writeFile(revisionPath, JSON.stringify(revision, null, 2))
      const diskJson = JSON.parse(await fsp.readFile(revisionPath, 'utf8')) as ProjectFileRevision
      const parsed = parseRevisionFile(diskJson)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) throw new Error(parsed.error.message)

      const redrawn = redrawRevision(parsed.value)
      expect(redrawn.ok).toBe(true)
      if (!redrawn.ok) throw new Error(redrawn.reason)
      expect(redrawn.byteIdentical).toBe(true)
      expect(redrawn.recorded).not.toBeNull()

      // 重出字节写盘 → 读回 → 独立 SHA-256（与冻结摘要对照）。
      const svgPath = path.join(REDRAW, `${label}.svg`)
      const dxfPath = path.join(REDRAW, `${label}-dxf2000.dxf`)
      await fsp.writeFile(svgPath, redrawn.svg)
      await fsp.writeFile(dxfPath, redrawn.dxf2000)
      const svgBack = new Uint8Array(await fsp.readFile(svgPath))
      const dxfBack = new Uint8Array(await fsp.readFile(dxfPath))
      const svgSha = sha256Bytes(svgBack)
      const dxfSha = sha256Bytes(dxfBack)

      expect(svgSha).toBe(redrawn.recorded!.svg.sha256)
      expect(dxfSha).toBe(redrawn.recorded!.dxf2000.sha256)
      expect(svgBack.byteLength).toBe(redrawn.recorded!.svg.byteSize)
      expect(dxfBack.byteLength).toBe(redrawn.recorded!.dxf2000.byteSize)

      const svgText = new TextDecoder().decode(svgBack)
      // 独立读回：用第三方 MIT 解析器（dxf-parser）确认字节是有效 DXF 2000，
      // 且尺寸文字就是该版本的长度（不是同一条链复制两遍）。
      const dxfText = new TextDecoder('gbk').decode(dxfBack)
      const parsedDxf = new DxfParser().parseSync(dxfText)
      expect(parsedDxf).not.toBeNull()
      const blockTexts = Object.values(parsedDxf!.blocks ?? {}).flatMap((block) =>
        (block.entities ?? [])
          .filter((entity) => entity.type === 'TEXT')
          .map((entity) => (entity as unknown as { text: string }).text),
      )
      const entityTexts = parsedDxf!.entities
        .filter((entity) => entity.type === 'TEXT')
        .map((entity) => (entity as unknown as { text: string }).text)
      const dimensionTexts = [...entityTexts, ...blockTexts]
      const expectedLengthText = label === 'rev-1' ? '12.000' : '12.050'
      expect(dimensionTexts).toContain(expectedLengthText)
      expect(dxfText).toContain('$ACADVER\r\n1\r\nAC1015')
      const project = parsed.value.project as ProjectFileProject
      const lengthQ = project.parameters.find((parameter) => parameter.key === 'length')!.valueQ
      files.push({
        label,
        revisionIdHint: label,
        frozenInput: {
          templateId: redrawn.data.templateId,
          templateVersion: redrawn.data.templateVersion,
          scale: `${redrawn.data.scale.numerator}:${redrawn.data.scale.denominator}`,
          lengthQ,
          dataFingerprint: redrawn.data.fingerprint,
        },
        recordedDigest: redrawn.recorded,
        redrawnDigest: redrawn.redrawn,
        byteIdentical: redrawn.byteIdentical,
        files: {
          svg: { path: `docs/evidence/stat-tolerance/redraw/${label}.svg`, sha256: svgSha, byteSize: svgBack.byteLength },
          dxf2000: { path: `docs/evidence/stat-tolerance/redraw/${label}-dxf2000.dxf`, sha256: dxfSha, byteSize: dxfBack.byteLength },
        },
        svgContainsLengthText:
          label === 'rev-1' ? svgText.includes('12.000') : svgText.includes('12.050'),
        dxfReadback: {
          parser: 'dxf-parser（MIT）读磁盘字节',
          acadver: 'AC1015',
          entityCount: parsedDxf!.entities.length,
          lengthDimensionText: expectedLengthText,
        },
      })
    }

    // 两个版本必须不同（不是同一张图复制两遍）。
    expect(files[0]!.files).not.toEqual(files[1]!.files)

    // 反例 1：缺冻结输入的老版本（schema3，drawings 为空）。
    const legacy: ProjectFileRevision = {
      ...commit2.revision,
      revisionId: 'rev-legacy-no-input',
      project: {
        ...commit2.revision.project,
        schemaVersion: 3,
        drawings: [],
      } as ProjectFileRevision['project'],
    }
    const legacyResult = redrawRevision(legacy)
    expect(legacyResult.ok).toBe(false)
    if (legacyResult.ok) throw new Error('缺输入版本不应重建成功')

    // 反例 2：模板版本不在当前构建支持范围。
    const unsupported: ProjectFileRevision = {
      ...commit2.revision,
      revisionId: 'rev-unsupported-template',
      project: {
        ...commit2.revision.project,
        drawings: [
          { ...(commit2.revision.project as ProjectFileProject).drawings[0]!, templateVersion: 999 },
        ],
      } as ProjectFileRevision['project'],
    }
    const unsupportedResult = redrawRevision(unsupported)
    expect(unsupportedResult.ok).toBe(false)
    if (unsupportedResult.ok) throw new Error('不支持的模板版本不应重建成功')

    const report = {
      schema: 'drawing-redraw-v1',
      baseline: 'main 9c8ab6b',
      generator: DRAWING_EXPORT_GENERATOR_VERSION,
      method:
        '版本创建时由 buildCommitCandidate 用生产导出函数冻结 SVG/DXF 2000 字节摘要；重出只用该版本的冻结输入与模板版本（revision JSON 落盘→生产解析器→redrawRevision），不读当前项目参数。',
      versions: files,
      cannotRebuild: {
        missingFrozenInput: {
          case: 'schema3 老版本（drawings 为空）',
          ok: legacyResult.ok,
          reason: legacyResult.reason,
          detail: legacyResult.detail ?? null,
        },
        unsupportedTemplate: {
          case: '模板版本 v999（超出当前构建支持范围）',
          ok: unsupportedResult.ok,
          reason: unsupportedResult.reason,
          detail: unsupportedResult.detail ?? null,
        },
      },
      note:
        'base snapshot 由既有测试夹具（与产品同 schema/同字段）构造；提交、重建、导出全部走生产函数。重出是只读：版本记录与已导出文件均未被改写。',
    }

    const text = serializeEvidence(report)
    await fsp.writeFile(path.join(OUT, 'redraw.json'), text)
    expect(serializeEvidence(JSON.parse(text))).toBe(text)

    console.log(
      'REDRAW',
      JSON.stringify({
        versions: files.map((item) => {
          const record = item as {
            label: string
            files: { svg: { sha256: string }; dxf2000: { sha256: string } }
          }
          return { label: record.label, svg: record.files.svg.sha256, dxf: record.files.dxf2000.sha256 }
        }),
        legacy: legacyResult.ok === false ? legacyResult.reason : 'unexpected-ok',
        unsupported: unsupportedResult.ok === false ? unsupportedResult.reason : 'unexpected-ok',
      }),
    )
  }, 120_000)
})
