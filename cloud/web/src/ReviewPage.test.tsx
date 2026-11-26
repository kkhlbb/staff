// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EvidenceRef } from '../../../src/document-extraction/types'
import type { CheckSet, CommitDraftResult, Transport } from '../../../src/transport/types'
import type { M2ModelMesh } from '../../../src/workspace/project-agent/m2WorkbenchBridge'
import { ReviewPage } from './ReviewPage'
import { parseReviewRoute } from './router'

afterEach(() => {
  cleanup()
})

const SAMPLE_MESH: M2ModelMesh = {
  positions: [
    0, 0, 0,
    120, 0, 0,
    120, 80, 0,
    0, 80, 0,
    0, 0, 12,
    120, 0, 12,
  ],
  indices: [0, 1, 2, 0, 2, 3, 0, 1, 5, 0, 5, 4],
  triangleRanges: [
    { startTriangle: 0, endTriangle: 2, objectId: 'feat-plate-body', featureRef: 'plate.body' },
    { startTriangle: 2, endTriangle: 4, objectId: 'feat-right-hole', featureRef: 'plate.hole.right' },
  ],
  bounds: { min: [0, 0, 0], max: [120, 80, 12] },
}

const SAMPLE_EVIDENCE: Record<string, readonly EvidenceRef[]> = {
  'chk-edge': [
    {
      kind: 'pdf-text',
      documentId: 'taskbook-plate.pdf',
      revisionId: 'src-rev-1',
      sha256: 'a'.repeat(64),
      blobKey: 'blobs/taskbook',
      page: 2,
      rectPdf: { x: 10, y: 20, width: 100, height: 14 },
      pageBoxPdf: { width: 595, height: 842 },
      textSnippet: '右孔中心到右边缘最小距离 >= 15.0 mm',
    },
  ],
  'chk-gap': [
    {
      kind: 'user-attestation',
      actorId: 'engineer-li',
      at: '2026-11-25T08:00:00Z',
      sessionSeq: 2,
      sessionLabel: '复核确认',
      statement: '板与盖板间隙需大于 0.20 mm',
      fieldPath: 'assembly.gap',
    },
  ],
}

function createMockTransport(options: {
  readonly review: CheckSet
  readonly summary?: string
  readonly baseRevision?: string | null
  readonly confirmationToken?: string
  readonly reviewResponse?: Awaited<ReturnType<Transport['getReview']>>
  readonly commitResponse?: Awaited<ReturnType<Transport['commitDraft']>>
  readonly commitStatus?: Awaited<ReturnType<Transport['getCommitStatus']>>
}): Transport {
  const unimpl = async () => ({
    ok: false as const,
    error: { code: 'NOT_IMPLEMENTED', message: 'not used in test' },
  })

  return {
    listProjects: unimpl,
    createProject: unimpl,
    importProject: unimpl,
    getProject: unimpl,
    readAttachmentBytes: unimpl,
    capabilities: unimpl,
    uploadAttachment: unimpl,
    buildGeometry: unimpl,
    triangulate: vi.fn(async () => ({ ok: true as const, value: SAMPLE_MESH })),
    runChecks: unimpl,
    runSimulation: unimpl,
    getDrawing: vi.fn(async () => ({
      ok: true as const,
      value: {
        bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
        fingerprint: 'drw-fp-001',
      },
    })),
    acquireWriter: unimpl,
    takeOverWriter: unimpl,
    revokeWriter: unimpl,
    readWriterContext: unimpl,
    stageChange: unimpl,
    commitDraft: vi.fn(
      async () =>
        options.commitResponse ?? {
          ok: true as const,
          value: {
            projectId: options.review.projectId,
            committedRevision: 'rev-2',
            previousBaseRevision: options.baseRevision ?? 'rev-1',
            committedDraftRevision: options.review.draftRevision,
            checksetFingerprint: options.review.checksetFingerprint,
            summary: '已原子提交至正式版本',
            webhook: { status: 'delivered', httpStatus: 200, url: 'https://agentarts.test/hook' },
          } as CommitDraftResult,
        },
    ),
    authorizeProject: unimpl,
    getContext: unimpl,
    getExternalActivities: unimpl,
    readProjectEvents: unimpl,
    getReview: vi.fn(
      async () =>
        options.reviewResponse ?? {
          ok: true as const,
          value: {
            review: options.review,
            summary: options.summary ?? '右孔 X 坐标调整至 95.0 mm',
            baseRevision: options.baseRevision === undefined ? 'rev-1' : options.baseRevision,
            ...(options.confirmationToken ? { confirmationToken: options.confirmationToken } : {}),
          },
        },
    ),
    getCommitStatus: vi.fn(
      async () =>
        options.commitStatus ?? {
          ok: true as const,
          value: { state: 'awaiting-confirmation' as const },
        },
    ),
    getConnectionStatus: unimpl,
    testModelConnection: unimpl,
    listModels: unimpl,
  }
}

