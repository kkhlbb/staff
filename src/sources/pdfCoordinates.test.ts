// @vitest-environment node
import { getDocument } from 'pdfjs-dist'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildSyntheticPdf } from '../test/pdfFixtures'
import {
  normalizePdfPageBox,
  normalizePdfRect,
  pdfPointToViewportPoint,
  pdfRectToViewportRect,
  validatePageNumber,
  validatePdfRect,
  viewportPointToPdfPoint,
  viewportRectToPdfRect,
  type PdfPoint,
  type PdfRect,
} from './pdfCoordinates'

const PAGE_WIDTH = 600
const PAGE_HEIGHT = 800
const SCALES = [1, 2] as const
const ROTATIONS = [0, 90, 180, 270] as const
const ROUND_TRIP_TOLERANCE = 1e-9

type LoadedPdf = Awaited<ReturnType<typeof getDocument>['promise']>

let pdfDocument: LoadedPdf
let loadingTask: ReturnType<typeof getDocument>

beforeAll(async () => {
  loadingTask = getDocument({
    data: buildSyntheticPdf({
      pageCount: 2,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
    }),
  })
  pdfDocument = await loadingTask.promise
})

afterAll(async () => {
  await loadingTask.destroy()
})

async function viewportFor(scale: number, rotation: number) {
  const page = await pdfDocument.getPage(1)
  return page.getViewport({ scale, rotation })
}

function expectPointClose(actual: readonly number[], expected: PdfPoint) {
  expect(actual[0]).toBeCloseTo(expected[0], 9)
  expect(actual[1]).toBeCloseTo(expected[1], 9)
}

describe('PDF 坐标往返：真实 pdfjs-dist 6.5.438 viewport', () => {
  it('scale 1/2 × rotation 0/90/180/270 八组合 PDF→viewport→PDF 误差接近 0', async () => {
    const samplePoints: PdfPoint[] = [
      [37.5, 62.25],
      [250, 400],
      [599.5, 799.5],
    ]
    const maxErrors: number[] = []

    for (const rotation of ROTATIONS) {
      for (const scale of SCALES) {
        const viewport = await viewportFor(scale, rotation)
        // 缩放只改变尺寸；旋转 90/270 时交换 600×800。
        if (rotation === 90 || rotation === 270) {
          expect(viewport.width).toBe(PAGE_HEIGHT * scale)
          expect(viewport.height).toBe(PAGE_WIDTH * scale)
        } else {
          expect(viewport.width).toBe(PAGE_WIDTH * scale)
          expect(viewport.height).toBe(PAGE_HEIGHT * scale)
        }

        for (const point of samplePoints) {
          const viewportPoint = pdfPointToViewportPoint(viewport, point)
          const back = viewportPointToPdfPoint(viewport, viewportPoint)
          const error = Math.max(
            Math.abs(back[0] - point[0]),
            Math.abs(back[1] - point[1]),
          )
          maxErrors.push(error)
          expectPointClose(back, point)
        }
      }
    }

    expect(maxErrors.length).toBe(ROTATIONS.length * SCALES.length * samplePoints.length)
    expect(Math.max(...maxErrors)).toBeLessThan(ROUND_TRIP_TOLERANCE)
  })

  it('矩形两角顺序颠倒仍得到同一 viewport 矩形，且 90/270 度由 min/max 合成', async () => {
    const rectPdf: PdfRect = [50, 60, 250, 460]
    const reversed: PdfRect = [250, 460, 50, 60]

    for (const rotation of ROTATIONS) {
      for (const scale of SCALES) {
        const viewport = await viewportFor(scale, rotation)
        const rect = pdfRectToViewportRect(viewport, rectPdf)
        const rectReversed = pdfRectToViewportRect(viewport, reversed)
        expect(rectReversed).toEqual(rect)
        expect(rect[2]).toBeGreaterThan(rect[0])
        expect(rect[3]).toBeGreaterThan(rect[1])

        // 独立用四个角计算包围盒，验证“两对角点 + min/max”与真实几何一致。
        const corners = [
          [rectPdf[0], rectPdf[1]],
          [rectPdf[2], rectPdf[1]],
          [rectPdf[0], rectPdf[3]],
          [rectPdf[2], rectPdf[3]],
        ].map(([x, y]) => viewport.convertToViewportPoint(x, y))
        const expected = [
          Math.min(...corners.map((corner) => corner[0])),
          Math.min(...corners.map((corner) => corner[1])),
          Math.max(...corners.map((corner) => corner[0])),
          Math.max(...corners.map((corner) => corner[1])),
        ]
        rect.forEach((value, index) => {
          expect(value).toBeCloseTo(expected[index], 9)
        })

        // 回到 PDF 空间必须与规范化后的原始矩形一致，不因缩放/旋转漂移。
        const back = viewportRectToPdfRect(viewport, rect)
        const normalized = normalizePdfRect(rectPdf)
        back.forEach((value, index) => {
          expect(value).toBeCloseTo(normalized[index], 9)
        })
        const backReversed = viewportRectToPdfRect(viewport, rectReversed)
        expect(backReversed).toEqual(back)
      }
    }

    // 270 度时两个对角点的屏幕顺序确实颠倒：证明不能直接 x2-x1 / y2-y1。
    const viewport270 = await viewportFor(1, 270)
    const cornerA = viewport270.convertToViewportPoint(50, 60)
    const cornerB = viewport270.convertToViewportPoint(250, 460)
    expect(cornerA[0]).toBeGreaterThan(cornerB[0])
    expect(cornerA[1]).toBeGreaterThan(cornerB[1])
  })
})

