/**
 * 只读 DXF 解析（ASCII DXF，R12/AC1009 与 2000/AC1015 为主）。
 *
 * 参考来源（组码语义）：
 * - Autodesk DXF Reference：`ENTITIES` 段通用组码、`POLYLINE`/`VERTEX`、`LWPOLYLINE`
 *   的 `90/70/10/20/42`、`DIMENSION` 的 `2/42/70/1`、`VIEWPORT` 的 `40/41/45/12/22`；
 * - 本仓库 `src/drawing/dxfExport.ts` 写出的 2000 结构（同一套组码，已验证能被
 *   QCAD/ezdxf 打开）；
 * - `docs/evidence/dxf-depth/research.md` 的实测结论：`41/45` 是纸面/模型比例，
 *   `DIMENSION.42` 是实测值，`2` 是匿名几何块名。
 *
 * 约束：不修改任何文件、不联网、不引原生模块。未支持的实体按类型计数，绝不静默丢弃。
 */
import { decodeDxfBytes } from './decode'
import { decodeTextSymbols, dimensionValueText, estimateTextWidth, plainMtext } from './text'
import type {
  DxfBounds,
  DxfDocument,
  DxfEntity,
  DxfHeaderInfo,
  DxfLayer,
  DxfLayoutInfo,
  DxfPoint,
  DxfSpace,
  DxfUnsupportedCount,
  DxfViewportInfo,
  ParsedShape,
} from './types'

export interface GroupPair {
  code: string
  value: string
}

interface RawEntity {
  type: string
  pairs: GroupPair[]
}

const SUPPORTED_TYPES = new Set([
  'LINE',
  'CIRCLE',
  'ARC',
  'TEXT',
  'MTEXT',
  'LWPOLYLINE',
  'POLYLINE',
  'DIMENSION',
  'VIEWPORT',
])

/** 结构标记 / 表格记录不是图形实体，不参与「未渲染」计数。 */
const STRUCTURAL_TYPES = new Set([
  'SECTION',
  'ENDSEC',
  'EOF',
  'TABLE',
  'ENDTAB',
  'BLOCK',
  'ENDBLK',
  'VERTEX',
  'SEQEND',
  'LAYER',
  'STYLE',
  'LTYPE',
  'VPORT',
  'DIMSTYLE',
  'APPID',
  'BLOCK_RECORD',
  'DICTIONARY',
  'ACAD_LAYOUT',
  'LAYOUT',
  'CLASS',
  'OBJECT',
  'XRECORD',
  'PLOTSETTINGS',
])

export function tokenizeDxf(text: string): GroupPair[] {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')
  const pairs: GroupPair[] = []
  let index = 0
  while (index < lines.length) {
    const code = lines[index].trim()
    if (code === '' || !/^\d+$/.test(code)) {
      index += 1
      continue
    }
    const value = (lines[index + 1] ?? '').replace(/\r$/, '')
    pairs.push({ code, value })
    index += 2
  }
  return pairs
}

function groupByEntity(pairs: GroupPair[]): RawEntity[] {
  const entities: RawEntity[] = []
  let current: RawEntity | null = null
  for (const pair of pairs) {
    if (pair.code === '0') {
      current = { type: pair.value.trim().toUpperCase(), pairs: [] }
      entities.push(current)
    } else if (current !== null) {
      current.pairs.push(pair)
    }
  }
  return entities
}

function splitSections(pairs: GroupPair[]): Map<string, GroupPair[]> {
  const sections = new Map<string, GroupPair[]>()
  let current: string | null = null
  let buffer: GroupPair[] = []
  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index]
    if (pair.code === '0' && pair.value.trim().toUpperCase() === 'SECTION') {
      const namePair = pairs[index + 1]
      current = namePair !== undefined && namePair.code === '2' ? namePair.value.trim().toUpperCase() : null
      buffer = []
      index += 1
      continue
    }
    if (pair.code === '0' && pair.value.trim().toUpperCase() === 'ENDSEC') {
      if (current !== null) sections.set(current, buffer)
      current = null
      buffer = []
      continue
    }
    if (current !== null) buffer.push(pair)
  }
  return sections
}

