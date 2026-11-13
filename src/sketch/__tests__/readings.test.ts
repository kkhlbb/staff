import { describe, expect, it } from 'vitest'
import {
  checkSketchReading,
  checkSketchSubmission,
  sketchStatement,
  type SketchReadingDraft,
} from '../readings'

const reading = (symbol: string, nominalQ = 25_000): SketchReadingDraft => ({
  kind: 'dimension', symbol, nominalQ, upperDeviationQ: 21, lowerDeviationQ: 0, unit: 'mm',
})

describe('草图读数提交校验（红线：不推算、不夹带标定）', () => {
  it('合法读数通过', () => {
    expect(checkSketchReading(reading('φ25'))).toEqual({ ok: true })
    expect(checkSketchSubmission({
      readings: [reading('A')], boxes: [{ symbol: 'A', rect: { x: 0, y: 0, width: 10, height: 10 } }],
      sourceWidth: 100, sourceHeight: 100,
    })).toEqual({ ok: true })
  })

  it('拒绝任何像素→毫米的标定字段（mmPerPixel / scale / ratio 都整批拒绝）', () => {
    for (const extra of ['mmPerPixel', 'pixelsPerMm', 'scale', 'ratio']) {
      const polluted = { ...reading('A'), [extra]: 0.05 }
      const check = checkSketchReading(polluted)
      expect(check.ok).toBe(false)
      if (!check.ok) expect(check.message).toContain('不接受任何像素/比例参数')
    }
  })

  it('框选只接受整数原图像素矩形；越界、非整数、宽高 0 都拒绝', () => {
    const base = {
      readings: [reading('A')], sourceWidth: 100, sourceHeight: 80,
    }
    expect(checkSketchSubmission({ ...base, boxes: [{ symbol: 'A', rect: { x: 0, y: 0, width: 101, height: 10 } }] }).ok).toBe(false)
    expect(checkSketchSubmission({ ...base, boxes: [{ symbol: 'A', rect: { x: 0, y: 0, width: 10, height: 10 } }] }).ok).toBe(true)
    const fractional = checkSketchSubmission({ ...base, boxes: [{ symbol: 'A', rect: { x: 0.5, y: 0, width: 10, height: 10 } as never }] })
    expect(fractional.ok).toBe(false)
    const empty = checkSketchSubmission({ ...base, boxes: [{ symbol: 'A', rect: { x: 0, y: 0, width: 0, height: 10 } }] })
    expect(empty.ok).toBe(false)
  })

  it('不框选可以提交，但说明固定写“未框选，无位置”', () => {
    const draft = {
      readings: [reading('A')], boxes: [{ symbol: 'A', rect: null }], sourceWidth: 100, sourceHeight: 80,
    }
    expect(checkSketchSubmission(draft)).toEqual({ ok: true })
    expect(sketchStatement(1, 'A', false)).toContain('未框选，无位置')
    expect(sketchStatement(1, 'A', false)).not.toContain('第 1 个框选')
  })

  it('框选说明写明第 N 个框选且声明非图像识别', () => {
    expect(sketchStatement(3, 'φ25', true)).toBe('手绘草图读数：符号 φ25，第 3 个框选（用户输入，非图像识别）')
  })

  it('符号重复、框与读数错位、偏差倒置都拒绝', () => {
    expect(checkSketchSubmission({
      readings: [reading('A'), reading('A')],
      boxes: [{ symbol: 'A', rect: null }, { symbol: 'A', rect: null }],
      sourceWidth: 100, sourceHeight: 100,
    }).ok).toBe(false)
    expect(checkSketchSubmission({
      readings: [reading('A')], boxes: [{ symbol: 'B', rect: null }], sourceWidth: 100, sourceHeight: 100,
    }).ok).toBe(false)
    const inverted = { ...reading('A'), upperDeviationQ: -5, lowerDeviationQ: 10 }
    expect(checkSketchReading(inverted).ok).toBe(false)
  })
})
