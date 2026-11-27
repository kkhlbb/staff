import { createHash } from 'node:crypto'
import { isProvenanceCompleteness, type EvidenceRef } from '../../document-extraction/types.ts'
import { provenanceRefSchema } from '../../project-file/validation.ts'
import type { ProjectFileSnapshot } from '../../project-file/types.ts'
import type { AssemblyMate, AssemblyModelV1, PersistentFeature } from '../../project-file/assembly3d.ts'

export type CandidatePair = readonly [string, string]
export type TopologyCandidates = {
  coplanar: readonly CandidatePair[]
  coaxial: readonly CandidatePair[]
  clearance?: readonly CandidatePair[]
}
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
type Cylinder = Extract<PersistentFeature, { kind: 'cylindrical-hole-axis' }>
type Edge = Extract<PersistentFeature, { kind: 'edge' }>
type OrientedFeature = Plane | Axis
type Vec3 = readonly [number, number, number]
type PlaneBox = { uMin: number; uMax: number; vMin: number; vMax: number }
type AxialSpan = readonly [number, number]

function dot3(a: Vec3, b: Vec3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function sub3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function scale3(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s]
}

function add3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function norm3(a: Vec3) {
  return Math.hypot(a[0], a[1], a[2])
}

function canonicalAxis(axis: Vec3): Vec3 {
  for (const value of axis) {
    if (Math.abs(value) > 1e-6) return value < 0 ? scale3(axis, -1) : axis
  }
  return axis
}

