// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChainDefinition, DimensionTerm } from '../domain/types'
import { parseMm } from '../domain/units'
import { getAnalysisSnapshot } from '../history/snapshots'
import { createProject } from '../storage/projects'
import { deleteProjectDatabase } from '../test/projectDb'
import { Workspace } from './Workspace'

beforeEach(async () => {
  await deleteProjectDatabase()
})

afterEach(async () => {
  vi.restoreAllMocks()
  await deleteProjectDatabase()
})

function term(
  id: string,
  symbol: string,
  name: string,
  nominal: string,
  lower: string,
  upper: string,
  sign: 1 | -1,
): DimensionTerm {
  return {
    id,
    symbol,
    name,
    nominalQ: parseMm(nominal),
    lowerDeviationQ: parseMm(lower),
    upperDeviationQ: parseMm(upper),
    sign,
    sourceNote: '',
    termRevision: 1,
  }
}

function caseA(): ChainDefinition {
  return {
    terms: [
      term('h', 'H', '机架', '100.0000', '0.0000', '0.1000', 1),
      term('b1', 'B1', '轴承 1', '20.0000', '-0.0200', '0.0000', -1),
      term('s', 'S', '隔套', '59.8000', '-0.0500', '0.0500', -1),
      term('b2', 'B2', '轴承 2', '20.0000', '-0.0200', '0.0000', -1),
    ],
    target: { minQ: parseMm('0.1000'), maxQ: parseMm('0.3000') },
    assumptions: '',
  }
}

describe('Workspace：创建分析快照入口', () => {
  it('未确认也能创建带待办快照；确认后再次创建；输入无效时禁用并说明原因', async () => {
    const created = await createProject({
      name: '快照入口测试',
      working: caseA(),
    })
    if (!created.ok) {
      throw new Error(created.error.message)
    }
    const onOpenReport = vi.fn()
    const user = userEvent.setup()

    render(
      <Workspace projectId={created.value.id} onOpenReport={onOpenReport} />,
    )

    const snapshotButton = await screen.findByRole('button', {
      name: '创建分析快照',
    })
    // 有效输入即使关系未确认也允许创建快照；报告会标明具体待办。
    expect(snapshotButton).toBeEnabled()

    await user.click(snapshotButton)
    expect(
      screen.getByRole('alertdialog', { name: '审查未完成，仍创建快照？' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '创建带待办快照' }))

    await waitFor(() => {
      expect(onOpenReport).toHaveBeenCalledTimes(1)
    })
    const firstCall = onOpenReport.mock.calls[0]
    expect(firstCall[0]).toBe(created.value.id)
    const firstSnapshotId = String(firstCall[1])
    expect(firstSnapshotId).toMatch(/^snapshot-/)

    const first = await getAnalysisSnapshot(firstSnapshotId)
    expect(first.ok).toBe(true)
    if (first.ok && first.value !== null) {
      expect(first.value.status).toBe('pending')
      expect(first.value.pendingCount).toBeGreaterThan(0)
      expect(
        first.value.review.findings.find(
          (finding) => finding.ruleId === 'RELATION_CONFIRMED',
        )?.status,
      ).toBe('needs-human')
    }

    // 显式确认关系后，第二份快照冻结新的审查状态（来源仍缺，所以仍带待办）。
    await user.click(
      screen.getByRole('checkbox', {
        name: '已核对尺寸关系与作用方向',
      }),
    )
    await waitFor(() => {
      expect(snapshotButton).toBeEnabled()
    })
    await user.click(snapshotButton)
    await user.click(screen.getByRole('button', { name: '创建带待办快照' }))
    await waitFor(() => {
      expect(onOpenReport).toHaveBeenCalledTimes(2)
    })
    const secondSnapshotId = String(onOpenReport.mock.calls[1][1])
    expect(secondSnapshotId).not.toBe(firstSnapshotId)
    const second = await getAnalysisSnapshot(secondSnapshotId)
    expect(second.ok).toBe(true)
    if (second.ok && second.value !== null) {
      expect(
        second.value.review.findings.find(
          (finding) => finding.ruleId === 'RELATION_CONFIRMED',
        )?.status,
      ).toBe('passed')
    }

    await user.clear(screen.getByRole('textbox', { name: 'H 基本尺寸' }))
    await waitFor(() => {
      expect(snapshotButton).toBeDisabled()
    })
    expect(
      screen.getByText(/当前输入未通过校验，不能创建分析快照/),
    ).toBeInTheDocument()
    expect(onOpenReport).toHaveBeenCalledTimes(2)
  })
})
