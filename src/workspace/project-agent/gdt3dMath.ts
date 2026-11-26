import { Vector3 } from 'three'
import { resolveGdtMaterialConditions } from '../../project-file/assembly3d'
import {
  computeAssemblyCentroid,
  computeLocalSimulationDiagnostics,
  computePartExplodedMatrix4,
} from './assembly3dMath'
import type {
  AiGdtDraftItem,
  DatumDefinition,
  GdtContributionItem,
  GdtDisplayMode,
  GdtFeatureControl,
  GdtMaterialModifier,
  GdtValidationWarning,
  PartMesh,
  PickedFeatureGeometryKind,
  SimulationDiagnosticResult,
  SimulationLoopSpec,
} from './assembly3dTypes'

export interface GdtKindMeta {
  readonly kind: GdtFeatureControl['kind']
  readonly symbol: string
  readonly label: string
  readonly requiresDatum: boolean
  readonly defaultZoneShape: NonNullable<GdtFeatureControl['zoneShape']>
}

export const GDT_KIND_META: Readonly<Record<GdtFeatureControl['kind'], GdtKindMeta>> = {
  position: {
    kind: 'position',
    symbol: '⌖',
    label: '位置度',
    requiresDatum: true,
    defaultZoneShape: 'cylindrical',
  },
  perpendicularity: {
    kind: 'perpendicularity',
    symbol: '⊥',
    label: '垂直度',
    requiresDatum: true,
    defaultZoneShape: 'planar',
  },
  parallelism: {
    kind: 'parallelism',
    symbol: '∥',
    label: '平行度',
    requiresDatum: true,
    defaultZoneShape: 'planar',
  },
  flatness: {
    kind: 'flatness',
    symbol: '⏥',
    label: '平面度',
    requiresDatum: false,
    defaultZoneShape: 'planar',
  },
  coaxiality: {
    kind: 'coaxiality',
    symbol: '◎',
    label: '同轴度',
    requiresDatum: true,
    defaultZoneShape: 'cylindrical',
  },
  'profile-surface': {
    kind: 'profile-surface',
    symbol: '⌒',
    label: '面轮廓度',
    requiresDatum: false,
    defaultZoneShape: 'planar',
  },
  'circular-runout': {
    kind: 'circular-runout',
    symbol: '↗',
    label: '圆跳动',
    requiresDatum: true,
    defaultZoneShape: 'cylindrical',
  },
  'total-runout': {
    kind: 'total-runout',
    symbol: '↗↗',
    label: '全跳动',
    requiresDatum: true,
    defaultZoneShape: 'cylindrical',
  },
  'cylindricity': {
    kind: 'cylindricity',
    symbol: '⌭',
    label: '圆柱度',
    requiresDatum: false,
    defaultZoneShape: 'cylindrical',
  },
  'composite-position': {
    kind: 'composite-position',
    symbol: '⌖',
    label: '复合位置度',
    requiresDatum: true,
    defaultZoneShape: 'cylindrical',
  },
}

export const GDT_KIND_ORDER: readonly GdtFeatureControl['kind'][] = [
  'position',
  'perpendicularity',
  'parallelism',
  'flatness',
  'coaxiality',
]

export const GDT_MODIFIER_SYMBOL: Readonly<Record<GdtMaterialModifier, string>> = {
  RFS: '',
  MMC: 'Ⓜ',
  LMC: 'Ⓛ',
}

export const GDT_MODIFIER_LABELS: Readonly<Record<GdtMaterialModifier, string>> = {
  RFS: 'RFS',
  MMC: 'MMC Ⓜ',
  LMC: 'LMC Ⓛ',
}

export const DATUM_LETTER_OPTIONS = ['A', 'B', 'C'] as const
export type DatumLetter = (typeof DATUM_LETTER_OPTIONS)[number]

/** Converts quantized toleranceQ (1e-4 mm) to human-readable mm string. */
export function formatGdtToleranceMm(toleranceQ: number): string {
  const mm = Math.max(0, toleranceQ) / 10000
  const thousandths = Math.round(mm * 1000)
  return thousandths % 10 !== 0 ? mm.toFixed(3) : mm.toFixed(2)
}

/** Converts mm value to quantized toleranceQ (1e-4 mm integer). */
export function mmToToleranceQ(mm: number): number {
  if (!Number.isFinite(mm) || mm < 0) return 0
  return Math.round(mm * 10000)
}

