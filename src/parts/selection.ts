/**
 * 3D 拾取/选择的纯逻辑（不触 WebGL，可在 jsdom 或 node 下单测）。
 *
 * 参考：three r187 Raycaster 官方文档（命中按距离排序、recursive 遍历后代）。
 * 这里只处理「已算出的命中列表 → 注册 partId」以及与设备无关的指针几何，
 * 真正的 setFromCamera/intersectObjects 留在 threeScene（GPU owner）。
 */
import type { Object3D } from 'three'
import { isBuiltinPartId, normalizeSelectedPartId, type BuiltinPartId } from './shaftDemo'

/** 按下到抬起的位移不超过该 CSS px 才算单击。 */
export const CLICK_MAX_DISTANCE_PX = 4

export interface Point2 {
  x: number
  y: number
}

/** 沿父链解析语义部件 ID；轮廓线、坐标轴等无 partId 的对象返回 null。 */
export function partIdFromObject(object: Object3D | null | undefined): BuiltinPartId | null {
  let node: Object3D | null = object ?? null
  while (node) {
    const candidate = node.userData?.partId
    if (isBuiltinPartId(candidate)) return candidate
    node = node.parent
  }
  return null
}

export interface IntersectionLike {
  object: Object3D
  distance: number
}

/**
 * 取最近的有效部件命中：过滤辅助对象（无 partId）、非有限距离；
 * 同一部件的多处命中天然收敛为最近那一处。
 */
export function nearestPartHit(hits: readonly IntersectionLike[]): { partId: BuiltinPartId; distance: number } | null {
  let best: { partId: BuiltinPartId; distance: number } | null = null
  for (const hit of hits) {
    if (!hit || !Number.isFinite(hit.distance) || hit.distance < 0) continue
    const partId = partIdFromObject(hit.object)
    if (!partId) continue
    if (best === null || hit.distance < best.distance) best = { partId, distance: hit.distance }
  }
  return best
}

export interface ClientRectLike {
  left: number
  top: number
  width: number
  height: number
}

/**
 * CSS 客户端坐标 → NDC。用 canvas 的 boundingClientRect（已含 DPR 折算后的 CSS 尺寸），
 * 不用 window 尺寸，也不再乘 DPR。退化矩形返回 null。
 */
export function ndcFromClient(clientX: number, clientY: number, rect: ClientRectLike): Point2 | null {
  if (!(rect.width > 0) || !(rect.height > 0)) return null
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null
  return {
    x: ((clientX - rect.left) / rect.width) * 2 - 1,
    y: -((clientY - rect.top) / rect.height) * 2 + 1,
  }
}

/** 拖动旋转/平移不触发选择。 */
export function isClickGesture(start: Point2, end: Point2, maxDistance = CLICK_MAX_DISTANCE_PX): boolean {
  const dx = end.x - start.x
  const dy = end.y - start.y
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false
  return Math.hypot(dx, dy) <= maxDistance
}

export interface PickPointerSample {
  button?: number
  pointerType?: string
  shiftKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
}

/**
 * 是否进入「选择候选」：
 * - 只认主键（button 0），右键平移、中键不选；
 * - Shift/Ctrl/Meta 是 OrbitControls 的平移组合键，不抢选择；
 * - 触控多指不选（由调用方传入当前活跃指针数）。
 */
export function canBeginPick(sample: PickPointerSample, activePointerCount = 1): boolean {
  if (activePointerCount > 1) return false
  if ((sample.button ?? 0) !== 0) return false
  if (sample.shiftKey || sample.ctrlKey || sample.metaKey) return false
  return true
}

/** 把外部传入的选中值归一化（不属于注册集合就安全清空）。 */
export function resolveSelectionInput(value: unknown): BuiltinPartId | null {
  return normalizeSelectedPartId(value)
}
