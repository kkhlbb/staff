import { describe, expect, it, vi } from 'vitest'
import {
  RADIAL_SEGMENTS,
  createDemoAssembly,
  createPartGeometry,
  partRevolveData,
  ringProfile,
  revolveProfile,
  shaftProfile,
} from './shaftDemoGeometry'
import { BUILTIN_PART_IDS, DEMO_PARTS, demoPart, type BuiltinPartId } from './shaftDemo'

interface RawGeometry {
  positions: Float32Array
  normals: Float32Array
  indices: number[]
}

function raw(geometry: ReturnType<typeof createPartGeometry>): RawGeometry {
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  return {
    positions: position.array as Float32Array,
    normals: normal.array as Float32Array,
    indices: Array.from(geometry.getIndex()!.array as ArrayLike<number>),
  }
}

function boxesOf(geometry: ReturnType<typeof createPartGeometry>) {
  geometry.computeBoundingBox()
  const box = geometry.boundingBox!
  return { min: [...box.min.toArray()], max: [...box.max.toArray()] }
}

/** 卡片 §3.2 的局部期望盒（几何以装配中心为局部原点，mm）。 */
const LOCAL_BOXES: Record<BuiltinPartId, { min: [number, number, number]; max: [number, number, number] }> = {
  'builtin:shaft-demo:shaft': { min: [-45, -14, -14], max: [45, 14, 14] },
  'builtin:shaft-demo:bearing-left': { min: [-10, -22, -22], max: [10, 22, 22] },
  'builtin:shaft-demo:spacer': { min: [-6, -16, -16], max: [6, 16, 16] },
  'builtin:shaft-demo:bearing-right': { min: [-10, -22, -22], max: [10, 22, 22] },
  'builtin:shaft-demo:retaining-ring': { min: [-1, -14, -14], max: [1, 14, 14] },
}

const EPS = 1e-4

