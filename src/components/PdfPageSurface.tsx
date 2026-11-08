/**
 * PDF 页面交互层：canvas 由父组件绘制，这一层只负责
 * - 把鼠标事件按 getBoundingClientRect() 比例映射到 viewport CSS 坐标；
 * - 用 viewport.convertToPdfPoint 把框选区域写成 PDF 坐标；
 * - 把已保存的 PDF 矩形用 convertToViewportPoint 还原成高亮块。
 *
 * 缩放/旋转只改变 viewport，不迁移已存数据；旋转 90/270 度时用 min/max
 * 合成包围盒，不假设两个角点在屏幕上仍然递增。
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import {
  normalizePdfRect,
  pdfRectToViewportRect,
  type PdfPoint,
  type PdfRect,
} from '../sources/pdfCoordinates'
import type { RenderViewport } from '../sources/render'

export interface PdfPageHighlight {
  id: string
  rectPdf: PdfRect
  label: string
  /** 当前选中组成环的绑定使用强调样式。 */
  active?: boolean
}

export interface PdfPageSurfaceProps {
  /**
   * 当前页 viewport。null 表示页面正在切换/绘制：保留 canvas 节点供下一次
   * 绘制使用，但整层隐藏且不可框选；绝不沿用上一页的 viewport。
   */
  viewport: RenderViewport | null
  canvasRef: RefObject<HTMLCanvasElement | null>
  highlights?: readonly PdfPageHighlight[]
  draftRectPdf?: PdfRect | null
  onDraftChange?: (rect: PdfRect | null, phase: 'move' | 'end') => void
  ariaLabel: string
  disabled?: boolean
}

interface RectStyle {
  left: number
  top: number
  width: number
  height: number
}

function toStyle(viewport: RenderViewport, rectPdf: PdfRect): RectStyle {
  const [left, top, right, bottom] = pdfRectToViewportRect(viewport, rectPdf)
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  }
}

function rectFromPoints(start: PdfPoint, end: PdfPoint): PdfRect {
  return normalizePdfRect([start[0], start[1], end[0], end[1]])
}

export function PdfPageSurface({
  viewport,
  canvasRef,
  highlights = [],
  draftRectPdf = null,
  onDraftChange,
  ariaLabel,
  disabled = false,
}: PdfPageSurfaceProps) {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const startRef = useRef<PdfPoint | null>(null)
  const latestRectRef = useRef<PdfRect | null>(null)
  const [dragging, setDragging] = useState(false)

  /** 客户区坐标 → viewport CSS 坐标；CSS 尺寸与 canvas 内部像素无关。 */
  const viewportPointFromEvent = useCallback(
    (event: Pick<MouseEvent, 'clientX' | 'clientY'>): PdfPoint | null => {
      if (viewport === null) {
        return null
      }
      const stage = stageRef.current
      if (stage === null) {
        return null
      }
      const bounds = stage.getBoundingClientRect()
      if (bounds.width <= 0 || bounds.height <= 0) {
        return null
      }
      const cssX = (event.clientX - bounds.left) * (viewport.width / bounds.width)
      const cssY = (event.clientY - bounds.top) * (viewport.height / bounds.height)
      const [pdfX, pdfY] = viewport.convertToPdfPoint(cssX, cssY)
      if (!Number.isFinite(pdfX) || !Number.isFinite(pdfY)) {
        return null
      }
      return [pdfX, pdfY]
    },
    [viewport],
  )

  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (
      disabled ||
      viewport === null ||
      onDraftChange === undefined ||
      event.button !== 0
    ) {
      return
    }
    const point = viewportPointFromEvent(event)
    if (point === null) {
      return
    }
    event.preventDefault()
    startRef.current = point
    latestRectRef.current = null
    setDragging(true)
  }

  useEffect(() => {
    if (!dragging) {
      return
    }

    const handleMove = (event: MouseEvent): void => {
      const start = startRef.current
      if (start === null) {
        return
      }
      const point = viewportPointFromEvent(event)
      if (point === null) {
        return
      }
      const rect = rectFromPoints(start, point)
      latestRectRef.current = rect
      onDraftChange?.(rect, 'move')
    }

    const handleUp = (event: MouseEvent): void => {
      const start = startRef.current
      startRef.current = null
      setDragging(false)
      if (start === null) {
        return
      }
      const point = viewportPointFromEvent(event)
      if (point === null) {
        onDraftChange?.(null, 'end')
        return
      }
      const rect = rectFromPoints(start, point)
      latestRectRef.current = rect
      onDraftChange?.(rect, 'end')
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
    // viewport 变化时重新绑定监听器，保证映射使用当前缩放/旋转。
  }, [dragging, viewportPointFromEvent, onDraftChange])

  return (
    <div
      ref={stageRef}
      className={dragging ? 'pdf-surface pdf-surface--dragging' : 'pdf-surface'}
      style={
        viewport === null
          ? { display: 'none' }
          : { width: viewport.width, height: viewport.height }
      }
      data-testid={viewport === null ? undefined : 'pdf-surface'}
      onMouseDown={handleMouseDown}
      role="presentation"
    >
      <canvas
        ref={canvasRef}
        className="pdf-surface__canvas"
        style={
          viewport === null
            ? undefined
            : { width: viewport.width, height: viewport.height }
        }
        role="img"
        aria-label={ariaLabel}
      />
      {viewport === null ? null : (
        <div className="pdf-surface__overlay" aria-hidden={highlights.length === 0}>
          {highlights.map((highlight) => {
            const style = toStyle(viewport, highlight.rectPdf)
            return (
              <div
                key={highlight.id}
                className={
                  highlight.active
                    ? 'pdf-highlight pdf-highlight--active'
                    : 'pdf-highlight'
                }
                data-binding-id={highlight.id}
                data-rect-left={style.left}
                data-rect-top={style.top}
                data-rect-width={style.width}
                data-rect-height={style.height}
                style={style}
                title={highlight.label}
              >
                <span className="pdf-highlight__label">{highlight.label}</span>
              </div>
            )
          })}
          {draftRectPdf === null ? null : (
            <div
              className="pdf-highlight pdf-highlight--draft"
              data-testid="pdf-draft-rect"
              style={toStyle(viewport, draftRectPdf)}
            />
          )}
        </div>
      )}
    </div>
  )
}
