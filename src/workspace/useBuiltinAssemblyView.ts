import { useState } from 'react'
import { normalizeViewState, type DemoViewState } from '../parts/shaftDemo'

/**
 * 内置轴系示例的会话作用域 UI 状态（爆炸值、相机 pose、是否开启）。
 *
 * 只读示例不写项目文件：这些状态不触发 stageDraft、不产生 dirty、不进历史。
 * 选中对象不在这里——树与画布共用 DesktopWorkspace 的单一 selection，
 * 避免出现两个互相 effect 同步的选中真相。
 */
export interface BuiltinAssemblyView {
  /** 当前会话是否已开启示例视图。 */
  active: boolean
  /** 为指定会话开启（新建示例会话成功后传新 sessionId）；未传则用当前会话。 */
  activate: (sessionId?: string | null) => void
  deactivate: () => void
  explodeT: number
  setExplodeT: (value: number) => void
  view: DemoViewState | null
  setView: (value: unknown) => void
}

interface ScopedState {
  sessionId: string | null
  explodeT: number
  view: DemoViewState | null
}

const BLANK = { explodeT: 0, view: null } as const

export function useBuiltinAssemblyView(sessionId: string | null): BuiltinAssemblyView {
  const [armedSession, setArmedSession] = useState<string | null>(null)
  const [state, setState] = useState<ScopedState>({ sessionId: null, ...BLANK })

  // 会话切换（新建/打开/恢复/关闭）：清空爆炸值与相机，旧 3D 实例随组件卸载释放。
  if (state.sessionId !== sessionId) setState({ sessionId, ...BLANK })

  const active = armedSession !== null && armedSession === sessionId

  return {
    active,
    activate: (target) => {
      const next = target === undefined ? sessionId : target
      if (next) setArmedSession(next)
    },
    deactivate: () => { setArmedSession(null) },
    explodeT: state.explodeT,
    setExplodeT: (value) => {
      if (!Number.isFinite(value)) return
      setState((previous) => ({ ...previous, explodeT: Math.min(1, Math.max(0, value)) }))
    },
    view: state.view,
    setView: (value) => {
      const next = normalizeViewState(value)
      if (!next) return
      setState((previous) => ({ ...previous, view: next }))
    },
  }
}