describe('B1 几何 · BufferGeometry 完整性（无 WebGL）', () => {
  it('5 个语义部件，ID 精确且每件一个 Group + 独立材质', () => {
    const assembly = createDemoAssembly()
    expect(assembly.parts).toHaveLength(5)
    expect(assembly.parts.map((part) => part.id)).toEqual([...BUILTIN_PART_IDS])
    expect(assembly.root.children).toHaveLength(5)
    for (const part of assembly.parts) {
      expect(part.group.userData.partId).toBe(part.id)
      expect(part.group.children).toEqual([part.mesh])
      expect(part.mesh.geometry).toBe(part.geometry)
    }
    const materials = new Set(assembly.parts.map((part) => part.material))
    expect(materials.size).toBe(5)
    assembly.dispose()
  })

  it('位置/法线有限、索引合法、无零面积三角形', () => {
    for (const definition of DEMO_PARTS) {
      const data = raw(createPartGeometry(definition))
      expect(data.positions.length % 3).toBe(0)
      expect(data.normals.length).toBe(data.positions.length)
      expect(data.indices.length % 3).toBe(0)
      expect(data.positions.length).toBeGreaterThan(0)
      for (let index = 0; index < data.positions.length; index += 1) {
        expect(Number.isFinite(data.positions[index])).toBe(true)
        expect(Number.isFinite(data.normals[index])).toBe(true)
      }
      const vertexCount = data.positions.length / 3
      for (const index of data.indices) {
        expect(Number.isInteger(index)).toBe(true)
        expect(index).toBeGreaterThanOrEqual(0)
        expect(index).toBeLessThan(vertexCount)
      }
      for (let triangle = 0; triangle < data.indices.length; triangle += 3) {
        const [a, b, c] = [data.indices[triangle], data.indices[triangle + 1], data.indices[triangle + 2]]
        const area = triangleArea(data.positions, a, b, c)
        expect(area).toBeGreaterThan(1e-9)
      }
      for (let vertex = 0; vertex < vertexCount; vertex += 1) {
        const length = Math.hypot(
          data.normals[vertex * 3],
          data.normals[vertex * 3 + 1],
          data.normals[vertex * 3 + 2],
        )
        expect(Math.abs(length - 1)).toBeLessThan(1e-6)
      }
    }
  })

  it('三角形绕序与解析法线同向（不依赖 DoubleSide）', () => {
    for (const definition of DEMO_PARTS) {
      const data = raw(createPartGeometry(definition))
      for (let triangle = 0; triangle < data.indices.length; triangle += 3) {
        const [a, b, c] = [data.indices[triangle], data.indices[triangle + 1], data.indices[triangle + 2]]
        const geometric = faceNormal(data.positions, a, b, c)
        const average = [0, 1, 2].map((axis) => (
          (data.normals[a * 3 + axis] + data.normals[b * 3 + axis] + data.normals[c * 3 + axis]) / 3
        ))
        const dot = geometric[0] * average[0] + geometric[1] * average[1] + geometric[2] * average[2]
        expect(dot).toBeGreaterThan(0)
      }
    }
  })

  it('各件局部包围盒与卡片表一致（误差 ≤ 0.0001 mm）', () => {
    for (const definition of DEMO_PARTS) {
      const box = boxesOf(createPartGeometry(definition))
      const expected = LOCAL_BOXES[definition.id]
      for (let axis = 0; axis < 3; axis += 1) {
        expect(Math.abs(box.min[axis] - expected.min[axis])).toBeLessThanOrEqual(EPS)
        expect(Math.abs(box.max[axis] - expected.max[axis])).toBeLessThanOrEqual(EPS)
      }
    }
  })

  it('装配总包围盒 min=(-45,-22,-22)、max=(45,22,22)（按世界变换求和）', () => {
    const assembly = createDemoAssembly()
    const world = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
    for (const part of assembly.parts) {
      const box = boxesOf(part.geometry)
      for (let axis = 0; axis < 3; axis += 1) {
        const offset = part.group.position.getComponent(axis)
        world.min[axis] = Math.min(world.min[axis], box.min[axis] + offset)
        world.max[axis] = Math.max(world.max[axis], box.max[axis] + offset)
      }
    }
    for (let axis = 0; axis < 3; axis += 1) {
      expect(Math.abs(world.min[axis] - [-45, -22, -22][axis])).toBeLessThanOrEqual(EPS)
      expect(Math.abs(world.max[axis] - [45, 22, 22][axis])).toBeLessThanOrEqual(EPS)
    }
    assembly.dispose()
  })

  it('隔套是真中空圆筒：内径 20 / 外径 32 / 长 12，孔内无顶点', () => {
    const definition = demoPart('builtin:shaft-demo:spacer')
    const data = raw(createPartGeometry(definition))
    let minRadius = Infinity
    let maxRadius = -Infinity
    for (let vertex = 0; vertex < data.positions.length / 3; vertex += 1) {
      const radius = Math.hypot(data.positions[vertex * 3 + 1], data.positions[vertex * 3 + 2])
      minRadius = Math.min(minRadius, radius)
      maxRadius = Math.max(maxRadius, radius)
    }
    expect(minRadius).toBeCloseTo(10, 6)
    expect(maxRadius).toBeCloseTo(16, 6)
    // 包围盒正确但实心的错误实现会在这里留下 r < 10 的顶点。
    expect(minRadius).toBeGreaterThan(10 - 1e-6)
    const box = boxesOf(createPartGeometry(definition))
    expect(box.max[0] - box.min[0]).toBeCloseTo(12, 6)
    expect(box.max[1] - box.min[1]).toBeCloseTo(32, 6)
  })

  it('阶梯轴最大半径 14，四段台阶与端面封闭', () => {
    const data = raw(createPartGeometry(demoPart('builtin:shaft-demo:shaft')))
    const radii = new Set<number>()
    for (let vertex = 0; vertex < data.positions.length / 3; vertex += 1) {
      radii.add(Number(Math.hypot(data.positions[vertex * 3 + 1], data.positions[vertex * 3 + 2]).toFixed(6)))
    }
    expect([...radii].sort((a, b) => a - b)).toEqual([0, 8, 10, 14])
    // 端面封闭：x=±45 处存在非零半径顶点（俯视为实心圆而非开口管）。
    const ends = new Set<string>()
    for (let vertex = 0; vertex < data.positions.length / 3; vertex += 1) {
      const x = data.positions[vertex * 3]
      if (Math.abs(x - 45) < 1e-6 || Math.abs(x + 45) < 1e-6) ends.add(`${x}:${Math.hypot(data.positions[vertex * 3 + 1], data.positions[vertex * 3 + 2])}`)
    }
    expect(ends.size).toBeGreaterThan(1)
  })

  it('径向分段 64 且包含四个极值方向', () => {
    expect(RADIAL_SEGMENTS).toBe(64)
    const data = raw(createPartGeometry(demoPart('builtin:shaft-demo:spacer')))
    const count = data.positions.length / 3
    // 4 条截面段 × 2 环 × (64+1) 顶点。
    expect(count).toBe(520)
    const near = (value: number) => Math.abs(value) < 1e-9
    let plusY = false
    let minusY = false
    let plusZ = false
    let minusZ = false
    for (let vertex = 0; vertex < count; vertex += 1) {
      const y = data.positions[vertex * 3 + 1]
      const z = data.positions[vertex * 3 + 2]
      if (Math.abs(y - 16) < 1e-9 && near(z)) plusY = true
      if (Math.abs(y + 16) < 1e-9 && near(z)) minusY = true
      if (Math.abs(z - 16) < 1e-9 && near(y)) plusZ = true
      if (Math.abs(z + 16) < 1e-9 && near(y)) minusZ = true
    }
    expect({ plusY, minusY, plusZ, minusZ }).toEqual({ plusY: true, minusY: true, plusZ: true, minusZ: true })
  })
})

