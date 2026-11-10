import { describe, expect, it } from 'vitest'
import { createSpacerSnapshot, spacerParameters, SPACER_LENGTH_PARAMETER_ID } from '../project-file/__fixtures__/spacerProjectFile'
import type { ProjectFileParameterBindingLink } from '../project-file/types'
import { computeChange, ChangeError } from './compute'

function bindingsOf(snapshot: Awaited<ReturnType<typeof createSpacerSnapshot>>): ProjectFileParameterBindingLink[] {
  return snapshot.project.dimensionLinks.filter(
    (link): link is ProjectFileParameterBindingLink => link.kind === 'parameter-binding',
  )
}

describe('D-02 LINK-01：12→14 只同步 nominal，结果由 V2 内核重算', () => {
  it('整数值与毫米极值、判定、裕量与独立核算一致', async () => {
    const base = await createSpacerSnapshot({ length: '12.00', confirmed: true })
    const parameters = spacerParameters({ length: '14.00' }, 2)
    const computation = computeChange(
      base,
      { parameters, bindings: bindingsOf(base) },
      { revisionId: 'rev-b', now: '2026-11-09T09:00:00.000Z' },
    )

    // §9.2：C0=2000q 起，长度 +200000q 使结果 −20000q 偏移。
    expect(computation.result.nominalQ).toBe(-18000)
    expect(computation.result.minQ).toBe(-18500)
    expect(computation.result.maxQ).toBe(-17500)
    expect(computation.result.status).toBe('outside')
    expect(computation.result.lowerMarginQ).toBe(-19500)
    expect(computation.result.upperMarginQ).toBe(20500)
    expect(computation.result.minQ / 10000).toBe(-1.85)
    expect(computation.result.maxQ / 10000).toBe(-1.75)

    const spacer = computation.chain.terms.find((term) => term.id === 't-s')!
    expect(spacer.nominalQ).toBe(140000)
    // 只有 nominal 与 termRevision 变化；方向/偏差/目标/其它环逐字段不变。
    const beforeSpacer = base.project.dimensionChain.terms.find((term) => term.id === 't-s')!
    expect(spacer.lowerDeviationQ).toBe(beforeSpacer.lowerDeviationQ)
    expect(spacer.upperDeviationQ).toBe(beforeSpacer.upperDeviationQ)
    expect(spacer.sign).toBe(beforeSpacer.sign)
    expect(spacer.termRevision).toBe(beforeSpacer.termRevision + 1)
    expect(computation.chain.target).toEqual(base.project.dimensionChain.target)
    expect(computation.chain.assumptions).toBe(base.project.dimensionChain.assumptions)
    for (const id of ['t-h', 't-b1', 't-b2']) {
      expect(computation.chain.terms.find((term) => term.id === id)).toEqual(
        base.project.dimensionChain.terms.find((term) => term.id === id),
      )
    }

    // 参数 diff：只有长度工程值变化。
    const lengthDiff = computation.parameterDiffs.find((row) => row.key === 'length')!
    expect(lengthDiff.beforeQ).toBe(120000)
    expect(lengthDiff.afterQ).toBe(140000)
    expect(lengthDiff.valueChanged).toBe(true)
    for (const key of ['innerDiameter', 'outerDiameter'] as const) {
      const row = computation.parameterDiffs.find((item) => item.key === key)!
      expect(row.valueChanged).toBe(false)
    }

    // 图纸按新 revisionId 重建，指纹来自权威 DrawingData。
    expect(computation.drawing.record.revisionId).toBe('rev-b')
    expect(computation.drawing.record.dataFingerprint).toBe(computation.drawing.data.fingerprint)
    expect(computation.drawing.previousData).not.toBeNull()
    expect(computation.drawing.previousProblem).toBeNull()

    // 确认凭据引用提交时的全部版本号与指纹。
    const credential = computation.credentials.find(
      (item) => item.parameterId === SPACER_LENGTH_PARAMETER_ID,
    )!
    expect(credential.parameterRevision).toBe(2)
    expect(credential.termRevision).toBe(spacer.termRevision)
    expect(credential.drawingFingerprint).toBe(computation.drawing.data.fingerprint)
    expect(credential.sourceBasis).toContain(':')
  })

  it('仅显示小数位变化：工程值未变，但图纸与来源基准变化', async () => {
    const base = await createSpacerSnapshot({ length: '12.00', confirmed: true })
    const parameters = spacerParameters({ length: '12.0000' }, 1)
    const computation = computeChange(
      base,
      { parameters, bindings: bindingsOf(base) },
      { revisionId: 'rev-b', now: '2026-11-09T09:00:00.000Z' },
    )
    const row = computation.parameterDiffs.find((item) => item.key === 'length')!
    expect(row.valueChanged).toBe(false)
    expect(row.displayChanged).toBe(true)
    expect(computation.changedTermIds).toEqual([])
    expect(computation.result.minQ).toBe(1500)
    expect(computation.drawing.data.fingerprint).not.toBe(
      base.project.drawings[0]?.dataFingerprint,
    )
  })

  it('悬空绑定引用直接拒绝，不返回半成品', async () => {
    const base = await createSpacerSnapshot()
    const bindings = bindingsOf(base).map((link) => ({ ...link, termId: 't-missing' }))
    expect(() =>
      computeChange(
        base,
        { parameters: spacerParameters({ length: '14.00' }, 2), bindings },
        { revisionId: 'rev-b', now: '2026-11-09T09:00:00.000Z' },
      ),
    ).toThrow(ChangeError)
  })

  it('多环绑同参：两环同时同步，不留一半旧值', async () => {
    const base = await createSpacerSnapshot()
    const bindings = [
      ...bindingsOf(base),
      {
        kind: 'parameter-binding' as const,
        bindingId: 'binding:spacer-length-b1',
        termId: 't-b1',
        partId: base.project.parameters[0]!.partId,
        parameterId: SPACER_LENGTH_PARAMETER_ID,
        syncField: 'nominal' as const,
        createdAt: '2026-11-09T08:00:00.000Z',
      },
    ]
    const computation = computeChange(
      base,
      { parameters: spacerParameters({ length: '14.00' }, 2), bindings },
      { revisionId: 'rev-b', now: '2026-11-09T09:00:00.000Z' },
    )
    expect(computation.chain.terms.find((term) => term.id === 't-s')!.nominalQ).toBe(140000)
    expect(computation.chain.terms.find((term) => term.id === 't-b1')!.nominalQ).toBe(140000)
    expect(computation.changedTermIds.sort()).toEqual(['t-b1', 't-s'])
    expect(computation.termDiffs.map((row) => row.changed)).toEqual([true, true])
  })
})
