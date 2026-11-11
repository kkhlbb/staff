// @vitest-environment jsdom
/**
 * V3.6 审阅面板：状态可见、逐条确认、拒绝需理由、批量只拒绝、如实披露限制。
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { SnapshotDto } from '../../desktop/shared/contracts'
import { createSampleSnapshot } from '../project-file/__fixtures__/sampleProjectFile'
import type { ExtractionCandidate, ExtractionDraft, ExtractionEvidence, QuantityValue } from '../document-extraction'
import { ExtractionReviewPanel, type ExtractionReviewActions } from './ExtractionReviewPanel'

const evidence: ExtractionEvidence = {
  documentId: 'doc-1',
  revisionId: 'sr-1',
  sha256: 'a'.repeat(64),
  blobKey: 'blob-1',
  page: 1,
  rectPdf: [100, 600, 140, 615],
  pageBoxPdf: [0, 0, 612, 792],
  textSnippet: '52.20',
  normalizedSnippet: '52.20',
  textItemIndexes: [3, 4],
}

const quantity: QuantityValue = {
  text: '52.20',
  decimals: 2,
  valueQ: 522000,
  unitText: 'mm',
  unit: 'mm',
  evidence: [evidence],
}

function ringCandidate(
  overrides: Partial<ExtractionCandidate> & { symbol?: string } = {},
): ExtractionCandidate {
  return {
    candidateId: 'cand-h',
    kind: 'ring',
    groupId: `ring:${overrides.symbol ?? 'H'}`,
    rawText: 'H 总长 52.20 +0.02 -0.02',
    page: 1,
    status: 'pending',
    confidence: 'high',
    confidenceBasis: ['RULE_TABLE_ROW'],
    reasonCodes: [],
    evidence: [evidence],
    editRevision: 0,
    data: {
      symbol: overrides.symbol ?? 'H',
      name: '总长',
      nominal: quantity,
      upperDeviation: null,
      lowerDeviation: null,
    },
    ...overrides,
  } as ExtractionCandidate
}

function draftFixture(): ExtractionDraft {
  const rejected = ringCandidate({
    candidateId: 'cand-s',
    symbol: 'S',
    status: 'rejected',
    rawText: 'S 隔套 12.00',
  })
  const confirmed = ringCandidate({
    candidateId: 'cand-b1',
    symbol: 'B1',
    status: 'confirmed',
    rawText: 'B1 左轴承 20.00',
  })
  const blocked: ExtractionCandidate = {
    candidateId: 'cand-c',
    kind: 'interval',
    groupId: 'interval:C',
    rawText: '轴向装配间隙 C 应为 0.1000～0.3000 mm',
    page: 2,
    status: 'blocked',
    confidence: 'low',
    confidenceBasis: ['RULE_RANGE_SENTENCE'],
    reasonCodes: ['ENDPOINT_SEMANTICS_MISSING'],
    evidence: [{ ...evidence, page: 2, textSnippet: '0.1000～0.3000' }],
    editRevision: 0,
    data: {
      outputSymbol: 'C',
      lower: { ...quantity, text: '0.1000', valueQ: 1000, evidence: [{ ...evidence, page: 2 }] },
      upper: { ...quantity, text: '0.3000', valueQ: 3000, evidence: [{ ...evidence, page: 2 }] },
      lowerInclusive: null,
      upperInclusive: null,
      endpointEvidence: [],
    },
  }
  return {
    draftId: 'draft-test',
    draftRevision: 2,
    status: 'draft',
    projectId: 'project-a',
    baseToken: 'base-project-a',
    sourceIdentity: {
      documentId: 'doc-1',
      revisionId: 'sr-1',
      sha256: 'a'.repeat(64),
      blobKey: 'blob-1',
      pageCount: 2,
    },
    pageRange: { from: 1, to: 2 },
    extractorVersion: 'document-extractor-1',
    idempotencyKey: 'project-a|doc-1|sr-1|' + 'a'.repeat(64) + '|1|2|document-extractor-1',
    candidates: [ringCandidate(), blocked, rejected, confirmed],
    issues: [
      {
        issueId: 'issue-endpoint',
        code: 'ENDPOINT_SEMANTICS_MISSING',
        severity: 'blocked',
        message: '端点语义缺失，不能默认闭区间',
        page: 2,
        candidateIds: ['cand-c'],
        evidence: [],
      },
    ],
    decisions: [
      {
        decisionId: 'decision-s-reject',
        candidateId: 'cand-s',
        action: 'reject',
        candidateEditRevision: 0,
        decidedAt: '2026-11-10T09:00:00.000Z',
        actor: 'local-operator',
        reason: '长度需人工核对',
        valueSnapshot: '[]',
        evidence: [],
        invalidatedByEditRevision: null,
      },
      {
        decisionId: 'decision-b1-confirm',
        candidateId: 'cand-b1',
        action: 'confirm',
        candidateEditRevision: 0,
        decidedAt: '2026-11-10T09:01:00.000Z',
        actor: 'local-operator',
        reason: null,
        valueSnapshot: '[]',
        evidence: [],
        invalidatedByEditRevision: null,
      },
    ],
  }
}

async function snapshot(): Promise<SnapshotDto> {
  const base = await createSampleSnapshot()
  const draft = draftFixture()
  return {
    ...base,
    project: {
      ...base.project,
      activeRequirementRevisionId: null,
      currentRequirementCheck: null,
      extractionDrafts: [draft],
    },
  }
}

function actions(): ExtractionReviewActions {
  return {
    onRun: vi.fn(async () => null),
    onDecide: vi.fn(async (request) => ({
      acceptedSeq: 1,
      draftId: 'draft-test',
      candidateId: request.candidateId,
      status: (request.action === 'confirm'
        ? 'confirmed'
        : request.action === 'reject'
          ? 'rejected'
          : 'pending') as 'confirmed' | 'rejected' | 'pending',
      decisionId: `decision-${request.candidateId}`,
      snapshot: null as never,
      recovery: 'written' as const,
    })),
    onCancel: vi.fn(async () => ({ cancelled: true })),
    onDeleteDraft: vi.fn(async (request) => ({
      acceptedSeq: 2,
      draftId: request.draftId,
      remainingDraftCount: 1,
      snapshot: null as never,
      recovery: 'written' as const,
    })),
  }
}

function ambiguousDraftFixture(): ExtractionDraft {
  const base = draftFixture()
  const a0 = ['0.100', '0.200', '0.150'].map((text, index) =>
    ringCandidate({
      candidateId: `cand-a0-${index + 1}`,
      symbol: 'A0',
      groupId: 'ring:A0',
      rawText: `A0 = ${text} mm`,
      status: index === 0 ? 'confirmed' : 'pending',
      occurrence: { index: index + 1, total: 3 },
      data: {
        symbol: 'A0',
        name: null,
        nominal: { ...quantity, text, valueQ: Math.round(Number(text) * 10000) },
        upperDeviation: null,
        lowerDeviation: null,
      },
    }),
  )
  return {
    ...base,
    candidates: a0,
    issues: [
      {
        issueId: 'issue-ambiguous',
        code: 'AMBIGUOUS_ASSIGNMENT',
        severity: 'warning',
        message: '符号 A0 出现 3 处不同取值；同一符号只能确认一处',
        page: 1,
        candidateIds: a0.map((candidate) => candidate.candidateId),
        evidence: [],
      },
    ],
    decisions: [
      {
        decisionId: 'decision-a0-1',
        candidateId: 'cand-a0-1',
        action: 'confirm',
        candidateEditRevision: 0,
        decidedAt: '2026-11-10T09:01:00.000Z',
        actor: 'local-operator',
        reason: null,
        valueSnapshot: '[]',
        evidence: [],
        invalidatedByEditRevision: null,
      },
    ],
  }
}

async function ambiguousSnapshot(): Promise<SnapshotDto> {
  const base = await createSampleSnapshot()
  return {
    ...base,
    project: {
      ...base.project,
      activeRequirementRevisionId: null,
      currentRequirementCheck: null,
      extractionDrafts: [ambiguousDraftFixture()],
    },
  }
}

describe('V3.6 同一符号多处赋值（面板）', () => {
  it('显示「同一符号第 k/N 处」与互斥提示；已确认一处后其余处确认按钮置灰', async () => {
    render(<ExtractionReviewPanel snapshot={await ambiguousSnapshot()} busy={false} actions={actions()} />)
    const list = screen.getByRole('list', { name: '提取候选列表' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(within(rows[0]!).getByText('同一符号第 1/3 处')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('同一符号第 2/3 处')).toBeInTheDocument()
    expect(within(rows[2]!).getByText('同一符号第 3/3 处')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('已确认')).toBeInTheDocument()
    expect(within(rows[1]!).getByText(/同一符号只能确认一处/)).toBeInTheDocument()
    expect(within(rows[1]!).getByText(/已确认第 1\/3 处，需先撤销该确认才能选此处/)).toBeInTheDocument()
    expect(within(rows[1]!).getByRole('button', { name: '确认' })).toBeDisabled()
    expect(within(rows[1]!).getByRole('button', { name: '确认' }).getAttribute('title')).toContain('请先撤销')
    expect(within(rows[2]!).getByRole('button', { name: '确认' })).toBeDisabled()
    expect(within(rows[0]!).getByRole('button', { name: '撤销确认' })).toBeEnabled()
  })

  it('撤销确认发出 action=revoke（不带 confirmed），不提供批量确认', async () => {
    const handler = actions()
    render(<ExtractionReviewPanel snapshot={await ambiguousSnapshot()} busy={false} actions={handler} />)
    const list = screen.getByRole('list', { name: '提取候选列表' })
    const first = within(list).getAllByRole('listitem')[0]!
    fireEvent.click(within(first).getByRole('button', { name: '撤销确认' }))
    expect(handler.onDecide).toHaveBeenCalledWith({
      draftId: 'draft-test',
      candidateId: 'cand-a0-1',
      editRevision: 0,
      action: 'revoke',
    })
    expect(screen.queryByRole('button', { name: /全部确认|批量确认/ })).toBeNull()
  })
})

describe('V3.6 提取审阅面板', () => {
  it('如实显示规则版本、样本限制与“不做 OCR/DOCX”', async () => {
    render(<ExtractionReviewPanel snapshot={await snapshot()} busy={false} actions={actions()} />)
    expect(screen.getByText('document-extractor-1')).toBeInTheDocument()
    expect(screen.getByText(/只验证过 1 份自造样例/)).toBeInTheDocument()
    expect(screen.getByText(/不做 OCR、DOCX、图片识别或联网识别/)).toBeInTheDocument()
    expect(screen.getByText(/未确认前不参与任何计算/)).toBeInTheDocument()
    expect(screen.getByText(/不自动提交/)).toBeInTheDocument()
  })

  it('候选逐条显示类型/原文/页/选区，且已确认与未确认一眼可分', async () => {
    render(<ExtractionReviewPanel snapshot={await snapshot()} busy={false} actions={actions()} />)
    const list = screen.getByRole('list', { name: '提取候选列表' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(4)
    expect(rows[0]?.getAttribute('data-status')).toBe('pending')
    expect(within(rows[0]!).getByText('待确认')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('组成环 · H · 总长')).toBeInTheDocument()
    expect(within(rows[0]!).getByText(/原文：H 总长 52.20/)).toBeInTheDocument()
    expect(within(rows[0]!).getByText(/第 1 页 · 选区 PDF 点/)).toBeInTheDocument()
    expect(within(rows[1]!).getByText('阻塞')).toBeInTheDocument()
    expect(within(rows[2]!).getByText('已拒绝')).toBeInTheDocument()
    expect(within(rows[2]!).getByText(/理由：长度需人工核对/)).toBeInTheDocument()
    expect(within(rows[3]!).getByText('已确认')).toBeInTheDocument()
    // 阻塞候选不能确认；已确认/已拒绝不能再确认。
    expect(within(rows[1]!).getByRole('button', { name: '确认' })).toBeDisabled()
    expect(within(rows[3]!).getByRole('button', { name: '确认' })).toBeDisabled()
    expect(within(rows[2]!).getByRole('button', { name: '确认' })).toBeDisabled()
  })

  it('确认必须逐条点击：发送 confirmed:true 与当前 editRevision，没有批量确认按钮', async () => {
    const handler = actions()
    render(<ExtractionReviewPanel snapshot={await snapshot()} busy={false} actions={handler} />)
    const list = screen.getByRole('list', { name: '提取候选列表' })
    const first = within(list).getAllByRole('listitem')[0]!
    fireEvent.click(within(first).getByRole('button', { name: '确认' }))
    expect(handler.onDecide).toHaveBeenCalledWith({
      draftId: 'draft-test',
      candidateId: 'cand-h',
      editRevision: 0,
      action: 'confirm',
      confirmed: true,
    })
    expect(screen.queryByRole('button', { name: /全部确认|批量确认/ })).toBeNull()
  })

  it('拒绝必须填理由；批量操作只拒绝选中项', async () => {
    const handler = actions()
    render(<ExtractionReviewPanel snapshot={await snapshot()} busy={false} actions={handler} />)
    const list = screen.getByRole('list', { name: '提取候选列表' })
    const rows = within(list).getAllByRole('listitem')
    fireEvent.click(within(rows[0]!).getByRole('button', { name: '拒绝…' }))
    const confirmReject = within(rows[0]!).getByRole('button', { name: '确认拒绝' })
    expect(confirmReject).toBeDisabled()
    fireEvent.change(within(rows[0]!).getByRole('textbox', { name: '拒绝理由' }), { target: { value: '原文不清' } })
    expect(within(rows[0]!).getByRole('button', { name: '确认拒绝' })).toBeEnabled()

    fireEvent.click(within(rows[0]!).getByLabelText(/选择候选 cand-h/))
    fireEvent.click(within(rows[1]!).getByLabelText(/选择候选 cand-c/))
    // 已确认/已拒绝的候选不能进入批量选择。
    expect(within(rows[2]!).getByLabelText(/选择候选 cand-s/)).toBeDisabled()
    expect(within(rows[3]!).getByLabelText(/选择候选 cand-b1/)).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '批量拒绝选中项' }))
    await waitFor(() => expect(handler.onDecide).toHaveBeenCalledTimes(2))
    expect(handler.onDecide).toHaveBeenNthCalledWith(1, expect.objectContaining({ candidateId: 'cand-h', action: 'reject' }))
    expect(handler.onDecide).toHaveBeenNthCalledWith(2, expect.objectContaining({ candidateId: 'cand-c', action: 'reject' }))
  })

  it('定位显示确切版本、页码与选区 PDF 点', async () => {
    render(<ExtractionReviewPanel snapshot={await snapshot()} busy={false} actions={actions()} />)
    const list = screen.getByRole('list', { name: '提取候选列表' })
    fireEvent.click(within(within(list).getAllByRole('listitem')[0]!).getByRole('button', { name: '定位到 PDF 选区' }))
    expect(screen.getByTestId('extraction-locate-summary').textContent).toContain('来源 PDF sr-1 第 1 页')
    expect(screen.getByTestId('extraction-locate-summary').textContent).toContain('[100, 600, 140, 615]')
  })

  it('编辑值提交字段与文本；改后仍回到待确认（由 main 记录代数）', async () => {
    const handler = actions()
    render(<ExtractionReviewPanel snapshot={await snapshot()} busy={false} actions={handler} />)
    const list = screen.getByRole('list', { name: '提取候选列表' })
    const first = within(list).getAllByRole('listitem')[0]!
    fireEvent.click(within(first).getByRole('button', { name: '编辑…' }))
    fireEvent.change(within(first).getByLabelText('编辑数值'), { target: { value: '52.20' } })
    fireEvent.click(within(first).getByRole('button', { name: '保存修改' }))
    expect(handler.onDecide).toHaveBeenCalledWith(
      expect.objectContaining({ candidateId: 'cand-h', action: 'edit', field: 'nominal', text: '52.20' }),
    )
  })
})

/** 同一 PDF 版本 + 同一页范围的旧规则版本草稿（4 条候选，含 1 条有效确认决定）。 */
function supersededDraft(): ExtractionDraft {
  return {
    ...draftFixture(),
    draftId: 'draft-old',
    extractorVersion: 'document-extractor-1',
    draftRevision: 3,
  }
}

