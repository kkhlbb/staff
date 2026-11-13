/**
 * 来源侧栏（V2.1 第二组）：本项目已导入的 PDF 文档/不可变版本列表、导入入口、
 * 不可变 revision 查看器，以及当前选中组成环的来源绑定列表。
 *
 * 数据全部来自 IndexedDB 的 sourceDocuments / sourceRevisions / sourceBlobs /
 * bindings。没有 PDF 的项目这一栏保持空状态，不影响计算与导出。
 */
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  acceptHistoricalSource,
  createSourceBinding,
  listSourceBindings,
  rebindSourceBinding,
  removeSourceBinding,
  reviewSourceBinding,
  updateSourceBindingRegion,
  type SourceBinding,
} from '../sources/bindings'
import { resolveBindingReview, type BindingReview } from '../sources/review'
import {
  importSourceRevision,
  listSourceBlobKeys,
  listSourceDocuments,
  listSourceRevisions,
} from '../sources/revisions'
import type { SourceDocument, SourceRevision } from '../sources/types'
import { uiDiagnosticText, uiSourceVersionLabel } from './uiIdentity'
import { useDatabaseStaleVersion } from '../storage/databaseStale'
import type { TermDraft } from '../workspace/draft'
import { PdfViewer, type LoadRevisionBytes, type RenderPdfPage, type SaveBindingInput } from './PdfViewer'

/** 供工作台审查清单消费的只读来源快照；不在侧栏内重复判定规则状态。 */
export interface SourcePanelState {
  documents: SourceDocument[]
  revisions: SourceRevision[]
  bindings: SourceBinding[]
  availableBlobKeys: ReadonlySet<string>
}

/** 审查清单点击“定位”时，打开确切的绑定版本与页码。 */
export interface SourceLocateRequest {
  bindingId: string
  revisionId: string
  page: number
  /** 同一绑定连续定位也要重新触发的序号。 */
  token: number
}

export interface SourcePanelProps {
  projectId: string
  terms: readonly TermDraft[]
  selectedTermId: string | null
  /** 绑定列表变化时通知工作台，用于在组成表显示“无来源绑定 / 已绑定 N 处”。 */
  onBindingsChange?: (bindings: SourceBinding[]) => void
  /** 每个组成环需要处理的绑定数量，用于表格徽标提示待复核。 */
  onReviewSummaryChange?: (counts: Record<string, number>) => void
  /** 加载完成后上报完整来源快照，供统一审查规则计算。 */
  onSourceStateChange?: (state: SourcePanelState) => void
  /** 从审查侧栏定位到某条绑定的确切版本/页。 */
  locateRequest?: SourceLocateRequest | null
  /** 测试注入：读取 revision 字节；默认从 sourceBlobs 读取。 */
  loadBytes?: LoadRevisionBytes
  /** 测试注入：绘制页面；默认使用项目内 pdfjs-dist。 */
  renderPage?: RenderPdfPage
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
}

function termLabel(term: TermDraft | undefined): string {
  if (term === undefined) {
    return '未选择组成环'
  }
  return term.symbol.trim() || term.name.trim() || '未命名组成环'
}