/** Determines whether an FCF tolerance zone displays the cylindrical diameter prefix `Ø`. */
export function isCylindricalGdtZone(
  control: GdtFeatureControl,
  featureKind?: PickedFeatureGeometryKind,
): boolean {
  if (control.zoneShape === 'cylindrical') return true
  if (control.zoneShape === 'planar' || control.zoneShape === 'bidirectional') return false
  if (control.kind === 'coaxiality') return true
  if (control.kind === 'position' && featureKind === 'cylindrical-hole-axis') return true
  return false
}

export interface FormattedFcfDatumCell {
  readonly datumId: string
  readonly label: string
  readonly modifier: GdtMaterialModifier
  readonly modifierSymbol: string
}

export interface FormattedFcfCells {
  readonly symbol: string
  readonly kindLabel: string
  readonly diameterPrefix: string
  readonly toleranceText: string
  readonly modifier: GdtMaterialModifier
  readonly modifierSymbol: string
  readonly datumCells: readonly FormattedFcfDatumCell[]
  readonly summaryText: string
}

/** Formats an ISO/ASME Feature Control Frame into structured renderable cells. */
export function formatFcfCells(
  control: GdtFeatureControl,
  datums: readonly DatumDefinition[],
  featureKind?: PickedFeatureGeometryKind,
): FormattedFcfCells {
  const meta = GDT_KIND_META[control.kind]
  const datumById = new Map(datums.map((d) => [d.id, d]))
  const diameterPrefix = isCylindricalGdtZone(control, featureKind) ? 'Ø' : ''
  const toleranceText = formatGdtToleranceMm(control.toleranceQ)
  const modifier: GdtMaterialModifier = control.modifier ?? 'RFS'
  const modifierSymbol = GDT_MODIFIER_SYMBOL[modifier]

  const datumCells: FormattedFcfDatumCell[] = control.datumIds.map((datumId, index) => {
    const found = datumById.get(datumId)
    const datumMod: GdtMaterialModifier = control.datumModifiers?.[index] ?? 'RFS'
    return {
      datumId,
      label: found?.label ?? datumId.replace(/^datum-/i, '').toUpperCase(),
      modifier: datumMod,
      modifierSymbol: GDT_MODIFIER_SYMBOL[datumMod],
    }
  })

  const datumPart =
    datumCells.length > 0
      ? ` | ${datumCells.map((c) => `${c.label}${c.modifierSymbol}`).join(' | ')}`
      : ''
  const summaryText = `[ ${meta.symbol} | ${diameterPrefix}${toleranceText}${modifierSymbol}${datumPart} ]`

  return {
    symbol: meta.symbol,
    kindLabel: meta.label,
    diameterPrefix,
    toleranceText,
    modifier,
    modifierSymbol,
    datumCells,
    summaryText,
  }
}

export interface GdtDraftValidationResult {
  readonly valid: boolean
  readonly errors: readonly string[]
  readonly warnings: readonly GdtValidationWarning[]
}

/**
 * Validates a GD&T Feature Control Frame draft in real time against ASME Y14.5 / ISO 1101
 * and Schema 11 rules, returning blocking errors and structured `GdtValidationWarning` items.
 */
