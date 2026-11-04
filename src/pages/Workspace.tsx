import { useState } from 'react'
import { ChainDiagram } from '../components/ChainDiagram'
import { ChainExpression } from '../components/ChainExpression'
import { DimensionTable } from '../components/DimensionTable'
import { ResultPanel } from '../components/ResultPanel'
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
  } = usePersistedWorkspace(project, initialDraft, {
    initialValidChain,
    saveDraft,
  })
  const [selectedTermId, setSelectedTermId] = useState<string | null>(null)

  // 当前草稿无效时由 hook 保留上一次有效链；结果卡和示意图都只读取这一份数据。
  const displayChain = chain ?? lastValidChain
  const target = displayChain?.target ?? null

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
          <p>
            保存失败：{saveError?.message ?? '无法写入本地数据库'}。
            请立即导出 JSON 备份，避免刷新或关闭页面后丢失输入。
          </p>
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
