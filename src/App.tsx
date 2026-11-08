import { useEffect, useState, type ReactNode } from 'react'
import { DatabaseVersionGuard } from './storage/DatabaseVersionGuard'
import { PrintReport } from './pages/PrintReport'
import { ProjectList } from './pages/ProjectList'
import { SnapshotList } from './pages/SnapshotList'
import { Workspace } from './pages/Workspace'

type Route =
  | { page: 'projects' }
  | { page: 'workspace'; projectId: string }
  | { page: 'snapshots'; projectId: string; legacyNotice: string | null }
  | { page: 'report'; projectId: string; snapshotId: string }

const PROJECTS_HASH = '#/projects'

const LEGACY_REPORT_NOTICE =
  '报告入口已改为“分析快照”。旧链接不再读取实时数据，请选择已有快照或回到工作台创建新快照。'

function parseRoute(hash: string): Route {
  // 快照报告与快照列表先于工作台路由匹配，避免被当成项目 id。
  const reportMatch = /^#\/(?:project|projects)\/([^/]+)\/reports\/([^/]+)\/?$/.exec(
    hash,
  )
  if (reportMatch !== null) {
    try {
      return {
        page: 'report',
        projectId: decodeURIComponent(reportMatch[1]),
        snapshotId: decodeURIComponent(reportMatch[2]),
      }
    } catch {
      return { page: 'projects' }
    }
  }

  const snapshotsMatch = /^#\/(?:project|projects)\/([^/]+)\/snapshots\/?$/.exec(
    hash,
  )
  if (snapshotsMatch !== null) {
    try {
      return {
        page: 'snapshots',
        projectId: decodeURIComponent(snapshotsMatch[1]),
        legacyNotice: null,
      }
    } catch {
      return { page: 'projects' }
    }
  }

  // 旧打印报告链接：明确提示行为变更，转到快照列表，不静默读实时数据。
  const legacyReportMatch = /^#\/(?:project|projects)\/([^/]+)\/report\/?$/.exec(
    hash,
  )
  if (legacyReportMatch !== null) {
    try {
      return {
        page: 'snapshots',
        projectId: decodeURIComponent(legacyReportMatch[1]),
        legacyNotice: LEGACY_REPORT_NOTICE,
      }
    } catch {
      return { page: 'projects' }
    }
  }

  const match = /^#\/(?:projects|workspace)\/(.+)$/.exec(hash)
  if (match === null) {
    return { page: 'projects' }
  }
  try {
    return { page: 'workspace', projectId: decodeURIComponent(match[1]) }
  } catch {
    return { page: 'projects' }
  }
}

function workspaceHash(projectId: string): string {
  return `${PROJECTS_HASH}/${encodeURIComponent(projectId)}`
}

function snapshotsHash(projectId: string): string {
  return `${workspaceHash(projectId)}/snapshots`
}

function reportHash(projectId: string, snapshotId: string): string {
  return `${workspaceHash(projectId)}/reports/${encodeURIComponent(snapshotId)}`
}

/**
 * 不引入第三方路由库：项目列表与工作台通过 location.hash 切换，
 * 同时保留浏览器前进/后退能力。
 */
function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))

  useEffect(() => {
    const syncRoute = (): void => {
      setRoute(parseRoute(window.location.hash))
    }
    window.addEventListener('hashchange', syncRoute)
    window.addEventListener('popstate', syncRoute)
    return () => {
      window.removeEventListener('hashchange', syncRoute)
      window.removeEventListener('popstate', syncRoute)
    }
  }, [])

  const openProject = (projectId: string): void => {
    const nextHash = workspaceHash(projectId)
    if (window.location.hash !== nextHash) {
      window.history.pushState(null, '', nextHash)
    }
    setRoute({ page: 'workspace', projectId })
  }

  const backToProjects = (): void => {
    if (window.location.hash !== PROJECTS_HASH) {
      window.history.pushState(null, '', PROJECTS_HASH)
    }
    setRoute({ page: 'projects' })
  }

  const openSnapshots = (projectId: string): void => {
    const nextHash = snapshotsHash(projectId)
    if (window.location.hash !== nextHash) {
      window.history.pushState(null, '', nextHash)
    }
    setRoute({ page: 'snapshots', projectId, legacyNotice: null })
  }

  const openReport = (projectId: string, snapshotId: string): void => {
    const nextHash = reportHash(projectId, snapshotId)
    if (window.location.hash !== nextHash) {
      window.history.pushState(null, '', nextHash)
    }
    setRoute({ page: 'report', projectId, snapshotId })
  }

  let content: ReactNode
  if (route.page === 'report') {
    content = (
      <PrintReport
        key={`${route.projectId}:${route.snapshotId}`}
        projectId={route.projectId}
        snapshotId={route.snapshotId}
        onBackToWorkspace={openProject}
        onBackToSnapshots={openSnapshots}
        onBackToList={backToProjects}
      />
    )
  } else if (route.page === 'snapshots') {
    content = (
      <SnapshotList
        key={route.projectId}
        projectId={route.projectId}
        legacyNotice={route.legacyNotice}
        onBackToWorkspace={openProject}
        onOpenReport={openReport}
        onBackToList={backToProjects}
      />
    )
  } else if (route.page === 'workspace') {
    content = (
      <Workspace
        key={route.projectId}
        projectId={route.projectId}
        onBackToList={backToProjects}
        onOpenReport={openReport}
        onOpenSnapshots={openSnapshots}
      />
    )
  } else {
    content = <ProjectList onOpenProject={openProject} />
  }

  return <DatabaseVersionGuard>{content}</DatabaseVersionGuard>
}

export default App
