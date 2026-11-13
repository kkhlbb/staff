/** Presentation only: never changes persisted identities or IPC payloads. */
export function uiVersionLabel(sequence?: number | null): string {
  return sequence != null && Number.isInteger(sequence) && sequence > 0
    ? `第 ${sequence} 版`
    : '未命名版本'
}

export function uiSourceVersionLabel(
  revisions: readonly { id: string; documentId: string; createdAt: string }[],
  id: string | null | undefined,
): string {
  const revision = revisions.find(item => item.id === id)
  if (!revision) return uiVersionLabel()
  const ordered = revisions.filter(item => item.documentId === revision.documentId)
    .slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  return uiVersionLabel(ordered.findIndex(item => item.id === id) + 1)
}

/** Formal ordinal follows the append-only file history, like drawing drafts. */
export function uiFileVersionLabel(revisions: readonly { revisionId: string }[], id: string | null | undefined): string {
  const index = revisions.findIndex(revision => revision.revisionId === id)
  return uiVersionLabel(index < 0 ? undefined : index + 1)
}

/** Legacy diagnostic strings may include identities; replace whole tokens, never prefixes. */
export function uiDiagnosticText(text: string): string {
  return text
    .replace(/\b(?:reqrev|sr|project|task|candidate|cand|instance|draft|intent|turn|batch|snapshot|binding|annotation|doc)-[a-z0-9-]+\b/gi, '内部记录')
    .replace(/\b(?:[a-z][a-z0-9]*-)+[0-9a-f]{16,}\b/gi, '内部记录')
    .replace(/\b[0-9a-f]{8,31}…/gi, '未命名版本')
    .replace(/\brev-[a-z0-9]-[a-z0-9-]+\b/gi, '未命名版本')
    .replace(/\b(?:[a-z][a-z0-9]*-)*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '内部记录')
    .replace(/[0-9a-f]{32,}/gi, '内部记录')
}
