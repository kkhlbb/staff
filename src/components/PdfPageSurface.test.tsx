// @vitest-environment jsdom
import { createRef, useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { getDocument } from 'pdfjs-dist'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildSyntheticPdf } from '../test/pdfFixtures'
import {
  normalizePdfRect,
  type PdfRect,
} from '../sources/pdfCoordinates'
import type { RenderViewport } from '../sources/render'
import { PdfPageSurface } from './PdfPageSurface'

const PAGE_WIDTH = 600
const PAGE_HEIGHT = 800
const SCALES = [1, 2] as const
const ROTATIONS = [0, 90, 180, 270] as const
const SAVED_RECT: PdfRect = [50, 60, 250, 460]

type LoadedPdf = Awaited<ReturnType<typeof getDocument>['promise']>

let pdfDocument: LoadedPdf
let loadingTask: ReturnType<typeof getDocument>

beforeAll(async () => {
  loadingTask = getDocument({
    data: buildSyntheticPdf({ pageCount: 2, width: PAGE_WIDTH, height: PAGE_HEIGHT }),
  })
  pdfDocument = await loadingTask.promise
})

afterAll(async () => {
  await loadingTask.destroy()
})

async function viewportFor(scale: number, rotation: number): Promise<RenderViewport> {
  const page = await pdfDocument.getPage(2)
  return page.getViewport({ scale, rotation })
}

/** 独立用四个角计算包围盒，不复用被测组件的 min/max 函数。 */
function expectedRect(viewport: RenderViewport, rectPdf: PdfRect) {
  const corners = [
    [rectPdf[0], rectPdf[1]],
    [rectPdf[2], rectPdf[1]],
    [rectPdf[0], rectPdf[3]],
    [rectPdf[2], rectPdf[3]],
  ].map(([x, y]) => viewport.convertToViewportPoint(x, y))
  const xs = corners.map((corner) => corner[0])
  const ys = corners.map((corner) => corner[1])
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  }
}

function styleOf(element: HTMLElement) {
  return {
    left: Number.parseFloat(element.style.left),
    top: Number.parseFloat(element.style.top),
    width: Number.parseFloat(element.style.width),
    height: Number.parseFloat(element.style.height),
  }
}

function stubStageBounds(
  stage: HTMLElement,
  bounds: { left: number; top: number; width: number; height: number },
): void {
  stage.getBoundingClientRect = () =>
    ({
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
      right: bounds.left + bounds.width,
      bottom: bounds.top + bounds.height,
      x: bounds.left,
      y: bounds.top,
      toJSON: () => ({}),
    }) as DOMRect
}

describe('PdfPageSurface：八组合高亮几何', () => {
  it('100%/200% × 0/90/180/270 度的已保存区域高亮与真实 viewport 几何一致', async () => {
    const maxErrors: number[] = []

    for (const rotation of ROTATIONS) {
      for (const scale of SCALES) {
        const viewport = await viewportFor(scale, rotation)
        const canvasRef = createRef<HTMLCanvasElement>()
        const { unmount } = render(
          <PdfPageSurface
            viewport={viewport}
            canvasRef={canvasRef}
            highlights={[
              { id: `binding-${rotation}-${scale}`, rectPdf: SAVED_RECT, label: '区域' },
            ]}
            ariaLabel={`第 2 页 ${rotation} 度 ${scale * 100}%`}
          />,
        )

        const highlight = screen.getByTitle('区域')
        const actual = styleOf(highlight)
        const expected = expectedRect(viewport, SAVED_RECT)
        // 页面容器尺寸必须等于 viewport CSS 尺寸，旋转 90/270 时宽高交换。
        const surface = screen.getByTestId('pdf-surface')
        expect(Number.parseFloat(surface.style.width)).toBeCloseTo(viewport.width, 9)
        expect(Number.parseFloat(surface.style.height)).toBeCloseTo(viewport.height, 9)

        for (const key of ['left', 'top', 'width', 'height'] as const) {
          const error = Math.abs(actual[key] - expected[key])
          maxErrors.push(error)
          expect(actual[key], `${rotation}° ${scale * 100}% ${key}`).toBeCloseTo(
            expected[key],
            6,
          )
        }
        // 高亮本身必须落在页面内。
        expect(actual.left).toBeGreaterThanOrEqual(-1e-6)
        expect(actual.top).toBeGreaterThanOrEqual(-1e-6)
        expect(actual.left + actual.width).toBeLessThanOrEqual(viewport.width + 1e-6)
        expect(actual.top + actual.height).toBeLessThanOrEqual(viewport.height + 1e-6)

        unmount()
      }
    }

    expect(maxErrors).toHaveLength(8 * 4)
    expect(Math.max(...maxErrors)).toBeLessThan(1e-6)
  })
})

