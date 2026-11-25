// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ProjectAgentM1Workbench } from './ProjectAgentM1Workbench'
import {
  applyM2DrawingRetryResult,
  createInitialM2CanvasState,
  DEFAULT_M2_ANNOTATIONS,
  DEFAULT_M2_FEATURES,
  normalizeM2DrawingVector,
  normalizeM2ModelMesh,
  reduceM2PreviewEvent,
  resolveMeshTrianglePick,
  type M2BackendCompositeMesh,
  type M2BackendDrawing,
  type M2DrawingAnnotationItem,
  type M2DrawingVector,
  type M2MeshTriangleRange,
  type M2ModelMesh,
  type M2PreviewEvent,
  type M2WorkbenchBridge,
} from './m2WorkbenchBridge'

const SAMPLE_MODEL_MESH: M2ModelMesh = {
  frameId: 'plate-local',
  // Two triangles for right-hole (0..2), two for left-hole (2..4), two for right-face (4..6)
  positions: [
    // Right hole quad
    55, 20, 0, 65, 20, 0, 65, 30, 8, 55, 30, 8,
    // Left hole quad
    15, 20, 0, 25, 20, 0, 25, 30, 8, 15, 30, 8,
    // Right face quad
    80, 0, 0, 80, 50, 0, 80, 50, 8, 80, 0, 8,
  ],
  indices: [
    0, 1, 2, 0, 2, 3,
    4, 5, 6, 4, 6, 7,
    8, 9, 10, 8, 10, 11,
  ],
  triangleRanges: [
    {
      startTriangle: 0,
      endTriangle: 2,
      objectId: 'obj-right-hole',
      featureRef: 'plate/right-hole/cylinder',
      role: 'hole.right.axis',
    },
    {
      startTriangle: 2,
      endTriangle: 4,
      objectId: 'obj-left-hole',
      featureRef: 'plate/left-hole/cylinder',
      role: 'hole.left.axis',
    },
    {
      startTriangle: 4,
      endTriangle: 6,
      objectId: 'obj-right-face',
      featureRef: 'plate/right-end-face',
      role: 'plate.rightFace',
    },
  ],
  bounds: { min: [0, 0, 0], max: [80, 50, 8] },
}

const SAMPLE_BACKEND_DRAWING_DRAFT7: M2BackendDrawing = {
  unit: 'mm',
  revision: 'draft-7',
  displayDecimals: 1,
  convention: 'local orthographic, +Y viewing direction for front, -Z for top, -X for right side',
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
        { kind: 'line', style: 'hidden', points: [[55, 0], [55, 8]] },
        { kind: 'line', style: 'hidden', points: [[65, 0], [65, 8]] },
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
        { kind: 'circle', center: [60, 25], radius: 5 },
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
      witnesses: [[55, 25], [65, 25]],
      reference: { role: 'hole.right.axis', featureId: 'obj-right-hole' },
    },
    {
      id: 'ann-hole-pitch',
      view: 'top',
      side: 'below',
      lane: 0,
      valueMm: 40,
      witnesses: [[20, 25], [60, 25]],
      reference: { role: 'hole.left.axis', featureId: 'obj-left-hole' },
    },
  ],
}

const SAMPLE_CANONICAL_DRAWING_DRAFT8: M2DrawingVector = {
  unit: 'mm',
  revision: 'draft-8',
  views: [
    {
      id: 'front',
      size: [84, 8],
      lines: [
        { x1: 0, y1: 0, x2: 84, y2: 0 },
        { x1: 84, y1: 0, x2: 84, y2: 8 },
        { x1: 84, y1: 8, x2: 0, y2: 8 },
        { x1: 0, y1: 8, x2: 0, y2: 0 },
      ],
      circles: [],
      hiddenLines: [
        { x1: 15, y1: 0, x2: 15, y2: 8 },
        { x1: 25, y1: 0, x2: 25, y2: 8 },
      ],
    },
    {
      id: 'top',
      size: [84, 50],
      lines: [
        { x1: 0, y1: 0, x2: 84, y2: 0 },
        { x1: 84, y1: 0, x2: 84, y2: 50 },
        { x1: 84, y1: 50, x2: 0, y2: 50 },
        { x1: 0, y1: 50, x2: 0, y2: 0 },
      ],
      circles: [
        { cx: 20, cy: 25, r: 5 },
        { cx: 64, cy: 25, r: 5 },
      ],
      hiddenLines: [],
    },
    {
      id: 'side',
      size: [50, 8],
      lines: [
        { x1: 0, y1: 0, x2: 50, y2: 0 },
        { x1: 50, y1: 0, x2: 50, y2: 8 },
        { x1: 50, y1: 8, x2: 0, y2: 8 },
        { x1: 0, y1: 8, x2: 0, y2: 0 },
      ],
      circles: [],
      hiddenLines: [{ x1: 20, y1: 0, x2: 20, y2: 8 }],
    },
  ],
}

