import type { ProjectFileSnapshot } from '../../../src/project-file/types'
import { desktopGdtEnabled } from './gdtTools'
import type { M1ModelAttachment } from './m1ModelApi'

export function readWorkbenchAttachment(snapshot: ProjectFileSnapshot | undefined, ref: string,
  readM2: (documentRef: string) => M1ModelAttachment | null): M1ModelAttachment | null {
  if (!snapshot) return null
  const { project } = snapshot
  const requirement = project.requirementRevisions.find(item => item.revisionId === ref && item.projectId === project.id)
  if (requirement && requirement.revisionId !== project.activeRequirementRevisionId) return null
  const source = requirement?.source
  if (source?.kind === 'user-attestation') return null
  const revision = snapshot.revisions.find(item => item.projectId === project.id && item.id === (source?.revisionId ?? ref))
  if (!revision || snapshot.missingAttachments.some(item => item.revisionId === revision.id) ||
    !snapshot.documents.some(item => item.projectId === project.id && item.id === revision.documentId &&
      item.latestRevisionId === revision.id)) return null
  if (requirement && source) {
    if (source.documentId !== revision.documentId || source.sha256 !== revision.sha256 ||
      source.blobKey !== revision.blobKey) return null
    return { excerpt: requirement.confirmedText, page: source.page,
      ...(desktopGdtEnabled() && { pdfSource: { kind: 'pdf-page' as const, revisionId: revision.id, sha256: revision.sha256, page: source.page } }) }
  }
  const excerpt = readM2(revision.id)
  return excerpt && desktopGdtEnabled() ? { ...excerpt, pdfSource: { kind: 'pdf-page', revisionId: revision.id,
    sha256: revision.sha256, page: excerpt.page } } : excerpt
}

export function readWorkbenchSelectedObject(snapshot: ProjectFileSnapshot | undefined, ref: string,
  readM2: (featureId: string) => string | null): string | null {
  if (!snapshot) return null
  const term = snapshot.project.dimensionChain.terms.find(item => item.id === ref)
  if (!term) {
    const feature = desktopGdtEnabled() && snapshot.project.assembly3d?.features.find(item => item.id === ref)
    return feature ? JSON.stringify({ featureId: feature.id, partId: feature.partId, kind: feature.kind }) : readM2(ref)
  }
  const { name, symbol, nominalQ, lowerDeviationQ, upperDeviationQ, sign } = term
  return JSON.stringify({ name, symbol, nominalQ, lowerDeviationQ, upperDeviationQ, sign })
}
