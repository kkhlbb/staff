import type { ProjectFileSnapshot } from '../project-file/types'
import type { ChainDefinition } from '../domain/types'
import { chainToDraft, draftToChain, type WorkspaceDraft } from './draft'

type SyncSnapshot = Pick<ProjectFileSnapshot, 'project' | 'draft' | 'fileRevisions'>

export function officialDraft(chain: ChainDefinition, revision: number): WorkspaceDraft {
  return { ...chainToDraft(chain), relationRevision: revision }
}

/** Compare all input fields, in q, including structure, notes and term revisions.
 * Numeric display precision alone does not constitute an independent edit.
 */
export function isChainMirror(draft: WorkspaceDraft, chain: ChainDefinition): boolean {
  const parsed = draftToChain(draft)
  const official = draftToChain(chainToDraft(chain))
  return parsed.ok && official.ok && JSON.stringify(parsed.chain) === JSON.stringify(official.chain)
}

/** Legacy compatibility is deliberately conservative: a matching historical
 * official chain at the declared revision is required. Structure alone cannot
 * distinguish a user's numeric edit from a stale mirror. No history is rewritten.
 */
export function resolveDraft(snapshot: SyncSnapshot): { draft: WorkspaceDraft; kind: 'mirror' | 'stale-mirror' | 'edited'; basis: number; message: string | null } {
  const { project, draft } = snapshot
  const current = officialDraft(project.dimensionChain, project.relationRevision)
  if (draft === null || (draft.basisRelationRevision === undefined && isChainMirror(draft, project.dimensionChain))) {
    return { draft: current, kind: 'mirror', basis: project.relationRevision, message: null }
  }
  const basis = draft.basisRelationRevision ?? draft.relationRevision
  const staleMirror = draft.basisRelationRevision === undefined
    && draft.relationRevision < project.relationRevision
    && snapshot.fileRevisions.some(item => item.project.relationRevision === draft.relationRevision
      && isChainMirror(draft, item.project.dimensionChain))
  if (staleMirror) return {
    draft: current, kind: 'stale-mirror', basis,
    message: `旧草稿（关系版本 ${basis}）已由正式版本 ${project.relationRevision} 取代`,
  }
  return { draft, kind: 'edited', basis,
    message: `草稿基于关系版本 ${basis}，正式已是 ${project.relationRevision}；当前计算为草稿，非正式结果` }
}

export function draftAfterCommit(base: SyncSnapshot, chain: ChainDefinition, revision: number): WorkspaceDraft {
  const resolved = resolveDraft(base)
  return resolved.kind === 'edited'
    ? { ...resolved.draft, basisRelationRevision: resolved.basis }
    : officialDraft(chain, revision)
}