export function validateGdtControlDraft(
  control: GdtFeatureControl,
  context: {
    readonly featureKindById: ReadonlyMap<string, PickedFeatureGeometryKind>
    readonly datums: readonly DatumDefinition[]
  },
): GdtDraftValidationResult {
  const errors: string[] = []
  const warnings: GdtValidationWarning[] = []
  const featureKind = context.featureKindById.get(control.featureId)
  const datumById = new Map(context.datums.map((d) => [d.id, d]))

  if (!Number.isFinite(control.toleranceQ) || control.toleranceQ <= 0) {
    errors.push('公差值必须大于 0 mm。')
  }

  if (control.kind === 'flatness') {
    if (control.datumIds.length > 0) {
      const msg = '平面度（⏥）属于形状公差，不可引用基准。'
      errors.push(msg)
      warnings.push({
        code: 'DRF_REDUNDANT',
        gdtId: control.id,
        datumId: control.datumIds[0],
        message: msg,
      })
    }
  } else if (control.datumIds.length === 0) {
    const msg = `${GDT_KIND_META[control.kind].label}（${GDT_KIND_META[control.kind].symbol}）至少需要引用 1 个基准。`
    errors.push(msg)
    warnings.push({
      code: 'DRF_UNDERCONSTRAINED',
      gdtId: control.id,
      message: msg,
    })
  }

  if (new Set(control.datumIds).size !== control.datumIds.length) {
    const msg = '基准引用中存在重复基准，请移除重复项。'
    errors.push(msg)
    warnings.push({
      code: 'DRF_REDUNDANT',
      gdtId: control.id,
      message: msg,
    })
  }

  if (control.kind === 'coaxiality' && featureKind && featureKind !== 'cylindrical-hole-axis') {
    const msg = '同轴度（◎）仅适用于圆柱孔/轴特征。'
    errors.push(msg)
    warnings.push({
      code: 'DRF_DEGENERATE',
      gdtId: control.id,
      message: msg,
    })
  }

  const mod = control.modifier ?? 'RFS'
  if ((mod === 'MMC' || mod === 'LMC') && featureKind && featureKind !== 'cylindrical-hole-axis') {
    const msg = `非尺寸要素（平面）不可使用 ${mod} 实体修正符，请改用 RFS。`
    errors.push(msg)
    warnings.push({
      code: 'ILLEGAL_MODIFIER',
      gdtId: control.id,
      message: msg,
    })
  }

  if (control.datumModifiers) {
    if (control.datumModifiers.length > control.datumIds.length) {
      const msg = '基准修正符数量不可超过已选基准数量。'
      errors.push(msg)
      warnings.push({
        code: 'ILLEGAL_MODIFIER',
        gdtId: control.id,
        message: msg,
      })
    }
    control.datumIds.forEach((datumId, idx) => {
      const datumMod = control.datumModifiers?.[idx] ?? 'RFS'
      if (datumMod === 'MMC' || datumMod === 'LMC') {
        const datum = datumById.get(datumId)
        const datumKind = datum ? context.featureKindById.get(datum.featureId) : undefined
        if (datumKind && datumKind !== 'cylindrical-hole-axis') {
          const msg = `基准 ${datum?.label ?? datumId} 为非尺寸要素平面，不可附加 ${datumMod} 修饰符。`
          errors.push(msg)
          warnings.push({
            code: 'ILLEGAL_MODIFIER',
            gdtId: control.id,
            datumId,
            message: msg,
          })
        }
      }
    })
  }

  if (
    control.featureSizeToleranceQ &&
    control.featureSizeToleranceQ.lowerQ > control.featureSizeToleranceQ.upperQ
  ) {
    errors.push('被测特征尺寸下偏差不可大于上偏差。')
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * Computes a feature's 3D world-space anchor position (following nominalTransform & explosionFactor).
 * Returns null if the feature is not found in visible parts.
 */
export function computeFeatureWorldAnchor(
  partMeshes: readonly PartMesh[],
  featureId: string,
  explosionFactor: number,
  hiddenPartIds?: ReadonlySet<string>,
  anchorOffsetMm?: readonly [number, number, number],
): { readonly position: readonly [number, number, number]; readonly partId: string } | null {
  if (partMeshes.length === 0) return null
  const centroid = computeAssemblyCentroid(partMeshes)
  const v = new Vector3()

  for (const part of partMeshes) {
    if (hiddenPartIds?.has(part.partId)) continue
    const matrix = computePartExplodedMatrix4(part, centroid, explosionFactor)

    // 1. Edge / cylindrical hole axis segment midpoint
    const seg = part.edgeSegments?.find((s) => s.featureId === featureId)
    if (seg && seg.points.length >= 6) {
      const mx = (seg.points[0] + seg.points[3]) / 2
      const my = (seg.points[1] + seg.points[4]) / 2
      const mz = (seg.points[2] + seg.points[5]) / 2
      v.set(mx, my, mz).applyMatrix4(matrix)
      return {
        partId: part.partId,
        position: [
          v.x + (anchorOffsetMm?.[0] ?? 0),
          v.y + (anchorOffsetMm?.[1] ?? 0),
          v.z + (anchorOffsetMm?.[2] ?? 0),
        ],
      }
    }

    // 2. Face triangle range centroid
    const range = part.faceTriangleRanges.find((r) => r.objectId === featureId)
    if (range) {
      const totalTris = Math.floor(part.indices.length / 3)
      const start = Math.max(0, range.startTriangle)
      const end = Math.min(totalTris, range.endTriangle)
      let sx = 0
      let sy = 0
      let sz = 0
      let count = 0
      for (let t = start; t < end; t += 1) {
        for (let k = 0; k < 3; k += 1) {
          const idx = part.indices[t * 3 + k]
          sx += part.positions[idx * 3] ?? 0
          sy += part.positions[idx * 3 + 1] ?? 0
          sz += part.positions[idx * 3 + 2] ?? 0
          count += 1
        }
      }
      if (count > 0) {
        v.set(sx / count, sy / count, sz / count).applyMatrix4(matrix)
      } else {
        v.set(
          (part.bounds.min[0] + part.bounds.max[0]) / 2,
          (part.bounds.min[1] + part.bounds.max[1]) / 2,
          (part.bounds.min[2] + part.bounds.max[2]) / 2,
        ).applyMatrix4(matrix)
      }
      return {
        partId: part.partId,
        position: [
          v.x + (anchorOffsetMm?.[0] ?? 0),
          v.y + (anchorOffsetMm?.[1] ?? 0),
          v.z + (anchorOffsetMm?.[2] ?? 0),
        ],
      }
    }
  }

  return null
}

export interface ScreenAnnotationBoxInput {
  readonly id: string
  readonly anchorX: number
  readonly anchorY: number
  readonly width: number
  readonly height: number
}

export interface ResolvedAnnotationOffset {
  readonly id: string
  readonly offsetX: number
  readonly offsetY: number
  readonly labelX: number
  readonly labelY: number
}

/**
 * Pure deterministic screen-space anti-overlap layout algorithm for "全部展开" mode.
 * Computes non-overlapping label positions around each anchor while keeping leaders short.
 */
export function computeAntiOverlapOffsets(
  items: readonly ScreenAnnotationBoxInput[],
  paddingPx = 6,
): ReadonlyMap<string, ResolvedAnnotationOffset> {
  const sorted = [...items].sort((a, b) => {
    if (Math.abs(a.anchorY - b.anchorY) > 1e-3) return a.anchorY - b.anchorY
    if (Math.abs(a.anchorX - b.anchorX) > 1e-3) return a.anchorX - b.anchorX
    return a.id.localeCompare(b.id)
  })

  const placed: Array<{
    readonly id: string
    readonly anchorX: number
    readonly anchorY: number
    readonly width: number
    readonly height: number
    labelX: number
    labelY: number
  }> = sorted.map((item, idx) => ({
    ...item,
    // Small initial radial offset away from exact anchor dot so leader line is visible
    labelX: item.anchorX + (idx % 2 === 0 ? 18 : -18),
    labelY: item.anchorY - 22,
  }))

  const boxesOverlap = (
    a: { labelX: number; labelY: number; width: number; height: number },
    b: { labelX: number; labelY: number; width: number; height: number },
  ): boolean => {
    const dx = Math.abs(a.labelX - b.labelX)
    const dy = Math.abs(a.labelY - b.labelY)
    return dx < (a.width + b.width) / 2 + paddingPx && dy < (a.height + b.height) / 2 + paddingPx
  }

  const maxPasses = 32
  for (let pass = 0; pass < maxPasses; pass += 1) {
    let moved = false
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i]
        const b = placed[j]
        if (!boxesOverlap(a, b)) continue

        const minSepY = (a.height + b.height) / 2 + paddingPx
        const overlapY = minSepY - Math.abs(b.labelY - a.labelY)
        const pushY = Math.max(overlapY * 0.55, 6)
        if (b.labelY >= a.labelY) {
          a.labelY -= pushY * 0.45
          b.labelY += pushY * 0.55
        } else {
          a.labelY += pushY * 0.55
          b.labelY -= pushY * 0.45
        }

        // Gentle horizontal stagger to reduce tall stacks
        const staggerX = (j % 2 === 0 ? 1 : -1) * 6
        b.labelX += staggerX
        moved = true
      }
    }
    if (!moved) break
  }

  const result = new Map<string, ResolvedAnnotationOffset>()
  for (const item of placed) {
    result.set(item.id, {
      id: item.id,
      offsetX: Math.round((item.labelX - item.anchorX) * 10) / 10,
      offsetY: Math.round((item.labelY - item.anchorY) * 10) / 10,
      labelX: Math.round(item.labelX * 10) / 10,
      labelY: Math.round(item.labelY * 10) / 10,
    })
  }
  return result
}

