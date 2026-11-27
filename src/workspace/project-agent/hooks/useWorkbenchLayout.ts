import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import {
  clampSidebarWidth,
  persistSidebarWidth,
  readStoredSidebarWidth,
} from '../workbenchTheme'

export interface UseWorkbenchLayoutOptions {
  readonly bodyRef: RefObject<HTMLDivElement | null>
  readonly onShortcutImportStep: () => void
  readonly onShortcutNewBlock: () => void
  readonly onShortcutOpenProject: () => void
  readonly onShortcutSave: () => void
  readonly onShortcutOpenSettings: () => void
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  return false
}

export function useWorkbenchLayout({
  bodyRef,
  onShortcutImportStep,
  onShortcutNewBlock,
  onShortcutOpenProject,
  onShortcutSave,
  onShortcutOpenSettings,
}: UseWorkbenchLayoutOptions) {
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => readStoredSidebarWidth())
  const [isResizing, setIsResizing] = useState(false)
  const latestWidthRef = useRef(sidebarWidth)

  useEffect(() => {
    latestWidthRef.current = sidebarWidth
  }, [sidebarWidth])

  const handleResizerPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsResizing(true)
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // jsdom / synthetic pointer events may not support capture
      }
    }
  }, [])

  const handleResizerPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!isResizing) return
      const rect = bodyRef.current?.getBoundingClientRect()
      const rightEdge = rect && rect.width > 0 ? rect.right : window.innerWidth
      const next = clampSidebarWidth(rightEdge - event.clientX)
      latestWidthRef.current = next
      setSidebarWidth(next)
    },
    [bodyRef, isResizing],
  )

  const handleResizerPointerUp = useCallback(() => {
    if (!isResizing) return
    setIsResizing(false)
    persistSidebarWidth(latestWidthRef.current)
  }, [isResizing])

  useEffect(() => {
    if (!isResizing) return
    const onMove = (event: PointerEvent) => {
      const rect = bodyRef.current?.getBoundingClientRect()
      const rightEdge = rect && rect.width > 0 ? rect.right : window.innerWidth
      const next = clampSidebarWidth(rightEdge - event.clientX)
      latestWidthRef.current = next
      setSidebarWidth(next)
    }
    const onUp = () => {
      setIsResizing(false)
      persistSidebarWidth(latestWidthRef.current)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [bodyRef, isResizing])

  const handleResizerKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setSidebarWidth((prev) => {
        const next = clampSidebarWidth(prev + 20)
        persistSidebarWidth(next)
        return next
      })
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      setSidebarWidth((prev) => {
        const next = clampSidebarWidth(prev - 20)
        persistSidebarWidth(next)
        return next
      })
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.altKey || event.shiftKey) return
      const mod = event.ctrlKey || event.metaKey
      if (!mod) return

      const key = event.key.toLowerCase()
      const editing = isEditableElement(event.target)

      if (key === 's') {
        event.preventDefault()
        onShortcutSave()
        return
      }
      if (key === ',') {
        event.preventDefault()
        onShortcutOpenSettings()
        return
      }
      if (editing) return

      if (key === 'n') {
        event.preventDefault()
        onShortcutNewBlock()
      } else if (key === 'o') {
        event.preventDefault()
        onShortcutOpenProject()
      } else if (key === 'i') {
        event.preventDefault()
        onShortcutImportStep()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    onShortcutImportStep,
    onShortcutNewBlock,
    onShortcutOpenProject,
    onShortcutSave,
    onShortcutOpenSettings,
  ])

  return {
    sidebarWidth,
    isResizing,
    handleResizerPointerDown,
    handleResizerPointerMove,
    handleResizerPointerUp,
    handleResizerKeyDown,
  }
}
