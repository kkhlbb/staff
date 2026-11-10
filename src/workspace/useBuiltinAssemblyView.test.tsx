// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useBuiltinAssemblyView } from './useBuiltinAssemblyView'

const VIEW = { position: [10, 20, 30] as const, target: [0, 0, 0] as const, zoom: 1 }

describe('B1 · 示例视图的会话作用域状态', () => {
  it('默认未开启，activate 后绑定当前会话', () => {
    const { result, rerender } = renderHook(({ id }) => useBuiltinAssemblyView(id), { initialProps: { id: 'session-a' } })
    expect(result.current.active).toBe(false)
    act(() => result.current.activate())
    expect(result.current.active).toBe(true)
    rerender({ id: 'session-a' })
    expect(result.current.active).toBe(true)
  })

  it('会话变化时自动解除并清空爆炸值/相机，不串场', () => {
    const { result, rerender } = renderHook(({ id }) => useBuiltinAssemblyView(id), { initialProps: { id: 'session-a' } })
    act(() => result.current.activate())
    act(() => result.current.setExplodeT(0.5))
    act(() => result.current.setView(VIEW))
    expect(result.current.explodeT).toBe(0.5)
    rerender({ id: 'session-b' })
    expect(result.current.active).toBe(false)
    expect(result.current.explodeT).toBe(0)
    expect(result.current.view).toBeNull()
  })

  it('新建示例会话后可为目标 sessionId 开启（不等当前会话切换）', () => {
    const { result, rerender } = renderHook(({ id }) => useBuiltinAssemblyView(id), { initialProps: { id: 'session-a' } })
    act(() => result.current.activate('session-demo'))
    expect(result.current.active).toBe(false)
    rerender({ id: 'session-demo' })
    expect(result.current.active).toBe(true)
  })

  it('爆炸值 clamp 且拒绝非有限数', () => {
    const { result } = renderHook(() => useBuiltinAssemblyView('session-a'))
    act(() => result.current.setExplodeT(2))
    expect(result.current.explodeT).toBe(1)
    act(() => result.current.setExplodeT(-1))
    expect(result.current.explodeT).toBe(0)
    act(() => result.current.setExplodeT(Number.NaN))
    expect(result.current.explodeT).toBe(0)
  })

  it('非法相机 pose 被拒绝并保留旧值', () => {
    const { result } = renderHook(() => useBuiltinAssemblyView('session-a'))
    act(() => result.current.setView(VIEW))
    act(() => result.current.setView({ position: [1, 2], target: [0, 0, 0], zoom: 1 }))
    expect(result.current.view).toEqual({ position: [10, 20, 30], target: [0, 0, 0], zoom: 1 })
    act(() => result.current.setView({ position: [1, 2, 3], target: [0, 0, 0], zoom: 0 }))
    expect(result.current.view?.zoom).toBe(1)
  })

  it('deactivate 关闭示例但不影响其他会话状态', () => {
    const { result } = renderHook(() => useBuiltinAssemblyView('session-a'))
    act(() => result.current.activate())
    act(() => result.current.deactivate())
    expect(result.current.active).toBe(false)
  })
})
