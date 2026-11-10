import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { defaultViewForAspect, framingDistanceForAspect } from './threeScene'
import { EXPLODED_BOUNDS } from './shaftDemo'

/** 用真实 PerspectiveCamera 投影爆炸包围盒 8 角，验证「不裁切 + 至少 10% 留白」。 */
function projectedExtent(aspect: number) {
  const view = defaultViewForAspect(aspect)
  const camera = new PerspectiveCamera(45, aspect, 0.5, 5000)
  camera.position.set(...view.position)
  camera.zoom = view.zoom
  camera.lookAt(new Vector3(...view.target))
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
  let maxAbsX = 0
  let maxAbsY = 0
  let maxZ = -Infinity
  let minZ = Infinity
  for (const x of [EXPLODED_BOUNDS.min[0], EXPLODED_BOUNDS.max[0]]) {
    for (const y of [EXPLODED_BOUNDS.min[1], EXPLODED_BOUNDS.max[1]]) {
      for (const z of [EXPLODED_BOUNDS.min[2], EXPLODED_BOUNDS.max[2]]) {
        const ndc = new Vector3(x, y, z).project(camera)
        maxAbsX = Math.max(maxAbsX, Math.abs(ndc.x))
        maxAbsY = Math.max(maxAbsY, Math.abs(ndc.y))
        maxZ = Math.max(maxZ, ndc.z)
        minZ = Math.min(minZ, ndc.z)
      }
    }
  }
  return { maxAbsX, maxAbsY, maxZ, minZ, distance: Math.hypot(...view.position) }
}

describe('B1 相机 framing（纯数学，无需 GPU）', () => {
  const aspects = [0.6, 1, 1.48, 1.87, 3.15, 4.2]

  it('爆炸包围盒 8 角全部在视锥内，且四周留白 ≥10%', () => {
    for (const aspect of aspects) {
      const extent = projectedExtent(aspect)
      // 1/1.1 ≈ 0.9091：留白 10% 意味着内容最多占满 90.9% 的半幅。
      expect(extent.maxAbsX).toBeLessThanOrEqual(1 / 1.1 + 1e-6)
      expect(extent.maxAbsY).toBeLessThanOrEqual(1 / 1.1 + 1e-6)
      // 近裁剪面之内、远裁剪面之前。
      expect(extent.maxZ).toBeLessThan(1)
      expect(extent.minZ).toBeGreaterThan(-1)
    }
  })

  it('至少一个方向贴到留白边界（不是随意拉远）', () => {
    for (const aspect of aspects) {
      const extent = projectedExtent(aspect)
      const tightest = Math.max(extent.maxAbsX, extent.maxAbsY)
      expect(tightest).toBeGreaterThan(1 / 1.1 - 0.02)
    }
  })

  it('比旧包围球拟合更紧凑（模型不会只占画布一小块）', () => {
    for (const aspect of aspects) {
      const view = defaultViewForAspect(aspect)
      const distance = Math.hypot(...view.position)
      const radius = Math.hypot(93, 22, 22)
      const vFov = (45 * Math.PI) / 180
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect)
      const sphereDistance = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.1
      expect(distance).toBeLessThan(sphereDistance)
      const direction = new Vector3(...view.position).normalize()
      expect(framingDistanceForAspect(aspect, direction)).toBeCloseTo(distance, 6)
    }
  })

  it('退化纵横比仍返回有限相机位置', () => {
    for (const aspect of [0, -1, Number.NaN, 0.01]) {
      const view = defaultViewForAspect(aspect)
      expect(view.position.every((value) => Number.isFinite(value))).toBe(true)
      expect(Math.hypot(...view.position)).toBeGreaterThan(0)
      expect(view.zoom).toBe(1)
      expect(view.target).toEqual([0, 0, 0])
    }
  })
})