describe('页码与矩形边界校验', () => {
  it('页码从 1 开始且不得超过总页数', () => {
    expect(validatePageNumber(1, 2)).toBeNull()
    expect(validatePageNumber(2, 2)).toBeNull()
    expect(validatePageNumber(0, 2)).toBe('页码从 1 开始')
    expect(validatePageNumber(-1, 2)).toBe('页码从 1 开始')
    expect(validatePageNumber(3, 2)).toContain('超出范围')
    expect(validatePageNumber(1.5, 2)).toContain('整数')
    expect(validatePageNumber(1, 0)).toContain('页数无效')
  })

  it('越界、零面积、非有限数值拒绝；反向角点与贴边矩形接受', () => {
    const pageBox = [0, 0, PAGE_WIDTH, PAGE_HEIGHT] as const
    expect(validatePdfRect([50, 60, 250, 460], pageBox)).toBeNull()
    expect(validatePdfRect([250, 460, 50, 60], pageBox)).toBeNull()
    expect(validatePdfRect([0, 0, PAGE_WIDTH, PAGE_HEIGHT], pageBox)).toBeNull()
    expect(validatePdfRect([0, 0, PAGE_WIDTH + 0.01, PAGE_HEIGHT], pageBox)).toBe(
      '矩形超出页面边界',
    )
    expect(validatePdfRect([-0.01, 0, 10, 10], pageBox)).toBe('矩形超出页面边界')
    expect(validatePdfRect([10, 10, 10, 20], pageBox)).toBe('矩形面积必须大于 0')
    expect(validatePdfRect([10, 10, 20, 10], pageBox)).toBe('矩形面积必须大于 0')
    expect(validatePdfRect([10, 10, Number.NaN, 20], pageBox)).toContain(
      '有限数值',
    )
    expect(validatePdfRect([10, 10, 20, Number.POSITIVE_INFINITY], pageBox)).toContain(
      '有限数值',
    )
  })

  it('非零原点页面按 page.view 四元组判断，不能假定原点为 [0,0]', () => {
    // 审查复现：page.view = [100,200,700,1000]，这个框在页面内合法。
    const pageBox = [100, 200, 700, 1000] as const
    expect(validatePdfRect([650, 900, 690, 990], pageBox)).toBeNull()
    expect(validatePdfRect([690, 990, 650, 900], pageBox)).toBeNull()
    // 贴住真实四边仍然合法。
    expect(validatePdfRect([100, 200, 110, 210], pageBox)).toBeNull()
    expect(validatePdfRect([690, 990, 700, 1000], pageBox)).toBeNull()
    // 越出真实边界（不是 0..width / 0..height）一律拒绝。
    expect(validatePdfRect([99.9, 900, 690, 990], pageBox)).toBe('矩形超出页面边界')
    expect(validatePdfRect([650, 199.9, 690, 990], pageBox)).toBe('矩形超出页面边界')
    expect(validatePdfRect([650, 900, 700.1, 990], pageBox)).toBe('矩形超出页面边界')
    expect(validatePdfRect([650, 900, 690, 1000.1], pageBox)).toBe('矩形超出页面边界')
    // 恰好 [0,0] 原点的框在非零原点页面上是越界的（否则说明仍在用 width/height）。
    expect(validatePdfRect([0, 0, 10, 10], pageBox)).toBe('矩形超出页面边界')
    // 页面框本身无效。
    expect(validatePdfRect([650, 900, 690, 990], [700, 200, 700, 1000])).toBe(
      '页面尺寸无效',
    )
    expect(
      validatePdfRect([650, 900, 690, 990], [100, 200, Number.NaN, 1000]),
    ).toBe('页面尺寸无效')
  })

  it('normalizePdfPageBox 接受反向边界框，拒绝零宽高与非有限值', () => {
    expect(normalizePdfPageBox([100, 200, 700, 1000])).toEqual([100, 200, 700, 1000])
    expect(normalizePdfPageBox([700, 1000, 100, 200])).toEqual([100, 200, 700, 1000])
    expect(normalizePdfPageBox([0, 0, 700, 1000])).toEqual([0, 0, 700, 1000])
    expect(normalizePdfPageBox([100, 200, 100, 1000])).toBeNull()
    expect(normalizePdfPageBox([100, 200, 700, 200])).toBeNull()
    expect(normalizePdfPageBox([100, 200, 700])).toBeNull()
    expect(normalizePdfPageBox([100, 200, 700, Number.POSITIVE_INFINITY])).toBeNull()
  })
})