describe('B1 几何 · 变换、ID 稳定与释放', () => {
  it('爆炸只改 Group.position.x，几何顶点与参数不动', () => {
    const assembly = createDemoAssembly()
    const before = assembly.parts.map((part) => Array.from((part.geometry.getAttribute('position').array as Float32Array).slice(0, 9)))
    assembly.setExplodeT(1)
    const expected: Record<BuiltinPartId, number> = {
      'builtin:shaft-demo:shaft': 0,
      'builtin:shaft-demo:bearing-left': -40,
      'builtin:shaft-demo:spacer': 0,
      'builtin:shaft-demo:bearing-right': 40,
      'builtin:shaft-demo:retaining-ring': -76,
    }
    for (const part of assembly.parts) {
      expect(part.group.position.x).toBe(expected[part.id])
      expect(part.group.position.y).toBe(0)
      expect(part.group.position.z).toBe(0)
    }
    assembly.setExplodeT(0.5)
    expect(assembly.parts[1].group.position.x).toBe(-28)
    expect(assembly.parts[3].group.position.x).toBe(28)
    expect(assembly.parts[4].group.position.x).toBe(-52)
    const after = assembly.parts.map((part) => Array.from((part.geometry.getAttribute('position').array as Float32Array).slice(0, 9)))
    expect(after).toEqual(before)
    assembly.dispose()
  })

  it('重建两次/反转顺序后 ID 集合与映射不变', () => {
    const first = createDemoAssembly()
    const second = createDemoAssembly()
    expect(first.parts.map((part) => part.id)).toEqual(second.parts.map((part) => part.id))
    const reversed = [...DEMO_PARTS].reverse().map((definition) => createPartGeometry(definition).name)
    expect(new Set(reversed)).toEqual(new Set(BUILTIN_PART_IDS))
    for (const part of second.parts) {
      expect(part.group.userData.partId).toBe(part.id)
      expect(part.mesh.name).toBe(`${part.id}:mesh`)
    }
    first.dispose()
    second.dispose()
  })

  it('dispose 幂等：几何/材质各释放一次', () => {
    const assembly = createDemoAssembly()
    const geometrySpies = assembly.parts.map((part) => vi.spyOn(part.geometry, 'dispose'))
    const materialSpies = assembly.parts.map((part) => vi.spyOn(part.material, 'dispose'))
    assembly.dispose()
    assembly.dispose()
    for (const spy of [...geometrySpies, ...materialSpies]) expect(spy).toHaveBeenCalledTimes(1)
    expect(assembly.root.children).toHaveLength(0)
  })
})

describe('B1 几何 · 生成器前置校验', () => {
  it('拒绝非法截面与分段', () => {
    expect(() => revolveProfile([], false)).toThrow(RangeError)
    expect(() => revolveProfile([[0, 1]], false)).toThrow(RangeError)
    expect(() => revolveProfile([[0, -1], [1, 1]], false)).toThrow(RangeError)
    expect(() => revolveProfile([[0, 1], [1, 1]], false, 3)).toThrow(RangeError)
    expect(() => ringProfile(1, 10, 10)).toThrow(RangeError)
    expect(() => ringProfile(1, 0, 10)).toThrow(RangeError)
    expect(() => ringProfile(0, 10, 12)).toThrow(RangeError)
  })

  it('r=0 两端不产生零面积三角形，且顶点数是 9 段 × 2 环 × 65', () => {
    const data = partRevolveData(demoPart('builtin:shaft-demo:shaft'))
    expect(data.positions.length / 3).toBe(1170)
    for (let triangle = 0; triangle < data.indices.length; triangle += 3) {
      const area = triangleArea(
        new Float32Array(data.positions),
        data.indices[triangle],
        data.indices[triangle + 1],
        data.indices[triangle + 2],
      )
      expect(area).toBeGreaterThan(1e-9)
    }
    expect(shaftProfile()).toHaveLength(10)
    expect(ringProfile(1, 10, 14)).toEqual([[-1, 10], [-1, 14], [1, 14], [1, 10]])
  })
})

function triangleArea(positions: ArrayLike<number>, a: number, b: number, c: number): number {
  const [ax, ay, az] = [positions[a * 3], positions[a * 3 + 1], positions[a * 3 + 2]]
  const [bx, by, bz] = [positions[b * 3], positions[b * 3 + 1], positions[b * 3 + 2]]
  const [cx, cy, cz] = [positions[c * 3], positions[c * 3 + 1], positions[c * 3 + 2]]
  const u = [bx - ax, by - ay, bz - az]
  const v = [cx - ax, cy - ay, cz - az]
  const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
  return Math.hypot(cross[0], cross[1], cross[2]) / 2
}

function faceNormal(positions: ArrayLike<number>, a: number, b: number, c: number): [number, number, number] {
  const [ax, ay, az] = [positions[a * 3], positions[a * 3 + 1], positions[a * 3 + 2]]
  const [bx, by, bz] = [positions[b * 3], positions[b * 3 + 1], positions[b * 3 + 2]]
  const [cx, cy, cz] = [positions[c * 3], positions[c * 3 + 1], positions[c * 3 + 2]]
  const u = [bx - ax, by - ay, bz - az]
  const v = [cx - ax, cy - ay, cz - az]
  const cross: [number, number, number] = [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ]
  const length = Math.hypot(cross[0], cross[1], cross[2]) || 1
  return [cross[0] / length, cross[1] / length, cross[2] / length]
}