export interface GdtAnnotationCollapseContext {
  readonly displayMode: GdtDisplayMode
  readonly focusedPartIds: ReadonlySet<string>
  readonly focusedFeatureIds: ReadonlySet<string>
  readonly focusedLoopFeatureIds: ReadonlySet<string>
  readonly goldenPulseFeatureIds: ReadonlySet<string>
  readonly goldenPulseGdtIds: ReadonlySet<string>
  readonly hoveredAnnotationId: string | null
  readonly editingGdtId: string | null
}

/** Determines whether an FCF annotation should be collapsed into a 22px dot badge. */
export function shouldCollapseGdtAnnotation(
  item: {
    readonly id: string
    readonly featureId: string
    readonly partId?: string
    readonly isPreview?: boolean
  },
  ctx: GdtAnnotationCollapseContext,
): boolean {
  if (ctx.displayMode === 'expand-all') return false
  if (item.isPreview) return false
  if (ctx.hoveredAnnotationId === item.id) return false
  if (ctx.editingGdtId === item.id) return false
  if (ctx.goldenPulseGdtIds.has(item.id)) return false
  if (ctx.goldenPulseFeatureIds.has(item.featureId)) return false
  if (ctx.focusedFeatureIds.has(item.featureId)) return false
  if (ctx.focusedLoopFeatureIds.has(item.featureId)) return false
  if (item.partId && ctx.focusedPartIds.has(item.partId)) return false
  return true
}

