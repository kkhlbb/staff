/**
 * 内置轴系示例的程序化几何（确定性、无 GPU 依赖）。
 *
 * 约定（任务卡 V3-B1 §3.2）：
 * - 右手坐标系，装配轴为 X，+X 指向右轴承，Y 向上，Z 按右手系；1 world unit = 1 mm；
 * - 每件几何以自身装配中心为局部原点，装配位置由 Group.position 表达（baseTransform）；
 * - 径向分段固定 64，θ=0/π/2/π/3π/2 都是顶点，法线按解析式给出而不是逐面平均；
 * - 环件为内壁+外壁+两端面的中空圆筒，轴件为开放折线旋转（r=0 端自动成端面）。
 *
 * 参考：three r187 BufferGeometry 官方文档（position/normal/index + 显式包围盒 + dispose）。
 */
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three'
import {
  DEMO_PARTS,
  baseCenterX,
  explodeX,
  demoPart,
  type BuiltinPartId,
  type DemoPartDefinition,
} from './shaftDemo'

/** 径向分段数；四极值方向（0/90/180/270°）必须落在顶点上。 */
export const RADIAL_SEGMENTS = 64

export type ProfilePoint = readonly [x: number, radius: number]

export interface RevolveData {
  positions: number[]
  normals: number[]
  indices: number[]
}

/**
 * 把 (x, r) 折线绕 X 轴旋转成三角网格。
 *
 * - 每条折线段独立生成顶点（清晰台阶，不做跨段法线平均）；
 * - 法线解析式：段方向 (x', r') 的外法线 ∝ (−r', x'·cosθ, x'·sinθ)；
 * - 三角形绕序 (a,b,c)/(b,d,c) 与上述法线同向，避免依赖 material.side=DoubleSide；
 * - r=0 的端点只生成一个有效三角形，不留下零面积三角形。
 */
export function revolveProfile(profile: readonly ProfilePoint[], closed: boolean, segments = RADIAL_SEGMENTS): RevolveData {
  if (profile.length < 2) throw new RangeError('截面至少需要 2 个点')
  if (!Number.isInteger(segments) || segments < 4) throw new RangeError(`径向分段必须是 ≥4 的整数，收到 ${String(segments)}`)
  for (const [x, r] of profile) {
    if (!Number.isFinite(x) || !Number.isFinite(r)) throw new RangeError('截面坐标必须是有限数')
    if (r < 0) throw new RangeError(`半径不能为负，收到 ${String(r)}`)
  }

  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  const bandCount = closed ? profile.length : profile.length - 1

  for (let band = 0; band < bandCount; band += 1) {
    const from = profile[band]
    const to = profile[(band + 1) % profile.length]
    const dx = to[0] - from[0]
    const dr = to[1] - from[1]
    if (dx === 0 && dr === 0) continue
    if (from[1] === 0 && to[1] === 0) continue

    const base = positions.length / 3
    const ring = segments + 1
    for (const [x, radius] of [from, to]) {
      for (let j = 0; j <= segments; j += 1) {
        const angle = (j / segments) * Math.PI * 2
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        positions.push(x, radius * cos, radius * sin)
        // 外法线 ∝ (−r', x'·cosθ, x'·sinθ)；长度只依赖段方向，与 θ 无关。
        const length = Math.hypot(dr, dx) || 1
        normals.push(-dr / length, (dx * cos) / length, (dx * sin) / length)
      }
    }

    const lowRadius = from[1] === 0
    const highRadius = to[1] === 0
    for (let j = 0; j < segments; j += 1) {
      const a = base + j
      const b = base + j + 1
      const c = base + ring + j
      const d = base + ring + j + 1
      if (!lowRadius) indices.push(a, b, c)
      if (!highRadius) indices.push(b, d, c)
    }
  }

  return { positions, normals, indices }
}

/** 轴：四级台阶，两端 r=0 由旋转自动封闭成端面（无重叠圆柱）。 */
export function shaftProfile(): ProfilePoint[] {
  return [
    [-45, 0], [-45, 8],
    [-35, 8], [-35, 10],
    [30, 10], [30, 14],
    [38, 14], [38, 8],
    [45, 8], [45, 0],
  ]
}

