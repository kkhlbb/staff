/**
 * 验收核心：**同一组参数，MCP 与服务端内核算出的 q 必须完全相等**。
 *
 * 服务端参照物不是“我另算一遍”，而是产品真实路径：
 *   createRequirementProject（已确认绑定 + 条款 0.1000～0.3000）
 *   → draftWithLength → computeCandidateRequirementCheck（内部 computeChange → calculateChain）
 *
 * MCP 侧：calc_chain（parameters 模式 → computeChange → calculateChain）
 *        → check_requirement（closedIntervalVerdict）。
 *
 * 四组判据值直接来自任务卡；任何一条不等都失败，不放宽。
 */
import { describe, expect, it } from 'vitest'
import { parseMm } from '../../src/domain/units'
import {
  computeCandidateRequirementCheck,
  type RequirementCheckValue,
} from '../../src/requirements/check'
import {
  activeRequirement,
  createRequirementProject,
  draftWithLength,
} from '../../src/requirements/__fixtures__/requirementFixture'
import type { RequirementRevision } from '../../src/requirements/types'
import { runCalcChain } from '../tools/calc-chain'
import { runCheckRequirement } from '../tools/check-requirement'

interface Row {
  length: string
  /** 任务卡的「期望 C」= 封闭环下限 minQ。 */
  expectedCQ: number
  expectedMinQ: number
  expectedMaxQ: number
  expectedNominalQ: number
  expectedToleranceQ: number
  expectedStatus: 'satisfied' | 'exceeded'
  expectedMarginQ: number
  expectedLowerMarginQ: number
  expectedUpperMarginQ: number
}

const ROWS: readonly Row[] = [
  {
    length: '12.00',
    expectedCQ: 1500,
    expectedMinQ: 1500,
    expectedMaxQ: 2500,
    expectedNominalQ: 2000,
    expectedToleranceQ: 1000,
    expectedStatus: 'satisfied',
    expectedMarginQ: 500,
    expectedLowerMarginQ: 500,
    expectedUpperMarginQ: 500,
  },
  {
    length: '12.04',
    expectedCQ: 1100,
    expectedMinQ: 1100,
    expectedMaxQ: 2100,
    expectedNominalQ: 1600,
    expectedToleranceQ: 1000,
    expectedStatus: 'satisfied',
    expectedMarginQ: 100,
    expectedLowerMarginQ: 100,
    expectedUpperMarginQ: 900,
  },
  {
    length: '12.05',
    expectedCQ: 1000,
    expectedMinQ: 1000,
    expectedMaxQ: 2000,
    expectedNominalQ: 1500,
    expectedToleranceQ: 1000,
    expectedStatus: 'satisfied',
    expectedMarginQ: 0,
    expectedLowerMarginQ: 0,
    expectedUpperMarginQ: 1000,
  },
  {
    length: '12.10',
    expectedCQ: 500,
    expectedMinQ: 500,
    expectedMaxQ: 1500,
    expectedNominalQ: 1000,
    expectedToleranceQ: 1000,
    expectedStatus: 'exceeded',
    expectedMarginQ: -500,
    expectedLowerMarginQ: -500,
    expectedUpperMarginQ: 1500,
  },
]

let checkSequence = 0

async function serverCheck(
  length: string,
): Promise<{ value: RequirementCheckValue; requirement: RequirementRevision }> {
  const project = await createRequirementProject({ length: '12.00' })
  const draft = draftWithLength(project.snapshot, length)
  checkSequence += 1
  const result = await computeCandidateRequirementCheck({
    snapshot: project.snapshot,
    requirementRevisions: project.snapshot.project.requirementRevisions,
    activeRequirementRevisionId: project.snapshot.project.activeRequirementRevisionId,
    pendingEdit: null,
    draft,
    baseRevisionId: project.snapshot.project.currentRevisionId,
    baseGeneration: 0,
    acceptedSeq: 1,
    checkedAt: '2026-11-12T00:00:00.000Z',
    checkId: `mcp-consistency-${checkSequence}`,
    inputIssue: null,
  })
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  return { value: result.value, requirement: activeRequirement(project.snapshot) }
}

interface CalcResultView {
  nominalQ: number
  minQ: number
  maxQ: number
  lowerDeviationQ: number
  upperDeviationQ: number
  toleranceQ: number
}

interface CheckResultView {
  status: string
  margins: { marginQ: number; lowerQ: number; upperQ: number }
  closed: { minQ: number; maxQ: number }
  reasonCodes: string[]
}

