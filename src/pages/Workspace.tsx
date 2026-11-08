import { useEffect, useMemo, useRef, useState } from 'react'
import { ChainDiagram } from '../components/ChainDiagram'
import { ChainExpression } from '../components/ChainExpression'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { DimensionTable } from '../components/DimensionTable'
import { ImportWizard } from '../components/ImportWizard'
import { ResultPanel } from '../components/ResultPanel'
import { ReviewSidebar } from '../components/ReviewSidebar'
import { ScenarioCompare } from '../components/ScenarioCompare'
import {
  SourcePanel,
  type SourceLocateRequest,
  type SourcePanelState,
} from '../components/SourcePanel'
import type { ChainDefinition, Project } from '../domain/types'
import { createAnalysisSnapshot } from '../history/snapshots'
import type { CommitImportSuccess } from '../import/commit'
import { countBindingsByTerm, type SourceBinding } from '../sources/bindings'
import { evaluateReviewChecklist, type ReviewFinding } from '../review/rules'
import { useDatabaseStaleVersion } from '../storage/databaseStale'
import { subscribeDatabaseVersionChange } from '../storage/db'
import { getProject, listProjects, loadProjectSources } from '../storage/projects'
import {
  downloadProjectBackup,
  usePersistedWorkspace,
  useWorkspaceBootstrap,
  type SaveDraftFn,
  type SaveStatus,
} from '../workspace/usePersistedWorkspace'
import {
  hasTargetInputError,
  type WorkspaceDraft,
} from '../workspace/draft'
import './Workspace.css'

export interface WorkspaceProps {
  /** 指定要打开的项目；未指定时保持原有“最新项目或新建空项目”的行为。 */
  projectId?: string
  /** 返回项目列表；未提供时回退到 location.hash 路由。 */
  onBackToList?: () => void
  /** 打开某份快照的报告；未提供时回退到 location.hash 路由。 */
  onOpenReport?: (projectId: string, snapshotId: string) => void
  /** 打开分析快照列表；未提供时回退到 location.hash 路由。 */
  onOpenSnapshots?: (projectId: string) => void
  /** 仅测试或特殊场景注入保存实现；默认写入 IndexedDB。 */
  saveDraft?: SaveDraftFn
}

const SAVE_STATUS_LABEL: Record<SaveStatus, string> = {
  saving: '保存中',
  saved: '已保存',
  failed: '保存失败',
}

/** 导出的统一提示：始终说明不含来源附件，避免“普通备份”被误读。 */
function exportNoticeFor(revisionCount: number): string {
  return revisionCount > 0
    ? `已导出项目 JSON。数据备份不含来源附件：${revisionCount} 个来源版本只保留元数据与绑定坐标，附件需另行保留。`
    : '已导出项目 JSON。数据备份不含来源附件。'
}

function formatBaselineTime(savedAt: string): string {
  const date = new Date(savedAt)
  return Number.isNaN(date.getTime()) ? savedAt : date.toLocaleString('zh-CN')
}

type PendingBaselineAction = 'overwrite' | 'restore' | null

/** 定位只滚动/聚焦，不触发保存或确认；测试环境没有 scrollIntoView 时静默跳过。 */
function scrollToReviewTarget(selector: string): void {
  if (typeof document.querySelector !== 'function') {
    return
  }
  const element = document.querySelector(selector)
  if (!(element instanceof HTMLElement)) {
    return
  }
  if (typeof element.scrollIntoView === 'function') {
    element.scrollIntoView({ block: 'center' })
  }
  element.focus({ preventScroll: true })
}

interface WorkspaceEditorProps {
  project: Project
  initialDraft: WorkspaceDraft
  initialValidChain: ChainDefinition | null
  /** 本地 V1 升级提示；未迁移为 null。 */
  migrationNotice: string | null
  onBackToList: () => void
  onOpenReport?: (projectId: string, snapshotId: string) => void
  onOpenSnapshots?: (projectId: string) => void
  saveDraft?: SaveDraftFn
}

/**
 * 加载完成后的编辑区。
 *
 * 这个组件第一次挂载时已经拿到恢复后的草稿和项目里的最后一个有效链，
 * 因此不会先渲染空项目、再在 effect 里覆盖成缓存内容。
 */
