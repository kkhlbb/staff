import { useEffect, useState } from 'react'
import { ChainDiagram } from '../components/ChainDiagram'
import { ChainExpression } from '../components/ChainExpression'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { DimensionTable } from '../components/DimensionTable'
import { ImportWizard } from '../components/ImportWizard'
import { ResultPanel } from '../components/ResultPanel'
import { ScenarioCompare } from '../components/ScenarioCompare'
import { SourcePanel } from '../components/SourcePanel'
import type { ChainDefinition, Project } from '../domain/types'
import type { CommitImportSuccess } from '../import/commit'
import { countBindingsByTerm, type SourceBinding } from '../sources/bindings'
import { subscribeDatabaseVersionChange } from '../storage/db'
import { getProject, listProjects } from '../storage/projects'
import { resolveReportEligibility } from '../workspace/status'
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
  /** 打开打印报告；未提供时回退到 location.hash 路由。 */
  onOpenReport?: (projectId: string) => void
  /** 仅测试或特殊场景注入保存实现；默认写入 IndexedDB。 */
  saveDraft?: SaveDraftFn
}

const SAVE_STATUS_LABEL: Record<SaveStatus, string> = {
  saving: '保存中',
  saved: '已保存',
  failed: '保存失败',
}

function formatBaselineTime(savedAt: string): string {
  const date = new Date(savedAt)
  return Number.isNaN(date.getTime()) ? savedAt : date.toLocaleString('zh-CN')
}

type PendingBaselineAction = 'overwrite' | 'restore' | null

interface WorkspaceEditorProps {
  project: Project
  initialDraft: WorkspaceDraft
  initialValidChain: ChainDefinition | null
  onBackToList: () => void
  onOpenReport?: (projectId: string) => void
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
  onBackToList,
  onOpenReport,
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
    saveStatus,
    saveError,
    retrySave,
    exportBackup,
    baseline,
    saveBaseline,
    restoreBaseline,
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
  const [sourceBindings, setSourceBindings] = useState<SourceBinding[]>([])
  const sourceBindingCounts = countBindingsByTerm(sourceBindings)
  const [databaseNotice, setDatabaseNotice] = useState<string | null>(null)

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

  // 打印报告与结果卡共用同一份“有效 + 已确认”门槛；入口禁用时显示具体原因。
  const reportEligibility = resolveReportEligibility({
    result,
    relationConfirmed: chain?.relationConfirmed ?? false,
    stale,
  })

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

  const handleOpenReport = (): void => {
    if (!reportEligibility.eligible) {
      return
    }
    if (onOpenReport !== undefined) {
      onOpenReport(project.id)
      return
    }
    window.location.hash = `#/project/${encodeURIComponent(project.id)}/report`
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
            onClick={handleOpenReport}
            disabled={!reportEligibility.eligible}
            aria-describedby={
              reportEligibility.eligible ? undefined : 'workspace-print-reason'
            }
            title={reportEligibility.message ?? undefined}
          >
            打印报告
          </button>
          <button
            type="button"
            className="workspace__table-import-button"
            onClick={() => setTableImportOpen(true)}
          >
            从表格追加/替换
          </button>
          <button
            type="button"
            className="workspace__export-button"
            onClick={exportBackup}
          >
            导出 JSON
          </button>
          <span className="workspace__badge">MVP · 一维极值法</span>
        </div>
      </header>

      {databaseNotice !== null ? (
        <div className="workspace__save-error" role="alert">
          <div>
            <h2 className="workspace__error-title">本地数据库版本已变化</h2>
            <p>{databaseNotice}</p>
          </div>
        </div>
      ) : null}

      {!reportEligibility.eligible && reportEligibility.message !== null ? (
        <p
          id="workspace-print-reason"
          className="workspace__print-reason"
          role="status"
        >
          {reportEligibility.message}
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
              备份不含未通过校验的修改。
            </p>
          </div>
          <div className="workspace__save-error-actions">
            <button type="button" onClick={exportBackup}>
              导出 JSON 备份
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
          />
        </div>
      </div>

      <SourcePanel
        projectId={project.id}
        terms={draft.terms}
        selectedTermId={selectedTermId}
        onBindingsChange={setSourceBindings}
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
              disabled={chain === null || baselineBusy}
            >
              保存为基线
            </button>
            <button
              type="button"
              onClick={() => setPendingBaselineAction('restore')}
              disabled={baseline === null || baselineBusy}
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

    downloadProjectBackup(project)
    setBootstrapExportMessage(
      '已导出可读取的项目 JSON 备份；当前页面中尚未保存的输入不在备份内。',
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
      onBackToList={backToList}
      onOpenReport={onOpenReport}
      saveDraft={saveDraft}
    />
  )
}