/** 环：闭合折线（左端面 → 外壁 → 右端面 → 内壁），保证是真正的中空件。 */
export function ringProfile(halfLength: number, innerRadius: number, outerRadius: number): ProfilePoint[] {
  if (!(innerRadius > 0)) throw new RangeError('内半径必须为正')
  if (!(outerRadius > innerRadius)) throw new RangeError('外半径必须大于内半径')
  if (!(halfLength > 0)) throw new RangeError('半长必须为正')
  return [
    [-halfLength, innerRadius], [-halfLength, outerRadius],
    [halfLength, outerRadius], [halfLength, innerRadius],
  ]
}

/** 部件局部半长：世界区间一半，几何以装配中心为局部原点。 */
export function localHalfLength(def: DemoPartDefinition): number {
  const [from, to] = def.xRange
  return (to - from) / 2
}

export function partRevolveData(def: DemoPartDefinition): RevolveData {
  const halfLength = localHalfLength(def)
  if (def.shape.kind === 'stepped-shaft') return revolveProfile(shaftProfile(), false)
  return revolveProfile(ringProfile(halfLength, def.shape.innerRadius, def.shape.outerRadius), true)
}

/** 生成单个部件的 BufferGeometry（含显式包围盒，便于无 GPU 单测）。 */
export function createPartGeometry(def: DemoPartDefinition): BufferGeometry {
  const data = partRevolveData(def)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(data.positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(data.normals, 3))
  geometry.setIndex(data.indices)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  geometry.name = def.id
  return geometry
}

export interface DemoPartObject {
  readonly id: BuiltinPartId
  readonly definition: DemoPartDefinition
  /** 语义部件根：userData.partId 是唯一映射来源，位置由 baseTransform 表达。 */
  readonly group: Group
  readonly mesh: Mesh<BufferGeometry, MeshStandardMaterial>
  readonly geometry: BufferGeometry
  readonly material: MeshStandardMaterial
}

export interface DemoAssembly {
  readonly root: Group
  readonly parts: readonly DemoPartObject[]
  /** 只改 Group.position.x，不触碰几何顶点、参数值或领域数据。 */
  setExplodeT(t: number): void
  /** 幂等释放；共享资源由本 owner 唯一释放。 */
  dispose(): void
}

/**
 * 创建整个示意装配。每件自带独立材质（选中互不影响），语义部件恒为 5 个。
 */
export function createDemoAssembly(): DemoAssembly {
  const root = new Group()
  root.name = 'builtin:shaft-demo:root'
  const parts: DemoPartObject[] = []

  for (const definition of DEMO_PARTS) {
    const geometry = createPartGeometry(definition)
    const material = new MeshStandardMaterial({
      color: definition.color,
      roughness: 0.62,
      metalness: 0.08,
    })
    const mesh = new Mesh(geometry, material)
    mesh.name = `${definition.id}:mesh`
    const group = new Group()
    group.name = definition.id
    group.userData.partId = definition.id
    group.position.set(baseCenterX(definition.id), 0, 0)
    group.add(mesh)
    root.add(group)
    parts.push({ id: definition.id, definition, group, mesh, geometry, material })
  }

  let disposed = false
  const assembly: DemoAssembly = {
    root,
    parts,
    setExplodeT(t: number) {
      for (const part of parts) {
        part.group.position.set(explodeX(part.id, t), 0, 0)
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const part of parts) {
        part.geometry.dispose()
        part.material.dispose()
      }
      root.clear()
    },
  }
  return assembly
}

export function disposeDemoAssembly(assembly: DemoAssembly): void {
  assembly.dispose()
}

/** 可选：取单件定义（避免调用方重复 map 查找）。 */
export function assemblyPart(assembly: DemoAssembly, id: BuiltinPartId): DemoPartObject {
  const part = assembly.parts.find((item) => item.id === id)
  if (!part) throw new RangeError(`未知部件 ${id}`)
  return part
}

/** 供渲染层确认夹具与注册表一致（不参与断言期望值）。 */
export function assemblyPartCount(): number {
  return DEMO_PARTS.length
}

export function partDefinitionOrThrow(id: string): DemoPartDefinition {
  if (!DEMO_PARTS.some((item) => item.id === id)) throw new RangeError(`未知部件 ${id}`)
  return demoPart(id as BuiltinPartId)
}
