import { describe, expect, it } from 'vitest'
import {
  createSpacerSnapshot,
  spacerParameters,
} from '../project-file/__fixtures__/spacerProjectFile'
import { SAMPLE_PROJECT_ID } from '../project-file/__fixtures__/sampleProjectFile'
import { parseRevisionFile } from '../project-file/validation'
import type {
  ProjectFileParameterBindingLink,
  ProjectFileProject,
  ProjectFileRevision,
} from '../project-file/types'
import { buildCommitCandidate } from './commit'
import { computeChange } from './compute'
import {
  DRAWING_EXPORT_GENERATOR_VERSION,
  computeDrawingExportDigest,
  drawingExportBytes,
  redrawRevision,
  revisionRebuildability,
} from './frozenExport'

function bindingsOf(
  snapshot: Awaited<ReturnType<typeof createSpacerSnapshot>>,
): ProjectFileParameterBindingLink[] {
  return snapshot.project.dimensionLinks.filter(
    (link): link is ProjectFileParameterBindingLink => link.kind === 'parameter-binding',
  )
}

/** 走生产路径：computeChange → buildCommitCandidate，产生带冻结导出摘要的版本。 */
async function commitTwice(): Promise<{ first: ProjectFileRevision; second: ProjectFileRevision }> {
  const base = await createSpacerSnapshot({ length: '12.00', confirmed: true })
  const firstChange = computeChange(
    base,
    { parameters: spacerParameters({ length: '12.00' }, 1), bindings: bindingsOf(base) },
    { revisionId: 'rev-1', now: '2026-11-09T09:00:00.000Z' },
  )
  const first = buildCommitCandidate(base, firstChange, {
    revisionId: 'rev-1',
    analysisSnapshotId: 'snap-1',
    createdAt: '2026-11-09T09:00:00.000Z',
    reason: '首版',
    restoredFromRevisionId: null,
    reauthenticateBindings: false,
  })

  const secondChange = computeChange(
    first.snapshot,
    { parameters: spacerParameters({ length: '12.05' }, 2), bindings: bindingsOf(first.snapshot) },
    { revisionId: 'rev-2', now: '2026-11-09T10:00:00.000Z' },
  )
  const second = buildCommitCandidate(first.snapshot, secondChange, {
    revisionId: 'rev-2',
    analysisSnapshotId: 'snap-2',
    createdAt: '2026-11-09T10:00:00.000Z',
    reason: '长度 12.00 → 12.05',
    restoredFromRevisionId: null,
    reauthenticateBindings: false,
  })
  return { first: first.revision, second: second.revision }
}

