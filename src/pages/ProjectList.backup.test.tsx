// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChainDefinition, DimensionTerm } from '../domain/types'
import { parseMm } from '../domain/units'
import { createProject } from '../storage/projects'
import { deleteProjectDatabase } from '../test/projectDb'
import { ProjectList } from './ProjectList'

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
  nominal: string,
  lower: string,
  upper: string,
  sign: 1 | -1,
): DimensionTerm {
  return {
    id,
    symbol,
    name: symbol,
    nominalQ: parseMm(nominal),
    lowerDeviationQ: parseMm(lower),
    upperDeviationQ: parseMm(upper),
    sign,
    sourceNote: '',
    termRevision: 1,
  }
}

function chain(): ChainDefinition {
  return {
    terms: [
      term('h', 'H', '100.0000', '0.0000', '0.1000', 1),
      term('b1', 'B1', '20.0000', '-0.0200', '0.0000', -1),
    ],
    target: null,
    assumptions: '',
  }
}

function fixtureFile(): File {
  const bytes = readFileSync(
    'src/backup/__fixtures__/valid-minimal.cunlian.zip',
  )
  return new File([new Uint8Array(bytes)], 'valid-minimal.cunlian.zip', {
    type: 'application/zip',
  })
}

describe('ProjectList：完整备份入口', () => {
  it('导出 .cunlian.zip，并在提示中明示不含全局映射模板', async () => {
    const created = await createProject({ name: '导出项目', working: chain() })
    expect(created.ok).toBe(true)
    const createObjectURL = vi.fn(() => 'blob:backup')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    })
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)

    const user = userEvent.setup()
    render(<ProjectList />)
    await screen.findByText('导出项目')

    await user.click(screen.getByRole('button', { name: '导出完整备份' }))

    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalledTimes(1)
    })
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(
      screen.getByText(/已导出完整备份「寸链完整备份-/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/本备份不包含全局映射模板/),
    ).toBeInTheDocument()
  })

  it('空库选择完整备份后确认恢复，并刷新项目列表', async () => {
    const user = userEvent.setup()
    render(<ProjectList />)
    await screen.findByText('还没有项目。点击“新建”开始，打开内置演示案例，或导入一个 JSON 项目文件。')

    const input = screen.getByLabelText('导入完整备份文件')
    await user.upload(input, fixtureFile())

    expect(
      await screen.findByRole('alertdialog', { name: '从完整备份恢复？' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/1 个项目/)).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: '确认恢复到空库' }),
    )

    expect(
      await screen.findByText(/已从「valid-minimal.cunlian.zip」恢复 1 个项目/),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/人工确认已清除，需要重新核对/),
    ).toBeInTheDocument()
    expect(await screen.findByText('夹具项目')).toBeInTheDocument()
  })

  it('目标库非空时拒绝恢复且不覆盖现有项目', async () => {
    const created = await createProject({ name: '已有项目', working: chain() })
    expect(created.ok).toBe(true)
    const user = userEvent.setup()
    render(<ProjectList />)
    await screen.findByText('已有项目')

    await user.upload(screen.getByLabelText('导入完整备份文件'), fixtureFile())
    await screen.findByRole('alertdialog', { name: '从完整备份恢复？' })
    await user.click(
      screen.getByRole('button', { name: '确认恢复到空库' }),
    )

    expect(
      await screen.findByText(/目标数据库不是空库/),
    ).toBeInTheDocument()
    expect(screen.getByText('已有项目')).toBeInTheDocument()
    expect(screen.queryByText('夹具项目')).toBeNull()
  })
})