function firstValue(entity: RawEntity, code: string): string | null {
  const found = entity.pairs.find((pair) => pair.code === code)
  return found === undefined ? null : found.value
}

function firstNumber(entity: RawEntity, code: string): number | null {
  const raw = firstValue(entity, code)
  if (raw === null) return null
  return toNumber(raw)
}

function toNumber(raw: string): number | null {
  const value = Number(raw.trim())
  return Number.isFinite(value) ? value : null
}

function pointOf(entity: RawEntity, xCode: string, yCode: string): DxfPoint | null {
  const x = firstNumber(entity, xCode)
  const y = firstNumber(entity, yCode)
  if (x === null || y === null) return null
  return { x, y }
}

function layerName(entity: RawEntity): string {
  const name = firstValue(entity, '8')
  return name === null || name.trim() === '' ? '0' : name.trim()
}

function entitySpace(entity: RawEntity): DxfSpace {
  return (firstValue(entity, '67')?.trim() ?? '0') === '1' ? 'paper' : 'model'
}

interface ParsedEntityGeometry {
  shapes: ParsedShape[]
  text?: string
  anchor?: DxfPoint
  unsupported?: string
  /** POLYLINE 的 VERTEX 数量，用于结构说明。 */
  vertices?: number
}

function closedPolylinePoints(points: DxfPoint[], closed: boolean): DxfPoint[] {
  return closed && points.length > 2 ? [...points, points[0]] : points
}

/**
 * bulge（组码 42）= tan(包含角/4)，表示从当前顶点到下一顶点的圆弧。
 * 这里按 16 段折线近似并在 notes 里说明，不静默把圆弧当直线。
 */
function expandBulge(points: DxfPoint[], bulges: (number | null)[], closed: boolean): {
  points: DxfPoint[]
  arcs: number
} {
  const result: DxfPoint[] = []
  let arcs = 0
  const limit = closed ? points.length : points.length - 1
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index]
    result.push(start)
    if (index >= limit) continue
    const bulge = bulges[index] ?? 0
    const end = points[(index + 1) % points.length]
    if (bulge === 0) continue
    arcs += 1
    const theta = 4 * Math.atan(bulge)
    const chord = Math.hypot(end.x - start.x, end.y - start.y)
    if (chord === 0 || Math.abs(Math.sin(theta / 2)) < 1e-9) continue
    const radius = chord / (2 * Math.sin(theta / 2))
    const midX = (start.x + end.x) / 2
    const midY = (start.y + end.y) / 2
    const normalX = -(end.y - start.y) / chord
    const normalY = (end.x - start.x) / chord
    const offset = radius * Math.cos(theta / 2)
    const cx = midX + normalX * offset
    const cy = midY + normalY * offset
    const startAngle = Math.atan2(start.y - cy, start.x - cx)
    const segments = 16
    for (let step = 1; step < segments; step += 1) {
      const angle = startAngle + (theta * step) / segments
      result.push({ x: cx + Math.abs(radius) * Math.cos(angle), y: cy + Math.abs(radius) * Math.sin(angle) })
    }
  }
  return { points: result, arcs }
}

