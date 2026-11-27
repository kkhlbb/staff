// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ProjectAgentM1Workbench } from './ProjectAgentM1Workbench'
import type { M1WorkbenchBridge } from './m1WorkbenchBridge'
import {
  DEFAULT_M2_REQUIREMENTS,
  type M2CheckItem,
  type M2PreviewEvent,
  type M2WorkbenchBridge,
} from './m2WorkbenchBridge'
import type {
  M3CommitApprovedDraftResult,
  M3ExternalProjectEvent,
  M3MigrationReport,
  M3OpenExternalProjectResult,
  M3UndoDraftChangeResult,
  M3WorkbenchBridge,
} from './m3WorkbenchBridge'
import type { M1WorkbenchBridgeResult } from './m1WorkbenchBridge'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const ALL_CONFIRMED_REQUIREMENTS = [DEFAULT_M2_REQUIREMENTS[0], DEFAULT_M2_REQUIREMENTS[1]]

const ALL_PASS_CHECKS: readonly M2CheckItem[] = [
  {
    checkId: 'chk-right-margin',
    requirementId: 'req-right-margin',
    title: '右孔至右端面最小剩余材料',
    required: true,
    status: 'pass',
    summary: '名义 14.0 mm，范围 [13.75, 14.25] mm ≥ 13.0 mm',
    linkedFeatureIds: ['obj-right-hole', 'obj-right-face'],
    linkedAnnotationIds: ['ann-right-margin'],
    revisionFingerprint: 'fp-draft-3',
  },
  {
    checkId: 'chk-cover-gap',
    requirementId: 'req-cover-gap',
    title: '参考盖板与安装板法向间隙',
    required: true,
    status: 'pass',
    summary: '名义 2.0 mm，范围 [1.7, 2.3] mm ≥ 1.5 mm',
    linkedFeatureIds: ['obj-cover-gap'],
    linkedAnnotationIds: ['ann-cover-gap'],
    revisionFingerprint: 'fp-draft-3',
  },
]

const SAMPLE_MIGRATION_REPORT: M3MigrationReport = {
  projectId: 'sample-spacer-01',
  sourceFormat: '.cunlian v1 隔套项目',
  originalFilePreserved: true,
  originalFilePath: '/Users/demo/spacer-legacy.cunlian',
  migratedAtLabel: '2026-11-24 18:00',
  unexplainedLegacyFields: [
    {
      fieldPath: 'legacyMeta.shopFloorNote',
      rawValueSummary: '"热处理后复检端面"',
      reason: '旧版自定义车间备注字段未映射到新结构化条款，保留在原件中供查阅。',
      preservedInOriginal: true,
    },
  ],
  restrictedOperations: [
    {
      operation: '三维实体布尔特征重编辑',
      reason: '旧隔套项目仅含一维尺寸链定义，缺少精确三维实体特征树。',
      workaround: '可正常查看原有成果与复跑一维尺寸链，新建三维特征需另建板类件草稿。',
    },
  ],
  legacyChainCompatibility: {
    compatible: true,
    summary: '一维最坏情况区间与既有边界语义完全兼容，历史、来源与独立草稿均已保留。',
    samples: [
      { label: '样例 1', lengthMm: '12.00 mm', verdict: 'pass' },
      { label: '样例 2', lengthMm: '12.04 mm', verdict: 'pass' },
      { label: '样例 3', lengthMm: '12.10 mm', verdict: 'fail' },
      { label: '样例 4', lengthMm: '12.05 mm', verdict: 'boundary_pass' },
    ],
  },
}

