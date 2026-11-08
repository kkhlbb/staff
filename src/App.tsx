import { useEffect, useState, type ReactNode } from 'react'
import { DatabaseVersionGuard } from './storage/DatabaseVersionGuard'
import { PrintReport } from './pages/PrintReport'
import { ProjectList } from './pages/ProjectList'
import { Workspace } from './pages/Workspace'

type Route =
  | { page: 'projects' }
  | { page: 'workspace'; projectId: string }
  | { page: 'report'; projectId: string }

const PROJECTS_HASH = '#/projects'

function parseRoute(hash: string): Route {
  // 报告路由先于工作台路由匹配，避免 #/projects/<id>/report 被当成项目 id。
  const reportMatch = /^#\/(?:project|projects)\/([^/]+)\/report\/?$/.exec(hash)
  if (reportMatch !== null) {
    try {
      return { page: 'report', projectId: decodeURIComponent(reportMatch[1]) }
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

  let content: ReactNode
  if (route.page === 'report') {
    content = (
      <PrintReport
        key={route.projectId}
        projectId={route.projectId}
        onBackToWorkspace={openProject}
        onBackToList={backToProjects}
      />
    )
  } else if (route.page === 'workspace') {
    content = (
      <Workspace
        key={route.projectId}
        projectId={route.projectId}
        onBackToList={backToProjects}
      />
    )
  } else {
    content = <ProjectList onOpenProject={openProject} />
  }

  return <DatabaseVersionGuard>{content}</DatabaseVersionGuard>
}

export default App
