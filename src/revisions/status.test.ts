import { describe, expect, it } from 'vitest'
import { createSpacerSnapshot, spacerParameters } from '../project-file/__fixtures__/spacerProjectFile'
import type { ChangeEvent } from '../history/events'
import type { ProjectFileParameterBindingLink, ProjectFileSnapshot } from '../project-file/types'
import { sourceBasisOf } from './digest'
import { computeChange } from './compute'
import {
  deriveReviewGroups,
  hasParameterBindings,
  parameterBindingStatusRowsWithSnapshot,
  parameterBindingWorkbenchRows,
} from './status'

function bindingsOf(snapshot: ProjectFileSnapshot): ProjectFileParameterBindingLink[] {
  return snapshot.project.dimensionLinks.filter(
    (link): link is ProjectFileParameterBindingLink => link.kind === 'parameter-binding',
  )
}

function rowsOf(snapshot: ProjectFileSnapshot, events: readonly ChangeEvent[] = snapshot.events) {
  return parameterBindingStatusRowsWithSnapshot(snapshot.project, events, (parameterId) => {
    const parameter = snapshot.project.parameters.find((item) => item.parameterId === parameterId)
    return sourceBasisOf(snapshot, parameter?.sourceNote)
  })
}

describe('D 派生状态：只由版本字段与完整确认事件决定', () => {
  it('完整凭据 → 有效；缺任一字段 → 待核并给出具体原因', async () => {
    const base = await createSpacerSnapshot({ length: '12.00', confirmed: true })
    expect(rowsOf(base)).toHaveLength(1)
    expect(rowsOf(base)[0]!.state).toBe('valid')
    expect(rowsOf(base)[0]!.reasons).toEqual([])

    // 改参数修订号（工程值来源变化）
    const bumpedParameter: ProjectFileSnapshot = {
      ...base,
      project: {
        ...base.project,
        parameters: base.project.parameters.map((parameter) =>
          parameter.key === 'length' ? { ...parameter, parameterRevision: 2 } : parameter,
        ),
      },
    }
    expect(rowsOf(bumpedParameter)[0]!.state).toBe('pending')
    expect(rowsOf(bumpedParameter)[0]!.reasons.join('；')).toContain('参数修订 2')

    // 改环修订号
    const bumpedTerm: ProjectFileSnapshot = {
      ...base,
      project: {
        ...base.project,
        dimensionChain: {
          ...base.project.dimensionChain,
          terms: base.project.dimensionChain.terms.map((term) =>
            term.id === 't-s' ? { ...term, termRevision: 2 } : term,
          ),
        },
      },
    }
    expect(rowsOf(bumpedTerm)[0]!.state).toBe('pending')
    expect(rowsOf(bumpedTerm)[0]!.reasons.join('；')).toContain('环修订 2')

    // 改图纸指纹
    const bumpedDrawing: ProjectFileSnapshot = {
      ...base,
      project: {
        ...base.project,
        drawings: base.project.drawings.map((drawing) => ({
          ...drawing,
          dataFingerprint: 'f'.repeat(64),
        })),
      },
    }
    expect(rowsOf(bumpedDrawing)[0]!.state).toBe('pending')
    expect(rowsOf(bumpedDrawing)[0]!.reasons.join('；')).toContain('图纸指纹')

    // 改来源备注（来源基准变化）
    const bumpedNote: ProjectFileSnapshot = {
      ...base,
      project: {
        ...base.project,
        parameters: base.project.parameters.map((parameter) =>
          parameter.key === 'length' ? { ...parameter, sourceNote: '新版图纸标注' } : parameter,
        ),
      },
    }
    expect(rowsOf(bumpedNote)[0]!.state).toBe('pending')
    expect(rowsOf(bumpedNote)[0]!.reasons.join('；')).toContain('来源基准')

    // 删除确认事件（旧数据）
    const withoutEvent: ProjectFileSnapshot = {
      ...base,
      events: base.events.filter((event) => event.type !== 'parameter_binding_confirmed'),
    }
    expect(rowsOf(withoutEvent)[0]!.state).toBe('pending')
    expect(rowsOf(withoutEvent)[0]!.reasons.join('；')).toContain('没有绑定确认事件')
  })

  it('数值相等不等于核对有效：环值与参数已同步但无凭据仍是待核', async () => {
    const base = await createSpacerSnapshot({ length: '12.00', confirmed: false })
    const row = rowsOf(base)[0]!
    expect(row.termNominalQ).toBe(row.parameterValueQ)
    expect(row.state).toBe('pending')
    expect(row.reasons.join('；')).toContain('没有绑定确认事件')
  })

  it('只有 B2 外形关联不等于已关联尺寸链', async () => {
    const base = await createSpacerSnapshot({ confirmed: false })
    const onlyVisual: ProjectFileSnapshot = {
      ...base,
      project: {
        ...base.project,
        dimensionLinks: [
          {
            kind: 'visual-reference',
            linkId: 'link-1',
            termId: 't-s',
            target: { granularity: 'part', partId: 'part-1', modelRevisionId: null },
            reviewStatus: 'confirmed',
            reviewedModelRevisionId: null,
            reviewedAt: null,
            reason: '',
          },
        ],
      },
    }
    expect(hasParameterBindings(onlyVisual.project)).toBe(false)
  })

  it('五类坏消息各自独立：受影响环/来源/关系/材料/计算同时可读', async () => {
    const base = await createSpacerSnapshot({ length: '12.00', confirmed: false, material: '' })
    // 目标区间外：长度 12.10 → [-0.05, 0.05] 不在 [0.1,0.3]。
    const computation = computeChange(
      base,
      { parameters: spacerParameters({ length: '12.10' }, 2), bindings: bindingsOf(base) },
      { revisionId: 'rev-b', now: '2026-11-09T09:00:00.000Z' },
    )
    const groups = deriveReviewGroups(base.project, {
      computation,
      availableBlobKeys: new Set(base.attachments.map((item) => item.blobKey)),
      documents: base.documents,
      revisions: base.revisions,
      sourceBindings: base.bindings,
    })
    expect(groups.unlinked).toBe(false)
    expect(groups.affectedTerms).toEqual([
      {
        termId: 't-s',
        termSymbol: 'S',
        beforeNominalQ: 120000,
        afterNominalQ: 121000,
        changed: true,
      },
    ])
    // 来源：reviewedTermRevision=null → 待人工。
    expect(groups.sourceReview.some((row) => row.ruleId === 'SOURCE_VALUE_REVIEWED')).toBe(true)
    // 关系：从未确认。
    expect(groups.relation.confirmed).toBe(false)
    expect(groups.relation.label).toBe('关系待核（从未确认）')
    // 材料缺失独立列出，不被来源/计算掩盖。
    expect(groups.materialMissing.map((row) => row.field)).toContain('material')
    // 计算不满足独立给出缺口与结果。
    expect(groups.calculation.status).toBe('outside')
    expect(groups.calculation.result!.minQ).toBe(500)
    expect(groups.calculation.result!.maxQ).toBe(1500)
    expect(groups.calculation.shortfallQ).toBe(-500)
    // 图纸仍然是待复核草稿，不因“能算”变成已批准。
    expect(groups.drawing.status).toBe('pending-review-draft')
    expect(groups.drawing.label).toContain('待复核草稿')
  })
})

