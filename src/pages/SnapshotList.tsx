import { useCallback, useEffect, useState } from 'react'
import type { AnalysisSnapshot, SnapshotListItem } from '../history/snapshots'
import { listAnalysisSnapshots } from '../history/snapshots'
import { getProject } from '../storage/projects'
import './SnapshotList.css'

export interface SnapshotListProps {
  projectId: string
  /** 返回工作台；未提供时回退到 location.hash 路由。 */
  onBackToWorkspace?: (projectId: string) => void
  /** 打开某份快照的报告；未提供时回退到 location.hash 路由。 */
  onOpenReport?: (projectId: string, snapshotId: string) => void
  /** 返回项目列表；未提供时回退到 location.hash 路由。 */
  onBackToList?: () => void
  /** 旧报告链接迁移到快照列表时的说明。 */
  legacyNotice?: string | null
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string; notFound: boolean }
  | {
      status: 'loaded'
      projectName: string
      items: SnapshotListItem[]
    }

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
}

function snapshotStatus(snapshot: AnalysisSnapshot): string {
  return snapshot.status === 'complete'
    ? '审查完成'
    : `审查未完成（${snapshot.pendingCount} 项待办）`
}

/**
 * 报告快照列表（规格 §9）。
 *
 * 列表只读快照与当前工作数据指纹：历史标记由快照模块派生，页面不重算快照、
 * 不改写规则结果。点击“打开报告”进入只读快照报告。
 */
export function SnapshotList({
  projectId,
  onBackToWorkspace,
  onOpenReport,
  onBackToList,
  legacyNotice = null,
}: SnapshotListProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    Promise.all([getProject(projectId), listAnalysisSnapshots(projectId)])
      .then(([project, snapshots]) => {
        if (cancelled) {
          return
        }
        if (!project.ok) {
          setState({
            status: 'error',
            message: `无法读取项目：${project.error.message}`,
            notFound: false,
          })
          return
        }
        if (project.value === null) {
          setState({
            status: 'error',
            message: `项目不存在：${projectId}`,
            notFound: true,
          })
          return
        }
        if (!snapshots.ok) {
          setState({
            status: 'error',
            message: snapshots.error.message,
            notFound: snapshots.error.code === 'project_not_found',
          })
          return
        }
        setState({
          status: 'loaded',
          projectName: project.value.name,
          items: snapshots.value,
        })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: `无法加载分析快照：${
              error instanceof Error ? error.message : String(error)
            }`,
            notFound: false,
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [projectId, reloadToken])

  const backToWorkspace = useCallback((): void => {
    if (onBackToWorkspace !== undefined) {
      onBackToWorkspace(projectId)
      return
    }
    window.location.hash = `#/projects/${encodeURIComponent(projectId)}`
  }, [onBackToWorkspace, projectId])

  const openReport = useCallback(
    (snapshotId: string): void => {
      if (onOpenReport !== undefined) {
        onOpenReport(projectId, snapshotId)
        return
      }
      window.location.hash = `#/projects/${encodeURIComponent(projectId)}/reports/${encodeURIComponent(snapshotId)}`
    },
    [onOpenReport, projectId],
  )

  const backToList = useCallback((): void => {
    if (onBackToList !== undefined) {
      onBackToList()
      return
    }
    window.location.hash = '#/projects'
  }, [onBackToList])

  if (state.status === 'loading') {
    return (
      <main className="snapshot-list">
        <p className="snapshot-list__loading" role="status">
          正在加载分析快照…
        </p>
      </main>
    )
  }

  if (state.status === 'error') {
    return (
      <main className="snapshot-list">
        <section className="snapshot-list__blocked" role="alert">
          <h1>{state.notFound ? '项目不存在' : '无法加载分析快照'}</h1>
          <p>{state.message}</p>
          <div className="snapshot-list__actions">
            {state.notFound ? null : (
              <button type="button" onClick={() => setReloadToken((value) => value + 1)}>
                重试
              </button>
            )}
            <button type="button" onClick={backToList}>
              返回项目列表
            </button>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="snapshot-list">
      <header className="snapshot-list__header">
        <div>
          <p className="snapshot-list__eyebrow">轴系轴向公差链分析</p>
          <h1 className="snapshot-list__title">分析快照</h1>
          <p className="snapshot-list__subtitle">
            项目：{state.projectName}。报告由不可变快照生成，不再读取工作台实时数据。
            工作数据变化后，旧快照标记为历史，内容与规则结果不会重算或覆盖。
          </p>
        </div>
        <div className="snapshot-list__actions">
          <button type="button" onClick={backToWorkspace}>
            返回工作台
          </button>
          <button type="button" onClick={backToList}>
            返回项目列表
          </button>
        </div>
      </header>

      {legacyNotice !== null ? (
        <p className="snapshot-list__notice" role="status">
          {legacyNotice}
        </p>
      ) : null}

      {state.items.length === 0 ? (
        <section className="snapshot-list__empty">
          <p>还没有分析快照。</p>
          <p>
            在工作台确认输入有效后点“创建分析快照”；审查未完成时也可以创建，
            但报告会明确标注待办，不能当作已完成复核报告。
          </p>
          <button type="button" onClick={backToWorkspace}>
            返回工作台创建快照
          </button>
        </section>
      ) : (
        <table className="snapshot-list__table" aria-label="分析快照列表">
          <thead>
            <tr>
              <th scope="col">创建时间</th>
              <th scope="col">审查状态</th>
              <th scope="col">计算状态</th>
              <th scope="col">冻结版本</th>
              <th scope="col">历史标记</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {state.items.map(({ snapshot, historical, historicalReason }) => (
              <tr
                key={snapshot.id}
                data-testid={`snapshot-${snapshot.id}`}
                className={historical ? 'snapshot-list__row--historical' : undefined}
              >
                <td>
                  <time dateTime={snapshot.createdAt}>
                    {formatTime(snapshot.createdAt)}
                  </time>
                  <span className="snapshot-list__id" title={snapshot.id}>
                    {snapshot.id}
                  </span>
                </td>
                <td data-testid={`snapshot-status-${snapshot.id}`}>
                  {snapshotStatus(snapshot)}
                </td>
                <td>{snapshot.review.calculation.label}</td>
                <td className="snapshot-list__version">
                  引擎 {snapshot.engineVersion}
                  <br />
                  规则 {snapshot.reviewRulesVersion}
                </td>
                <td data-testid={`snapshot-history-${snapshot.id}`}>
                  {historical ? (
                    <span className="snapshot-list__historical" title={historicalReason ?? undefined}>
                      历史
                    </span>
                  ) : (
                    <span className="snapshot-list__current">当前</span>
                  )}
                </td>
                <td>
                  <button
                    type="button"
                    onClick={() => openReport(snapshot.id)}
                    data-testid={`snapshot-open-${snapshot.id}`}
                  >
                    打开报告
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="snapshot-list__footnote">
        旧报告标记为历史版本，不重新计算；已导出到本机的文件无法由本软件召回或改写。
        快照记录的是用户自述确认与软件过程状态，不提供身份认证或电子签名。
      </p>
    </main>
  )
}