describe('PdfPageSurface：SRC-01 八组合端到端几何（框选 → 存 PDF → 还原高亮）', () => {
  it('100%/200% × 0/90/180/270 度：指针框选保存的 PDF 矩形还原为同一 CSS 区域，误差 ≤2 CSS 像素', async () => {
    const rows: {
      rotation: number
      zoom: number
      maxError: number
      start: PdfRect
      stored: PdfRect
    }[] = []

    /**
     * 受控拖拽夹具：把 onDraftChange 回传的 PDF 矩形立即作为 draftRectPdf
     * 画回页面，模拟“保存后重新用 viewport 还原高亮”的完整路径。
     */
    function DragHarness({
      viewport,
      onEnd,
      rotation,
      zoom,
    }: {
      viewport: RenderViewport
      onEnd: (rect: PdfRect) => void
      rotation: number
      zoom: number
    }) {
      const canvasRef = createRef<HTMLCanvasElement>()
      const [draft, setDraft] = useState<PdfRect | null>(null)
      return (
        <PdfPageSurface
          viewport={viewport}
          canvasRef={canvasRef}
          draftRectPdf={draft}
          ariaLabel={`八组合 ${rotation} ${zoom}`}
          onDraftChange={(rect, phase) => {
            setDraft(rect)
            if (rect !== null && phase === 'end') {
              onEnd(rect)
            }
          }}
        />
      )
    }

    for (const rotation of ROTATIONS) {
      for (const scale of SCALES) {
        const viewport = await viewportFor(scale, rotation)
        const expected = expectedRect(viewport, SAVED_RECT)
        // 页面在窗口中有偏移，且按真实 CSS 比例映射；不能用 offsetX。
        const bounds = {
          left: 37,
          top: 19,
          width: viewport.width,
          height: viewport.height,
        }
        const toClientX = (viewportX: number) =>
          bounds.left + (viewportX * bounds.width) / viewport.width
        const toClientY = (viewportY: number) =>
          bounds.top + (viewportY * bounds.height) / viewport.height

        let stored: PdfRect | null = null
        const { unmount } = render(
          <DragHarness
            viewport={viewport}
            rotation={rotation}
            zoom={scale}
            onEnd={(rect) => {
              stored = rect
            }}
          />,
        )
        const stage = screen.getByTestId('pdf-surface')
        stubStageBounds(stage, bounds)

        fireEvent.mouseDown(stage, {
          button: 0,
          clientX: toClientX(expected.left),
          clientY: toClientY(expected.top),
        })
        fireEvent.mouseMove(window, {
          clientX: toClientX(expected.left + expected.width),
          clientY: toClientY(expected.top + expected.height),
        })
        fireEvent.mouseUp(window, {
          clientX: toClientX(expected.left + expected.width),
          clientY: toClientY(expected.top + expected.height),
        })

        expect(stored, `${rotation}° ${scale * 100}% 未产生 PDF 矩形`).not.toBeNull()
        if (stored === null) {
          throw new Error('框选没有产生 PDF 矩形')
        }
        const storedRect: PdfRect = stored

        // ① 保存的 PDF 矩形与原始区域一致（坐标空间不漂移）。
        const normalizedSaved = normalizePdfRect(SAVED_RECT)
        storedRect.forEach((value, index) => {
          expect(value, `${rotation}° ${scale * 100}% PDF 分量 ${index}`).toBeCloseTo(
            normalizedSaved[index],
            6,
          )
        })

        // ② 用保存值重新还原的高亮块与独立四角几何一致，误差按 CSS 像素计。
        const draft = screen.getByTestId('pdf-draft-rect')
        const actual = styleOf(draft)
        const errors = {
          left: Math.abs(actual.left - expected.left),
          top: Math.abs(actual.top - expected.top),
          width: Math.abs(actual.width - expected.width),
          height: Math.abs(actual.height - expected.height),
        }
        const maxError = Math.max(...Object.values(errors))
        rows.push({
          rotation,
          zoom: scale * 100,
          maxError,
          start: normalizedSaved,
          stored: storedRect,
        })
        expect(maxError, `${rotation}° ${scale * 100}% 最大误差`).toBeLessThanOrEqual(2)
        expect(actual.left).toBeGreaterThanOrEqual(-1e-6)
        expect(actual.top).toBeGreaterThanOrEqual(-1e-6)
        expect(actual.left + actual.width).toBeLessThanOrEqual(viewport.width + 1e-6)
        expect(actual.top + actual.height).toBeLessThanOrEqual(viewport.height + 1e-6)

        unmount()
      }
    }

    expect(rows).toHaveLength(8)
    // 证据表：运行 npm test 时输出，便于人工核对八组合误差。
    for (const row of rows) {
      console.log(
        `SRC-01 rotation=${row.rotation} zoom=${row.zoom}% maxError=${row.maxError.toExponential(3)} CSS px`,
      )
    }
    expect(Math.max(...rows.map((row) => row.maxError))).toBeLessThanOrEqual(2)
  })
})

