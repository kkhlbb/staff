/**
 * 草图读数提交载荷（纯数据校验，主进程与界面共用）。
 *
 * 红线在类型与校验里落实：
 * - 载荷只接受“用户输入的 mm 读数 + 原图矩形”，**不存在**任何像素→毫米的系数、
 *   比例尺或自动量取字段；多一个字段就整批拒绝（strict）；
 * - rect 必须是原图像素整数且在图像范围内；
 * - 允许不框选（rect=null），但必须带固定占位说明“未框选，无位置”。
 */
import { sourceRectInBounds, type ImagePixelRect } from './selection'

export interface SketchReadingDraft {
  readonly kind: 'dimension'
  readonly symbol: string
  readonly nominalQ: number
  readonly upperDeviationQ: number
  readonly lowerDeviationQ: number
  readonly unit: 'mm'
}

export interface SketchBoxDraft {
  readonly symbol: string
  /** 原图像素矩形；null = 未框选。 */
  readonly rect: ImagePixelRect | null
}

export interface SketchSubmissionDraft {
  readonly readings: readonly SketchReadingDraft[]
  readonly boxes: readonly SketchBoxDraft[]
  readonly sourceWidth: number
  readonly sourceHeight: number
}

export type SketchSubmissionCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string }

const SYMBOL_PATTERN = /^[\p{L}][\p{L}\p{N}_]{0,19}$/u

/** 载荷里允许出现的全部键；任何额外键（例如 mmPerPixel / scale）直接拒绝。 */
const READING_KEYS = ['kind', 'symbol', 'nominalQ', 'upperDeviationQ', 'lowerDeviationQ', 'unit'] as const
const BOX_KEYS = ['symbol', 'rect'] as const
const RECT_KEYS = ['x', 'y', 'width', 'height'] as const

function hasExactKeys(value: unknown, keys: readonly string[]): boolean {
  if (typeof value !== 'object' || value === null) return false
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => actual.includes(key))
}

function isSafeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

/** 单条读数的格式校验；不换算、不补值。 */
export function checkSketchReading(reading: unknown): SketchSubmissionCheck {
  if (!hasExactKeys(reading, READING_KEYS)) {
    return { ok: false, message: '读数只接受符号、基本尺寸、上下偏差与单位；不接受任何像素/比例参数' }
  }
  const value = reading as Record<string, unknown>
  if (value.kind !== 'dimension' || value.unit !== 'mm') {
    return { ok: false, message: '读数必须是 mm 尺寸' }
  }
  if (typeof value.symbol !== 'string' || !SYMBOL_PATTERN.test(value.symbol)) {
    return { ok: false, message: '读数符号需以字母开头，最多 20 个字母/数字/下划线' }
  }
  if (!isSafeInt(value.nominalQ) || !isSafeInt(value.upperDeviationQ) || !isSafeInt(value.lowerDeviationQ)) {
    return { ok: false, message: '读数必须是整数 q（mm×1000），由用户输入' }
  }
  if (value.nominalQ <= 0) return { ok: false, message: '基本尺寸必须大于 0' }
  if (value.lowerDeviationQ > value.upperDeviationQ) {
    return { ok: false, message: '下偏差不能大于上偏差' }
  }
  return { ok: true }
}

/** 整批校验：读数与框一一对应、符号唯一、rect 在原图内。 */
export function checkSketchSubmission(draft: SketchSubmissionDraft): SketchSubmissionCheck {
  if (draft.readings.length < 1 || draft.readings.length > 20) {
    return { ok: false, message: '一次提交 1..20 条读数' }
  }
  if (draft.readings.length !== draft.boxes.length) {
    return { ok: false, message: '每条读数都要有对应的框选记录（或显式“未框选”）' }
  }
  const symbols = new Set<string>()
  for (const [index, reading] of draft.readings.entries()) {
    const readingCheck = checkSketchReading(reading)
    if (!readingCheck.ok) return { ok: false, message: `第 ${index + 1} 条：${readingCheck.message}` }
    if (symbols.has(reading.symbol)) return { ok: false, message: `符号 ${reading.symbol} 重复` }
    symbols.add(reading.symbol)
    const box = draft.boxes[index] as SketchBoxDraft
    if (!hasExactKeys(box, BOX_KEYS) || box.symbol !== reading.symbol) {
      return { ok: false, message: `第 ${index + 1} 条读数的框选记录与符号不一致` }
    }
    if (box.rect !== null) {
      if (!hasExactKeys(box.rect, RECT_KEYS)) {
        return { ok: false, message: '框选只保存原图像素矩形（x/y/width/height）' }
      }
      if (!sourceRectInBounds(box.rect, draft.sourceWidth, draft.sourceHeight)) {
        return { ok: false, message: `第 ${index + 1} 个框选超出原图范围或不是整数像素` }
      }
    }
  }
  return { ok: true }
}

/**
 * 存进候选的说明文本。**不冒充“用户原话”**：这是界面记录的事实，
 * 说明这条数出自图片的哪一个框选；未框选时固定写“未框选，无位置”。
 */
export function sketchStatement(
  index: number,
  symbol: string,
  boxed: boolean,
): string {
  return boxed
    ? `手绘草图读数：符号 ${symbol}，第 ${index} 个框选（用户输入，非图像识别）`
    : `手绘草图读数：符号 ${symbol}，未框选，无位置（用户输入，非图像识别）`
}
