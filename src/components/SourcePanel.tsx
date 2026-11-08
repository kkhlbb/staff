/**
 * 来源侧栏（V2.1 第二组）：本项目已导入的 PDF 文档/不可变版本列表、导入入口、
 * 不可变 revision 查看器，以及当前选中组成环的来源绑定列表。
 *
 * 数据全部来自 IndexedDB 的 sourceDocuments / sourceRevisions / sourceBlobs /
 * bindings。没有 PDF 的项目这一栏保持空状态，不影响计算与导出。
 */
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  createSourceBinding,
  listSourceBindings,
  reviewSourceBinding,
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
import type { TermDraft } from '../workspace/draft'
import { PdfViewer, type LoadRevisionBytes, type RenderPdfPage, type SaveBindingInput } from './PdfViewer'

export interface SourcePanelProps {
  projectId: string
  terms: readonly TermDraft[]
  selectedTermId: string | null
  /** 绑定列表变化时通知工作台，用于在组成表显示“无来源绑定 / 已绑定 N 处”。 */
  onBindingsChange?: (bindings: SourceBinding[]) => void
  /** 每个组成环需要处理的绑定数量，用于表格徽标提示待复核。 */
  onReviewSummaryChange?: (counts: Record<string, number>) => void
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
  return term.symbol.trim() || term.name.trim() || term.id
}

export function SourcePanel({
  projectId,
  terms,
  selectedTermId,
  onBindingsChange,
  onReviewSummaryChange,
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
        `生成不可变版本 ${imported.value.revision.id}（SHA-256 ${imported.value.revision.sha256.slice(0, 12)}…）。`,
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
              disabled={importing}
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
            onChange={(event) => void handleImport(event)}
          />
          <button
            type="button"
            className="source-panel__import-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
          >
            {importing ? '导入中…' : '导入 PDF'}
          </button>
        </div>
      </div>

      {importError !== null ? (
        <p className="source-panel__error" role="alert">
          导入失败：{importError}。现有版本指针和绑定未改变。
        </p>
      ) : null}
      {importMessage !== null ? (
        <p className="source-panel__message" role="status">
          {importMessage}
        </p>
      ) : null}
      {loadError !== null ? (
        <div className="source-panel__error" role="alert">
          <p>读取来源列表失败：{loadError}</p>
          <button type="button" onClick={reload}>
            重新读取
          </button>
        </div>
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
                  <li key={binding.id} className="source-panel__binding">
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
                    {term !== undefined &&
                    (review?.kind === 'unreviewed' || review?.kind === 'stale-term') ? (
                      <button
                        type="button"
                        className="source-panel__binding-review"
                        onClick={() => void handleReviewBinding(binding, term)}
                      >
                        标记已核对
                      </button>
                    ) : null}
                    <span className="source-panel__binding-meta">
                      版本 {binding.revisionId.slice(0, 8)}… · 区域{' '}
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
