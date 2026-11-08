// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ChainDefinition } from '../domain/types'
import { parseMm } from '../domain/units'
import { createProject } from '../storage/projects'
import { deleteProjectDatabase } from '../test/projectDb'
import { Workspace } from './Workspace'

const chain: ChainDefinition = {
  terms: [
    {
      id: 't-h',
      symbol: 'H',
      name: '孔',
      nominalQ: parseMm('100'),
      lowerDeviationQ: parseMm('0'),
      upperDeviationQ: parseMm('0.1'),
      sign: 1,
      sourceNote: '',
      termRevision: 1,
    },
    {
      id: 't-b',
      symbol: 'B',
      name: '轴',
      nominalQ: parseMm('99.9'),
      lowerDeviationQ: parseMm('-0.05'),
      upperDeviationQ: parseMm('0'),
      sign: -1,
      sourceNote: '',
      termRevision: 1,
    },
  ],
  target: { minQ: parseMm('0.01'), maxQ: parseMm('0.2') },
  assumptions: '',
}

async function setup(): Promise<string> {
  const created = await createProject({ name: '审查侧栏集成', working: chain })
  expect(created.ok, created.ok ? '' : created.error.message).toBe(true)
  if (!created.ok) {
    throw new Error(created.error.message)
  }
  return created.value.id
}

beforeEach(async () => {
  await deleteProjectDatabase()
})

describe('工作台审查侧栏集成', () => {
  it('计算满足与审查完成分开显示；无来源与未确认关系都列为待办', async () => {
    const projectId = await setup()
    render(<Workspace projectId={projectId} />)
    await screen.findByRole('button', { name: '增加行' })

    expect(screen.getByRole('heading', { name: '审查清单' })).toBeInTheDocument()
    expect(screen.getByTestId('review-calculation')).toHaveTextContent('计算满足')
    const completion = await screen.findByTestId('review-completion')
    expect(completion).toHaveTextContent('审查未完成')
    // 关系未确认 1 项 + 两个环没有来源绑定 2 项。
    expect(completion).toHaveTextContent('3 项待处理')
  })

  it('点击链级待办定位到结果卡，且不触发保存或确认', async () => {
    const projectId = await setup()
    const user = userEvent.setup()
    render(<Workspace projectId={projectId} />)
    await screen.findByRole('button', { name: '增加行' })

    const locate = await screen.findByRole('button', {
      name: /定位：尺寸关系已确认/,
    })
    await user.click(locate)
    expect(document.activeElement?.id).toBe('workspace-result-panel')

    const confirmBox = screen.getByRole('checkbox', {
      name: '已核对尺寸关系与作用方向',
    })
    expect(confirmBox).not.toBeChecked()
  })

  it('点击逐环待办选中对应组成环行', async () => {
    const projectId = await setup()
    const user = userEvent.setup()
    render(<Workspace projectId={projectId} />)
    await screen.findByRole('button', { name: '增加行' })

    const locate = await screen.findByRole('button', {
      name: /定位：来源存在，组成环 H/,
    })
    await user.click(locate)
    await waitFor(() => {
      const row = document.querySelector('[data-review-term="t-h"]')
      expect(row?.getAttribute('data-selected')).toBe('true')
    })
  })
})
