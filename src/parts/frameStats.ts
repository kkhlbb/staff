/**
 * 帧间隔统计与降级判定（纯逻辑 + 注入时钟，便于单测）。
 *
 * 任务卡 V3-B1 §3.5：
 * - 只统计「有效交互窗口」内的帧间隔，排除空闲按需帧与隐藏期；
 * - p95 ≤ 33.3 ms、>50 ms 帧占比 ≤ 5% 是目标（本函数只报告，不放宽也不伪造）；
 * - 连续两个 2 s 有效窗口均值 > 33.3 ms → 降 DPR 到 1 并提示；
 * - 降级后仍持续 > 50 ms → 提示性能不足，但保留手动交互与其他标签。
 */

/** 30 fps 对应的帧间隔。 */
export const FRAME_SLOW_MEAN_MS = 1000 / 30
export const FRAME_TARGET_P95_MS = 33.3
export const FRAME_OVER_BUDGET_MS = 50
export const FRAME_OVER_BUDGET_RATIO = 0.05
export const FRAME_WINDOW_MS = 2000

export interface FrameSummary {
  count: number
  mean: number
  p50: number
  p95: number
  max: number
  overBudgetCount: number
  overBudgetRatio: number
}

const EMPTY_SUMMARY: FrameSummary = { count: 0, mean: 0, p50: 0, p95: 0, max: 0, overBudgetCount: 0, overBudgetRatio: 0 }

function percentile(sorted: readonly number[], ratio: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(ratio * sorted.length) - 1))
  return sorted[index]
}

/** 汇总帧间隔（ms）。空输入返回全 0，不编造成绩。 */
export function summarizeIntervalsMs(intervals: readonly number[]): FrameSummary {
  const valid = intervals.filter((value) => Number.isFinite(value) && value >= 0)
  if (valid.length === 0) return EMPTY_SUMMARY
  const sorted = [...valid].sort((a, b) => a - b)
  const sum = valid.reduce((total, value) => total + value, 0)
  const overBudgetCount = valid.filter((value) => value > FRAME_OVER_BUDGET_MS).length
  return {
    count: valid.length,
    mean: sum / valid.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1],
    overBudgetCount,
    overBudgetRatio: overBudgetCount / valid.length,
  }
}

export type FrameVerdict = 'ok' | 'degrade' | 'warn'

export interface FrameMeterOptions {
  windowMs?: number
  slowMeanMs?: number
  warnMeanMs?: number
}

/**
 * 有效交互窗口内的帧间隔采样器。
 * 调用方在 pointer down/drag/wheel 开始时 setActive(true)，结束时 setActive(false)；
 * 每次真正的渲染帧调用 noteFrame(now)，返回值指示是否需要降级。
 */
export class FrameMeter {
  private readonly windowMs: number
  private readonly slowMeanMs: number
  private readonly warnMeanMs: number
  private active = false
  private visible = true
  private lastFrame: number | null = null
  private windowStart: number | null = null
  private windowIntervals: number[] = []
  private windowMeans: number[] = []
  private degraded = false
  private warned = false
  private readonly all: number[] = []

  constructor(options: FrameMeterOptions = {}) {
    this.windowMs = options.windowMs ?? FRAME_WINDOW_MS
    this.slowMeanMs = options.slowMeanMs ?? FRAME_SLOW_MEAN_MS
    this.warnMeanMs = options.warnMeanMs ?? FRAME_OVER_BUDGET_MS
  }

  setVisible(visible: boolean): void {
    this.visible = visible
    if (!visible) this.dropOpenWindow()
  }

  setActive(active: boolean): void {
    this.active = active
    if (!active) this.dropOpenWindow()
  }

  get degradedTo(): number | null {
    return this.degraded ? 1 : null
  }

  get insufficient(): boolean {
    return this.warned
  }

  /** 已关闭窗口的平均帧间隔（证据/调试用）。 */
  get closedWindowMeans(): readonly number[] {
    return this.windowMeans
  }

  noteFrame(now: number): FrameVerdict {
    if (!this.visible || !this.active || !Number.isFinite(now)) {
      this.lastFrame = null
      return 'ok'
    }
    if (this.lastFrame === null) {
      this.lastFrame = now
      if (this.windowStart === null) this.windowStart = now
      return 'ok'
    }
    const delta = now - this.lastFrame
    this.lastFrame = now
    if (!Number.isFinite(delta) || delta <= 0) return 'ok'
    this.all.push(delta)
    if (this.windowStart === null) this.windowStart = now
    this.windowIntervals.push(delta)
    if (now - this.windowStart < this.windowMs) return 'ok'
    return this.closeWindow(now)
  }

  private closeWindow(now: number): FrameVerdict {
    const intervals = this.windowIntervals
    this.windowIntervals = []
    this.windowStart = now
    if (intervals.length < 2) return 'ok'
    const mean = intervals.reduce((total, value) => total + value, 0) / intervals.length
    this.windowMeans.push(mean)
    const lastTwo = this.windowMeans.slice(-2)
    if (lastTwo.length < 2) return 'ok'
    const bothSlow = lastTwo.every((value) => value > this.slowMeanMs)
    if (!bothSlow) return 'ok'
    if (!this.degraded) {
      this.degraded = true
      // 降级后重新积累窗口，避免同一段慢帧同时触发「性能不足」。
      this.windowMeans = []
      return 'degrade'
    }
    const bothVerySlow = lastTwo.every((value) => value > this.warnMeanMs)
    if (bothVerySlow && !this.warned) {
      this.warned = true
      return 'warn'
    }
    return 'ok'
  }

  private dropOpenWindow(): void {
    this.lastFrame = null
    this.windowIntervals = []
    this.windowStart = null
  }

  summary(): FrameSummary {
    return summarizeIntervalsMs(this.all)
  }

  reset(): void {
    this.active = false
    this.visible = true
    this.lastFrame = null
    this.windowStart = null
    this.windowIntervals = []
    this.windowMeans = []
    this.degraded = false
    this.warned = false
    this.all.length = 0
  }
}
