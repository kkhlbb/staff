import type { HTMLAttributes } from 'react'
import './layout.css'

/** 明确局部滚动边界；不裁切、不维护业务状态。 */
export function ScrollArea({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`layout-scroll-area ${className}`} />
}