function WorkspaceEditor({
  project,
  initialDraft,
  initialValidChain,
  migrationNotice,
  onBackToList,
  onOpenReport,
  onOpenSnapshots,
  saveDraft,
}: WorkspaceEditorProps) {
  const {
    draft,
    dispatch,
    chain,
    lastValidChain,
    result,
    cellErrors,
    stale,
    relationConfirmed,
    relationReviewStale,
    setRelationConfirmed,
    saveStatus,
    saveError,
    retrySave,
    exportBackup,
    baseline,
    saveBaseline,
    restoreBaseline,
    relationState,
  } = usePersistedWorkspace(project, initialDraft, {
    initialValidChain,
    saveDraft,
  })
  const [selectedTermId, setSelectedTermId] = useState<string | null>(null)
  const [pendingBaselineAction, setPendingBaselineAction] =
    useState<PendingBaselineAction>(null)
  const [baselineBusy, setBaselineBusy] = useState(false)
  const [baselineMessage, setBaselineMessage] = useState<string | null>(null)
  const [baselineError, setBaselineError] = useState<string | null>(null)
  const [tableImportOpen, setTableImportOpen] = useState(false)
  const [tableImportMessage, setTableImportMessage] = useState<string | null>(null)
  const [snapshotBusy, setSnapshotBusy] = useState(false)
  const [snapshotMessage, setSnapshotMessage] = useState<string | null>(null)
  const [snapshotError, setSnapshotError] = useState<string | null>(null)
  const [pendingSnapshotAction, setPendingSnapshotAction] = useState(false)
  const [sourceBindings, setSourceBindings] = useState<SourceBinding[]>([])
  const sourceBindingCounts = countBindingsByTerm(sourceBindings)
  /**
   * SourcePanel 已加载的完整来源快照：审查规则消费这一份数据，
   * 不另开事务读取可能与侧栏不一致的状态。
   */
  const [sourceState, setSourceState] = useState<SourcePanelState>({
    documents: [],
    revisions: [],
    bindings: [],
    availableBlobKeys: new Set(),
  })
  const [locateRequest, setLocateRequest] = useState<SourceLocateRequest | null>(null)
  const locateTokenRef = useRef(0)
  const [sourceReviewPendingCounts, setSourceReviewPendingCounts] = useState<
    Record<string, number>
  >({})
  const [databaseNotice, setDatabaseNotice] = useState<string | null>(null)
  const [migrationNoticeDismissed, setMigrationNoticeDismissed] = useState(false)
  const [exportNotice, setExportNotice] = useState<string | null>(null)
  const editingDisabled = useDatabaseStaleVersion() !== null

  /**
   * 统一审查清单：与快照/报告使用同一规则版本。
   * 计算满足来自 result；“审查完成”由规则待办决定，两者分开显示。
   */
  const reviewSummary = useMemo(
    () =>
      evaluateReviewChecklist({
        chain,
        cellErrors,
        result,
        relationConfirmed,
        relationReviewStale,
        relationRevision: draft.relationRevision,
        terms: draft.terms.map((term) => ({
          id: term.id,
          symbol: term.symbol,
          name: term.name,
          termRevision: term.termRevision,
        })),
        bindings: sourceState.bindings,
        documents: sourceState.documents,
        revisions: sourceState.revisions,
        availableBlobKeys: sourceState.availableBlobKeys,
      }),
    [
      chain,
      cellErrors,
      draft.relationRevision,
      draft.terms,
      relationConfirmed,
      relationReviewStale,
      result,
      sourceState,
    ],
  )

  /**
   * 审查侧栏定位：链级项定位到错误单元格/关系入口/目标，绑定项打开确切
   * 版本与页。只改变选中与查看位置，不触发保存或确认。
   */
  const handleReviewLocate = (finding: ReviewFinding): void => {
    const target = finding.target
    if (target.kind === 'term') {
      setSelectedTermId(target.termId)
      scrollToReviewTarget(`[data-review-term="${target.termId}"]`)
      return
    }
    if (target.kind === 'binding') {
      setSelectedTermId(target.termId)
      locateTokenRef.current += 1
      setLocateRequest({
        bindingId: target.bindingId,
        revisionId: target.revisionId,
        page: target.page,
        token: locateTokenRef.current,
      })
      scrollToReviewTarget(`[data-review-term="${target.termId}"]`)
      return
    }
    if (target.kind === 'relation' || target.kind === 'target') {
      scrollToReviewTarget('#workspace-result-panel')
      return
    }
    scrollToReviewTarget('.dimension-table')
  }

  /**
   * 顶部“导出 JSON”和保存失败提示里的“导出 JSON 备份”共用同一条路径：
   * 导出完成后必须给出可见提示，且提示里明确不含来源附件。
   */
  const handleExportBackup = (): void => {
    void exportBackup().then((revisionCount) => {
      if (revisionCount === null) {
        setExportNotice('导出失败：无法读取项目来源元数据，未生成 JSON 文件。')
        return
      }
      setExportNotice(exportNoticeFor(revisionCount))
    })
  }

  // 其它标签页升级/删除数据库时，本页旧连接已被关闭；明确提示刷新，
  // 不要让用户继续在断开的状态下输入。
  useEffect(
    () =>
      subscribeDatabaseVersionChange((info) => {
        setDatabaseNotice(
          info.newVersion === null
            ? '本地数据库已被其它标签页删除，本页已断开连接。请刷新页面；未保存的输入可能丢失。'
            : `本地数据库已被其它标签页升级到 v${info.newVersion}，本页已断开旧连接。请刷新页面加载最新程序后再继续操作。`,
        )
      }),
    [],
  )

  // 当前草稿无效时由 hook 保留上一次有效链；结果卡和示意图都只读取这一份数据。
  // 但目标字段本身无效时不能把上次有效链的 target 继续喂给结果卡，
  // 否则「当前无效目标 + 上次有效结果」会混在同一组允许区间和裕量里。
  const displayChain = chain ?? lastValidChain
  const targetInvalid = hasTargetInputError(cellErrors)
  const target = targetInvalid ? null : (displayChain?.target ?? null)

  // 报告不再直接读工作台实时数据：只有通过校验的输入才能冻结成快照。
  // 审查未完成也允许创建（规格 §6.1 允许带待办的报告），但必须在报告里标明。
  const snapshotBlockReason = reviewSummary.canCreateReport
    ? null
    : '当前输入未通过校验，不能创建分析快照。请修正输入后再试。'

  /**
   * 表格导入已在 commitImport 内通过 saveDraft 原子写入 projects.working 与草稿；
   * 这里把同一份草稿放进工作台状态，避免界面继续显示导入前的旧值。
   */
  const handleTableImported = (imported: CommitImportSuccess): void => {
    dispatch({ type: 'replaceDraft', draft: imported.draft })
    setTableImportOpen(false)
    setTableImportMessage(
      `已从表格导入，当前共 ${imported.chain.terms.length} 个组成环；关系确认已清除，请重新核对。`,
    )
  }

  const performCreateSnapshot = async (): Promise<void> => {
    setPendingSnapshotAction(false)
    setSnapshotBusy(true)
    setSnapshotMessage(null)
    setSnapshotError(null)
    const created = await createAnalysisSnapshot({
      project,
      draft,
      relationState,
      baseline,
    })
    setSnapshotBusy(false)
    if (!created.ok) {
      setSnapshotError(created.error.message)
      return
    }
    setSnapshotMessage(
      `已创建分析快照 ${created.value.id.slice(0, 8)}…；审查状态：${
        created.value.status === 'complete'
          ? '完成'
          : `未完成（${created.value.pendingCount} 项待办）`
      }。报告内容已冻结。`,
    )
    if (onOpenReport !== undefined) {
      onOpenReport(project.id, created.value.id)
      return
    }
    window.location.hash = `#/projects/${encodeURIComponent(project.id)}/reports/${encodeURIComponent(created.value.id)}`
  }

  const handleCreateSnapshot = (): void => {
    if (!reviewSummary.canCreateReport || snapshotBusy) {
      return
    }
    // 审查未完成时先让用户明确知道报告会带待办，不能事后误以为是复核报告。
    if (!reviewSummary.reviewComplete) {
      setPendingSnapshotAction(true)
      return
    }
    void performCreateSnapshot()
  }

  const handleOpenSnapshots = (): void => {
    if (onOpenSnapshots !== undefined) {
      onOpenSnapshots(project.id)
      return
    }
    window.location.hash = `#/projects/${encodeURIComponent(project.id)}/snapshots`
  }

  const performSaveBaseline = async (): Promise<void> => {
    const overwriting = baseline !== null
    setPendingBaselineAction(null)
    setBaselineBusy(true)
    setBaselineMessage(null)
    setBaselineError(null)

    const result = await saveBaseline()
    setBaselineBusy(false)
    if (result.ok) {
      setBaselineMessage(overwriting ? '已覆盖基线' : '已保存为基线')
    } else {
      setBaselineError(result.error.message)
    }
  }

  const handleSaveBaseline = (): void => {
    setBaselineError(null)
    if (baseline !== null) {
      setPendingBaselineAction('overwrite')
      return
    }
    void performSaveBaseline()
  }

  const performRestoreBaseline = async (): Promise<void> => {
    setPendingBaselineAction(null)
    setBaselineBusy(true)
    setBaselineMessage(null)
    setBaselineError(null)

    const result = await restoreBaseline()
    setBaselineBusy(false)
    if (result.ok) {
      setBaselineMessage('已恢复基线，关系确认已清除')
    } else {
      setBaselineError(result.error.message)
    }
  }

  return (
    <main className="workspace">
      <header className="workspace__header">
        <div>
          <h1 className="workspace__title">轴系轴向公差链分析</h1>
          <p className="workspace__subtitle">
            项目：{project.name}。输入组成环与目标区间，核对尺寸关系与作用方向后查看正式判定。
            所有数值使用 mm，计算由本地计算内核完成。
          </p>
        </div>
        <div className="workspace__header-meta">
          {stale && draft.terms.length > 0 ? (
            <span className="workspace__draft-state">待修正</span>
          ) : null}
          <span
            className={`workspace__save workspace__save--${saveStatus}`}
            role="status"
            aria-live="polite"
          >
            {SAVE_STATUS_LABEL[saveStatus]}
          </span>
          <button
            type="button"
            className="workspace__nav-button"
            onClick={onBackToList}
          >
            返回项目列表
          </button>
          <button
            type="button"
            className="workspace__print-button"
            onClick={handleCreateSnapshot}
            disabled={snapshotBlockReason !== null || snapshotBusy}
            aria-describedby={
              snapshotBlockReason === null ? undefined : 'workspace-print-reason'
            }
            title={snapshotBlockReason ?? '把当前输入、结果与审查状态冻结为不可变快照'}
          >
            {snapshotBusy ? '创建中…' : '创建分析快照'}
          </button>
          <button
            type="button"
            className="workspace__nav-button"
            onClick={handleOpenSnapshots}
          >
            分析快照
          </button>
          <button
            type="button"
            className="workspace__table-import-button"
            onClick={() => setTableImportOpen(true)}
            disabled={editingDisabled}
          >
            从表格追加/替换
          </button>
          <button
            type="button"
            className="workspace__export-button"
            onClick={handleExportBackup}
          >
            导出 JSON
          </button>
          <span className="workspace__badge">MVP · 一维极值法</span>
        </div>
      </header>

      {migrationNotice !== null && !migrationNoticeDismissed ? (
        <div className="workspace__migration-notice" role="status">
          <div>
            <h2 className="workspace__error-title">项目已从旧版本升级</h2>
            <p>{migrationNotice}</p>
          </div>
          <div className="workspace__save-error-actions">
            <button type="button" onClick={() => setMigrationNoticeDismissed(true)}>
              知道了
            </button>
          </div>
        </div>
      ) : null}

      {exportNotice !== null ? (
        <p className="workspace__export-note" role="status">
          {exportNotice}
        </p>
      ) : null}

      {databaseNotice !== null ? (
        <div className="workspace__save-error" role="alert">
          <div>
            <h2 className="workspace__error-title">本地数据库版本已变化</h2>
            <p>{databaseNotice}</p>
          </div>
        </div>
      ) : null}

      {snapshotBlockReason !== null ? (
        <p
          id="workspace-print-reason"
          className="workspace__print-reason"
          role="status"
        >
          {snapshotBlockReason}
        </p>
      ) : null}

      {snapshotMessage !== null ? (
        <p className="workspace__table-import-message" role="status">
          {snapshotMessage}
        </p>
      ) : null}

      {snapshotError !== null ? (
        <p className="workspace__baseline-error" role="alert">
          {snapshotError}
        </p>
      ) : null}

      {tableImportMessage !== null ? (
        <p className="workspace__table-import-message" role="status">
          {tableImportMessage}
        </p>
      ) : null}

      {saveStatus === 'failed' ? (
        <div className="workspace__save-error" role="alert">
          <div>
            <h2 className="workspace__error-title">
              本地存储不可用，草稿可能没有保存
            </h2>
            <p>
              发生了什么：保存失败（{saveError?.message ?? '无法写入本地数据库'}）。
              当前修改可能只保留在本页面内存中，刷新或关闭页面后会丢失。
            </p>
            <p>
              接下来：请立即导出 JSON 备份，避免丢失输入；修复浏览器存储后，
              再点“重试”重新保存当前草稿。
            </p>
            <p className="workspace__backup-note">
              备份不含来源附件（只保留来源元数据与绑定坐标），也不含未通过校验的修改。
            </p>
          </div>
          <div className="workspace__save-error-actions">
            <button type="button" onClick={handleExportBackup}>
              导出 JSON 备份（不含来源附件）
            </button>
            <button type="button" onClick={() => void retrySave()}>
              重试
            </button>
          </div>
        </div>
      ) : null}

      <div className="workspace__grid">
        <div className="workspace__column workspace__column--table">
          <DimensionTable
            draft={draft}
            dispatch={dispatch}
            chain={chain}
            cellErrors={cellErrors}
            stale={stale}
            selectedTermId={selectedTermId}
            onSelect={setSelectedTermId}
            sourceBindingCounts={sourceBindingCounts}
            sourceReviewPendingCounts={sourceReviewPendingCounts}
          />
        </div>

        <div className="workspace__column workspace__column--middle">
          <ChainExpression draft={draft} />
          <ChainDiagram
            terms={draft.terms}
            selectedTermId={selectedTermId}
            onSelect={setSelectedTermId}
          />
        </div>

        <div className="workspace__column workspace__column--result">
          <ResultPanel
            draft={draft}
            dispatch={dispatch}
            result={result}
            target={target}
            terms={displayChain?.terms}
            cellErrors={cellErrors}
            stale={stale}
            relationConfirmed={relationConfirmed}
            relationReviewStale={relationReviewStale}
            onSetRelationConfirmed={(confirmed) => {
              void setRelationConfirmed(confirmed)
            }}
          />
        </div>
      </div>

      <ReviewSidebar
        summary={reviewSummary}
        stale={stale}
        onLocate={handleReviewLocate}
      />

      <SourcePanel
        projectId={project.id}
        terms={draft.terms}
        selectedTermId={selectedTermId}
        onBindingsChange={setSourceBindings}
        onReviewSummaryChange={setSourceReviewPendingCounts}
        onSourceStateChange={setSourceState}
        locateRequest={locateRequest}
      />

      <section
        className="workspace__baseline"
        aria-labelledby="workspace-baseline-heading"
      >
        <div className="workspace__baseline-header">
          <div>
            <h2 id="workspace-baseline-heading" className="workspace__baseline-title">
              基线与方案对比
            </h2>
            <p className="workspace__baseline-status">
              {baseline === null
                ? '尚未保存基线。保存后可在修改方案时对比变化。'
                : `已有基线，保存于 ${formatBaselineTime(baseline.savedAt)}。`}
            </p>
          </div>
          <div className="workspace__baseline-actions">
            <button
              type="button"
              onClick={handleSaveBaseline}
              disabled={editingDisabled || chain === null || baselineBusy}
            >
              保存为基线
            </button>
            <button
              type="button"
              onClick={() => setPendingBaselineAction('restore')}
              disabled={editingDisabled || baseline === null || baselineBusy}
            >
              恢复基线
            </button>
          </div>
        </div>

        {chain === null && draft.terms.length > 0 ? (
          <p className="workspace__baseline-hint">
            当前草稿未通过校验，修正后才能保存基线或进行对比。
          </p>
        ) : null}
        {baseline === null && draft.terms.length === 0 ? (
          <p className="workspace__baseline-hint">
            先建立有效尺寸链，再保存为基线。
          </p>
        ) : null}
        {baselineMessage !== null ? (
          <p className="workspace__baseline-message" role="status">
            {baselineMessage}
          </p>
        ) : null}
        {baselineError !== null ? (
          <p className="workspace__baseline-error" role="alert">
            {baselineError}
          </p>
        ) : null}

        {baseline !== null && chain !== null ? (
          <ScenarioCompare baseline={baseline.definition} working={chain} />
        ) : null}
        {baseline !== null && chain === null ? (
          <p className="workspace__baseline-hint">
            当前草稿无效，无法比较；基线仍然保留。
          </p>
        ) : null}
      </section>

      {pendingSnapshotAction ? (
        <ConfirmDialog
          title="审查未完成，仍创建快照？"
          message={
            <>
              <p>
                当前有 {reviewSummary.pending.length} 项待办（例如来源未核对或尺寸关系未确认）。
                创建快照后，报告会明确标注“审查未完成”，并列出全部待办，
                不会被标成已完成复核报告。
              </p>
              <p>快照内容创建后不可修改；工作数据再变化时，它只会被标记为历史。</p>
            </>
          }
          confirmLabel="创建带待办快照"
          onConfirm={() => {
            void performCreateSnapshot()
          }}
          onCancel={() => setPendingSnapshotAction(false)}
        />
      ) : null}

      {pendingBaselineAction === 'overwrite' ? (
        <ConfirmDialog
          title="覆盖基线？"
          message="已有基线将被当前有效方案覆盖，覆盖后原基线不能恢复。"
          confirmLabel="覆盖基线"
          onConfirm={() => {
            void performSaveBaseline()
          }}
          onCancel={() => setPendingBaselineAction(null)}
        />
      ) : null}

      {tableImportOpen ? (
        <ImportWizard
          project={project}
          baseDraft={draft}
          onClose={() => setTableImportOpen(false)}
          onImported={handleTableImported}
        />
      ) : null}

      {pendingBaselineAction === 'restore' ? (
        <ConfirmDialog
          title="恢复基线？"
          message="当前工作方案将被基线内容替换，关系确认会被清除；基线本身不会改变。"
          confirmLabel="确认恢复"
          onConfirm={() => {
            void performRestoreBaseline()
          }}
          onCancel={() => setPendingBaselineAction(null)}
        />
      ) : null}
    </main>
  )
}

