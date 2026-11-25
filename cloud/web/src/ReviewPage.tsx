import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createHttpTransport } from '../../../src/transport/httpTransport'
import type { CheckSet, CommitDraftResult, Transport } from '../../../src/transport/types'
import { M2ThreeMeshViewport } from '../../../src/workspace/project-agent/M2ThreeMeshViewport'
import { M2VectorDrawingViewport } from '../../../src/workspace/project-agent/M2VectorDrawingViewport'
import {
  DEFAULT_M2_CAMERA,
  DEFAULT_M2_DRAWING_VIEWPORT,
  normalizeM2ModelMesh,
  type M2CameraState,
  type M2CheckItem,
  type M2DrawingAnnotationItem,
  type M2DrawingViewportState,
  type M2MeshTriangleRange,
  type M2ModelMesh,
  type M2ViewMode,
} from '../../../src/workspace/project-agent/m2WorkbenchBridge'
import '../../../src/workspace/project-agent/ProjectAgentPanel.css'
import './review.css'
import {
  buildReviewDrawingModel,
  collectCheckEvidenceItems,
  extractWebhookStatus,
  getCheckStatusDisplay,
  isConflictErrorCode,
} from './reviewHelpers'
import { parseReviewRoute, type ParsedReviewRoute, type RouteLocationLike } from './router'

export interface ReviewPageProps {
  /** Optional parsed route override; defaults to parsing `window.location`. */
  readonly route?: ParsedReviewRoute
  /** Optional location override for testing `/review/:projectId/:draftRev` routing. */
  readonly locationLike?: RouteLocationLike
  /** Optional Transport injection for unit tests; defaults to `createHttpTransport`. */
  readonly transport?: Transport
}

type LoadPhase = 'loading' | 'ready' | 'conflict' | 'committed' | 'error'

interface ReviewDataState {
  readonly review: CheckSet
  readonly summary: string
  readonly baseRevision: string | null
  readonly mesh: M2ModelMesh | null
  readonly drawingFingerprint: string | null
  readonly rawSvgAvailable: boolean
}