describe('ProjectAgentM1Workbench (M3-FE-01 完成视图、一次性确认提交、外部通知与历史/迁移恢复)', () => {
  it('顶部栏显示「保存此版本 / 完成视图」入口，完成视图展示零件名、修订、全部 6 类检查计数及失败/未检查条款来源定位', async () => {
    const user = userEvent.setup()
    const locateM2Evidence = vi.fn(async () => ({
      ok: true as const,
      value: {
        requirementId: 'req-right-margin',
        checkId: 'chk-margin-fail',
        anchors: [
          {
            documentRef: 'doc-plate-taskbook',
            documentName: '安装板任务书.pdf',
            page: 2,
            region: { x: 110, y: 240, width: 420, height: 64, unit: 'pdfPoint1000' as const },
            excerpt: '右孔至右端面的剩余材料在全部允许变化下至少为 13 mm。',
          },
        ],
        featureIds: ['obj-right-hole', 'obj-right-face'],
        annotationIds: ['ann-right-margin'],
      },
    }))

    const mixedChecks: readonly M2CheckItem[] = [
      {
        checkId: 'chk-margin-fail',
        requirementId: 'req-right-margin',
        title: '右孔至右端面剩余材料 ≥ 13 mm',
        required: true,
        status: 'fail',
        summary: 'X=62 时最差 12.75 mm，低于要求 0.25 mm',
        linkedFeatureIds: ['obj-right-hole', 'obj-right-face'],
        linkedAnnotationIds: ['ann-right-margin'],
      },
      {
        checkId: 'chk-gap-pass',
        requirementId: 'req-cover-gap',
        title: '参考盖板间隙',
        required: true,
        status: 'pass',
        summary: '通过',
        linkedFeatureIds: ['obj-cover-gap'],
        linkedAnnotationIds: ['ann-cover-gap'],
      },
      {
        checkId: 'chk-datum-clarify',
        requirementId: 'req-datum-conflict',
        title: '孔中心基准冲突',
        required: true,
        status: 'needsClarification',
        summary: '待澄清',
        linkedFeatureIds: ['obj-left-hole'],
        linkedAnnotationIds: ['ann-hole-pitch'],
      },
      {
        checkId: 'chk-gdt-uncovered',
        requirementId: 'req-gdt',
        title: '未支持形位公差',
        required: false,
        status: 'uncovered',
        summary: '未覆盖',
        linkedFeatureIds: [],
        linkedAnnotationIds: [],
      },
      {
        checkId: 'chk-solver-err',
        requirementId: 'req-solver',
        title: '干涉求解器异常',
        required: false,
        status: 'executionFailed',
        summary: '执行失败',
        linkedFeatureIds: [],
        linkedAnnotationIds: [],
      },
      {
        checkId: 'chk-async-run',
        requirementId: 'req-async',
        title: '异步校验',
        required: false,
        status: 'checking',
        summary: '检查中',
        linkedFeatureIds: [],
        linkedAnnotationIds: [],
      },
    ]

    const bridge: M2WorkbenchBridge = { locateM2Evidence }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={false}
        initialBaseRevision="v1"
        initialDraftRevision="draft-4"
        initialPreviewSnapshot={{
          currentRevision: 'draft-4',
          checks: mixedChecks,
          checksInProgress: true,
        }}
      />,
    )

    // 顶部栏入口存在并打开完成视图
    const topBar = screen.getByRole('banner', { name: '顶部连接状态栏' })
    await user.click(within(topBar).getByTestId('complete-and-save-btn'))

    const view = screen.getByTestId('completion-view')
    expect(within(view).getByTestId('completion-part-name')).toHaveTextContent('零件：安装板')
    expect(within(view).getByText(/基线正式版 v1 · 当前草稿 draft-4/)).toBeInTheDocument()

    // 6 类检查计数完整展示
    const countsCard = within(view).getByLabelText('完成视图检查计数')
    expect(within(countsCard).getByText('✓ 通过 1')).toBeInTheDocument()
    expect(within(countsCard).getByText('✕ 失败 1')).toBeInTheDocument()
    expect(within(countsCard).getByText('? 待澄清 1')).toBeInTheDocument()
    expect(within(countsCard).getByText('○ 未覆盖 1')).toBeInTheDocument()
    expect(within(countsCard).getByText('! 执行失败 1')).toBeInTheDocument()
    expect(within(countsCard).getByText('◌ 检查中 1')).toBeInTheDocument()

    // A04: 必需项未通过阻塞正式提交并标出阻塞条款与关联特征
    expect(within(view).getByRole('button', { name: '保存正式版本' })).toBeDisabled()
    const blockAlert = within(view).getByRole('alert', { name: '正式提交阻塞提示' })
    expect(within(blockAlert).getByText(/已阻止正式保存/)).toBeInTheDocument()
    expect(within(blockAlert).getByText('安装板 › 右孔 › 圆柱面')).toBeInTheDocument()
    expect(within(blockAlert).getByText('安装板 › 右端面')).toBeInTheDocument()

    // 点击失败条款的来源定位入口 -> 调用 locateEvidence 并高亮对应特征/原文
    const failedList = within(view).getByLabelText('失败或未检查条款列表')
    const locateButtons = within(failedList).getAllByRole('button', { name: '来源定位' })
    await user.click(locateButtons[0])

    expect(locateM2Evidence).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj-plate-01',
        target: expect.objectContaining({ checkId: 'chk-margin-fail' }),
      }),
    )
    expect(await screen.findByText(/安装板任务书\.pdf · 第 2 页/)).toBeInTheDocument()
  })

  it('内置对话输入“完成”仅触发复核并打开完成视图，严禁绕过人工确认直接提交正式版本', async () => {
    const user = userEvent.setup()
    const commitM3ApprovedDraft = vi.fn(async () => ({
      ok: true as const,
      value: {
        projectId: 'proj-plate-01',
        committedRevision: 'v2',
        previousBaseRevision: 'v1',
        committedDraftRevision: 'draft-3',
        checkSetFingerprint: 'csfp-test',
      },
    }))
    const sendM1ChatMessage = vi.fn(async () => ({
      ok: true as const,
      value: { messageId: 'm-1', reply: 'ok' },
    }))
    const bridge: M1WorkbenchBridge & M3WorkbenchBridge = {
      testM1ModelApiConnection: async () => ({
        ok: true,
        value: {
          availableModels: ['gpt-4.1'],
          selectedModel: 'gpt-4.1',
          toolCallSupported: true,
          toolRoundTripPassed: true,
          toolRoundTripName: 'describe_project',
        },
      }),
      sendM1ChatMessage,
      commitM3ApprovedDraft,
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={true}
        initialBaseRevision="v1"
        initialDraftRevision="draft-3"
        initialPreviewSnapshot={{
          currentRevision: 'draft-3',
          model: {
            status: 'ready',
            revision: 'draft-3',
            revisionOrder: 3,
            isDraft: true,
            fingerprint: 'fp-draft-3',
          },
          drawing: {
            status: 'ready',
            revision: 'draft-3',
            revisionOrder: 3,
            isDraft: true,
            fingerprint: 'fp-draft-3',
          },
          checks: ALL_PASS_CHECKS,
          requirements: ALL_CONFIRMED_REQUIREMENTS,
          checksInProgress: false,
        }}
      />,
    )

    // 先解锁内置模型 API 对话
    await user.click(screen.getByRole('button', { name: /使用模型 API/ }))
    await user.type(screen.getByLabelText('密钥'), 'sk-test-key')
    await user.click(screen.getByRole('button', { name: '测试连接' }))
    await user.click(await screen.findByRole('button', { name: '开始建模' }))

    // 在内置对话中输入“完成”
    await user.type(screen.getByLabelText('内置对话输入框'), '完成')
    await user.click(screen.getByRole('button', { name: '发送' }))

    // 完成视图已打开，且未绕过人工确认调用 commitM3ApprovedDraft
    expect(screen.getByTestId('completion-view')).toBeInTheDocument()
    expect(commitM3ApprovedDraft).not.toHaveBeenCalled()
    expect(sendM1ChatMessage).not.toHaveBeenCalled()
    expect(
      screen.getByText(/普通对话中的完成意图不会绕过人工确认直接提交正式版本/),
    ).toBeInTheDocument()
  })

  it('A11：图纸与检查仍在生成中时触发“完成”展示实时进度，待同修订就绪后自动呈现可确认提交状态', async () => {
    const user = userEvent.setup()
    let pushM2Event: ((event: M2PreviewEvent) => void) | null = null
    const bridge: M2WorkbenchBridge = {
      subscribeM2PreviewEvents: async (_req, listener) => {
        pushM2Event = listener
        return { ok: true, value: { subscriptionId: 'sub-a11' } }
      },
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={false}
        initialBaseRevision="v1"
        initialDraftRevision="draft-3"
        initialPreviewSnapshot={{
          currentRevision: 'draft-3',
          model: {
            status: 'ready',
            revision: 'draft-3',
            revisionOrder: 3,
            isDraft: true,
            fingerprint: 'fp-draft-3',
          },
          drawing: {
            status: 'building',
            revision: 'draft-3',
            revisionOrder: 3,
            isDraft: true,
            fingerprint: null,
          },
          checks: [
            {
              ...ALL_PASS_CHECKS[0],
              status: 'checking',
            },
          ],
          requirements: ALL_CONFIRMED_REQUIREMENTS,
          checksInProgress: true,
        }}
      />,
    )

    // 点击顶部栏打开完成视图 -> 此时图纸和检查仍在生成中
    await user.click(screen.getByTestId('complete-and-save-btn'))
    const view = screen.getByTestId('completion-view')
    expect(within(view).getByRole('status', { name: '完成视图生成实时进度' })).toBeInTheDocument()
    expect(within(view).getByRole('button', { name: '保存正式版本' })).toBeDisabled()

    // 推送同修订图纸就绪 + 检查通过事件 -> 自动呈现完整复核并启用「保存正式版本」
    await act(async () => {
      pushM2Event?.({
        projectId: 'proj-plate-01',
        sequence: 1,
        revision: 'draft-3',
        revisionOrder: 3,
        isDraft: true,
        fingerprint: 'fp-draft-3',
        type: 'drawing_ready',
        summary: '草稿 3 二维图纸已就绪',
      })
      pushM2Event?.({
        projectId: 'proj-plate-01',
        sequence: 2,
        revision: 'draft-3',
        revisionOrder: 3,
        isDraft: true,
        type: 'checks_updated',
        checks: ALL_PASS_CHECKS,
        checksInProgress: false,
      })
    })

    expect(
      within(view).queryByRole('status', { name: '完成视图生成实时进度' }),
    ).not.toBeInTheDocument()
    expect(within(view).getByText('✓ 同修订对齐')).toBeInTheDocument()
    expect(within(view).getByRole('button', { name: '保存正式版本' })).toBeEnabled()
  })

  it('绑定 baseRevision、draftRevision、checkSetFingerprint 的一次性人工确认在指纹变化时自动失效，重新确认后调用 commitM3ApprovedDraft', async () => {
    const user = userEvent.setup()
    let pushM2Event: ((event: M2PreviewEvent) => void) | null = null
    const commitM3ApprovedDraft = vi.fn(async (req) => ({
      ok: true as const,
      value: {
        projectId: req.projectId,
        committedRevision: 'v2',
        previousBaseRevision: req.baseRevision,
        committedDraftRevision: req.draftRevision,
        checkSetFingerprint: req.checkSetFingerprint,
        nextDraftRevision: null,
        committedAtLabel: '2026-11-24 18:55',
      },
    }))

    const bridge: M2WorkbenchBridge & M3WorkbenchBridge = {
      subscribeM2PreviewEvents: async (_req, listener) => {
        pushM2Event = listener
        return { ok: true, value: { subscriptionId: 'sub-confirm' } }
      },
      commitM3ApprovedDraft,
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={false}
        initialShowCompletionView={true}
        initialBaseRevision="v1"
        initialDraftRevision="draft-3"
        initialPreviewSnapshot={{
          currentRevision: 'draft-3',
          model: {
            status: 'ready',
            revision: 'draft-3',
            revisionOrder: 3,
            isDraft: true,
            fingerprint: 'fp-draft-3',
          },
          drawing: {
            status: 'ready',
            revision: 'draft-3',
            revisionOrder: 3,
            isDraft: true,
            fingerprint: 'fp-draft-3',
          },
          checks: ALL_PASS_CHECKS,
          requirements: ALL_CONFIRMED_REQUIREMENTS,
          checksInProgress: false,
        }}
      />,
    )

    const view = screen.getByTestId('completion-view')
    const initialFp = within(view).getByTestId('completion-check-fingerprint').textContent ?? ''

    // 1. 生成绑定一次性确认步骤
    await user.click(within(view).getByRole('button', { name: '保存正式版本' }))
    expect(
      within(view).getByRole('region', { name: '一次性人工确认提交步骤' }),
    ).toBeInTheDocument()
    expect(commitM3ApprovedDraft).not.toHaveBeenCalled()

    // 2. 确认前草稿修订升级到 draft-4（模型与图纸同修订更新）-> 旧确认自动失效
    await act(async () => {
      pushM2Event?.({
        projectId: 'proj-plate-01',
        sequence: 1,
        revision: 'draft-4',
        revisionOrder: 4,
        isDraft: true,
        fingerprint: 'fp-draft-4',
        type: 'model_ready',
      })
      pushM2Event?.({
        projectId: 'proj-plate-01',
        sequence: 2,
        revision: 'draft-4',
        revisionOrder: 4,
        isDraft: true,
        fingerprint: 'fp-draft-4',
        type: 'drawing_ready',
        checks: ALL_PASS_CHECKS.map((c) => ({ ...c, revisionFingerprint: 'fp-draft-4' })),
        checksInProgress: false,
      })
    })

    expect(
      within(view).queryByRole('region', { name: '一次性人工确认提交步骤' }),
    ).not.toBeInTheDocument()
    expect(within(view).getByRole('alert', { name: '旧确认失效提示' })).toHaveTextContent(
      /原一次性人工确认已自动失效/,
    )
    const updatedFp = within(view).getByTestId('completion-check-fingerprint').textContent ?? ''
    expect(updatedFp).not.toBe(initialFp)

    // 3. 重新触发确认并明确点击「确认提交正式版本」
    await user.click(within(view).getByRole('button', { name: '保存正式版本' }))
    await user.click(within(view).getByRole('button', { name: '确认提交正式版本' }))

    expect(commitM3ApprovedDraft).toHaveBeenCalledTimes(1)
    expect(commitM3ApprovedDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj-plate-01',
        baseRevision: 'v1',
        draftRevision: 'draft-4',
        checkSetFingerprint: expect.stringMatching(/^csfp-/),
        confirmationToken: expect.stringMatching(/^cfm-/),
      }),
    )
    expect(await within(view).findByText(/已正式保存版本 版本 2（v2）/)).toBeInTheDocument()
  })

  it('非当前前台项目外部修改弹出无打断通知、不破坏前台画布与对话，点击「打开查看」切换并恢复目标项目最新产物', async () => {
    const user = userEvent.setup()
    let pushExternalEvent: ((event: M3ExternalProjectEvent) => void) | null = null
    const openExternalProjectResult = vi.fn(async (req) => ({
      ok: true as const,
      value: {
        projectId: req.projectId,
        projectName: '外壳盖板项目',
        baseRevision: 'v2',
        draftRevision: 'draft-9',
        previewSnapshot: {
          currentRevision: 'draft-9',
          model: {
            status: 'ready' as const,
            revision: 'draft-9',
            revisionOrder: 9,
            isDraft: true,
            fingerprint: 'fp-cover-9',
          },
          drawing: {
            status: 'ready' as const,
            revision: 'draft-9',
            revisionOrder: 9,
            isDraft: true,
            fingerprint: 'fp-cover-9',
          },
          checks: ALL_PASS_CHECKS,
        },
        summary: '已恢复外壳盖板项目最新草稿 9 产物。',
      },
    }))

    const bridge: M3WorkbenchBridge = {
      subscribeM3ExternalProjectEvents: async (listener) => {
        pushExternalEvent = listener
        return { ok: true, value: { subscriptionId: 'sub-ext-1' } }
      },
      openExternalProjectResult,
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={false}
        initialProjectId="proj-plate-01"
        initialProjectName="安装板项目"
        initialBaseRevision="v1"
        initialDraftRevision="draft-2"
        initialMessages={[{ id: 'm-keep', role: 'user', content: '保持当前前台对话不被打断' }]}
      />,
    )

    // 推送当前打开项目的外部修改事件 -> 自动刷新当前预览，且受旧修订迟到守卫保护
    await act(async () => {
      pushExternalEvent?.({
        eventId: 'ext-ev-cur-1',
        projectId: 'proj-plate-01',
        projectName: '安装板项目',
        sequence: 5,
        draftRevision: 'draft-6',
        revisionOrder: 6,
        fingerprint: 'fp-plate-6',
        summary: '外部 Agent 更新当前项目至草稿 6',
      })
      // 迟到的旧修订 draft-3 不应覆盖 draft-6
      pushExternalEvent?.({
        eventId: 'ext-ev-cur-stale',
        projectId: 'proj-plate-01',
        projectName: '安装板项目',
        sequence: 6,
        draftRevision: 'draft-3',
        revisionOrder: 3,
        fingerprint: 'fp-plate-3',
        summary: '迟到的旧修订事件',
      })
    })
    const topBarBefore = screen.getByRole('banner', { name: '顶部连接状态栏' })
    expect(within(topBarBefore).getByText(/草稿 draft-6/)).toBeInTheDocument()

    // 推送非当前前台项目的外部 Agent 修改事件
    await act(async () => {
      pushExternalEvent?.({
        eventId: 'ext-ev-1',
        projectId: 'proj-cover-02',
        projectName: '外壳盖板项目',
        sequence: 10,
        draftRevision: 'draft-9',
        summary: '外部 Agent 已完成盖板厚度与图纸投影更新',
      })
    })

    // 前台项目与画布保持安装板项目不被打断
    const topBar = screen.getByRole('banner', { name: '顶部连接状态栏' })
    expect(within(topBar).getByText('安装板项目')).toBeInTheDocument()

    // 非侵入式通知显示目标项目名、草稿修订与「打开查看」按钮
    const notice = screen.getByRole('status', { name: '外部项目修改结果通知' })
    expect(within(notice).getByText('外壳盖板项目')).toBeInTheDocument()
    expect(within(notice).getByText(/草稿 9/)).toBeInTheDocument()

    // 点击「打开查看」 -> 调用窄接口并切换到目标项目恢复最新产物
    await user.click(within(notice).getByRole('button', { name: '打开查看' }))
    expect(openExternalProjectResult).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj-cover-02',
        draftRevision: 'draft-9',
      }),
    )
    expect(await within(topBar).findByText('外壳盖板项目')).toBeInTheDocument()
    expect(screen.getByText(/已恢复外壳盖板项目最新草稿 9 产物/)).toBeInTheDocument()
  })

  it('历史面板展示正式版本、独立未提交草稿、重开恢复状态，并支持撤销被阻塞草稿修改恢复上一通过草稿', async () => {
    const user = userEvent.setup()
    const undoDraftChange = vi.fn(async () => ({
      ok: true as const,
      value: {
        projectId: 'proj-plate-01',
        previousDraftRevision: 'draft-5',
        restoredDraftRevision: 'draft-4',
        summary: '已撤销右孔移至 X=62 的被阻塞修改，恢复至通过草稿 4（X=61）。',
        previewSnapshot: {
          currentRevision: 'draft-4',
          model: {
            status: 'ready' as const,
            revision: 'draft-4',
            revisionOrder: 4,
            isDraft: true,
            fingerprint: 'fp-draft-4',
          },
          drawing: {
            status: 'ready' as const,
            revision: 'draft-4',
            revisionOrder: 4,
            isDraft: true,
            fingerprint: 'fp-draft-4',
          },
          checks: ALL_PASS_CHECKS,
          checksInProgress: false,
        },
      },
    }))

    const bridge: M3WorkbenchBridge = { undoDraftChange }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={false}
        initialSidebarSection="history"
        initialBaseRevision="v1"
        initialDraftRevision="draft-5"
        initialFormalVersions={[
          {
            revision: 'v1',
            committedAtLabel: '2026-11-23 15:00',
            summary: '初始安装板正式版',
            checkSummary: '全部通过',
            isCurrent: true,
          },
        ]}
        initialUncommittedDrafts={[
          {
            draftRevision: 'draft-5',
            baseRevision: 'v1',
            updatedAtLabel: '2026-11-24 18:20',
            status: 'blocked',
            summary: '右孔移至 X=62，边距检查失败（最差 12.75 mm）',
            canUndo: true,
          },
        ]}
        initialRestoreStatus={{
          restoredFromDisk: true,
          baseRevision: 'v1',
          draftRevision: 'draft-5',
          restoredSourceCount: 3,
          viewsConsistentWithSnapshot: true,
          summary: '次日重开已完整恢复正式版、独立草稿及 3 条任务书来源证据。',
        }}
      />,
    )

    const historyPanel = screen.getByRole('region', { name: '修订与事件历史面板' })
    expect(within(historyPanel).getByText('✓ 视图与提交快照一致')).toBeInTheDocument()
    expect(within(historyPanel).getByText(/已恢复来源证据：3 条/)).toBeInTheDocument()
    expect(within(historyPanel).getByText(/初始安装板正式版/)).toBeInTheDocument()
    expect(within(historyPanel).getByText('✕ 已阻塞')).toBeInTheDocument()

    // 撤销最近一次被阻塞的草稿修改
    await user.click(within(historyPanel).getByRole('button', { name: '撤销被阻塞修改' }))
    expect(undoDraftChange).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj-plate-01',
        draftRevision: 'draft-5',
      }),
    )
    const undoStatus = await within(historyPanel).findByRole('status')
    expect(undoStatus).toHaveTextContent(/恢复至 草稿 4/)
    expect(within(historyPanel).getByText('✓ 可提交')).toBeInTheDocument()
  })

  it('A10：旧 .cunlian 隔套项目迁移差异横幅/抽屉完整列出未解释旧字段、受限操作与既有尺寸链兼容结论', async () => {
    const user = userEvent.setup()
    const getMigrationReport = vi.fn(async () => ({
      ok: true as const,
      value: SAMPLE_MIGRATION_REPORT,
    }))

    const bridge: M3WorkbenchBridge = { getMigrationReport }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={false}
        initialSidebarSection="history"
        initialProjectId="sample-spacer-01"
        initialProjectName="隔套兼容示例"
        initialBaseRevision="v3"
        initialDraftRevision={null}
      />,
    )

    // 从顶栏「更多 ⋯」菜单触发加载旧项目迁移报告
    await user.click(screen.getByTestId('more-menu-btn'))
    await user.click(screen.getByRole('menuitem', { name: '查看旧项目迁移差异报告' }))
    expect(getMigrationReport).toHaveBeenCalledWith({ projectId: 'sample-spacer-01' })

    const banner = await screen.findByTestId('migration-banner')
    expect(within(banner).getByText(/\.cunlian v1 隔套项目/)).toBeInTheDocument()
    expect(within(banner).getByText('✓ 原件已保留')).toBeInTheDocument()
    expect(within(banner).getByText('✓ 既有尺寸链兼容')).toBeInTheDocument()

    // 抽屉已展开并列出保留在原件中的未解释旧字段、受限操作及 12.00/12.04/12.10/12.05 回归样例
    const drawer = within(banner).getByLabelText('旧项目迁移差异抽屉')
    expect(within(drawer).getByText('legacyMeta.shopFloorNote')).toBeInTheDocument()
    expect(within(drawer).getByText('三维实体布尔特征重编辑')).toBeInTheDocument()
    expect(within(drawer).getByText('长度 12.00 mm')).toBeInTheDocument()
    expect(within(drawer).getByText('长度 12.04 mm')).toBeInTheDocument()
    expect(within(drawer).getByText('长度 12.10 mm')).toBeInTheDocument()
    expect(within(drawer).getByText('长度 12.05 mm')).toBeInTheDocument()
    expect(within(drawer).getByText('✓ 边界通过')).toBeInTheDocument()
  })

  it('窄接口缺失时诚实提示“后端尚未接线/不可用”，且新工作台主流程零手动参数表/零尺寸滑块/零坐标编辑器', async () => {
    const user = userEvent.setup()

    render(
      <ProjectAgentM1Workbench
        bridge={{}}
        initialShowOnboarding={false}
        initialShowCompletionView={true}
        initialSidebarSection="history"
        initialBaseRevision="v1"
        initialDraftRevision="draft-3"
        initialPreviewSnapshot={{
          currentRevision: 'draft-3',
          model: {
            status: 'ready',
            revision: 'draft-3',
            revisionOrder: 3,
            isDraft: true,
            fingerprint: 'fp-draft-3',
          },
          drawing: {
            status: 'ready',
            revision: 'draft-3',
            revisionOrder: 3,
            isDraft: true,
            fingerprint: 'fp-draft-3',
          },
          checks: ALL_PASS_CHECKS,
          requirements: ALL_CONFIRMED_REQUIREMENTS,
          checksInProgress: false,
        }}
        initialUncommittedDrafts={[
          {
            draftRevision: 'draft-3',
            baseRevision: 'v1',
            updatedAtLabel: '刚刚',
            status: 'blocked',
            summary: '测试撤销降级',
            canUndo: true,
          },
        ]}
      />,
    )

    // 零手动参数表、零尺寸滑块、零坐标编辑器断言
    expect(document.querySelector('input[type="range"]')).toBeNull()
    expect(document.querySelector('input[type="number"]')).toBeNull()
    expect(screen.queryByRole('table', { name: /参数/ })).toBeNull()
    expect(screen.queryByLabelText(/坐标编辑/)).toBeNull()

    // commitM3ApprovedDraft 缺失 -> 诚实提示
    const view = screen.getByTestId('completion-view')
    await user.click(within(view).getByRole('button', { name: '保存正式版本' }))
    await user.click(within(view).getByRole('button', { name: '确认提交正式版本' }))
    expect(
      within(view).getByText(/后端尚未接线\/不可用（缺失方法：commitM3ApprovedDraft）/),
    ).toBeInTheDocument()

    // undoDraftChange 缺失 -> 诚实提示
    await user.click(screen.getByRole('button', { name: '撤销被阻塞修改' }))
    expect(
      screen.getByText(/后端尚未接线\/不可用（缺失方法：undoDraftChange）/),
    ).toBeInTheDocument()

    // getMigrationReport 缺失 -> 从「更多 ⋯」菜单触发并诚实提示
    await user.click(screen.getByTestId('more-menu-btn'))
    await user.click(screen.getByRole('menuitem', { name: '查看旧项目迁移差异报告' }))
    expect(
      screen.getByText(/后端尚未接线\/不可用（缺失方法：getMigrationReport）/),
    ).toBeInTheDocument()
  })

  it('F09：确认失效后立即彻底清除不得复活，且跨项目切换后旧项目迟到提交返回不得污染新项目', async () => {
    const user = userEvent.setup()
    let pushM2Event: ((event: M2PreviewEvent) => void) | null = null
    let pushExternalEvent: ((event: M3ExternalProjectEvent) => void) | null = null
    const commitDeferred = createDeferred<M1WorkbenchBridgeResult<M3CommitApprovedDraftResult>>()

    const bridge: M2WorkbenchBridge & M3WorkbenchBridge = {
      subscribeM2PreviewEvents: async (_req, listener) => {
        pushM2Event = listener
        return { ok: true, value: { subscriptionId: 'sub-f09-m2' } }
      },
      subscribeM3ExternalProjectEvents: async (listener) => {
        pushExternalEvent = listener
        return { ok: true, value: { subscriptionId: 'sub-f09-m3' } }
      },
      commitM3ApprovedDraft: () => commitDeferred.promise,
      openExternalProjectResult: async () => ({
        ok: true,
        value: {
          projectId: 'proj-b',
          projectName: '项目 B',
          baseRevision: 'v10',
          draftRevision: 'draft-11',
        },
      }),
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={false}
        initialShowCompletionView={true}
        initialProjectId="proj-a"
        initialProjectName="项目 A"
        initialBaseRevision="v1"
        initialDraftRevision="draft-3"
        initialPreviewSnapshot={{
          currentRevision: 'draft-3',
          model: {
            status: 'ready',
            revision: 'draft-3',
            revisionOrder: 3,
            isDraft: true,
            fingerprint: 'fp-draft-3',
          },
          drawing: {
            status: 'ready',
            revision: 'draft-3',
            revisionOrder: 3,
            isDraft: true,
            fingerprint: 'fp-draft-3',
          },
          checks: ALL_PASS_CHECKS,
          requirements: ALL_CONFIRMED_REQUIREMENTS,
          checksInProgress: false,
        }}
      />,
    )

    const view = screen.getByTestId('completion-view')
    // 1. 生成确认
    await user.click(within(view).getByRole('button', { name: '保存正式版本' }))
    expect(within(view).getByRole('region', { name: '一次性人工确认提交步骤' })).toBeInTheDocument()

    // 2. 检查 summary 变化 -> 指纹改变 -> 立即清除确认；再改回原 summary -> 严禁复活旧确认！
    await act(async () => {
      pushM2Event?.({
        projectId: 'proj-a',
        sequence: 1,
        revision: 'draft-3',
        fingerprint: 'fp-draft-3',
        type: 'checks_updated',
        checks: [{ ...ALL_PASS_CHECKS[0], summary: '变更后的摘要 13.1 mm' }, ALL_PASS_CHECKS[1]],
        checksInProgress: false,
      })
    })
    expect(
      within(view).queryByRole('region', { name: '一次性人工确认提交步骤' }),
    ).not.toBeInTheDocument()

    await act(async () => {
      pushM2Event?.({
        projectId: 'proj-a',
        sequence: 2,
        revision: 'draft-3',
        fingerprint: 'fp-draft-3',
        type: 'checks_updated',
        checks: ALL_PASS_CHECKS,
        checksInProgress: false,
      })
    })
    // 回到旧元组值后，旧确认绝不复活
    expect(
      within(view).queryByRole('region', { name: '一次性人工确认提交步骤' }),
    ).not.toBeInTheDocument()

    // 3. 重新确认并在项目 A 发起提交（挂起未返回），期间切到项目 B，再让项目 A 提交返回 -> 严禁污染项目 B
    await user.click(within(view).getByRole('button', { name: '保存正式版本' }))
    await user.click(within(view).getByRole('button', { name: '确认提交正式版本' }))

    await act(async () => {
      pushExternalEvent?.({
        eventId: 'ext-b-1',
        projectId: 'proj-b',
        projectName: '项目 B',
        sequence: 1,
        draftRevision: 'draft-11',
        summary: '项目 B 就绪',
      })
    })
    await user.click(screen.getByRole('button', { name: '打开查看' }))
    const topBar = screen.getByRole('banner', { name: '顶部连接状态栏' })
    expect(await within(topBar).findByText('项目 B')).toBeInTheDocument()
    expect(within(topBar).getByText(/草稿 draft-11/)).toBeInTheDocument()

    // 项目 A 的迟到提交返回 -> 必须被丢弃，项目 B 正式版仍为 v10
    await act(async () => {
      commitDeferred.resolve({
        ok: true,
        value: {
          projectId: 'proj-a',
          committedRevision: 'v2-from-A',
          previousBaseRevision: 'v1',
          committedDraftRevision: 'draft-3',
          checkSetFingerprint: 'csfp-a',
          nextDraftRevision: null,
        },
      })
    })
    expect(within(topBar).getByText(/草稿 draft-11/)).toBeInTheDocument()
    expect(screen.queryByText(/v2-from-A/)).not.toBeInTheDocument()
  })

  it('F12：切换外部项目丢弃逆序旧切换响应，且彻底重置上一项目消息/授权/活动/迁移报告/完成视图/选中与确认状态', async () => {
    const user = userEvent.setup()
    let pushExternalEvent: ((event: M3ExternalProjectEvent) => void) | null = null
    const openBDeferred = createDeferred<M1WorkbenchBridgeResult<M3OpenExternalProjectResult>>()
    const openCDeferred = createDeferred<M1WorkbenchBridgeResult<M3OpenExternalProjectResult>>()

    const bridge: M3WorkbenchBridge = {
      subscribeM3ExternalProjectEvents: async (listener) => {
        pushExternalEvent = listener
        return { ok: true, value: { subscriptionId: 'sub-f12' } }
      },
      openExternalProjectResult: async (req) => {
        if (req.projectId === 'proj-b') return openBDeferred.promise
        return openCDeferred.promise
      },
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={false}
        initialShowCompletionView={true}
        initialProjectId="proj-a"
        initialProjectName="项目 A"
        initialBaseRevision="v1"
        initialDraftRevision="draft-2"
        initialConnectionSnapshot={{
          connectionState: 'connected',
          source: 'local-agent',
          authorizationState: 'authorized-writable',
          projectId: 'proj-a',
          projectName: '项目 A',
          baseRevision: 'v1',
          draftRevision: 'draft-2',
        }}
        initialMessages={[{ id: 'msg-a', role: 'user', content: '项目 A 专属消息' }]}
        initialActivities={[
          {
            taskId: 'act-a',
            projectId: 'proj-a',
            status: 'running',
            title: '项目 A 专属活动',
          },
        ]}
        initialMigrationReport={SAMPLE_MIGRATION_REPORT}
      />,
    )

    // 确认项目 A 状态存在
    expect(screen.getByTestId('migration-banner')).toBeInTheDocument()
    expect(screen.getByTestId('completion-view')).toBeInTheDocument()
    expect(screen.getByText('项目 A 专属活动')).toBeInTheDocument()

    // 推送两个非当前项目通知 B 和 C
    await act(async () => {
      pushExternalEvent?.({
        eventId: 'ev-b',
        projectId: 'proj-b',
        projectName: '项目 B',
        sequence: 1,
        draftRevision: 'draft-b1',
        summary: 'B 更新',
      })
      pushExternalEvent?.({
        eventId: 'ev-c',
        projectId: 'proj-c',
        projectName: '项目 C',
        sequence: 2,
        draftRevision: 'draft-c1',
        summary: 'C 更新',
      })
    })

    // 先点打开 B，再点打开 C（C 先返回，B 迟到返回）
    const openButtons = screen.getAllByRole('button', { name: '打开查看' })
    await user.click(openButtons[1]) // B
    await user.click(openButtons[0]) // C

    // C 返回（省略 migrationReport / formalVersions 等可选字段）
    await act(async () => {
      openCDeferred.resolve({
        ok: true,
        value: {
          projectId: 'proj-c',
          projectName: '项目 C',
          baseRevision: 'v5',
          draftRevision: 'draft-c1',
        },
      })
    })

    const topBar = screen.getByRole('banner', { name: '顶部连接状态栏' })
    expect(within(topBar).getByText('项目 C')).toBeInTheDocument()
    await user.click(screen.getByTestId('connection-capsule-btn'))
    expect(screen.getByLabelText('顶部项目授权状态')).toHaveTextContent('未授权')
    // 上一项目 A 的迁移报告、完成视图、活动流均已彻底清空
    expect(screen.queryByTestId('migration-banner')).not.toBeInTheDocument()
    expect(screen.queryByTestId('completion-view')).not.toBeInTheDocument()
    expect(screen.queryByText('项目 A 专属活动')).not.toBeInTheDocument()

    // B 逆序迟到返回 -> 必须被丢弃，当前项目仍为 C
    await act(async () => {
      openBDeferred.resolve({
        ok: true,
        value: {
          projectId: 'proj-b',
          projectName: '项目 B',
          baseRevision: 'v3',
          draftRevision: 'draft-b1',
        },
      })
    })
    expect(within(topBar).getByText('项目 C')).toBeInTheDocument()
    expect(within(topBar).queryByText('项目 B')).not.toBeInTheDocument()
  })

  it('E3（UI）：存在待澄清或缺少检查的必需要求时，完成视图明确列出阻塞必需要求并阻断正式保存', () => {
    render(
      <ProjectAgentM1Workbench
        bridge={{}}
        initialShowOnboarding={false}
        initialShowCompletionView={true}
        initialBaseRevision="v1"
        initialDraftRevision="draft-3"
        initialPreviewSnapshot={{
          currentRevision: 'draft-3',
          model: {
            status: 'ready',
            revision: 'draft-3',
            revisionOrder: 3,
            isDraft: true,
            fingerprint: 'fp-draft-3',
          },
          drawing: {
            status: 'ready',
            revision: 'draft-3',
            revisionOrder: 3,
            isDraft: true,
            fingerprint: 'fp-draft-3',
          },
          requirements: DEFAULT_M2_REQUIREMENTS, // 含待澄清必需要求 req-datum-conflict
          checks: ALL_PASS_CHECKS,
          checksInProgress: false,
        }}
      />,
    )

    const view = screen.getByTestId('completion-view')
    expect(within(view).getByRole('button', { name: '保存正式版本' })).toBeDisabled()
    const reqAlert = within(view).getByRole('alert', { name: '正式提交阻塞要求提示' })
    expect(within(reqAlert).getByText('孔中心基准与厚度说明复核')).toBeInTheDocument()
  })

  it('E6（UI）：关闭外部项目通知后，再次收到旧通知严禁复活', async () => {
    const user = userEvent.setup()
    let pushExternalEvent: ((event: M3ExternalProjectEvent) => void) | null = null
    const bridge: M3WorkbenchBridge = {
      subscribeM3ExternalProjectEvents: async (listener) => {
        pushExternalEvent = listener
        return { ok: true, value: { subscriptionId: 'sub-e6-ui' } }
      },
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={false}
        initialProjectId="proj-a"
        initialProjectName="项目 A"
      />,
    )

    await act(async () => {
      pushExternalEvent?.({
        eventId: 'ev-b-9',
        projectId: 'proj-b',
        projectName: '项目 B',
        sequence: 10,
        draftRevision: 'draft-9',
        revisionOrder: 9,
        summary: '项目 B 草稿 9',
      })
    })
    const notice = screen.getByRole('status', { name: '外部项目修改结果通知' })
    expect(within(notice).getByText('项目 B')).toBeInTheDocument()

    // 关闭/清除通知（点击“稍后查看”）
    await user.click(within(notice).getByRole('button', { name: '稍后查看' }))
    expect(screen.queryByRole('status', { name: '外部项目修改结果通知' })).not.toBeInTheDocument()

    // 再次推送旧通知（draft-8 或 draft-9 低序号）-> 严禁复活
    await act(async () => {
      pushExternalEvent?.({
        eventId: 'ev-b-8-old',
        projectId: 'proj-b',
        projectName: '项目 B',
        sequence: 20,
        draftRevision: 'draft-8',
        revisionOrder: 8,
        summary: '旧通知草稿 8',
      })
    })
    expect(screen.queryByRole('status', { name: '外部项目修改结果通知' })).not.toBeInTheDocument()
  })

  it('S3：同项目草稿修订推进后旧提交返回释放 commitPending，且返回指纹/基线绑定不匹配时拒绝投影成功', async () => {
    const user = userEvent.setup()
    let pushM2Event: ((event: M2PreviewEvent) => void) | null = null
    const firstCommitDeferred = createDeferred<M1WorkbenchBridgeResult<M3CommitApprovedDraftResult>>()
    let commitCount = 0

    const bridge: M2WorkbenchBridge & M3WorkbenchBridge = {
      subscribeM2PreviewEvents: async (_req, listener) => {
        pushM2Event = listener
        return { ok: true, value: { subscriptionId: 'sub-s3' } }
      },
      commitM3ApprovedDraft: async (req) => {
        commitCount += 1
        if (commitCount === 1) {
          return firstCommitDeferred.promise
        }
        // 第 2 次提交返回不匹配的 checkSetFingerprint -> 必须拒绝投影
        return {
          ok: true,
          value: {
            projectId: req.projectId,
            committedRevision: 'v99-bad',
            previousBaseRevision: req.baseRevision,
            committedDraftRevision: req.draftRevision,
            checkSetFingerprint: 'csfp-mismatched',
            nextDraftRevision: null,
          },
        }
      },
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={false}
        initialShowCompletionView={true}
        initialBaseRevision="v1"
        initialDraftRevision="draft-3"
        initialPreviewSnapshot={{
          currentRevision: 'draft-3',
          model: {
            status: 'ready',
            revision: 'draft-3',
            revisionOrder: 3,
            isDraft: true,
            fingerprint: 'fp-draft-3',
          },
          drawing: {
            status: 'ready',
            revision: 'draft-3',
            revisionOrder: 3,
            isDraft: true,
            fingerprint: 'fp-draft-3',
          },
          requirements: ALL_CONFIRMED_REQUIREMENTS,
          checks: ALL_PASS_CHECKS,
          checksInProgress: false,
        }}
      />,
    )

    const view = screen.getByTestId('completion-view')
    // 1. 发起第 1 次提交（在途挂起）
    await user.click(within(view).getByRole('button', { name: '保存正式版本' }))
    await user.click(within(view).getByRole('button', { name: '确认提交正式版本' }))

    // 2. 等待期间同项目推进至 draft-4
    await act(async () => {
      pushM2Event?.({
        projectId: 'proj-plate-01',
        sequence: 1,
        revision: 'draft-4',
        revisionOrder: 4,
        fingerprint: 'fp-draft-4',
        type: 'model_ready',
      })
      pushM2Event?.({
        projectId: 'proj-plate-01',
        sequence: 2,
        revision: 'draft-4',
        revisionOrder: 4,
        fingerprint: 'fp-draft-4',
        type: 'drawing_ready',
        checks: ALL_PASS_CHECKS.map((c) => ({ ...c, revisionFingerprint: 'fp-draft-4' })),
        checksInProgress: false,
      })
    })

    // 旧提交返回被丢弃 -> 必须释放 commitPending，允许对 draft-4 重新发起确认与提交
    await act(async () => {
      firstCommitDeferred.resolve({
        ok: true,
        value: {
          projectId: 'proj-plate-01',
          committedRevision: 'v2-stale',
          previousBaseRevision: 'v1',
          committedDraftRevision: 'draft-3',
          checkSetFingerprint: 'csfp-stale',
        },
      })
    })
    expect(within(view).getByRole('button', { name: '保存正式版本' })).toBeEnabled()

    // 3. 对 draft-4 重新确认并提交，后端返回指纹不匹配 -> 拒绝投影成功并提示绑定校验失败
    await user.click(within(view).getByRole('button', { name: '保存正式版本' }))
    await user.click(within(view).getByRole('button', { name: '确认提交正式版本' }))

    expect(await within(view).findByText(/正式版本提交绑定校验失败/)).toBeInTheDocument()
    const topBar = screen.getByRole('banner', { name: '顶部连接状态栏' })
    expect(within(topBar).getByLabelText('修订版本状态')).toHaveAttribute('title', expect.stringContaining('正式版 v1'))
    expect(screen.queryByText(/v99-bad/)).not.toBeInTheDocument()
  })

  it('S4：切项目彻底清空任务书附件，且 getMigrationReport / undoDraftChange 跨项目迟到返回严格丢弃不串台', async () => {
    const user = userEvent.setup()
    const migrationDeferred = createDeferred<M1WorkbenchBridgeResult<M3MigrationReport | null>>()
    const undoDeferred = createDeferred<M1WorkbenchBridgeResult<M3UndoDraftChangeResult>>()

    const bridge: M3WorkbenchBridge = {
      getMigrationReport: () => migrationDeferred.promise,
      undoDraftChange: () => undoDeferred.promise,
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={false}
        initialSidebarSection="history"
        initialProjectId="proj-plate-01"
        initialProjectName="安装板项目"
        initialBaseRevision="v1"
        initialDraftRevision="draft-5"
        initialUncommittedDrafts={[
          {
            draftRevision: 'draft-5',
            baseRevision: 'v1',
            updatedAtLabel: '刚刚',
            status: 'blocked',
            summary: '被阻塞草稿',
            canUndo: true,
          },
        ]}
      />,
    )

    // 1. 同时发起项目 A 的 getMigrationReport（通过「更多 ⋯」菜单）与 undoDraftChange（均在途挂起）
    await user.click(screen.getByTestId('more-menu-btn'))
    await user.click(screen.getByRole('menuitem', { name: '查看旧项目迁移差异报告' }))
    await user.click(screen.getByRole('button', { name: '撤销被阻塞修改' }))

    // 2. 切换到项目 B（隔套兼容示例）
    await user.click(screen.getByTestId('more-menu-btn'))
    await user.click(screen.getByRole('menuitem', { name: /切换本地项目/ }))
    await user.click(screen.getByRole('button', { name: '打开项目 隔套兼容示例' }))

    // 验证切项目后已选任务书附件已彻底清空（切换到内置对话并打开「+ 引用」浮层查看）
    await user.click(screen.getByTestId('more-menu-btn'))
    await user.click(screen.getByRole('menuitem', { name: /切换到内置模型对话/ }))
    await user.click(screen.getByTestId('attach-ref-btn'))
    const taskbookBtn = screen.getByRole('button', { name: /隔套轴向尺寸链基准\.pdf · P1/ })
    expect(taskbookBtn).toHaveAttribute('aria-pressed', 'false')

    // 3. 项目 A 的迁移报告与撤销响应迟到返回 -> 严禁写入项目 B
    await act(async () => {
      migrationDeferred.resolve({
        ok: true,
        value: { ...SAMPLE_MIGRATION_REPORT, projectId: 'proj-plate-01' },
      })
      undoDeferred.resolve({
        ok: true,
        value: {
          projectId: 'proj-plate-01',
          previousDraftRevision: 'draft-5',
          restoredDraftRevision: 'draft-4-from-A',
          summary: '来自项目 A 的迟到撤销结果',
        },
      })
    })
    expect(screen.queryByTestId('migration-banner')).not.toBeInTheDocument()
    const topBar = screen.getByRole('banner', { name: '顶部连接状态栏' })
    expect(within(topBar).getByText('隔套兼容示例')).toBeInTheDocument()
    expect(screen.queryByText(/draft-4-from-A/)).not.toBeInTheDocument()
  })
})
