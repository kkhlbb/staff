/**
 * 内置轴系示例（B1 · 示意装配）的确定性夹具。
 *
 * 这层只有纯数据与纯函数：不 import three、不触 DOM、不碰 IPC/schema。
 * 领域单位 q 只在显示适配边界（这里）转成 mm，网格浮点坐标绝不回流领域数据。
 *
 * 参考：
 * - 任务卡 V3-B1 §3.2/§3.3/§3.4（坐标、ID、爆炸插值）；
 * - 尺寸链示例（A）的隔套 q 值：内径 200000、外径 320000、长度 120000。
 */
import { Q_PER_MM } from '../domain/types'
import { formatMm, parseMm } from '../domain/units'

/** 示例命名空间前缀：partId 是注册常量，不由下标/uuid/名称派生。 */
export const DEMO_NAMESPACE = 'builtin:shaft-demo' as const

export const BUILTIN_PART_IDS = [
  'builtin:shaft-demo:shaft',
  'builtin:shaft-demo:bearing-left',
  'builtin:shaft-demo:spacer',
  'builtin:shaft-demo:bearing-right',
  'builtin:shaft-demo:retaining-ring',
] as const

export type BuiltinPartId = (typeof BUILTIN_PART_IDS)[number]

/**
 * 隔套源尺寸（q）。与尺寸链示例同值，用既有 parseMm 解析固定十进制字面量，
 * 不经 parseFloat；转 mm 只在本模块的显示适配函数里发生。
 */
export const SPACER_SOURCE_Q = {
  innerDiameterQ: parseMm('20'),
  outerDiameterQ: parseMm('32'),
  lengthQ: parseMm('12'),
} as const

/** q（直径/长度）→ 显示 mm。仅用于渲染，不写回领域。 */
export function qToMm(value: number): number {
  if (!Number.isSafeInteger(value)) throw new RangeError(`q 必须是安全整数，收到 ${String(value)}`)
  return value / Q_PER_MM
}

const spacerInnerRadiusMm = qToMm(SPACER_SOURCE_Q.innerDiameterQ) / 2
const spacerOuterRadiusMm = qToMm(SPACER_SOURCE_Q.outerDiameterQ) / 2
const spacerHalfLengthMm = qToMm(SPACER_SOURCE_Q.lengthQ) / 2

/** 截面形状：轴为开放折线（r=0 两端自动成端面），环为闭合折线（内壁+外壁+两端面）。 */
export type DemoShape =
  | { readonly kind: 'stepped-shaft' }
  | { readonly kind: 'ring'; readonly innerRadius: number; readonly outerRadius: number }

export interface DemoPartDefinition {
  readonly id: BuiltinPartId
  readonly name: string
  /** 装配（t=0）时的世界 X 区间，mm。 */
  readonly xRange: readonly [number, number]
  /** 爆炸最大 X 位移（t=1 时相对装配位置的增量），mm；负数向 −X。 */
  readonly explodeX: number
  readonly shape: DemoShape
  /** 中性色（未选中）。选中色由渲染层统一替换。 */
  readonly color: number
  readonly note: string
}

const parts: Record<BuiltinPartId, DemoPartDefinition> = {
  'builtin:shaft-demo:shaft': {
    id: 'builtin:shaft-demo:shaft',
    name: '阶梯轴',
    xRange: [-45, 45],
    explodeX: 0,
    shape: { kind: 'stepped-shaft' },
    color: 0xb9c3cf,
    note: '四级径向台阶，两端面封闭',
  },
  'builtin:shaft-demo:bearing-left': {
    id: 'builtin:shaft-demo:bearing-left',
    name: '左轴承',
    xRange: [-26, -6],
    explodeX: -24,
    shape: { kind: 'ring', innerRadius: 10, outerRadius: 22 },
    color: 0xa9b6c6,
    note: '简化示意：中空圆筒，不含滚动体',
  },
  'builtin:shaft-demo:spacer': {
    id: 'builtin:shaft-demo:spacer',
    name: '隔套',
    xRange: [-spacerHalfLengthMm, spacerHalfLengthMm],
    explodeX: 0,
    shape: { kind: 'ring', innerRadius: spacerInnerRadiusMm, outerRadius: spacerOuterRadiusMm },
    color: 0xc4cdd9,
    note: '内径 20.0000 / 外径 32.0000 / 长 12.0000 mm（由 q 换算）',
  },
  'builtin:shaft-demo:bearing-right': {
    id: 'builtin:shaft-demo:bearing-right',
    name: '右轴承',
    xRange: [6, 26],
    explodeX: 24,
    shape: { kind: 'ring', innerRadius: 10, outerRadius: 22 },
    color: 0xa9b6c6,
    note: '简化示意：中空圆筒，不含滚动体',
  },
  'builtin:shaft-demo:retaining-ring': {
    id: 'builtin:shaft-demo:retaining-ring',
    name: '挡圈',
    xRange: [-29, -27],
    explodeX: -48,
    shape: { kind: 'ring', innerRadius: 10, outerRadius: 14 },
    color: 0x9faab8,
    note: '简化闭环示意，不含卡槽细节',
  },
}

/** 注册表只读视图；顺序固定，可被树/渲染/测试共用。 */
export const DEMO_PARTS: readonly DemoPartDefinition[] = BUILTIN_PART_IDS.map((id) => parts[id])