function frameBasis(axis: Vec3) {
  const n = canonicalAxis(axis)
  const ref: Vec3 = Math.abs(n[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0]
  const rawU = cross3(n, ref)
  const u = scale3(rawU, 1 / norm3(rawU))
  const v = cross3(n, u)
  return { n, u, v }
}

function oriented(feature: PersistentFeature): feature is OrientedFeature {
  return (feature.kind === 'face' && feature.surface === 'plane') ||
    feature.kind === 'cylindrical-hole-axis' || feature.kind === 'cone'
}

function transformPoint(qPoint: readonly number[], matrix: AssemblyModelV1['parts'][number]['nominalTransform']): Vec3 {
  const rows = matrix.slice(0, 3)
  const product = (row: number[], vector: readonly number[]) => row[0] * vector[0] + row[1] * vector[1] + row[2] * vector[2]
  return [
    product(rows[0], qPoint) / 10_000 + rows[0][3],
    product(rows[1], qPoint) / 10_000 + rows[1][3],
    product(rows[2], qPoint) / 10_000 + rows[2][3],
  ]
}

function world(feature: OrientedFeature, matrix: AssemblyModelV1['parts'][number]['nominalTransform']) {
  const sourceAxis = feature.kind === 'face' ? feature.normal : feature.axis
  const originQ = feature.kind === 'cone' ? feature.apexQ : feature.originQ
  const rows = matrix.slice(0, 3)
  const product = (row: number[], vector: readonly number[]) => row[0] * vector[0] + row[1] * vector[1] + row[2] * vector[2]
  const length = Math.hypot(...sourceAxis)
  if (length === 0) throw Error('Invalid topology direction: ' + feature.id)
  const axis: Vec3 = [
    product(rows[0], sourceAxis) / length,
    product(rows[1], sourceAxis) / length,
    product(rows[2], sourceAxis) / length,
  ]
  return {
    feature,
    plane: feature.kind === 'face',
    cylinder: feature.kind === 'cylindrical-hole-axis',
    radius: feature.kind === 'cylindrical-hole-axis' ? feature.radiusQ / 10_000 : undefined,
    point: transformPoint(originQ, matrix),
    axis,
    planeBox: null as PlaneBox | null,
    axialSpan: null as AxialSpan | null,
    isHole: null as boolean | null,
  }
}

type Placed = ReturnType<typeof world>
function compare(a: Placed, b: Placed) {
  const [x, y, z] = a.axis
  const [u, v, w] = b.axis
  const [dx, dy, dz] = sub3(b.point, a.point)
  const axisCross = Math.hypot(y * w - z * v, z * u - x * w, x * v - y * u)
  const axisDot = x * u + y * v + z * w
  const separationMm = a.plane ? Math.abs(x * dx + y * dy + z * dz)
    : Math.hypot(y * dz - z * dy, z * dx - x * dz, x * dy - y * dx)
  return { axisCross, axisDot, separationMm }
}

const axisTolerance = 1e-7
// Persisted feature origins are quantized to q, unlike the live B-Rep report.
const persistedToleranceMm = Math.sqrt(3) / 10_000 + 1e-7
const edgeMatchTolMm = 1e-2
const overlapTolMm = 1e-4
const abutmentTolMm = 1e-3
const radiusMatchTolMm = 1e-3

function maxClearanceMm(pinRadiusMm: number) {
  return Math.min(2.0, Math.max(0.5, 0.35 * pinRadiusMm))
}

function enrichPartGeometry(
  placedList: Placed[],
  edges: readonly { start: Vec3; end: Vec3 }[],
) {
  if (!edges.length) return
  const cylinders = placedList.filter(item => item.cylinder && item.radius !== undefined)
  // 1. Recover axial span for each cylinder from edges lying on its cylindrical surface.
  for (const cyl of cylinders) {
    const { n } = frameBasis(cyl.axis)
    const r = cyl.radius!
    let tMin = Infinity
    let tMax = -Infinity
    for (const edge of edges) {
      const ds = sub3(edge.start, cyl.point)
      const de = sub3(edge.end, cyl.point)
      const rs = norm3(cross3(ds, n))
      const re = norm3(cross3(de, n))
      if (Math.abs(rs - r) <= edgeMatchTolMm && Math.abs(re - r) <= edgeMatchTolMm) {
        const ts = dot3(edge.start, n)
        const te = dot3(edge.end, n)
        if (ts < tMin) tMin = ts
        if (ts > tMax) tMax = ts
        if (te < tMin) tMin = te
        if (te > tMax) tMax = te
      }
    }
    if (tMax - tMin > overlapTolMm) {
      cyl.axialSpan = [tMin, tMax]
    }
  }

  // 2. Classify each cylinder as internal (hole) vs external (shaft/OD) using part geometry in its axial slice.
  for (const cyl of cylinders) {
    if (!cyl.axialSpan || cyl.radius === undefined) continue
    const { n, u, v } = frameBasis(cyl.axis)
    const [tMin, tMax] = cyl.axialSpan
    let uMin = Infinity
    let uMax = -Infinity
    let vMin = Infinity
    let vMax = -Infinity
    const includePoint = (pt: Vec3) => {
      const pu = dot3(pt, u)
      const pv = dot3(pt, v)
      if (pu < uMin) uMin = pu
      if (pu > uMax) uMax = pu
      if (pv < vMin) vMin = pv
      if (pv > vMax) vMax = pv
    }
    for (const edge of edges) {
      const ts = dot3(edge.start, n)
      const te = dot3(edge.end, n)
      const eMin = Math.min(ts, te)
      const eMax = Math.max(ts, te)
      if (Math.min(eMax, tMax) - Math.max(eMin, tMin) > overlapTolMm) {
        includePoint(edge.start)
        includePoint(edge.end)
      }
    }
    for (const other of cylinders) {
      if (!other.axialSpan || other.radius === undefined) continue
      if (norm3(cross3(n, other.axis)) > 1e-5) continue
      const [oMin, oMax] = other.axialSpan
      if (Math.min(oMax, tMax) - Math.max(oMin, tMin) > overlapTolMm) {
        const r = other.radius
        includePoint(add3(other.point, scale3(u, r)))
        includePoint(add3(other.point, scale3(u, -r)))
        includePoint(add3(other.point, scale3(v, r)))
        includePoint(add3(other.point, scale3(v, -r)))
      }
    }
    if (Number.isFinite(uMin)) {
      const cu = dot3(cyl.point, u)
      const cv = dot3(cyl.point, v)
      const r = cyl.radius
      cyl.isHole = uMin < cu - r - overlapTolMm && uMax > cu + r + overlapTolMm &&
        vMin < cv - r - overlapTolMm && vMax > cv + r + overlapTolMm
    }
  }

  // 3. Recover 2D projected bounding box on the contact plane for each planar face.
  for (const item of placedList) {
    if (!item.plane) continue
    const { n, u, v } = frameBasis(item.axis)
    const d = dot3(item.point, n)
    let uMin = Infinity
    let uMax = -Infinity
    let vMin = Infinity
    let vMax = -Infinity
    const includePoint = (pt: Vec3) => {
      const pu = dot3(pt, u)
      const pv = dot3(pt, v)
      if (pu < uMin) uMin = pu
      if (pu > uMax) uMax = pu
      if (pv < vMin) vMin = pv
      if (pv > vMax) vMax = pv
    }
    for (const edge of edges) {
      if (Math.abs(dot3(edge.start, n) - d) <= edgeMatchTolMm) includePoint(edge.start)
      if (Math.abs(dot3(edge.end, n) - d) <= edgeMatchTolMm) includePoint(edge.end)
    }
    for (const cyl of cylinders) {
      if (!cyl.axialSpan || cyl.radius === undefined) continue
      if (norm3(cross3(n, cyl.axis)) > 1e-5) continue
      const [tMin, tMax] = cyl.axialSpan
      if (Math.abs(tMin - d) <= edgeMatchTolMm || Math.abs(tMax - d) <= edgeMatchTolMm) {
        const r = cyl.radius
        includePoint(add3(cyl.point, scale3(u, r)))
        includePoint(add3(cyl.point, scale3(u, -r)))
        includePoint(add3(cyl.point, scale3(v, r)))
        includePoint(add3(cyl.point, scale3(v, -r)))
      }
    }
    if (Number.isFinite(uMin)) {
      item.planeBox = { uMin, uMax, vMin, vMax }
    }
  }
}

function frames(assembly: AssemblyModelV1) {
  const matrices = new Map(assembly.parts.map(part => [part.id, part.nominalTransform]))
  const orientedFeatures = assembly.features.filter(oriented)
  if (orientedFeatures.length > 2500) throw Error('Too many oriented features for mate drafting')
  const placedMap = new Map<string, Placed>()
  const byPart = new Map<string, Placed[]>()
  for (const feature of orientedFeatures) {
    const placed = world(feature, matrices.get(feature.partId)!)
    placedMap.set(feature.id, placed)
    let list = byPart.get(feature.partId)
    if (!list) {
      list = []
      byPart.set(feature.partId, list)
    }
    list.push(placed)
  }
  const edgesByPart = new Map<string, { start: Vec3; end: Vec3 }[]>()
  for (const feature of assembly.features) {
    if (feature.kind !== 'edge') continue
    const matrix = matrices.get(feature.partId)!
    let list = edgesByPart.get(feature.partId)
    if (!list) {
      list = []
      edgesByPart.set(feature.partId, list)
    }
    const edge = feature as Edge
    list.push({ start: transformPoint(edge.startQ, matrix), end: transformPoint(edge.endQ, matrix) })
  }
  for (const [partId, placedList] of byPart) {
    enrichPartGeometry(placedList, edgesByPart.get(partId) ?? [])
  }
  return placedMap
}

function planesOverlap(a: Placed, b: Placed) {
  if (!a.planeBox || !b.planeBox) return true
  const uOverlap = Math.min(a.planeBox.uMax, b.planeBox.uMax) - Math.max(a.planeBox.uMin, b.planeBox.uMin)
  const vOverlap = Math.min(a.planeBox.vMax, b.planeBox.vMax) - Math.max(a.planeBox.vMin, b.planeBox.vMin)
  return uOverlap > overlapTolMm && vOverlap > overlapTolMm
}

function axialOverlapMm(a: Placed, b: Placed) {
  if (!a.axialSpan || !b.axialSpan) return null
  return Math.min(a.axialSpan[1], b.axialSpan[1]) - Math.max(a.axialSpan[0], b.axialSpan[0])
}

function classifyClearance(a: Placed, b: Placed, separationMm: number) {
  if (!a.cylinder || !b.cylinder || a.radius === undefined || b.radius === undefined) return null
  if (a.isHole === null || b.isHole === null || a.isHole === b.isHole) return null
  const hole = a.isHole ? a : b
  const pin = a.isHole ? b : a
  const clearance = hole.radius! - pin.radius!
  if (clearance <= radiusMatchTolMm || clearance > maxClearanceMm(pin.radius!)) return null
  const overlap = axialOverlapMm(hole, pin)
  if (overlap !== null && overlap <= overlapTolMm) return null
  if (separationMm > clearance + persistedToleranceMm) return null
  return { hole, pin, clearance }
}

function isValidCoaxial(a: Placed, b: Placed, separationMm: number) {
  if (separationMm > persistedToleranceMm) return false
  const overlap = axialOverlapMm(a, b)
  if (overlap === null) return true
  if (a.cylinder && b.cylinder && a.radius !== undefined && b.radius !== undefined) {
    if (Math.abs(a.radius - b.radius) > radiusMatchTolMm) return false
    if (a.isHole === false && b.isHole === false) return false
    if (a.isHole !== null && b.isHole !== null && a.isHole !== b.isHole) {
      return overlap > overlapTolMm
    }
    return overlap >= -abutmentTolMm
  }
  return overlap >= -abutmentTolMm
}

function sharesMatedShaft(aId: string, bId: string, holesByShaft: Map<string, Set<string>>) {
  for (const holes of holesByShaft.values()) {
    if (holes.has(aId) && holes.has(bId)) return true
  }
  return false
}

/** Recover candidate pairs from the extracted persistent features saved in Schema 11. */
export function recoverCandidates(assembly: AssemblyModelV1): TopologyCandidates {
  const features = [...frames(assembly).values()]
  const coplanar: CandidatePair[] = []
  const rawCoaxial: [Placed, Placed][] = []
  const clearance: CandidatePair[] = []
  const holesByShaft = new Map<string, Set<string>>()
  const recordShaftHole = (shaftId: string, holeId: string) => {
    let set = holesByShaft.get(shaftId)
    if (!set) {
      set = new Set()
      holesByShaft.set(shaftId, set)
    }
    set.add(holeId)
  }

  for (let i = 0; i < features.length; i++) {
    const a = features[i]
    for (let j = i + 1; j < features.length; j++) {
      const b = features[j]
      if (a.feature.partId === b.feature.partId || a.plane !== b.plane) continue
      const { axisCross, axisDot, separationMm } = compare(a, b)
      if (axisCross > axisTolerance) continue
      if (a.plane) {
        if (axisDot < 0 && separationMm <= persistedToleranceMm && planesOverlap(a, b)) {
          if (coplanar.length >= 1000) throw Error('Too many topology candidates; supply a selected subset')
          coplanar.push([a.feature.id, b.feature.id])
        }
        continue
      }
      const clearanceMatch = classifyClearance(a, b, separationMm)
      if (clearanceMatch) {
        if (clearance.length >= 1000) throw Error('Too many topology candidates; supply a selected subset')
        clearance.push([clearanceMatch.hole.feature.id, clearanceMatch.pin.feature.id])
        recordShaftHole(clearanceMatch.pin.feature.id, clearanceMatch.hole.feature.id)
        continue
      }
      if (isValidCoaxial(a, b, separationMm)) {
        if (rawCoaxial.length >= 1000) throw Error('Too many topology candidates; supply a selected subset')
        rawCoaxial.push([a, b])
        if (a.isHole === true && b.isHole === false) recordShaftHole(b.feature.id, a.feature.id)
        else if (b.isHole === true && a.isHole === false) recordShaftHole(a.feature.id, b.feature.id)
      }
    }
  }

  const coaxial: CandidatePair[] = []
  for (const [a, b] of rawCoaxial) {
    if (a.isHole === true && b.isHole === true && sharesMatedShaft(a.feature.id, b.feature.id, holesByShaft)) continue
    coaxial.push([a.feature.id, b.feature.id])
  }
  return { coplanar, coaxial, clearance }
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
  const holesByShaft = new Map<string, Set<string>>()
  const recordShaftHole = (shaftId: string, holeId: string) => {
    let set = holesByShaft.get(shaftId)
    if (!set) {
      set = new Set()
      holesByShaft.set(shaftId, set)
    }
    set.add(holeId)
  }

  const makeRefs = (featureIds: readonly [string, string]) => {
    const evidenceRefs = featureIds.flatMap(id => Object.hasOwn(evidenceByFeature, id) ? evidenceByFeature[id] : [])
      .flatMap((ref): EvidenceRef[] => {
        const parsed = provenanceRefSchema.safeParse(ref)
        return parsed.success && isProvenanceCompleteness(parsed.data) ? [parsed.data] : []
      })
    const topologyEvidenceRefs = featureIds.map(featureId => {
      const { partId, signature } = features.get(featureId)!.feature
      const part = parts.get(partId)!
      return {
        kind: 'topology-feature' as const, partId, featureId, signature,
        ...(part.kind === 'imported-step' && {
          attachmentId: part.attachmentId,
          attachmentSha256: stepHashes.get(part.attachmentId) ?? null, solidIndex: part.solidIndex,
        }),
      }
    })
    return { evidenceRefs, topologyEvidenceRefs }
  }

  // First pass: validate clearance and shaft-hole coaxial pairs so transitive hole-hole suppression is consistent.
  const validatedClearance: { hole: Placed; pin: Placed; geometry: ReturnType<typeof compare> }[] = []
  for (const ids of candidates.clearance ?? []) {
    const [a, b] = ids.map(id => features.get(id))
    if (!a || !b || a.feature.partId === b.feature.partId || a.plane || b.plane) {
      throw Error('Candidate contains incompatible feature references')
    }
    const geometry = compare(a, b)
    if (geometry.axisCross > axisTolerance) continue
    const match = classifyClearance(a, b, geometry.separationMm)
    if (!match) continue
    validatedClearance.push({ hole: match.hole, pin: match.pin, geometry })
    recordShaftHole(match.pin.feature.id, match.hole.feature.id)
  }

  const validatedCoaxial: { a: Placed; b: Placed; ids: CandidatePair; geometry: ReturnType<typeof compare> }[] = []
  for (const ids of candidates.coaxial) {
    const [a, b] = ids.map(id => features.get(id))
    if (!a || !b || a.feature.partId === b.feature.partId || a.plane || b.plane) {
      throw Error('Candidate contains incompatible feature references')
    }
    const geometry = compare(a, b)
    if (geometry.axisCross > axisTolerance) continue
    if (isValidCoaxial(a, b, geometry.separationMm)) {
      validatedCoaxial.push({ a, b, ids, geometry })
      if (a.isHole === true && b.isHole === false) recordShaftHole(b.feature.id, a.feature.id)
      else if (b.isHole === true && a.isHole === false) recordShaftHole(a.feature.id, b.feature.id)
    } else {
      const match = classifyClearance(a, b, geometry.separationMm)
      if (match) {
        validatedClearance.push({ hole: match.hole, pin: match.pin, geometry })
        recordShaftHole(match.pin.feature.id, match.hole.feature.id)
      }
    }
  }

  for (const ids of candidates.coplanar) {
    const [a, b] = ids.map(id => features.get(id))
    if (!a || !b || a.feature.partId === b.feature.partId || !a.plane || !b.plane) {
      throw Error('Candidate contains incompatible feature references')
    }
    const geometry = compare(a, b)
    if (geometry.axisCross > axisTolerance || geometry.separationMm > persistedToleranceMm ||
        geometry.axisDot >= 0 || !planesOverlap(a, b)) continue
    const featureIds = [...ids].sort() as [string, string]
    const kind = 'face-contact' as const
    const key = JSON.stringify([kind, ...featureIds])
    if (seen.has(key) || assembly.mates.some(mate => mate.kind === kind && featureIds.every(id => mate.featureIds.includes(id)))) continue
    seen.add(key)
    const id = 'mate-draft:' + createHash('sha256').update(key).digest('hex').slice(0, 24)
    const mate: AssemblyMate = { id, kind, featureIds, constrainedDofs: ['tz', 'rx', 'ry'] }
    const { evidenceRefs, topologyEvidenceRefs } = makeRefs(featureIds)
    drafts.push({
      mate, status: 'draft' as const, confidence: 0.8,
      basis: {
        source: 'coplanar' as const, explanation: 'Opposed coplanar surface locations',
        featureIds, partIds: featureIds.map(fid => features.get(fid)!.feature.partId),
        featureSignatures: featureIds.map(fid => features.get(fid)!.feature.signature), ...geometry,
      },
      topologyEvidenceRefs,
      evidenceRefs,
    })
  }

  for (const { a, b, ids, geometry } of validatedCoaxial) {
    if (a.isHole === true && b.isHole === true && sharesMatedShaft(a.feature.id, b.feature.id, holesByShaft)) continue
    const featureIds = [...ids].sort() as [string, string]
    const kind = 'coaxial' as const
    const key = JSON.stringify([kind, ...featureIds])
    if (seen.has(key) || assembly.mates.some(mate => mate.kind === kind && featureIds.every(id => mate.featureIds.includes(id)))) continue
    seen.add(key)
    const id = 'mate-draft:' + createHash('sha256').update(key).digest('hex').slice(0, 24)
    const mate: AssemblyMate = { id, kind, featureIds, constrainedDofs: ['tx', 'ty', 'rx', 'ry'] }
    const { evidenceRefs, topologyEvidenceRefs } = makeRefs(featureIds)
    drafts.push({
      mate, status: 'draft' as const, confidence: 0.9,
      basis: {
        source: 'coaxial' as const, explanation: 'Aligned axis locations and directions',
        featureIds, partIds: featureIds.map(fid => features.get(fid)!.feature.partId),
        featureSignatures: featureIds.map(fid => features.get(fid)!.feature.signature), ...geometry,
      },
      topologyEvidenceRefs,
      evidenceRefs,
    })
  }

  for (const { hole, pin, geometry } of validatedClearance) {
    const featureIds: [string, string] = [hole.feature.id, pin.feature.id]
    const kind = 'floating-clearance' as const
    const key = JSON.stringify([kind, ...featureIds])
    if (seen.has(key) || assembly.mates.some(mate => mate.kind === kind && featureIds.every(id => mate.featureIds.includes(id)))) continue
    seen.add(key)
    const id = 'mate-draft:' + createHash('sha256').update(key).digest('hex').slice(0, 24)
    const holeFeature = hole.feature as Cylinder
    const pinFeature = pin.feature as Cylinder
    const maxQ = holeFeature.radiusQ - pinFeature.radiusQ
    const mate: AssemblyMate = { id, kind, featureIds, constrainedDofs: ['rx', 'ry'], minQ: 0, maxQ }
    const { evidenceRefs, topologyEvidenceRefs } = makeRefs(featureIds)
    drafts.push({
      mate, status: 'draft' as const, confidence: 0.85,
      basis: {
        source: 'clearance' as const, explanation: 'Coaxial hole-shaft pair with radial clearance',
        featureIds, partIds: featureIds.map(fid => features.get(fid)!.feature.partId),
        featureSignatures: featureIds.map(fid => features.get(fid)!.feature.signature), ...geometry,
      },
      topologyEvidenceRefs,
      evidenceRefs,
    })
  }

  return { drafts, requiresConfirmation: true as const }
}
