import { useState, type InputHTMLAttributes } from 'react'
import { formatMm, tryParseMm } from '../domain/units'

/** 编辑中保留原文；失焦只规范显示，不改草稿、输入精度或持久化字段。 */
export function MmInput({ value, onFocus, onBlur, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const [editing, setEditing] = useState(false)
  const parsed = typeof value === 'string' ? tryParseMm(value) : null
  const displayed = !editing && parsed?.ok ? formatMm(parsed.value) : value
  return <input {...props} value={displayed}
    onFocus={event => { setEditing(true); onFocus?.(event) }}
    onBlur={event => { setEditing(false); onBlur?.(event) }} />
}