describe('D 工作台行列表：只读合并草稿绑定，不把草稿当已确认', () => {
  const workbenchRows = (snapshot: ProjectFileSnapshot, draft: Parameters<typeof parameterBindingWorkbenchRows>[3]) =>
    parameterBindingWorkbenchRows(snapshot.project, snapshot.events, (parameterId) => {
      const parameter = snapshot.project.parameters.find((item) => item.parameterId === parameterId)
      return sourceBasisOf(snapshot, parameter?.sourceNote)
    }, draft)

  it('没有草稿：正式绑定仍按确认凭据派生（valid → 已确认生效）', async () => {
    const base = await createSpacerSnapshot({ length: '12.00', confirmed: true })
    const rows = workbenchRows(base, null)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.stage).toBe('confirmed')
    expect(rows[0]!.state).toBe('valid')
  })

  it('草稿新增绑定：标记 draft/pending，写明尚未确认提交，且不冒充有效', async () => {
    const base = await createSpacerSnapshot({ length: '12.00', confirmed: true })
    const original = bindingsOf(base)[0]!
    const draftBinding: ProjectFileParameterBindingLink = {
      ...original,
      bindingId: 'binding:draft-only',
      parameterId: 'param:spacer:inner-diameter',
    }
    const rows = workbenchRows(base, {
      bindings: [draftBinding],
      parameters: base.project.parameters,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.bindingId).toBe('binding:draft-only')
    expect(rows[0]!.stage).toBe('draft')
    expect(rows[0]!.state).toBe('pending')
    expect(rows[0]!.reasons).toContain('草稿态：尚未确认提交')
  })

  it('草稿未改动绑定且参数未变：沿用正式派生态', async () => {
    const base = await createSpacerSnapshot({ length: '12.00', confirmed: true })
    const rows = workbenchRows(base, {
      bindings: bindingsOf(base),
      parameters: base.project.parameters,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.stage).toBe('confirmed')
    expect(rows[0]!.state).toBe('valid')
  })

  it('草稿改了参数值：同一绑定降为草稿态，不沿用旧凭据', async () => {
    const base = await createSpacerSnapshot({ length: '12.00', confirmed: true })
    const rows = workbenchRows(base, {
      bindings: bindingsOf(base),
      parameters: spacerParameters({ length: '14.00' }, 2),
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.stage).toBe('draft')
    expect(rows[0]!.state).toBe('pending')
    expect(rows[0]!.parameterValueQ).toBe(140000)
    expect(rows[0]!.reasons).toContain('草稿态：尚未确认提交')
  })

  it('草稿只改来源备注（修订号不变）：同样降为草稿态，旧凭据不沿用', async () => {
    const base = await createSpacerSnapshot({ length: '12.00', confirmed: true })
    const rows = workbenchRows(base, {
      bindings: bindingsOf(base),
      parameters: base.project.parameters.map((parameter) =>
        parameter.key === 'length' ? { ...parameter, sourceNote: '新版图纸标注' } : parameter,
      ),
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.parameterRevision).toBe(1)
    expect(rows[0]!.stage).toBe('draft')
    expect(rows[0]!.state).toBe('pending')
  })

  it('解绑后草稿绑定为空：行列表为空（= 未关联尺寸链）', async () => {
    const base = await createSpacerSnapshot({ length: '12.00', confirmed: true })
    expect(workbenchRows(base, { bindings: [], parameters: base.project.parameters })).toEqual([])
    // 快照没有被改写：正式绑定仍在。
    expect(bindingsOf(base)).toHaveLength(1)
  })
})
