import type { RefObject } from 'react'
import { CAMERA_PRESET_LABELS } from './assembly3dMath'
import type {
  AssemblyFeatureSelectionItem,
  AssemblyGroup,
  CameraPresetId,
  ContextPillActionId,
  DatumDefinition,
  GdtDisplayMode,
  GdtFeatureControl,
  GdtMaterialModifier,
  PartMesh,
  PickedFeatureGeometryKind,
} from './assembly3dTypes'
import type { DatumLetter } from './gdt3dMath'
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
import { M2ThreeMeshViewport, type AssemblyPickPayload } from './M2ThreeMeshViewport'
import { M2VectorDrawingViewport } from './M2VectorDrawingViewport'
import { AssemblyTreeOverlay } from './components/AssemblyTreeOverlay'
import { ContextActionPill } from './components/ContextActionPill'

const EMPTY_ASSEMBLY_FALLBACK_MESH: M2ModelMesh = {
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  indices: [0, 1, 2],
  triangleRanges: [],
  bounds: { min: [0, 0, 0], max: [1, 1, 1] },
}

const CAMERA_PRESET_ORDER: readonly CameraPresetId[] = ['iso', 'front', 'top', 'right']

export interface M2CenterCanvasProps {
  readonly viewMode: M2ViewMode
  readonly lastSingleTab: M2SingleViewTab
  readonly isNarrow: boolean
  readonly sidebarMode?: 'external' | 'builtin'
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
  readonly selectedObjectIds?: readonly string[]
  readonly selectedAnnotationId: string | null
  readonly highlightedFeatureIds: ReadonlySet<string>
  readonly highlightedAnnotationIds: ReadonlySet<string>
  readonly selectionInvalidated: boolean
  readonly invalidatedObjectLabel: string | null
  readonly camera: M2CameraState
  readonly drawingViewport: M2DrawingViewportState
  readonly structureOpen: boolean
  readonly retryDrawingPending: boolean
  readonly retryDrawingFeedback: string | null
  readonly contextActionFeedback: string | null
  readonly previewMessage: string | null
  readonly theme?: 'light' | 'dark'
  readonly canvasRegionRef: RefObject<HTMLElement | null>
  readonly objectListRegionRef: RefObject<HTMLElement | null>
  readonly retryDrawingButtonRef?: RefObject<HTMLButtonElement | null>
  readonly onToggleStructure: () => void
  readonly onCloseStructure: () => void
  readonly onSelectFeature: (
    feature: M2ModelFeatureItem,
    options?: { readonly additive?: boolean },
  ) => void
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
  /** M1B 3D assembly extensions (disabled when FEATURE_3D_ASSEMBLY_M1 is false). */
  readonly feature3dAssemblyM1?: boolean
  readonly assemblyGroups?: readonly AssemblyGroup[]
  readonly partMeshes?: readonly PartMesh[]
  readonly hiddenPartIds?: ReadonlySet<string>
  readonly explosionFactor?: number
  readonly xrayMode?: boolean
  readonly selectedAssemblyItems?: readonly AssemblyFeatureSelectionItem[]
  readonly additivePickMode?: boolean
  readonly activeCameraPreset?: CameraPresetId
  readonly onTogglePartVisibility?: (partId: string) => void
  readonly onSetPartsVisibility?: (partIds: readonly string[], hidden: boolean) => void
  readonly onSelectPart?: (partId: string) => void
  readonly onChangeExplosionFactor?: (factor: number) => void
  readonly onToggleXrayMode?: () => void
  readonly onPickAssemblyFeature?: (payload: AssemblyPickPayload) => void
  readonly onExecuteAssemblyAction?: (actionId: ContextPillActionId) => void
  readonly onSelectCameraPreset?: (preset: CameraPresetId) => void
  /** M3G 3D GD&T & Datum overlays + inline micro-editing. */
  readonly datums?: readonly DatumDefinition[]
  readonly gdtControls?: readonly GdtFeatureControl[]
  readonly gdtPreviewControls?: readonly GdtFeatureControl[]
  readonly gdtPreviewDatums?: readonly DatumDefinition[]
  readonly gdtDisplayMode?: GdtDisplayMode
  readonly onChangeGdtDisplayMode?: (mode: GdtDisplayMode) => void
  readonly focusedLoopFeatureIds?: ReadonlySet<string>
  readonly goldenPulseFeatureIds?: ReadonlySet<string>
  readonly goldenPulseGdtIds?: ReadonlySet<string>
  readonly editingGdtId?: string | null
  readonly featureKindById?: ReadonlyMap<string, PickedFeatureGeometryKind>
  readonly onSelectGdtCallout?: (gdtId: string | null) => void
  readonly onHoverGdtCallout?: (
    target: {
      readonly gdtId?: string
      readonly datumId?: string
      readonly featureId: string
      readonly partId?: string
    } | null,
  ) => void
  readonly onAssignDatum?: (featureId: string, letter: DatumLetter) => void
  readonly onCreateGdtControl?: (control: GdtFeatureControl) => void
  readonly onUpdateGdtCallout?: (
    gdtId: string,
    patch: { readonly toleranceQ?: number; readonly modifier?: GdtMaterialModifier },
  ) => void
  readonly onDeleteGdtCallout?: (gdtId: string) => void
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
  viewMode,
  lastSingleTab,
  isNarrow,
  sidebarMode = 'external',
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
  selectedObjectIds,
  selectedAnnotationId,
  highlightedFeatureIds,
  highlightedAnnotationIds,
  selectionInvalidated,
  invalidatedObjectLabel,
  camera,
  drawingViewport,
  structureOpen,
  retryDrawingPending,
  retryDrawingFeedback,
  contextActionFeedback,
  previewMessage,
  theme = 'light',
  canvasRegionRef,
  objectListRegionRef,
  retryDrawingButtonRef,
  onToggleStructure,
  onCloseStructure,
  onSelectFeature,
  onSelectAnnotation,
  onClearSelection,
  onBringIntoNextPrompt,
  onCopyToExternalSession,
  onRetryDrawing,
  onOpenCompletionView,
  onUpdateCamera,
  onUpdateDrawingViewport,
  feature3dAssemblyM1 = false,
  assemblyGroups,
  partMeshes = [],
  hiddenPartIds,
  explosionFactor = 0,
  xrayMode = false,
  selectedAssemblyItems = [],
  additivePickMode = false,
  activeCameraPreset = 'iso',
  onTogglePartVisibility,
  onSetPartsVisibility,
  onSelectPart,
  onChangeExplosionFactor,
  onToggleXrayMode,
  onPickAssemblyFeature,
  onExecuteAssemblyAction,
  onSelectCameraPreset,
  datums = [],
  gdtControls = [],
  gdtPreviewControls = [],
  gdtPreviewDatums = [],
  gdtDisplayMode = 'smart',
  onChangeGdtDisplayMode,
  focusedLoopFeatureIds,
  goldenPulseFeatureIds,
  goldenPulseGdtIds,
  editingGdtId = null,
  featureKindById,
  onSelectGdtCallout,
  onHoverGdtCallout,
  onAssignDatum,
  onCreateGdtControl,
  onUpdateGdtCallout,
  onDeleteGdtCallout,
}: M2CenterCanvasProps) {
  const effectiveViewMode = resolveEffectiveViewMode(viewMode, isNarrow, lastSingleTab)
  const showModelPane = effectiveViewMode === 'model' || effectiveViewMode === 'split'
  const showDrawingPane = effectiveViewMode === 'drawing' || effectiveViewMode === 'split'
  const sameRevisionAligned = areArtifactsRevisionAligned(model, drawing)
  const selectedFeature = features.find((f) => f.objectId === selectedObjectId) ?? null
  const isDraftDisplay = model.isDraft || drawing.isDraft
  const modelStatusMeta = getArtifactStatusMeta(model, '模型')
  const drawingStatusMeta = getArtifactStatusMeta(drawing, '图纸', drawingFailure)

  const handlePickMeshRange = (range: M2MeshTriangleRange) => {
    const matched =
      features.find((f) => f.objectId === range.objectId) ??
      (range.featureRef ? features.find((f) => f.featureRef === range.featureRef) : undefined)
    if (matched) {
      onSelectFeature(matched)
    }
  }

  return (
    <section
      ref={canvasRegionRef}
      tabIndex={-1}
      className="pa-panel pa-canvas-column pa-focus-region"
      aria-label="中央画布"
      data-effective-view={effectiveViewMode}
      data-narrow-degraded={isNarrow && viewMode === 'split' ? 'true' : 'false'}
    >
      {/* Contextual Banners: 0 banners in normal state; appear ONLY on real exception / completion */}
      {isNarrow ? (
        <div className="pa-canvas-narrow-strip" role="status" aria-label="窄屏标签页降级状态">
          <span className="pa-pill pa-tone-pending">⇄ 窄屏标签页模式</span>
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

      {drawingFailure ? (
        <div
          className="pa-danger-box pa-partial-fail-strip"
          role="alert"
          aria-label="部分产物失败提示"
        >
          <div className="pa-header">
            <div className="pa-row">
              <strong>
                {formatPartialDrawingFailureMessage(
                  model.revision,
                  drawingFailure,
                  drawing.status === 'ready' ? drawing.revision : null,
                )}
              </strong>
              <span className="pa-muted">原因：{drawingFailure.reason}</span>
            </div>
            <button
              ref={retryDrawingButtonRef}
              type="button"
              className="pa-btn pa-btn-primary pa-btn-sm"
              disabled={retryDrawingPending}
              onClick={onRetryDrawing}
            >
              {retryDrawingPending ? '正在重试图纸…' : '重试图纸'}
            </button>
          </div>
          {retryDrawingFeedback ? (
            <span role="status" className="pa-muted">
              {retryDrawingFeedback}
            </span>
          ) : null}
        </div>
      ) : retryDrawingFeedback ? (
        <div className="pa-pass-box pa-canvas-alert-strip" role="status">
          <span>{retryDrawingFeedback}</span>
        </div>
      ) : null}

      {naturalCompletionSummary ? (
        <div
          className={
            naturalCompletionSummary.allRequiredPassed &&
            !naturalCompletionSummary.isPendingChecksTerminal
              ? 'pa-pass-box pa-canvas-alert-strip'
              : 'pa-notice pa-canvas-alert-strip'
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
            {naturalCompletionSummary.failCount > 0 ? (
              <span className="pa-pill pa-tone-danger">
                ✕ 失败 {naturalCompletionSummary.failCount}
              </span>
            ) : null}
            {naturalCompletionSummary.needsClarificationCount > 0 ? (
              <span className="pa-pill pa-tone-pending">
                ? 待澄清 {naturalCompletionSummary.needsClarificationCount}
              </span>
            ) : null}
            {naturalCompletionSummary.uncoveredCount > 0 ? (
              <span className="pa-pill pa-tone-muted">
                ○ 未覆盖 {naturalCompletionSummary.uncoveredCount}
              </span>
            ) : null}
            {naturalCompletionSummary.executionFailedCount > 0 ? (
              <span className="pa-pill pa-tone-danger">
                ! 执行失败 {naturalCompletionSummary.executionFailedCount}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {selectionInvalidated ? (
        <div className="pa-notice pa-canvas-alert-strip" role="alert" aria-label="选中对象失效提示">
          <strong>选中对象已失效，请重新选择或重绑</strong>
          {invalidatedObjectLabel ? (
            <span className="pa-muted">（原对象：{invalidatedObjectLabel}）</span>
          ) : null}
        </div>
      ) : null}

      {/* Main Canvas Stage with Minimal Floating Overlays */}
      <div className="pa-canvas-stage-wrap">
        {/* Top-Left Lightweight Overlay: Collapsible Structure Chip + Quiet Status Pills */}
        <div className="pa-canvas-overlay-tl">
          <AssemblyTreeOverlay
            features={features}
            selectedObjectId={selectedObjectId}
            selectedObjectIds={selectedObjectIds}
            highlightedFeatureIds={highlightedFeatureIds}
            structureOpen={structureOpen}
            objectListRegionRef={objectListRegionRef}
            onToggleStructure={onToggleStructure}
            onCloseStructure={onCloseStructure}
            onSelectFeature={onSelectFeature}
            showAssemblyControls={feature3dAssemblyM1}
            assemblyGroups={feature3dAssemblyM1 ? assemblyGroups : undefined}
            partMeshes={feature3dAssemblyM1 ? partMeshes : undefined}
            hiddenPartIds={hiddenPartIds}
            onTogglePartVisibility={onTogglePartVisibility}
            onSetPartsVisibility={onSetPartsVisibility}
            onSelectPart={onSelectPart}
            explosionFactor={explosionFactor}
            onChangeExplosionFactor={onChangeExplosionFactor}
            xrayMode={xrayMode}
            onToggleXrayMode={onToggleXrayMode}
          />

          {isDraftDisplay ? (
            <span className="pa-pill pa-tone-pending pa-float-pill" aria-label="草稿预览标识">
              ✎ 草稿
            </span>
          ) : null}
          {sameRevisionAligned ? (
            <span className="pa-pill pa-tone-pass pa-float-pill" aria-label="同版对齐标识">
              ✓ 同版就绪
            </span>
          ) : null}
          {checksInProgress ? (
            <span className="pa-pill pa-tone-action pa-float-pill" aria-label="检查进行中标识">
              ◌ 检查中
            </span>
          ) : null}
        </div>

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
            <section className="pa-viewport-card pa-viewport-clean" aria-label="三维模型视图">
              <div className="pa-viewport-corner-tag">
                <span className="pa-mono">3D · {formatRevisionDisplay(model.revision)}</span>
                <span
                  className={`pa-pill ${modelStatusMeta.toneClass}`}
                  data-artifact-status={modelStatusMeta.stateKey}
                >
                  <span aria-hidden="true">{modelStatusMeta.symbol}</span> {modelStatusMeta.text}
                </span>
              </div>

              {model.status === 'empty' && !(feature3dAssemblyM1 && partMeshes.length > 0) ? (
                <div className="pa-viewport-empty">
                  <p className="pa-muted">○ 尚未生成三维模型，可在右侧对话中描述需求开始建模。</p>
                </div>
              ) : (
                <div className="pa-viewport-body">
                  {modelMesh || (feature3dAssemblyM1 && partMeshes.length > 0) ? (
                    <M2ThreeMeshViewport
                      modelMesh={modelMesh ?? EMPTY_ASSEMBLY_FALLBACK_MESH}
                      camera={camera}
                      selectedObjectId={selectedObjectId}
                      selectedObjectIds={selectedObjectIds}
                      highlightedFeatureIds={highlightedFeatureIds}
                      theme={theme}
                      onPickRange={handlePickMeshRange}
                      onUpdateCamera={onUpdateCamera}
                      partMeshes={feature3dAssemblyM1 ? partMeshes : undefined}
                      explosionFactor={feature3dAssemblyM1 ? explosionFactor : 0}
                      xrayMode={feature3dAssemblyM1 ? xrayMode : false}
                      hiddenPartIds={feature3dAssemblyM1 ? hiddenPartIds : undefined}
                      additivePickMode={feature3dAssemblyM1 ? additivePickMode : false}
                      onPickAssemblyFeature={feature3dAssemblyM1 ? onPickAssemblyFeature : undefined}
                      datums={feature3dAssemblyM1 ? datums : undefined}
                      gdtControls={feature3dAssemblyM1 ? gdtControls : undefined}
                      gdtPreviewControls={feature3dAssemblyM1 ? gdtPreviewControls : undefined}
                      gdtPreviewDatums={feature3dAssemblyM1 ? gdtPreviewDatums : undefined}
                      gdtDisplayMode={feature3dAssemblyM1 ? gdtDisplayMode : undefined}
                      onChangeGdtDisplayMode={
                        feature3dAssemblyM1 ? onChangeGdtDisplayMode : undefined
                      }
                      focusedLoopFeatureIds={
                        feature3dAssemblyM1 ? focusedLoopFeatureIds : undefined
                      }
                      goldenPulseFeatureIds={
                        feature3dAssemblyM1 ? goldenPulseFeatureIds : undefined
                      }
                      goldenPulseGdtIds={feature3dAssemblyM1 ? goldenPulseGdtIds : undefined}
                      editingGdtId={feature3dAssemblyM1 ? editingGdtId : null}
                      onSelectGdtCallout={feature3dAssemblyM1 ? onSelectGdtCallout : undefined}
                      onHoverGdtCallout={feature3dAssemblyM1 ? onHoverGdtCallout : undefined}
                      onUpdateGdtCallout={feature3dAssemblyM1 ? onUpdateGdtCallout : undefined}
                      onDeleteGdtCallout={feature3dAssemblyM1 ? onDeleteGdtCallout : undefined}
                    />
                  ) : (
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
                  )}
                </div>
              )}

              {/* Subtle Bottom Telemetry + Camera Presets (M1B only) + Fit Button */}
              <div className="pa-viewport-overlay-bottom">
                <span className="pa-viewport-meta pa-mono" aria-label="模型视角状态">
                  视角 {camera.yawDeg}°/{camera.pitchDeg}° · 缩放 {camera.zoomPercent}%
                </span>
                <div className="pa-viewport-camera-actions">
                  {feature3dAssemblyM1 ? (
                    <div
                      className="pa-camera-preset-group"
                      role="group"
                      aria-label="三维标准视角预设"
                      data-testid="camera-preset-group"
                    >
                      {CAMERA_PRESET_ORDER.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          data-testid={`camera-preset-${preset}`}
                          aria-pressed={activeCameraPreset === preset}
                          className={`pa-float-fit-btn ${activeCameraPreset === preset ? 'pa-float-fit-btn-active' : ''}`}
                          onClick={() => onSelectCameraPreset?.(preset)}
                        >
                          {CAMERA_PRESET_LABELS[preset]}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className="pa-float-fit-btn"
                    aria-label="适合窗口"
                    title="复位三维视角并适合窗口（支持拖拽旋转、滚轮缩放）"
                    onClick={() => {
                      if (feature3dAssemblyM1 && onSelectCameraPreset) {
                        onSelectCameraPreset('iso')
                      } else {
                        onUpdateCamera(() => ({ yawDeg: 35, pitchDeg: 25, zoomPercent: 100 }))
                      }
                    }}
                  >
                    适配
                  </button>
                </div>
              </div>
            </section>
          ) : null}

          {/* 2D Drawing View Pane */}
          {showDrawingPane ? (
            <section className="pa-viewport-card pa-viewport-clean" aria-label="二维图纸视图">
              <div className="pa-viewport-corner-tag">
                <span className="pa-mono">2D · {formatRevisionDisplay(drawing.revision)}</span>
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

              {drawing.status === 'empty' ? (
                <div className="pa-viewport-empty">
                  <p className="pa-muted">○ 当前暂无二维图纸，等待投影完成后自动展示。</p>
                </div>
              ) : (
                <div className="pa-viewport-body">
                  {drawingVector ? (
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
                </div>
              )}

              {/* Subtle Bottom Telemetry + Single Transparent Fit Button */}
              <div className="pa-viewport-overlay-bottom">
                <span className="pa-viewport-meta pa-mono" aria-label="图纸缩放状态">
                  图纸缩放 {drawingViewport.zoomPercent}% · 平移 ({drawingViewport.panX},{' '}
                  {drawingViewport.panY})
                </span>
                <button
                  type="button"
                  className="pa-float-fit-btn"
                  aria-label="图纸适合窗口"
                  title="复位二维图纸并适合窗口（支持拖拽平移、滚轮缩放）"
                  onClick={() =>
                    onUpdateDrawingViewport(() => ({ panX: 0, panY: 0, zoomPercent: 100 }))
                  }
                >
                  适配
                </button>
              </div>
            </section>
          ) : null}
        </div>

        {/* Floating Selection Context Bar: 100% HIDDEN when nothing is selected */}
        <ContextActionPill
          selectedFeature={selectedFeature}
          sidebarMode={sidebarMode}
          contextActionFeedback={contextActionFeedback}
          onBringIntoNextPrompt={onBringIntoNextPrompt}
          onCopyToExternalSession={onCopyToExternalSession}
          onClearSelection={onClearSelection}
          assemblyMode={feature3dAssemblyM1}
          selectedAssemblyItems={feature3dAssemblyM1 ? selectedAssemblyItems : undefined}
          additivePickMode={feature3dAssemblyM1 ? additivePickMode : false}
          onExecuteAssemblyAction={feature3dAssemblyM1 ? onExecuteAssemblyAction : undefined}
          datums={feature3dAssemblyM1 ? datums : undefined}
          featureKindById={feature3dAssemblyM1 ? featureKindById : undefined}
          onAssignDatum={feature3dAssemblyM1 ? onAssignDatum : undefined}
          onCreateGdtControl={feature3dAssemblyM1 ? onCreateGdtControl : undefined}
        />

        {previewMessage ? (
          <div className="pa-preview-toast" role="status">
            <span>{previewMessage}</span>
          </div>
        ) : null}
      </div>
    </section>
  )
}
