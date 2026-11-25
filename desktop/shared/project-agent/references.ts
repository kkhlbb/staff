import type { ObjectRef } from './contracts.ts'

export function resolveObjectRef(
  previous: ObjectRef, revision: string, objectMapVersion: string, current: readonly ObjectRef[],
): { status: 'resolved'; object: ObjectRef } | { status: 'stale' | 'ambiguous' } {
  const matches = current.filter((entry) =>
    entry.revision === revision && entry.objectMapVersion === objectMapVersion &&
    entry.partId === previous.partId && entry.featureId === previous.featureId && entry.role === previous.role)
  if (matches.length === 1) return { status: 'resolved', object: matches[0] }
  return { status: matches.length === 0 ? 'stale' : 'ambiguous' }
}