function createRequestToken(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function ReviewPage({ route: routeProp, locationLike, transport: transportProp }: ReviewPageProps) {
  const route = useMemo<ParsedReviewRoute>(() => {
    if (routeProp) return routeProp
    if (locationLike) return parseReviewRoute(locationLike)
    if (typeof window !== 'undefined') {
      return parseReviewRoute(window.location)
    }
    return {
      matched: false,
      rawPath: '/',
      reason: '缺少浏览器路由上下文。',
    }
  }, [routeProp, locationLike])

  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    route.matched && route.theme ? route.theme : 'light',
  )
  const [viewMode, setViewMode] = useState<M2ViewMode>('split')
  const [camera, setCamera] = useState<M2CameraState>(DEFAULT_M2_CAMERA)
  const [drawingViewport, setDrawingViewport] = useState<M2DrawingViewportState>(
    DEFAULT_M2_DRAWING_VIEWPORT,
  )

  const [phase, setPhase] = useState<LoadPhase>('loading')
  const [data, setData] = useState<ReviewDataState | null>(null)
  const [loadError, setLoadError] = useState<{ code: string; message: string; detail?: string } | null>(
    null,
  )

  const [selectedCheckId, setSelectedCheckId] = useState<string | null>(null)
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null)
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null)

  const [humanConfirmed, setHumanConfirmed] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState(() =>
    route.matched && route.webhookUrl ? route.webhookUrl : '',
  )
  const [committing, setCommitting] = useState(false)
  const [commitError, setCommitError] = useState<{
    readonly code: string
    readonly message: string
    readonly detail?: string
    readonly isConflict: boolean
  } | null>(null)
  const [commitResult, setCommitResult] = useState<CommitDraftResult | null>(null)

  const transport = useMemo<Transport | null>(() => {
    if (transportProp) return transportProp
    if (!route.matched) return null
    return createHttpTransport({
      baseUrl: route.apiBase,
      apiKey: route.apiKey,
    })
  }, [transportProp, route])

  const loadSeqRef = useRef(0)

  const fetchAllReviewData = useCallback(async () => {
    if (!route.matched || !transport) return
    const seq = loadSeqRef.current + 1
    loadSeqRef.current = seq

    setPhase('loading')
    setLoadError(null)
    setCommitError(null)
    setHumanConfirmed(false)

    const draftRef = {
      projectId: route.projectId,
      draftRevision: route.draftRevision,
    }

    const [reviewRes, meshRes, drawingRes, statusRes] = await Promise.all([
      transport.getReview(draftRef),
      transport.triangulate(draftRef),
      transport.getDrawing({ ...draftRef, format: 'svg' }),
      transport.getCommitStatus(draftRef),
    ])

    if (loadSeqRef.current !== seq) return

    if (!reviewRes.ok) {
      const conflict = isConflictErrorCode(reviewRes.error.code)
      setLoadError(reviewRes.error)
      setPhase(conflict ? 'conflict' : 'error')
      return
    }

    const normalizedMesh = meshRes.ok ? normalizeM2ModelMesh(meshRes.value) : null
    const drawingFp = drawingRes.ok ? drawingRes.value.fingerprint : null
    const rawSvgAvailable = drawingRes.ok && drawingRes.value.bytes.byteLength > 0

    const nextData: ReviewDataState = {
      review: reviewRes.value.review,
      summary: reviewRes.value.summary,
      baseRevision: reviewRes.value.baseRevision,
      mesh: normalizedMesh,
      drawingFingerprint: drawingFp,
      rawSvgAvailable,
    }
    setData(nextData)

    const firstProblem = reviewRes.value.review.checks.find(
      (c) => getCheckStatusDisplay(c.status).isProblem,
    )
    const initialCheck = firstProblem ?? reviewRes.value.review.checks[0] ?? null
    setSelectedCheckId(initialCheck?.checkId ?? null)
    setSelectedObjectId(initialCheck?.linkedFeatureIds[0] ?? null)
    setSelectedAnnotationId(initialCheck?.linkedAnnotationIds[0] ?? null)

    if (statusRes.ok && statusRes.value.state === 'committed') {
      setCommitResult(statusRes.value.result)
      setPhase('committed')
    } else {
      setCommitResult(null)
      setPhase('ready')
    }
  }, [route, transport])

  useEffect(() => {
    if (!route.matched) return
    const handle = queueMicrotask(() => {
      void fetchAllReviewData()
    })
    void handle
  }, [route.matched, fetchAllReviewData])

  const checks = useMemo<readonly M2CheckItem[]>(
    () => data?.review.checks ?? [],
    [data],
  )

  const checkCounts = useMemo(() => {
    let pass = 0
    let fail = 0
    let pending = 0
    let other = 0
    for (const c of checks) {
      if (c.status === 'pass') pass += 1
      else if (c.status === 'fail' || c.status === 'executionFailed') fail += 1
      else if (c.status === 'needsClarification' || c.status === 'checking') pending += 1
      else other += 1
    }
    return { total: checks.length, pass, fail, pending, other }
  }, [checks])

  const blockingChecks = useMemo(
    () => checks.filter((c) => c.required && c.status !== 'pass'),
    [checks],
  )

  const failedFeatureIds = useMemo(() => {
    const ids = new Set<string>()
    for (const c of checks) {
      if (getCheckStatusDisplay(c.status).isProblem) {
        for (const fid of c.linkedFeatureIds) {
          ids.add(fid)
        }
      }
    }
    return ids
  }, [checks])

  const selectedCheck = useMemo(
    () => checks.find((c) => c.checkId === selectedCheckId) ?? null,
    [checks, selectedCheckId],
  )

  const highlightedFeatureIds = useMemo(() => {
    const ids = new Set<string>(failedFeatureIds)
    if (selectedCheck) {
      for (const fid of selectedCheck.linkedFeatureIds) {
        ids.add(fid)
      }
    }
    if (selectedObjectId) {
      ids.add(selectedObjectId)
    }
    return ids
  }, [failedFeatureIds, selectedCheck, selectedObjectId])

  const highlightedAnnotationIds = useMemo(() => {
    const ids = new Set<string>()
    if (selectedCheck) {
      for (const aid of selectedCheck.linkedAnnotationIds) {
        ids.add(aid)
      }
    }
    if (selectedAnnotationId) {
      ids.add(selectedAnnotationId)
    }
    return ids
  }, [selectedCheck, selectedAnnotationId])

  const drawingModel = useMemo(
    () =>
      buildReviewDrawingModel({
        draftRevision: route.matched ? route.draftRevision : '',
        checks,
        mesh: data?.mesh ?? null,
      }),
    [route, checks, data?.mesh],
  )

  const evidenceItems = useMemo(() => {
    if (!selectedCheck) return []
    return collectCheckEvidenceItems(selectedCheck, data?.review.evidenceByCheckId)
  }, [selectedCheck, data?.review.evidenceByCheckId])

  const handleSelectCheck = useCallback((check: M2CheckItem) => {
    setSelectedCheckId(check.checkId)
    setSelectedObjectId(check.linkedFeatureIds[0] ?? null)
    setSelectedAnnotationId(check.linkedAnnotationIds[0] ?? null)
  }, [])

  const handlePick3dRange = useCallback(
    (range: M2MeshTriangleRange) => {
      setSelectedObjectId(range.objectId)
      const matchedCheck = checks.find((c) => c.linkedFeatureIds.includes(range.objectId))
      if (matchedCheck) {
        setSelectedCheckId(matchedCheck.checkId)
        setSelectedAnnotationId(matchedCheck.linkedAnnotationIds[0] ?? null)
      }
    },
    [checks],
  )

  const handleSelect2dAnnotation = useCallback(
    (annotation: M2DrawingAnnotationItem) => {
      setSelectedAnnotationId(annotation.annotationId)
      const firstFeature = annotation.linkedFeatureIds[0] ?? null
      if (firstFeature) {
        setSelectedObjectId(firstFeature)
      }
      const matchedCheck = checks.find(
        (c) =>
          c.linkedAnnotationIds.includes(annotation.annotationId) ||
          (firstFeature !== null && c.linkedFeatureIds.includes(firstFeature)),
      )
      if (matchedCheck) {
        setSelectedCheckId(matchedCheck.checkId)
      }
    },
    [checks],
  )

  const handleFocusFailedFeature = useCallback(
    (featureId: string) => {
      setSelectedObjectId(featureId)
      const matchedCheck = checks.find((c) => c.linkedFeatureIds.includes(featureId))
      if (matchedCheck) {
        setSelectedCheckId(matchedCheck.checkId)
        setSelectedAnnotationId(matchedCheck.linkedAnnotationIds[0] ?? null)
      }
    },
    [checks],
  )

  const webhookValidationError = useMemo(() => {
    const trimmed = webhookUrl.trim()
    if (!trimmed) return null
    if (!trimmed.startsWith('https://')) {
      return 'Webhook 地址必须使用 https:// 协议'
    }
    return null
  }, [webhookUrl])

  const canCommit =
    phase === 'ready' &&
    data !== null &&
    blockingChecks.length === 0 &&
    humanConfirmed &&
    !committing &&
    webhookValidationError === null

  const handleCommitDraft = useCallback(async () => {
    if (!route.matched || !transport || !data || !canCommit) return
    setCommitting(true)
    setCommitError(null)

    const trimmedWebhook = webhookUrl.trim()
    const res = await transport.commitDraft({
      projectId: route.projectId,
      baseRevision: data.baseRevision,
      draftRevision: route.draftRevision,
      checksetFingerprint: data.review.checksetFingerprint,
      confirmationToken: createRequestToken('human-confirm'),
      requestId: createRequestToken('req-commit'),
      ...(trimmedWebhook ? { webhook: { url: trimmedWebhook } } : {}),
    })

    setCommitting(false)

    if (!res.ok) {
      const conflict = isConflictErrorCode(res.error.code)
      setCommitError({
        code: res.error.code,
        message: res.error.message,
        detail: res.error.detail,
        isConflict: conflict,
      })
      if (conflict) {
        setPhase('conflict')
      }
      return
    }

    setCommitResult(res.value)
    setPhase('committed')
  }, [route, transport, data, canCommit, webhookUrl])

  if (!route.matched) {
    return (
      <div className="pa-workbench cw-shell" data-theme={theme} data-testid="review-invalid-route">
        <div className="cw-invalid-route">
          <h1 className="pa-title">寸链 · 云端 3D 审核确认工作台</h1>
          <p className="pa-muted">{route.reason}</p>
          <p className="pa-mono">当前路径：{route.rawPath}</p>
          <p className="pa-muted">
            示例地址：
            <span className="pa-mono">/review/proj-demo/draft-1</span> 或{' '}
            <span className="pa-mono">#/review/proj-demo/draft-1</span>
          </p>
        </div>
      </div>
    )
  }

  const statusBadge = (() => {
    if (phase === 'loading') {
      return { text: '加载中', cls: 'pa-tone-action' }
    }
    if (phase === 'committed') {
      return { text: '已正式提交', cls: 'pa-tone-pass' }
    }
    if (phase === 'conflict') {
      return { text: '版本/指纹冲突', cls: 'pa-tone-danger' }
    }
    if (phase === 'error') {
      return { text: '加载失败', cls: 'pa-tone-execfail' }
    }
    if (blockingChecks.length > 0) {
      return { text: `存在 ${blockingChecks.length} 项阻塞`, cls: 'pa-tone-danger' }
    }
    return { text: '待人工确认', cls: 'pa-tone-pending' }
  })()

  const webhookView = commitResult
    ? extractWebhookStatus(commitResult, webhookUrl.trim() || undefined)
    : null

  return (
    <div className="pa-workbench cw-shell" data-theme={theme} data-testid="cloud-review-workbench">
      {/* 顶部极简审核栏 */}
      <header className="cw-topbar">
        <div className="cw-topbar-left">
          <span className="cw-brand">寸链审核台</span>
          <span className="cw-meta-chip pa-mono" data-testid="review-project-id">
            项目 {route.projectId}
          </span>
          <span className="cw-meta-chip pa-mono" data-testid="review-draft-rev">
            草稿 {route.draftRevision}
          </span>
          <span className={`pa-pill ${statusBadge.cls}`} data-testid="review-status-pill">
            {statusBadge.text}
          </span>
        </div>

        {/* 唯一一处居中三视图切换 */}
        <div className="cw-topbar-center">
          <div className="cw-segmented" role="group" aria-label="视图模式切换">
            <button
              type="button"
              aria-pressed={viewMode === 'model'}
              onClick={() => setViewMode('model')}
            >
              模型
            </button>
            <button
              type="button"
              aria-pressed={viewMode === 'drawing'}
              onClick={() => setViewMode('drawing')}
            >
              图纸
            </button>
            <button
              type="button"
              aria-pressed={viewMode === 'split'}
              onClick={() => setViewMode('split')}
            >
              并排
            </button>
          </div>
        </div>

        <div className="cw-topbar-right">
          <button
            type="button"
            className="cw-btn"
            onClick={() => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))}
          >
            {theme === 'light' ? '深色 CAD' : '浅色工作台'}
          </button>
          <button
            type="button"
            className="cw-btn"
            onClick={() => void fetchAllReviewData()}
            disabled={phase === 'loading'}
          >
            刷新
          </button>
        </div>
      </header>

      {/* 主体：中央 3D/2D 视口 + 右侧检查溯源与人工确认 */}
      <main className="cw-main">
        <section className="cw-viewport-area" aria-label="三维模型与二维工程图视口">
          {loadError ? (
            <div className="cw-alert cw-alert-danger" role="alert" data-testid="review-load-error">
              <strong>
                加载审核数据失败（{loadError.code}）：{loadError.message}
              </strong>
              {loadError.detail ? <span className="pa-mono">{loadError.detail}</span> : null}
              <div>
                <button
                  type="button"
                  className="cw-btn"
                  onClick={() => void fetchAllReviewData()}
                >
                  重试加载
                </button>
              </div>
            </div>
          ) : null}

          <div
            className="cw-viewport-grid"
            data-testid="review-viewport-grid"
            data-view-mode={viewMode}
          >
            {(viewMode === 'model' || viewMode === 'split') && (
              <div
                className={`cw-stage-card ${failedFeatureIds.size > 0 ? 'cw-viewport-has-issues' : ''}`}
                data-testid="review-3d-card"
                data-has-failed-features={failedFeatureIds.size > 0 ? 'true' : 'false'}
              >
                <div className="cw-stage-header">
                  <span>三维模型预览</span>
                  <div className="cw-stage-tools">
                    <button
                      type="button"
                      onClick={() =>
                        setCamera((prev) => ({
                          ...prev,
                          zoomPercent: Math.min(300, prev.zoomPercent + 20),
                        }))
                      }
                    >
                      放大
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setCamera((prev) => ({
                          ...prev,
                          zoomPercent: Math.max(40, prev.zoomPercent - 20),
                        }))
                      }
                    >
                      缩小
                    </button>
                    <button type="button" onClick={() => setCamera(DEFAULT_M2_CAMERA)}>
                      适配视图
                    </button>
                  </div>
                </div>

                <div className="cw-stage-body">
                  {failedFeatureIds.size > 0 ? (
                    <div
                      className="cw-failed-overlay"
                      data-testid="review-failed-feature-overlay"
                      role="status"
                    >
                      <span>⚠ 问题特征红框高亮：</span>
                      {Array.from(failedFeatureIds).map((fid) => (
                        <button
                          key={fid}
                          type="button"
                          className="cw-failed-chip pa-mono"
                          data-active={selectedObjectId === fid ? 'true' : 'false'}
                          onClick={() => handleFocusFailedFeature(fid)}
                        >
                          {fid}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {data?.mesh ? (
                    <M2ThreeMeshViewport
                      modelMesh={data.mesh}
                      camera={camera}
                      selectedObjectId={selectedObjectId}
                      highlightedFeatureIds={highlightedFeatureIds}
                      theme={theme}
                      onPickRange={handlePick3dRange}
                      onUpdateCamera={setCamera}
                    />
                  ) : (
                    <div style={{ padding: 24 }} className="pa-muted">
                      {phase === 'loading' ? '正在加载三维网格…' : '当前草稿暂无三维网格数据'}
                    </div>
                  )}
                </div>
              </div>
            )}

            {(viewMode === 'drawing' || viewMode === 'split') && (
              <div className="cw-stage-card" data-testid="review-2d-card">
                <div className="cw-stage-header">
                  <span>
                    二维工程图（SVG）
                    {data?.drawingFingerprint ? (
                      <span className="pa-mono" style={{ marginLeft: 8, fontWeight: 400 }}>
                        {data.drawingFingerprint}
                      </span>
                    ) : null}
                  </span>
                  <div className="cw-stage-tools">
                    <button
                      type="button"
                      onClick={() =>
                        setDrawingViewport((prev) => ({
                          ...prev,
                          zoomPercent: Math.min(300, prev.zoomPercent + 25),
                        }))
                      }
                    >
                      放大
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setDrawingViewport((prev) => ({
                          ...prev,
                          zoomPercent: Math.max(50, prev.zoomPercent - 25),
                        }))
                      }
                    >
                      缩小
                    </button>
                    <button
                      type="button"
                      onClick={() => setDrawingViewport(DEFAULT_M2_DRAWING_VIEWPORT)}
                    >
                      适配图纸
                    </button>
                  </div>
                </div>

                <div className="cw-stage-body">
                  <M2VectorDrawingViewport
                    drawingVector={drawingModel.drawingVector}
                    drawingRevision={route.draftRevision}
                    drawingFailure={null}
                    annotations={drawingModel.annotations}
                    selectedAnnotationId={selectedAnnotationId}
                    highlightedAnnotationIds={highlightedAnnotationIds}
                    drawingViewport={drawingViewport}
                    onSelectAnnotation={handleSelect2dAnnotation}
                    onUpdateDrawingViewport={setDrawingViewport}
                  />
                </div>
              </div>
            )}
          </div>
        </section>

        {/* 右侧：检查集 + 原文溯源 + 人工确认提交区 */}
        <aside className="cw-sidebar" aria-label="检查结果与人工确认栏">
          <div className="cw-section">
            <h2 className="cw-section-title">
              <span>确定性检查集</span>
              <span className="pa-mono" data-testid="review-check-total">
                共 {checkCounts.total} 项
              </span>
            </h2>
            <div className="cw-counts" data-testid="review-check-counts">
              <span className="pa-pill pa-tone-pass">✓ 通过 {checkCounts.pass}</span>
              <span className="pa-pill pa-tone-danger">✕ 不通过 {checkCounts.fail}</span>
              <span className="pa-pill pa-tone-pending">? 待澄清 {checkCounts.pending}</span>
              {checkCounts.other > 0 ? (
                <span className="pa-pill pa-tone-muted">○ 其他 {checkCounts.other}</span>
              ) : null}
            </div>

            <div className="cw-check-list" role="list">
              {checks.map((check) => {
                const disp = getCheckStatusDisplay(check.status)
                const isSelected = selectedCheckId === check.checkId
                return (
                  <button
                    key={check.checkId}
                    type="button"
                    role="listitem"
                    className="cw-check-item"
                    data-testid={`review-check-item-${check.checkId}`}
                    data-selected={isSelected ? 'true' : 'false'}
                    data-problem={disp.isProblem ? 'true' : 'false'}
                    onClick={() => handleSelectCheck(check)}
                  >
                    <div className="cw-check-head">
                      <span className="cw-check-title">
                        {check.title}
                        {check.required ? '（必需）' : ''}
                      </span>
                      <span className={`pa-pill ${disp.toneClass}`}>
                        <span aria-hidden="true">{disp.icon}</span>
                        <span>{disp.label}</span>
                      </span>
                    </div>
                    <span className="cw-check-summary">{check.summary}</span>
                  </button>
                )
              })}
              {checks.length === 0 && phase !== 'loading' ? (
                <p className="pa-muted">当前草稿暂无检查条款。</p>
              ) : null}
            </div>
          </div>

          <div className="cw-section" data-testid="review-evidence-panel">
            <h2 className="cw-section-title">
              <span>原文溯源（EvidenceRef）</span>
              {selectedCheck ? (
                <span className="pa-mono" style={{ fontWeight: 400, fontSize: 11.5 }}>
                  {selectedCheck.checkId}
                </span>
              ) : null}
            </h2>
            {evidenceItems.length > 0 ? (
              evidenceItems.map((ev) => (
                <div key={ev.key} className="cw-evidence-card" data-testid="review-evidence-item">
                  <div className="cw-check-head">
                    <span className="pa-pill pa-tone-action">{ev.badge}</span>
                    <span className="pa-muted">{ev.sourceLabel}</span>
                  </div>
                  <pre className="cw-evidence-excerpt">{ev.excerpt}</pre>
                  {ev.meta ? <span className="pa-muted pa-mono">{ev.meta}</span> : null}
                </div>
              ))
            ) : (
              <p className="pa-muted">点击上方检查条款查看对应任务书原文或人工确认依据。</p>
            )}
          </div>

          {/* 人工确认与原子提交区 */}
          <div className="cw-commit-box" data-testid="review-commit-panel">
            <h2 className="cw-section-title">人工确认与正式提交</h2>

            <div className="cw-kv-grid">
              <span className="cw-kv-label">项目 ID</span>
              <span className="cw-kv-value pa-mono">{route.projectId}</span>
              <span className="cw-kv-label">基准修订</span>
              <span className="cw-kv-value pa-mono">{data?.baseRevision ?? '（初始版本）'}</span>
              <span className="cw-kv-label">草稿修订</span>
              <span className="cw-kv-value pa-mono">{route.draftRevision}</span>
              <span className="cw-kv-label">检查集指纹</span>
              <span className="cw-kv-value pa-mono" data-testid="review-fingerprint">
                {data?.review.checksetFingerprint ?? '—'}
              </span>
              <span className="cw-kv-label">变更摘要</span>
              <span className="cw-kv-value" data-testid="review-summary">
                {data?.summary || '—'}
              </span>
            </div>

            {blockingChecks.length > 0 && phase !== 'committed' ? (
              <div
                className="cw-alert cw-alert-danger"
                role="alert"
                data-testid="review-blocking-alert"
              >
                <strong>存在必需项阻塞，暂不可正式提交：</strong>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {blockingChecks.map((b) => (
                    <li key={b.checkId}>
                      {b.title}（{getCheckStatusDisplay(b.status).label}）：{b.summary}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {commitError ? (
              <div
                className="cw-alert cw-alert-danger"
                role="alert"
                data-testid={commitError.isConflict ? 'review-conflict-alert' : 'review-commit-error'}
              >
                <strong>
                  {commitError.isConflict
                    ? `指纹已过期或写入租约冲突（${commitError.code}）`
                    : `提交失败（${commitError.code}）`}
                </strong>
                <span>{commitError.message}</span>
                {commitError.detail ? <span className="pa-mono">{commitError.detail}</span> : null}
                {commitError.isConflict ? (
                  <div>
                    <button
                      type="button"
                      className="cw-btn"
                      onClick={() => void fetchAllReviewData()}
                    >
                      刷新最新草稿
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {phase === 'committed' && commitResult ? (
              <div
                className="cw-alert cw-alert-pass"
                role="status"
                data-testid="review-committed-card"
              >
                <strong>✓ 已完成带指纹原子提交</strong>
                <span className="pa-mono">
                  新正式修订号：{commitResult.committedRevision}
                </span>
                <span className="pa-mono">
                  校验指纹：{commitResult.checksetFingerprint}
                </span>
                {commitResult.summary ? <span>{commitResult.summary}</span> : null}
                {webhookView ? (
                  <div data-testid="review-webhook-status">
                    <strong>Webhook 状态：{webhookView.label}</strong>
                    {webhookView.detail ? (
                      <div className="pa-mono">{webhookView.detail}</div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span className="cw-kv-label">可选 HTTPS Webhook 回调地址（AgentArts 恢复通知）</span>
                  <input
                    type="url"
                    className="cw-input pa-mono"
                    placeholder="https://example.com/agentarts/callback"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    disabled={committing || blockingChecks.length > 0}
                  />
                  {webhookValidationError ? (
                    <span style={{ color: 'var(--fail)', fontSize: 11.5 }}>
                      {webhookValidationError}
                    </span>
                  ) : null}
                </label>

                <label className="cw-checkbox-row">
                  <input
                    type="checkbox"
                    checked={humanConfirmed}
                    onChange={(e) => setHumanConfirmed(e.target.checked)}
                    disabled={blockingChecks.length > 0 || phase !== 'ready' || committing}
                  />
                  <span>
                    我已核对三维模型、二维工程图、确定性检查结果与原文溯源，确认以当前检查集指纹正式提交此草稿
                  </span>
                </label>

                <button
                  type="button"
                  className="cw-btn cw-btn-primary"
                  disabled={!canCommit}
                  onClick={() => void handleCommitDraft()}
                >
                  {committing ? '正在提交…' : '确认并提交'}
                </button>
              </>
            )}
          </div>
        </aside>
      </main>
    </div>
  )
}

export function CloudReviewApp() {
  const [route, setRoute] = useState<ParsedReviewRoute>(() => parseReviewRoute(window.location))

  useEffect(() => {
    const sync = () => setRoute(parseReviewRoute(window.location))
    window.addEventListener('popstate', sync)
    window.addEventListener('hashchange', sync)
    return () => {
      window.removeEventListener('popstate', sync)
      window.removeEventListener('hashchange', sync)
    }
  }, [])

  return <ReviewPage route={route} />
}
