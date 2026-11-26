import type { AssemblyGroup, PartMesh, PartRgbColorInput } from './assembly3dTypes'

export const DEFAULT_PART_SWATCH_PALETTE: readonly string[] = [
  '#64748b',
  '#3b82f6',
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
]

export const DEFAULT_PART_SWATCH_COLOR = DEFAULT_PART_SWATCH_PALETTE[0]

function byteToHex(value: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(value)))
  return clamped.toString(16).padStart(2, '0')
}

function rgbTripleToHex(r: number, g: number, b: number): string | null {
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
    return null
  }
  if (r < 0 || g < 0 || b < 0 || r > 255 || g > 255 || b > 255) {
    return null
  }
  // Treat [0..1] triples (including [1, 0, 0]) as normalized XCAF/OCCT float RGB.
  const isNormalizedUnit = r <= 1 && g <= 1 && b <= 1
  const scale = isNormalizedUnit ? 255 : 1
  return `#${byteToHex(r * scale)}${byteToHex(g * scale)}${byteToHex(b * scale)}`
}

/**
 * Normalizes a part display color into a canonical lowercase `#rrggbb` hex string.
 * Supports:
 * - `#rrggbb` and `#rgb` hex strings (matching `src/project-file/assembly3d.ts`)
 * - `rgb(r, g, b)` / `rgba(r, g, b, a)` CSS strings (0–255 or 0–1 floats)
 * - `[r, g, b]` tuples (0–1 float RGB or 0–255 float/integer RGB)
 * - `{ r, g, b }` objects (0–1 float RGB or 0–255 float/integer RGB)
 */
export function normalizePartDisplayColor(
  input: PartRgbColorInput | null | undefined,
  fallback?: string,
): string | null {
  if (typeof input === 'string') {
    const trimmed = input.trim()
    if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
      return trimmed.toLowerCase()
    }
    const shortHex = /^#([0-9a-fA-F]{3})$/.exec(trimmed)
    if (shortHex) {
      const [r, g, b] = shortHex[1]
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
    }
    const rgbMatch =
      /^rgba?\(\s*([+-]?\d*\.?\d+)\s*[,/\s]\s*([+-]?\d*\.?\d+)\s*[,/\s]\s*([+-]?\d*\.?\d+)(?:\s*[,/]\s*[+-]?\d*\.?\d+%?)?\s*\)$/i.exec(
        trimmed,
      )
    if (rgbMatch) {
      const r = Number(rgbMatch[1])
      const g = Number(rgbMatch[2])
      const b = Number(rgbMatch[3])
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
        if (r >= 0 && g >= 0 && b >= 0 && r <= 255 && g <= 255 && b <= 255) {
          const hasFractionalUnit =
            r <= 1 && g <= 1 && b <= 1 && (!Number.isInteger(r) || !Number.isInteger(g) || !Number.isInteger(b))
          const scale = hasFractionalUnit ? 255 : 1
          return `#${byteToHex(r * scale)}${byteToHex(g * scale)}${byteToHex(b * scale)}`
        }
      }
    }
  } else if (Array.isArray(input) && input.length === 3) {
    const hex = rgbTripleToHex(Number(input[0]), Number(input[1]), Number(input[2]))
    if (hex) return hex
  } else if (input && typeof input === 'object' && 'r' in input && 'g' in input && 'b' in input) {
    const hex = rgbTripleToHex(Number(input.r), Number(input.g), Number(input.b))
    if (hex) return hex
  }

  return fallback ?? null
}

/**
 * Resolves the canonical `#rrggbb` swatch color for a part with fallback to the default palette.
 * Precedence: explicit `part.displayColor` -> `modelColor` (XCAF model part color) -> `part.color` -> default palette.
 */
export function resolvePartDisplayColor(
  part: { readonly color?: string; readonly displayColor?: PartRgbColorInput },
  index = 0,
  modelColor?: PartRgbColorInput,
): string {
  const fromDisplay = normalizePartDisplayColor(part.displayColor)
  if (fromDisplay) return fromDisplay

  const fromModel = normalizePartDisplayColor(modelColor)
  if (fromModel) return fromModel

  const fromPartColor = normalizePartDisplayColor(part.color)
  if (fromPartColor) return fromPartColor

  const safeIndex = Number.isInteger(index) && index >= 0 ? index : 0
  return DEFAULT_PART_SWATCH_PALETTE[safeIndex % DEFAULT_PART_SWATCH_PALETTE.length]
}

export interface AssemblyTreePartInput {
  readonly partId: string
  readonly displayName: string
  readonly color?: string
  readonly displayColor?: PartRgbColorInput
  readonly groupId?: string
}

export interface AssemblyTreeGroupNode<TPart extends AssemblyTreePartInput = PartMesh> {
  readonly kind: 'group'
  readonly id: string
  readonly name: string
  readonly parentGroupId?: string
  readonly depth: number
  readonly childGroups: readonly AssemblyTreeGroupNode<TPart>[]
  readonly directParts: readonly TPart[]
  readonly descendantPartIds: readonly string[]
  readonly totalPartCount: number
}

export interface AssemblyTreeBuildResult<TPart extends AssemblyTreePartInput = PartMesh> {
  readonly isGrouped: boolean
  readonly rootGroups: readonly AssemblyTreeGroupNode<TPart>[]
  readonly rootParts: readonly TPart[]
  readonly detachedGroupIds: readonly string[]
}

export type GroupVisibilityState = 'empty' | 'visible' | 'partial' | 'hidden'