describe('非零原点页面的真实 pdfjs viewport', () => {
  it('page.view 原样返回四元组，页面内合法框可往返且通过边界校验', async () => {
    const task = getDocument({
      data: buildSyntheticPdf({ mediaBox: [100, 200, 700, 1000] }),
    })
    try {
      const document = await task.promise
      const page = await document.getPage(1)
      expect(page.view).toEqual([100, 200, 700, 1000])

      const pageBox = normalizePdfPageBox(page.view)
      expect(pageBox).not.toBeNull()
      if (pageBox === null) {
        throw new Error('page.view 未被接受为有效页面框')
      }

      const viewport = page.getViewport({ scale: 1, rotation: 0 })
      // page.view 的左下角 (100,200) 对应 viewport 左下角 (0, 800)。
      expectPointClose(viewport.convertToViewportPoint(100, 200), [0, 800])
      expect(viewport.width).toBe(600)
      expect(viewport.height).toBe(800)

      const rectPdf: PdfRect = [650, 900, 690, 990]
      expect(validatePdfRect(rectPdf, pageBox)).toBeNull()
      const viewRect = pdfRectToViewportRect(viewport, rectPdf)
      const back = viewportRectToPdfRect(viewport, viewRect)
      back.forEach((value, index) => {
        expect(value).toBeCloseTo(rectPdf[index], 9)
      })
      expect(validatePdfRect(back as PdfRect, pageBox)).toBeNull()
    } finally {
      await task.destroy()
    }
  })
})
