import { describe, expect, it } from 'vitest'
import {
  FRAME_OVER_BUDGET_MS,
  FRAME_SLOW_MEAN_MS,
  FRAME_TARGET_P95_MS,
  FrameMeter,
  summarizeIntervalsMs,
} from './frameStats'

describe('B1 帧统计 · 分布汇总', () => {
  it('阈值常量与卡片一致，不在此处放宽', () => {
    expect(FRAME_TARGET_P95_MS).toBe(33.3)
    expect(FRAME_OVER_BUDGET_MS).toBe(50)
    expect(FRAME_SLOW_MEAN_MS).toBeCloseTo(33.3333, 3)
  })

  it('空输入返回全 0，不编造成绩', () => {
    expect(summarizeIntervalsMs([])).toEqual({
      count: 0, mean: 0, p50: 0, p95: 0, max: 0, overBudgetCount: 0, overBudgetRatio: 0,
    })
  })

  it('p95/均值/超预算占比按原始样本计算（nearest-rank）', () => {
    // 20 个样本里 1 个 40 ms：nearest-rank p95 取第 ceil(0.95*20)=19 个 → 16.7，
    // 单个离群点不改变 p95，但仍体现在 max 与均值里。
    const intervals = [...Array(19).fill(16.7), 40]
    const summary = summarizeIntervalsMs(intervals)
    expect(summary.count).toBe(20)
    expect(summary.max).toBe(40)
    expect(summary.p95).toBe(16.7)
    expect(summary.p50).toBe(16.7)
    expect(summary.overBudgetCount).toBe(0)
    expect(summary.mean).toBeCloseTo((19 * 16.7 + 40) / 20, 6)
    // 半数慢帧时 p95 必须反映慢区间，不能被平均掉。
    expect(summarizeIntervalsMs([...Array(10).fill(16.7), ...Array(10).fill(40)]).p95).toBe(40)
    const slow = [...Array(19).fill(16.7), 120]
    expect(summarizeIntervalsMs(slow).overBudgetRatio).toBeCloseTo(0.05, 6)
    expect(summarizeIntervalsMs([...Array(18).fill(16.7), 120, 130]).overBudgetRatio).toBeCloseTo(0.1, 6)
  })

  it('过滤非有限/负值样本', () => {
    expect(summarizeIntervalsMs([Number.NaN, -4, 16]).count).toBe(1)
  })
})

function feed(meter: FrameMeter, from: number, until: number, step: number): ReturnType<FrameMeter['noteFrame']>[] {
  const verdicts: ReturnType<FrameMeter['noteFrame']>[] = []
  for (let now = from; now <= until; now += step) verdicts.push(meter.noteFrame(now))
  return verdicts
}

describe('B1 帧统计 · 降级判定（注入时钟）', () => {
  it('稳定 60 fps 不降级', () => {
    const meter = new FrameMeter()
    meter.setActive(true)
    const verdicts = feed(meter, 0, 6000, 16.7)
    expect(verdicts.every((verdict) => verdict === 'ok')).toBe(true)
    expect(meter.degradedTo).toBeNull()
    expect(meter.summary().p95).toBeLessThanOrEqual(33.3)
  })

  it('连续两个 2 s 慢窗口后降 DPR 一次，随后仍慢才提示性能不足', () => {
    const meter = new FrameMeter()
    meter.setActive(true)
    const first = feed(meter, 0, 2000, 60)
    expect(first.filter((verdict) => verdict === 'degrade')).toHaveLength(0)
    const afterSecond = feed(meter, 2060, 4100, 60)
    expect(afterSecond.filter((verdict) => verdict === 'degrade')).toHaveLength(1)
    expect(meter.degradedTo).toBe(1)
    expect(meter.insufficient).toBe(false)
    const later = feed(meter, 4160, 8200, 60)
    expect(later.filter((verdict) => verdict === 'warn')).toHaveLength(1)
    expect(meter.insufficient).toBe(true)
    // 降级只发生一次。
    expect(feed(meter, 8260, 14000, 60).filter((verdict) => verdict === 'degrade')).toHaveLength(0)
  })

  it('单窗口慢不降级（避免一次卡顿就降精度）', () => {
    const meter = new FrameMeter()
    meter.setActive(true)
    feed(meter, 0, 2000, 60)
    feed(meter, 2060, 3600, 16.7)
    expect(meter.degradedTo).toBeNull()
  })

  it('空闲与隐藏期不计入：setActive(false)/setVisible(false) 丢弃开放窗口', () => {
    const meter = new FrameMeter()
    meter.setActive(true)
    feed(meter, 0, 1000, 60)
    const interactionSamples = meter.summary().count
    expect(interactionSamples).toBe(16)
    meter.setActive(false)
    // 空闲阶段的按需帧不得被当成慢帧累计。
    for (let now = 1100; now <= 20000; now += 900) expect(meter.noteFrame(now)).toBe('ok')
    expect(meter.summary().count).toBe(interactionSamples)
    expect(meter.degradedTo).toBeNull()
    meter.setActive(true)
    feed(meter, 20050, 20600, 16.7)
    const visibleSamples = meter.summary().count
    meter.setVisible(false)
    for (let now = 20700; now <= 30000; now += 500) expect(meter.noteFrame(now)).toBe('ok')
    expect(meter.summary().count).toBe(visibleSamples)
    expect(meter.degradedTo).toBeNull()
    meter.setVisible(true)
  })

  it('reset 清空历史与降级状态', () => {
    const meter = new FrameMeter()
    meter.setActive(true)
    feed(meter, 0, 9000, 60)
    expect(meter.degradedTo).toBe(1)
    meter.reset()
    expect(meter.degradedTo).toBeNull()
    expect(meter.insufficient).toBe(false)
    expect(meter.summary().count).toBe(0)
  })
})