export function resolveGroupVisibilityState(
  descendantPartIds: readonly string[],
  hiddenPartIds?: ReadonlySet<string>,
): GroupVisibilityState {
  if (descendantPartIds.length === 0) return 'empty'
  if (!hiddenPartIds || hiddenPartIds.size === 0) return 'visible'

  let hiddenCount = 0
  for (const partId of descendantPartIds) {
    if (hiddenPartIds.has(partId)) {
      hiddenCount += 1
    }
  }
  if (hiddenCount === 0) return 'visible'
  if (hiddenCount === descendantPartIds.length) return 'hidden'
  return 'partial'
}

/**
 * Pure builder for a multi-level XCAF assembly tree.
 * - When `assemblyGroups` is omitted or empty, returns `isGrouped: false` with all parts in `rootParts`.
 * - Defends against self-references, multi-node cycles, missing `parentGroupId`, and orphan `part.groupId`
 *   by safely detaching cyclic/missing links to root level without infinite loops or losing any parts.
 */
export function buildAssemblyTree<TPart extends AssemblyTreePartInput>(
  parts: readonly TPart[],
  assemblyGroups?: readonly AssemblyGroup[],
): AssemblyTreeBuildResult<TPart> {
  if (!assemblyGroups || assemblyGroups.length === 0) {
    return {
      isGrouped: false,
      rootGroups: [],
      rootParts: [...parts],
      detachedGroupIds: [],
    }
  }

  const orderedGroups: AssemblyGroup[] = []
  const groupById = new Map<string, AssemblyGroup>()
  for (const group of assemblyGroups) {
    if (!group.id || groupById.has(group.id)) continue
    groupById.set(group.id, group)
    orderedGroups.push(group)
  }

  if (orderedGroups.length === 0) {
    return {
      isGrouped: false,
      rootGroups: [],
      rootParts: [...parts],
      detachedGroupIds: [],
    }
  }

  const effectiveParent = new Map<string, string | undefined>()
  const detachedSet = new Set<string>()

  // Pass 1: reject self-references and missing parent references
  for (const group of orderedGroups) {
    const parentId = group.parentGroupId
    if (!parentId) {
      effectiveParent.set(group.id, undefined)
      continue
    }
    if (parentId === group.id || !groupById.has(parentId)) {
      effectiveParent.set(group.id, undefined)
      detachedSet.add(group.id)
      continue
    }
    effectiveParent.set(group.id, parentId)
  }

  // Pass 2: iterative cycle detection & breaking (no recursion -> zero stack overflow risk)
  const visited = new Set<string>()
  for (const group of orderedGroups) {
    if (visited.has(group.id)) continue

    const path: string[] = []
    const pathSet = new Set<string>()
    let curr: string | undefined = group.id

    while (curr !== undefined) {
      if (visited.has(curr)) break
      if (pathSet.has(curr)) {
        // Break the cycle at `curr` by promoting it to root level.
        effectiveParent.set(curr, undefined)
        detachedSet.add(curr)
        break
      }
      pathSet.add(curr)
      path.push(curr)
      curr = effectiveParent.get(curr)
    }

    for (const id of path) {
      visited.add(id)
    }
  }

  // Build parent -> children adjacency lists in input order
  const childIdsByParent = new Map<string | undefined, string[]>()
  for (const group of orderedGroups) {
    const parentId = effectiveParent.get(group.id)
    const bucket = childIdsByParent.get(parentId)
    if (bucket) {
      bucket.push(group.id)
    } else {
      childIdsByParent.set(parentId, [group.id])
    }
  }

  // Assign parts to valid groups; orphan or ungrouped parts safely fall back to rootParts
  const directPartsByGroupId = new Map<string, TPart[]>()
  const rootParts: TPart[] = []
  for (const part of parts) {
    if (part.groupId && groupById.has(part.groupId)) {
      const bucket = directPartsByGroupId.get(part.groupId)
      if (bucket) {
        bucket.push(part)
      } else {
        directPartsByGroupId.set(part.groupId, [part])
      }
    } else {
      rootParts.push(part)
    }
  }

  // Materialize immutable tree nodes with recursive descendant part IDs & counts
  const materialized = new Set<string>()
  const buildNode = (groupId: string, depth: number): AssemblyTreeGroupNode<TPart> => {
    materialized.add(groupId)
    const group = groupById.get(groupId)!
    const childIds = childIdsByParent.get(groupId) ?? []
    const childGroups: AssemblyTreeGroupNode<TPart>[] = []
    for (const childId of childIds) {
      if (!materialized.has(childId)) {
        childGroups.push(buildNode(childId, depth + 1))
      }
    }
    const directParts = directPartsByGroupId.get(groupId) ?? []
    const descendantSet = new Set<string>()
    for (const child of childGroups) {
      for (const pid of child.descendantPartIds) {
        descendantSet.add(pid)
      }
    }
    for (const part of directParts) {
      descendantSet.add(part.partId)
    }
    const descendantPartIds = [...descendantSet]
    const parentId = effectiveParent.get(groupId)

    return {
      kind: 'group',
      id: group.id,
      name: group.name,
      ...(parentId !== undefined ? { parentGroupId: parentId } : {}),
      depth,
      childGroups,
      directParts,
      descendantPartIds,
      totalPartCount: descendantPartIds.length,
    }
  }

  const rootGroupIds = childIdsByParent.get(undefined) ?? []
  const rootGroups = rootGroupIds
    .filter((id) => !materialized.has(id))
    .map((id) => buildNode(id, 0))

  return {
    isGrouped: true,
    rootGroups,
    rootParts,
    detachedGroupIds: [...detachedSet],
  }
}