export function SourcePanel({
  projectId,
  terms,
  selectedTermId,
  onBindingsChange,
  onReviewSummaryChange,
  onSourceStateChange,
  locateRequest = null,
  loadBytes,
  renderPage,
}: SourcePanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [documents, setDocuments] = useState<SourceDocument[]>([])
  const [revisions, setRevisions] = useState<SourceRevision[]>([])
  const [bindings, setBindings] = useState<SourceBinding[]>([])
  const [availableBlobKeys, setAvailableBlobKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const [activeRevisionId, setActiveRevisionId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)

  const [importTarget, setImportTarget] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importMessage, setImportMessage] = useState<string | null>(null)

  /**
   * 已有绑定的编辑模式：重框（只改区域/页码）或换关联来源（改 revision + 区域）。
   * 保存仍走 PdfViewer 的框选流程，只是把结果交给 update/rebind 而不是新建绑定。
   */
  const [editMode, setEditMode] = useState<
    { kind: 'region' | 'source'; bindingId: string; termId: string } | null
  >(null)
  const [editMessage, setEditMessage] = useState<string | null>(null)
  const [editError, setEditError] = useState<string | null>(null)

  /** 继续采用旧版的行内表单与解除绑定的二次确认。 */
  const [acceptingBindingId, setAcceptingBindingId] = useState<string | null>(null)
  const [acceptReason, setAcceptReason] = useState('')
  const [acceptScope, setAcceptScope] = useState('')
  const [acceptError, setAcceptError] = useState<string | null>(null)
  const [acceptMessage, setAcceptMessage] = useState<string | null>(null)
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null)

  const onSourceStateChangeRef = useRef(onSourceStateChange)
  useEffect(() => {
    onSourceStateChangeRef.current = onSourceStateChange
  }, [onSourceStateChange])

  const reload = (): void => {
    setReloadToken((token) => token + 1)
  }

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      setLoading(true)
      setLoadError(null)
      const [loadedDocuments, loadedRevisions, loadedBindings, loadedBlobKeys] =
        await Promise.all([
          listSourceDocuments(projectId),
          listSourceRevisions(projectId),
          listSourceBindings(projectId),
          listSourceBlobKeys(projectId),
        ])
      if (cancelled) {
        return
      }
      if (!loadedDocuments.ok) {
        setLoadError(loadedDocuments.error.message)
        setLoading(false)
        return
      }
      if (!loadedRevisions.ok) {
        setLoadError(loadedRevisions.error.message)
        setLoading(false)
        return
      }
      if (!loadedBindings.ok) {
        setLoadError(loadedBindings.error.message)
        setLoading(false)
        return
      }
      if (!loadedBlobKeys.ok) {
        setLoadError(loadedBlobKeys.error.message)
        setLoading(false)
        return
      }

      const nextDocuments = loadedDocuments.value.slice().sort((left, right) =>
        left.title.localeCompare(right.title, 'zh-CN') || left.id.localeCompare(right.id),
      )
      const nextRevisions = loadedRevisions.value.slice().sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      )
      setDocuments(nextDocuments)
      setRevisions(nextRevisions)
      setBindings(loadedBindings.value)
      setAvailableBlobKeys(new Set(loadedBlobKeys.value))
      setLoading(false)
      // 上报同一份已加载数据；工作台审查规则不另读一份可能不同的状态。
      onSourceStateChangeRef.current?.({
        documents: nextDocuments,
        revisions: nextRevisions,
        bindings: loadedBindings.value,
        availableBlobKeys: new Set(loadedBlobKeys.value),
      })
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [projectId, reloadToken])

  useEffect(() => {
    onBindingsChange?.(bindings)
  }, [bindings, onBindingsChange])

  /**
   * 审查侧栏定位：打开确切 revision 与页码，并滚动到该绑定。
   * 只改变查看位置，不触发保存、确认或版本处置。
   *
   * 查看位置在渲染期按新请求调整（React 推荐的“props 变化时调整 state”模式），
   * 滚动留给没有 setState 的 effect，避免级联渲染。
   */
  const [handledLocateToken, setHandledLocateToken] = useState<number | null>(null)
  if (locateRequest !== null && locateRequest.token !== handledLocateToken) {
    setHandledLocateToken(locateRequest.token)
    setActiveRevisionId(locateRequest.revisionId)
    setPage(locateRequest.page)
  }
  useEffect(() => {
    if (locateRequest === null) {
      return
    }
    const element = document.querySelector(
      `[data-review-binding="${locateRequest.bindingId}"]`,
    )
    if (element instanceof HTMLElement && typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'center' })
    }
  }, [locateRequest])

  /**
   * 刷新/重新打开后的默认定位：优先打开当前选中组成环最近一条绑定所指向的
   * 确切 revision 与页码，而不是文档的 latestRevisionId。
   */
  useEffect(() => {
    if (activeRevisionId !== null || revisions.length === 0) {
      return
    }
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) {
        return
      }
      const termBindings =
        selectedTermId === null
          ? []
          : bindings.filter((binding) => binding.termId === selectedTermId)
      const preferred =
        termBindings.length > 0 ? termBindings[termBindings.length - 1] : bindings.at(-1)
      if (
        preferred !== undefined &&
        revisions.some((revision) => revision.id === preferred.revisionId)
      ) {
        setActiveRevisionId(preferred.revisionId)
        setPage(preferred.page)
        return
      }
      const lastRevision = revisions[revisions.length - 1]
      setActiveRevisionId(lastRevision.id)
      setPage(1)
    })
    return () => {
      cancelled = true
    }
  }, [activeRevisionId, bindings, revisions, selectedTermId])

  const activeRevision =
    revisions.find((revision) => revision.id === activeRevisionId) ?? null
  const activeTerm = terms.find((term) => term.id === selectedTermId)
  const editingDisabled = useDatabaseStaleVersion() !== null

  const termBindings =
    selectedTermId === null
      ? []
      : bindings.filter((binding) => binding.termId === selectedTermId)

  const termsById = useMemo(
    () => new Map(terms.map((term) => [term.id, term])),
    [terms],
  )
  const documentsById = useMemo(
    () => new Map(documents.map((document) => [document.id, document])),
    [documents],
  )
  const revisionsById = useMemo(
    () => new Map(revisions.map((revision) => [revision.id, revision])),
    [revisions],
  )

  /**
   * 每个绑定的核对状态都在这里派生：环修订号、文档最新版本、附件是否真的
   * 在本机。绑定记录本身只保存核对凭据，不保存“有效/失效”布尔。
   */
  const reviewByBinding = useMemo(() => {
    const map: Record<string, BindingReview> = {}
    for (const binding of bindings) {
      const term = termsById.get(binding.termId)
      const document = documentsById.get(binding.documentId)
      const revision = revisionsById.get(binding.revisionId)
      map[binding.id] = resolveBindingReview({
        binding,
        termRevision: term?.termRevision,
        latestRevisionId: document?.latestRevisionId,
        attachmentAvailable:
          revision !== undefined && availableBlobKeys.has(revision.blobKey),
      })
    }
    return map
  }, [availableBlobKeys, bindings, documentsById, revisionsById, termsById])

  useEffect(() => {
    if (onReviewSummaryChange === undefined) {
      return
    }
    const counts: Record<string, number> = {}
    for (const binding of bindings) {
      if (reviewByBinding[binding.id]?.needsReview === true) {
        counts[binding.termId] = (counts[binding.termId] ?? 0) + 1
      }
    }
    onReviewSummaryChange(counts)
  }, [bindings, onReviewSummaryChange, reviewByBinding])

  const handleReviewBinding = async (
    binding: SourceBinding,
    term: TermDraft,
  ): Promise<void> => {
    const result = await reviewSourceBinding(binding.id, {
      termRevision: term.termRevision,
    })
    if (!result.ok) {
      setLoadError(result.error.message)
      return
    }
    reload()
  }

  /**
   * 迁移到新版：只打开最新版本并进入换关联流程，页码仅作为建议起点。
   * 不自动沿用旧坐标、不自动核对；用户必须重新框选并保存。
   */
  const startMigrateBinding = (binding: SourceBinding): void => {
    const document = documentsById.get(binding.documentId)
    const latest =
      document === undefined ? undefined : revisionsById.get(document.latestRevisionId)
    if (latest === undefined) {
      setLoadError('来源文档的最新版本记录不存在，无法迁移；可解除绑定后重新导入。')
      return
    }
    setEditError(null)
    setAcceptError(null)
    setEditMessage(
      `已打开最新版本「${latest.fileName}」第 ${binding.page} 页作为建议位置；` +
        '请重新框选并保存。旧坐标不会自动沿用，核对也会重新开始。',
    )
    setEditMode({ kind: 'source', bindingId: binding.id, termId: binding.termId })
    setActiveRevisionId(latest.id)
    setPage(binding.page)
  }

  const handleAcceptHistorical = async (binding: SourceBinding): Promise<void> => {
    setAcceptError(null)
    setAcceptMessage(null)
    if (acceptReason.trim() === '' || acceptScope.trim() === '') {
      setAcceptError('继续使用旧版必须填写理由与适用范围。')
      return
    }
    const accepted = await acceptHistoricalSource(binding.id, {
      reason: acceptReason,
      scope: acceptScope,
    })
    if (!accepted.ok) {
      setAcceptError(accepted.error.message)
      return
    }
    setAcceptMessage(
      '已记录“继续使用旧版（已说明）”。该绑定仍指向旧版本，不冒充最新；' +
        '版本处置不代替数值核对，仍需与本环当前修订核对。',
    )
    setAcceptingBindingId(null)
    setAcceptReason('')
    setAcceptScope('')
    reload()
  }

  const handleRemoveBinding = async (binding: SourceBinding): Promise<void> => {
    const removed = await removeSourceBinding(binding.id)
    if (!removed.ok) {
      setLoadError(removed.error.message)
      return
    }
    setPendingRemoveId(null)
    setEditMessage('已解除绑定：来源状态变为未检查；旧版本与附件仍保留，不会被删除。')
    reload()
  }

  const handleImport = async (
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = event.target.files?.[0]
    // 允许连续两次选择同一个文件时仍触发 change。
    event.target.value = ''
    if (file === undefined) {
      return
    }

    setImporting(true)
    setImportError(null)
    setImportMessage(null)

    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(await file.arrayBuffer())
    } catch (error) {
      setImporting(false)
      setImportError(
        `读取所选文件失败：${error instanceof Error ? error.message : String(error)}`,
      )
      return
    }

    const imported = await importSourceRevision({
      projectId,
      fileName: file.name,
      bytes,
      ...(importTarget === '' ? {} : { documentId: importTarget }),
    })
    setImporting(false)

    if (!imported.ok) {
      setImportError(imported.error.message)
      return
    }

    setImportMessage(
      `已导入 ${imported.value.revision.fileName}，${imported.value.revision.pageCount} 页；` +
        '已生成不可变来源版本，可在文件与版本列表查看。',
    )
    setActiveRevisionId(imported.value.revision.id)
    setPage(1)
    setImportTarget('')
    reload()
  }

  const handleSaveBinding = async (
    input: SaveBindingInput,
  ): Promise<{ ok: boolean; message?: string }> => {
    if (selectedTermId === null) {
      return { ok: false, message: '请先选中组成环' }
    }
    if (activeRevision === null) {
      return { ok: false, message: '请先打开一个确切的 PDF 版本' }
    }
    if (editMode !== null) {
      const saved =
        editMode.kind === 'region'
          ? await updateSourceBindingRegion(editMode.bindingId, {
              page: input.page,
              rectPdf: input.rectPdf,
              pageBoxPdf: input.pageBoxPdf,
              note: input.note,
            })
          : await rebindSourceBinding(editMode.bindingId, {
              revisionId: activeRevision.id,
              page: input.page,
              rectPdf: input.rectPdf,
              pageBoxPdf: input.pageBoxPdf,
              note: input.note,
            })
      if (!saved.ok) {
        setEditError(saved.error.message)
        return { ok: false, message: saved.error.message }
      }
      setEditError(null)
      // 成功提示由 PdfViewer 用 saveSuccessMessage 显示，避免同一句话出现两次。
      setEditMessage(null)
      setEditMode(null)
      reload()
      return { ok: true }
    }
    const saved = await createSourceBinding({
      projectId,
      termId: selectedTermId,
      revisionId: activeRevision.id,
      page: input.page,
      rectPdf: input.rectPdf,
      pageBoxPdf: input.pageBoxPdf,
      note: input.note,
    })
    if (!saved.ok) {
      return { ok: false, message: saved.error.message }
    }
    reload()
    return { ok: true }
  }

  const openBinding = (binding: SourceBinding): void => {
    setActiveRevisionId(binding.revisionId)
    setPage(binding.page)
  }

  /** 接管已有绑定：查看器里下一次框选/保存会更新这条绑定，而不是新增。 */
  const startEditBinding = (
    binding: SourceBinding,
    kind: 'region' | 'source',
  ): void => {
    setEditError(null)
    setEditMessage(null)
    setEditMode({ kind, bindingId: binding.id, termId: binding.termId })
    setActiveRevisionId(binding.revisionId)
    setPage(binding.page)
  }

  const cancelEditBinding = (): void => {
    setEditMode(null)
    setEditError(null)
    setEditMessage('已取消编辑；绑定区域、页码与核对状态均未改变。')
  }

  const revisionsOf = (documentId: string): SourceRevision[] =>
    revisions.filter((revision) => revision.documentId === documentId)

  return (
    <section className="source-panel" aria-labelledby="source-panel-heading">
      <div className="source-panel__header">
        <div>
          <h2 id="source-panel-heading" className="source-panel__title">
            本地 PDF 来源
          </h2>
          <p className="source-panel__subtitle">
            PDF 只保存在本机浏览器，不上传服务器；没有来源绑定也能正常计算和导出。
            所有区域使用未旋转 PDF 坐标保存。
          </p>
        </div>
        <div className="source-panel__import">
          <label className="source-panel__import-target">
            导入方式
            <select
              aria-label="导入方式"
              value={importTarget}
              onChange={(event) => setImportTarget(event.target.value)}
              disabled={importing || editingDisabled}
            >
              <option value="">作为新文件导入</option>
              {documents.map((document) => (
                <option key={document.id} value={document.id}>
                  替换版本：{document.title}
                </option>
              ))}
            </select>
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            aria-label="选择 PDF 文件"
            className="source-panel__file-input"
            disabled={editingDisabled}
            onChange={(event) => void handleImport(event)}
          />
          <button
            type="button"
            className="source-panel__import-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing || editingDisabled}
          >
            {importing ? '导入中…' : '导入 PDF'}
          </button>
        </div>
      </div>

      {importError !== null ? (
        <p className="source-panel__error" role="alert">
          导入失败：{uiDiagnosticText(importError)}。现有版本指针和绑定未改变。
        </p>
      ) : null}
      {importMessage !== null ? (
        <p className="source-panel__message" role="status">
          {importMessage}
        </p>
      ) : null}
      {acceptMessage !== null ? (
        <p className="source-panel__message" role="status" data-testid="historical-accept-message">
          {acceptMessage}
        </p>
      ) : null}
      {loadError !== null ? (
        <div className="source-panel__error" role="alert">
          <p>读取来源列表失败：{uiDiagnosticText(loadError)}</p>
          <button type="button" onClick={reload}>
            重新读取
          </button>
        </div>
      ) : null}

      {editMode !== null ? (
        <div className="source-panel__edit" role="status" data-testid="binding-edit-mode">
          <p>
            {editMode.kind === 'region'
              ? '正在重框一条已有绑定：在下方页面重新框选区域，然后点“保存重框区域”。'
              : '正在更换关联来源：在左侧选择目标版本并切换到目标页，框选区域后点“保存更换来源”。'}
            保存只清空这一条绑定的来源核对，不改组成环数值，也不影响其他绑定。
          </p>
          <button type="button" onClick={cancelEditBinding}>
            取消编辑
          </button>
        </div>
      ) : null}
      {editMessage !== null ? (
        <p className="source-panel__message" role="status">
          {editMessage}
        </p>
      ) : null}
      {editError !== null ? (
        <p className="source-panel__error" role="alert">
          编辑绑定失败：{uiDiagnosticText(editError)}。现有绑定与数值未改变。
        </p>
      ) : null}

      <div className="source-panel__grid">
        <div className="source-panel__list" aria-label="来源文件与版本列表">
          <h3 className="source-panel__heading">文件与版本</h3>
          {loading ? (
            <p className="source-panel__hint" role="status">
              正在读取来源…
            </p>
          ) : documents.length === 0 ? (
            <p className="source-panel__hint">
              还没有导入 PDF。这个项目没有来源绑定，计算与导出不受影响。
            </p>
          ) : (
            <ul className="source-panel__documents">
              {documents.map((document) => {
                const documentRevisions = revisionsOf(document.id)
                return (
                  <li key={document.id} className="source-panel__document">
                    <div className="source-panel__document-title">
                      {document.title}
                      <span className="source-panel__document-meta">
                        {documentRevisions.length} 个版本
                      </span>
                    </div>
                    <ul className="source-panel__revisions">
                      {documentRevisions.map((revision, index) => {
                        const isLatest = revision.id === document.latestRevisionId
                        const selected = revision.id === activeRevisionId
                        return (
                          <li key={revision.id}>
                            <button
                              type="button"
                              className={
                                selected
                                  ? 'source-panel__revision source-panel__revision--active'
                                  : 'source-panel__revision'
                              }
                              aria-pressed={selected}
                              onClick={() => {
                                setActiveRevisionId(revision.id)
                                setPage(1)
                              }}
                            >
                              <span className="source-panel__revision-version">
                                v{index + 1}
                              </span>
                              <span className="source-panel__revision-file">
                                {revision.fileName}
                              </span>
                              <span className="source-panel__revision-meta">
                                {revision.pageCount} 页 · SHA-256{' '}
                                {revision.sha256.slice(0, 8)}… ·{' '}
                                {formatDateTime(revision.createdAt)}
                                {isLatest ? ' · 最新' : ''}
                              </span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="source-panel__viewer" aria-label="来源 PDF 查看与框选">
          <h3 className="source-panel__heading">
            查看与框选
            {activeTerm === undefined ? '' : ` · 组成环 ${termLabel(activeTerm)}`}
          </h3>
          {activeRevision === null ? (
            <p className="source-panel__hint">
              在左侧选择一个确切版本后，可以查看页面并框选来源区域。
            </p>
          ) : (
            <PdfViewer
              key={activeRevision.id}
              revision={activeRevision}
              bindings={bindings}
              selectedTermId={selectedTermId}
              page={page}
              zoom={zoom}
              rotation={rotation}
              onPageChange={setPage}
              onZoomChange={setZoom}
              onRotationChange={setRotation}
              onSaveBinding={handleSaveBinding}
              {...(editMode === null
                ? {}
                : {
                    saveButtonLabel:
                      editMode.kind === 'region' ? '保存重框区域' : '保存更换来源',
                    saveSuccessMessage:
                      editMode.kind === 'region'
                        ? '已重框；只清空该绑定的来源核对，数值与其他绑定未改变。'
                        : '已更换关联来源；只清空该绑定的来源核对，数值与其他绑定未改变。',
                  })}
              {...(loadBytes === undefined ? {} : { loadBytes })}
              {...(renderPage === undefined ? {} : { renderPage })}
            />
          )}
        </div>

        <div className="source-panel__bindings" aria-label="组成环来源绑定">
          <h3 className="source-panel__heading">
            来源绑定 · {termLabel(activeTerm)}
          </h3>
          {selectedTermId === null ? (
            <p className="source-panel__hint">
              在组成环表中选中一行，查看或新增该环的来源绑定。
            </p>
          ) : termBindings.length === 0 ? (
            <p className="source-panel__hint" data-testid="term-binding-empty">
              无来源绑定
            </p>
          ) : (
            <ul className="source-panel__binding-list">
              {termBindings.map((binding) => {
                const revision = revisions.find(
                  (candidate) => candidate.id === binding.revisionId,
                )
                const review = reviewByBinding[binding.id]
                const term = termsById.get(binding.termId)
                return (
                  <li
                    key={binding.id}
                    className="source-panel__binding"
                    data-review-binding={binding.id}
                  >
                    <button
                      type="button"
                      className="source-panel__binding-open"
                      onClick={() => openBinding(binding)}
                    >
                      第 {binding.page} 页 · {binding.note.trim() === '' ? '无备注' : binding.note}
                      {revision === undefined ? '' : ` · ${revision.fileName}`}
                    </button>
                    {review === undefined ? null : (
                      <span
                        className={`source-panel__review source-panel__review--${review.kind}`}
                        data-testid={`binding-review-${binding.id}`}
                      >
                        {review.label}
                      </span>
                    )}
                    {binding.historicalAcceptance === null ? null : (
                      <div
                        className="source-panel__historical"
                        data-testid={`binding-historical-${binding.id}`}
                      >
                        <p>
                          <strong>使用历史来源（已说明），不是最新版本</strong>
                        </p>
                        <p>理由：{binding.historicalAcceptance.reason}</p>
                        <p>适用范围：{binding.historicalAcceptance.scope}</p>
                        <p>
                          接受时间：{formatDateTime(binding.historicalAcceptance.acceptedAt)}
                          ；接受时文档最新版本{' '}
                          {uiSourceVersionLabel(revisions, binding.historicalAcceptance.latestRevisionId)}
                        </p>
                      </div>
                    )}
                    {term !== undefined && review?.needsReview === true ? (
                      <button
                        type="button"
                        className="source-panel__binding-review"
                        onClick={() => void handleReviewBinding(binding, term)}
                        disabled={editingDisabled}
                      >
                        标记已核对
                      </button>
                    ) : null}
                    {review?.kind === 'stale-version' ? (
                      <div
                        className="source-panel__pending-version"
                        data-testid={`binding-version-actions-${binding.id}`}
                      >
                        <p>
                          文档已导入更新版本。请逐绑定选择：迁移新版、继续用旧版（必填理由与
                          适用范围），或解除绑定。未处理前不会算作审查完成。
                        </p>
                        <div className="source-panel__binding-actions">
                          <button
                            type="button"
                            data-testid={`binding-migrate-${binding.id}`}
                            onClick={() => startMigrateBinding(binding)}
                            disabled={editMode !== null || editingDisabled}
                          >
                            迁移到新版（重新框选）
                          </button>
                          <button
                            type="button"
                            data-testid={`binding-accept-old-${binding.id}`}
                            onClick={() => {
                              setAcceptingBindingId(binding.id)
                              setAcceptReason('')
                              setAcceptScope('')
                              setAcceptError(null)
                              setAcceptMessage(null)
                            }}
                            disabled={editingDisabled}
                          >
                            继续用旧版（填理由）
                          </button>
                          <button
                            type="button"
                            data-testid={`binding-remove-${binding.id}`}
                            onClick={() => setPendingRemoveId(binding.id)}
                            disabled={editingDisabled}
                          >
                            解除绑定
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {acceptingBindingId === binding.id ? (
                      <div
                        className="source-panel__accept-form"
                        data-testid={`binding-accept-form-${binding.id}`}
                      >
                        <label>
                          理由（必填）
                          <textarea
                            aria-label="继续使用旧版的理由"
                            value={acceptReason}
                            onChange={(event) => setAcceptReason(event.target.value)}
                          />
                        </label>
                        <label>
                          适用范围（必填）
                          <input
                            aria-label="继续使用旧版的适用范围"
                            value={acceptScope}
                            onChange={(event) => setAcceptScope(event.target.value)}
                          />
                        </label>
                        {acceptError === null ? null : (
                          <p className="source-panel__error" role="alert">
                            {uiDiagnosticText(acceptError)}
                          </p>
                        )}
                        <div className="source-panel__binding-actions">
                          <button
                            type="button"
                            data-testid={`binding-accept-submit-${binding.id}`}
                            onClick={() => void handleAcceptHistorical(binding)}
                            disabled={editingDisabled}
                          >
                            记录继续使用旧版
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAcceptingBindingId(null)
                              setAcceptError(null)
                            }}
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {pendingRemoveId === binding.id ? (
                      <div
                        className="source-panel__confirm-remove"
                        role="alertdialog"
                        aria-label="确认解除绑定"
                        data-testid={`binding-remove-confirm-${binding.id}`}
                      >
                        <p>
                          解除后该环的来源状态变为未检查；旧版本与附件不会被删除，可重新绑定。
                        </p>
                        <div className="source-panel__binding-actions">
                          <button
                            type="button"
                            data-testid={`binding-remove-confirm-yes-${binding.id}`}
                            onClick={() => void handleRemoveBinding(binding)}
                            disabled={editingDisabled}
                          >
                            确认解除绑定
                          </button>
                          <button type="button" onClick={() => setPendingRemoveId(null)}>
                            取消
                          </button>
                        </div>
                      </div>
                    ) : null}
                    <div className="source-panel__binding-actions">
                      <button
                        type="button"
                        data-testid={`binding-reframe-${binding.id}`}
                        onClick={() => startEditBinding(binding, 'region')}
                        disabled={editMode !== null || editingDisabled}
                      >
                        重框
                      </button>
                      <button
                        type="button"
                        data-testid={`binding-rebind-${binding.id}`}
                        onClick={() => startEditBinding(binding, 'source')}
                        disabled={editMode !== null || editingDisabled}
                      >
                        换关联来源
                      </button>
                      {review?.kind === 'stale-version' ? null : (
                        <button
                          type="button"
                          data-testid={`binding-remove-inline-${binding.id}`}
                          onClick={() => setPendingRemoveId(binding.id)}
                          disabled={editingDisabled}
                        >
                          解除绑定
                        </button>
                      )}
                    </div>
                    <span className="source-panel__binding-meta">
                      {uiSourceVersionLabel(revisions, binding.revisionId)} · 区域{' '}
                      {binding.rectPdf.map((value) => value.toFixed(1)).join(', ')} PDF 点
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
