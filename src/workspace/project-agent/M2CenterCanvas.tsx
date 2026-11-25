import { useRef, type KeyboardEvent, type RefObject } from 'react'
import {
  areArtifactsRevisionAligned,
  formatPartialDrawingFailureMessage,
  formatRevisionDisplay,
  resolveEffectiveViewMode,
  type M2ArtifactSlotState,
  type M2CameraState,
  type M2DrawingAnnotationItem,
  type M2DrawingFailureNotice,
  type M2DrawingVector,
  type M2DrawingViewportState,
  type M2MeshTriangleRange,
  type M2ModelFeatureItem,
  type M2ModelMesh,
  type M2NaturalCompletionSummary,
  type M2SingleViewTab,
  type M2ViewMode,
} from './m2WorkbenchBridge'
import { M2ThreeMeshViewport } from './M2ThreeMeshViewport'
import { M2VectorDrawingViewport } from './M2VectorDrawingViewport'

export interface M2CenterCanvasProps {
  readonly projectName: string
  readonly baseRevision: string | null
  readonly draftRevision: string | null
  readonly scopeEpoch: number
  readonly writerEpoch: number
  readonly viewMode: M2ViewMode
  readonly lastSingleTab: M2SingleViewTab
  readonly isNarrow: boolean
  readonly model: M2ArtifactSlotState
  readonly drawing: M2ArtifactSlotState
  readonly drawingFailure: M2DrawingFailureNotice | null
  readonly checksInProgress: boolean
  readonly naturalCompletionSummary?: M2NaturalCompletionSummary | null
  readonly features: readonly M2ModelFeatureItem[]
  readonly annotations: readonly M2DrawingAnnotationItem[]
  readonly modelMesh?: M2ModelMesh | null
  readonly drawingVector?: M2DrawingVector | null
  readonly selectedObjectId: string | null
  readonly selectedAnnotationId: string | null
  readonly highlightedFeatureIds: ReadonlySet<string>
  readonly highlightedAnnotationIds: ReadonlySet<string>
  readonly selectionInvalidated: boolean
  readonly invalidatedObjectLabel: string | null
  readonly camera: M2CameraState
  readonly drawingViewport: M2DrawingViewportState
  readonly retryDrawingPending: boolean
  readonly retryDrawingFeedback: string | null
  readonly contextActionFeedback: string | null
  readonly previewMessage: string | null
  readonly canvasRegionRef: RefObject<HTMLElement | null>
  readonly objectListRegionRef: RefObject<HTMLElement | null>
  readonly retryDrawingButtonRef?: RefObject<HTMLButtonElement | null>
  readonly onChangeViewMode: (mode: M2ViewMode) => void
  readonly onSelectFeature: (feature: M2ModelFeatureItem) => void
  readonly onSelectAnnotation: (annotation: M2DrawingAnnotationItem) => void
  readonly onClearSelection: () => void
  readonly onBringIntoNextPrompt: () => void
  readonly onCopyToExternalSession: () => void
  readonly onRetryDrawing: () => void
  readonly onOpenCompletionView?: () => void
  readonly onUpdateCamera: (updater: (prev: M2CameraState) => M2CameraState) => void
  readonly onUpdateDrawingViewport: (
    updater: (prev: M2DrawingViewportState) => M2DrawingViewportState,
  ) => void
}

export interface M2ArtifactStatusMeta {
  readonly symbol: string
  readonly text: string
  readonly toneClass: string
  readonly stateKey: 'ready' | 'draft-ready' | 'building' | 'failed' | 'empty'
}

// eslint-disable-next-line react-refresh/only-export-components
export function getArtifactStatusMeta(
  slot: M2ArtifactSlotState,
  label: string,
  failureNotice?: M2DrawingFailureNotice | null,
): M2ArtifactStatusMeta {
  if (failureNotice) {
    return {
      symbol: '✕',
      text:
        slot.status === 'ready' && slot.revision
          ? `${label}失败（保留 ${formatRevisionDisplay(slot.revision)}）`
          : `${label}失败`,
      toneClass: 'pa-tone-danger',
      stateKey: 'failed',
    }
  }
  if (slot.status === 'failed') {
    return {
      symbol: '✕',
      text: `${label}失败`,
      toneClass: 'pa-tone-danger',
      stateKey: 'failed',
    }
  }
  if (slot.status === 'building') {
    return {
      symbol: '◌',
      text: `${label}生成中（${formatRevisionDisplay(slot.revision)}）`,
      toneClass: 'pa-tone-action',
      stateKey: 'building',
    }
  }
  if (slot.status === 'ready') {
    if (slot.isDraft) {
      return {
        symbol: '✓',
        text: `${label}就绪 · ✎ 草稿（${formatRevisionDisplay(slot.revision)}）`,
        toneClass: 'pa-tone-pass',
        stateKey: 'draft-ready',
      }
    }
    return {
      symbol: '✓',
      text: `${label}就绪（${formatRevisionDisplay(slot.revision)}）`,
      toneClass: 'pa-tone-pass',
      stateKey: 'ready',
    }
  }
  return {
    symbol: '○',
    text: `${label}未生成`,
    toneClass: 'pa-tone-muted',
    stateKey: 'empty',
  }
}