describe('PdfPageSurface：鼠标框选坐标映射', () => {
  it('getBoundingClientRect 缩小到一半时，鼠标坐标按比例映射并保存为 PDF 点', async () => {
    const viewport = await viewportFor(1, 0)
    const canvasRef = createRef<HTMLCanvasElement>()
    const drafts: { rect: PdfRect | null; phase: string }[] = []
    render(
      <PdfPageSurface
        viewport={viewport}
        canvasRef={canvasRef}
        ariaLabel="框选测试页"
        onDraftChange={(rect, phase) => drafts.push({ rect, phase })}
      />,
    )

    const stage = screen.getByTestId('pdf-surface')
    // CSS 显示尺寸是 viewport 的一半：100,100 ~ 300,500 的客户区坐标
    // 应映射到 viewport 的 200,200 ~ 600,1000（后者超出页面，仅测试映射）。
    stubStageBounds(stage, { left: 100, top: 100, width: viewport.width / 2, height: viewport.height / 2 })

    fireEvent.mouseDown(stage, { button: 0, clientX: 200, clientY: 200 })
    fireEvent.mouseMove(window, { clientX: 250, clientY: 300 })
    fireEvent.mouseUp(window, { clientX: 300, clientY: 400 })

    const final = drafts.at(-1)
    expect(final?.phase).toBe('end')
    expect(final?.rect).not.toBeNull()
    if (final?.rect === null || final?.rect === undefined) {
      throw new Error('框选没有产生矩形')
    }

    const expectedStart = viewport.convertToPdfPoint(200, 200)
    const expectedEnd = viewport.convertToPdfPoint(400, 600)
    const expected = normalizePdfRect([
      expectedStart[0],
      expectedStart[1],
      expectedEnd[0],
      expectedEnd[1],
    ])
    final.rect.forEach((value, index) => {
      expect(value, `分量 ${index}`).toBeCloseTo(expected[index], 6)
    })
  })

  it('旋转 90 度、200% 缩放时仍用当前 viewport 转换，边界不依赖屏幕像素', async () => {
    const viewport = await viewportFor(2, 90)
    const canvasRef = createRef<HTMLCanvasElement>()
    const drafts: PdfRect[] = []
    render(
      <PdfPageSurface
        viewport={viewport}
        canvasRef={canvasRef}
        ariaLabel="旋转框选测试页"
        onDraftChange={(rect, phase) => {
          if (rect !== null && phase === 'end') {
            drafts.push(rect)
          }
        }}
      />,
    )

    const stage = screen.getByTestId('pdf-surface')
    stubStageBounds(stage, { left: 0, top: 0, width: viewport.width / 2, height: viewport.height / 2 })

    fireEvent.mouseDown(stage, { button: 0, clientX: 100, clientY: 80 })
    fireEvent.mouseUp(window, { clientX: 220, clientY: 260 })

    const expectedStart = viewport.convertToPdfPoint(200, 160)
    const expectedEnd = viewport.convertToPdfPoint(440, 520)
    const expected = normalizePdfRect([
      expectedStart[0],
      expectedStart[1],
      expectedEnd[0],
      expectedEnd[1],
    ])
    expect(drafts).toHaveLength(1)
    drafts[0].forEach((value, index) => {
      expect(value, `分量 ${index}`).toBeCloseTo(expected[index], 6)
    })
  })

  it('拖出页面边界会产生越界矩形，由保存层明确拒绝而不是静默裁剪', async () => {
    const viewport = await viewportFor(1, 0)
    const canvasRef = createRef<HTMLCanvasElement>()
    const drafts: PdfRect[] = []
    render(
      <PdfPageSurface
        viewport={viewport}
        canvasRef={canvasRef}
        ariaLabel="越界框选测试页"
        onDraftChange={(rect, phase) => {
          if (rect !== null && phase === 'end') {
            drafts.push(rect)
          }
        }}
      />,
    )

    const stage = screen.getByTestId('pdf-surface')
    stubStageBounds(stage, { left: 0, top: 0, width: viewport.width, height: viewport.height })

    fireEvent.mouseDown(stage, { button: 0, clientX: 100, clientY: 100 })
    // 客户区 y=900 超过 800 高的页面：映射后 PDF y 为负，属于越界。
    fireEvent.mouseUp(window, { clientX: 300, clientY: 900 })

    expect(drafts).toHaveLength(1)
    expect(drafts[0][1] >= 0 && drafts[0][3] <= PAGE_HEIGHT).toBe(false)
  })
})