describe('MCP calc_chain 与服务端内核：四组判据值 q 完全相等', () => {
  for (const row of ROWS) {
    it(`隔套长度 ${row.length} → C=[${row.expectedMinQ},${row.expectedMaxQ}]，判定 ${row.expectedStatus}`, async () => {
      const server = await serverCheck(row.length)
      const serverChainResult = server.value.originalTargetResult
      expect(serverChainResult).not.toBeNull()
      expect(server.requirement.lowerQ).toBe(1000)
      expect(server.requirement.upperQ).toBe(3000)

      const mcpCalc = await runCalcChain({
        parameters: {
          innerDiameterQ: 200_000,
          outerDiameterQ: 320_000,
          lengthQ: parseMm(row.length),
        },
      })
      const calc = mcpCalc.result as unknown as CalcResultView

      // 1) 六个 q 与服务端内核逐项相等。
      expect(calc.nominalQ).toBe(serverChainResult?.nominalQ)
      expect(calc.minQ).toBe(serverChainResult?.minQ)
      expect(calc.maxQ).toBe(serverChainResult?.maxQ)
      expect(calc.lowerDeviationQ).toBe(serverChainResult?.lowerDeviationQ)
      expect(calc.upperDeviationQ).toBe(serverChainResult?.upperDeviationQ)
      expect(calc.toleranceQ).toBe(serverChainResult?.toleranceQ)

      // 2) 与任务卡写的期望值逐项相等（任何一条对不上就红）。
      expect(calc.minQ).toBe(row.expectedMinQ)
      expect(calc.maxQ).toBe(row.expectedMaxQ)
      expect(calc.nominalQ).toBe(row.expectedNominalQ)
      expect(calc.toleranceQ).toBe(row.expectedToleranceQ)
      expect(row.expectedCQ).toBe(row.expectedMinQ)

      // 3) 条款判定：MCP 的 check_requirement 对服务端条款区间给出同一结论与裕量。
      const mcpCheck = (await runCheckRequirement({
        cQ: calc.minQ,
        cMaxQ: calc.maxQ,
        lowerQ: server.requirement.lowerQ,
        upperQ: server.requirement.upperQ,
        inclusive: true,
      })) as unknown as CheckResultView

      expect(mcpCheck.closed.minQ).toBe(calc.minQ)
      expect(mcpCheck.closed.maxQ).toBe(calc.maxQ)
      expect(mcpCheck.status).toBe(row.expectedStatus)
      expect(mcpCheck.status).toBe(
        server.value.check.status === 'satisfied' ? 'satisfied' : 'exceeded',
      )
      expect(mcpCheck.margins.lowerQ).toBe(server.value.check.margins?.lowerQ)
      expect(mcpCheck.margins.upperQ).toBe(server.value.check.margins?.upperQ)
      expect(mcpCheck.margins.marginQ).toBe(row.expectedMarginQ)
      expect(mcpCheck.margins.lowerQ).toBe(row.expectedLowerMarginQ)
      expect(mcpCheck.margins.upperQ).toBe(row.expectedUpperMarginQ)
      expect(server.value.check.resultInterval).toEqual({ minQ: calc.minQ, maxQ: calc.maxQ })

      console.log(
        JSON.stringify({
          length: row.length,
          server: {
            nominalQ: serverChainResult?.nominalQ,
            minQ: serverChainResult?.minQ,
            maxQ: serverChainResult?.maxQ,
            toleranceQ: serverChainResult?.toleranceQ,
            status: server.value.check.status,
            margins: server.value.check.margins,
          },
          mcp: {
            nominalQ: calc.nominalQ,
            minQ: calc.minQ,
            maxQ: calc.maxQ,
            toleranceQ: calc.toleranceQ,
            status: mcpCheck.status,
            margins: mcpCheck.margins,
          },
          equal: true,
        }),
      )
    })
  }
})

describe('开区间（inclusive=false）与边界', () => {
  it('边界相等在闭区间算满足、开区间算不满足', async () => {
    const closed = (await runCheckRequirement({
      cQ: 1000,
      cMaxQ: 2000,
      lowerQ: 1000,
      upperQ: 2000,
      inclusive: true,
    })) as unknown as CheckResultView
    const open = (await runCheckRequirement({
      cQ: 1000,
      cMaxQ: 2000,
      lowerQ: 1000,
      upperQ: 2000,
      inclusive: false,
    })) as unknown as CheckResultView
    expect(closed.status).toBe('satisfied')
    expect(open.status).toBe('exceeded')
    expect(open.reasonCodes).toEqual(['BOTH_VIOLATED'])
  })
})