describe('M2-FE-02 纯函数：3D 三角形拾取映射与后端数据规范化适配', () => {
  it('resolveMeshTrianglePick 正确处理多段边界、越界、空范围与无效索引', () => {
    const ranges: readonly M2MeshTriangleRange[] = [
      { startTriangle: 0, endTriangle: 4, objectId: 'obj-plate', role: 'plate.body' },
      { startTriangle: 4, endTriangle: 10, objectId: 'obj-left-hole', role: 'hole.left.axis' },
      { startTriangle: 10, endTriangle: 10, objectId: 'obj-degenerate' },
      { startTriangle: 10, endTriangle: 14, objectId: 'obj-right-hole', role: 'hole.right.axis' },
    ]

    // 边界命中（左闭右开 [startTriangle, endTriangle)）
    expect(resolveMeshTrianglePick(0, ranges)?.objectId).toBe('obj-plate')
    expect(resolveMeshTrianglePick(3, ranges)?.objectId).toBe('obj-plate')
    expect(resolveMeshTrianglePick(4, ranges)?.objectId).toBe('obj-left-hole')
    expect(resolveMeshTrianglePick(9, ranges)?.objectId).toBe('obj-left-hole')
    expect(resolveMeshTrianglePick(10, ranges)?.objectId).toBe('obj-right-hole')
    expect(resolveMeshTrianglePick(13, ranges)?.objectId).toBe('obj-right-hole')

    // 越界与无效索引
    expect(resolveMeshTrianglePick(-1, ranges)).toBeNull()
    expect(resolveMeshTrianglePick(14, ranges)).toBeNull()
    expect(resolveMeshTrianglePick(999, ranges)).toBeNull()
    expect(resolveMeshTrianglePick(Number.NaN, ranges)).toBeNull()
    expect(resolveMeshTrianglePick(2.5, ranges)).toBeNull()

    // 空范围
    expect(resolveMeshTrianglePick(0, [])).toBeNull()
    expect(resolveMeshTrianglePick(0, null)).toBeNull()
    expect(resolveMeshTrianglePick(0, undefined)).toBeNull()
  })

  it('normalizeM2ModelMesh 精确兼容后端 M2-BE-01 复合网格 { plate, cover } 与 objects 映射', () => {
    const backendComposite: M2BackendCompositeMesh = {
      plate: {
        frameId: 'plate-frame',
        positions: [
          [0, 0, 0],
          [80, 0, 0],
          [80, 50, 8],
        ],
        triangles: [[0, 1, 2]],
        objects: [
          { featureId: 'obj-right-face', role: 'plate.rightFace', firstTriangle: 0, triangleCount: 1 },
        ],
      },
      cover: {
        frameId: 'cover-frame',
        positions: [
          [0, 0, 10],
          [80, 0, 10],
          [80, 50, 14],
        ],
        triangles: [[0, 1, 2]],
        objects: [
          { featureId: 'obj-cover-gap', role: 'cover.bottomFace', firstTriangle: 0, triangleCount: 1 },
        ],
      },
    }

    const normalized = normalizeM2ModelMesh(backendComposite)
    expect(normalized).not.toBeNull()
    expect(normalized?.positions).toHaveLength(18)
    expect(Array.from(normalized?.indices ?? [])).toEqual([0, 1, 2, 3, 4, 5])
    expect(normalized?.bounds).toEqual({ min: [0, 0, 0], max: [80, 50, 14] })
    expect(resolveMeshTrianglePick(0, normalized?.triangleRanges)?.objectId).toBe('obj-right-face')
    expect(resolveMeshTrianglePick(1, normalized?.triangleRanges)?.objectId).toBe('obj-cover-gap')
    expect(resolveMeshTrianglePick(2, normalized?.triangleRanges)).toBeNull()
  })

  it('normalizeM2DrawingVector 精确兼容后端 M2-BE-01 Drawing（polyline/circle/hidden line/annotations）', () => {
    const normalized = normalizeM2DrawingVector(SAMPLE_BACKEND_DRAWING_DRAFT7)
    expect(normalized).not.toBeNull()
    expect(normalized?.unit).toBe('mm')
    expect(normalized?.revision).toBe('draft-7')
    expect(normalized?.views).toHaveLength(3)

    const frontView = normalized?.views.find((v) => v.id === 'front')
    expect(frontView?.lines).toHaveLength(4)
    expect(frontView?.hiddenLines).toHaveLength(4)

    const topView = normalized?.views.find((v) => v.id === 'top')
    expect(topView?.lines).toHaveLength(4)
    expect(topView?.circles).toHaveLength(2)

    expect(normalized?.annotations?.[1]).toMatchObject({
      annotationId: 'ann-right-hole-dia',
      view: 'top',
      valueText: 'Ø10.0 mm',
      linkedFeatureIds: ['obj-right-hole'],
    })
  })

  it('按修订隔离 drawingVector（F06 / E2 / S5）：草稿 8 模型不覆盖草稿 7 旧矢量，省略新矢量不回退旧矢量', () => {
    const initial = createInitialM2CanvasState({
      projectId: 'proj-plate-01',
      initialDraftRevision: 'draft-7',
      initialBaseRevision: 'v1',
      initialPreviewSnapshot: {
        currentRevision: 'draft-7',
        model: {
          status: 'ready',
          revision: 'draft-7',
          revisionOrder: 7,
          isDraft: true,
          fingerprint: 'fp-7',
        },
        drawing: {
          status: 'ready',
          revision: 'draft-7',
          revisionOrder: 7,
          isDraft: true,
          fingerprint: 'fp-7',
        },
        drawingVector: SAMPLE_BACKEND_DRAWING_DRAFT7,
        annotations: DEFAULT_M2_ANNOTATIONS,
      },
    })

    // 1. 收到 draft-8 model_ready（含新网格，甚至携带草稿 8 预缓存矢量）-> 草稿 7 旧图矢量与标注保持不变
    const afterDraft8Model = reduceM2PreviewEvent(initial, {
      projectId: 'proj-plate-01',
      sequence: 10,
      revision: 'draft-8',
      revisionOrder: 8,
      isDraft: true,
      fingerprint: 'fp-8',
      type: 'model_ready',
      modelMesh: SAMPLE_MODEL_MESH,
    })
    expect(afterDraft8Model.drawing.revision).toBe('draft-7')
    expect(afterDraft8Model.drawingVector?.revision).toBe('draft-7')
    expect(afterDraft8Model.modelMesh).not.toBeNull()

    // 2. 收到 draft-8 drawing_failed -> 仍保留草稿 7 旧图矢量
    const afterDraft8Fail = reduceM2PreviewEvent(afterDraft8Model, {
      projectId: 'proj-plate-01',
      sequence: 11,
      revision: 'draft-8',
      revisionOrder: 8,
      isDraft: true,
      type: 'drawing_failed',
      errorReason: '投影冲突',
    })
    expect(afterDraft8Fail.drawing.revision).toBe('draft-7')
    expect(afterDraft8Fail.drawingVector?.revision).toBe('draft-7')

    // 3. 收到 draft-8 drawing_ready 且省略 drawingVector（且无 draft-8 缓存）-> 严禁回退草稿 7 旧矢量，置为 null
    const afterDraft8ReadyNoVec = reduceM2PreviewEvent(afterDraft8Fail, {
      projectId: 'proj-plate-01',
      sequence: 12,
      revision: 'draft-8',
      revisionOrder: 8,
      isDraft: true,
      fingerprint: 'fp-8',
      type: 'drawing_ready',
    })
    expect(afterDraft8ReadyNoVec.drawing.revision).toBe('draft-8')
    expect(afterDraft8ReadyNoVec.drawingVector).toBeNull()

    // 4. S5：applyM2DrawingRetryResult 更新 draft-8 矢量图纸且不污染 revisionSequences / lastEventSequence
    const afterRetry = applyM2DrawingRetryResult(afterDraft8Fail, {
      projectId: 'proj-plate-01',
      revision: 'draft-8',
      revisionOrder: 8,
      fingerprint: 'fp-8',
      drawingVector: SAMPLE_CANONICAL_DRAWING_DRAFT8,
      annotations: [DEFAULT_M2_ANNOTATIONS[0]],
    })
    expect(afterRetry.drawing.revision).toBe('draft-8')
    expect(afterRetry.drawingVector?.revision).toBe('draft-8')
    expect(afterRetry.lastEventSequence).toBe(afterDraft8Fail.lastEventSequence)
    expect(afterRetry.revisionSequences).toEqual(afterDraft8Fail.revisionSequences)
  })
})

