// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ChainDefinition } from '../domain/types'
import { parseMm } from '../domain/units'
import type { SourceBinding } from '../sources/bindings'
import { evaluateReviewChecklist, type ReviewInput } from '../review/rules'
import { ReviewSidebar } from './ReviewSidebar'

const CHAIN: ChainDefinition = {
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

const binding: SourceBinding = {
  id: 'bind-h',
  projectId: 'p-1',
  termId: 't-h',
  revisionId: 'rev-2',
  documentId: 'doc-1',
  page: 1,
  rectPdf: [10, 10, 100, 100],
  pageBoxPdf: [0, 0, 600, 800],
  note: '',
  createdAt: '2026-01-03T00:00:00.000Z',
  reviewedTermRevision: 1,
  reviewedAt: '2026-01-03T00:00:00.000Z',
  historicalAcceptance: null,
}

function summary(overrides: Partial<ReviewInput> = {}) {
  return evaluateReviewChecklist({
    chain: CHAIN,
    cellErrors: {},
    result: {
      nominalQ: parseMm('0.1'),
      minQ: parseMm('0.05'),
      maxQ: parseMm('0.15'),
      lowerDeviationQ: parseMm('-0.05'),
      upperDeviationQ: parseMm('0.05'),
      toleranceQ: parseMm('0.1'),
      status: 'within',
      lowerMarginQ: parseMm('0.04'),
      upperMarginQ: parseMm('0.05'),
      contributions: [],
    },
    relationConfirmed: true,
    relationReviewStale: false,
    relationRevision: 3,
    terms: [
      { id: 't-h', symbol: 'H', name: '孔', termRevision: 1 },
      { id: 't-b', symbol: 'B', name: '轴', termRevision: 1 },
    ],
    bindings: [binding, { ...binding, id: 'bind-b', termId: 't-b' }],
    documents: [
      { id: 'doc-1', projectId: 'p-1', title: '装配图', latestRevisionId: 'rev-2' },
    ],
    revisions: [
      {
        id: 'rev-2',
        projectId: 'p-1',
        documentId: 'doc-1',
        fileName: '装配图.pdf',
        sha256: 'b'.repeat(64),
        byteSize: 1000,
        pageCount: 3,
        createdAt: '2026-01-02T00:00:00.000Z',
        blobKey: 'blob-2',
      },
    ],
    availableBlobKeys: new Set(['blob-2']),
    ...overrides,
  })
}

describe('审查侧栏：分开显示计算满足与审查完成', () => {
  it('全部通过时两个结论都显示，并列出全部规则结果', () => {
    render(<ReviewSidebar summary={summary()} />)

    expect(screen.getByTestId('review-calculation')).toHaveTextContent('计算满足')
    expect(screen.getByTestId('review-completion')).toHaveTextContent('审查完成')
    expect(screen.getByText(/查看全部规则结果（\d+ 条）/)).toBeInTheDocument()
  })

  it('没有绑定时审查未完成，逐环来源显示未检查而不是通过', () => {
    render(
      <ReviewSidebar
        summary={summary({
          bindings: [],
          terms: [
            { id: 't-h', symbol: 'H', name: '孔', termRevision: 1 },
            { id: 't-b', symbol: 'B', name: '轴', termRevision: 1 },
          ],
        })}
      />,
    )

    expect(screen.getByTestId('review-completion')).toHaveTextContent('审查未完成：2 项待处理')
    const groups = document.querySelector('.review-sidebar__groups') as HTMLElement
    expect(groups).not.toBeNull()
    expect(within(groups).getAllByText('来源存在').length).toBe(2)
    expect(within(groups).getAllByText('未检查').length).toBe(2)
    expect(within(groups).getAllByText(/该组成环没有任何来源绑定/).length).toBe(2)
  })

  it('待办项带规则 ID、对象、依据、处理动作与规则版本，点击可定位', async () => {
    const user = userEvent.setup()
    const onLocate = vi.fn()
    const data = summary({ relationConfirmed: false, relationReviewStale: true })
    render(<ReviewSidebar summary={data} onLocate={onLocate} />)

    const blocking = document.querySelector('.review-sidebar__group--blocking')
    expect(blocking).not.toBeNull()
    const relationItem = within(blocking as HTMLElement)
      .getByText('尺寸关系已确认')
      .closest('li') as HTMLElement
    expect(within(relationItem).getByText('RELATION_CONFIRMED')).toBeInTheDocument()
    expect(within(relationItem).getByText('未通过')).toBeInTheDocument()
    expect(within(relationItem).getByText(/依据：/)).toBeInTheDocument()
    expect(within(relationItem).getByText(/处理：/)).toBeInTheDocument()
    expect(within(relationItem).getByText('规则版本 1.0.0')).toBeInTheDocument()

    const button = within(relationItem).getByRole('button', {
      name: /定位：尺寸关系已确认/,
    })
    button.focus()
    expect(button).toHaveFocus()
    await user.click(button)
    expect(onLocate).toHaveBeenCalledTimes(1)
    expect(onLocate.mock.calls[0][0]).toMatchObject({
      ruleId: 'RELATION_CONFIRMED',
      target: { kind: 'relation' },
    })
  })

  it('目标不满足属于工程结论：显示计算不满足但审查仍可完成', () => {
    render(
      <ReviewSidebar
        summary={summary({
          result: {
            nominalQ: parseMm('0.1'),
            minQ: parseMm('0.3'),
            maxQ: parseMm('0.4'),
            lowerDeviationQ: parseMm('0.2'),
            upperDeviationQ: parseMm('0.3'),
            toleranceQ: parseMm('0.1'),
            status: 'outside',
            lowerMarginQ: parseMm('-0.1'),
            upperMarginQ: parseMm('-0.2'),
            contributions: [],
          },
        })}
      />,
    )
    expect(screen.getByTestId('review-calculation')).toHaveTextContent('计算不满足')
    expect(screen.getByTestId('review-completion')).toHaveTextContent('审查完成')
  })
})