/**
 * 分析工作台入口：先从 IndexedDB 恢复（或创建）项目，读取完成前只显示加载状态。
 * 尺寸链计算全部来自 useWorkspace（内部调用 calculateChain），这里不写公式。
 */
export function Workspace({
  projectId,
  onBackToList,
  onOpenReport,
  onOpenSnapshots,
  saveDraft,
}: WorkspaceProps = {}) {
  const bootstrap = useWorkspaceBootstrap(projectId)
  const [bootstrapExportMessage, setBootstrapExportMessage] = useState<
    string | null
  >(null)
  const backToList =
    onBackToList ??
    (() => {
      window.location.hash = '#/projects'
    })

  /**
   * 引导失败时仍尝试重新读取一次项目并导出：如果只是某次读取/打开失败，
   * 用户仍可能拿到上一次保存的 JSON；若完全读不到，则明确说明暂无备份。
   */
  const handleBootstrapExport = async (): Promise<void> => {
    setBootstrapExportMessage(null)

    let project: Project | null
    if (projectId !== undefined) {
      const loaded = await getProject(projectId)
      project = loaded.ok ? loaded.value : null
    } else {
      const listed = await listProjects()
      project = listed.ok ? (listed.value[0] ?? null) : null
    }

    if (project === null) {
      setBootstrapExportMessage(
        '仍然无法读取本地项目，当前页面没有可导出的数据。请先重试；若持续失败，请返回项目列表。',
      )
      return
    }

    // 先尝试收集来源元数据（不是附件）：这样应急备份和普通导出保持同一契约。
    const sources = await loadProjectSources(project.id)
    if (sources.ok) {
      downloadProjectBackup(project, sources.value)
      const revisionCount = sources.value.revisions.length
      setBootstrapExportMessage(
        revisionCount > 0
          ? `已导出项目 JSON 备份：含 ${revisionCount} 个来源版本的元数据与绑定坐标，不含来源附件；当前页面中尚未保存的输入不在备份内。`
          : '已导出项目 JSON 备份：其中不含来源附件；当前页面中尚未保存的输入不在备份内。',
      )
      return
    }

    // 读不到来源元数据时仍然导出工程数据，但明确告知这是降级备份，
    // 不能静默输出空 sources 还叫“普通备份”。
    downloadProjectBackup(project)
    setBootstrapExportMessage(
      '已导出降级备份：读取来源元数据失败，文件为普通项目备份，不含来源记录、绑定坐标与附件；' +
        '当前页面中尚未保存的输入不在备份内。',
    )
  }

  if (bootstrap.status === 'loading') {
    return (
      <main className="workspace">
        <p className="workspace__loading" role="status">
          正在加载本地项目…
        </p>
        <div className="workspace__loading-actions">
          <button type="button" onClick={backToList}>
            返回项目列表
          </button>
        </div>
      </main>
    )
  }

  if (bootstrap.status === 'error') {
    const notFound = bootstrap.error.code === 'not_found'

    if (notFound) {
      return (
        <main className="workspace">
          <section className="workspace__load-error" role="alert">
            <div>
              <h1 className="workspace__error-title">项目不存在</h1>
              <p>
                发生了什么：找不到项目
                <span className="workspace__mono">{projectId}</span>
                （{bootstrap.error.message}）。它可能已被删除，或链接中的项目 ID
                不正确。
              </p>
              <p>接下来：返回项目列表，重新打开或新建一个项目。</p>
            </div>
            <div className="workspace__load-error-actions">
              <button type="button" onClick={backToList}>
                返回项目列表
              </button>
            </div>
          </section>
        </main>
      )
    }

    if (bootstrap.error.code === 'database_too_new') {
      return (
        <main className="workspace">
          <section className="workspace__load-error" role="alert">
            <div>
              <h1 className="workspace__error-title">页面程序版本过旧</h1>
              <p>
                发生了什么：{bootstrap.error.message}。本地数据库已经由更新的页面
                升级，当前页面仍在运行旧代码，因此无法打开它。
              </p>
              <p>
                接下来：刷新页面加载最新程序，然后重新打开项目。不要删除浏览器数据
                或尝试降级数据库；仅回退前端代码不能打开已升级的库。
              </p>
            </div>
            <div className="workspace__load-error-actions">
              <button type="button" onClick={() => window.location.reload()}>
                刷新页面
              </button>
              <button type="button" onClick={backToList}>
                返回项目列表
              </button>
            </div>
          </section>
        </main>
      )
    }

    if (bootstrap.error.code === 'database_blocked') {
      return (
        <main className="workspace">
          <section className="workspace__load-error" role="alert">
            <div>
              <h1 className="workspace__error-title">数据库正被其它页面占用</h1>
              <p>发生了什么：{bootstrap.error.message}。</p>
              <p>
                接下来：关闭或刷新仍在运行旧版本程序的其它标签页，然后点“重试”。
                升级完成前不要继续在旧页面输入。
              </p>
            </div>
            <div className="workspace__load-error-actions">
              <button type="button" onClick={bootstrap.retry}>
                重试
              </button>
              <button type="button" onClick={backToList}>
                返回项目列表
              </button>
            </div>
          </section>
        </main>
      )
    }

    return (
      <main className="workspace">
        <section className="workspace__load-error" role="alert">
          <div>
            <h1 className="workspace__error-title">本地存储不可用</h1>
            <p>
              发生了什么：{bootstrap.error.message}。浏览器无法打开 IndexedDB
              数据库，当前输入和草稿可能没有保存。
            </p>
            <p>
              接下来：先点“重试”重新打开本地数据库；如果仍然失败，请返回项目列表。
              若之前保存过项目，可以尝试导出 JSON 备份。
            </p>
            {bootstrapExportMessage !== null ? (
              <p className="workspace__backup-note" role="status">
                {bootstrapExportMessage}
              </p>
            ) : null}
          </div>
          <div className="workspace__load-error-actions">
            <button type="button" onClick={() => void handleBootstrapExport()}>
              导出 JSON 备份
            </button>
            <button type="button" onClick={bootstrap.retry}>
              重试
            </button>
            <button type="button" onClick={backToList}>
              返回项目列表
            </button>
          </div>
        </section>
      </main>
    )
  }

  return (
    <WorkspaceEditor
      key={bootstrap.project.id}
      project={bootstrap.project}
      initialDraft={bootstrap.initialDraft}
      initialValidChain={bootstrap.initialValidChain}
      migrationNotice={bootstrap.migrationNotice}
      onBackToList={backToList}
      onOpenReport={onOpenReport}
      onOpenSnapshots={onOpenSnapshots}
      saveDraft={saveDraft}
    />
  )
}