function parsePolyline(entity: RawEntity, vertices: RawEntity[], spaceNotes: string[]): ParsedEntityGeometry {
  const flags = firstNumber(entity, '70') ?? 0
  if ((flags & 8) !== 0 || (flags & 16) !== 0 || (flags & 64) !== 0) {
    return { shapes: [], unsupported: 'POLYLINE（3D 网格）' }
  }
  const points: DxfPoint[] = []
  const bulges: (number | null)[] = []
  for (const vertex of vertices) {
    const point = pointOf(vertex, '10', '20')
    if (point === null) continue
    points.push(point)
    bulges.push(firstNumber(vertex, '42'))
  }
  if (points.length === 0) return { shapes: [] }
  const closed = (flags & 1) !== 0
  const expanded = expandBulge(points, bulges, closed)
  if (expanded.arcs > 0) {
    spaceNotes.push(`POLYLINE 含 ${expanded.arcs} 段圆弧（bulge），按 16 段折线近似。`)
  }
  return {
    shapes: [{ kind: 'polyline', points: closedPolylinePoints(expanded.points, closed), closed }],
    anchor: points[0],
    vertices: points.length,
  }
}

function parseLwPolyline(entity: RawEntity, spaceNotes: string[]): ParsedEntityGeometry {
  const points: DxfPoint[] = []
  const bulges: (number | null)[] = []
  let current: { x: number | null; y: number | null; bulge: number | null } | null = null
  for (const pair of entity.pairs) {
    if (pair.code === '10') {
      if (current !== null && current.x !== null && current.y !== null) {
        points.push({ x: current.x, y: current.y })
        bulges.push(current.bulge)
      }
      const x = toNumber(pair.value)
      current = { x: x, y: null, bulge: null }
    } else if (pair.code === '20' && current !== null) {
      current.y = toNumber(pair.value)
    } else if (pair.code === '42' && current !== null) {
      current.bulge = toNumber(pair.value)
    }
  }
  if (current !== null && current.x !== null && current.y !== null) {
    points.push({ x: current.x, y: current.y })
    bulges.push(current.bulge)
  }
  if (points.length === 0) return { shapes: [] }
  const closed = ((firstNumber(entity, '70') ?? 0) & 1) !== 0
  const expanded = expandBulge(points, bulges, closed)
  if (expanded.arcs > 0) {
    spaceNotes.push(`LWPOLYLINE 含 ${expanded.arcs} 段圆弧（bulge），按 16 段折线近似。`)
  }
  return {
    shapes: [{ kind: 'polyline', points: closedPolylinePoints(expanded.points, closed), closed }],
    anchor: points[0],
    vertices: points.length,
  }
}

function textAnchor(justify: number | null): 'start' | 'middle' | 'end' {
  if (justify === 1 || justify === 4) return 'middle'
  if (justify === 2) return 'end'
  return 'start'
}

function parseTextEntity(entity: RawEntity): ParsedEntityGeometry {
  const raw = firstValue(entity, '1') ?? ''
  const value = decodeTextSymbols(raw)
  if (value.trim() === '') return { shapes: [] }
  const height = firstNumber(entity, '40') ?? 2.5
  const rotation = firstNumber(entity, '50') ?? 0
  const horizontal = firstNumber(entity, '72')
  const vertical = firstNumber(entity, '73')
  const aligned = pointOf(entity, '11', '21')
  const base = pointOf(entity, '10', '20')
  const position = (horizontal !== null || vertical !== null) && aligned !== null ? aligned : base
  if (position === null) return { shapes: [] }
  return {
    shapes: [
      {
        kind: 'text',
        x: position.x,
        y: position.y,
        text: value,
        height,
        rotationDeg: rotation,
        anchor: textAnchor(horizontal),
        baseline: vertical === 2 ? 'middle' : 'alphabetic',
      },
    ],
    text: value,
    anchor: position,
  }
}

