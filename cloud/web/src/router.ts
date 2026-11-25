export interface ParsedReviewRouteMatch {
  readonly matched: true
  readonly projectId: string
  readonly draftRevision: string
  readonly apiBase: string
  readonly apiKey?: string
  readonly webhookUrl?: string
  readonly theme?: 'light' | 'dark'
}

export interface ParsedReviewRouteInvalid {
  readonly matched: false
  readonly rawPath: string
  readonly reason: string
}

export type ParsedReviewRoute = ParsedReviewRouteMatch | ParsedReviewRouteInvalid

export interface RouteLocationLike {
  readonly pathname: string
  readonly search?: string
  readonly hash?: string
}

function safeDecode(segment: string): string | null {
  try {
    const decoded = decodeURIComponent(segment).trim()
    return decoded.length > 0 ? decoded : null
  } catch {
    return null
  }
}

function parseOptionalParams(searchStr: string): {
  readonly apiBase: string
  readonly apiKey?: string
  readonly webhookUrl?: string
  readonly theme?: 'light' | 'dark'
} {
  const params = new URLSearchParams(searchStr.startsWith('?') ? searchStr.slice(1) : searchStr)
  const apiBase = params.get('apiBase')?.trim() ?? ''
  const apiKey = params.get('apiKey')?.trim() || undefined
  const webhookUrl = params.get('webhookUrl')?.trim() || undefined
  const rawTheme = params.get('theme')?.trim().toLowerCase()
  const theme = rawTheme === 'dark' || rawTheme === 'light' ? rawTheme : undefined
  return { apiBase, apiKey, webhookUrl, theme }
}

function matchReviewPath(rawPath: string): { projectId: string; draftRevision: string } | null {
  const cleaned = rawPath.replace(/\/+$/, '')
  const match = /^\/review\/([^/]+)\/([^/]+)$/.exec(cleaned)
  if (!match) return null
  const projectId = safeDecode(match[1])
  const draftRevision = safeDecode(match[2])
  if (!projectId || !draftRevision) return null
  return { projectId, draftRevision }
}

/**
 * Parse `/review/:projectId/:draftRev` from either `pathname` or `#/review/:projectId/:draftRev`
 * hash routes, along with optional query parameters (`apiBase`, `apiKey`, `webhookUrl`, `theme`).
 */
export function parseReviewRoute(location: RouteLocationLike): ParsedReviewRoute {
  const pathname = location.pathname || '/'
  const search = location.search || ''
  const hash = location.hash || ''

  // 1. Standard pathname route: /review/:projectId/:draftRev
  const pathHit = matchReviewPath(pathname)
  if (pathHit) {
    const opts = parseOptionalParams(search)
    return {
      matched: true,
      projectId: pathHit.projectId,
      draftRevision: pathHit.draftRevision,
      ...opts,
    }
  }

  // 2. Hash route compatibility: #/review/:projectId/:draftRev(?query)
  if (hash.startsWith('#')) {
    const hashBody = hash.slice(1)
    const qIdx = hashBody.indexOf('?')
    const hashPath = qIdx >= 0 ? hashBody.slice(0, qIdx) : hashBody
    const hashQuery = qIdx >= 0 ? hashBody.slice(qIdx + 1) : ''
    const hashHit = matchReviewPath(hashPath)
    if (hashHit) {
      const mergedQuery = [search.replace(/^\?/, ''), hashQuery].filter(Boolean).join('&')
      const opts = parseOptionalParams(mergedQuery)
      return {
        matched: true,
        projectId: hashHit.projectId,
        draftRevision: hashHit.draftRevision,
        ...opts,
      }
    }
  }

  const rawPath = `${pathname}${search}${hash}`
  return {
    matched: false,
    rawPath,
    reason: '路径不符合审核路由规范，请使用 /review/:projectId/:draftRev 或 #/review/:projectId/:draftRev。',
  }
}
