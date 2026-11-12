/**
 * ADR-001 第 3 步：意图建件的纯函数门禁。
 *
 * 重点不是“能写进去”，而是“模型不能替用户说”：
 * - 原话必须逐字出现在本轮输入里；
 * - 每个数值必须能在本轮原话里找到；
 * - 条款区间只认用户原话（M25 变异目标）；
 * - 绑定要求参数值等于组成环基本尺寸。
 */
import { describe, expect, it } from 'vitest'
import {
  buildAttestation,
  normalizeText,
  numbersAreUserGiven,
  statementIsUserGiven,
} from './types'
import {
  createIntentDraft,
  parseFormula,
  setBindingInDraft,
  setChainInDraft,
  setRequirementInDraft,
} from './draft'

const SESSION = { actorId: '老王', sessionSeq: 1, sessionLabel: '2026-11-12 复检' }
const TURN = { userText: '总长 52.25 偏差 0.02，隔套 12.05，间隙 0.15 到 0.25，外径 32', turnId: 'turn-1', at: '2026-11-12T09:00:00.000Z' }

function draft() {
  return createIntentDraft({ projectId: 'project-intent', session: SESSION, turn: TURN })
}

const RING = {
  symbol: 'H',
  nominalMm: '52.25',
  upperDeviationMm: '0.02',
  lowerDeviationMm: '-0.02',
}

