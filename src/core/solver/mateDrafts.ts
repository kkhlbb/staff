import { createHash } from 'node:crypto'
import { isProvenanceCompleteness, type EvidenceRef } from '../../document-extraction/types.ts'
import { provenanceRefSchema } from '../../project-file/validation.ts'
import type { ProjectFileSnapshot } from '../../project-file/types.ts'
import type { AssemblyMate, AssemblyModelV1, PersistentFeature } from '../../project-file/assembly3d.ts'

export type CandidatePair = readonly [string, string]
export type TopologyCandidates = { coplanar: readonly CandidatePair[]; coaxial: readonly CandidatePair[] }
type StepHashes = ReadonlyMap<string, string>
export function stepAttachmentHashes(snapshot: ProjectFileSnapshot): StepHashes {
  const hashes = new Map(snapshot.blobs.map(blob => [blob.blobKey, blob.sha256]))
  return new Map((snapshot.project.stepAttachments ?? []).flatMap(({ id, blobKey }) => {
    const hash = hashes.get(blobKey)
    return hash ? [[id, hash]] : []
  }))
}

type EvidenceByFeature = Readonly<Record<string, readonly unknown[]>>
type Plane = Extract<PersistentFeature, { kind: 'face' }>
type Axis = Extract<PersistentFeature, { kind: 'cylindrical-hole-axis' | 'cone' }>
type OrientedFeature = Plane | Axis

function oriented(feature: PersistentFeature): feature is OrientedFeature {
  return (feature.kind === 'face' && feature.surface === 'plane') ||
    feature.kind === 'cylindrical-hole-axis' || feature.kind === 'cone'
}

function world(feature: OrientedFeature, matrix: AssemblyModelV1['parts'][number]['nominalTransform']) {
  const sourceAxis = feature.kind === 'face' ? feature.normal : feature.axis
  const originQ = feature.kind === 'cone' ? feature.apexQ : feature.originQ
  const rows = matrix.slice(0, 3)
  const product = (row: number[], vector: number[]) => row[0] * vector[0] + row[1] * vector[1] + row[2] * vector[2]
  const length = Math.hypot(...sourceAxis)
  if (length === 0) throw Error('Invalid topology direction: ' + feature.id)
  return {
    feature, plane: feature.kind === 'face',
    point: rows.map(row => product(row, originQ) / 10_000 + row[3]),
    axis: rows.map(row => product(row, sourceAxis) / length),
  }
}

type Placed = ReturnType<typeof world>
function compare(a: Placed, b: Placed) {
  const [x, y, z] = a.axis
  const [u, v, w] = b.axis
  const [dx, dy, dz] = b.point.map((value, i) => value - a.point[i])
  const axisCross = Math.hypot(y * w - z * v, z * u - x * w, x * v - y * u)
  const axisDot = x * u + y * v + z * w
  const separationMm = a.plane ? Math.abs(x * dx + y * dy + z * dz)
    : Math.hypot(y * dz - z * dy, z * dx - x * dz, x * dy - y * dx)
  return { axisCross, axisDot, separationMm }
}

const axisTolerance = 1e-7
// Persisted feature origins are quantized to q, unlike the live B-Rep report.
const persistedToleranceMm = Math.sqrt(3) / 10_000 + 1e-7

function frames(assembly: AssemblyModelV1) {
  const matrices = new Map(assembly.parts.map(part => [part.id, part.nominalTransform]))
  const features = assembly.features.filter(oriented)
  if (features.length > 2500) throw Error('Too many oriented features for mate drafting')
  return new Map(features.map(feature => [feature.id, world(feature, matrices.get(feature.partId)!)]))
}

/** Recover candidate pairs from the extracted persistent features saved in Schema 11. */
export function recoverCandidates(assembly: AssemblyModelV1): TopologyCandidates {
  const features = [...frames(assembly).values()]
  const coplanar: CandidatePair[] = []
  const coaxial: CandidatePair[] = []
  for (let i = 0; i < features.length; i++) {
    const a = features[i]
    for (let j = i + 1; j < features.length; j++) {
      const b = features[j]
      if (a.feature.partId === b.feature.partId || a.plane !== b.plane) continue
      const { axisCross, separationMm } = compare(a, b)
      if (axisCross <= axisTolerance && separationMm <= persistedToleranceMm) {
        const candidates = a.plane ? coplanar : coaxial
        if (candidates.length >= 1000) throw Error('Too many topology candidates; supply a selected subset')
        candidates.push([a.feature.id, b.feature.id])
      }
    }
  }
  return { coplanar, coaxial }
}

/** Turn topology evidence into reviewable alternatives without modifying assembly.mates. */
export function suggestMateDrafts(
  assembly: AssemblyModelV1, candidates: TopologyCandidates, evidenceByFeature: EvidenceByFeature = {},
  stepHashes: StepHashes = new Map(),
) {
  const features = frames(assembly)
  const parts = new Map(assembly.parts.map(part => [part.id, part]))
  const seen = new Set<string>()
  const drafts = []
  for (const source of ['coplanar', 'coaxial'] as const) {
    for (const ids of candidates[source]) {
      const [a, b] = ids.map(id => features.get(id))
      if (!a || !b || a.feature.partId === b.feature.partId || a.plane !== b.plane || a.plane !== (source === 'coplanar')) {
        throw Error('Candidate contains incompatible feature references')
      }
      const geometry = compare(a, b)
      if (geometry.axisCross > axisTolerance || geometry.separationMm > persistedToleranceMm ||
          (a.plane && geometry.axisDot > 0)) continue
      const featureIds = [...ids].sort() as [string, string]
      const kind = a.plane ? 'face-contact' : 'coaxial'
      const key = JSON.stringify([kind, ...featureIds])
      if (seen.has(key) || assembly.mates.some(mate => mate.kind === kind && featureIds.every(id => mate.featureIds.includes(id)))) continue
      seen.add(key)
      const id = 'mate-draft:' + createHash('sha256').update(key).digest('hex').slice(0, 24)
      const mate: AssemblyMate = { id, kind, featureIds, constrainedDofs: a.plane ? ['tz', 'rx', 'ry'] : ['tx', 'ty', 'rx', 'ry'] }
      const evidenceRefs = featureIds.flatMap(id => Object.hasOwn(evidenceByFeature, id) ? evidenceByFeature[id] : [])
        .flatMap((ref): EvidenceRef[] => {
          const parsed = provenanceRefSchema.safeParse(ref)
          return parsed.success && isProvenanceCompleteness(parsed.data) ? [parsed.data] : []
        })
      drafts.push({
        mate, status: 'draft' as const, confidence: a.plane ? 0.8 : 0.9,
        basis: { source, explanation: a.plane ? 'Opposed coplanar surface locations' : 'Aligned axis locations and directions',
          featureIds, partIds: featureIds.map(id => features.get(id)!.feature.partId),
          featureSignatures: featureIds.map(id => features.get(id)!.feature.signature), ...geometry },
        topologyEvidenceRefs: featureIds.map(featureId => {
          const { partId, signature } = features.get(featureId)!.feature
          const part = parts.get(partId)!
          return { kind: 'topology-feature' as const, partId, featureId, signature,
            ...(part.kind === 'imported-step' && { attachmentId: part.attachmentId,
              attachmentSha256: stepHashes.get(part.attachmentId) ?? null, solidIndex: part.solidIndex }) }
        }),
        evidenceRefs,
      })
    }
  }
  return { drafts, requiresConfirmation: true as const }
}
