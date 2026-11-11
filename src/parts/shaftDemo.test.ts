import { describe, expect, it } from 'vitest'
import {
  ASSEMBLED_BOUNDS,
  BUILTIN_PART_IDS,
  DEMO_PARTS,
  EXPLODED_BOUNDS,
  SPACER_SOURCE_Q,
  baseCenterX,
  cloneViewState,
  demoPart,
  explodePosition,
  explodeTFromSlider,
  explodeX,
  isBuiltinPartId,
  normalizeSelectedPartId,
  normalizeViewState,
  partPropertyRows,
  qToMm,
  type BuiltinPartId,
} from './shaftDemo'

/** 期望值全部硬编码自任务卡 §3.2/§3.4 的夹具表，不从被测函数取值自证。 */
const IDS = [
  'builtin:shaft-demo:shaft',
  'builtin:shaft-demo:bearing-left',
  'builtin:shaft-demo:spacer',
  'builtin:shaft-demo:bearing-right',
  'builtin:shaft-demo:retaining-ring',
] as const

describe('B1 几何夹具 · ID 与单位', () => {
  it('注册 ID 精确等于卡片常量集合，顺序固定且无重复', () => {
    expect([...BUILTIN_PART_IDS]).toEqual([...IDS])
    expect(new Set(BUILTIN_PART_IDS).size).toBe(5)
    expect(DEMO_PARTS.map((part) => part.id)).toEqual([...IDS])
  })

  it('每个 ID 是注册常量而非下标/uuid/名称派生', () => {
    for (const id of IDS) {
      expect(isBuiltinPartId(id)).toBe(true)
      expect(demoPart(id).id).toBe(id)
      expect(id.startsWith('builtin:shaft-demo:')).toBe(true)
    }
    expect(isBuiltinPartId('builtin:shaft-demo:nope')).toBe(false)
    expect(isBuiltinPartId('term:t-h')).toBe(false)
    expect(isBuiltinPartId(0)).toBe(false)
  })

  it('隔套源尺寸用 q 整数解析，只在显示边界换成 mm', () => {
    expect(SPACER_SOURCE_Q.innerDiameterQ).toBe(200000)
    expect(SPACER_SOURCE_Q.outerDiameterQ).toBe(320000)
    expect(SPACER_SOURCE_Q.lengthQ).toBe(120000)
    expect(qToMm(SPACER_SOURCE_Q.innerDiameterQ)).toBe(20)
    expect(qToMm(SPACER_SOURCE_Q.outerDiameterQ)).toBe(32)
    expect(qToMm(SPACER_SOURCE_Q.lengthQ)).toBe(12)
    const spacer = demoPart('builtin:shaft-demo:spacer')
    expect(spacer.shape.kind).toBe('ring')
    if (spacer.shape.kind === 'ring') {
      expect(spacer.shape.innerRadius).toBe(10)
      expect(spacer.shape.outerRadius).toBe(16)
    }
    expect(spacer.xRange).toEqual([-6, 6])
    expect(() => qToMm(20.5)).toThrow(RangeError)
  })

  it('装配区间与爆炸位移与卡片表一致', () => {
    const expected: Record<BuiltinPartId, { range: [number, number]; explode: number }> = {
      'builtin:shaft-demo:shaft': { range: [-45, 45], explode: 0 },
      'builtin:shaft-demo:bearing-left': { range: [-26, -6], explode: -24 },
      'builtin:shaft-demo:spacer': { range: [-6, 6], explode: 0 },
      'builtin:shaft-demo:bearing-right': { range: [6, 26], explode: 24 },
      'builtin:shaft-demo:retaining-ring': { range: [-29, -27], explode: -48 },
    }
    for (const id of IDS) {
      expect(demoPart(id).xRange).toEqual(expected[id].range)
      expect(demoPart(id).explodeX).toBe(expected[id].explode)
    }
    expect(ASSEMBLED_BOUNDS).toEqual({ min: [-45, -22, -22], max: [45, 22, 22] })
    expect(EXPLODED_BOUNDS).toEqual({ min: [-93, -22, -22], max: [93, 22, 22] })
  })

  it('装配中心：左轴承 -16、挡圈 -28、右轴承 16、轴与隔套 0', () => {
    expect(baseCenterX('builtin:shaft-demo:shaft')).toBe(0)
    expect(baseCenterX('builtin:shaft-demo:bearing-left')).toBe(-16)
    expect(baseCenterX('builtin:shaft-demo:spacer')).toBe(0)
    expect(baseCenterX('builtin:shaft-demo:bearing-right')).toBe(16)
    expect(baseCenterX('builtin:shaft-demo:retaining-ring')).toBe(-28)
  })

  it('爆炸插值 t=0/0.5/1 的 X 中心与 Y/Z 不变', () => {
    const centers = (t: number) => IDS.map((id) => explodeX(id, t))
    expect(centers(0)).toEqual([0, -16, 0, 16, -28])
    expect(centers(0.5)).toEqual([0, -28, 0, 28, -52])
    expect(centers(1)).toEqual([0, -40, 0, 40, -76])
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      for (const id of IDS) {
        const position = explodePosition(id, t)
        expect(position.y).toBe(0)
        expect(position.z).toBe(0)
        expect(position.x).toBe(explodeX(id, t))
      }
    }
  })

  it('越界 clamp，非有限数拒绝', () => {
    expect(explodeX('builtin:shaft-demo:bearing-left', -3)).toBe(-16)
    expect(explodeX('builtin:shaft-demo:bearing-left', 42)).toBe(-40)
    expect(() => explodeX('builtin:shaft-demo:bearing-left', Number.NaN)).toThrow(TypeError)
    expect(() => explodeX('builtin:shaft-demo:bearing-left', Number.POSITIVE_INFINITY)).toThrow(TypeError)
  })

  it('连续往返 100 次无累计漂移', () => {
    for (const id of IDS) {
      for (let round = 0; round < 100; round += 1) {
        expect(explodeX(id, 1)).toBe(baseCenterX(id) + demoPart(id).explodeX)
        expect(explodeX(id, 0)).toBe(baseCenterX(id))
        expect(explodeX(id, 0.37)).toBeCloseTo(baseCenterX(id) + 0.37 * demoPart(id).explodeX, 10)
      }
    }
  })

  it('选中值归一化：未知值安全清空', () => {
    expect(normalizeSelectedPartId('builtin:shaft-demo:spacer')).toBe('builtin:shaft-demo:spacer')
    expect(normalizeSelectedPartId('term:t-h')).toBeNull()
    expect(normalizeSelectedPartId('')).toBeNull()
    expect(normalizeSelectedPartId(null)).toBeNull()
    expect(normalizeSelectedPartId(42)).toBeNull()
  })

  it('属性行只读且明确未关联尺寸链', () => {
    const rows = partPropertyRows('builtin:shaft-demo:spacer')
    const map = new Map(rows)
    expect(map.get('内径（源 q）')).toBe('20.000 mm')
    expect(map.get('外径（源 q）')).toBe('32.000 mm')
    expect(map.get('长度（源 q）')).toBe('12.000 mm')
    expect(map.get('内半径')).toBe('10.000 mm')
    expect(map.get('外半径')).toBe('16.000 mm')
    expect(map.get('关联尺寸链')).toContain('未关联')
    expect(rows.some(([key]) => key.includes('S'))).toBe(false)
  })

  it('爆炸位移：当前值随 t 变化，静态上限单独成行（不再用 0 冒充当前值）', () => {
    const at = (id: BuiltinPartId, t?: number) => new Map(partPropertyRows(id, t))
    const fixed = at('builtin:shaft-demo:spacer', 1)
    expect(fixed.get('爆炸位移（当前）')).toBe('0.000 mm（X）')
    expect(fixed.get('设计最大位移（上限）')).toBe('0.000 mm（X）（装配基准，不参与爆炸）')
    expect(at('builtin:shaft-demo:shaft', 1).get('爆炸位移（当前）')).toBe('0.000 mm（X）')
    expect(at('builtin:shaft-demo:bearing-left', 0).get('爆炸位移（当前）')).toBe('0.000 mm（X）')
    expect(at('builtin:shaft-demo:bearing-left', 0.5).get('爆炸位移（当前）')).toBe('-12.000 mm（X）')
    expect(at('builtin:shaft-demo:bearing-left', 1).get('爆炸位移（当前）')).toBe('-24.000 mm（X）')
    expect(at('builtin:shaft-demo:bearing-left', 1).get('设计最大位移（上限）')).toBe('-24.000 mm（X）')
    expect(at('builtin:shaft-demo:bearing-right', 1).get('爆炸位移（当前）')).toBe('+24.000 mm（X）')
    expect(at('builtin:shaft-demo:retaining-ring', 1).get('爆炸位移（当前）')).toBe('-48.000 mm（X）')
    // t 超界按 clamp 处理，与渲染层一致
    expect(at('builtin:shaft-demo:bearing-right', 3).get('爆炸位移（当前）')).toBe('+24.000 mm（X）')
    expect(at('builtin:shaft-demo:bearing-right', -1).get('爆炸位移（当前）')).toBe('0.000 mm（X）')
  })
})

