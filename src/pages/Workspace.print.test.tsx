// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChainDefinition, DimensionTerm } from '../domain/types'
import { parseMm } from '../domain/units'
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

describe('Workspace：打印报告入口', () => {
  it('未确认时禁用并说明原因；确认后可打开；输入无效时再次禁用并说明原因', async () => {
    const created = await createProject({
      name: '打印入口测试',
      working: caseA(),
    })
    if (!created.ok) {
      throw new Error(created.error.message)
    }
    const onOpenReport = vi.fn()
    const user = userEvent.setup()

    render(
      <Workspace
        projectId={created.value.id}
        onOpenReport={onOpenReport}
      />,
    )

    const printButton = await screen.findByRole('button', {
      name: '打印报告',
    })
    expect(printButton).toBeDisabled()
    expect(
      screen.getByText(/尺寸关系与作用方向尚未确认/),
    ).toBeInTheDocument()

    await user.click(
      screen.getByRole('checkbox', {
        name: '已核对尺寸关系与作用方向',
      }),
    )
    await waitFor(() => {
      expect(printButton).toBeEnabled()
    })

    await user.click(printButton)
    expect(onOpenReport).toHaveBeenCalledWith(created.value.id)

    await user.clear(
      screen.getByRole('textbox', { name: 'H 基本尺寸' }),
    )
    await waitFor(() => {
      expect(printButton).toBeDisabled()
    })
    expect(screen.getByText(/不能打印报告/)).toBeInTheDocument()
    expect(onOpenReport).toHaveBeenCalledTimes(1)
  })
})