export function isBuiltinPartId(value: unknown): value is BuiltinPartId {
  return typeof value === 'string' && (BUILTIN_PART_IDS as readonly string[]).includes(value)
}

/** 无效输入安全归一为 null（不抛错、不猜身份）。 */
export function normalizeSelectedPartId(value: unknown): BuiltinPartId | null {
  return isBuiltinPartId(value) ? value : null
}

export function demoPart(id: BuiltinPartId): DemoPartDefinition {
  return parts[id]
}

/** 装配（t=0）世界 X 中心；由区间唯一派生。 */
export function baseCenterX(id: BuiltinPartId): number {
  const [from, to] = parts[id].xRange
  return (from + to) / 2
}

function assertExplodeT(t: number): number {
  if (typeof t !== 'number' || !Number.isFinite(t)) {
    throw new TypeError(`爆炸参数必须是有限数，收到 ${String(t)}`)
  }
  return Math.min(1, Math.max(0, t))
}

/** t=clamp(t,0,1)；位置 p_i(t)=base+t*offset，只改 X，不改旋转/比例/几何。 */
export function explodeX(id: BuiltinPartId, t: number): number {
  const clamped = assertExplodeT(t)
  return baseCenterX(id) + clamped * parts[id].explodeX
}

export function explodePosition(id: BuiltinPartId, t: number): { x: number; y: number; z: number } {
  return { x: explodeX(id, t), y: 0, z: 0 }
}

/** 完整爆炸包围盒（世界 mm），供相机 framing 与测试独立断言。 */
export const ASSEMBLED_BOUNDS = { min: [-45, -22, -22], max: [45, 22, 22] } as const
export const EXPLODED_BOUNDS = { min: [-45 - 48, -22, -22], max: [45 + 48, 22, 22] } as const

/**
 * 相机 pose 只含可复制的数值，不含 three 对象、main DTO 或附件路径。
 * 各分量非有限时整体拒绝（返回 null），由调用方保留旧值。
 */
export interface DemoViewState {
  readonly position: readonly [number, number, number]
  readonly target: readonly [number, number, number]
  readonly zoom: number
}

function finiteTriple(value: unknown): value is readonly [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number' && Number.isFinite(item))
}

export function normalizeViewState(value: unknown): DemoViewState | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as { position?: unknown; target?: unknown; zoom?: unknown }
  if (!finiteTriple(candidate.position) || !finiteTriple(candidate.target)) return null
  if (typeof candidate.zoom !== 'number' || !Number.isFinite(candidate.zoom) || candidate.zoom <= 0) return null
  return {
    position: [candidate.position[0], candidate.position[1], candidate.position[2]],
    target: [candidate.target[0], candidate.target[1], candidate.target[2]],
    zoom: candidate.zoom,
  }
}

export function cloneViewState(view: DemoViewState): DemoViewState {
  return { position: [...view.position], target: [...view.target], zoom: view.zoom }
}

/** 滑条 0–100 → t；非有限数返回 null（调用方保留旧值）。 */
export function explodeTFromSlider(raw: string | number): number | null {
  const value = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(value)) return null
  return Math.min(1, Math.max(0, value / 100))
}

/** 带符号 mm 显示；-0 归一成 0.0，避免出现 “-0.0”。 */
function signedExplodeMm(value: number): string {
  const normalized = value === 0 ? 0 : value
  return `${normalized > 0 ? '+' : ''}${normalized.toFixed(1)} mm（X）`
}

/**
 * 只读属性行：属性栏与测试共用同一来源。
 * explodeT 是当前爆炸进度（0–1），缺省按装配态 0 计算；「当前」行随滑条变化，
 * 「设计最大位移（上限）」是本件的静态设计参数，二者分开，不再用静态值冒充当前值。
 */
export function partPropertyRows(id: BuiltinPartId, explodeT = 0): [string, string][] {
  const def = parts[id]
  const [from, to] = def.xRange
  const t = assertExplodeT(explodeT)
  const fixed = def.explodeX === 0
  const rows: [string, string][] = [
    ['类型', '内置示意部件（只读）'],
    ['装配 X 区间', `${formatMm(Math.round(from * Q_PER_MM))} … ${formatMm(Math.round(to * Q_PER_MM))} mm`],
    ['爆炸位移（当前）', fixed ? '0.0 mm（X）' : signedExplodeMm(t * def.explodeX)],
    ['设计最大位移（上限）', `${signedExplodeMm(def.explodeX)}${fixed ? '（装配基准，不参与爆炸）' : ''}`],
  ]
  if (def.shape.kind === 'ring') {
    rows.push(
      ['内半径', `${def.shape.innerRadius.toFixed(4)} mm`],
      ['外半径', `${def.shape.outerRadius.toFixed(4)} mm`],
    )
  } else {
    rows.push(['径向台阶', 'r8 / r10 / r14 / r8 mm'])
  }
  if (id === 'builtin:shaft-demo:spacer') {
    rows.push(
      ['内径（源 q）', `${formatMm(SPACER_SOURCE_Q.innerDiameterQ)} mm`],
      ['外径（源 q）', `${formatMm(SPACER_SOURCE_Q.outerDiameterQ)} mm`],
      ['长度（源 q）', `${formatMm(SPACER_SOURCE_Q.lengthQ)} mm`],
    )
  }
  rows.push(['关联尺寸链', '未关联 · 示例几何（不随尺寸编辑变化）'])
  return rows
}
