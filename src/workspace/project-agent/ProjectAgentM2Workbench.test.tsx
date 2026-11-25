// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ProjectAgentM1Workbench } from './ProjectAgentM1Workbench'
import {
  DEFAULT_M2_REQUIREMENTS,
  type M2CheckItem,
  type M2PreviewEvent,
  type M2WorkbenchBridge,
} from './m2WorkbenchBridge'
import type { M3WorkbenchBridge } from './m3WorkbenchBridge'

const READY_DRAFT2_SNAPSHOT = {
  currentRevision: 'draft-2',
  model: {
    status: 'ready' as const,
    revision: 'draft-2',
    revisionOrder: 2,
    isDraft: true,
    fingerprint: 'fp-draft-2',
  },
  drawing: {
    status: 'ready' as const,
    revision: 'draft-2',
    revisionOrder: 2,
    isDraft: true,
    fingerprint: 'fp-draft-2',
  },
}

describe('ProjectAgentM1Workbench (M2-FE-01 双视图联动、对象上下文与检查定位)', () => {
  it('支持模型/图纸/并排三视图切换，并在窄屏自动降级为标签页同时保留两者就绪状态', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <ProjectAgentM1Workbench
        bridge={{}}
        initialShowOnboarding={false}
        initialDraftRevision="draft-2"
        initialPreviewSnapshot={READY_DRAFT2_SNAPSHOT}
        forceNarrowViewport={false}
      />,
    )

    // 确认无手动参数表、尺寸滑块或坐标编辑器
    expect(document.querySelector('input[type="range"]')).toBeNull()

    const canvas = screen.getByRole('region', { name: '中央画布' })
    const viewTabs = screen.getByRole('tablist', { name: '中央画布视图切换' })

    // 默认同版就绪进入并排视图
    expect(canvas).toHaveAttribute('data-effective-view', 'split')
    expect(within(canvas).getByRole('region', { name: '三维模型视图' })).toBeInTheDocument()
    expect(within(canvas).getByRole('region', { name: '二维图纸视图' })).toBeInTheDocument()

    // 切到“模型”视图
    await user.click(within(viewTabs).getByRole('tab', { name: '模型' }))
    expect(canvas).toHaveAttribute('data-effective-view', 'model')
    expect(within(canvas).getByRole('region', { name: '三维模型视图' })).toBeInTheDocument()
    expect(within(canvas).queryByRole('region', { name: '二维图纸视图' })).not.toBeInTheDocument()

    // 切到“图纸”视图
    await user.click(within(viewTabs).getByRole('tab', { name: '图纸' }))
    expect(canvas).toHaveAttribute('data-effective-view', 'drawing')
    expect(within(canvas).queryByRole('region', { name: '三维模型视图' })).not.toBeInTheDocument()
    expect(within(canvas).getByRole('region', { name: '二维图纸视图' })).toBeInTheDocument()

    // 切回“并排”视图，随后切到窄屏 -> 自动降级为标签页并保留模型与图纸就绪状态
    await user.click(within(viewTabs).getByRole('tab', { name: '并排' }))
    expect(canvas).toHaveAttribute('data-effective-view', 'split')

    rerender(
      <ProjectAgentM1Workbench
        bridge={{}}
        initialShowOnboarding={false}
        initialDraftRevision="draft-2"
        initialPreviewSnapshot={READY_DRAFT2_SNAPSHOT}
        forceNarrowViewport={true}
      />,
    )
    expect(canvas).toHaveAttribute('data-narrow-degraded', 'true')
    expect(within(viewTabs).getByRole('tab', { name: '并排' })).toBeDisabled()
    const narrowStatus = screen.getByRole('status', { name: '窄屏标签页降级状态' })
    expect(within(narrowStatus).getByText(/窄屏标签页模式/)).toBeInTheDocument()
    expect(within(narrowStatus).getByText(/模型就绪/)).toBeInTheDocument()
    expect(within(narrowStatus).getByText(/图纸就绪/)).toBeInTheDocument()
  })

  it('并排视图下支持特征 ↔ 图纸标注双向高亮联动', async () => {
    const user = userEvent.setup()
    render(
      <ProjectAgentM1Workbench
        bridge={{}}
        initialShowOnboarding={false}
        initialDraftRevision="draft-2"
        initialPreviewSnapshot={READY_DRAFT2_SNAPSHOT}
        initialViewMode="split"
        forceNarrowViewport={false}
      />,
    )

    const modelPane = screen.getByRole('region', { name: '三维模型视图' })
    const drawingPane = screen.getByRole('region', { name: '二维图纸视图' })

    // 1. 点选模型特征“安装板 › 左孔 › 圆柱面” -> 图纸对应“两孔中心距”标注同步高亮
    await user.click(within(modelPane).getByRole('button', { name: /安装板 › 左孔 › 圆柱面/ }))
    const pitchAnn = within(drawingPane).getByRole('button', { name: /两孔中心距/ })
    expect(pitchAnn).toHaveAttribute('data-highlighted', 'true')

    // 2. 点选图纸标注“右孔至右端面边距” -> 模型对应“右孔”和“右端面”同步高亮
    await user.click(within(drawingPane).getByRole('button', { name: /右孔至右端面边距/ }))
    const rightHoleBtn = within(modelPane).getByRole('button', { name: /安装板 › 右孔 › 圆柱面/ })
    const rightFaceBtn = within(modelPane).getByRole('button', { name: /安装板 › 右端面/ })
    expect(rightHoleBtn).toHaveAttribute('data-highlighted', 'true')
    expect(rightFaceBtn).toHaveAttribute('data-highlighted', 'true')
  })

  it('对象引用上下文区提供层级路径与三个操作，并支持键盘在对象列表、画布和侧栏间切换定位', async () => {
    const user = userEvent.setup()
    const copied: string[] = []
    render(
      <ProjectAgentM1Workbench
        bridge={{}}
        initialShowOnboarding={false}
        initialDraftRevision="draft-2"
        forceNarrowViewport={false}
        clipboardWriter={(text) => {
          copied.push(text)
        }}
      />,
    )

    const contextBar = screen.getByRole('region', { name: '对象引用上下文区' })
    expect(within(contextBar).getByTestId('selection-breadcrumb')).toHaveTextContent(
      '安装板 › 右孔 › 圆柱面',
    )

    // 复制到外部会话
    await user.click(within(contextBar).getByRole('button', { name: '复制到外部会话' }))
    expect(copied[0]).toBe('安装板 › 右孔 › 圆柱面 [plate/right-hole/cylinder]')
    expect(within(screen.getByRole('region', { name: '中央画布' })).getByText(/已复制到外部会话/)).toBeInTheDocument()

    // 带入下一句话
    await user.click(within(contextBar).getByRole('button', { name: '带入下一句话' }))
    expect(screen.getByLabelText('内置对话输入框')).toHaveValue('针对「安装板 › 右孔 › 圆柱面」：')

    // 键盘在对象列表、画布与侧栏间切换焦点（先展开零件结构浮层，F6 循环 & Shift+F6 逆向）
    await user.click(screen.getByTestId('toggle-structure-btn'))
    const objectList = screen.getByRole('region', { name: '对象列表' })
    const canvas = screen.getByRole('region', { name: '中央画布' })
    const sidebar = screen.getByRole('complementary', { name: '主工作台侧栏' })

    objectList.focus()
    expect(document.activeElement).toBe(objectList)

    await user.keyboard('{F6}')
    expect(document.activeElement).toBe(canvas)

    await user.keyboard('{F6}')
    expect(document.activeElement).toBe(sidebar)

    await user.keyboard('{Shift>}{F6}{/Shift}')
    expect(document.activeElement).toBe(canvas)

    // 对象列表内支持方向键切换
    objectList.focus()
    await user.keyboard('{ArrowDown}')
    expect(within(objectList).getByRole('button', { name: /安装板 › 右孔 › 圆柱面/ })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(within(objectList).getByRole('button', { name: /安装板 › 左孔 › 圆柱面/ })).toHaveFocus()

    // 取消选择后，悬浮对象引用上下文条隐藏
    await user.click(within(contextBar).getByRole('button', { name: '取消选择' }))
    expect(screen.queryByRole('region', { name: '对象引用上下文区' })).not.toBeInTheDocument()
  })

  it('连续刷新保留视图模式、视角/缩放状态与有效选择；旧选中失效时明确提示重新选择或重绑', async () => {
    let pushEvent: ((event: M2PreviewEvent) => void) | null = null
    const bridge: M2WorkbenchBridge = {
      subscribeM2PreviewEvents: async (_req, listener) => {
        pushEvent = listener
        return { ok: true, value: { subscriptionId: 'sub-m2-1' } }
      },
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={false}
        initialDraftRevision="draft-2"
        initialPreviewSnapshot={READY_DRAFT2_SNAPSHOT}
        initialViewMode="split"
        forceNarrowViewport={false}
      />,
    )

    // 确认初始视角与缩放状态（精简版画布优先使用鼠标拖拽/滚轮缩放，连续修订刷新后保持视角/缩放）
    expect(screen.getByLabelText('模型视角状态')).toHaveTextContent('视角 35°/25° · 缩放 100%')
    expect(screen.getByLabelText('图纸缩放状态')).toHaveTextContent('图纸缩放 100%')

    // 连续刷新 draft-3（仍包含右孔）-> 保留视图模式、视角/缩放状态与选中对象
    await act(async () => {
      pushEvent?.({
        projectId: 'proj-plate-01',
        sequence: 1,
        revision: 'draft-3',
        fingerprint: 'fp-draft-3',
        type: 'revision_refreshed',
        features: [
          {
            objectId: 'obj-right-hole',
            breadcrumb: '安装板 › 右孔 › 圆柱面',
            featureRef: 'plate/right-hole/cylinder',
            partName: '安装板',
            role: '右孔圆柱面',
            kind: 'hole',
            linkedAnnotationIds: ['ann-right-margin'],
          },
        ],
      })
    })
    expect(screen.getByRole('region', { name: '中央画布' })).toHaveAttribute(
      'data-effective-view',
      'split',
    )
    expect(screen.getByLabelText('模型视角状态')).toHaveTextContent('视角 35°/25° · 缩放 100%')
    expect(screen.getByLabelText('图纸缩放状态')).toHaveTextContent('图纸缩放 100%')
    expect(screen.getByTestId('selection-breadcrumb')).toHaveTextContent('安装板 › 右孔 › 圆柱面')

    // 连续刷新 draft-4（右孔被删除）-> 明确提示“选中对象已失效，请重新选择或重绑”
    await act(async () => {
      pushEvent?.({
        projectId: 'proj-plate-01',
        sequence: 2,
        revision: 'draft-4',
        fingerprint: 'fp-draft-4',
        type: 'revision_refreshed',
        features: [
          {
            objectId: 'obj-left-hole',
            breadcrumb: '安装板 › 左孔 › 圆柱面',
            featureRef: 'plate/left-hole/cylinder',
            partName: '安装板',
            role: '左孔圆柱面',
            kind: 'hole',
            linkedAnnotationIds: ['ann-hole-pitch'],
          },
        ],
      })
    })
    expect(screen.getByText('选中对象已失效，请重新选择或重绑')).toBeInTheDocument()
  })

  it('部分产物失败明确标出各自修订号并提供“重试图纸”动作（缺失接口诚实提示，已接线重试成功）', async () => {
    const user = userEvent.setup()
    const retryMock = vi.fn(async () => ({
      ok: true as const,
      value: {
        projectId: 'proj-plate-01',
        revision: 'draft-8',
        revisionOrder: 8,
        fingerprint: 'fp-draft-8',
        summary: '草稿 8 图纸重试投影完成',
      },
    }))

    const partialSnapshot = {
      currentRevision: 'draft-8',
      model: {
        status: 'ready' as const,
        revision: 'draft-8',
        revisionOrder: 8,
        isDraft: true,
        fingerprint: 'fp-draft-8',
      },
      drawing: {
        status: 'ready' as const,
        revision: 'v7',
        revisionOrder: 7,
        isDraft: false,
        fingerprint: 'fp-v7',
      },
      drawingFailure: {
        failedRevision: 'draft-8',
        failedRevisionOrder: 8,
        reason: '二维投影内核超时',
        retryable: true,
      },
    }

    // 1. 缺失 retryM2Drawing 时诚实提示后端未接线
    const { unmount } = render(
      <ProjectAgentM1Workbench
        bridge={{}}
        initialShowOnboarding={false}
        initialPreviewSnapshot={partialSnapshot}
        forceNarrowViewport={false}
      />,
    )
    expect(
      screen.getByText('草稿 8 的模型已生成；图纸生成失败，当前显示版本 7'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重试图纸' }))
    expect(screen.getByText(/后端尚未接线\/不可用（缺失方法：retryM2Drawing）/)).toBeInTheDocument()
    unmount()

    // 2. 已接线 retryM2Drawing 时重试成功并同版自动切至并排
    render(
      <ProjectAgentM1Workbench
        bridge={{ retryM2Drawing: retryMock } satisfies M2WorkbenchBridge}
        initialShowOnboarding={false}
        initialViewMode="model"
        initialPreviewSnapshot={partialSnapshot}
        forceNarrowViewport={false}
      />,
    )
    await user.click(screen.getByRole('button', { name: '重试图纸' }))
    expect(retryMock).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/草稿 8 图纸重试成功/)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '中央画布' })).toHaveAttribute(
      'data-effective-view',
      'split',
    )
  })

  it('侧栏支持四标签切换，检查面板展示 6 种状态（文字+图形）、调用 locateM2Evidence 定位原文与特征并支持待澄清回答', async () => {
    const user = userEvent.setup()
    const locateSpy = vi.fn(async () => ({
      ok: true as const,
      value: {
        requirementId: 'req-right-margin',
        checkId: 'chk-fail',
        anchors: [
          {
            documentRef: 'doc-plate',
            documentName: '安装板任务书.pdf',
            page: 2,
            region: { x: 110, y: 240, width: 420, height: 64, unit: 'pdfPoint1000' as const },
            excerpt: '右孔至右端面的剩余材料在全部允许变化下至少为 13 mm。',
          },
        ],
        featureIds: ['obj-right-hole', 'obj-right-face'],
        annotationIds: ['ann-right-margin'],
        inputs: [{ name: '右孔 X', valueText: '62.0 ±0.2 mm' }],
        thresholdText: '最小剩余材料 ≥ 13.0 mm',
      },
    }))
    const clarifySpy = vi.fn(async () => ({
      ok: true as const,
      value: {
        targetId: 'chk-clarify',
        accepted: true,
        updatedInterpretation: '以第 1 页厚度 8 mm 为准',
        message: '已保存澄清回答，进入条款重算。',
      },
    }))

    const allSixChecks: M2CheckItem[] = [
      {
        checkId: 'chk-pass',
        requirementId: 'req-1',
        title: '条款一：外形尺寸',
        required: true,
        status: 'pass',
        summary: '通过摘要',
        linkedFeatureIds: ['obj-right-face'],
        linkedAnnotationIds: ['ann-plate-length'],
      },
      {
        checkId: 'chk-fail',
        requirementId: 'req-right-margin',
        title: '条款二：右孔边距不足',
        required: true,
        status: 'fail',
        summary: '最差 12.75 mm < 13.0 mm',
        linkedFeatureIds: ['obj-right-hole', 'obj-right-face'],
        linkedAnnotationIds: ['ann-right-margin'],
      },
      {
        checkId: 'chk-clarify',
        requirementId: 'req-datum-conflict',
        title: '条款三：厚度来源冲突',
        required: true,
        status: 'needsClarification',
        summary: '存在两处矛盾厚度说明',
        clarificationReason: 'conflict',
        clarificationPrompt: '请确认安装板厚度取值',
        linkedFeatureIds: ['obj-left-hole'],
        linkedAnnotationIds: ['ann-hole-pitch'],
      },
      {
        checkId: 'chk-uncovered',
        requirementId: 'req-4',
        title: '条款四：未支持形位公差',
        required: false,
        status: 'uncovered',
        summary: '当前版本未覆盖位置度公差',
        linkedFeatureIds: [],
        linkedAnnotationIds: [],
      },
      {
        checkId: 'chk-exec-fail',
        requirementId: 'req-5',
        title: '条款五：干涉求解异常',
        required: true,
        status: 'executionFailed',
        summary: '几何求解器返回异常',
        linkedFeatureIds: [],
        linkedAnnotationIds: [],
      },
      {
        checkId: 'chk-checking',
        requirementId: 'req-6',
        title: '条款六：盖板空间间隙',
        required: true,
        status: 'checking',
        summary: '正在执行三维法向间隙求解',
        linkedFeatureIds: ['obj-cover-gap'],
        linkedAnnotationIds: ['ann-cover-gap'],
      },
    ]

    render(
      <ProjectAgentM1Workbench
        bridge={{ locateM2Evidence: locateSpy, submitM2Clarification: clarifySpy } satisfies M2WorkbenchBridge}
        initialShowOnboarding={false}
        initialViewMode="split"
        forceNarrowViewport={false}
        initialPreviewSnapshot={{ ...READY_DRAFT2_SNAPSHOT, checks: allSixChecks, checksInProgress: true }}
      />,
    )

    const sidebarTabs = screen.getByRole('tablist', { name: '侧栏功能切换' })
    expect(within(sidebarTabs).getByRole('tab', { name: /活动|对话/ })).toBeInTheDocument()
    expect(within(sidebarTabs).getByRole('tab', { name: '要求' })).toBeInTheDocument()
    expect(within(sidebarTabs).getByRole('tab', { name: '检查' })).toBeInTheDocument()
    expect(within(sidebarTabs).getByRole('tab', { name: '历史' })).toBeInTheDocument()

    // 切到“检查”面板时，中央零件/图纸依然可见
    await user.click(within(sidebarTabs).getByRole('tab', { name: '检查' }))
    expect(screen.getByRole('region', { name: '三维模型视图' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '二维图纸视图' })).toBeInTheDocument()

    // 验证 6 种状态均具备文字 + 图形标识
    const checkList = screen.getByRole('list', { name: '检查条款列表' })
    expect(within(checkList).getByLabelText('检查状态：通过')).toHaveTextContent('✓ 通过')
    expect(within(checkList).getByLabelText('检查状态：失败')).toHaveTextContent('✕ 失败')
    expect(within(checkList).getByLabelText('检查状态：待澄清')).toHaveTextContent('? 待澄清')
    expect(within(checkList).getByLabelText('检查状态：未覆盖')).toHaveTextContent('○ 未覆盖')
    expect(within(checkList).getByLabelText('检查状态：执行失败')).toHaveTextContent('! 执行失败')
    expect(within(checkList).getByLabelText('检查状态：检查中')).toHaveTextContent('◌ 检查中')

    // 点击“条款二：右孔边距不足” -> 调用 locateEvidence 并同步高亮模型特征、图纸标注与展示原文页/选区
    await user.click(within(checkList).getByRole('button', { name: /条款二：右孔边距不足/ }))
    expect(locateSpy).toHaveBeenCalledTimes(1)

    const evidenceCard = screen.getByRole('region', { name: '来源定位证据' })
    expect(await within(evidenceCard).findByText(/安装板任务书\.pdf · 第 2 页/)).toBeInTheDocument()
    expect(within(evidenceCard).getByText(/选区 \(110, 240, 420×64\)/)).toBeInTheDocument()
    expect(
      within(evidenceCard).getByText(/右孔至右端面的剩余材料在全部允许变化下至少为 13 mm/),
    ).toBeInTheDocument()

    // 待澄清项支持逐条回答/纠正解释
    const clarifyInput = screen.getByLabelText('澄清输入 条款三：厚度来源冲突')
    await user.type(clarifyInput, '厚度以第 1 页 8 mm 为准')
    await user.click(
      within(screen.getByLabelText('检查项待澄清 条款三：厚度来源冲突')).getByRole('button', {
        name: '提交回答',
      }),
    )
    expect(clarifySpy).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('已保存澄清回答，进入条款重算。')).toBeInTheDocument()

    // 切到“要求”与“历史”面板均正常展示
    await user.click(within(sidebarTabs).getByRole('tab', { name: '要求' }))
    expect(screen.getByRole('region', { name: '要求列表面板' })).toBeInTheDocument()
    await user.click(within(sidebarTabs).getByRole('tab', { name: '历史' }))
    expect(screen.getByRole('region', { name: '修订与事件历史面板' })).toBeInTheDocument()
  })

  it('locateM2Evidence 缺失时诚实提示后端未接线，不伪造后端定位成功', async () => {
    const user = userEvent.setup()
    render(
      <ProjectAgentM1Workbench
        bridge={{}}
        initialShowOnboarding={false}
        initialSidebarSection="checks"
        forceNarrowViewport={false}
      />,
    )

    const checkList = screen.getByRole('list', { name: '检查条款列表' })
    await user.click(within(checkList).getByRole('button', { name: /右孔至右端面最小剩余材料/ }))

    const evidenceCard = screen.getByRole('region', { name: '来源定位证据' })
    expect(
      within(evidenceCard).getByText(/后端尚未接线\/不可用（缺失方法：locateM2Evidence）/),
    ).toBeInTheDocument()
  })

  it('首个可重建草稿自动切 3D 并注明草稿；同版模型与图纸就绪自动切并排（检查未完标明“检查中”）；迟到旧修订仅进入历史', async () => {
    const user = userEvent.setup()
    let pushEvent: ((event: M2PreviewEvent) => void) | null = null
    const bridge: M2WorkbenchBridge = {
      subscribeM2PreviewEvents: async (_req, listener) => {
        pushEvent = listener
        return { ok: true, value: { subscriptionId: 'sub-m2-auto' } }
      },
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={false}
        initialBaseRevision={null}
        initialDraftRevision={null}
        initialViewMode="drawing"
        forceNarrowViewport={false}
      />,
    )

    const canvas = screen.getByRole('region', { name: '中央画布' })
    expect(canvas).toHaveAttribute('data-effective-view', 'drawing')

    // 1. 首个可重建草稿 draft-8 出现 -> 自动切到 3D（模型）视图并注明“草稿”
    await act(async () => {
      pushEvent?.({
        projectId: 'proj-plate-01',
        sequence: 1,
        revision: 'draft-8',
        isDraft: true,
        fingerprint: 'fp-draft-8',
        type: 'model_ready',
        checksInProgress: true,
      })
    })
    expect(canvas).toHaveAttribute('data-effective-view', 'model')
    expect(screen.getByLabelText('草稿预览标识')).toHaveTextContent('草稿')

    // 2. 迟到的旧修订 draft-7 图纸与检查事件到达 -> 不覆盖 draft-8，只能进入“历史”
    await act(async () => {
      pushEvent?.({
        projectId: 'proj-plate-01',
        sequence: 2,
        revision: 'draft-7',
        isDraft: true,
        fingerprint: 'fp-draft-7',
        type: 'drawing_ready',
      })
      pushEvent?.({
        projectId: 'proj-plate-01',
        sequence: 3,
        revision: 'draft-7',
        isDraft: true,
        type: 'checks_updated',
        checks: [],
        checksInProgress: false,
      })
    })
    expect(canvas).toHaveAttribute('data-effective-view', 'model')
    expect(within(canvas).getByText(/3D · 草稿 8/)).toBeInTheDocument()
    expect(within(canvas).queryByRole('region', { name: '二维图纸视图' })).not.toBeInTheDocument()

    // 3. 同版 draft-8 图纸就绪（指纹一致）且检查未完 -> 自动切至并排展示并标明“检查中”
    await act(async () => {
      pushEvent?.({
        projectId: 'proj-plate-01',
        sequence: 4,
        revision: 'draft-8',
        isDraft: true,
        fingerprint: 'fp-draft-8',
        type: 'drawing_ready',
        checksInProgress: true,
      })
    })
    expect(canvas).toHaveAttribute('data-effective-view', 'split')
    expect(screen.getByLabelText('检查进行中标识')).toHaveTextContent('检查中')

    // 切到“历史”标签，验证旧修订 draft-7 的迟到事件已记录在历史中
    const sidebarTabs = screen.getByRole('tablist', { name: '侧栏功能切换' })
    await user.click(within(sidebarTabs).getByRole('tab', { name: '历史' }))
    const historyList = screen.getByRole('list', { name: '历史事件列表' })
    expect(within(historyList).getAllByText(/旧修订迟到（未覆盖当前）/).length).toBeGreaterThanOrEqual(
      2,
    )
  })

  it('F11：任务自然完成（模型+图纸+检查同版就绪或 task_completed）自动展示并排视图与自然完成摘要，且严禁自动提交正式版', async () => {
    let pushEvent: ((event: M2PreviewEvent) => void) | null = null
    const commitM3ApprovedDraft = vi.fn()
    const bridge: M2WorkbenchBridge & M3WorkbenchBridge = {
      subscribeM2PreviewEvents: async (_req, listener) => {
        pushEvent = listener
        return { ok: true, value: { subscriptionId: 'sub-f11' } }
      },
      commitM3ApprovedDraft,
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={false}
        initialBaseRevision="v1"
        initialDraftRevision="draft-9"
        initialViewMode="model"
        initialPreviewSnapshot={{
          requirements: [DEFAULT_M2_REQUIREMENTS[0]],
        }}
        forceNarrowViewport={false}
      />,
    )

    await act(async () => {
      pushEvent?.({
        projectId: 'proj-plate-01',
        sequence: 1,
        revision: 'draft-9',
        fingerprint: 'fp-draft-9',
        type: 'model_ready',
        checksInProgress: true,
      })
      pushEvent?.({
        projectId: 'proj-plate-01',
        sequence: 2,
        revision: 'draft-9',
        fingerprint: 'fp-draft-9',
        type: 'drawing_ready',
        checksInProgress: true,
      })
      pushEvent?.({
        projectId: 'proj-plate-01',
        sequence: 3,
        revision: 'draft-9',
        fingerprint: 'fp-draft-9',
        type: 'task_completed',
        taskCompleted: true,
        checksInProgress: false,
        checks: [
          {
            checkId: 'chk-d9-1',
            requirementId: 'req-right-margin',
            title: '右孔边距',
            required: true,
            status: 'pass',
            summary: '14.5 mm ≥ 13.0 mm',
            linkedFeatureIds: ['obj-right-hole'],
            linkedAnnotationIds: ['ann-right-margin'],
            revisionFingerprint: 'fp-draft-9',
          },
        ],
      })
    })

    const canvas = screen.getByRole('region', { name: '中央画布' })
    expect(canvas).toHaveAttribute('data-effective-view', 'split')
    const naturalSummary = within(canvas).getByRole('status', { name: '自然完成摘要' })
    expect(within(naturalSummary).getByText(/草稿 9 模型、图纸与检查已同版就绪/)).toBeInTheDocument()
    expect(within(naturalSummary).getByText(/尚未自动提交正式版本 · 需人工复核确认/)).toBeInTheDocument()
    expect(commitM3ApprovedDraft).not.toHaveBeenCalled()
  })

  it('E4：两槽同版 ready 且收到 task_completed 但 checks 为空时展示明确终态摘要，并阻断正式保存', async () => {
    const user = userEvent.setup()
    let pushEvent: ((event: M2PreviewEvent) => void) | null = null
    const bridge: M2WorkbenchBridge = {
      subscribeM2PreviewEvents: async (_req, listener) => {
        pushEvent = listener
        return { ok: true, value: { subscriptionId: 'sub-e4' } }
      },
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={false}
        initialBaseRevision="v1"
        initialDraftRevision="draft-9"
        initialViewMode="model"
        forceNarrowViewport={false}
      />,
    )

    await act(async () => {
      pushEvent?.({
        projectId: 'proj-plate-01',
        sequence: 1,
        revision: 'draft-9',
        fingerprint: 'fp-draft-9',
        type: 'model_ready',
        checks: [],
        checksInProgress: false,
      })
      pushEvent?.({
        projectId: 'proj-plate-01',
        sequence: 2,
        revision: 'draft-9',
        fingerprint: 'fp-draft-9',
        type: 'drawing_ready',
        checks: [],
        checksInProgress: false,
      })
      pushEvent?.({
        projectId: 'proj-plate-01',
        sequence: 3,
        revision: 'draft-9',
        fingerprint: 'fp-draft-9',
        type: 'task_completed',
        taskCompleted: true,
        checks: [],
        checksInProgress: false,
      })
    })

    const canvas = screen.getByRole('region', { name: '中央画布' })
    const summary = within(canvas).getByRole('status', { name: '自然完成摘要' })
    expect(within(summary).getByText(/任务已结束 · 等待检查结果 · 尚未满足正式保存条件/)).toBeInTheDocument()

    // 打开完成视图确认正式保存仍被严格阻断
    await user.click(within(summary).getByRole('button', { name: '前往复核与确认' }))
    const completionView = screen.getByTestId('completion-view')
    expect(within(completionView).getByRole('button', { name: '保存正式版本' })).toBeDisabled()
  })

  it('S5：重试图纸成功后不污染服务端 sequence 水位，随后到达的同序号真实服务端检查事件正常处理', async () => {
    const user = userEvent.setup()
    let pushEvent: ((event: M2PreviewEvent) => void) | null = null
    const bridge: M2WorkbenchBridge = {
      subscribeM2PreviewEvents: async (_req, listener) => {
        pushEvent = listener
        return { ok: true, value: { subscriptionId: 'sub-s5' } }
      },
      retryM2Drawing: async () => ({
        ok: true,
        value: {
          projectId: 'proj-plate-01',
          revision: 'draft-8',
          revisionOrder: 8,
          fingerprint: 'fp-draft-8',
          summary: '草稿 8 图纸重试完成',
        },
      }),
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={false}
        initialSidebarSection="checks"
        initialDraftRevision="draft-8"
        forceNarrowViewport={false}
      />,
    )

    // 服务端事件 seq 1 (model_ready) & seq 2 (drawing_failed)
    await act(async () => {
      pushEvent?.({
        projectId: 'proj-plate-01',
        sequence: 1,
        revision: 'draft-8',
        fingerprint: 'fp-draft-8',
        type: 'model_ready',
      })
      pushEvent?.({
        projectId: 'proj-plate-01',
        sequence: 2,
        revision: 'draft-8',
        type: 'drawing_failed',
        errorReason: '投影超时',
      })
    })

    // 点击重试图纸 -> 使用 applyM2DrawingRetryResult，不得将水位推到 3
    await user.click(screen.getByRole('button', { name: '重试图纸' }))
    expect(await screen.findByText(/草稿 8 图纸重试成功/)).toBeInTheDocument()

    // 服务端紧接着发送真实 seq 3 的检查更新事件 -> 必须正常生效
    await act(async () => {
      pushEvent?.({
        projectId: 'proj-plate-01',
        sequence: 3,
        revision: 'draft-8',
        fingerprint: 'fp-draft-8',
        type: 'checks_updated',
        checksInProgress: false,
        checks: [
          {
            checkId: 'chk-after-retry',
            requirementId: 'req-right-margin',
            title: '重试后真实服务端检查项',
            required: true,
            status: 'pass',
            summary: '服务端 seq 3 正常到达',
            linkedFeatureIds: ['obj-right-hole'],
            linkedAnnotationIds: ['ann-right-margin'],
            revisionFingerprint: 'fp-draft-8',
          },
        ],
      })
    })
    expect(screen.getByText('重试后真实服务端检查项')).toBeInTheDocument()
  })
})
