import { useRef, type HTMLAttributes } from 'react'
import './layout.css'

/** 轨道由调用者以比例/可拖动尺寸指定，中央轨道始终吸收剩余空间。 */
export function SplitPane({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`layout-split-pane ${className}`} />
}

/** 只调整布局，不维护工程数据或计算状态。 */
export function Splitter({ label, value, min, max, onChange, horizontal = false, reverse = false }: {
  label: string; value: number; min: number; max: number; onChange: (value: number) => void
  horizontal?: boolean; reverse?: boolean
}) {
  const drag = useRef<{ start: number; value: number } | null>(null)
  const clamp = (next: number) => onChange(Math.max(min, Math.min(max, next)))
  return <div className={`desktop-workspace__splitter${horizontal ? ' desktop-workspace__splitter--horizontal' : ''}`}
    role="separator" tabIndex={0} aria-label={label} aria-orientation={horizontal ? 'horizontal' : 'vertical'}
    aria-valuemin={min} aria-valuemax={max} aria-valuenow={value}
    onKeyDown={event => {
      const delta = event.key === (horizontal ? 'ArrowDown' : 'ArrowRight') ? 8
        : event.key === (horizontal ? 'ArrowUp' : 'ArrowLeft') ? -8 : 0
      if (delta || event.key === 'Home' || event.key === 'End') {
        event.preventDefault()
        clamp(event.key === 'Home' ? min : event.key === 'End' ? max : value + delta * (reverse ? -1 : 1))
      }
    }}
    onPointerDown={event => {
      drag.current = { start: horizontal ? event.clientY : event.clientX, value }
      event.currentTarget.setPointerCapture(event.pointerId)
    }}
    onPointerMove={event => {
      if (drag.current) clamp(drag.current.value + ((horizontal ? event.clientY : event.clientX) - drag.current.start) * (reverse ? -1 : 1))
    }}
    onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} />
}