describe('parseReviewRoute', () => {
  it('解析标准路径、哈希路径、查询参数并拒绝无效路径', () => {
    expect(
      parseReviewRoute({
        pathname: '/review/proj-01/draft-3',
        search: '?apiBase=https%3A%2F%2Fapi.test&theme=dark',
      }),
    ).toEqual({
      matched: true,
      projectId: 'proj-01',
      draftRevision: 'draft-3',
      apiBase: 'https://api.test',
      apiKey: undefined,
      webhookUrl: undefined,
      theme: 'dark',
    })

    expect(
      parseReviewRoute({
        pathname: '/',
        hash: '#/review/proj-02/draft-9?webhookUrl=https%3A%2F%2Fhook.test%2Fcb',
      }),
    ).toEqual({
      matched: true,
      projectId: 'proj-02',
      draftRevision: 'draft-9',
      apiBase: '',
      apiKey: undefined,
      webhookUrl: 'https://hook.test/cb',
      theme: undefined,
    })

    const invalid = parseReviewRoute({ pathname: '/unknown/path' })
    expect(invalid.matched).toBe(false)
  })
})

describe('ReviewPage', () => {
  it('无效路径展示清晰引导提示', () => {
    render(<ReviewPage locationLike={{ pathname: '/bad-route' }} />)
    expect(screen.getByTestId('review-invalid-route')).toBeInTheDocument()
    expect(screen.getByText(/\/review\/:projectId\/:draftRev/)).toBeInTheDocument()
  })

  it('渲染 3D/2D 视口、支持三视图切换、检查条款双向高亮与原文溯源，并在必需项阻塞时禁用提交', async () => {
    const user = userEvent.setup()
    const blockedReview: CheckSet = {
      projectId: 'proj-plate',
      draftRevision: 'draft-4',
      checksetFingerprint: 'csfp-blocked-01',
      checks: [
        {
          checkId: 'chk-edge',
          requirementId: 'req-edge',
          title: '右孔边距极值校验',
          required: true,
          status: 'fail',
          summary: '实际最小边距 11.2 mm < 15.0 mm',
          linkedFeatureIds: ['feat-right-hole'],
          linkedAnnotationIds: ['ann-right-edge'],
        },
        {
          checkId: 'chk-gap',
          requirementId: 'req-gap',
          title: '板-盖板平行间隙',
          required: true,
          status: 'pass',
          summary: '最小间隙 0.45 mm >= 0.20 mm',
          linkedFeatureIds: ['feat-plate-body'],
          linkedAnnotationIds: ['ann-gap'],
        },
      ],
      evidenceByCheckId: SAMPLE_EVIDENCE,
    }

    const transport = createMockTransport({ review: blockedReview })
    render(
      <ReviewPage
        locationLike={{ pathname: '/review/proj-plate/draft-4' }}
        transport={transport}
      />,
    )

    // 等待审核数据加载完成
    expect(await screen.findByTestId('review-fingerprint')).toHaveTextContent('csfp-blocked-01')
    expect(screen.getByTestId('review-project-id')).toHaveTextContent('proj-plate')
    expect(screen.getByTestId('review-draft-rev')).toHaveTextContent('draft-4')

    // 3D 与 2D 视口在默认并排模式下同时渲染
    expect(screen.getByTestId('m2-three-viewport')).toBeInTheDocument()
    expect(screen.getByTestId('m2-drawing-vector-stage')).toBeInTheDocument()

    // 问题特征提供醒目红框高亮浮层
    const failedOverlay = screen.getByTestId('review-failed-feature-overlay')
    expect(failedOverlay).toHaveTextContent('feat-right-hole')
    expect(screen.getByTestId('review-3d-card')).toHaveAttribute('data-has-failed-features', 'true')

    // 默认选中首个问题检查项，展示 PDF 原文溯源
    expect(screen.getByTestId('review-evidence-panel')).toHaveTextContent(
      '右孔中心到右边缘最小距离 >= 15.0 mm',
    )

    // 点击第二条检查项，同步切换高亮特征与原文溯源
    await user.click(screen.getByTestId('review-check-item-chk-gap'))
    expect(screen.getByTestId('review-evidence-panel')).toHaveTextContent(
      '板与盖板间隙需大于 0.20 mm',
    )
    expect(screen.getByTestId('m2-three-viewport')).toHaveAttribute(
      'data-selected-object-id',
      'feat-plate-body',
    )

    // 三视图切换：仅模型 / 仅图纸 / 并排
    await user.click(screen.getByRole('button', { name: '模型' }))
    expect(screen.getByTestId('review-3d-card')).toBeInTheDocument()
    expect(screen.queryByTestId('review-2d-card')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '图纸' }))
    expect(screen.queryByTestId('review-3d-card')).not.toBeInTheDocument()
    expect(screen.getByTestId('review-2d-card')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '并排' }))
    expect(screen.getByTestId('review-3d-card')).toBeInTheDocument()
    expect(screen.getByTestId('review-2d-card')).toBeInTheDocument()

    // 必需项阻塞时禁用提交并列出阻塞原因
    expect(screen.getByTestId('review-blocking-alert')).toHaveTextContent('右孔边距极值校验')
    expect(screen.getByRole('button', { name: '确认并提交' })).toBeDisabled()
  })

  it('全部必需项通过时需人工勾选确认，提交成功后展示新正式修订号与 Webhook 状态', async () => {
    const user = userEvent.setup()
    const passReview: CheckSet = {
      projectId: 'proj-ok',
      draftRevision: 'draft-5',
      checksetFingerprint: 'csfp-pass-55',
      checks: [
        {
          checkId: 'chk-gap',
          requirementId: 'req-gap',
          title: '板-盖板平行间隙',
          required: true,
          status: 'pass',
          summary: '最小间隙 0.45 mm >= 0.20 mm',
          linkedFeatureIds: ['feat-plate-body'],
          linkedAnnotationIds: ['ann-gap'],
        },
      ],
      evidenceByCheckId: SAMPLE_EVIDENCE,
    }

    const transport = createMockTransport({ review: passReview })
    render(
      <ReviewPage
        locationLike={{
          pathname: '/review/proj-ok/draft-5',
          search: '?webhookUrl=https%3A%2F%2Fagentarts.test%2Fhook',
        }}
        transport={transport}
      />,
    )

    expect(await screen.findByTestId('review-fingerprint')).toHaveTextContent('csfp-pass-55')
    const commitBtn = screen.getByRole('button', { name: '确认并提交' })
    expect(commitBtn).toBeDisabled()

    await user.click(screen.getByRole('checkbox'))
    expect(commitBtn).toBeEnabled()

    await user.click(commitBtn)

    await waitFor(() => {
      expect(screen.getByTestId('review-committed-card')).toBeInTheDocument()
    })
    expect(screen.getByTestId('review-committed-card')).toHaveTextContent('rev-2')
    expect(screen.getByTestId('review-webhook-status')).toHaveTextContent('Webhook 回调已送达')
    expect(transport.commitDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj-ok',
        baseRevision: 'rev-1',
        draftRevision: 'draft-5',
        checksetFingerprint: 'csfp-pass-55',
        webhook: { url: 'https://agentarts.test/hook' },
      }),
    )
  })

  it('409 指纹过期/租约冲突展示清晰报错并提供刷新最新草稿恢复入口', async () => {
    const user = userEvent.setup()
    const passReview: CheckSet = {
      projectId: 'proj-409',
      draftRevision: 'draft-6',
      checksetFingerprint: 'csfp-stale-06',
      checks: [
        {
          checkId: 'chk-gap',
          requirementId: 'req-gap',
          title: '板-盖板平行间隙',
          required: true,
          status: 'pass',
          summary: '通过',
          linkedFeatureIds: ['feat-plate-body'],
          linkedAnnotationIds: ['ann-gap'],
        },
      ],
    }

    const transport = createMockTransport({
      review: passReview,
      commitResponse: {
        ok: false,
        error: {
          code: 'FINGERPRINT_MISMATCH',
          message: '草稿已被其他写入方更新，检查集指纹已失效',
          detail: 'expected=csfp-stale-06 actual=csfp-latest-07',
        },
      },
    })

    render(
      <ReviewPage
        locationLike={{ pathname: '/review/proj-409/draft-6' }}
        transport={transport}
      />,
    )

    expect(await screen.findByTestId('review-fingerprint')).toHaveTextContent('csfp-stale-06')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: '确认并提交' }))

    const conflictAlert = await screen.findByTestId('review-conflict-alert')
    expect(conflictAlert).toHaveTextContent('FINGERPRINT_MISMATCH')
    expect(conflictAlert).toHaveTextContent('草稿已被其他写入方更新')

    const refreshBtn = screen.getByRole('button', { name: '刷新最新草稿' })
    await user.click(refreshBtn)
    await waitFor(() => {
      expect(transport.getReview).toHaveBeenCalledTimes(2)
    })
  })

  it('提交时透传服务端签发的 confirmationToken 而非客户端伪造令牌', async () => {
    const user = userEvent.setup()
    const serverToken = '1799999999999.' + 'b'.repeat(64)
    const passReview: CheckSet = {
      projectId: 'proj-tok',
      draftRevision: 'draft-7',
      checksetFingerprint: 'csfp-tok-07',
      checks: [
        {
          checkId: 'chk-gap',
          requirementId: 'req-gap',
          title: '板-盖板平行间隙',
          required: true,
          status: 'pass',
          summary: '通过',
          linkedFeatureIds: ['feat-plate-body'],
          linkedAnnotationIds: ['ann-gap'],
        },
      ],
    }

    const transport = createMockTransport({
      review: passReview,
      confirmationToken: serverToken,
    })
    render(
      <ReviewPage
        locationLike={{ pathname: '/review/proj-tok/draft-7' }}
        transport={transport}
      />,
    )

    expect(await screen.findByTestId('review-fingerprint')).toHaveTextContent('csfp-tok-07')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: '确认并提交' }))

    await waitFor(() => {
      expect(screen.getByTestId('review-committed-card')).toBeInTheDocument()
    })
    expect(transport.commitDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmationToken: serverToken,
      }),
    )
  })

  it('刷新已提交草稿的审核链接时（GET /review 返回 STALE_DRAFT），优先依据 commit 状态展示已提交结果', async () => {
    const emptyReview: CheckSet = {
      projectId: 'proj-done',
      draftRevision: 'draft-8',
      checksetFingerprint: 'csfp-done-08',
      checks: [],
    }
    const transport = createMockTransport({
      review: emptyReview,
      reviewResponse: {
        ok: false,
        error: { code: 'STALE_DRAFT', message: 'STALE_DRAFT' },
      },
      commitStatus: {
        ok: true,
        value: {
          state: 'committed',
          result: {
            projectId: 'proj-done',
            committedRevision: 'rev-9',
            previousBaseRevision: 'rev-8',
            committedDraftRevision: 'draft-8',
            checksetFingerprint: 'csfp-done-08',
            summary: 'chk-spacer=pass',
          },
        },
      },
    })

    render(
      <ReviewPage
        locationLike={{ pathname: '/review/proj-done/draft-8' }}
        transport={transport}
      />,
    )

    const committedCard = await screen.findByTestId('review-committed-card')
    expect(committedCard).toHaveTextContent('rev-9')
    expect(committedCard).toHaveTextContent('csfp-done-08')
    expect(screen.getByTestId('review-status-pill')).toHaveTextContent('已正式提交')
    expect(screen.queryByTestId('review-load-error')).not.toBeInTheDocument()
  })

  it('M3G-FE-01: FEATURE_3D_ASSEMBLY_M1 开启时云端审核页只读展示 3D FCF 框格、基准徽标、防遮挡切换与 GdtContributionItem（不弹编辑气泡）', async () => {
    const user = userEvent.setup()
    const gdtReview: CheckSet = {
      projectId: 'proj-gdt-cloud',
      draftRevision: 'draft-9',
      checksetFingerprint: 'csfp-gdt-09',
      checks: [
        {
          checkId: 'chk-pos',
          requirementId: 'req-pos',
          title: '右孔位置度校核',
          required: true,
          status: 'pass',
          summary: 'Cpk 1.48，满足要求',
          linkedFeatureIds: ['feat-right-hole'],
          linkedAnnotationIds: ['ann-pos'],
        },
      ],
      evidenceByCheckId: SAMPLE_EVIDENCE,
    }

    const transport = createMockTransport({ review: gdtReview })
    render(
      <ReviewPage
        locationLike={{ pathname: '/review/proj-gdt-cloud/draft-9' }}
        transport={transport}
        feature3dAssemblyM1={true}
        initialGdtSnapshot={{
          datums: [{ id: 'datum-A', label: 'A', featureId: 'feat-plate-body' }],
          gdt: [
            {
              id: 'gdt-cloud-pos',
              featureId: 'feat-right-hole',
              kind: 'position',
              toleranceQ: 1200,
              modifier: 'MMC',
              datumIds: ['datum-A'],
              datumModifiers: ['RFS'],
              zoneShape: 'cylindrical',
            },
          ],
          contributions: [
            {
              gdtId: 'gdt-cloud-pos',
              label: '右孔位置度',
              kind: 'position',
              varianceSharePct: 62.5,
              bonusMeanMm: 0.045,
              datumShiftContributionPct: 12.0,
            },
          ],
        }}
      />,
    )

    expect(await screen.findByTestId('review-fingerprint')).toHaveTextContent('csfp-gdt-09')

    // 3D GD&T 标注层 + 基准徽标 + 智能防遮挡↔全部展开切换
    expect(screen.getByTestId('gdt-3d-overlay-layer')).toBeInTheDocument()
    expect(screen.getByTestId('gdt-datum-datum-A')).toHaveTextContent('基准 A')
    await user.click(screen.getByTestId('gdt-mode-expand-all'))
    const fcfBox = screen.getByTestId('gdt-fcf-box-gdt-cloud-pos')
    expect(fcfBox).toHaveTextContent('⌖')
    expect(fcfBox).toHaveTextContent('Ø0.12Ⓜ')

    // 只读模式：点击 3D FCF 仅高亮联动，绝不弹出编辑微调气泡
    await user.click(fcfBox)
    expect(screen.queryByTestId('gdt-inline-editor')).not.toBeInTheDocument()

    // 右侧只读展示 GdtContributionItem 明细（方差占比、MMC Bonus、Datum Shift）
    const contribPanel = screen.getByTestId('review-gdt-contributions')
    expect(contribPanel).toHaveTextContent('62.5%')
    expect(contribPanel).toHaveTextContent('MMC Bonus +0.045 mm')
    expect(contribPanel).toHaveTextContent('Datum Shift 12.0%')
  })

  it('M4F1-FE-01: 云端审核页只读展示 3D 形变热力云图三态切换/色标 Legend（无编辑浮层）与刚体/柔性对比卡', async () => {
    const user = userEvent.setup()
    const flexReview: CheckSet = {
      projectId: 'proj-flex-cloud',
      draftRevision: 'draft-11',
      checksetFingerprint: 'csfp-flex-11',
      checks: [
        {
          checkId: 'chk-gap',
          requirementId: 'req-gap',
          title: '盖板-底座残余间隙',
          required: true,
          status: 'pass',
          summary: '柔性耦合 Cpk 1.12',
          linkedFeatureIds: ['feat-plate-body'],
          linkedAnnotationIds: ['ann-gap'],
        },
      ],
      evidenceByCheckId: SAMPLE_EVIDENCE,
    }

    const transport = createMockTransport({ review: flexReview })
    render(
      <ReviewPage
        locationLike={{ pathname: '/review/proj-flex-cloud/draft-11' }}
        transport={transport}
        feature3dAssemblyM1={true}
        initialGdtSnapshot={{
          compliantSummary: {
            rigidBaseline: { cpk: 1.54, ppm: 4, threeSigmaIntervalMm: [0.11, 0.29] },
            compliantResult: { cpk: 1.12, ppm: 780, threeSigmaIntervalMm: [0.06, 0.34] },
            flexDeltaCpk: -0.42,
            flexContributionItems: [
              {
                modelId: 'model-cover-warp',
                kind: 'plate-clamping',
                label: '薄铝盖板初始翘曲 0.28mm',
                varianceSharePct: 54.0,
              },
            ],
          },
          displacementFields: [
            {
              partId: 'part-cover',
              maxDisplacementMm: 0.28,
              minDisplacementMm: 0.01,
              samples: [{ posMm: [60, 40, 12], dispMm: [0, 0, 0.28], magMm: 0.28 }],
            },
          ],
        }}
      />,
    )

    expect(await screen.findByTestId('review-fingerprint')).toHaveTextContent('csfp-flex-11')

    // 3D 视口左下角三态切换与色标 Legend，且无编辑配置浮层
    const viewport = screen.getByTestId('m2-three-viewport')
    expect(viewport).toHaveAttribute('data-deformation-mode', 'nominal')
    await user.click(screen.getByTestId('deformation-mode-heatmap'))
    expect(viewport).toHaveAttribute('data-deformation-mode', 'heatmap')
    expect(screen.getByTestId('deformation-heatmap-legend')).toHaveTextContent('0.280 mm 变形')
    expect(screen.queryByTestId('physics-config-popover')).not.toBeInTheDocument()

    // 右侧审核栏只读展示「刚体 vs 柔性对比卡」与柔性因素贡献度
    const compCard = screen.getByTestId('review-compliant-comparison-card')
    expect(compCard).toHaveTextContent('Cpk 1.54')
    expect(compCard).toHaveTextContent('Cpk 1.12')
    expect(screen.getByTestId('review-flex-delta-cpk')).toHaveTextContent('ΔCpk -0.42')
    expect(screen.getByTestId('review-flex-contrib-model-cover-warp')).toHaveTextContent('54.0%')

    // 取消勾选「计入柔性」切换查看纯刚体基线并给出风险提示
    await user.click(screen.getByTestId('review-toggle-rigid-baseline'))
    expect(screen.getByTestId('review-rigid-warning')).toHaveTextContent('纯刚体基线')
    expect(viewport).toHaveAttribute('data-deformation-mode', 'nominal')
  })

  it('M4-QA-01: 直接读取服务端 GET /review 返回的 compliantSnapshot 与 gdtSnapshot 合并展示', async () => {
    const flexReview: CheckSet = {
      projectId: 'proj-flex-srv',
      draftRevision: 'draft-12',
      checksetFingerprint: 'csfp-flex-12',
      checks: [
        {
          checkId: 'chk-gap-srv',
          requirementId: 'req-gap-srv',
          title: '盖板-底座残余间隙',
          required: true,
          status: 'pass',
          summary: '柔性耦合 Cpk 1.15',
          linkedFeatureIds: ['feat-plate-body'],
          linkedAnnotationIds: ['ann-gap'],
        },
      ],
      evidenceByCheckId: SAMPLE_EVIDENCE,
    }
    const baseTransport = createMockTransport({ review: flexReview })
    const transport: Transport = {
      ...baseTransport,
      capabilities: async () => ({
        ok: true,
        value: {
          transport: 'http',
          stepExport: false,
          stepImport: false,
          FEATURE_3D_ASSEMBLY_M1: true,
        },
      }),
      getReview: async (draftRef) => {
        const res = await baseTransport.getReview(draftRef)
        if (!res.ok) return res
        return {
          ok: true,
          value: {
            ...res.value,
            gdtSnapshot: {
              datums: [{ id: 'datum-A', label: 'A', featureId: 'feat-plate-body' }],
              gdt: [],
              contributions: [],
              warnings: [],
            },
            compliantSnapshot: {
              physics: { enabled: true },
              summary: {
                rigidBaseline: { cpk: 1.6, ppm: 2, threeSigmaIntervalMm: [0.1, 0.25] },
                compliantResult: { cpk: 1.15, ppm: 550, threeSigmaIntervalMm: [0.05, 0.32] },
                flexDeltaCpk: -0.45,
                flexContributionItems: [
                  {
                    modelId: 'cm-cover',
                    kind: 'plate-clamping',
                    label: '盖板锁紧',
                    varianceSharePct: 48.5,
                  },
                ],
              },
              displacementFields: [
                {
                  partId: 'part-cover',
                  maxDisplacementMm: 0.24,
                  minDisplacementMm: 0.0,
                  samples: [{ posMm: [40, 25, 10], dispMm: [0, 0, 0.24], magMm: 0.24 }],
                },
              ],
            },
          } as typeof res.value,
        }
      },
    }

    render(
      <ReviewPage
        locationLike={{ pathname: '/review/proj-flex-srv/draft-12' }}
        transport={transport}
      />,
    )

    const compCard = await screen.findByTestId('review-compliant-comparison-card')
    expect(compCard).toHaveTextContent('Cpk 1.60')
    expect(compCard).toHaveTextContent('Cpk 1.15')
    expect(screen.getByTestId('review-flex-delta-cpk')).toHaveTextContent('ΔCpk -0.45')
    expect(screen.getByTestId('review-flex-contrib-cm-cover')).toHaveTextContent('48.5%')
  })

  it('V100-FE-01: 云端只读审核页渲染 5 类新框格与双层复合框格，并支持一键下载离线 HTML 报告与打印 PDF', async () => {
    const user = userEvent.setup()
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {})
    const exportMock = vi.fn(async () => ({
      ok: true as const,
      value: {
        fileName: 'proj-v100-review-report.html',
        mimeType: 'text/html' as const,
        sha256: 'deadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678',
        revision: 'draft-v100',
        checksetFingerprint: 'csfp-v100',
        content: '<!doctype html><html><body>OK</body></html>',
      },
    }))
    const v100Review: CheckSet = {
      projectId: 'proj-v100-review',
      draftRevision: 'draft-v100',
      checksetFingerprint: 'csfp-v100',
      checks: [
        {
          checkId: 'chk-v100-1',
          requirementId: 'req-v100-1',
          title: '复合位置度与面轮廓度检查',
          required: true,
          status: 'pass',
          summary: '满足公差要求',
          linkedFeatureIds: ['feat-hole-right'],
          linkedAnnotationIds: ['ann-v100'],
        },
      ],
      evidenceByCheckId: SAMPLE_EVIDENCE,
    }
    const baseTransport = createMockTransport({ review: v100Review })
    const transport: Transport = {
      ...baseTransport,
      exportSimulationReport: exportMock,
    }

    render(
      <ReviewPage
        locationLike={{ pathname: '/review/proj-v100-review/draft-v100' }}
        transport={transport}
        feature3dAssemblyM1={true}
        initialGdtSnapshot={{
          datums: [
            { id: 'datum-A', label: 'A', featureId: 'feat-plate-body' },
            { id: 'datum-B', label: 'B', featureId: 'feat-hole-right' },
          ],
          gdt: [
            {
              id: 'gdt-web-prof',
              featureId: 'feat-plate-body',
              kind: 'profile-surface',
              toleranceQ: 10000,
              datumIds: ['datum-A'],
              unequalProfileOuterFraction: 0.3,
            },
            {
              id: 'gdt-web-comp',
              featureId: 'feat-hole-right',
              kind: 'composite-position',
              toleranceQ: 2000,
              modifier: 'MMC',
              datumIds: ['datum-A', 'datum-B'],
              lowerSegment: {
                toleranceQ: 800,
                modifier: 'MMC',
                datumIds: ['datum-A'],
              },
            },
          ],
          contributions: [],
          warnings: [],
        }}
      />,
    )

    expect(await screen.findByTestId('review-fingerprint')).toHaveTextContent('csfp-v100')
    await user.click(screen.getByTestId('gdt-mode-expand-all'))

    expect(screen.getByTestId('gdt-fcf-box-gdt-web-prof')).toHaveTextContent('⌒')
    expect(screen.getByTestId('gdt-fcf-uz-gdt-web-prof')).toHaveTextContent('UZ 0.3')
    const compBox = screen.getByTestId('gdt-fcf-box-gdt-web-comp')
    expect(compBox).toHaveAttribute('data-composite', 'true')
    expect(screen.getByTestId('gdt-fcf-upper-gdt-web-comp')).toHaveTextContent('Ø0.20Ⓜ')
    expect(screen.getByTestId('gdt-fcf-lower-gdt-web-comp')).toHaveTextContent('Ø0.08Ⓜ')

    // 顶部「下载离线 HTML 报告」调用 transport.exportSimulationReport
    await user.click(screen.getByTestId('review-export-html-btn'))
    await waitFor(() => {
      expect(exportMock).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'proj-v100-review',
          format: 'html',
          includeSnapshots: true,
        }),
      )
    })
    expect(screen.getByTestId('review-report-feedback')).toHaveTextContent('proj-v100-review-report.html')
    expect(screen.getByTestId('review-report-feedback')).toHaveTextContent('deadbeef1234')

    // 顶部「打印 PDF」调用 window.print()
    await user.click(screen.getByTestId('review-print-pdf-btn'))
    expect(printSpy).toHaveBeenCalledTimes(1)
  })
})