describe('意图建件的原话与数值门禁', () => {
  it('原话必须逐字出现在本轮输入里（归一空白后）', () => {
    expect(statementIsUserGiven('总长 52.25 偏差 0.02', TURN.userText)).toBe(true)
    expect(statementIsUserGiven('总长按 52.25 算，我量的', TURN.userText)).toBe(false)
    expect(statementIsUserGiven('间隙 0.15 到 0.25', TURN.userText)).toBe(true)
    expect(normalizeText('  间隙   0.15 到 0.25 ')).toBe('间隙 0.15 到 0.25')
  })

  it('数值必须能在原话里找到同一个数（写法可不同，数值不可改）', () => {
    expect(numbersAreUserGiven(['52.25', '0.02', '-0.02'], TURN.userText)).toBe(true)
    expect(numbersAreUserGiven(['20'], 'φ20 的轴')).toBe(true)
    expect(numbersAreUserGiven(['21'], 'φ20 的轴')).toBe(false)
    expect(numbersAreUserGiven(['0.52'], '总长 52.25')).toBe(false)
  })

  it('断言带责任人、会话序号、本轮原话与轮次，不含 UUID', () => {
    const attestation = buildAttestation({
      session: SESSION,
      turn: TURN,
      statement: '总长 52.25 偏差 0.02',
      fieldPath: 'chain.terms',
    })
    expect(attestation).toMatchObject({
      kind: 'user-attestation',
      actorId: '老王',
      sessionSeq: 1,
      sessionLabel: '2026-11-12 复检',
      statement: '总长 52.25 偏差 0.02',
      turnId: 'turn-1',
    })
    expect(attestation.actorId).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/u)
  })

  it('装配式只接受加减且必须覆盖全部组成环', () => {
    expect(parseFormula('H - B1 - S', ['H', 'B1', 'S'])).toMatchObject({
      ok: true,
      value: [
        { symbol: 'H', sign: 1 },
        { symbol: 'B1', sign: -1 },
        { symbol: 'S', sign: -1 },
      ],
    })
    expect(parseFormula('H - B1', ['H', 'B1', 'S']).ok).toBe(false)
    expect(parseFormula('H * B1', ['H', 'B1']).ok).toBe(false)
  })

  it('setChain：原话逐字 + 数值都在原话里才落草稿；否则拒绝', () => {
    const ok = setChainInDraft(draft(), {
      session: SESSION,
      turn: TURN,
      statement: '总长 52.25 偏差 0.02',
      rings: [RING],
      formula: 'H',
    })
    expect(ok.ok).toBe(true)
    const rejectedStatement = setChainInDraft(draft(), {
      session: SESSION,
      turn: TURN,
      statement: '用户说总长 52.25',
      rings: [RING],
      formula: 'H',
    })
    expect(rejectedStatement).toMatchObject({ ok: false, code: 'STATEMENT_NOT_USER_GIVEN' })
    const rejectedValue = setChainInDraft(draft(), {
      session: SESSION,
      turn: TURN,
      statement: '总长 52.25 偏差 0.02',
      rings: [{ ...RING, nominalMm: '52.30' }],
      formula: 'H',
    })
    expect(rejectedValue).toMatchObject({ ok: false, code: 'VALUE_MUST_BE_USER_GIVEN' })
  })

  it('M25：条款区间只能来自用户原话；代填数值或引用标准等级一律拒绝', () => {
    const base = draft()
    const modelFilled = setRequirementInDraft(base, {
      session: SESSION,
      turn: TURN,
      statement: '按 GB/T 5847 取 0.12 到 0.28',
      lowerMm: '0.12',
      upperMm: '0.28',
      lowerInclusive: true,
      upperInclusive: true,
    })
    expect(modelFilled).toMatchObject({ ok: false, code: 'REQUIREMENT_MUST_BE_USER_GIVEN' })

    // 原话是真的，但数值比原话更宽（模型加了裕量）→ 仍拒绝。
    const widened = setRequirementInDraft(base, {
      session: SESSION,
      turn: TURN,
      statement: '间隙 0.15 到 0.25',
      lowerMm: '0.10',
      upperMm: '0.30',
      lowerInclusive: true,
      upperInclusive: true,
    })
    expect(widened).toMatchObject({ ok: false, code: 'REQUIREMENT_MUST_BE_USER_GIVEN' })

    const userGiven = setRequirementInDraft(base, {
      session: SESSION,
      turn: TURN,
      statement: '间隙 0.15 到 0.25',
      lowerMm: '0.15',
      upperMm: '0.25',
      lowerInclusive: true,
      upperInclusive: true,
    })
    expect(userGiven.ok).toBe(true)
    if (!userGiven.ok) return
    const candidate = userGiven.value.candidates.find((item) => item.kind === 'interval')
    expect(candidate?.provenance?.[0]).toMatchObject({
      kind: 'user-attestation',
      statement: '间隙 0.15 到 0.25',
    })
  })

  it('setBinding：参数值来自原话；绑定值与环基本尺寸不等 → 拒绝', () => {
    const chained = setChainInDraft(draft(), {
      session: SESSION,
      turn: TURN,
      statement: '隔套 12.05',
      rings: [
        { symbol: 'S', nominalMm: '12.05', upperDeviationMm: '0.02', lowerDeviationMm: '-0.02' },
        { symbol: 'H', nominalMm: '52.25', upperDeviationMm: '0.02', lowerDeviationMm: '-0.02' },
      ],
      formula: 'H - S',
    })
    if (!chained.ok) throw new Error('夹具链写入失败')
    const conflict = setBindingInDraft(chained.value, {
      session: SESSION,
      turn: TURN,
      statement: '隔套 12.05',
      parameters: [{ parameter: 'length', mm: '12.05', symbol: 'H' }],
    })
    expect(conflict).toMatchObject({ ok: false, code: 'BINDING_CONFLICT' })
    const ok = setBindingInDraft(chained.value, {
      session: SESSION,
      turn: TURN,
      statement: '隔套 12.05',
      parameters: [
        { parameter: 'length', mm: '12.05', symbol: 'S' },
        { parameter: 'outerDiameter', mm: '32' },
      ],
    })
    expect(ok.ok).toBe(true)
    if (!ok.ok) return
    expect(ok.value.intentBindings).toEqual([
      { parameter: 'length', symbol: 'S', valueQ: 120500, text: '12.05' },
    ])
  })
})
