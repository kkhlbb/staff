import { useState } from 'react'
import { ChainDiagram } from '../components/ChainDiagram'
import { ChainExpression } from '../components/ChainExpression'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { DimensionTable } from '../components/DimensionTable'
import { ResultPanel } from '../components/ResultPanel'
import { ScenarioCompare } from '../components/ScenarioCompare'
import type { ChainDefinition, Project } from '../domain/types'
import {
  usePersistedWorkspace,
  useWorkspaceBootstrap,
  type SaveDraftFn,
  type SaveStatus,
} from '../workspace/usePersistedWorkspace'
import type { WorkspaceDraft } from '../workspace/draft'
import './Workspace.css'

export interface WorkspaceProps {
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

  // 当前草稿无效时由 hook 保留上一次有效链；结果卡和示意图都只读取这一份数据。
  const displayChain = chain ?? lastValidChain
  const target = displayChain?.target ?? null

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
            输入组成环与目标区间，核对尺寸关系与作用方向后查看正式判定。
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
          <span className="workspace__badge">MVP · 一维极值法</span>
        </div>
      </header>

      {saveStatus === 'failed' ? (
        <div className="workspace__save-error" role="alert">
          <div>
            <p>
              保存失败：{saveError?.message ?? '无法写入本地数据库'}。
              请立即导出 JSON 备份，避免刷新或关闭页面后丢失输入。
            </p>
            <p className="workspace__backup-note">
              备份不含未通过校验的修改。
            </p>
          </div>
          <button type="button" onClick={exportBackup}>
            导出 JSON 备份
          </button>
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
export function Workspace({ saveDraft }: WorkspaceProps = {}) {
  const bootstrap = useWorkspaceBootstrap()

  if (bootstrap.status === 'loading') {
    return (
      <main className="workspace">
        <p className="workspace__loading" role="status">
          正在加载本地项目…
        </p>
      </main>
    )
  }

  if (bootstrap.status === 'error') {
    return (
      <main className="workspace">
        <div className="workspace__load-error" role="alert">
          <p>无法加载本地项目：{bootstrap.error.message}</p>
          <button type="button" onClick={bootstrap.retry}>
            重试
          </button>
        </div>
      </main>
    )
  }

  return (
    <WorkspaceEditor
      key={bootstrap.project.id}
      project={bootstrap.project}
      initialDraft={bootstrap.initialDraft}
      initialValidChain={bootstrap.initialValidChain}
      saveDraft={saveDraft}
    />
  )
}