function parseMtextEntity(entity: RawEntity): ParsedEntityGeometry {
  // 组码 3 是前 250 字符分片，组码 1 是最后一段；顺序不能反。
  const chunks: string[] = []
  for (const pair of entity.pairs) {
    if (pair.code === '3') chunks.push(pair.value)
  }
  const tail = firstValue(entity, '1')
  if (tail !== null) chunks.push(tail)
  const value = plainMtext(chunks.join(''))
  if (value.trim() === '') return { shapes: [] }
  const position = pointOf(entity, '10', '20')
  if (position === null) return { shapes: [] }
  const height = firstNumber(entity, '40') ?? 2.5
  const attachment = firstNumber(entity, '71') ?? 1
  const column = (attachment - 1) % 3
  const anchor = column === 1 ? 'middle' : column === 2 ? 'end' : 'start'
  return {
    shapes: [
      {
        kind: 'text',
        x: position.x,
        y: position.y,
        text: value,
        height,
        rotationDeg: firstNumber(entity, '50') ?? 0,
        anchor,
        baseline: attachment >= 4 && attachment <= 6 ? 'middle' : 'alphabetic',
      },
    ],
    text: value,
    anchor: position,
  }
}

function parseSimpleEntity(entity: RawEntity): ParsedEntityGeometry {
  switch (entity.type) {
    case 'LINE': {
      const start = pointOf(entity, '10', '20')
      const end = pointOf(entity, '11', '21')
      if (start === null || end === null) return { shapes: [] }
      return {
        shapes: [{ kind: 'line', x1: start.x, y1: start.y, x2: end.x, y2: end.y }],
        anchor: start,
      }
    }
    case 'CIRCLE': {
      const center = pointOf(entity, '10', '20')
      const radius = firstNumber(entity, '40')
      if (center === null || radius === null || radius <= 0) return { shapes: [] }
      return { shapes: [{ kind: 'circle', cx: center.x, cy: center.y, r: radius }], anchor: center }
    }
    case 'ARC': {
      const center = pointOf(entity, '10', '20')
      const radius = firstNumber(entity, '40')
      const startDeg = firstNumber(entity, '50')
      const endDeg = firstNumber(entity, '51')
      if (center === null || radius === null || radius <= 0 || startDeg === null || endDeg === null) {
        return { shapes: [] }
      }
      const normalizedEnd = endDeg < startDeg ? endDeg + 360 : endDeg
      return {
        shapes: [{ kind: 'arc', cx: center.x, cy: center.y, r: radius, startDeg, endDeg: normalizedEnd }],
        anchor: center,
      }
    }
    case 'TEXT':
      return parseTextEntity(entity)
    case 'MTEXT':
      return parseMtextEntity(entity)
    case 'LWPOLYLINE':
      return parseLwPolyline(entity, [])
    default:
      return { shapes: [], unsupported: entity.type }
  }
}

function parseHeader(section: GroupPair[]): DxfHeaderInfo {
  const variables = new Map<string, GroupPair[]>()
  let currentName: string | null = null
  let buffer: GroupPair[] = []
  for (const pair of section) {
    if (pair.code === '9') {
      if (currentName !== null) variables.set(currentName, buffer)
      currentName = pair.value.trim()
      buffer = []
      continue
    }
    if (currentName !== null) buffer.push(pair)
  }
  if (currentName !== null) variables.set(currentName, buffer)

  const scalar = (name: string, code: string): string | null => {
    const pairs = variables.get(name)
    if (pairs === undefined) return null
    const found = pairs.find((pair) => pair.code === code)
    return found === undefined ? null : found.value.trim()
  }
  const point = (name: string): DxfPoint | null => {
    const pairs = variables.get(name)
    if (pairs === undefined) return null
    const x = pairs.find((pair) => pair.code === '10')
    const y = pairs.find((pair) => pair.code === '20')
    if (x === undefined || y === undefined) return null
    const xValue = toNumber(x.value)
    const yValue = toNumber(y.value)
    return xValue === null || yValue === null ? null : { x: xValue, y: yValue }
  }
  const insUnitsRaw = scalar('$INSUNITS', '70')

  return {
    acadVersion: scalar('$ACADVER', '1') ?? '',
    codepage: scalar('$DWGCODEPAGE', '3') ?? '',
    insUnits: insUnitsRaw === null ? null : toNumber(insUnitsRaw),
    extMin: point('$EXTMIN'),
    extMax: point('$EXTMAX'),
    paperMin: point('$PLIMMIN'),
    paperMax: point('$PLIMMAX'),
  }
}