describe('B：历史版本重出与当时导出字节一致', () => {
  it('版本创建时冻结 SVG/DXF 2000 摘要，摘要与同源字节相同', async () => {
    const { first } = await commitTwice()
    const digest = first.evidence?.drawingExports
    expect(digest).toBeDefined()
    expect(digest!.generatorVersion).toBe(DRAWING_EXPORT_GENERATOR_VERSION)
    expect(digest!.templateVersion).toBe(1)
    expect(digest!.svg.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(digest!.dxf2000.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(digest!.svg.byteSize).toBeGreaterThan(0)
    expect(digest!.dxf2000.byteSize).toBeGreaterThan(0)
  })

  it('两个历史版本各自重出 SVG/DXF 2000：SHA-256 与冻结摘要逐一相同', async () => {
    const { first, second } = await commitTwice()
    for (const revision of [first, second]) {
      const redrawn = redrawRevision(revision)
      expect(redrawn.ok).toBe(true)
      if (!redrawn.ok) continue
      expect(redrawn.byteIdentical).toBe(true)
      expect(redrawn.recorded).not.toBeNull()
      expect(redrawn.redrawn.svg.sha256).toBe(redrawn.recorded!.svg.sha256)
      expect(redrawn.redrawn.dxf2000.sha256).toBe(redrawn.recorded!.dxf2000.sha256)
      expect(redrawn.svg.byteLength).toBe(redrawn.recorded!.svg.byteSize)
      expect(redrawn.dxf2000.byteLength).toBe(redrawn.recorded!.dxf2000.byteSize)
    }
  })

  it('重出用该版本冻结参数，不是当前参数：12.000 与 12.050 各自还原', async () => {
    const { first, second } = await commitTwice()
    const firstRedraw = redrawRevision(first)
    const secondRedraw = redrawRevision(second)
    expect(firstRedraw.ok).toBe(true)
    expect(secondRedraw.ok).toBe(true)
    if (!firstRedraw.ok || !secondRedraw.ok) return

    const firstSvg = new TextDecoder().decode(firstRedraw.svg)
    const secondSvg = new TextDecoder().decode(secondRedraw.svg)
    expect(firstSvg).toContain('12.000')
    expect(firstSvg).not.toContain('12.050')
    expect(secondSvg).toContain('12.050')
    // 两个版本的字节必须不同（不是同一张图复制两遍）。
    expect(firstRedraw.redrawn.svg.sha256).not.toBe(secondRedraw.redrawn.svg.sha256)
    expect(firstRedraw.redrawn.dxf2000.sha256).not.toBe(secondRedraw.redrawn.dxf2000.sha256)
    // 重出是只读：原记录的指纹与摘要没被改写。
    expect((first.project as ProjectFileProject).drawings[0]!.dataFingerprint).toBe(firstRedraw.data.fingerprint)
    expect(first.evidence!.drawingExports).toEqual(firstRedraw.recorded)
  })

  it('版本记录经 JSON 往返 + 生产解析器校验后，重出字节仍逐位相同', async () => {
    const { second } = await commitTwice()
    const roundTripped = JSON.parse(JSON.stringify(second)) as ProjectFileRevision
    const parsed = parseRevisionFile(roundTripped)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const direct = redrawRevision(second)
    const fromDisk = redrawRevision(parsed.value)
    expect(direct.ok).toBe(true)
    expect(fromDisk.ok).toBe(true)
    if (!direct.ok || !fromDisk.ok) return
    expect(fromDisk.redrawn).toEqual(direct.redrawn)
    expect(fromDisk.redrawn.svg.sha256).toBe(second.evidence!.drawingExports!.svg.sha256)
    // 生产解析器保留了冻结摘要（schema 纯加法字段）。
    expect(parsed.value.evidence?.drawingExports).toEqual(second.evidence?.drawingExports)
  })

  it('缺冻结输入的老版本明确报“不能重建”，不拿当前数据凑图', async () => {
    const { second } = await commitTwice()
    const legacy: ProjectFileRevision = {
      ...second,
      revisionId: 'rev-legacy',
      project: {
        ...second.project,
        schemaVersion: 3,
        drawings: [],
      } as ProjectFileRevision['project'],
    }
    const rebuildable = revisionRebuildability(legacy)
    expect(rebuildable.ok).toBe(false)
    if (rebuildable.ok) return
    expect(rebuildable.reason).toContain('该版本没有冻结图纸输入')
    expect(rebuildable.reason).toContain('不能重建')

    const redrawn = redrawRevision(legacy)
    expect(redrawn.ok).toBe(false)
    if (redrawn.ok) return
    expect(redrawn.reason).toContain('不能重建')
  })

  it('模板版本不受支持时报“不能重建”，不拿当前模板冒充（M58 判据）', async () => {
    const { second } = await commitTwice()
    const oldTemplate: ProjectFileRevision = {
      ...second,
      project: {
        ...second.project,
        drawings: [{ ...(second.project as ProjectFileProject).drawings[0]!, templateVersion: 999 }],
      } as ProjectFileRevision['project'],
    }
    const rebuildable = revisionRebuildability(oldTemplate)
    expect(rebuildable.ok).toBe(false)
    if (rebuildable.ok) return
    expect(rebuildable.reason).toContain('v999')
    expect(rebuildable.reason).toContain('不拿当前模板冒充旧图')
    expect(redrawRevision(oldTemplate).ok).toBe(false)
  })

  it('冻结摘要被改动时报字节不一致（真比对，不是自证）', async () => {
    const { second } = await commitTwice()
    const tampered: ProjectFileRevision = {
      ...second,
      evidence: {
        ...second.evidence!,
        drawingExports: {
          ...second.evidence!.drawingExports!,
          svg: { ...second.evidence!.drawingExports!.svg, sha256: 'a'.repeat(64) },
        },
      },
    }
    const redrawn = redrawRevision(tampered)
    expect(redrawn.ok).toBe(false)
    if (redrawn.ok) return
    expect(redrawn.reason).toContain('重出字节与冻结导出摘要不一致')
    expect(redrawn.detail).toContain('svg')
  })

  it('导出摘要与版本记录同源：同一份数据算出的摘要稳定', async () => {
    const { first } = await commitTwice()
    const redrawn = redrawRevision(first)
    expect(redrawn.ok).toBe(true)
    if (!redrawn.ok) return
    const again = computeDrawingExportDigest(redrawn.data)
    expect(again).toEqual(redrawn.redrawn)
    const bytes = drawingExportBytes(redrawn.data)
    expect(bytes.svg.byteLength).toBe(redrawn.recorded!.svg.byteSize)
    expect(bytes.dxf2000.byteLength).toBe(redrawn.recorded!.dxf2000.byteSize)
  })

  it('当前项目的映射不参与重出：换掉 project.id 之外的当前参数也不影响旧版', async () => {
    const { first, second } = await commitTwice()
    // 模拟“当前项目”已变成 12.05：旧版本记录里仍是 12.00 的冻结参数。
    const firstProject = first.project as ProjectFileProject
    const secondProject = second.project as ProjectFileProject
    expect(
      firstProject.parameters.find((parameter) => parameter.key === 'length')!.valueQ,
    ).toBe(120000)
    expect(
      secondProject.parameters.find((parameter) => parameter.key === 'length')!.valueQ,
    ).toBe(120500)
    expect(first.project.id).toBe(SAMPLE_PROJECT_ID)
    const redrawn = redrawRevision(first)
    expect(redrawn.ok).toBe(true)
    if (!redrawn.ok) return
    expect(redrawn.data.parameterSnapshot.find((item) => item.key === 'length')!.valueQ).toBe(
      120000,
    )
  })
})
