// @vitest-environment node
import { getDocument } from 'pdfjs-dist'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildSyntheticPdf } from '../test/pdfFixtures'
import {
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
    const pageSize = [PAGE_WIDTH, PAGE_HEIGHT] as const
    expect(validatePdfRect([50, 60, 250, 460], pageSize)).toBeNull()
    expect(validatePdfRect([250, 460, 50, 60], pageSize)).toBeNull()
    expect(validatePdfRect([0, 0, PAGE_WIDTH, PAGE_HEIGHT], pageSize)).toBeNull()
    expect(validatePdfRect([0, 0, PAGE_WIDTH + 0.01, PAGE_HEIGHT], pageSize)).toBe(
      '矩形超出页面边界',
    )
    expect(validatePdfRect([-0.01, 0, 10, 10], pageSize)).toBe('矩形超出页面边界')
    expect(validatePdfRect([10, 10, 10, 20], pageSize)).toBe('矩形面积必须大于 0')
    expect(validatePdfRect([10, 10, 20, 10], pageSize)).toBe('矩形面积必须大于 0')
    expect(validatePdfRect([10, 10, Number.NaN, 20], pageSize)).toContain(
      '有限数值',
    )
    expect(validatePdfRect([10, 10, 20, Number.POSITIVE_INFINITY], pageSize)).toContain(
      '有限数值',
    )
  })
})