describe('B1 相机 pose 与滑条换算', () => {
  it('pose 只含有限数值，非法整体拒绝', () => {
    const view = { position: [10, 20, 30] as const, target: [0, 0, 0] as const, zoom: 1 }
    expect(normalizeViewState(view)).toEqual({ position: [10, 20, 30], target: [0, 0, 0], zoom: 1 })
    expect(normalizeViewState({ ...view, zoom: Number.NaN })).toBeNull()
    expect(normalizeViewState({ ...view, zoom: 0 })).toBeNull()
    expect(normalizeViewState({ ...view, position: [1, 2] })).toBeNull()
    expect(normalizeViewState({ ...view, target: [0, Number.POSITIVE_INFINITY, 0] })).toBeNull()
    expect(normalizeViewState(null)).toBeNull()
    const cloned = cloneViewState({ position: [1, 2, 3], target: [4, 5, 6], zoom: 2 })
    expect(cloned).toEqual({ position: [1, 2, 3], target: [4, 5, 6], zoom: 2 })
    expect(cloned.position).not.toBe(view.position)
  })

  it('滑条百分比换算：clamp 且非有限数返回 null', () => {
    expect(explodeTFromSlider('0')).toBe(0)
    expect(explodeTFromSlider('50')).toBe(0.5)
    expect(explodeTFromSlider('100')).toBe(1)
    expect(explodeTFromSlider(150)).toBe(1)
    expect(explodeTFromSlider('-10')).toBe(0)
    expect(explodeTFromSlider('abc')).toBeNull()
    expect(explodeTFromSlider(Number.NaN)).toBeNull()
  })
})