/**
 * Deterministic local GD&T simulation engine (< 5ms) with MMC/LMC Bonus & Datum Shift modeling.
 * Complements `computeLocalSimulationDiagnostics` when backend solver is not yet wired.
 */
export function computeLocalGdtSimulationDiagnostics(
  spec: SimulationLoopSpec,
  options: {
    readonly toleranceOverrides?: Readonly<Record<string, number>>
    readonly gdtControls?: readonly GdtFeatureControl[]
    readonly datums?: readonly DatumDefinition[]
    readonly featureKindById?: ReadonlyMap<string, PickedFeatureGeometryKind>
    readonly featureLabelById?: ReadonlyMap<string, string>
  } = {},
): SimulationDiagnosticResult {
  const gdtControls = options.gdtControls ?? []
  const datums = options.datums ?? []
  const featureKindById = options.featureKindById ?? new Map<string, PickedFeatureGeometryKind>()
  const featureLabelById = options.featureLabelById ?? new Map<string, string>()

  const datumById = new Map(datums.map((d) => [d.id, d]))
  const gdtWarnings: GdtValidationWarning[] = []
  const rawGdtMetrics: Array<{
    readonly gdtId: string
    readonly featureId: string
    readonly label: string
    readonly kind: GdtFeatureControl['kind']
    readonly effectiveVariance: number
    readonly bonusMeanMm: number
    readonly datumShiftPctRaw: number
    readonly effectiveTolMm: number
  }> = []

  // Build schema-compatible feature list for resolveGdtMaterialConditions
  const schemaFeatures = Array.from(featureKindById.entries()).map(([id, kind]) =>
    kind === 'cylindrical-hole-axis'
      ? ({
          id,
          partId: 'part',
          signature: id,
          kind: 'cylindrical-hole-axis' as const,
          originQ: [0, 0, 0] as [number, number, number],
          axis: [0, 0, 1] as [number, number, number],
          radiusQ: 50000,
        })
      : ({
          id,
          partId: 'part',
          signature: id,
          kind: 'face' as const,
          surface: 'plane' as const,
          originQ: [0, 0, 0] as [number, number, number],
          normal: [0, 0, 1] as [number, number, number],
        }),
  )

  for (const control of gdtControls) {
    const resolved = resolveGdtMaterialConditions(control, {
      features: schemaFeatures,
      datums: [...datums],
    })
    gdtWarnings.push(...resolved.warnings)

    const baseTolMm = Math.max(0.005, control.toleranceQ / 10000)
    const isCyl = featureKindById.get(control.featureId) === 'cylindrical-hole-axis'

    // Compute MMC/LMC mean bonus (mm)
    let bonusMeanMm = 0
    if ((resolved.modifier === 'MMC' || resolved.modifier === 'LMC') && isCyl) {
      const sizeSpanMm = control.featureSizeToleranceQ
        ? Math.max(0, (control.featureSizeToleranceQ.upperQ - control.featureSizeToleranceQ.lowerQ) / 10000)
        : 0.1
      bonusMeanMm = Math.round(sizeSpanMm * 0.5 * 1000) / 1000
    }

    // Compute Datum Shift contribution (%)
    let datumShiftSpanMm = 0
    control.datumIds.forEach((datumId, idx) => {
      const datumMod = resolved.datumModifiers[idx] ?? 'RFS'
      if (datumMod === 'MMC' || datumMod === 'LMC') {
        const datum = datumById.get(datumId)
        const spanMm = datum?.sizeToleranceQ
          ? Math.max(0, (datum.sizeToleranceQ.upperQ - datum.sizeToleranceQ.lowerQ) / 10000)
          : 0.06
        datumShiftSpanMm += spanMm * 0.45
      }
    })

    // Effective tolerance: MMC bonus & datum shift relax assembly risk (reducing effective spread)
    const relaxationFactor = 1 / (1 + (bonusMeanMm + datumShiftSpanMm) / Math.max(baseTolMm, 0.02))
    const effectiveTolMm = Math.max(0.005, baseTolMm * relaxationFactor)
    const sigma = effectiveTolMm / 3
    const effectiveVariance = sigma * sigma
    const datumShiftPctRaw =
      datumShiftSpanMm > 0
        ? Math.min(35, Math.round((datumShiftSpanMm / (baseTolMm + datumShiftSpanMm)) * 1000) / 10)
        : 0

    const featLabel = featureLabelById.get(control.featureId) ?? control.featureId
    const meta = GDT_KIND_META[control.kind]

    rawGdtMetrics.push({
      gdtId: control.id,
      featureId: control.featureId,
      label: `${featLabel} · ${meta.label}`,
      kind: control.kind,
      effectiveVariance,
      bonusMeanMm,
      datumShiftPctRaw,
      effectiveTolMm,
    })
  }

  // Merge GD&T effective tolerances into contributor overrides for linked features
  const mergedOverrides: Record<string, number> = { ...(options.toleranceOverrides ?? {}) }
  for (const m of rawGdtMetrics) {
    const matchedContributor = spec.contributors.find((c) => c.featureId === m.featureId)
    if (matchedContributor && options.toleranceOverrides?.[matchedContributor.id] === undefined) {
      mergedOverrides[matchedContributor.id] = m.effectiveTolMm
    }
  }

  const baseResult = computeLocalSimulationDiagnostics(spec, mergedOverrides)

  const totalGdtVariance = rawGdtMetrics.reduce((acc, m) => acc + m.effectiveVariance, 0)
  const gdtContributions: GdtContributionItem[] = rawGdtMetrics
    .map((m) => ({
      gdtId: m.gdtId,
      label: m.label,
      kind: m.kind,
      varianceSharePct:
        totalGdtVariance > 0
          ? Math.round((m.effectiveVariance / totalGdtVariance) * 1000) / 10
          : 0,
      bonusMeanMm: m.bonusMeanMm,
      datumShiftContributionPct: m.datumShiftPctRaw,
    }))
    .sort((a, b) => b.varianceSharePct - a.varianceSharePct)

  return {
    ...baseResult,
    gdtContributions,
    gdtWarnings,
  }
}

