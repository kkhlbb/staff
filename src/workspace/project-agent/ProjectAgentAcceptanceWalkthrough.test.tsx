// @vitest-environment jsdom
/**
 * M3-FE-02：第一部分 §4 与第二部分 §5 A01–A12 全链路前端验收走查套件
 *
 * 使用贴近 M2-BE-01 固定任务书（80 × 50 × 8 mm 安装板、两只 Ø10 通孔 (20,25)/(60,25)、
 * 参考盖板 Z=10 ±0.1 mm）的合成双入口夹具（外置本地 Agent + 内置模型 API），
 * 含真实 `modelMesh` 与 `drawingVector`，逐条验证 A01–A12 前端交付链路。
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ProjectAgentM1Workbench } from './ProjectAgentM1Workbench'
import type {
  M1WorkbenchBridge,
  M1WorkbenchIncomingEvent,
} from './m1WorkbenchBridge'
import type {
  M2BackendDrawing,
  M2CheckItem,
  M2DrawingAnnotationItem,
  M2ModelFeatureItem,
  M2ModelMesh,
  M2PreviewEvent,
  M2RequirementItem,
  M2WorkbenchBridge,
} from './m2WorkbenchBridge'
import type {
  M3ExternalProjectEvent,
  M3MigrationReport,
  M3WorkbenchBridge,
} from './m3WorkbenchBridge'

// ---------------------------------------------------------------------------
// M2-BE-01 合成几何与工程夹具构造器（80 × 50 × 8 mm 安装板 + 双 Ø10 孔 + 盖板）
// ---------------------------------------------------------------------------

function buildPlateFeatures(rightHoleObjectId = 'obj-right-hole'): readonly M2ModelFeatureItem[] {
  return [
    {
      objectId: rightHoleObjectId,
      breadcrumb: '安装板 › 右孔 › 圆柱面',
      featureRef: 'plate/right-hole/cylinder',
      partName: '安装板',
      role: 'hole.right.axis',
      kind: 'hole',
      linkedAnnotationIds: ['ann-right-margin', 'ann-right-hole-dia', 'ann-hole-pitch'],
    },
    {
      objectId: 'obj-left-hole',
      breadcrumb: '安装板 › 左孔 › 圆柱面',
      featureRef: 'plate/left-hole/cylinder',
      partName: '安装板',
      role: 'hole.left.axis',
      kind: 'hole',
      linkedAnnotationIds: ['ann-hole-pitch'],
    },
    {
      objectId: 'obj-right-face',
      breadcrumb: '安装板 › 右端面',
      featureRef: 'plate/right-end-face',
      partName: '安装板',
      role: 'plate.rightFace',
      kind: 'face',
      linkedAnnotationIds: ['ann-right-margin', 'ann-plate-length'],
    },
    {
      objectId: 'obj-cover-gap',
      breadcrumb: '参考盖板 › 底面间隙',
      featureRef: 'cover/bottom-face/gap',
      partName: '参考盖板',
      role: 'cover.bottomFace',
      kind: 'gap',
      linkedAnnotationIds: ['ann-cover-gap'],
    },
  ]
}

function buildPlateMesh(rightHoleX: number, rightHoleObjectId = 'obj-right-hole'): M2ModelMesh {
  const rxMin = rightHoleX - 5
  const rxMax = rightHoleX + 5
  return {
    frameId: 'plate-local',
    positions: [
      // Right hole (triangles 0..2)
      rxMin, 20, 0, rxMax, 20, 0, rxMax, 30, 8, rxMin, 30, 8,
      // Left hole (triangles 2..4)
      15, 20, 0, 25, 20, 0, 25, 30, 8, 15, 30, 8,
      // Right end face (triangles 4..6)
      80, 0, 0, 80, 50, 0, 80, 50, 8, 80, 0, 8,
      // Cover plate bottom face at Z=10 (triangles 6..8)
      0, 0, 10, 80, 0, 10, 80, 50, 10, 0, 50, 10,
    ],
    indices: [
      0, 1, 2, 0, 2, 3,
      4, 5, 6, 4, 6, 7,
      8, 9, 10, 8, 10, 11,
      12, 13, 14, 12, 14, 15,
    ],
    triangleRanges: [
      {
        startTriangle: 0,
        endTriangle: 2,
        objectId: rightHoleObjectId,
        featureRef: 'plate/right-hole/cylinder',
        role: 'hole.right.axis',
        partName: '安装板',
      },
      {
        startTriangle: 2,
        endTriangle: 4,
        objectId: 'obj-left-hole',
        featureRef: 'plate/left-hole/cylinder',
        role: 'hole.left.axis',
        partName: '安装板',
      },
      {
        startTriangle: 4,
        endTriangle: 6,
        objectId: 'obj-right-face',
        featureRef: 'plate/right-end-face',
        role: 'plate.rightFace',
        partName: '安装板',
      },
      {
        startTriangle: 6,
        endTriangle: 8,
        objectId: 'obj-cover-gap',
        featureRef: 'cover/bottom-face/gap',
        role: 'cover.bottomFace',
        partName: '参考盖板',
      },
    ],
    bounds: { min: [0, 0, 0], max: [80, 50, 10] },
  }
}

function buildPlateDrawing(
  revision: string,
  rightHoleX: number,
  rightHoleObjectId = 'obj-right-hole',
): {
  readonly drawingVector: M2BackendDrawing
  readonly annotations: readonly M2DrawingAnnotationItem[]
} {
  const nominalMargin = 80 - rightHoleX - 5
  const pitch = rightHoleX - 20
  const drawingVector: M2BackendDrawing = {
    unit: 'mm',
    revision,
    displayDecimals: 1,
    convention: 'local orthographic, +Y front, -Z top, -X right side',
    views: [
      {
        id: 'front',
        size: [80, 8],
        u: '+X',
        v: '+Z',
        geometry: [
          { kind: 'polyline', closed: true, points: [[0, 0], [80, 0], [80, 8], [0, 8]] },
          { kind: 'line', style: 'hidden', points: [[15, 0], [15, 8]] },
          { kind: 'line', style: 'hidden', points: [[25, 0], [25, 8]] },
          { kind: 'line', style: 'hidden', points: [[rightHoleX - 5, 0], [rightHoleX - 5, 8]] },
          { kind: 'line', style: 'hidden', points: [[rightHoleX + 5, 0], [rightHoleX + 5, 8]] },
        ],
      },
      {
        id: 'top',
        size: [80, 50],
        u: '+X',
        v: '+Y',
        geometry: [
          { kind: 'polyline', closed: true, points: [[0, 0], [80, 0], [80, 50], [0, 50]] },
          { kind: 'circle', center: [20, 25], radius: 5 },
          { kind: 'circle', center: [rightHoleX, 25], radius: 5 },
        ],
      },
      {
        id: 'side',
        size: [50, 8],
        u: '+Y',
        v: '+Z',
        geometry: [
          { kind: 'polyline', closed: true, points: [[0, 0], [50, 0], [50, 8], [0, 8]] },
          { kind: 'line', style: 'hidden', points: [[20, 0], [20, 8]] },
          { kind: 'line', style: 'hidden', points: [[30, 0], [30, 8]] },
        ],
      },
    ],
    annotations: [
      {
        id: 'ann-plate-length',
        view: 'front',
        side: 'below',
        lane: 0,
        valueMm: 80,
        witnesses: [[0, 0], [80, 0]],
        reference: { role: 'plate.rightFace', featureId: 'obj-right-face' },
      },
      {
        id: 'ann-right-hole-dia',
        view: 'top',
        side: 'above',
        lane: 0,
        valueMm: 10,
        witnesses: [[rightHoleX - 5, 25], [rightHoleX + 5, 25]],
        reference: { role: 'hole.right.axis', featureId: rightHoleObjectId },
      },
      {
        id: 'ann-right-margin',
        view: 'top',
        side: 'below',
        lane: 0,
        valueMm: nominalMargin,
        witnesses: [[rightHoleX + 5, 25], [80, 25]],
        reference: { role: 'hole.right.axis', featureId: rightHoleObjectId },
      },
      {
        id: 'ann-hole-pitch',
        view: 'top',
        side: 'below',
        lane: 1,
        valueMm: pitch,
        witnesses: [[20, 25], [rightHoleX, 25]],
        reference: { role: 'hole.left.axis', featureId: 'obj-left-hole' },
      },
    ],
  }

  const annotations: readonly M2DrawingAnnotationItem[] = [
    {
      annotationId: 'ann-plate-length',
      label: '安装板总长',
      valueText: '80.0 mm',
      view: 'front',
      linkedFeatureIds: ['obj-right-face'],
    },
    {
      annotationId: 'ann-right-hole-dia',
      label: '右孔直径',
      valueText: 'Ø10.0 mm',
      view: 'top',
      linkedFeatureIds: [rightHoleObjectId],
    },
    {
      annotationId: 'ann-right-margin',
      label: '右孔至右端面边距',
      valueText: `${nominalMargin.toFixed(1)} mm`,
      view: 'top',
      linkedFeatureIds: [rightHoleObjectId, 'obj-right-face'],
      requirementIds: ['req-right-margin'],
    },
    {
      annotationId: 'ann-hole-pitch',
      label: '两孔中心距',
      valueText: `${pitch.toFixed(1)} mm`,
      view: 'top',
      linkedFeatureIds: ['obj-left-hole', rightHoleObjectId],
    },
  ]

  return { drawingVector, annotations }
}

const PLATE_REQUIREMENTS: readonly M2RequirementItem[] = [
  {
    requirementId: 'req-right-margin',
    title: '右孔至右端面剩余材料 ≥ 13 mm',
    interpretation: '右孔 X/Y ±0.2 mm，直径 ±0.1 mm，全部允许变化下剩余材料 ≥ 13 mm',
    required: true,
    status: 'confirmed',
    anchor: {
      documentRef: 'tb-plate-p2',
      documentName: '安装板任务书.pdf',
      page: 2,
      region: { x: 72, y: 180, width: 410, height: 32, unit: 'pdfPoint1000' },
      excerpt: '右孔至右端面剩余材料在全部允许变化下至少为 13 mm。',
    },
    linkedFeatureIds: ['obj-right-hole', 'obj-right-face'],
    linkedAnnotationIds: ['ann-right-margin'],
  },
  {
    requirementId: 'req-cover-gap',
    title: '参考盖板底面与安装板顶面间隙 ≥ 1.5 mm',
    interpretation: '盖板底面 Z = 10 ± 0.1 mm，板厚 8 ± 0.2 mm，沿法向间隙 ≥ 1.5 mm',
    required: true,
    status: 'confirmed',
    anchor: {
      documentRef: 'tb-plate-p2',
      documentName: '安装板任务书.pdf',
      page: 2,
      region: { x: 72, y: 240, width: 420, height: 34, unit: 'pdfPoint1000' },
      excerpt: '参考盖板底面 Z 为 10 ± 0.1 mm，安装板厚度 8 ± 0.2 mm，要求间隙至少 1.5 mm。',
    },
    linkedFeatureIds: ['obj-cover-gap'],
    linkedAnnotationIds: ['ann-cover-gap'],
  },
]

function buildMarginCheck(rightHoleX: number, revisionFingerprint?: string): M2CheckItem {
  const nominal = 80 - rightHoleX - 5
  const minVal = Number((80 - (rightHoleX + 0.2) - 5.05).toFixed(2))
  const maxVal = Number((80 - (rightHoleX - 0.2) - 4.95).toFixed(2))
  const passed = minVal >= 13
  return {
    checkId: 'chk-right-margin',
    requirementId: 'req-right-margin',
    title: '右孔至右端面剩余材料 ≥ 13 mm',
    required: true,
    status: passed ? 'pass' : 'fail',
    summary: passed
      ? `名义 ${nominal} mm，范围 [${minVal.toFixed(2)}, ${maxVal.toFixed(2)}] mm，满足 ≥ 13 mm`
      : `名义 ${nominal} mm，范围 [${minVal.toFixed(2)}, ${maxVal.toFixed(2)}] mm，最差低于要求 ${(13 - minVal).toFixed(2)} mm`,
    linkedFeatureIds: ['obj-right-hole', 'obj-right-face'],
    linkedAnnotationIds: ['ann-right-margin'],
    revisionFingerprint: revisionFingerprint ?? null,
    anchor: PLATE_REQUIREMENTS[0].anchor,
  }
}

function buildCoverGapCheck(revisionFingerprint?: string): M2CheckItem {
  return {
    checkId: 'chk-cover-gap',
    requirementId: 'req-cover-gap',
    title: '参考盖板与安装板法向间隙 ≥ 1.5 mm',
    required: true,
    status: 'pass',
    summary: '名义间隙 2 mm，范围 [1.7, 2.3] mm（初始与绕世界 X 轴旋转 90° 后一致）',
    linkedFeatureIds: ['obj-cover-gap'],
    linkedAnnotationIds: ['ann-cover-gap'],
    revisionFingerprint: revisionFingerprint ?? null,
    anchor: PLATE_REQUIREMENTS[1].anchor,
  }
}

const COVER_GAP_PASS_CHECK: M2CheckItem = buildCoverGapCheck()

type FullTestBridge = M1WorkbenchBridge & M2WorkbenchBridge & M3WorkbenchBridge

// ---------------------------------------------------------------------------
// A01 – A12 前端验收走查测试套件
// ---------------------------------------------------------------------------

describe('M3-FE-02：A01–A12 全链路前端验收走查', () => {
  it('A01 + A02（双入口空项目建模与初始边距）：外置本地 Agent 与内置模型 API 均零手填参数、零导出再导入走到同屏并排', async () => {
    const user = userEvent.setup()

    // --- 入口 1：外置本地 Agent 从空项目走到模型与图纸同屏并排 ---
    let pushExternalPreview: ((event: M2PreviewEvent) => void) | null = null
    const externalBridge: FullTestBridge = {
      getM1ConnectionStatus: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          projectId: 'proj-plate-01',
          projectName: '安装板项目',
          baseRevision: null,
          draftRevision: null,
          source: 'local-agent',
          connectionState: 'connected',
          clientName: 'Claude Desktop',
          authorizationState: 'authorized-writable',
          writerEpoch: 1,
          writerOwner: 'local-agent:claude',
        },
      }),
      subscribeM2PreviewEvents: async (_req, listener) => {
        pushExternalPreview = listener
        return { ok: true, value: { subscriptionId: 'sub-a01-ext' } }
      },
    }

    const { unmount } = render(
      <ProjectAgentM1Workbench
        bridge={externalBridge}
        initialShowOnboarding={true}
        initialBaseRevision={null}
        initialDraftRevision={null}
        forceNarrowViewport={false}
        initialPreviewSnapshot={{
          currentRevision: null,
          model: { status: 'empty', revision: null, revisionOrder: null, isDraft: false, fingerprint: null },
          drawing: { status: 'empty', revision: null, revisionOrder: null, isDraft: false, fingerprint: null },
          features: [],
          annotations: [],
          requirements: [],
          checks: [],
        }}
      />,
    )

    // 外置模式握手检测
    await user.click(screen.getByRole('button', { name: '检测连接状态' }))
    expect(await screen.findByText(/已检测到客户端 Claude Desktop 握手成功/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '进入外置任务活动' }))

    // 推送首草稿 3D 模型（80×50×8 mm，两只 Ø10 通孔）
    const d1Drawing = buildPlateDrawing('draft-1', 60)
    act(() => {
      pushExternalPreview?.({
        projectId: 'proj-plate-01',
        sequence: 1,
        revision: 'draft-1',
        revisionOrder: 1,
        isDraft: true,
        fingerprint: 'fp-a01-d1',
        type: 'model_ready',
        features: buildPlateFeatures(),
        modelMesh: buildPlateMesh(60),
        requirements: PLATE_REQUIREMENTS,
        summary: '包围盒 80×50×8 mm，名义净体积 32000 - 400π mm³',
      })
    })

    // 首个可重建草稿自动切 3D 视图并渲染网格
    expect(screen.getByTestId('m2-three-viewport')).toBeInTheDocument()
    expect(screen.getByLabelText('中央画布')).toHaveAttribute('data-effective-view', 'model')

    // 推送同版 2D 矢量图纸 + A02 初始边距检查（名义 15 mm，范围 [14.75, 15.25] mm）
    act(() => {
      pushExternalPreview?.({
        projectId: 'proj-plate-01',
        sequence: 2,
        revision: 'draft-1',
        revisionOrder: 1,
        isDraft: true,
        fingerprint: 'fp-a01-d1',
        type: 'drawing_ready',
        drawingVector: d1Drawing.drawingVector,
        annotations: d1Drawing.annotations,
      })
      pushExternalPreview?.({
        projectId: 'proj-plate-01',
        sequence: 3,
        revision: 'draft-1',
        revisionOrder: 1,
        isDraft: true,
        fingerprint: 'fp-a01-d1',
        type: 'checks_updated',
        checksInProgress: false,
        checks: [buildMarginCheck(60), COVER_GAP_PASS_CHECK],
      })
    })

    // 自动并排展示 3D 模型与 2D SVG 图纸；严禁手填参数（0 滑块、0 数字输入框）
    expect(screen.getByLabelText('中央画布')).toHaveAttribute('data-effective-view', 'split')
    expect(screen.getByTestId('m2-three-viewport')).toBeInTheDocument()
    const svg = screen.getByTestId('m2-drawing-svg')
    expect(svg.querySelectorAll('circle[data-primitive="circle"]')).toHaveLength(2)
    expect(within(svg).getByText(/80\.0 mm/)).toBeInTheDocument()
    expect(within(svg).getByText(/Ø10\.0 mm/)).toBeInTheDocument()
    expect(within(svg).getByText(/15\.0 mm/)).toBeInTheDocument()
    expect(document.querySelectorAll('input[type="range"]')).toHaveLength(0)
    expect(document.querySelectorAll('input[type="number"]')).toHaveLength(0)

    // 核对 A02 初始边距检查 [14.75, 15.25] mm
    const sidebarTabs = screen.getByRole('tablist', { name: '侧栏功能切换' })
    await user.click(within(sidebarTabs).getByRole('tab', { name: '检查' }))
    expect(screen.getByText(/名义 15 mm，范围 \[14\.75, 15\.25\] mm/)).toBeInTheDocument()
    unmount()

    // --- 入口 2：内置模型 API 从空项目经真实工具往返后导入任务书走到同屏并排 ---
    let pushBuiltinPreview: ((event: M2PreviewEvent) => void) | null = null
    const builtinBridge: FullTestBridge = {
      testM1ModelApiConnection: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          availableModels: ['gpt-4.1'],
          selectedModel: 'gpt-4.1',
          toolCallSupported: true,
          toolRoundTripPassed: true,
          toolRoundTripName: 'describe_project',
        },
      }),
      sendM1ChatMessage: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          messageId: 'msg-a01-1',
          reply: '已按安装板任务书生成 80×50×8 mm 安装板、双 Ø10 孔及二维图纸。',
          draftRevision: 'draft-1',
          toolCalls: [{ name: 'buildAndCheck', status: 'succeeded' }],
        },
      }),
      subscribeM2PreviewEvents: async (_req, listener) => {
        pushBuiltinPreview = listener
        return { ok: true, value: { subscriptionId: 'sub-a01-builtin' } }
      },
    }

    render(
      <ProjectAgentM1Workbench
        bridge={builtinBridge}
        initialShowOnboarding={true}
        initialBaseRevision={null}
        initialDraftRevision={null}
        forceNarrowViewport={false}
        initialPreviewSnapshot={{
          currentRevision: null,
          model: { status: 'empty', revision: null, revisionOrder: null, isDraft: false, fingerprint: null },
          drawing: { status: 'empty', revision: null, revisionOrder: null, isDraft: false, fingerprint: null },
          features: [],
          annotations: [],
          requirements: PLATE_REQUIREMENTS,
          checks: [],
        }}
      />,
    )

    await user.click(screen.getByRole('button', { name: /使用模型 API/ }))
    await user.type(screen.getByLabelText('密钥'), 'sk-test-a01')
    await user.click(screen.getByRole('button', { name: '测试连接' }))
    await user.click(await screen.findByRole('button', { name: '进入内置建模对话' }))

    await user.type(screen.getByLabelText('内置对话输入框'), '按安装板任务书生成模型、图纸与边距检查')
    await user.click(screen.getByRole('button', { name: '发送' }))

    act(() => {
      pushBuiltinPreview?.({
        projectId: 'proj-plate-01',
        sequence: 1,
        revision: 'draft-1',
        revisionOrder: 1,
        isDraft: true,
        fingerprint: 'fp-a01-api',
        type: 'model_ready',
        features: buildPlateFeatures(),
        modelMesh: buildPlateMesh(60),
      })
      pushBuiltinPreview?.({
        projectId: 'proj-plate-01',
        sequence: 2,
        revision: 'draft-1',
        revisionOrder: 1,
        isDraft: true,
        fingerprint: 'fp-a01-api',
        type: 'drawing_ready',
        drawingVector: d1Drawing.drawingVector,
        annotations: d1Drawing.annotations,
      })
    })

    expect(screen.getByLabelText('中央画布')).toHaveAttribute('data-effective-view', 'split')
    expect(screen.getByTestId('m2-three-viewport')).toBeInTheDocument()
    expect(screen.getByTestId('m2-drawing-svg')).toBeInTheDocument()
    expect(document.querySelectorAll('input[type="range"]')).toHaveLength(0)
    expect(document.querySelectorAll('input[type="number"]')).toHaveLength(0)
  })

  it('A03 + A04（选右孔右移 1 mm 保留视角与缩放；再移 1 mm 触发阻塞、证据定位、禁用保存、焦点落到撤销，撤销后恢复通过）', async () => {
    const user = userEvent.setup()
    let pushPreview: ((event: M2PreviewEvent) => void) | null = null
    const d1 = buildPlateDrawing('draft-1', 60)
    const d2 = buildPlateDrawing('draft-2', 61)
    const d3 = buildPlateDrawing('draft-3', 62)

    const sendM1ChatMessage = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        value: {
          messageId: 'msg-a03',
          reply: '已将右孔向右移 1 mm（X=61），边距范围 [13.75, 14.25] mm，通过。',
          draftRevision: 'draft-2',
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          messageId: 'msg-a04',
          reply: '右孔移至 X=62，边距范围 [12.75, 13.25] mm，最差低于要求 0.25 mm。',
          draftRevision: 'draft-3',
        },
      })

    const locateM2Evidence = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        requirementId: 'req-right-margin',
        checkId: 'chk-right-margin',
        anchors: [PLATE_REQUIREMENTS[0].anchor],
        featureIds: ['obj-right-hole', 'obj-right-face'],
        annotationIds: ['ann-right-margin'],
        inputs: [
          { name: '右孔 X', valueText: '62 ± 0.2 mm' },
          { name: '右孔直径', valueText: '10 ± 0.1 mm' },
        ],
        thresholdText: '剩余材料 ≥ 13.00 mm',
      },
    })

    const undoDraftChange = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        projectId: 'proj-plate-01',
        previousDraftRevision: 'draft-3',
        restoredDraftRevision: 'draft-2',
        summary: '已撤销 X=62 修改，恢复右孔至 X=61（边距 [13.75, 14.25] mm）',
        previewSnapshot: {
          currentRevision: 'draft-2',
          model: { status: 'ready', revision: 'draft-2', revisionOrder: 2, isDraft: true, fingerprint: 'fp-d2' },
          drawing: { status: 'ready', revision: 'draft-2', revisionOrder: 2, isDraft: true, fingerprint: 'fp-d2' },
          features: buildPlateFeatures(),
          annotations: d2.annotations,
          modelMesh: buildPlateMesh(61),
          drawingVector: d2.drawingVector,
          requirements: PLATE_REQUIREMENTS,
          checks: [buildMarginCheck(61, 'fp-d2'), buildCoverGapCheck('fp-d2')],
          checksInProgress: false,
        },
      },
    })

    const bridge: FullTestBridge = {
      testM1ModelApiConnection: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          availableModels: ['gpt-4.1'],
          selectedModel: 'gpt-4.1',
          toolCallSupported: true,
          toolRoundTripPassed: true,
        },
      }),
      sendM1ChatMessage,
      locateM2Evidence,
      undoDraftChange,
      subscribeM2PreviewEvents: async (_req, listener) => {
        pushPreview = listener
        return { ok: true, value: { subscriptionId: 'sub-a03-a04' } }
      },
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={true}
        initialBaseRevision="v1"
        initialDraftRevision="draft-1"
        initialViewMode="split"
        forceNarrowViewport={false}
        initialPreviewSnapshot={{
          currentRevision: 'draft-1',
          model: { status: 'ready', revision: 'draft-1', revisionOrder: 1, isDraft: true, fingerprint: 'fp-d1' },
          drawing: { status: 'ready', revision: 'draft-1', revisionOrder: 1, isDraft: true, fingerprint: 'fp-d1' },
          features: buildPlateFeatures(),
          annotations: d1.annotations,
          modelMesh: buildPlateMesh(60),
          drawingVector: d1.drawingVector,
          requirements: PLATE_REQUIREMENTS,
          checks: [buildMarginCheck(60), COVER_GAP_PASS_CHECK],
        }}
      />,
    )

    // 解锁内置对话
    await user.click(screen.getByRole('button', { name: /使用模型 API/ }))
    await user.type(screen.getByLabelText('密钥'), 'sk-a03')
    await user.click(screen.getByRole('button', { name: '测试连接' }))
    await user.click(await screen.findByRole('button', { name: '进入内置建模对话' }))

    // A03 Step 1: 3D 拾取右孔 -> 双向高亮 SVG 标注 ann-right-margin
    const threeViewport = screen.getByTestId('m2-three-viewport')
    const rightHoleTri = threeViewport.querySelector('polygon[data-triangle-index="0"]')
    expect(rightHoleTri).not.toBeNull()
    await user.click(rightHoleTri as Element)

    expect(screen.getByTestId('selection-breadcrumb')).toHaveTextContent('安装板 › 右孔 › 圆柱面')
    expect(
      screen.getByTestId('m2-drawing-svg').querySelector('g[data-svg-annotation-id="ann-right-margin"]'),
    ).toHaveAttribute('data-highlighted', 'true')

    // 调整 3D 视角与 2D 平移/缩放
    await user.click(screen.getByRole('button', { name: '右旋' }))
    await user.click(screen.getByRole('button', { name: '放大' }))
    const drawingSvg = screen.getByTestId('m2-drawing-svg')
    fireEvent.mouseDown(drawingSvg, { button: 0, clientX: 50, clientY: 50 })
    fireEvent.mouseMove(drawingSvg, { clientX: 90, clientY: 70 })
    fireEvent.mouseUp(drawingSvg)
    await user.click(screen.getByRole('button', { name: '图纸放大' }))

    const camBefore = screen.getByLabelText('模型视角状态').textContent
    const drawBefore = screen.getByLabelText('图纸缩放状态').textContent
    expect(camBefore).toContain('视角 50°/25° · 缩放 120%')
    expect(drawBefore).toContain('图纸缩放 125% · 平移 (20, 10)')

    // 带入下一句话并发送“向右移 1 mm”
    await user.click(screen.getByRole('button', { name: '带入下一句话' }))
    await user.type(screen.getByLabelText('内置对话输入框'), '向右移 1 mm')
    await user.click(screen.getByRole('button', { name: '发送' }))
    expect(sendM1ChatMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        selectedObject: 'obj-right-hole',
        prompt: expect.stringContaining('向右移 1 mm'),
      }),
    )

    // 推送 draft-2 预览刷新 -> 保留 3D 视角与 2D 平移/缩放，边距更新为 14.0 mm
    act(() => {
      pushPreview?.({
        projectId: 'proj-plate-01',
        sequence: 10,
        revision: 'draft-2',
        revisionOrder: 2,
        isDraft: true,
        fingerprint: 'fp-d2',
        type: 'model_ready',
        modelMesh: buildPlateMesh(61),
      })
      pushPreview?.({
        projectId: 'proj-plate-01',
        sequence: 11,
        revision: 'draft-2',
        revisionOrder: 2,
        isDraft: true,
        fingerprint: 'fp-d2',
        type: 'drawing_ready',
        drawingVector: d2.drawingVector,
        annotations: d2.annotations,
      })
      pushPreview?.({
        projectId: 'proj-plate-01',
        sequence: 12,
        revision: 'draft-2',
        revisionOrder: 2,
        isDraft: true,
        fingerprint: 'fp-d2',
        type: 'checks_updated',
        checksInProgress: false,
        checks: [buildMarginCheck(61), COVER_GAP_PASS_CHECK],
      })
    })

    expect(screen.getByLabelText('模型视角状态')).toHaveTextContent('视角 50°/25° · 缩放 120%')
    expect(screen.getByLabelText('图纸缩放状态')).toHaveTextContent('图纸缩放 125% · 平移 (20, 10)')
    expect(within(screen.getByTestId('m2-drawing-svg')).getByText(/14\.0 mm/)).toBeInTheDocument()

    // A04: 再次右移 1 mm (X=62) -> 边距 [12.75, 13.25] mm 低于要求 0.25 mm -> 阻塞正式保存
    await user.type(screen.getByLabelText('内置对话输入框'), '再向右移 1 mm')
    await user.click(screen.getByRole('button', { name: '发送' }))

    act(() => {
      pushPreview?.({
        projectId: 'proj-plate-01',
        sequence: 20,
        revision: 'draft-3',
        revisionOrder: 3,
        isDraft: true,
        fingerprint: 'fp-d3',
        type: 'model_ready',
        modelMesh: buildPlateMesh(62),
      })
      pushPreview?.({
        projectId: 'proj-plate-01',
        sequence: 21,
        revision: 'draft-3',
        revisionOrder: 3,
        isDraft: true,
        fingerprint: 'fp-d3',
        type: 'drawing_ready',
        drawingVector: d3.drawingVector,
        annotations: d3.annotations,
      })
      pushPreview?.({
        projectId: 'proj-plate-01',
        sequence: 22,
        revision: 'draft-3',
        revisionOrder: 3,
        isDraft: true,
        fingerprint: 'fp-d3',
        type: 'checks_updated',
        checksInProgress: false,
        checks: [buildMarginCheck(62), COVER_GAP_PASS_CHECK],
      })
    })

    // 打开完成视图：正式保存禁用、焦点落到撤销按钮、可调用 locateM2Evidence 定位条款与右孔
    const completionToggle = screen.getByRole('button', { name: '保存此版本 / 完成视图' })
    await user.click(completionToggle)

    const completionView = screen.getByTestId('completion-view')
    expect(within(completionView).getByRole('button', { name: '保存正式版本' })).toBeDisabled()
    expect(
      within(within(completionView).getByLabelText('阻塞条款与关联特征列表')).getByText(
        /最差低于要求 0\.25 mm/,
      ),
    ).toBeInTheDocument()

    const undoBtn = within(completionView).getByRole('button', { name: '撤销本次被阻塞修改' })
    expect(document.activeElement).toBe(undoBtn)

    // 定位阻塞条款来源与右孔特征
    await user.click(within(completionView).getByRole('button', { name: '定位来源与特征' }))
    expect(locateM2Evidence).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.objectContaining({ checkId: 'chk-right-margin' }),
      }),
    )
    expect(await screen.findByText(/阈值要求：剩余材料 ≥ 13\.00 mm/)).toBeInTheDocument()

    // 撤销恢复通过，正式版保持 v1，保存正式版本恢复可用
    await user.click(undoBtn)
    expect(undoDraftChange).toHaveBeenCalledTimes(1)
    expect(await within(completionView).findByText(/当前所有条款均已通过/)).toBeInTheDocument()
    expect(within(completionView).getByRole('button', { name: '保存正式版本' })).not.toBeDisabled()
    expect(screen.getByLabelText('顶部连接状态栏')).toHaveTextContent('正式版 v1 · 草稿 draft-2')
  })

  it('A05 + A06（三维变化旋转 90° 与固定姿态接触/重叠检查 + 非当前前台项目外部修改无打断通知）', async () => {
    let pushExternalProjectEvent: ((event: M3ExternalProjectEvent) => void) | null = null
    const bridge: FullTestBridge = {
      subscribeM3ExternalProjectEvents: async (listener) => {
        pushExternalProjectEvent = listener
        return { ok: true, value: { subscriptionId: 'sub-a05-a06' } }
      },
    }

    const a05a06Checks: readonly M2CheckItem[] = [
      COVER_GAP_PASS_CHECK,
      {
        checkId: 'chk-a06-contact',
        requirementId: 'req-cover-gap',
        title: '固定姿态 Z=8 接触检查',
        required: false,
        status: 'needsClarification',
        summary: '盖板底面 Z=8 mm：检测到面接触（间隙 0.0 mm）',
        linkedFeatureIds: ['obj-cover-gap'],
        linkedAnnotationIds: [],
      },
      {
        checkId: 'chk-a06-overlap',
        requirementId: 'req-cover-gap',
        title: '固定姿态 Z=7.9 重叠干涉检查',
        required: true,
        status: 'fail',
        summary: '盖板底面 Z=7.9 mm：检测到实体重叠，轴向重叠深度 0.1 mm',
        linkedFeatureIds: ['obj-cover-gap'],
        linkedAnnotationIds: [],
      },
    ]

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={false}
        initialSidebarSection="checks"
        initialProjectId="proj-plate-01"
        initialProjectName="安装板项目"
        initialDraftRevision="draft-5"
        initialPreviewSnapshot={{
          currentRevision: 'draft-5',
          model: { status: 'ready', revision: 'draft-5', revisionOrder: 5, isDraft: true, fingerprint: 'fp-5' },
          drawing: { status: 'ready', revision: 'draft-5', revisionOrder: 5, isDraft: true, fingerprint: 'fp-5' },
          checks: a05a06Checks,
        }}
      />,
    )

    // 验证 A05 3D 变化（2 mm / [1.7, 2.3] mm）与 A06 接触/重叠（0.1 mm）分开报告
    const checksPanel = screen.getByLabelText('检查结果面板')
    expect(within(checksPanel).getByText(/名义间隙 2 mm，范围 \[1\.7, 2\.3\] mm/)).toBeInTheDocument()
    expect(within(checksPanel).getByText(/检测到面接触/)).toBeInTheDocument()
    expect(within(checksPanel).getByText(/轴向重叠深度 0\.1 mm/)).toBeInTheDocument()

    // 推送非当前前台项目（proj-cover-02）的外部修改通知 -> 不打断当前安装板工作台，展示「打开查看」通知
    act(() => {
      pushExternalProjectEvent?.({
        eventId: 'ext-ev-1',
        projectId: 'proj-cover-02',
        projectName: '参考盖板独立项目',
        draftRevision: 'draft-9',
        revisionOrder: 9,
        sequence: 1,
        summary: '外部 Agent 已更新盖板厚度与倒角',
      })
    })

    const notice = screen.getByRole('status', { name: '外部项目修改结果通知' })
    expect(within(notice).getByText('参考盖板独立项目')).toBeInTheDocument()
    expect(within(notice).getByRole('button', { name: '打开查看' })).toBeInTheDocument()
    // 前台项目保持 proj-plate-01 未被打断
    expect(screen.getByLabelText('顶部连接状态栏')).toHaveTextContent('proj-plate-01')
  })

  it('A07（缺项/冲突/未覆盖任务澄清 + 断线保留结果、焦点落到「重连」、接管推进代际拒绝旧包）', async () => {
    const user = userEvent.setup()
    let pushM1Event: ((event: M1WorkbenchIncomingEvent) => void) | null = null
    const submitM2Clarification = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        message: '已记录厚度以第 1 页 8 mm 为准，正在重算条款',
        updatedInterpretation: '以第 1 页厚度 8 mm 为准',
        nextRevision: 'draft-6',
      },
    })
    const takeoverM1Draft = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        projectId: 'proj-plate-01',
        draftRevision: 'draft-5',
        scopeEpoch: 2,
        writerEpoch: 2,
        writerOwner: 'local-agent:new-session',
      },
    })

    const bridge: FullTestBridge = {
      subscribeM1WorkbenchEvents: async (_req, listener) => {
        pushM1Event = listener
        return { ok: true, value: { subscriptionId: 'sub-a07' } }
      },
      submitM2Clarification,
      takeoverM1Draft,
    }

    const a07Requirements: readonly M2RequirementItem[] = [
      {
        requirementId: 'req-missing-datum',
        title: '左孔中心基准',
        interpretation: '缺少孔中心基准定义',
        required: true,
        status: 'needsClarification',
        clarificationReason: 'missing',
        clarificationPrompt: '请确认左孔中心基准是否以左下底角为原点。',
        anchor: PLATE_REQUIREMENTS[0].anchor,
        linkedFeatureIds: ['obj-left-hole'],
        linkedAnnotationIds: [],
      },
      {
        requirementId: 'req-conflict-thick',
        title: '安装板厚度',
        interpretation: '第 1 页标示 8 mm，第 3 页标示 10 mm',
        required: true,
        status: 'conflict',
        clarificationReason: 'conflict',
        clarificationPrompt: '检测到两个矛盾厚度，请确认采用哪一页。',
        anchor: PLATE_REQUIREMENTS[0].anchor,
        linkedFeatureIds: [],
        linkedAnnotationIds: [],
      },
      {
        requirementId: 'req-uncovered-gdt',
        title: '平面度形位公差 0.05',
        interpretation: '完整形位公差暂超出首轮求解域',
        required: false,
        status: 'uncovered',
        anchor: PLATE_REQUIREMENTS[0].anchor,
        linkedFeatureIds: [],
        linkedAnnotationIds: [],
      },
    ]

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={false}
        initialSidebarSection="requirements"
        initialDraftRevision="draft-5"
        initialConnectionSnapshot={{
          connectionState: 'connected',
          source: 'local-agent',
          clientName: 'Claude Desktop',
          authorizationState: 'authorized-writable',
          writerEpoch: 1,
        }}
        initialPreviewSnapshot={{
          currentRevision: 'draft-5',
          model: { status: 'ready', revision: 'draft-5', revisionOrder: 5, isDraft: true, fingerprint: 'fp-5' },
          drawing: { status: 'ready', revision: 'draft-5', revisionOrder: 5, isDraft: true, fingerprint: 'fp-5' },
          requirements: a07Requirements,
        }}
      />,
    )

    // 1. 缺项、冲突、未覆盖三类问题分别呈现，提交澄清后保存回答
    const reqPanel = screen.getByLabelText('要求列表面板')
    expect(within(reqPanel).getByText(/信息缺失/)).toBeInTheDocument()
    expect(within(reqPanel).getByText(/来源冲突/)).toBeInTheDocument()
    expect(within(reqPanel).getByText(/○ 未覆盖/)).toBeInTheDocument()

    const conflictInput = within(reqPanel).getByLabelText('回答或纠正 安装板厚度')
    await user.type(conflictInput, '以第 1 页厚度 8 mm 为准')
    const conflictCard = conflictInput.closest('li') as HTMLElement
    await user.click(within(conflictCard).getByRole('button', { name: '提交回答' }))
    expect(submitM2Clarification).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/已记录厚度以第 1 页 8 mm 为准/)).toBeInTheDocument()

    // 失焦输入控件后触发断线 -> 保留当前草稿结果且焦点落到「重连」按钮
    ;(document.activeElement as HTMLElement | null)?.blur()
    act(() => {
      pushM1Event?.({
        projectId: 'proj-plate-01',
        scopeEpoch: 1,
        writerEpoch: 1,
        sequence: 10,
        type: 'connection_changed',
        connectionState: 'disconnected',
      })
    })

    const reconnectBtn = screen.getByRole('button', { name: '重连' })
    expect(document.activeElement).toBe(reconnectBtn)
    expect(screen.getByLabelText('顶部连接状态栏')).toHaveTextContent('草稿 draft-5')

    // 点击接管推进代际（scopeEpoch=2, writerEpoch=2），旧代际迟到包被丢弃
    await user.click(screen.getByRole('button', { name: '接管当前草稿' }))
    expect(takeoverM1Draft).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/已接管当前草稿（代际 #2 · 写入代际 #2）/)).toBeInTheDocument()

    act(() => {
      pushM1Event?.({
        projectId: 'proj-plate-01',
        scopeEpoch: 1,
        writerEpoch: 1,
        sequence: 11,
        type: 'draft_updated',
        draftRevision: 'draft-stale-old',
      })
    })
    expect(screen.getByLabelText('顶部连接状态栏')).toHaveTextContent('草稿 draft-5')
    expect(screen.getByText(/已丢弃来自旧代际\/先前客户端的迟到响应或事件/)).toBeInTheDocument()
  })

  it('A08（慢图纸、快模型、乱序与图纸失败 → 标明旧图版本、焦点落到「重试图纸」、重试后同版并排且不污染水位）', async () => {
    const user = userEvent.setup()
    let pushPreview: ((event: M2PreviewEvent) => void) | null = null
    const d7 = buildPlateDrawing('draft-7', 60)
    const d8 = buildPlateDrawing('draft-8', 61)

    const retryM2Drawing = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        projectId: 'proj-plate-01',
        revision: 'draft-8',
        revisionOrder: 8,
        fingerprint: 'fp-d8',
        drawingVector: d8.drawingVector,
        annotations: d8.annotations,
      },
    })

    const bridge: FullTestBridge = {
      subscribeM2PreviewEvents: async (_req, listener) => {
        pushPreview = listener
        return { ok: true, value: { subscriptionId: 'sub-a08' } }
      },
      retryM2Drawing,
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={false}
        initialDraftRevision="draft-7"
        initialViewMode="split"
        forceNarrowViewport={false}
        initialPreviewSnapshot={{
          currentRevision: 'draft-7',
          model: { status: 'ready', revision: 'draft-7', revisionOrder: 7, isDraft: true, fingerprint: 'fp-d7' },
          drawing: { status: 'ready', revision: 'draft-7', revisionOrder: 7, isDraft: true, fingerprint: 'fp-d7' },
          features: buildPlateFeatures(),
          annotations: d7.annotations,
          modelMesh: buildPlateMesh(60),
          drawingVector: d7.drawingVector,
        }}
      />,
    )

    // 快模型 draft-8 到达 + 乱序迟到 draft-6 到达 + draft-8 图纸失败
    act(() => {
      pushPreview?.({
        projectId: 'proj-plate-01',
        sequence: 30,
        revision: 'draft-8',
        revisionOrder: 8,
        isDraft: true,
        fingerprint: 'fp-d8',
        type: 'model_ready',
        modelMesh: buildPlateMesh(61),
      })
      pushPreview?.({
        projectId: 'proj-plate-01',
        sequence: 25,
        revision: 'draft-6',
        revisionOrder: 6,
        isDraft: true,
        fingerprint: 'fp-d6',
        type: 'drawing_ready',
      })
      pushPreview?.({
        projectId: 'proj-plate-01',
        sequence: 31,
        revision: 'draft-8',
        revisionOrder: 8,
        isDraft: true,
        type: 'drawing_failed',
        errorReason: '草稿 8 投影超时',
      })
    })

    // 明确标明旧图版本（草稿 7），焦点自动落到「重试图纸」按钮
    expect(screen.getByTestId('m2-drawing-fallback-badge')).toHaveTextContent(
      '旧图回退：保留 草稿 7 矢量与标注',
    )
    const retryBtn = screen.getByRole('button', { name: '重试图纸' })
    expect(document.activeElement).toBe(retryBtn)

    // 点击重试图纸 -> 同版 draft-8 并排就绪，且旧图回退标记消失
    await user.click(retryBtn)
    expect(retryM2Drawing).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/草稿 8 图纸重试成功/)).toBeInTheDocument()
    expect(screen.queryByTestId('m2-drawing-fallback-badge')).not.toBeInTheDocument()
    expect(screen.getByLabelText('同版对齐标识')).toHaveTextContent('✓ 同版就绪')
    expect(screen.getByLabelText('中央画布')).toHaveAttribute('data-effective-view', 'split')
  })

  it('A09 + A10（关闭重开恢复版本/图纸/检查/连接方式 + 旧 .cunlian 隔套迁移差异与 12.00/12.04/12.10/12.05 回归）', async () => {
    const user = userEvent.setup()
    const d2 = buildPlateDrawing('draft-2', 61)

    // A09: 模拟关闭前状态 -> unmount -> 重开恢复正式版、草稿、图纸、检查与连接方式
    const persistedProps = {
      bridge: {} as FullTestBridge,
      initialShowOnboarding: false,
      initialBaseRevision: 'v1',
      initialDraftRevision: 'draft-2',
      initialSidebarSection: 'history' as const,
      initialConnectionSnapshot: {
        connectionState: 'connected' as const,
        source: 'local-agent' as const,
        clientName: 'Claude Desktop',
        authorizationState: 'authorized-writable' as const,
        writerEpoch: 3,
      },
      initialRestoreStatus: {
        restoredFromDisk: true,
        restoredAtLabel: '重开自动恢复',
        baseRevision: 'v1',
        draftRevision: 'draft-2',
        restoredSourceCount: 2,
        viewsConsistentWithSnapshot: true,
        summary: '已恢复正式版 v1、草稿 draft-2、矢量图纸、检查与本地 Agent 连接方式',
      },
      initialPreviewSnapshot: {
        currentRevision: 'draft-2',
        model: { status: 'ready' as const, revision: 'draft-2', revisionOrder: 2, isDraft: true, fingerprint: 'fp-d2' },
        drawing: { status: 'ready' as const, revision: 'draft-2', revisionOrder: 2, isDraft: true, fingerprint: 'fp-d2' },
        features: buildPlateFeatures(),
        annotations: d2.annotations,
        modelMesh: buildPlateMesh(61),
        drawingVector: d2.drawingVector,
        checks: [buildMarginCheck(61), COVER_GAP_PASS_CHECK],
      },
    }

    const firstMount = render(<ProjectAgentM1Workbench {...persistedProps} />)
    firstMount.unmount()

    const reopened = render(<ProjectAgentM1Workbench {...persistedProps} />)
    expect(screen.getByLabelText('顶部连接状态栏')).toHaveTextContent('正式版 v1 · 草稿 draft-2')
    expect(screen.getByLabelText('当前连接来源')).toHaveTextContent('本地 Agent · Claude Desktop')
    expect(screen.getByLabelText('重开项目恢复状态')).toHaveTextContent('✓ 视图与提交快照一致')
    expect(screen.getByTestId('m2-drawing-svg')).toBeInTheDocument()
    reopened.unmount()

    // A10: 打开旧 .cunlian 隔套项目迁移差异提示与 12.00 / 12.04 / 12.10 / 12.05 一维尺寸链回归
    const spacerMigrationReport: M3MigrationReport = {
      projectId: 'sample-spacer-01',
      sourceFormat: '.cunlian v0.4 隔套项目',
      originalFilePreserved: true,
      originalFilePath: '/Users/designer/spacer-legacy.cunlian',
      unexplainedLegacyFields: [
        {
          fieldPath: 'legacy.customNote',
          rawValueSummary: '"热处理后复测"',
          reason: '旧版自定义备注字段已保留在原件中',
          preservedInOriginal: true,
        },
      ],
      restrictedOperations: [
        {
          operation: '原生 DWG 导出',
          reason: '旧隔套格式暂仅开放既有 SVG/PDF 导出',
          workaround: '可使用内置矢量图纸查看',
        },
      ],
      legacyChainCompatibility: {
        compatible: true,
        summary: '一维尺寸链 4 组既有样例结论与旧版完全一致',
        samples: [
          { label: '样例 1', lengthMm: '12.00 mm', verdict: 'pass' },
          { label: '样例 2', lengthMm: '12.04 mm', verdict: 'pass' },
          { label: '样例 3', lengthMm: '12.10 mm', verdict: 'fail' },
          { label: '样例 4', lengthMm: '12.05 mm', verdict: 'boundary_pass' },
        ],
      },
    }

    render(
      <ProjectAgentM1Workbench
        bridge={{}}
        initialShowOnboarding={false}
        initialProjectId="sample-spacer-01"
        initialProjectName="隔套兼容示例"
        initialBaseRevision="v3"
        initialDraftRevision="draft-spacer-1"
        initialMigrationReport={spacerMigrationReport}
      />,
    )

    const banner = screen.getByTestId('migration-banner')
    expect(banner).toHaveTextContent('✓ 原件已保留')
    expect(banner).toHaveTextContent('✓ 既有尺寸链兼容')

    await user.click(within(banner).getByRole('button', { name: '查看迁移差异详情' }))
    const sampleList = screen.getByLabelText('隔套一维尺寸链回归样例')
    expect(within(sampleList).getByText(/12\.00 mm/)).toBeInTheDocument()
    expect(within(sampleList).getByText(/12\.04 mm/)).toBeInTheDocument()
    expect(within(sampleList).getByText(/12\.10 mm/)).toBeInTheDocument()
    expect(within(sampleList).getByText(/12\.05 mm/)).toBeInTheDocument()
    expect(within(sampleList).getByText('✓ 边界通过')).toBeInTheDocument()
  })

  it('A11（生成中触发“完成”展示实时进度，就绪后经绑定一次性确认完成 commitM3ApprovedDraft 正式提交）', async () => {
    const user = userEvent.setup()
    let pushPreview: ((event: M2PreviewEvent) => void) | null = null
    const d2 = buildPlateDrawing('draft-2', 61)

    const commitM3ApprovedDraft = vi.fn().mockImplementation(async (req) => ({
      ok: true,
      value: {
        projectId: req.projectId,
        previousBaseRevision: req.baseRevision,
        committedRevision: 'v2',
        committedDraftRevision: req.draftRevision,
        nextDraftRevision: null,
        checkSetFingerprint: req.checkSetFingerprint,
        summary: '安装板草稿 2 经一次性人工确认正式提交为 v2',
      },
    }))

    const bridge: FullTestBridge = {
      testM1ModelApiConnection: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          availableModels: ['gpt-4.1'],
          selectedModel: 'gpt-4.1',
          toolCallSupported: true,
          toolRoundTripPassed: true,
        },
      }),
      sendM1ChatMessage: vi.fn(),
      subscribeM2PreviewEvents: async (_req, listener) => {
        pushPreview = listener
        return { ok: true, value: { subscriptionId: 'sub-a11' } }
      },
      commitM3ApprovedDraft,
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={true}
        initialBaseRevision="v1"
        initialDraftRevision="draft-2"
        initialPreviewSnapshot={{
          currentRevision: 'draft-2',
          model: { status: 'ready', revision: 'draft-2', revisionOrder: 2, isDraft: true, fingerprint: 'fp-d2' },
          drawing: { status: 'building', revision: 'draft-2', revisionOrder: 2, isDraft: true, fingerprint: null },
          features: buildPlateFeatures(),
          requirements: PLATE_REQUIREMENTS,
          checks: [buildMarginCheck(61), COVER_GAP_PASS_CHECK],
          checksInProgress: true,
        }}
      />,
    )

    // 解锁内置对话，在图纸仍在生成中时说“完成”
    await user.click(screen.getByRole('button', { name: /使用模型 API/ }))
    await user.type(screen.getByLabelText('密钥'), 'sk-a11')
    await user.click(screen.getByRole('button', { name: '测试连接' }))
    await user.click(await screen.findByRole('button', { name: '进入内置建模对话' }))

    await user.type(screen.getByLabelText('内置对话输入框'), '完成')
    await user.click(screen.getByRole('button', { name: '发送' }))

    // 完成意图仅调起完成视图并展示实时进度，绝不绕过人工确认直接提交
    const completionView = screen.getByTestId('completion-view')
    expect(within(completionView).getByLabelText('完成视图生成实时进度')).toBeInTheDocument()
    expect(within(completionView).getByRole('button', { name: '保存正式版本' })).toBeDisabled()
    expect(commitM3ApprovedDraft).not.toHaveBeenCalled()

    // 同版图纸就绪且检查完成 -> 启用「保存正式版本」-> 绑定一次性确认 -> 正式提交为 v2
    act(() => {
      pushPreview?.({
        projectId: 'proj-plate-01',
        sequence: 40,
        revision: 'draft-2',
        revisionOrder: 2,
        isDraft: true,
        fingerprint: 'fp-d2',
        type: 'drawing_ready',
        drawingVector: d2.drawingVector,
        annotations: d2.annotations,
      })
      pushPreview?.({
        projectId: 'proj-plate-01',
        sequence: 41,
        revision: 'draft-2',
        revisionOrder: 2,
        isDraft: true,
        fingerprint: 'fp-d2',
        type: 'checks_updated',
        checksInProgress: false,
        checks: [buildMarginCheck(61, 'fp-d2'), buildCoverGapCheck('fp-d2')],
      })
    })

    const saveFormalBtn = within(completionView).getByRole('button', { name: '保存正式版本' })
    expect(saveFormalBtn).not.toBeDisabled()
    await user.click(saveFormalBtn)

    const confirmBox = within(completionView).getByLabelText('一次性人工确认提交步骤')
    await user.click(within(confirmBox).getByRole('button', { name: '确认提交正式版本' }))

    expect(commitM3ApprovedDraft).toHaveBeenCalledTimes(1)
    expect(commitM3ApprovedDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj-plate-01',
        baseRevision: 'v1',
        draftRevision: 'draft-2',
        confirmationToken: expect.any(String),
        checkSetFingerprint: expect.any(String),
      }),
    )
    expect(await screen.findByText(/已正式保存版本.*v2/)).toBeInTheDocument()
    expect(screen.getByLabelText('顶部连接状态栏')).toHaveTextContent('正式版 v2')
  })

  it('A12（删孔新建同径孔不同 objectId 触发选中对象失效提示，不静默改绑）', async () => {
    const user = userEvent.setup()
    let pushPreview: ((event: M2PreviewEvent) => void) | null = null
    const d1 = buildPlateDrawing('draft-1', 60, 'obj-right-hole')
    const d2Replaced = buildPlateDrawing('draft-2', 60, 'obj-right-hole-v2')

    const bridge: FullTestBridge = {
      subscribeM2PreviewEvents: async (_req, listener) => {
        pushPreview = listener
        return { ok: true, value: { subscriptionId: 'sub-a12' } }
      },
    }

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={false}
        initialDraftRevision="draft-1"
        initialViewMode="split"
        forceNarrowViewport={false}
        initialPreviewSnapshot={{
          currentRevision: 'draft-1',
          model: { status: 'ready', revision: 'draft-1', revisionOrder: 1, isDraft: true, fingerprint: 'fp-1' },
          drawing: { status: 'ready', revision: 'draft-1', revisionOrder: 1, isDraft: true, fingerprint: 'fp-1' },
          features: buildPlateFeatures('obj-right-hole'),
          annotations: d1.annotations,
          modelMesh: buildPlateMesh(60, 'obj-right-hole'),
          drawingVector: d1.drawingVector,
        }}
      />,
    )

    // 先选中原右孔（obj-right-hole）
    const objectList = screen.getByLabelText('对象列表')
    await user.click(within(objectList).getByRole('button', { name: '安装板 › 右孔 › 圆柱面' }))
    expect(screen.getByTestId('selection-breadcrumb')).toHaveTextContent('安装板 › 右孔 › 圆柱面')

    // 推送删除原右孔并新建同径孔（objectId 变为 obj-right-hole-v2）的修订
    act(() => {
      pushPreview?.({
        projectId: 'proj-plate-01',
        sequence: 50,
        revision: 'draft-2',
        revisionOrder: 2,
        isDraft: true,
        fingerprint: 'fp-2',
        type: 'model_ready',
        features: buildPlateFeatures('obj-right-hole-v2'),
        modelMesh: buildPlateMesh(60, 'obj-right-hole-v2'),
      })
      pushPreview?.({
        projectId: 'proj-plate-01',
        sequence: 51,
        revision: 'draft-2',
        revisionOrder: 2,
        isDraft: true,
        fingerprint: 'fp-2',
        type: 'drawing_ready',
        drawingVector: d2Replaced.drawingVector,
        annotations: d2Replaced.annotations,
      })
    })

    // 明确触发失效提示，且不静默改绑到 obj-right-hole-v2
    const staleAlert = screen.getByRole('alert', { name: '选中对象失效提示' })
    expect(staleAlert).toHaveTextContent('选中对象已失效，请重新选择或重绑')
    expect(staleAlert).toHaveTextContent('安装板 › 右孔 › 圆柱面')
    expect(screen.queryByTestId('selection-breadcrumb')).not.toBeInTheDocument()
    expect(screen.getByText('未选中任何几何对象')).toBeInTheDocument()
  })
})
