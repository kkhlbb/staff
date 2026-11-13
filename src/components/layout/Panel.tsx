import type { CSSProperties, HTMLAttributes } from 'react'
import './layout.css'

type Props = HTMLAttributes<HTMLElement> & {
  as?: 'section' | 'aside'
  minWidth?: CSSProperties['minWidth']
  collapsed?: boolean
  overflow?: 'scroll' | 'hidden'
}

/** 纯容器。hidden 仅供显式折叠态；工作区展开内容一律 scroll。 */
export function Panel({ as: Tag = 'section', minWidth, collapsed = false, overflow = 'scroll', className = '', style, ...props }: Props) {
  return <Tag {...props} hidden={collapsed || props.hidden} className={`layout-panel ${className}`} style={{ minWidth, overflow: overflow === 'scroll' ? 'auto' : 'hidden', ...style }} />
}