/** 新规则版本草稿：候选故意与旧草稿不同，便于确认候选列表来自哪一份。 */
function latestDraft(): ExtractionDraft {
  return {
    ...draftFixture(),
    draftId: 'draft-new',
    extractorVersion: 'document-extractor-2',
    draftRevision: 1,
    candidates: [
      ringCandidate({
        candidateId: 'cand-new-h',
        symbol: 'H',
        rawText: 'H 总长 52.20 +0.02 -0.02（新规则）',
      }),
    ],
    issues: [],
    decisions: [],
  }
}

async function twoDraftSnapshot(order: 'old-first' | 'new-first'): Promise<SnapshotDto> {
  const base = await createSampleSnapshot()
  const list = order === 'old-first'
    ? [supersededDraft(), latestDraft()]
    : [latestDraft(), supersededDraft()]
  return {
    ...base,
    project: {
      ...base.project,
      activeRequirementRevisionId: null,
      currentRequirementCheck: null,
      extractionDrafts: list,
    },
  }
}

describe('V3.6 多草稿：默认最新 + 旧草稿折叠只读 + 删除二次确认', () => {
  it('默认选中最新的 extractor 版本（旧版在前也选新），顶部写明版本与草稿 id', async () => {
    render(<ExtractionReviewPanel snapshot={await twoDraftSnapshot('old-first')} busy={false} actions={actions()} />)
    const current = screen.getByTestId('extraction-current-draft')
    expect(current.textContent).toContain('document-extractor-2')
    expect(current.textContent).toContain('draft-new')
    expect(current.textContent).not.toContain('document-extractor-1')
    const list = screen.getByRole('list', { name: '提取候选列表' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(within(list).getByText(/新规则/)).toBeInTheDocument()
  })

  it('旧草稿折叠成一行：版本/候选数/已确认数/被谁取代', async () => {
    render(<ExtractionReviewPanel snapshot={await twoDraftSnapshot('new-first')} busy={false} actions={actions()} />)
    expect(
      screen.getByText('旧规则版本（document-extractor-1）· 共 4 条候选（已确认 1）· 已被 v2 取代'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: /旧草稿候选列表/ })).toBeNull()
  })

  it('展开旧草稿：候选可看、确认/编辑/拒绝禁用并写明原因，定位仍可用', async () => {
    render(<ExtractionReviewPanel snapshot={await twoDraftSnapshot('old-first')} busy={false} actions={actions()} />)
    fireEvent.click(screen.getByRole('button', { name: '展开查看旧草稿候选' }))
    const oldList = screen.getByRole('list', { name: '旧草稿候选列表 draft-old' })
    const rows = within(oldList).getAllByRole('listitem')
    expect(rows).toHaveLength(4)
    expect(
      within(rows[0]!).getByText(/旧规则版本，请在新版（document-extractor-2）上复核后确认/),
    ).toBeInTheDocument()
    expect(within(rows[0]!).getByRole('button', { name: '确认' })).toBeDisabled()
    expect(within(rows[0]!).getByRole('button', { name: '确认' }).getAttribute('title')).toContain('旧规则版本')
    expect(within(rows[0]!).getByRole('button', { name: '拒绝…' })).toBeDisabled()
    expect(within(rows[0]!).getByRole('button', { name: '编辑…' })).toBeDisabled()
    expect(within(rows[0]!).getByLabelText(/选择候选 cand-h/)).toBeDisabled()
    const locateButton = within(rows[0]!).getByRole('button', { name: '定位到 PDF 选区' })
    expect(locateButton).toBeEnabled()
    fireEvent.click(locateButton)
    expect(screen.getByTestId('extraction-locate-summary').textContent).toContain('来源 PDF sr-1 第 1 页')
  })

  it('删除先二次确认：写明已确认决定数，确认后才发删除请求', async () => {
    const handler = actions()
    render(<ExtractionReviewPanel snapshot={await twoDraftSnapshot('old-first')} busy={false} actions={handler} />)
    fireEvent.click(screen.getByRole('button', { name: '删除该旧草稿…' }))
    const box = screen.getByRole('group', { name: '删除旧草稿确认' })
    expect(within(box).getByRole('alert').textContent).toContain('该草稿有 1 条已确认决定，删除后不可恢复')
    expect(handler.onDeleteDraft).not.toHaveBeenCalled()
    fireEvent.click(within(box).getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(handler.onDeleteDraft).toHaveBeenCalledWith({ draftId: 'draft-old' }))
    expect(screen.getByRole('status').textContent).toContain('已删除旧草稿 draft-old')
  })

  it('无已确认决定的旧草稿：确认框写明“无已确认决定”', async () => {
    const base = await createSampleSnapshot()
    const snapshot: SnapshotDto = {
      ...base,
      project: {
        ...base.project,
        activeRequirementRevisionId: null,
        currentRequirementCheck: null,
        extractionDrafts: [{ ...supersededDraft(), decisions: [] }, latestDraft()],
      },
    }
    render(<ExtractionReviewPanel snapshot={snapshot} busy={false} actions={actions()} />)
    fireEvent.click(screen.getByRole('button', { name: '删除该旧草稿…' }))
    const box = screen.getByRole('group', { name: '删除旧草稿确认' })
    expect(within(box).getByRole('alert').textContent).toContain('该草稿无已确认决定')
  })

  it('删除失败（返回 null）：提示错误、旧草稿仍在', async () => {
    const handler = actions()
    handler.onDeleteDraft = vi.fn(async () => null)
    render(<ExtractionReviewPanel snapshot={await twoDraftSnapshot('old-first')} busy={false} actions={handler} />)
    fireEvent.click(screen.getByRole('button', { name: '删除该旧草稿…' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(screen.getByText(/删除未执行/)).toBeInTheDocument())
    expect(screen.getByText(/旧规则版本（document-extractor-1）/)).toBeInTheDocument()
  })
})

