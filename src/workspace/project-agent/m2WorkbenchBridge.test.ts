import { describe, expect, it } from 'vitest'
import {
  applyM2DrawingRetryResult,
  applyM2DrawingRetryResultWithStatus,
  areArtifactsRevisionAligned,
  computeNaturalCompletionSummary,
  createInitialM2CanvasState,
  DEFAULT_M2_REQUIREMENTS,
  formatPartialDrawingFailureMessage,
  formatRevisionDisplay,
  getCheckStatusMeta,
  M2_CHECK_STATUS_META,
  parseRevisionOrder,
  probeM2WorkbenchBridge,
  reduceM2PreviewEvent,
  resolveEffectiveViewMode,
  type M2CheckStatus,
} from './m2WorkbenchBridge'

describe('m2WorkbenchBridge pure helpers & reducers', () => {
  it('F10：duck-types M2 无碰撞窄接口（locateM2Evidence），不会被旧 preload 同名 locateEvidence 误判已接线', () => {
    const emptyProbe = probeM2WorkbenchBridge({})
    expect(emptyProbe.anyAvailable).toBe(false)
    expect(emptyProbe.capabilities.locateM2Evidence).toBe(false)
    expect(emptyProbe.capabilities.retryDrawing).toBe(false)
    expect(emptyProbe.capabilities.submitClarification).toBe(false)
    expect(emptyProbe.missingMethods).toContain('locateM2Evidence')
    expect(emptyProbe.missingMethods).toContain('retryM2Drawing')

    // 旧 preload 仅暴露同名 locateEvidence 时严禁误判已接线
    const legacyPreloadProbe = probeM2WorkbenchBridge({
      locateEvidence: async () => ({ ok: true, value: {} }),
    })
    expect(legacyPreloadProbe.anyAvailable).toBe(false)
    expect(legacyPreloadProbe.capabilities.locateM2Evidence).toBe(false)
    expect(legacyPreloadProbe.missingMethods).toContain('locateM2Evidence')

    const partialProbe = probeM2WorkbenchBridge({
      locateM2Evidence: async () => ({ ok: true, value: {} }),
      retryM2Drawing: async () => ({ ok: true, value: {} }),
    })
    expect(partialProbe.anyAvailable).toBe(true)
    expect(partialProbe.capabilities.locateM2Evidence).toBe(true)
    expect(partialProbe.capabilities.retryDrawing).toBe(true)
    expect(partialProbe.capabilities.submitClarification).toBe(false)
  })

  it('parses revision order and formats Chinese revision labels and partial failure message', () => {
    expect(parseRevisionOrder('draft-8')).toBe(8)
    expect(parseRevisionOrder('v7')).toBe(7)
    expect(formatRevisionDisplay('draft-8')).toBe('草稿 8')
    expect(formatRevisionDisplay('v7')).toBe('版本 7')
    expect(
      formatPartialDrawingFailureMessage(
        'draft-8',
        {
          failedRevision: 'draft-8',
          failedRevisionOrder: 8,
          reason: '投影超时',
          retryable: true,
        },
        'v7',
      ),
    ).toBe('草稿 8 的模型已生成；图纸生成失败，当前显示版本 7')
  })

  it('degrades split view to single tab on narrow viewports', () => {
    expect(resolveEffectiveViewMode('split', false, 'model')).toBe('split')
    expect(resolveEffectiveViewMode('split', true, 'model')).toBe('model')
    expect(resolveEffectiveViewMode('split', true, 'drawing')).toBe('drawing')
    expect(resolveEffectiveViewMode('drawing', true, 'model')).toBe('drawing')
  })

  it('exposes text and graphic symbol metadata for all 6 check statuses', () => {
    const statuses: M2CheckStatus[] = [
      'pass',
      'fail',
      'needsClarification',
      'uncovered',
      'executionFailed',
      'checking',
    ]
    expect(Object.keys(M2_CHECK_STATUS_META)).toHaveLength(6)
    for (const status of statuses) {
      const meta = getCheckStatusMeta(status)
      expect(meta.symbol.length).toBeGreaterThan(0)
      expect(meta.label.length).toBeGreaterThan(0)
    }
  })

  it('auto-switches to 3D model on first rebuildable draft, then to split when same-revision drawing arrives', () => {
    let state = createInitialM2CanvasState({
      projectId: 'proj-1',
      initialBaseRevision: null,
      initialDraftRevision: null,
      initialViewMode: 'drawing',
    })
    expect(state.viewMode).toBe('drawing')
    expect(state.hasSeenRebuildableDraft).toBe(false)

    // First rebuildable draft arrives -> auto switch to 3D model view
    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 1,
      revision: 'draft-1',
      isDraft: true,
      fingerprint: 'fp-1',
      type: 'model_ready',
      checksInProgress: true,
    })
    expect(state.viewMode).toBe('model')
    expect(state.model.isDraft).toBe(true)
    expect(state.hasSeenRebuildableDraft).toBe(true)
    expect(state.checksInProgress).toBe(true)

    // Same-revision drawing arrives with matching fingerprint -> auto switch to split
    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 2,
      revision: 'draft-1',
      isDraft: true,
      fingerprint: 'fp-1',
      type: 'drawing_ready',
      checksInProgress: true,
    })
    expect(areArtifactsRevisionAligned(state.model, state.drawing)).toBe(true)
    expect(state.viewMode).toBe('split')
    expect(state.checksInProgress).toBe(true)
  })

  it('routes late older-revision drawing/check events only to history without overwriting current view', () => {
    let state = createInitialM2CanvasState({
      projectId: 'proj-1',
      initialBaseRevision: 'v7',
      initialDraftRevision: 'draft-8',
    })
    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 10,
      revision: 'draft-8',
      fingerprint: 'fp-8',
      type: 'model_ready',
    })

    // Late draft-7 drawing arrives -> must not overwrite draft-8, must record in history
    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 11,
      revision: 'draft-7',
      fingerprint: 'fp-7',
      type: 'drawing_ready',
    })
    expect(state.currentRevision).toBe('draft-8')
    expect(state.drawing.revision).not.toBe('draft-7')
    expect(state.history[0]?.isLateStale).toBe(true)
    expect(state.history[0]?.revision).toBe('draft-7')

    // Late draft-6 checks_updated arrives -> must not overwrite current checks
    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 12,
      revision: 'draft-6',
      type: 'checks_updated',
      checks: [],
    })
    expect(state.checks.length).toBeGreaterThan(0)
    expect(state.history[0]?.isLateStale).toBe(true)
    expect(state.history[0]?.kind).toBe('checks')
  })

  it('preserves camera/zoom/valid selection on refresh and flags disappeared selection', () => {
    let state = createInitialM2CanvasState({
      projectId: 'proj-1',
      initialBaseRevision: 'v1',
      initialDraftRevision: 'draft-2',
    })
    state = {
      ...state,
      viewMode: 'model',
      camera: { yawDeg: 80, pitchDeg: 40, zoomPercent: 140 },
      drawingViewport: { panX: 12, panY: -8, zoomPercent: 150 },
      selectedObjectId: 'obj-right-hole',
    }

    // Refresh keeping right hole -> preserves viewMode, camera, zoom, and selection
    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 1,
      revision: 'draft-3',
      fingerprint: 'fp-3',
      type: 'revision_refreshed',
      features: state.features,
    })
    expect(state.viewMode).toBe('model')
    expect(state.camera).toEqual({ yawDeg: 80, pitchDeg: 40, zoomPercent: 140 })
    expect(state.drawingViewport).toEqual({ panX: 12, panY: -8, zoomPercent: 150 })
    expect(state.selectedObjectId).toBe('obj-right-hole')
    expect(state.selectionInvalidated).toBe(false)

    // Refresh removing right hole -> flags selectionInvalidated
    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 2,
      revision: 'draft-4',
      fingerprint: 'fp-4',
      type: 'revision_refreshed',
      features: state.features.filter((f) => f.objectId !== 'obj-right-hole'),
    })
    expect(state.selectedObjectId).toBeNull()
    expect(state.selectionInvalidated).toBe(true)
    expect(state.invalidatedObjectLabel).toBe('安装板 › 右孔 › 圆柱面')
  })

  it('F08：无产物快照初始化时禁止仅凭修订号合成 ready 与指纹', () => {
    const state = createInitialM2CanvasState({
      projectId: 'proj-1',
      initialBaseRevision: 'v1',
      initialDraftRevision: 'draft-8',
    })
    expect(state.model.status).toBe('empty')
    expect(state.model.fingerprint).toBeNull()
    expect(state.drawing.status).toBe('empty')
    expect(state.drawing.fingerprint).toBeNull()
    expect(areArtifactsRevisionAligned(state.model, state.drawing, 'draft-8')).toBe(false)
  })

  it('F06：旧修订迟到高序号事件只进历史、不污染当前修订水位，且新修订模型事件不覆盖旧图展示标注', () => {
    let state = createInitialM2CanvasState({
      projectId: 'proj-1',
      initialBaseRevision: 'v7',
      initialDraftRevision: 'draft-8',
    })

    // 1. 草稿 8 模型（seq 5）到达
    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 5,
      revision: 'draft-8',
      revisionOrder: 8,
      fingerprint: 'fp-draft-8',
      type: 'model_ready',
    })
    expect(state.model.revision).toBe('draft-8')

    // 2. 迟到的旧修订草稿 7 图纸（seq 7）到达 -> 只进历史，严禁推进用于过滤草稿 8 的水位
    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 7,
      revision: 'draft-7',
      revisionOrder: 7,
      fingerprint: 'fp-draft-7',
      type: 'drawing_ready',
    })
    expect(state.drawing.revision).toBeNull()
    expect(state.history[0]?.isLateStale).toBe(true)
    expect(state.history[0]?.revision).toBe('draft-7')

    // 同修订重复迟到包（draft-7 seq 7）应去重
    const histLenBeforeDup = state.history.length
    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 7,
      revision: 'draft-7',
      revisionOrder: 7,
      fingerprint: 'fp-draft-7',
      type: 'drawing_ready',
    })
    expect(state.history.length).toBe(histLenBeforeDup)

    // 3. 随后到达的当前草稿 8 图纸（seq 6 < 7）必须被正常接收！
    const d8Annotations = [
      {
        annotationId: 'ann-d8-margin',
        label: '草稿 8 边距标注',
        valueText: '14.5 mm',
        view: 'top' as const,
        linkedFeatureIds: ['obj-right-hole'],
      },
    ]
    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 6,
      revision: 'draft-8',
      revisionOrder: 8,
      fingerprint: 'fp-draft-8',
      type: 'drawing_ready',
      annotations: d8Annotations,
    })
    expect(state.drawing.status).toBe('ready')
    expect(state.drawing.revision).toBe('draft-8')
    expect(state.annotations).toEqual(d8Annotations)

    // 4. 保留草稿 8 图纸时收到草稿 9 模型事件（携带空标注或新标注）-> 不得覆盖草稿 8 正在显示的标注
    const d9Annotations = [
      {
        annotationId: 'ann-d9-margin',
        label: '草稿 9 边距标注',
        valueText: '13.5 mm',
        view: 'top' as const,
        linkedFeatureIds: ['obj-right-hole'],
      },
    ]
    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 8,
      revision: 'draft-9',
      revisionOrder: 9,
      fingerprint: 'fp-draft-9',
      type: 'model_ready',
      annotations: [],
    })
    expect(state.model.revision).toBe('draft-9')
    expect(state.drawing.revision).toBe('draft-8')
    expect(state.annotations).toEqual(d8Annotations)

    // 5. 直到草稿 9 图纸自身就绪后，才切换展示草稿 9 的标注
    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 9,
      revision: 'draft-9',
      revisionOrder: 9,
      fingerprint: 'fp-draft-9',
      type: 'drawing_ready',
      annotations: d9Annotations,
    })
    expect(state.drawing.revision).toBe('draft-9')
    expect(state.annotations).toEqual(d9Annotations)
  })

  it('F07：对象失效标志不在后续特征事件中静默清零、禁止仅凭 featureRef 静默改绑、同步检查 selectedAnnotationId 失效', () => {
    let state = createInitialM2CanvasState({
      projectId: 'proj-1',
      initialBaseRevision: 'v1',
      initialDraftRevision: 'draft-2',
      initialPreviewSnapshot: {
        currentRevision: 'draft-2',
        model: {
          status: 'ready',
          revision: 'draft-2',
          revisionOrder: 2,
          isDraft: true,
          fingerprint: 'fp-draft-2',
        },
        drawing: {
          status: 'ready',
          revision: 'draft-2',
          revisionOrder: 2,
          isDraft: true,
          fingerprint: 'fp-draft-2',
        },
      },
    })
    state = {
      ...state,
      selectedObjectId: 'obj-right-hole',
      selectedAnnotationId: 'ann-right-margin',
    }

    // 1. 刷新后出现同 featureRef 但不同 objectId -> 严禁静默改绑，必须置失效并保留提示
    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 1,
      revision: 'draft-3',
      fingerprint: 'fp-draft-3',
      type: 'revision_refreshed',
      features: [
        {
          objectId: 'obj-right-hole-recreated-v2',
          breadcrumb: '安装板 › 右孔 › 圆柱面',
          featureRef: 'plate/right-hole/cylinder',
          partName: '安装板',
          role: '右孔圆柱面',
          kind: 'hole',
          linkedAnnotationIds: ['ann-right-margin'],
        },
      ],
    })
    expect(state.selectedObjectId).toBeNull()
    expect(state.selectionInvalidated).toBe(true)
    expect(state.invalidatedObjectLabel).toBe('安装板 › 右孔 › 圆柱面')

    // 2. 下一份特征事件到来 -> selectionInvalidated 不得被静默清零
    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 2,
      revision: 'draft-4',
      fingerprint: 'fp-draft-4',
      type: 'revision_refreshed',
      features: state.features,
    })
    expect(state.selectionInvalidated).toBe(true)
    expect(state.invalidatedObjectLabel).toBe('安装板 › 右孔 › 圆柱面')

    // 3. 用户重新选中一个标注，随后图纸刷新移除该标注 -> selectedAnnotationId 同步置失效
    state = {
      ...state,
      selectedAnnotationId: 'ann-right-margin',
      selectionInvalidated: false,
      invalidatedObjectLabel: null,
    }
    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 3,
      revision: 'draft-4',
      fingerprint: 'fp-draft-4',
      type: 'drawing_ready',
      annotations: state.annotations.filter((a) => a.annotationId !== 'ann-right-margin'),
    })
    expect(state.selectedAnnotationId).toBeNull()
    expect(state.selectionInvalidated).toBe(true)
    expect(state.invalidatedObjectLabel).toContain('右孔至右端面边距')
  })

  it('F11：支持 task_completed / taskCompleted 终态信号与模型+图纸+检查同版就绪自动联动并排与自然完成摘要', () => {
    let state = createInitialM2CanvasState({
      projectId: 'proj-1',
      initialBaseRevision: 'v1',
      initialDraftRevision: 'draft-5',
      initialViewMode: 'model',
      initialPreviewSnapshot: {
        requirements: [DEFAULT_M2_REQUIREMENTS[0]],
      },
    })

    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 1,
      revision: 'draft-5',
      fingerprint: 'fp-draft-5',
      type: 'model_ready',
      checksInProgress: true,
    })
    expect(computeNaturalCompletionSummary(state)).toBeNull()

    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 2,
      revision: 'draft-5',
      fingerprint: 'fp-draft-5',
      type: 'drawing_ready',
      checksInProgress: true,
    })
    // 检查仍在进行中，尚未自然完成
    expect(computeNaturalCompletionSummary(state)).toBeNull()

    // 切回单视图后发送 task_completed + 同修订检查结果
    state = { ...state, viewMode: 'model' }
    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 3,
      revision: 'draft-5',
      fingerprint: 'fp-draft-5',
      type: 'task_completed',
      taskCompleted: true,
      checksInProgress: false,
      checks: [
        {
          checkId: 'chk-1',
          requirementId: 'req-right-margin',
          title: '右孔边距',
          required: true,
          status: 'pass',
          summary: '通过',
          linkedFeatureIds: ['obj-right-hole'],
          linkedAnnotationIds: ['ann-right-margin'],
          revisionFingerprint: 'fp-draft-5',
        },
      ],
    })
    expect(state.viewMode).toBe('split')
    expect(state.taskCompleted).toBe(true)
    const summary = computeNaturalCompletionSummary(state)
    expect(summary).not.toBeNull()
    expect(summary?.revision).toBe('draft-5')
    expect(summary?.triggeredByTaskSignal).toBe(true)
    expect(summary?.isPendingChecksTerminal).toBe(false)
    expect(summary?.passCount).toBe(1)
    expect(summary?.allRequiredPassed).toBe(true)
  })

  it('E1：新修订省略 fingerprint 严禁继承旧修订指纹，且修订推进省略 checks 时不得继承旧草稿检查', () => {
    let state = createInitialM2CanvasState({
      projectId: 'proj-1',
      initialBaseRevision: 'v1',
      initialDraftRevision: 'draft-7',
      initialPreviewSnapshot: {
        currentRevision: 'draft-7',
        model: {
          status: 'ready',
          revision: 'draft-7',
          revisionOrder: 7,
          isDraft: true,
          fingerprint: 'fp-draft-7',
        },
        drawing: {
          status: 'ready',
          revision: 'draft-7',
          revisionOrder: 7,
          isDraft: true,
          fingerprint: 'fp-draft-7',
        },
        checks: [
          {
            checkId: 'chk-7',
            requirementId: 'req-right-margin',
            title: '右孔边距',
            required: true,
            status: 'pass',
            summary: '草稿 7 通过',
            linkedFeatureIds: ['obj-right-hole'],
            linkedAnnotationIds: ['ann-right-margin'],
            revisionFingerprint: 'fp-draft-7',
          },
        ],
      },
    })

    // 同修订更新省略指纹 -> 保留同修订既有指纹
    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 1,
      revision: 'draft-7',
      type: 'model_ready',
    })
    expect(state.model.fingerprint).toBe('fp-draft-7')
    expect(state.checks).toHaveLength(1)

    // 推进到新修订 draft-8 且省略 fingerprint（undefined / '' / null）及 checks -> 指纹必须置 null，旧 checks 必须清空
    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 2,
      revision: 'draft-8',
      type: 'model_ready',
    })
    expect(state.model.revision).toBe('draft-8')
    expect(state.model.fingerprint).toBeNull()
    expect(state.checks).toEqual([])

    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 3,
      revision: 'draft-8',
      fingerprint: '   ',
      type: 'drawing_ready',
    })
    expect(state.drawing.revision).toBe('draft-8')
    expect(state.drawing.fingerprint).toBeNull()
    expect(areArtifactsRevisionAligned(state.model, state.drawing, 'draft-8')).toBe(false)
  })

  it('E2：新修订 drawing_ready 省略 annotations 且无缓存时置为 []（不得回退旧草稿标注）并同步校验 selectedAnnotationId 失效', () => {
    const d7Annotations = [
      {
        annotationId: 'ann-d7-only',
        label: '草稿 7 专属标注',
        valueText: '14.0 mm',
        view: 'top' as const,
        linkedFeatureIds: ['obj-right-hole'],
      },
    ]
    let state = createInitialM2CanvasState({
      projectId: 'proj-1',
      initialBaseRevision: 'v1',
      initialDraftRevision: 'draft-7',
      initialPreviewSnapshot: {
        currentRevision: 'draft-7',
        drawing: {
          status: 'ready',
          revision: 'draft-7',
          revisionOrder: 7,
          isDraft: true,
          fingerprint: 'fp-draft-7',
        },
        annotations: d7Annotations,
      },
    })
    state = { ...state, selectedAnnotationId: 'ann-d7-only' }

    // 草稿 8 drawing_ready 省略 annotations 且 annotationsByRevision['draft-8'] 无缓存
    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 1,
      revision: 'draft-8',
      fingerprint: 'fp-draft-8',
      type: 'drawing_ready',
    })
    expect(state.drawing.revision).toBe('draft-8')
    expect(state.annotations).toEqual([])
    expect(state.selectedAnnotationId).toBeNull()
    expect(state.selectionInvalidated).toBe(true)
    expect(state.invalidatedObjectLabel).toContain('草稿 7 专属标注')
  })

  it('E3 & E4：存在未确认/未覆盖必需要求时不得判定自然完成；task_completed 且 checks 为空时输出明确终态摘要', () => {
    const baseState = createInitialM2CanvasState({
      projectId: 'proj-1',
      initialBaseRevision: 'v1',
      initialDraftRevision: 'draft-5',
      initialPreviewSnapshot: {
        currentRevision: 'draft-5',
        model: {
          status: 'ready',
          revision: 'draft-5',
          revisionOrder: 5,
          isDraft: true,
          fingerprint: 'fp-draft-5',
        },
        drawing: {
          status: 'ready',
          revision: 'draft-5',
          revisionOrder: 5,
          isDraft: true,
          fingerprint: 'fp-draft-5',
        },
        requirements: DEFAULT_M2_REQUIREMENTS, // 含 needsClarification 必需要求 req-datum-conflict
        checks: [
          {
            checkId: 'chk-1',
            requirementId: 'req-right-margin',
            title: '右孔边距',
            required: true,
            status: 'pass',
            summary: '通过',
            linkedFeatureIds: ['obj-right-hole'],
            linkedAnnotationIds: ['ann-right-margin'],
            revisionFingerprint: 'fp-draft-5',
          },
        ],
        checksInProgress: false,
      },
    })

    // E3：存在未确认必需要求或缺少当前修订通过检查的必需要求 -> 严禁判定自然完成
    expect(computeNaturalCompletionSummary(baseState)).toBeNull()

    // E4：两槽同版 ready + task_completed 到达但 checks 为空 -> 输出明确非完成终态摘要并列出未满足必需要求
    const emptyChecksTerminal = reduceM2PreviewEvent(
      { ...baseState, checks: [] },
      {
        projectId: 'proj-1',
        sequence: 10,
        revision: 'draft-5',
        fingerprint: 'fp-draft-5',
        type: 'task_completed',
        taskCompleted: true,
        checks: [],
        checksInProgress: false,
      },
    )
    const terminalSummary = computeNaturalCompletionSummary(emptyChecksTerminal)
    expect(terminalSummary).not.toBeNull()
    expect(terminalSummary?.isPendingChecksTerminal).toBe(true)
    expect(terminalSummary?.allRequiredPassed).toBe(false)
    expect(terminalSummary?.summaryText).toContain('任务已结束 · 等待检查结果 · 尚未满足正式保存条件')
    expect(terminalSummary?.unmetRequiredCount).toBe(3)
    expect(terminalSummary?.summaryText).toContain('孔中心基准与厚度说明复核')
  })

  it('E7：已有 currentRevision 时收到无数值后缀且缺显式 revisionOrder 的不透明修订，fail-closed 拒绝覆盖画布且不污染水位', () => {
    let state = createInitialM2CanvasState({
      projectId: 'proj-1',
      initialBaseRevision: 'v1',
      initialDraftRevision: 'draft-8',
    })
    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 5,
      revision: 'draft-8',
      fingerprint: 'fp-draft-8',
      type: 'model_ready',
    })

    // 收到不透明修订 "rev-opaque"（无数值后缀、无 revisionOrder、高 sequence=99）
    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 99,
      revision: 'rev-opaque',
      fingerprint: 'fp-opaque',
      type: 'model_ready',
    })
    expect(state.currentRevision).toBe('draft-8')
    expect(state.model.revision).toBe('draft-8')
    expect(state.lastEventSequence).toBe(5)
    expect(state.revisionSequences['rev-opaque']).toBeUndefined()
    expect(state.history[0]?.isLateStale).toBe(true)
    expect(state.history[0]?.revision).toBe('rev-opaque')

    // 随后正常 draft-8 seq 6 事件仍可正常生效
    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 6,
      revision: 'draft-8',
      fingerprint: 'fp-draft-8',
      type: 'drawing_ready',
    })
    expect(state.drawing.revision).toBe('draft-8')
    expect(state.drawing.status).toBe('ready')
  })

  it('S5：applyM2DrawingRetryResult 仅更新图纸槽位、标注与历史，严禁推进 revisionSequences 或全局服务端水位', () => {
    let state = createInitialM2CanvasState({
      projectId: 'proj-1',
      initialBaseRevision: 'v7',
      initialDraftRevision: 'draft-8',
    })
    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 2,
      revision: 'draft-8',
      fingerprint: 'fp-draft-8',
      type: 'model_ready',
    })
    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 3,
      revision: 'draft-8',
      type: 'drawing_failed',
      errorReason: '投影超时',
    })
    expect(state.lastEventSequence).toBe(3)
    expect(state.revisionSequences['draft-8']).toBe(3)

    // 本地重试图纸成功 -> 更新 drawing 槽位、清除 drawingFailure，但严禁推进 sequence 水位
    state = applyM2DrawingRetryResult(state, {
      projectId: 'proj-1',
      revision: 'draft-8',
      revisionOrder: 8,
      fingerprint: 'fp-draft-8',
      summary: '重试投影成功',
      annotations: [
        {
          annotationId: 'ann-retry-8',
          label: '重试标注',
          valueText: '15.0 mm',
          view: 'top',
          linkedFeatureIds: ['obj-right-hole'],
        },
      ],
    })
    expect(state.drawing.status).toBe('ready')
    expect(state.drawing.revision).toBe('draft-8')
    expect(state.drawingFailure).toBeNull()
    expect(state.annotations[0]?.annotationId).toBe('ann-retry-8')
    expect(state.lastEventSequence).toBe(3)
    expect(state.revisionSequences['draft-8']).toBe(3)

    // 随后到达的服务端检查事件（sequence 4，若原实现合成 seq=4 则会被误过滤）必须正常处理
    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 4,
      revision: 'draft-8',
      fingerprint: 'fp-draft-8',
      type: 'checks_updated',
      checksInProgress: false,
      checks: [
        {
          checkId: 'chk-srv-4',
          requirementId: 'req-right-margin',
          title: '服务端检查',
          required: true,
          status: 'pass',
          summary: '通过',
          linkedFeatureIds: ['obj-right-hole'],
          linkedAnnotationIds: ['ann-retry-8'],
          revisionFingerprint: 'fp-draft-8',
        },
      ],
    })
    expect(state.checks).toHaveLength(1)
    expect(state.checks[0]?.checkId).toBe('chk-srv-4')
  })

  it('N1：同修订事件省略 checks 与 checksInProgress 时保留 checksInProgress=true，直至显式结束', () => {
    let state = createInitialM2CanvasState({
      projectId: 'proj-1',
      initialBaseRevision: 'v1',
      initialDraftRevision: 'draft-8',
      initialPreviewSnapshot: {
        currentRevision: 'draft-8',
        model: {
          status: 'ready',
          revision: 'draft-8',
          revisionOrder: 8,
          isDraft: true,
          fingerprint: 'fp-draft-8',
        },
        checks: [],
        checksInProgress: true,
      },
    })
    expect(state.checksInProgress).toBe(true)

    // 同修订 drawing_ready / model_ready / revision_refreshed 省略 checks 与 checksInProgress -> 必须保持 true
    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 1,
      revision: 'draft-8',
      fingerprint: 'fp-draft-8',
      type: 'drawing_ready',
    })
    expect(state.checksInProgress).toBe(true)

    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 2,
      revision: 'draft-8',
      fingerprint: 'fp-draft-8',
      type: 'model_ready',
    })
    expect(state.checksInProgress).toBe(true)

    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 3,
      revision: 'draft-8',
      fingerprint: 'fp-draft-8',
      type: 'revision_refreshed',
    })
    expect(state.checksInProgress).toBe(true)

    // 显式收到 checksInProgress: false 或非 checking 的 checks_updated 才允许清除
    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 4,
      revision: 'draft-8',
      fingerprint: 'fp-draft-8',
      type: 'checks_updated',
      checksInProgress: false,
      checks: [
        {
          checkId: 'chk-n1',
          requirementId: 'req-right-margin',
          title: '右孔边距',
          required: true,
          status: 'pass',
          summary: '通过',
          linkedFeatureIds: ['obj-right-hole'],
          linkedAnnotationIds: ['ann-right-margin'],
          revisionFingerprint: 'fp-draft-8',
        },
      ],
    })
    expect(state.checksInProgress).toBe(false)
  })

  it('N2：迟到的图纸重试成功因 drawingFailureGeneration 不匹配被严格丢弃，严禁覆盖同修订较新 drawing_failed', () => {
    let state = createInitialM2CanvasState({
      projectId: 'proj-1',
      initialBaseRevision: 'v7',
      initialDraftRevision: 'draft-8',
    })
    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 1,
      revision: 'draft-8',
      fingerprint: 'fp-draft-8',
      type: 'model_ready',
    })
    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 2,
      revision: 'draft-8',
      type: 'drawing_failed',
      errorReason: '首次投影失败',
    })
    const capturedFailureGen = state.drawingFailureGeneration
    expect(capturedFailureGen).toBe(1)

    // 重试挂起期间收到同修订较新的 drawing_failed -> generation 递增
    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 3,
      revision: 'draft-8',
      type: 'drawing_failed',
      errorReason: '二次投影失败（较新）',
    })
    expect(state.drawingFailureGeneration).toBe(2)

    // 早先发起的重试成功返回 -> 必须被严格丢弃，不得清除较新失败或覆盖图纸
    const afterStaleRetry = applyM2DrawingRetryResult(
      state,
      {
        projectId: 'proj-1',
        revision: 'draft-8',
        revisionOrder: 8,
        fingerprint: 'fp-draft-8',
        summary: '旧重试成功',
      },
      { expectedDrawingFailureGeneration: capturedFailureGen },
    )
    expect(afterStaleRetry).toBe(state)
    expect(afterStaleRetry.drawingFailure?.reason).toBe('二次投影失败（较新）')
    expect(afterStaleRetry.drawing.status).toBe('empty')
  })

  it('P1-4：迟到的图纸重试成功因 drawingStateGeneration 不匹配被严格丢弃，严禁覆盖同修订较新 drawing_ready', () => {
    let state = createInitialM2CanvasState({
      projectId: 'proj-1',
      initialBaseRevision: 'v7',
      initialDraftRevision: 'draft-8',
    })
    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 1,
      revision: 'draft-8',
      fingerprint: 'fp-draft-8',
      type: 'model_ready',
    })
    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 2,
      revision: 'draft-8',
      type: 'drawing_failed',
      errorReason: '首次投影失败',
    })
    const capturedFailureGen = state.drawingFailureGeneration
    const capturedStateGen = state.drawingStateGeneration
    expect(capturedFailureGen).toBe(1)
    expect(capturedStateGen).toBe(1)

    // 重试挂起期间收到同修订较新的 drawing_ready -> drawingStateGeneration 递增
    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 3,
      revision: 'draft-8',
      fingerprint: 'fp-draft-8-newer',
      type: 'drawing_ready',
      summary: '同修订较新图纸已就绪',
      annotations: [
        {
          annotationId: 'ann-newer-8',
          label: '较新图纸标注',
          valueText: '15.2 mm',
          view: 'top',
          linkedFeatureIds: ['obj-right-hole'],
        },
      ],
    })
    expect(state.drawingStateGeneration).toBe(2)
    expect(state.drawing.status).toBe('ready')
    expect(state.drawing.summary).toBe('同修订较新图纸已就绪')

    // 早先发起的迟到重试成功返回 -> 必须被严格丢弃，绝不覆盖较新图纸槽与标注
    const afterStaleRetry = applyM2DrawingRetryResult(
      state,
      {
        projectId: 'proj-1',
        revision: 'draft-8',
        revisionOrder: 8,
        fingerprint: 'fp-draft-8-old-retry',
        summary: '迟到的旧重试结果',
        annotations: [
          {
            annotationId: 'ann-stale-retry',
            label: '旧重试标注',
            valueText: '14.0 mm',
            view: 'top',
            linkedFeatureIds: ['obj-right-hole'],
          },
        ],
      },
      {
        expectedDrawingFailureGeneration: capturedFailureGen,
        expectedDrawingStateGeneration: capturedStateGen,
      },
    )
    expect(afterStaleRetry).toBe(state)
    expect(afterStaleRetry.drawing.fingerprint).toBe('fp-draft-8-newer')
    expect(afterStaleRetry.drawing.summary).toBe('同修订较新图纸已就绪')
    expect(afterStaleRetry.annotations[0]?.annotationId).toBe('ann-newer-8')
  })

  it('N3：同 revisionOrder 不同修订 ID 碰撞（draft-7 vs branch-7）fail-closed 拒绝替换画布且不污染水位', () => {
    let state = createInitialM2CanvasState({
      projectId: 'proj-1',
      initialBaseRevision: 'v1',
      initialDraftRevision: 'draft-7',
    })
    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 4,
      revision: 'draft-7',
      fingerprint: 'fp-draft-7',
      type: 'model_ready',
    })

    // 收到同 order=7 但不同 ID 的 branch-7
    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 99,
      revision: 'branch-7',
      fingerprint: 'fp-branch-7',
      type: 'model_ready',
    })
    expect(state.currentRevision).toBe('draft-7')
    expect(state.model.revision).toBe('draft-7')
    expect(state.lastEventSequence).toBe(4)
    expect(state.revisionSequences['branch-7']).toBeUndefined()
    expect(state.history[0]?.isLateStale).toBe(true)
    expect(state.history[0]?.revision).toBe('branch-7')
  })

  it('N5：task_completed 且 checksInProgress=true 且 checks=[] 时仍展示终态等待提示并保持未通过正式保存条件', () => {
    const state = createInitialM2CanvasState({
      projectId: 'proj-1',
      initialBaseRevision: 'v1',
      initialDraftRevision: 'draft-5',
      initialPreviewSnapshot: {
        currentRevision: 'draft-5',
        model: {
          status: 'ready',
          revision: 'draft-5',
          revisionOrder: 5,
          isDraft: true,
          fingerprint: 'fp-draft-5',
        },
        drawing: {
          status: 'ready',
          revision: 'draft-5',
          revisionOrder: 5,
          isDraft: true,
          fingerprint: 'fp-draft-5',
        },
        requirements: DEFAULT_M2_REQUIREMENTS,
        checks: [],
        checksInProgress: true,
      },
    })

    const completedWhileChecking = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 5,
      revision: 'draft-5',
      fingerprint: 'fp-draft-5',
      type: 'task_completed',
      taskCompleted: true,
      checksInProgress: true,
      checks: [],
    })
    const summary = computeNaturalCompletionSummary(completedWhileChecking)
    expect(summary).not.toBeNull()
    expect(summary?.isPendingChecksTerminal).toBe(true)
    expect(summary?.checksInProgress).toBe(true)
    expect(summary?.allRequiredPassed).toBe(false)
    expect(summary?.summaryText).toContain('任务已结束 · 检查进行中 · 尚未满足正式保存条件')
  })

  it('R-C：草稿 8 图纸重试挂起期间模型推进至草稿 9（drawingStateGeneration 未变）时，applyM2DrawingRetryResultWithStatus 返回 applied=false 与 stale_revision 且不覆盖画布', () => {
    let state = createInitialM2CanvasState({
      projectId: 'proj-1',
      initialBaseRevision: 'v7',
      initialDraftRevision: 'draft-8',
    })
    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 1,
      revision: 'draft-8',
      revisionOrder: 8,
      fingerprint: 'fp-draft-8',
      type: 'model_ready',
    })
    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 2,
      revision: 'draft-8',
      revisionOrder: 8,
      type: 'drawing_failed',
      errorReason: '草稿 8 投影超时',
    })
    const capturedFailureGen = state.drawingFailureGeneration
    const capturedStateGen = state.drawingStateGeneration

    // 挂起期间模型推进至草稿 9（仅 model_ready，drawingStateGeneration 未变）
    state = reduceM2PreviewEvent(state, {
      projectId: 'proj-1',
      sequence: 3,
      revision: 'draft-9',
      revisionOrder: 9,
      fingerprint: 'fp-draft-9',
      type: 'model_ready',
    })
    expect(state.currentRevision).toBe('draft-9')
    expect(state.model.revision).toBe('draft-9')
    expect(state.drawingStateGeneration).toBe(capturedStateGen)
    expect(state.drawingFailureGeneration).toBe(capturedFailureGen)

    const lateDraft8Retry = {
      projectId: 'proj-1',
      revision: 'draft-8',
      revisionOrder: 8,
      fingerprint: 'fp-draft-8',
      summary: '迟到的草稿 8 重试成功',
      annotations: [
        {
          annotationId: 'ann-late-draft-8',
          label: '迟到草稿 8 标注',
          valueText: '14.0 mm',
          view: 'top' as const,
          linkedFeatureIds: ['obj-right-hole'],
        },
      ],
    }

    // 明确返回采纳状态：applied=false, rejectedReason='stale_revision'，画布原样返回不被覆盖
    const rejectedOutcome = applyM2DrawingRetryResultWithStatus(state, lateDraft8Retry, {
      expectedDrawingFailureGeneration: capturedFailureGen,
      expectedDrawingStateGeneration: capturedStateGen,
    })
    expect(rejectedOutcome.applied).toBe(false)
    expect(rejectedOutcome.rejectedReason).toBe('stale_revision')
    expect(rejectedOutcome.state).toBe(state)
    expect(rejectedOutcome.state.drawing.revision).toBeNull()
    expect(rejectedOutcome.state.annotations.some((a) => a.annotationId === 'ann-late-draft-8')).toBe(false)

    // 原签名 applyM2DrawingRetryResult 保持向后兼容
    expect(
      applyM2DrawingRetryResult(state, lateDraft8Retry, {
        expectedDrawingFailureGeneration: capturedFailureGen,
        expectedDrawingStateGeneration: capturedStateGen,
      }),
    ).toBe(state)

    // 针对当前最新修订 draft-9 的重试结果则正常采纳并返回 applied=true
    const acceptedOutcome = applyM2DrawingRetryResultWithStatus(
      state,
      {
        projectId: 'proj-1',
        revision: 'draft-9',
        revisionOrder: 9,
        fingerprint: 'fp-draft-9',
        summary: '草稿 9 重试成功',
      },
      {
        expectedDrawingFailureGeneration: capturedFailureGen,
        expectedDrawingStateGeneration: capturedStateGen,
      },
    )
    expect(acceptedOutcome.applied).toBe(true)
    expect(acceptedOutcome.rejectedReason).toBeUndefined()
    expect(acceptedOutcome.state.drawing.status).toBe('ready')
    expect(acceptedOutcome.state.drawing.revision).toBe('draft-9')
  })
})