/** Default M3G GD&T fixture (Datums A/B, 5 GD&T types, and AI-suggested GD&T/Datum drafts). */
export function createDefaultM3gGdtFixture(): {
  readonly datums: readonly DatumDefinition[]
  readonly gdtControls: readonly GdtFeatureControl[]
  readonly aiGdtDrafts: readonly AiGdtDraftItem[]
} {
  const datums: readonly DatumDefinition[] = [
    {
      id: 'datum-A',
      label: 'A',
      featureId: 'feat-base-bottom-face',
    },
    {
      id: 'datum-B',
      label: 'B',
      featureId: 'feat-base-hole-axis',
      sizeToleranceQ: { lowerQ: -300, upperQ: 300 },
    },
  ]

  const gdtControls: readonly GdtFeatureControl[] = [
    {
      id: 'gdt-bracket-hole-pos',
      featureId: 'feat-bracket-hole-axis',
      kind: 'position',
      toleranceQ: 1200, // Ø0.12 mm
      modifier: 'MMC',
      datumIds: ['datum-A', 'datum-B'],
      datumModifiers: ['RFS', 'MMC'],
      zoneShape: 'cylindrical',
      featureSizeToleranceQ: { lowerQ: -500, upperQ: 500 },
    },
    {
      id: 'gdt-bracket-bottom-flat',
      featureId: 'feat-bracket-bottom-face',
      kind: 'flatness',
      toleranceQ: 1400, // 0.14 mm
      modifier: 'RFS',
      datumIds: [],
      zoneShape: 'planar',
    },
    {
      id: 'gdt-spacer-top-perp',
      featureId: 'feat-spacer-top-face',
      kind: 'perpendicularity',
      toleranceQ: 800, // 0.08 mm
      modifier: 'RFS',
      datumIds: ['datum-A'],
      datumModifiers: ['RFS'],
      zoneShape: 'planar',
    },
    {
      id: 'gdt-base-top-para',
      featureId: 'feat-base-top-face',
      kind: 'parallelism',
      toleranceQ: 600, // 0.06 mm
      modifier: 'RFS',
      datumIds: ['datum-A'],
      datumModifiers: ['RFS'],
      zoneShape: 'planar',
    },
    {
      id: 'gdt-spacer-bore-coax',
      featureId: 'feat-spacer-bore-axis',
      kind: 'coaxiality',
      toleranceQ: 1000, // Ø0.10 mm
      modifier: 'LMC',
      datumIds: ['datum-B'],
      datumModifiers: ['RFS'],
      zoneShape: 'cylindrical',
      featureSizeToleranceQ: { lowerQ: -400, upperQ: 400 },
    },
  ]

  const aiGdtDrafts: readonly AiGdtDraftItem[] = [
    {
      id: 'ai-gdt-draft-datum-c',
      draftKind: 'datum',
      title: '建议基准 C · 弹性隔套 › 上支撑面',
      featureId: 'feat-spacer-top-face',
      partId: 'part-spacer',
      featureLabel: '弹性隔套 › 上支撑面',
      datum: {
        id: 'datum-C',
        label: 'C',
        featureId: 'feat-spacer-top-face',
      },
      confidencePercent: 94,
      rationale: '隔套上支撑面控制盖板轴向定位第三自由度，建议补全三级基准 C。',
      evidenceRefs: [
        {
          kind: 'pdf-text',
          documentId: 'doc-taskbook-1',
          revisionId: 'rev-taskbook-1',
          sha256: '1'.repeat(64),
          blobKey: 'blob-taskbook-1',
          page: 4,
          rectPdf: [48, 210, 310, 228],
          pageBoxPdf: [0, 0, 595, 842],
          textSnippet: '以底座底面为基准 A，定位孔为基准 B，隔套上端面为辅助基准 C',
          normalizedSnippet: '以底座底面为基准 A，定位孔为基准 B，隔套上端面为辅助基准 C',
          textItemIndexes: [0],
        },
      ],
      selected: true,
    },
    {
      id: 'ai-gdt-draft-pos-base-hole',
      draftKind: 'gdt',
      title: '建议位置度 ⌖ Ø0.10 Ⓜ | A · 底座定位孔',
      featureId: 'feat-base-hole-axis',
      partId: 'part-base',
      featureLabel: '底座安装板 › 定位孔轴',
      gdt: {
        id: 'gdt-ai-base-hole-pos',
        featureId: 'feat-base-hole-axis',
        kind: 'position',
        toleranceQ: 1000,
        modifier: 'MMC',
        datumIds: ['datum-A'],
        datumModifiers: ['RFS'],
        zoneShape: 'cylindrical',
        featureSizeToleranceQ: { lowerQ: -500, upperQ: 500 },
      },
      confidencePercent: 91,
      rationale: '任务书要求底座定位孔采用最大实体要求（MMC）以释放装配补偿并降低废品率。',
      evidenceRefs: [
        {
          kind: 'pdf-text',
          documentId: 'doc-taskbook-1',
          revisionId: 'rev-taskbook-1',
          sha256: '2'.repeat(64),
          blobKey: 'blob-taskbook-1',
          page: 5,
          rectPdf: [48, 260, 320, 278],
          pageBoxPdf: [0, 0, 595, 842],
          textSnippet: '底座定位孔位置度 Ø0.10 Ⓜ 相对基准 A，孔径公差 ±0.05 mm',
          normalizedSnippet: '底座定位孔位置度 Ø0.10 Ⓜ 相对基准 A，孔径公差 ±0.05 mm',
          textItemIndexes: [0],
        },
      ],
      selected: true,
    },
  ]

  return { datums, gdtControls, aiGdtDrafts }
}
