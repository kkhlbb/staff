/**
 * 图纸预览（V3-C-03）：只渲染唯一 SVG 序列化器的输出。
 *
 * 选择覆盖层用 indigo 类；它不进入导出（导出调用 renderDrawingSvg 时不传
 * selectedAnnotationId）。zoom 只是容器 CSS 变换，不改变图纸数据或尺寸。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { escapeXml, renderDrawingSvg } from '../drawing/renderDrawingSvg'
import { uiDiagnosticText } from './uiIdentity'
import type { DrawingData } from '../drawing/types'
import './DrawingCanvas.css'

export interface DrawingCanvasProps {
  data: DrawingData | null
  selectedAnnotationId: string | null
  onSelectAnnotation: (annotationId: string, parameterId: string) => void
  zoom: number | 'fit'
  /** 无图纸时显示的原因。 */
  emptyReason?: string
  /** Presentation only; legacy blank frame versions must not expose their internal ID. */
  versionLabel?: string
}

export function DrawingCanvas(props: DrawingCanvasProps) {
  const host = useRef<HTMLDivElement>(null)
  const outer = useRef<HTMLDivElement>(null)
  const [fitScale, setFitScale] = useState(1)
  const markup = useMemo(() => {
    if (props.data === null) return ''
    const svg = renderDrawingSvg(props.data, { selectedAnnotationId: props.selectedAnnotationId })
    const version = props.data.frame.fields.version
    if (version.includes(props.data.revisionId) || /rev-[a-z0-9]-|[0-9a-f]{32,}/i.test(version)) {
      // Only replace the visible version cell. Metadata, persisted frame and fingerprint stay intact.
      return svg.replaceAll(`>${escapeXml(version)}<`, `>草稿 · ${escapeXml(props.versionLabel ?? '未命名版本')}<`)
    }
    return svg
  }, [props.data, props.selectedAnnotationId, props.versionLabel])

  useEffect(() => {
    // 选中变化后把焦点留在同一标注上，键盘用户不会丢失位置。
    if (props.selectedAnnotationId === null) return
    const node = host.current?.querySelector<SVGGElement>(
      `[data-annotation-id="${props.selectedAnnotationId}"]`,
    )
    node?.focus?.()
  }, [props.selectedAnnotationId])

  useEffect(() => {
    if (props.zoom !== 'fit') return
    const element = outer.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const rect = element.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      // A4 @96dpi：297mm=1122.52px、210mm=793.7px；减去画布内边距。
      const next = Math.min((rect.width - 32) / 1122.52, (rect.height - 32) / 793.7)
      setFitScale(Math.max(0.1, Math.min(2, next)))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [props.zoom, props.data])

  function pick(target: EventTarget | null): { annotationId: string; parameterId: string } | null {
    if (!(target instanceof Element)) return null
    const group = target.closest('[data-annotation-id]')
    if (group === null) return null
    const annotationId = group.getAttribute('data-annotation-id')
    const parameterId = group.getAttribute('data-parameter-id')
    if (annotationId === null || parameterId === null) return null
    return { annotationId, parameterId }
  }

  if (props.data === null) {
    return (
      <div className="drawing-canvas drawing-canvas--empty" aria-label="工程图预览">
        <p>{uiDiagnosticText(props.emptyReason ?? '尚无工程图')}</p>
      </div>
    )
  }

  const isFit = props.zoom === 'fit'
  const scale = isFit ? fitScale : props.zoom
  return (
    <div
      className={`drawing-canvas${isFit ? ' drawing-canvas--fit' : ''}`}
      aria-label="工程图预览"
      data-drawing-fingerprint={props.data.fingerprint}
      ref={outer}
    >
      <div
        className="drawing-canvas__paper"
        ref={host}
        style={{ transform: `scale(${scale})` }}
        onClick={(event) => {
          const picked = pick(event.target)
          if (picked !== null) props.onSelectAnnotation(picked.annotationId, picked.parameterId)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          const picked = pick(event.target)
          if (picked === null) return
          event.preventDefault()
          props.onSelectAnnotation(picked.annotationId, picked.parameterId)
        }}
        // 唯一的 SVG 序列化器输出；数据已在 main 校验，且经过安全白名单校验。
        dangerouslySetInnerHTML={{ __html: markup }}
      />
      <p className="drawing-canvas__hint">点击标注可定位原参数；按 Tab 选择、Enter 定位。</p>
    </div>
  )
}