describe('M2-FE-02 中央画布真 3D 网格与真 2D SVG 矢量图纸交互渲染', () => {
  it('渲染真实 2D SVG 矢量图元（实线/圆/隐藏虚线/特征标注/标题/单位/修订号）并支持 3D 拾取 ↔ SVG 标注双向高亮', async () => {
    const user = userEvent.setup()
    render(
      <ProjectAgentM1Workbench
        bridge={{}}
        initialShowOnboarding={false}
        initialDraftRevision="draft-7"
        initialViewMode="split"
        forceNarrowViewport={false}
        initialPreviewSnapshot={{
          currentRevision: 'draft-7',
          model: {
            status: 'ready',
            revision: 'draft-7',
            revisionOrder: 7,
            isDraft: true,
            fingerprint: 'fp-7',
          },
          drawing: {
            status: 'ready',
            revision: 'draft-7',
            revisionOrder: 7,
            isDraft: true,
            fingerprint: 'fp-7',
          },
          features: DEFAULT_M2_FEATURES,
          annotations: DEFAULT_M2_ANNOTATIONS,
          modelMesh: SAMPLE_MODEL_MESH,
          drawingVector: SAMPLE_BACKEND_DRAWING_DRAFT7,
        }}
      />,
    )

    // 严禁手动参数表、尺寸滑块或坐标编辑器
    expect(document.querySelector('input[type="range"]')).toBeNull()
    expect(document.querySelector('input[type="number"]')).toBeNull()

    // jsdom 无 WebGL 环境优雅降级为 3D 投影，不抛异常
    const threeViewport = screen.getByTestId('m2-three-viewport')
    expect(threeViewport).toHaveAttribute('data-render-mode', 'fallback-3d')
    expect(threeViewport).toHaveAttribute('data-triangle-count', '6')

    // 2D SVG 真实 DOM 图元验证
    const svg = screen.getByTestId('m2-drawing-svg')
    expect(svg.tagName.toLowerCase()).toBe('svg')
    expect(svg.querySelectorAll('line[data-primitive="line"]').length).toBeGreaterThanOrEqual(12)
    expect(svg.querySelectorAll('circle[data-primitive="circle"]').length).toBe(2)
    const hiddenLines = svg.querySelectorAll('line[data-primitive="hidden-line"]')
    expect(hiddenLines.length).toBe(6)
    expect(hiddenLines[0]).toHaveAttribute('stroke-dasharray', '3 2')

    // 视图标题、单位与修订号
    expect(within(svg).getByText(/主视图 \(front\)/)).toBeInTheDocument()
    expect(within(svg).getByText(/俯视图 \(top\)/)).toBeInTheDocument()
    expect(within(svg).getByText(/侧视图 \(side\)/)).toBeInTheDocument()
    expect(within(svg).getByText(/单位：mm/)).toBeInTheDocument()
    expect(within(svg).getByText(/修订：草稿 7/)).toBeInTheDocument()

    // 1. 点击 3D 网格中属于左孔的三角形（index 2）-> 触发并排 SVG 图纸对应“两孔中心距”标注高亮
    const leftHoleTri = threeViewport.querySelector('polygon[data-triangle-index="2"]')
    expect(leftHoleTri).not.toBeNull()
    await user.click(leftHoleTri as Element)

    const svgPitchAnn = svg.querySelector('g[data-svg-annotation-id="ann-hole-pitch"]')
    expect(svgPitchAnn).toHaveAttribute('data-highlighted', 'true')
    expect(screen.getByTestId('selection-breadcrumb')).toHaveTextContent('安装板 › 左孔 › 圆柱面')

    // 2. 点击 SVG 中“右孔至右端面边距”标注 -> 双向高亮 3D 中“右孔”和“右端面”三角形及特征
    const svgMarginAnn = svg.querySelector('g[data-svg-annotation-id="ann-right-margin"]')
    expect(svgMarginAnn).not.toBeNull()
    await user.click(svgMarginAnn as Element)

    expect(svgMarginAnn).toHaveAttribute('data-selected', 'true')
    expect(threeViewport.querySelector('polygon[data-triangle-index="0"]')).toHaveAttribute(
      'data-highlighted',
      'true',
    )
    expect(threeViewport.querySelector('polygon[data-triangle-index="4"]')).toHaveAttribute(
      'data-highlighted',
      'true',
    )
  })

  it('支持鼠标拖拽平移、滚轮/按钮缩放、适合窗口复位，并在连续修订刷新后保留 3D 视角与 2D 平移/缩放状态', async () => {
    const user = userEvent.setup()
    let pushEvent: ((event: M2PreviewEvent) => void) | null = null
    const bridge: M2WorkbenchBridge = {
      subscribeM2PreviewEvents: async (_req, listener) => {
        pushEvent = listener
        return { ok: true, value: { subscriptionId: 'sub-m2-geo-1' } }
      },
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
          model: {
            status: 'ready',
            revision: 'draft-7',
            revisionOrder: 7,
            isDraft: true,
            fingerprint: 'fp-7',
          },
          drawing: {
            status: 'ready',
            revision: 'draft-7',
            revisionOrder: 7,
            isDraft: true,
            fingerprint: 'fp-7',
          },
          features: DEFAULT_M2_FEATURES,
          annotations: DEFAULT_M2_ANNOTATIONS,
          modelMesh: SAMPLE_MODEL_MESH,
          drawingVector: SAMPLE_BACKEND_DRAWING_DRAFT7,
        }}
      />,
    )

    const threeSvg = screen.getByTestId('m2-three-fallback-svg')
    const drawingSvg = screen.getByTestId('m2-drawing-svg')
    const initialViewBox = drawingSvg.getAttribute('viewBox')

    // 3D 鼠标拖拽旋转 + 滚轮缩放
    fireEvent.mouseDown(threeSvg, { button: 0, clientX: 100, clientY: 100 })
    fireEvent.mouseMove(threeSvg, { clientX: 130, clientY: 120 })
    fireEvent.mouseUp(threeSvg)
    fireEvent.wheel(threeSvg, { deltaY: -100 })

    const modelMeta = screen.getByLabelText('模型视角状态')
    expect(modelMeta).toHaveTextContent('视角 53°/35° · 缩放 115%')

    // 2D 鼠标拖拽平移 + 两次滚轮缩放 -> viewBox 真实更新
    fireEvent.mouseDown(drawingSvg, { button: 0, clientX: 50, clientY: 50 })
    fireEvent.mouseMove(drawingSvg, { clientX: 90, clientY: 70 })
    fireEvent.mouseUp(drawingSvg)
    fireEvent.wheel(drawingSvg, { deltaY: -100 })
    fireEvent.wheel(drawingSvg, { deltaY: -100 })

    const drawingMeta = screen.getByLabelText('图纸缩放状态')
    expect(drawingMeta).toHaveTextContent('图纸缩放 150% · 平移 (20, 10)')
    expect(drawingSvg.getAttribute('viewBox')).not.toBe(initialViewBox)

    // 连续修订刷新到 draft-8（新网格 + 新矢量图纸）-> 必须保留 3D 视角/缩放与 2D 平移/缩放状态
    act(() => {
      pushEvent?.({
        projectId: 'proj-plate-01',
        sequence: 20,
        revision: 'draft-8',
        revisionOrder: 8,
        isDraft: true,
        fingerprint: 'fp-8',
        type: 'model_ready',
        modelMesh: SAMPLE_MODEL_MESH,
      })
      pushEvent?.({
        projectId: 'proj-plate-01',
        sequence: 21,
        revision: 'draft-8',
        revisionOrder: 8,
        isDraft: true,
        fingerprint: 'fp-8',
        type: 'drawing_ready',
        drawingVector: SAMPLE_CANONICAL_DRAWING_DRAFT8,
        annotations: DEFAULT_M2_ANNOTATIONS,
      })
    })

    expect(screen.getByLabelText('模型视角状态')).toHaveTextContent('视角 53°/35° · 缩放 115%')
    expect(screen.getByLabelText('图纸缩放状态')).toHaveTextContent('图纸缩放 150% · 平移 (20, 10)')

    // 适合窗口复位
    await user.click(screen.getByRole('button', { name: '适合窗口' }))
    await user.click(screen.getByRole('button', { name: '图纸适合窗口' }))
    expect(screen.getByLabelText('模型视角状态')).toHaveTextContent('视角 35°/25° · 缩放 100%')
    expect(screen.getByLabelText('图纸缩放状态')).toHaveTextContent('图纸缩放 100% · 平移 (0, 0)')
  })

  it('旧图回退（草稿 8 模型 + 草稿 7 旧图）明确标明旧图版本且不混入新修订标注', () => {
    let pushEvent: ((event: M2PreviewEvent) => void) | null = null
    const bridge: M2WorkbenchBridge = {
      subscribeM2PreviewEvents: async (_req, listener) => {
        pushEvent = listener
        return { ok: true, value: { subscriptionId: 'sub-m2-fallback-1' } }
      },
    }

    const draft7Annotations: readonly M2DrawingAnnotationItem[] = [
      {
        annotationId: 'ann-d7-only',
        label: '草稿7专属边距',
        valueText: '15.0 mm',
        view: 'top',
        linkedFeatureIds: ['obj-right-hole'],
      },
    ]

    render(
      <ProjectAgentM1Workbench
        bridge={bridge}
        initialShowOnboarding={false}
        initialDraftRevision="draft-7"
        initialViewMode="split"
        forceNarrowViewport={false}
        initialPreviewSnapshot={{
          currentRevision: 'draft-7',
          model: {
            status: 'ready',
            revision: 'draft-7',
            revisionOrder: 7,
            isDraft: true,
            fingerprint: 'fp-7',
          },
          drawing: {
            status: 'ready',
            revision: 'draft-7',
            revisionOrder: 7,
            isDraft: true,
            fingerprint: 'fp-7',
          },
          features: DEFAULT_M2_FEATURES,
          annotations: draft7Annotations,
          modelMesh: SAMPLE_MODEL_MESH,
          drawingVector: SAMPLE_BACKEND_DRAWING_DRAFT7,
        }}
      />,
    )

    // 推送 draft-8 模型（携带 draft-8 标注）以及 draft-8 drawing_failed
    act(() => {
      pushEvent?.({
        projectId: 'proj-plate-01',
        sequence: 30,
        revision: 'draft-8',
        revisionOrder: 8,
        isDraft: true,
        fingerprint: 'fp-8',
        type: 'model_ready',
        modelMesh: SAMPLE_MODEL_MESH,
        annotations: [
          {
            annotationId: 'ann-d8-leaked',
            label: '草稿8新标注不应混入旧图',
            valueText: '18.0 mm',
            view: 'top',
            linkedFeatureIds: ['obj-right-hole'],
          },
        ],
      })
      pushEvent?.({
        projectId: 'proj-plate-01',
        sequence: 31,
        revision: 'draft-8',
        revisionOrder: 8,
        isDraft: true,
        type: 'drawing_failed',
        errorReason: '草稿8投影失败',
      })
    })

    const stage = screen.getByTestId('m2-drawing-vector-stage')
    expect(stage).toHaveAttribute('data-drawing-revision', 'draft-7')
    expect(stage).toHaveAttribute('data-old-drawing-fallback', 'true')
    expect(screen.getByTestId('m2-drawing-fallback-badge')).toHaveTextContent(
      '旧图回退：保留 草稿 7 矢量与标注',
    )

    const svg = screen.getByTestId('m2-drawing-svg')
    expect(svg.querySelector('g[data-svg-annotation-id="ann-d7-only"]')).not.toBeNull()
    expect(svg.querySelector('g[data-svg-annotation-id="ann-d8-leaked"]')).toBeNull()
  })

  it('无几何数据（未提供 modelMesh / drawingVector）时优雅降级到既有结构化特征与标注视图且零手动参数入口', () => {
    render(
      <ProjectAgentM1Workbench
        bridge={{}}
        initialShowOnboarding={false}
        initialDraftRevision="draft-2"
        initialViewMode="split"
        forceNarrowViewport={false}
        initialPreviewSnapshot={{
          currentRevision: 'draft-2',
          model: {
            status: 'ready',
            revision: 'draft-2',
            revisionOrder: 2,
            isDraft: true,
            fingerprint: 'fp-2',
          },
          drawing: {
            status: 'ready',
            revision: 'draft-2',
            revisionOrder: 2,
            isDraft: true,
            fingerprint: 'fp-2',
          },
        }}
      />,
    )

    expect(screen.queryByTestId('m2-three-viewport')).not.toBeInTheDocument()
    expect(screen.queryByTestId('m2-drawing-svg')).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: '三维模型特征拾取区' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '图纸尺寸标注拾取区' })).toBeInTheDocument()
    expect(document.querySelector('input[type="range"]')).toBeNull()
    expect(document.querySelector('input[type="number"]')).toBeNull()
  })
})