function parseLayers(tables: GroupPair[]): DxfLayer[] {
  const layers: DxfLayer[] = []
  let table: string | null = null
  for (const entity of groupByEntity(tables)) {
    if (entity.type === 'TABLE') {
      table = firstValue(entity, '2')
      continue
    }
    if (entity.type === 'ENDTAB') {
      table = null
      continue
    }
    if (table !== 'LAYER' || entity.type !== 'LAYER') continue
    const name = firstValue(entity, '2')?.trim()
    if (name === undefined || name === '') continue
    const color = firstNumber(entity, '62') ?? 7
    const flags = firstNumber(entity, '70') ?? 0
    layers.push({
      name,
      color: Math.abs(color),
      off: color < 0,
      frozen: (flags & 1) !== 0,
    })
  }
  return layers
}

function parseBlocks(blocksSection: GroupPair[]): Map<string, RawEntity[]> {
  const blocks = new Map<string, RawEntity[]>()
  let currentName: string | null = null
  let currentEntities: RawEntity[] = []
  for (const entity of groupByEntity(blocksSection)) {
    if (entity.type === 'BLOCK') {
      currentName = firstValue(entity, '2')?.trim() ?? ''
      currentEntities = []
      continue
    }
    if (entity.type === 'ENDBLK') {
      if (currentName !== null) blocks.set(currentName, currentEntities)
      currentName = null
      currentEntities = []
      continue
    }
    if (currentName !== null) currentEntities.push(entity)
  }
  return blocks
}

function parseLayouts(objectsSection: GroupPair[]): DxfLayoutInfo[] {
  const layouts: DxfLayoutInfo[] = []
  for (const entity of groupByEntity(objectsSection)) {
    if (entity.type !== 'LAYOUT') continue
    const name = firstValue(entity, '1')?.trim()
    if (name === undefined || name === '') continue
    layouts.push({
      name,
      paperWidth: firstNumber(entity, '44') ?? 0,
      paperHeight: firstNumber(entity, '45') ?? 0,
      tabOrder: firstNumber(entity, '71') ?? layouts.length,
    })
  }
  return layouts
}

function parseViewport(entity: RawEntity, index: number): DxfViewportInfo | null {
  const center = pointOf(entity, '10', '20')
  const width = firstNumber(entity, '40')
  const height = firstNumber(entity, '41')
  if (center === null || width === null || height === null || width <= 0 || height <= 0) return null
  const viewCenter = pointOf(entity, '12', '22') ?? { x: 0, y: 0 }
  const viewHeight = firstNumber(entity, '45') ?? height
  if (viewHeight <= 0) return null
  return {
    id: `viewport:${index}`,
    number: firstNumber(entity, '69') ?? index,
    layer: layerName(entity),
    center,
    width,
    height,
    viewCenter,
    viewHeight,
    scale: height / viewHeight,
    twistDeg: firstNumber(entity, '50') ?? 0,
  }
}

function collectUnsupported(target: Map<string, number>, type: string): void {
  target.set(type, (target.get(type) ?? 0) + 1)
}

