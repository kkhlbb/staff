// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Vector3 } from 'three'
import {
  ModelSceneError,
  createModelScene,
  defaultModelView,
  framingDistanceForBounds,
  type ModelBounds,
  type ModelSceneOptions,
} from './modelScene'
import type { DemoViewState } from './shaftDemo'

afterEach(() => vi.restoreAllMocks())

function options(canvas: HTMLCanvasElement): ModelSceneOptions {
  return {
    canvas,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    bounds: { min: [0, 0, 0], max: [1, 1, 0] },
    view: null,
    selected: false,
    onSelect: () => undefined,
    onViewChange: () => undefined,
    onPerformance: () => undefined,
    onContextLost: () => undefined,
  }
}

describe('B2 · createModelScene 的上下文有效性检查', () => {
  it('复用已丢失上下文的 canvas：明确报“上下文已失效”，不把 three 的 alpha TypeError 暴露给界面', () => {
    const canvas = document.createElement('canvas')
    // 浏览器语义：调用过 loseContext() 的 canvas，再次 getContext 返回同一个已丢上下文，
    // getContextAttributes() 为 null。
    vi.spyOn(canvas, 'getContext').mockReturnValue({
      getContextAttributes: () => null,
    } as unknown as WebGL2RenderingContext)

    let caught: unknown = null
    try {
      createModelScene(options(canvas))
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(ModelSceneError)
    const failure = caught as ModelSceneError
    expect(failure.code).toBe('WEBGL2_UNAVAILABLE')
    expect(failure.message).toContain('上下文已失效')
    expect(failure.message).toContain('需要新建 canvas')
    expect(failure.message).not.toContain('alpha')
  })
})

/**
 * 替换模型的真实样本（本机 STL，只取包围盒）：
 * - pr2-head-pan-binary.stl：1000 面，span ≈ 0.25 / 0.32 / 0.14；
 * - slotted-disk-ascii.stl：288 面扁平圆盘，span ≈ 1.00 / 1.00 / 0.22；
 * - nasa-wrench.stl：14,564 面，span ≈ 33.1 / 114.2 / 26.0。
 * 三者相差最多约 350 倍，足以暴露“沿用旧相机距离”的问题。
 */
const PR2: ModelBounds = { min: [-0.111, -0.161, -0.065], max: [0.143, 0.161, 0.077] }
const DISK: ModelBounds = { min: [-0.5, -0.5, -0.18], max: [0.5, 0.5, 0.04] }
const WRENCH: ModelBounds = { min: [0, 0, 0], max: [33.126, 114.228, 26] }
const ASPECT = 1.5
const FOV = 45
const MARGIN = 1.1
const DIRECTION = new Vector3(0.85, 0.42, 1).normalize()

/**
 * 独立于 framingDistanceForBounds 的验收：把包围盒 8 角点按给定相机投影，
 * 返回最坏 |u|/半宽、|v|/半高（>1 即出画）与落在相机背后的角点数。
 * 这不是重算一遍 fit，而是拿 fit 产出的相机位姿做正向投影核对。
 */
function projectBounds(bounds: ModelBounds, view: DemoViewState, aspect: number) {
  const tanV = Math.tan((FOV * Math.PI) / 360)
  const tanH = tanV * aspect
  const position = new Vector3(...view.position)
  const target = new Vector3(...view.target)
  const forward = target.clone().sub(position).normalize()
  const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize()
  const up = new Vector3().crossVectors(right, forward).normalize()
  let worstU = 0
  let worstV = 0
  let behind = 0
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) {
        const corner = new Vector3(x, y, z).sub(position)
        const depth = corner.dot(forward)
        if (depth <= 0) {
          behind += 1
          continue
        }
        worstU = Math.max(worstU, Math.abs(corner.dot(right)) / (depth * tanH))
        worstV = Math.max(worstV, Math.abs(corner.dot(up)) / (depth * tanV))
      }
    }
  }
  return { worstU, worstV, behind, distance: position.distanceTo(target) }
}

describe('B2 · 替换模型后按新包围盒重新 fit', () => {
  it('fit 距离随新几何尺寸成比例，而不是沿用上一个模型的距离', () => {
    const disk = framingDistanceForBounds(DISK, ASPECT, DIRECTION)
    const wrench = framingDistanceForBounds(WRENCH, ASPECT, DIRECTION)
    const pr2 = framingDistanceForBounds(PR2, ASPECT, DIRECTION)

    // 实测（FOV 45°、aspect 1.5、方向 (0.85,0.42,1)）：圆盘 ≈ 1.83，扳手 ≈ 164.82，
    // pr2 ≈ 0.60（与本机 STL 包围盒一致）。
    expect(disk).toBeCloseTo(1.83, 1)
    expect(wrench).toBeCloseTo(164.82, 0)
    expect(pr2).toBeCloseTo(0.6, 2)
    // 扳手/圆盘 ≈ 90 倍：距离必须跟着几何走，固定距离不可能同时装下两者。
    expect(wrench / disk).toBeCloseTo(90.04, 0)
    expect(disk / pr2).toBeCloseTo(3.06, 1)
  })

  it('默认视角以包围盒中心为目标，距离等于同一 fit 计算的结果（首建与重置共用）', () => {
    for (const bounds of [DISK, WRENCH]) {
      const view = defaultModelView(bounds, ASPECT)
      const expected = framingDistanceForBounds(bounds, ASPECT, DIRECTION)
      const center = [
        (bounds.min[0] + bounds.max[0]) / 2,
        (bounds.min[1] + bounds.max[1]) / 2,
        (bounds.min[2] + bounds.max[2]) / 2,
      ]
      expect(view.target).toEqual(center)
      const projected = projectBounds(bounds, view, ASPECT)
      expect(projected.distance).toBeCloseTo(expected, 6)
      // 8 角点全部在视锥内，且保留 10% 留白（1/1.1 ≈ 0.91）。
      expect(projected.behind).toBe(0)
      expect(projected.worstU).toBeLessThanOrEqual(1 / MARGIN + 1e-9)
      expect(projected.worstV).toBeLessThanOrEqual(1 / MARGIN + 1e-9)
      // 贴边而不虚留空白：最坏方向至少用掉 85% 的可用半幅。
      expect(Math.max(projected.worstU, projected.worstV)).toBeGreaterThan(0.85)
    }
  })

  it('沿用上一个模型的相机距离会出画（复现 bug），按新包围盒 fit 后完整可见', () => {
    // 1) pr2 → 圆盘：pr2 的 fit 距离 0.56 对 1.0 的圆盘太小，角点远超画面。
    const staleForDisk = projectBounds(DISK, defaultModelView(PR2, ASPECT), ASPECT)
    expect(Math.max(staleForDisk.worstU, staleForDisk.worstV)).toBeGreaterThan(1)

    // 2) 圆盘 → 扳手：1.87 的相机距离落在扳手内部，至少 4 个角点在相机背后，
    //    用户看到的就是“一个被过度放大的面”。
    const staleForWrench = projectBounds(WRENCH, defaultModelView(DISK, ASPECT), ASPECT)
    expect(staleForWrench.behind).toBeGreaterThan(0)

    // 3) 换成新几何自己的 fit 后，两种模型都完整入画。
    for (const bounds of [DISK, WRENCH]) {
      const fitted = projectBounds(bounds, defaultModelView(bounds, ASPECT), ASPECT)
      expect(fitted.behind).toBe(0)
      expect(fitted.worstU).toBeLessThanOrEqual(1 / MARGIN + 1e-9)
      expect(fitted.worstV).toBeLessThanOrEqual(1 / MARGIN + 1e-9)
    }
  })
})
