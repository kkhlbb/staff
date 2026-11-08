// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChainDefinition, DimensionTerm, Project } from '../domain/types'
import { parseMm } from '../domain/units'
import { createAnalysisSnapshot } from '../history/snapshots'
import { createProject, updateProject } from '../storage/projects'
import { deleteProjectDatabase } from '../test/projectDb'
import { chainToDraft } from '../workspace/draft'
import { createRelationReview } from '../workspace/relation'
import { SnapshotList } from './SnapshotList'

beforeEach(async () => {
  await deleteProjectDatabase()
})

afterEach(async () => {
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
    target: { minQ: parseMm('0.1000'), maxQ: parseMm('0.3000') },
    assumptions: '',
  }
}

async function createProjectWithSnapshot(): Promise<{
  project: Project
  firstId: string
}> {
  const working = chain()
  const created = await createProject({
    name: '快照列表测试',
    working,
    relationRevision: 1,
    relationReview: createRelationReview(
      working,
      1,
      '2026-01-01T00:00:00.000Z',
    ),
  })
  if (!created.ok) {
    throw new Error(created.error.message)
  }
  const project = created.value
  const snapshot = await createAnalysisSnapshot({
    project,
    draft: chainToDraft(working),
    relationState: {
      relationRevision: project.relationRevision,
      relationReview: project.relationReview,
    },
    now: '2026-11-08T09:00:00.000Z',
  })
  if (!snapshot.ok) {
    throw new Error(snapshot.error.message)
  }
  return { project, firstId: snapshot.value.id }
}

describe('SnapshotList：快照列表', () => {
  it('显示创建时间、冻结审查状态、版本与历史标记，并能打开报告', async () => {
    const { project, firstId } = await createProjectWithSnapshot()
    const working = chain()
    working.target = { minQ: parseMm('0.2000'), maxQ: parseMm('0.4000') }
    const updated = await updateProject(project.id, { working })
    expect(updated.ok).toBe(true)
    if (!updated.ok) {
      return
    }
    const second = await createAnalysisSnapshot({
      project: updated.value,
      draft: chainToDraft(working),
      relationState: {
        relationRevision: updated.value.relationRevision,
        relationReview: updated.value.relationReview,
      },
      now: '2026-11-08T09:30:00.000Z',
    })
    expect(second.ok).toBe(true)
    if (!second.ok) {
      return
    }

    const onOpenReport = vi.fn()
    const user = userEvent.setup()
    render(
      <SnapshotList
        projectId={project.id}
        onOpenReport={onOpenReport}
      />,
    )

    expect(
      await screen.findByRole('heading', { name: '分析快照' }),
    ).toBeInTheDocument()
    const firstRow = screen.getByTestId(`snapshot-${firstId}`)
    const secondRow = screen.getByTestId(`snapshot-${second.value.id}`)

    // 最新快照在前，旧的被标为历史；状态与版本冻结在创建时。
    expect(within(firstRow).getByTestId(`snapshot-history-${firstId}`)).toHaveTextContent(
      '历史',
    )
    expect(
      within(secondRow).getByTestId(`snapshot-history-${second.value.id}`),
    ).toHaveTextContent('当前')
    expect(
      within(secondRow).getByTestId(`snapshot-status-${second.value.id}`),
    ).toHaveTextContent(/审查未完成/)
    expect(secondRow).toHaveTextContent(second.value.engineVersion)
    expect(secondRow).toHaveTextContent(second.value.reviewRulesVersion)

    await user.click(
      within(firstRow).getByTestId(`snapshot-open-${firstId}`),
    )
    expect(onOpenReport).toHaveBeenCalledWith(project.id, firstId)
  })

  it('没有快照时给出创建指引', async () => {
    const created = await createProject({ name: '空快照项目', working: chain() })
    expect(created.ok).toBe(true)
    if (!created.ok) {
      return
    }
    render(<SnapshotList projectId={created.value.id} />)

    expect(
      await screen.findByText('还没有分析快照。'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '返回工作台创建快照' }),
    ).toBeInTheDocument()
  })

  it('旧报告链接的说明显示在列表顶部', async () => {
    const { project } = await createProjectWithSnapshot()
    render(
      <SnapshotList
        projectId={project.id}
        legacyNotice="报告入口已改为“分析快照”。"
      />,
    )
    expect(
      await screen.findByText('报告入口已改为“分析快照”。'),
    ).toBeInTheDocument()
  })

  it('项目不存在时说明原因', async () => {
    render(<SnapshotList projectId="missing-project" />)
    expect(
      await screen.findByText('项目不存在'),
    ).toBeInTheDocument()
  })
})