function expandDimension(
  entity: RawEntity,
  blocks: Map<string, RawEntity[]>,
  unsupported: Map<string, number>,
  notes: string[],
): ParsedEntityGeometry {
  const measurement = firstNumber(entity, '42')
  const dimensionType = firstNumber(entity, '70') ?? 0
  const blockName = firstValue(entity, '2')?.trim() ?? ''
  if (measurement === null) {
    // 没有 42 就没有可靠的标注值：不猜，按「未渲染」计数并说明。
    unsupported.set('DIMENSION（缺 42 实测值）', (unsupported.get('DIMENSION（缺 42 实测值）') ?? 0) + 1)
    notes.push(`DIMENSION ${blockName || '(无块名)'} 缺组码 42，无法确定标注值，未渲染。`)
    return { shapes: [] }
  }
  const valueText = dimensionValueText(measurement, dimensionType)
  const shapes: ParsedShape[] = []
  let label: { x: number; y: number; height: number; rotationDeg: number; anchor: 'start' | 'middle' | 'end'; baseline: 'alphabetic' | 'middle' } | null = null
  const block = blockName === '' ? undefined : blocks.get(blockName)
  if (block === undefined) {
    notes.push(`DIMENSION 引用的匿名块 ${blockName || '(空)'} 不存在；只显示 42 实测值 ${valueText}。`)
  } else {
    for (const child of block) {
      const parsed = parseSimpleEntity(child)
      if (parsed.unsupported !== undefined) {
        collectUnsupported(unsupported, parsed.unsupported)
        continue
      }
      for (const shape of parsed.shapes) {
        if (shape.kind === 'text') {
          // 匿名块里的旧文字不作显示值；只借它的位置/字高画 42 的实测值。
          if (label === null) {
            label = {
              x: shape.x,
              y: shape.y,
              height: shape.height,
              rotationDeg: shape.rotationDeg,
              anchor: shape.anchor,
              baseline: shape.baseline,
            }
          }
          continue
        }
        shapes.push(shape)
      }
    }
  }
  const textPoint = pointOf(entity, '11', '21') ?? pointOf(entity, '10', '20')
  if (label === null && textPoint !== null) {
    label = { x: textPoint.x, y: textPoint.y, height: 3.5, rotationDeg: 0, anchor: 'middle', baseline: 'alphabetic' }
  }
  if (label !== null) {
    shapes.push({ kind: 'text', ...label, text: valueText, fromMeasurement: true })
  }
  return {
    shapes,
    text: valueText,
    anchor: pointOf(entity, '10', '20') ?? undefined,
  }
}

export interface ParseDxfInput {
  bytes: Uint8Array
  fileName: string
}

/** 二进制 DXF（以 `AutoCAD Binary DXF` 开头）不是 ASCII 组码，本版不解析。 */
export function isBinaryDxf(bytes: Uint8Array): boolean {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 32))
  return head.startsWith('AutoCAD Binary DXF')
}

function binaryDxfDocument(fileName: string): DxfDocument {
  return {
    fileName,
    version: 'unknown',
    header: {
      acadVersion: '',
      codepage: '',
      insUnits: null,
      extMin: null,
      extMax: null,
      paperMin: null,
      paperMax: null,
    },
    encoding: {
      charset: 'unknown',
      codepage: '二进制 DXF',
      warning: true,
      detail: '这是二进制 DXF（AutoCAD Binary DXF），本版只解析 ASCII DXF，未渲染任何实体。',
    },
    layers: [],
    entities: [],
    viewports: [],
    layouts: [],
    unsupported: [{ type: '二进制 DXF', count: 1 }],
    notes: ['二进制 DXF 不支持：请另存为 ASCII DXF 再打开。'],
    modelBounds: null,
    paperSize: null,
    hasPaperSpace: false,
  }
}

