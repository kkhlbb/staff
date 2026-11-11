import { describe, expect, it } from 'vitest'
import { AGENT_TOOL_SCHEMAS, validateToolArguments } from './toolSchemas'
import { nextState } from './stateMachine'

const valid: Record<string, unknown> = {
  context: {},
  confirmed: { draftId: 'draft-1' },
  apply: {
    planToken: 'token-1',
    baseRevisionId: 'rev-1',
    candidateIds: ['candidate-1'],
    mapping: { ringSymbols: ['H', 'S'], requirement: true },
  },
  stage: {
    toolMode: 'agent',
    draftId: 'draft-1',
    baseRevisionId: 'rev-1',
    parameter: 'length',
    deltaMm: '0.04',
    lockedKeys: ['innerDiameter', 'outerDiameter'],
  },
  preview: { toolMode: 'agent', draftId: 'draft-1', baseRevisionId: 'rev-1' },
  export: { format: 'svg' },
}

describe('Agent 工具参数 JSON Schema 与状态机', () => {
  it('六个工具的合法参数都接受，未知工具拒绝', () => {
    for (const [name, value] of Object.entries(valid)) {
      expect(validateToolArguments(name, value), name).toEqual({ ok: true, value })
    }
    expect(validateToolArguments('commitApprovedDraft', {})).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(validateToolArguments('export', { format: 'dwg' })).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(Object.keys(AGENT_TOOL_SCHEMAS)).toEqual(['context', 'confirmed', 'apply', 'stage', 'preview', 'export'])
  })

  it('拒绝缺字段、未声明字段、类型错与 valueMm/deltaMm 冲突', () => {
    for (const [name, value] of [
      ['stage', { ...(valid.stage as object), draftId: undefined }],
      ['preview', { ...(valid.preview as object), confirmed: true }],
      ['confirmed', { draftId: 42 }],
      ['stage', { ...(valid.stage as object), valueMm: '12.04' }],
      ['apply', { ...(valid.apply as object), candidateIds: [] }],
      ['context', []],
    ] as [string, unknown][]) {
      expect(validateToolArguments(name, value), `${name} ${JSON.stringify(value)}`).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    }
  })

  it('合法迁移表允许失败后继续，拒绝终态迁移', () => {
    expect(nextState('reading', 'executing')).toEqual({ ok: true, to: 'executing' })
    expect(nextState('failed', 'reading')).toEqual({ ok: true, to: 'reading' })
    expect(nextState('cancelled', 'reading')).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(nextState('completed', 'reading')).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(nextState('idle', 'executing')).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
  })
})
