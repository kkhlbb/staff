import { describe, expect, it } from 'vitest'
import { Group, Line, Mesh, Object3D, BufferGeometry, LineBasicMaterial, MeshBasicMaterial } from 'three'
import {
  CLICK_MAX_DISTANCE_PX,
  canBeginPick,
  isClickGesture,
  nearestPartHit,
  ndcFromClient,
  partIdFromObject,
  resolveSelectionInput,
} from './selection'

function partGroup(partId: unknown, child?: Object3D) {
  const group = new Group()
  group.userData.partId = partId
  const mesh = child ?? new Mesh(new BufferGeometry(), new MeshBasicMaterial())
  group.add(mesh)
  return { group, mesh }
}

describe('B1 选择 · 从命中对象解析部件 ID', () => {
  it('沿父链解析，未知/缺失 partId 返回 null', () => {
    const { group, mesh } = partGroup('builtin:shaft-demo:spacer')
    expect(partIdFromObject(mesh)).toBe('builtin:shaft-demo:spacer')
    expect(partIdFromObject(group)).toBe('builtin:shaft-demo:spacer')
    const unknown = partGroup('builtin:shaft-demo:ghost')
    expect(partIdFromObject(unknown.mesh)).toBeNull()
    expect(partIdFromObject(new Object3D())).toBeNull()
    expect(partIdFromObject(null)).toBeNull()
    const line = new Line(new BufferGeometry(), new LineBasicMaterial())
    expect(partIdFromObject(line)).toBeNull()
  })

  it('取最近有效命中，过滤辅助对象与非法距离；同件多命中收敛', () => {
    const { group, mesh } = partGroup('builtin:shaft-demo:bearing-left')
    const other = partGroup('builtin:shaft-demo:spacer')
    const helper = new Line(new BufferGeometry(), new LineBasicMaterial())
    expect(nearestPartHit([])).toBeNull()
    expect(nearestPartHit([{ object: helper, distance: 1 }])).toBeNull()
    expect(nearestPartHit([
      { object: mesh, distance: 12 },
      { object: other.mesh, distance: 9 },
      { object: helper, distance: 2 },
    ])).toEqual({ partId: 'builtin:shaft-demo:spacer', distance: 9 })
    expect(nearestPartHit([
      { object: mesh, distance: 30 },
      { object: group, distance: 11 },
    ])).toEqual({ partId: 'builtin:shaft-demo:bearing-left', distance: 11 })
    expect(nearestPartHit([{ object: mesh, distance: Number.NaN }])).toBeNull()
    expect(nearestPartHit([{ object: mesh, distance: -1 }])).toBeNull()
  })

  it('选中值输入只接受注册集合', () => {
    expect(resolveSelectionInput('builtin:shaft-demo:shaft')).toBe('builtin:shaft-demo:shaft')
    expect(resolveSelectionInput('source:doc-1')).toBeNull()
    expect(resolveSelectionInput(undefined)).toBeNull()
  })
})

describe('B1 选择 · 指针几何', () => {
  it('NDC 用 canvas 矩形而非窗口尺寸，退化矩形返回 null', () => {
    const rect = { left: 100, top: 50, width: 400, height: 200 }
    expect(ndcFromClient(300, 150, rect)).toEqual({ x: 0, y: 0 })
    expect(ndcFromClient(100, 50, rect)).toEqual({ x: -1, y: 1 })
    expect(ndcFromClient(500, 250, rect)).toEqual({ x: 1, y: -1 })
    expect(ndcFromClient(0, 0, { left: 0, top: 0, width: 0, height: 200 })).toBeNull()
    expect(ndcFromClient(Number.NaN, 0, rect)).toBeNull()
  })

  it('偏移 canvas 上 DPR=1/2 的 CSS 坐标结果一致（不乘 DPR）', () => {
    const rect = { left: 240, top: 120, width: 800, height: 600 }
    // DPR 只影响 canvas.width/height，CSS 坐标换算与 DPR 无关。
    expect(ndcFromClient(640, 420, rect)).toEqual({ x: 0, y: 0 })
    expect(ndcFromClient(240, 720, rect)).toEqual({ x: -1, y: -1 })
  })

  it('4 px 内算单击，超过阈值或 pointercancel 路径不算', () => {
    expect(CLICK_MAX_DISTANCE_PX).toBe(4)
    expect(isClickGesture({ x: 10, y: 10 }, { x: 13, y: 12 })).toBe(true)
    expect(isClickGesture({ x: 10, y: 10 }, { x: 14, y: 10 })).toBe(true)
    expect(isClickGesture({ x: 10, y: 10 }, { x: 15, y: 10 })).toBe(false)
    expect(isClickGesture({ x: 10, y: 10 }, { x: Number.NaN, y: 10 })).toBe(false)
  })

  it('右键/中键/平移组合键/多指不进入选择', () => {
    expect(canBeginPick({ button: 0 })).toBe(true)
    expect(canBeginPick({ button: 2 })).toBe(false)
    expect(canBeginPick({ button: 1 })).toBe(false)
    expect(canBeginPick({ button: 0, shiftKey: true })).toBe(false)
    expect(canBeginPick({ button: 0, metaKey: true })).toBe(false)
    expect(canBeginPick({ button: 0, ctrlKey: true })).toBe(false)
    expect(canBeginPick({ button: 0, pointerType: 'touch' }, 2)).toBe(false)
    expect(canBeginPick({ button: 0, pointerType: 'touch' }, 1)).toBe(true)
  })
})