export function parseDxfDocument(input: ParseDxfInput): DxfDocument {
  if (isBinaryDxf(input.bytes)) return binaryDxfDocument(input.fileName)
  const decoded = decodeDxfBytes(input.bytes)
  const sections = splitSections(tokenizeDxf(decoded.text))
  const header = parseHeader(sections.get('HEADER') ?? [])
  const layers = parseLayers(sections.get('TABLES') ?? [])
  const blocks = parseBlocks(sections.get('BLOCKS') ?? [])
  const layouts = parseLayouts(sections.get('OBJECTS') ?? [])

  const rawEntities = groupByEntity(sections.get('ENTITIES') ?? [])
  const notes: string[] = []
  const unsupported = new Map<string, number>()
  const entities: DxfEntity[] = []
  const viewports: DxfViewportInfo[] = []

  for (let index = 0; index < rawEntities.length; index += 1) {
    const raw = rawEntities[index]
    const space = entitySpace(raw)
    if (raw.type === 'VERTEX' || raw.type === 'SEQEND') continue

    if (raw.type === 'POLYLINE') {
      const vertices: RawEntity[] = []
      let cursor = index + 1
      while (cursor < rawEntities.length && rawEntities[cursor].type === 'VERTEX') {
        vertices.push(rawEntities[cursor])
        cursor += 1
      }
      if (cursor < rawEntities.length && rawEntities[cursor].type === 'SEQEND') cursor += 1
      index = cursor - 1
      const parsed = parsePolyline(raw, vertices, notes)
      if (parsed.unsupported !== undefined) {
        collectUnsupported(unsupported, parsed.unsupported)
        continue
      }
      if (parsed.shapes.length === 0) continue
      entities.push({
        id: `${space}:${entities.length}`,
        type: 'POLYLINE',
        layer: layerName(raw),
        space,
        shapes: parsed.shapes,
        anchor: parsed.anchor,
      })
      continue
    }

    if (raw.type === 'VIEWPORT') {
      const viewport = parseViewport(raw, viewports.length)
      if (viewport === null) {
        collectUnsupported(unsupported, 'VIEWPORT（缺尺寸）')
        continue
      }
      if (Math.abs(viewport.twistDeg) > 1e-6) {
        notes.push(`视口 ${viewport.id} 带 ${viewport.twistDeg}° 旋转；按 0° 渲染。`)
      }
      viewports.push(viewport)
      entities.push({
        id: `${space}:${entities.length}`,
        type: 'VIEWPORT',
        layer: viewport.layer,
        space,
        shapes: [
          {
            kind: 'polyline',
            points: [
              { x: viewport.center.x - viewport.width / 2, y: viewport.center.y - viewport.height / 2 },
              { x: viewport.center.x + viewport.width / 2, y: viewport.center.y - viewport.height / 2 },
              { x: viewport.center.x + viewport.width / 2, y: viewport.center.y + viewport.height / 2 },
              { x: viewport.center.x - viewport.width / 2, y: viewport.center.y + viewport.height / 2 },
              { x: viewport.center.x - viewport.width / 2, y: viewport.center.y - viewport.height / 2 },
            ],
            closed: true,
          },
        ],
        anchor: viewport.center,
      })
      continue
    }

    if (raw.type === 'DIMENSION') {
      const parsed = expandDimension(raw, blocks, unsupported, notes)
      if (parsed.shapes.length === 0) continue
      const measurement = firstNumber(raw, '42')
      const dimensionType = firstNumber(raw, '70') ?? 0
      entities.push({
        id: `${space}:${entities.length}`,
        type: 'DIMENSION',
        layer: layerName(raw),
        space,
        shapes: parsed.shapes,
        text: parsed.text,
        anchor: parsed.anchor,
        dimension:
          measurement === null
            ? undefined
            : {
                blockName: firstValue(raw, '2')?.trim() ?? '',
                dimensionType,
                measurement,
                textOverride: firstValue(raw, '1'),
                valueText: dimensionValueText(measurement, dimensionType),
              },
      })
      continue
    }

    if (!SUPPORTED_TYPES.has(raw.type)) {
      if (!STRUCTURAL_TYPES.has(raw.type)) collectUnsupported(unsupported, raw.type)
      continue
    }

    const parsed = parseSimpleEntity(raw)
    if (parsed.shapes.length === 0) {
      if (parsed.unsupported !== undefined) collectUnsupported(unsupported, parsed.unsupported)
      continue
    }
    entities.push({
      id: `${space}:${entities.length}`,
      type: raw.type,
      layer: layerName(raw),
      space,
      shapes: parsed.shapes,
      text: parsed.text,
      anchor: parsed.anchor,
    })
  }

  // 图层表可能缺某些实体引用的图层：补成默认色，避免图层开关漏项。
  const layerNames = new Set(layers.map((layer) => layer.name))
  for (const entity of entities) {
    if (!layerNames.has(entity.layer)) {
      layers.push({ name: entity.layer, color: 7, off: false, frozen: false })
      layerNames.add(entity.layer)
    }
  }

  const modelBounds = boundsOfShapes(
    entities.filter((entity) => entity.space === 'model').flatMap((entity) => entity.shapes),
  )
  const paperSize = resolvePaperSize(header, layouts)

  const version =
    header.acadVersion.toUpperCase() === 'AC1009'
      ? 'R12'
      : header.acadVersion.toUpperCase() === 'AC1015'
        ? '2000'
        : 'unknown'

  const hasPaperSpace =
    entities.some((entity) => entity.space === 'paper') || viewports.length > 0

  const unsupportedList: DxfUnsupportedCount[] = [...unsupported.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((left, right) => right.count - left.count || left.type.localeCompare(right.type))

  return {
    fileName: input.fileName,
    version,
    header,
    encoding: decoded.encoding,
    layers,
    entities,
    viewports,
    layouts,
    unsupported: unsupportedList,
    notes,
    modelBounds,
    paperSize,
    hasPaperSpace,
  }
}

function resolvePaperSize(
  header: DxfHeaderInfo,
  layouts: DxfLayoutInfo[],
): { width: number; height: number } | null {
  if (header.paperMin !== null && header.paperMax !== null) {
    const width = header.paperMax.x - header.paperMin.x
    const height = header.paperMax.y - header.paperMin.y
    if (width > 0 && height > 0) return { width, height }
  }
  const layout = layouts.find((item) => item.name.toLowerCase() !== 'model' && item.paperWidth > 0)
  if (layout !== undefined) return { width: layout.paperWidth, height: layout.paperHeight }
  return null
}

function arcPoints(shape: Extract<ParsedShape, { kind: 'arc' }>): DxfPoint[] {
  const points: DxfPoint[] = []
  const startRad = (shape.startDeg * Math.PI) / 180
  const endRad = (shape.endDeg * Math.PI) / 180
  points.push({ x: shape.cx + shape.r * Math.cos(startRad), y: shape.cy + shape.r * Math.sin(startRad) })
  points.push({ x: shape.cx + shape.r * Math.cos(endRad), y: shape.cy + shape.r * Math.sin(endRad) })
  const sweep = ((shape.endDeg - shape.startDeg) % 360 + 360) % 360
  for (const cardinal of [0, 90, 180, 270, 360]) {
    const relative = ((cardinal - shape.startDeg) % 360 + 360) % 360
    if (relative > 0 && relative < sweep) {
      const radians = (cardinal * Math.PI) / 180
      points.push({ x: shape.cx + shape.r * Math.cos(radians), y: shape.cy + shape.r * Math.sin(radians) })
    }
  }
  return points
}

export function boundsOfShapes(shapes: ParsedShape[]): DxfBounds | null {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  const include = (x: number, y: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  for (const shape of shapes) {
    if (shape.kind === 'line') {
      include(shape.x1, shape.y1)
      include(shape.x2, shape.y2)
    } else if (shape.kind === 'polyline') {
      for (const point of shape.points) include(point.x, point.y)
    } else if (shape.kind === 'circle') {
      include(shape.cx - shape.r, shape.cy - shape.r)
      include(shape.cx + shape.r, shape.cy + shape.r)
    } else if (shape.kind === 'arc') {
      for (const point of arcPoints(shape)) include(point.x, point.y)
    } else {
      const width = estimateTextWidth(shape.text, shape.height)
      const left = shape.anchor === 'middle' ? shape.x - width / 2 : shape.anchor === 'end' ? shape.x - width : shape.x
      include(left, shape.y)
      include(left + width, shape.y + shape.height)
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null
  return { minX, minY, maxX, maxY }
}