export function M2CenterCanvas({
  projectName,
  baseRevision,
  draftRevision,
  scopeEpoch,
  writerEpoch,
  viewMode,
  lastSingleTab,
  isNarrow,
  model,
  drawing,
  drawingFailure,
  checksInProgress,
  naturalCompletionSummary = null,
  features,
  annotations,
  modelMesh = null,
  drawingVector = null,
  selectedObjectId,
  selectedAnnotationId,
  highlightedFeatureIds,
  highlightedAnnotationIds,
  selectionInvalidated,
  invalidatedObjectLabel,
  camera,
  drawingViewport,
  retryDrawingPending,
  retryDrawingFeedback,
  contextActionFeedback,
  previewMessage,
  canvasRegionRef,
  objectListRegionRef,
  retryDrawingButtonRef,
  onChangeViewMode,
  onSelectFeature,
  onSelectAnnotation,
  onClearSelection,
  onBringIntoNextPrompt,
  onCopyToExternalSession,
  onRetryDrawing,
  onOpenCompletionView,
  onUpdateCamera,
  onUpdateDrawingViewport,
}: M2CenterCanvasProps) {
  const effectiveViewMode = resolveEffectiveViewMode(viewMode, isNarrow, lastSingleTab)
  const showModelPane = effectiveViewMode === 'model' || effectiveViewMode === 'split'
  const showDrawingPane = effectiveViewMode === 'drawing' || effectiveViewMode === 'split'
  const sameRevisionAligned = areArtifactsRevisionAligned(model, drawing)
  const selectedFeature = features.find((f) => f.objectId === selectedObjectId) ?? null
  const isDraftDisplay = model.isDraft || drawing.isDraft
  const modelStatusMeta = getArtifactStatusMeta(model, '模型')
  const drawingStatusMeta = getArtifactStatusMeta(drawing, '图纸', drawingFailure)

  const objectItemRefs = useRef<Array<HTMLButtonElement | null>>([])

  const handlePickMeshRange = (range: M2MeshTriangleRange) => {
    const matched =
      features.find((f) => f.objectId === range.objectId) ??
      (range.featureRef ? features.find((f) => f.featureRef === range.featureRef) : undefined)
    if (matched) {
      onSelectFeature(matched)
    }
  }

  const handleObjectListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (features.length === 0) return
    const currentIndex = objectItemRefs.current.findIndex(
      (btn) => btn !== null && btn === document.activeElement,
    )
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      const nextIdx = currentIndex < 0 ? 0 : (currentIndex + 1) % features.length
      objectItemRefs.current[nextIdx]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      const prevIdx =
        currentIndex <= 0 ? features.length - 1 : (currentIndex - 1) % features.length
      objectItemRefs.current[prevIdx]?.focus()
    } else if (event.key === 'Home') {
      event.preventDefault()
      objectItemRefs.current[0]?.focus()
    } else if (event.key === 'End') {
      event.preventDefault()
      objectItemRefs.current[features.length - 1]?.focus()
    }
  }

  return (
    <section
      ref={canvasRegionRef}
      tabIndex={-1}
      className="pa-panel pa-focus-region"
      aria-label="中央画布"
      data-effective-view={effectiveViewMode}
      data-narrow-degraded={isNarrow && viewMode === 'split' ? 'true' : 'false'}
    >
      {/* Canvas Header: Title, Revisions, Draft/Checking Badges, View Mode Switcher */}
      <div className="pa-header">
        <div className="pa-row">
          <h2 className="pa-title">模型与图纸视图概览</h2>
          {isDraftDisplay ? (
            <span className="pa-pill pa-tone-pending" aria-label="草稿预览标识">
              ✎ 草稿
            </span>
          ) : null}
          {sameRevisionAligned ? (
            <span className="pa-pill pa-tone-pass" aria-label="同版对齐标识">
              ✓ 同版就绪
            </span>
          ) : null}
          {checksInProgress ? (
            <span className="pa-pill pa-tone-action" aria-label="检查进行中标识">
              ◌ 检查中
            </span>
          ) : null}
        </div>

        <div className="pa-controls" role="tablist" aria-label="中央画布视图切换">
          <button
            type="button"
            role="tab"
            aria-selected={effectiveViewMode === 'model'}
            data-artifact-status={modelStatusMeta.stateKey}
            title={modelStatusMeta.text}
            className={effectiveViewMode === 'model' ? 'pa-btn pa-btn-active' : 'pa-btn'}
            onClick={() => onChangeViewMode('model')}
          >
            模型
            {isNarrow ? <span aria-hidden="true"> {modelStatusMeta.symbol}</span> : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={effectiveViewMode === 'drawing'}
            data-artifact-status={drawingStatusMeta.stateKey}
            title={drawingStatusMeta.text}
            className={effectiveViewMode === 'drawing' ? 'pa-btn pa-btn-active' : 'pa-btn'}
            onClick={() => onChangeViewMode('drawing')}
          >
            图纸
            {isNarrow ? <span aria-hidden="true"> {drawingStatusMeta.symbol}</span> : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={effectiveViewMode === 'split'}
            disabled={isNarrow}
            title={isNarrow ? '窗口较窄时自动退化为模型/图纸标签页' : '模型与图纸并排联动'}
            className={effectiveViewMode === 'split' ? 'pa-btn pa-btn-active' : 'pa-btn'}
            onClick={() => onChangeViewMode('split')}
          >
            并排
          </button>
        </div>
      </div>

      {/* Explicit Model & Drawing Revision Header */}
      <div className="pa-canvas-revision-bar" aria-label="画布修订与就绪状态">
        <div className="pa-row">
          <span className="pa-pill pa-tone-muted pa-mono">
            模型修订：{formatRevisionDisplay(model.revision)}
          </span>
          <span className="pa-pill pa-tone-muted pa-mono">
            图纸修订：{formatRevisionDisplay(drawing.revision)}
          </span>
          <span className="pa-pill pa-tone-muted pa-mono">
            项目 {projectName} · 正式版 {baseRevision ?? '无'} · 草稿 {draftRevision ?? '无'}
          </span>
          <span className="pa-pill pa-tone-muted pa-mono">
            代际 #{scopeEpoch} · 写入代际 #{writerEpoch}
          </span>
        </div>
        {isNarrow ? (
          <div className="pa-row" role="status" aria-label="窄屏标签页降级状态">
            <span className="pa-pill pa-tone-pending">⇄ 窄屏自动降级为标签页</span>
            <span
              className={`pa-pill ${modelStatusMeta.toneClass}`}
              data-artifact-status={modelStatusMeta.stateKey}
            >
              <span aria-hidden="true">{modelStatusMeta.symbol}</span> {modelStatusMeta.text}
            </span>
            <span
              className={`pa-pill ${drawingStatusMeta.toneClass}`}
              data-artifact-status={drawingStatusMeta.stateKey}
            >
              <span aria-hidden="true">{drawingStatusMeta.symbol}</span> {drawingStatusMeta.text}
            </span>
          </div>
        ) : null}
      </div>

      {/* Partial Artifact Failure Banner */}
      {drawingFailure ? (
        <div className="pa-danger-box" role="alert" aria-label="部分产物失败提示">
          <div className="pa-header">
            <strong>
              {formatPartialDrawingFailureMessage(
                model.revision,
                drawingFailure,
                drawing.status === 'ready' ? drawing.revision : null,
              )}
            </strong>
            <button
              ref={retryDrawingButtonRef}
              type="button"
              className="pa-btn pa-btn-active"
              disabled={retryDrawingPending}
              onClick={onRetryDrawing}
            >
              {retryDrawingPending ? '正在重试图纸…' : '重试图纸'}
            </button>
          </div>
          <span className="pa-muted">失败原因：{drawingFailure.reason}</span>
          {retryDrawingFeedback ? (
            <span role="status" className="pa-muted">
              {retryDrawingFeedback}
            </span>
          ) : null}
        </div>
      ) : retryDrawingFeedback ? (
        <div className="pa-pass-box" role="status">
          <span>{retryDrawingFeedback}</span>
        </div>
      ) : null}

      {/* Natural Completion / Terminal Pending-Checks Summary Banner (F11 / E4: never auto-commits formal version) */}
      {naturalCompletionSummary ? (
        <div
          className={
            naturalCompletionSummary.allRequiredPassed &&
            !naturalCompletionSummary.isPendingChecksTerminal
              ? 'pa-pass-box'
              : 'pa-notice'
          }
          role="status"
          aria-label="自然完成摘要"
        >
          <div className="pa-header">
            <div className="pa-row">
              <strong>{naturalCompletionSummary.summaryText}</strong>
              <span className="pa-pill pa-tone-muted">
                {naturalCompletionSummary.isPendingChecksTerminal
                  ? naturalCompletionSummary.checksInProgress
                    ? '检查进行中 · 尚未满足正式保存条件'
                    : '等待检查结果 · 尚未满足正式保存条件'
                  : '尚未自动提交正式版本 · 需人工复核确认'}
              </span>
            </div>
            {onOpenCompletionView ? (
              <button
                type="button"
                className="pa-btn pa-btn-sm pa-btn-active"
                onClick={onOpenCompletionView}
              >
                前往复核与确认
              </button>
            ) : null}
          </div>
          <div className="pa-row">
            <span className="pa-pill pa-tone-action">
              要求 {naturalCompletionSummary.confirmedRequirements}/
              {naturalCompletionSummary.totalRequirements} 已确认
            </span>
            {naturalCompletionSummary.unmetRequiredCount > 0 ? (
              <span className="pa-pill pa-tone-pending">
                未满足必需要求 {naturalCompletionSummary.unmetRequiredCount}
              </span>
            ) : null}
            <span className="pa-pill pa-tone-pass">
              ✓ 通过 {naturalCompletionSummary.passCount}
            </span>
            <span className="pa-pill pa-tone-danger">
              ✕ 失败 {naturalCompletionSummary.failCount}
            </span>
            <span className="pa-pill pa-tone-pending">
              ? 待澄清 {naturalCompletionSummary.needsClarificationCount}
            </span>
            <span className="pa-pill pa-tone-muted">
              ○ 未覆盖 {naturalCompletionSummary.uncoveredCount}
            </span>
            <span className="pa-pill pa-tone-danger">
              ! 执行失败 {naturalCompletionSummary.executionFailedCount}
            </span>
          </div>
        </div>
      ) : null}

      {/* Stale Selection Banner */}
      {selectionInvalidated ? (
        <div className="pa-notice" role="alert" aria-label="选中对象失效提示">
          <strong>选中对象已失效，请重新选择或重绑</strong>
          {invalidatedObjectLabel ? (
            <span className="pa-muted">（原对象：{invalidatedObjectLabel}）</span>
          ) : null}
        </div>
      ) : null}

      {/* Dual View / Single View Split Canvas */}
      <div
        className={
          effectiveViewMode === 'split'
            ? 'pa-canvas-split pa-canvas-split-dual'
            : 'pa-canvas-split'
        }
      >
        {/* 3D Model View Pane */}
        {showModelPane ? (
          <section className="pa-viewport-card" aria-label="三维模型视图">
            <div className="pa-header">
              <div className="pa-row">
                <h3 className="pa-title">
                  3D 模型 · {formatRevisionDisplay(model.revision)}
                </h3>
                <span
                  className={`pa-pill ${modelStatusMeta.toneClass}`}
                  data-artifact-status={modelStatusMeta.stateKey}
                >
                  <span aria-hidden="true">{modelStatusMeta.symbol}</span> {modelStatusMeta.text}
                </span>
                {model.isDraft ? (
                  <span className="pa-pill pa-tone-pending">✎ 草稿 3D</span>
                ) : null}
              </div>
              <div className="pa-controls">
                <button
                  type="button"
                  className="pa-btn pa-btn-sm"
                  onClick={() =>
                    onUpdateCamera((prev) => ({ ...prev, yawDeg: prev.yawDeg - 15 }))
                  }
                >
                  左旋
                </button>
                <button
                  type="button"
                  className="pa-btn pa-btn-sm"
                  onClick={() =>
                    onUpdateCamera((prev) => ({ ...prev, yawDeg: prev.yawDeg + 15 }))
                  }
                >
                  右旋
                </button>
                <button
                  type="button"
                  className="pa-btn pa-btn-sm"
                  onClick={() =>
                    onUpdateCamera((prev) => ({
                      ...prev,
                      zoomPercent: Math.min(300, prev.zoomPercent + 20),
                    }))
                  }
                >
                  放大
                </button>
                <button
                  type="button"
                  className="pa-btn pa-btn-sm"
                  onClick={() =>
                    onUpdateCamera((prev) => ({
                      ...prev,
                      zoomPercent: Math.max(40, prev.zoomPercent - 20),
                    }))
                  }
                >
                  缩小
                </button>
                <button
                  type="button"
                  className="pa-btn pa-btn-sm"
                  onClick={() =>
                    onUpdateCamera(() => ({ yawDeg: 35, pitchDeg: 25, zoomPercent: 100 }))
                  }
                >
                  适合窗口
                </button>
              </div>
            </div>

            <div className="pa-viewport-meta pa-mono" aria-label="模型视角状态">
              视角 {camera.yawDeg}°/{camera.pitchDeg}° · 缩放 {camera.zoomPercent}%
              {model.fingerprint ? ` · 指纹 ${model.fingerprint}` : ''}
            </div>

            {model.status === 'empty' ? (
              <p className="pa-muted">○ 尚未生成可重建的三维模型草稿。</p>
            ) : (
              <>
                {modelMesh ? (
                  <M2ThreeMeshViewport
                    modelMesh={modelMesh}
                    camera={camera}
                    selectedObjectId={selectedObjectId}
                    highlightedFeatureIds={highlightedFeatureIds}
                    onPickRange={handlePickMeshRange}
                    onUpdateCamera={onUpdateCamera}
                  />
                ) : null}
                <div className="pa-feature-canvas" role="group" aria-label="三维模型特征拾取区">
                  {features.map((feat) => {
                    const isSelected = selectedObjectId === feat.objectId
                    const isHighlighted = highlightedFeatureIds.has(feat.objectId)
                    return (
                      <button
                        key={feat.objectId}
                        type="button"
                        data-feature-id={feat.objectId}
                        data-highlighted={isHighlighted ? 'true' : 'false'}
                        aria-pressed={isSelected}
                        className={`pa-canvas-chip ${isHighlighted ? 'pa-canvas-chip-highlighted' : ''} ${isSelected ? 'pa-canvas-chip-selected' : ''}`}
                        onClick={() => onSelectFeature(feat)}
                      >
                        <span className="pa-chip-title">{feat.breadcrumb}</span>
                        <span className="pa-mono pa-muted">{feat.featureRef}</span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </section>
        ) : null}

        {/* 2D Drawing View Pane */}
        {showDrawingPane ? (
          <section className="pa-viewport-card" aria-label="二维图纸视图">
            <div className="pa-header">
              <div className="pa-row">
                <h3 className="pa-title">
                  2D 图纸 · {formatRevisionDisplay(drawing.revision)}
                </h3>
                <span
                  className={`pa-pill ${drawingStatusMeta.toneClass}`}
                  data-artifact-status={drawingStatusMeta.stateKey}
                >
                  <span aria-hidden="true">{drawingStatusMeta.symbol}</span> {drawingStatusMeta.text}
                </span>
                {drawingFailure ? (
                  <span className="pa-pill pa-tone-pending">⚠ 显示上一有效图纸</span>
                ) : null}
              </div>
              <div className="pa-controls">
                <button
                  type="button"
                  className="pa-btn pa-btn-sm"
                  onClick={() =>
                    onUpdateDrawingViewport((prev) => ({
                      ...prev,
                      zoomPercent: Math.min(300, prev.zoomPercent + 25),
                    }))
                  }
                >
                  图纸放大
                </button>
                <button
                  type="button"
                  className="pa-btn pa-btn-sm"
                  onClick={() =>
                    onUpdateDrawingViewport((prev) => ({
                      ...prev,
                      zoomPercent: Math.max(50, prev.zoomPercent - 25),
                    }))
                  }
                >
                  图纸缩小
                </button>
                <button
                  type="button"
                  className="pa-btn pa-btn-sm"
                  onClick={() =>
                    onUpdateDrawingViewport(() => ({ panX: 0, panY: 0, zoomPercent: 100 }))
                  }
                >
                  图纸适合窗口
                </button>
              </div>
            </div>

            <div className="pa-viewport-meta pa-mono" aria-label="图纸缩放状态">
              图纸缩放 {drawingViewport.zoomPercent}% · 平移 ({drawingViewport.panX},{' '}
              {drawingViewport.panY})
              {drawing.fingerprint ? ` · 指纹 ${drawing.fingerprint}` : ''}
            </div>

            {drawing.status === 'empty' ? (
              <p className="pa-muted">○ 当前暂无二维图纸，等待投影完成后自动展示。</p>
            ) : drawingVector ? (
              <M2VectorDrawingViewport
                drawingVector={drawingVector}
                drawingRevision={drawing.revision}
                drawingFailure={drawingFailure}
                annotations={annotations}
                selectedAnnotationId={selectedAnnotationId}
                highlightedAnnotationIds={highlightedAnnotationIds}
                drawingViewport={drawingViewport}
                onSelectAnnotation={onSelectAnnotation}
                onUpdateDrawingViewport={onUpdateDrawingViewport}
              />
            ) : (
              <div className="pa-annotation-list" role="group" aria-label="图纸尺寸标注拾取区">
                {annotations.map((ann) => {
                  const isSelected = selectedAnnotationId === ann.annotationId
                  const isHighlighted = highlightedAnnotationIds.has(ann.annotationId)
                  return (
                    <button
                      key={ann.annotationId}
                      type="button"
                      data-annotation-id={ann.annotationId}
                      data-highlighted={isHighlighted ? 'true' : 'false'}
                      aria-pressed={isSelected}
                      className={`pa-canvas-chip ${isHighlighted ? 'pa-canvas-chip-highlighted' : ''} ${isSelected ? 'pa-canvas-chip-selected' : ''}`}
                      onClick={() => onSelectAnnotation(ann)}
                    >
                      <span className="pa-chip-title">{ann.label}</span>
                      <span className="pa-mono">{ann.valueText}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </section>
        ) : null}
      </div>

      {/* Selection Context Bar (对象引用上下文区) */}
      <section className="pa-card pa-context-bar" aria-label="对象引用上下文区">
        <div className="pa-header">
          <div className="pa-row">
            <span className="pa-card-label">当前选择</span>
            {selectedFeature ? (
              <>
                <strong data-testid="selection-breadcrumb">{selectedFeature.breadcrumb}</strong>
                <span className="pa-pill pa-tone-action pa-mono">
                  {selectedFeature.featureRef}
                </span>
              </>
            ) : (
              <span className="pa-muted">未选中任何几何对象</span>
            )}
          </div>

          <div className="pa-controls">
            <button
              type="button"
              className="pa-btn pa-btn-active"
              disabled={!selectedFeature}
              onClick={onBringIntoNextPrompt}
            >
              带入下一句话
            </button>
            <button
              type="button"
              className="pa-btn"
              disabled={!selectedFeature}
              onClick={onCopyToExternalSession}
            >
              复制到外部会话
            </button>
            <button
              type="button"
              className="pa-btn"
              disabled={!selectedFeature && !selectedAnnotationId}
              onClick={onClearSelection}
            >
              取消选择
            </button>
          </div>
        </div>

        {contextActionFeedback ? (
          <p className="pa-muted" role="status">
            {contextActionFeedback}
          </p>
        ) : null}

        {/* Keyboard-navigable Object List */}
        <section
          ref={objectListRegionRef}
          tabIndex={-1}
          className="pa-object-list-region pa-focus-region"
          aria-label="对象列表"
          onKeyDown={handleObjectListKeyDown}
        >
          <div className="pa-header">
            <span className="pa-card-label">对象列表（↑/↓ 切换对象，F6 / Shift+F6 跨区跳转）</span>
            <span className="pa-muted">
              主流程通过对话与特征选取驱动修改，不提供手动参数表、尺寸滑块或坐标编辑器。
            </span>
          </div>
          <div className="pa-controls" role="group" aria-label="可选几何特征对象">
            {features.map((obj, index) => (
              <button
                key={obj.objectId}
                ref={(el) => {
                  objectItemRefs.current[index] = el
                }}
                type="button"
                aria-pressed={selectedObjectId === obj.objectId}
                className={
                  selectedObjectId === obj.objectId ? 'pa-btn pa-btn-active' : 'pa-btn'
                }
                onClick={() => onSelectFeature(obj)}
              >
                {obj.breadcrumb}
              </button>
            ))}
          </div>
        </section>
      </section>

      {previewMessage ? (
        <div className="pa-pass-box" role="status">
          <span>{previewMessage}</span>
        </div>
      ) : null}
    </section>
  )
}
