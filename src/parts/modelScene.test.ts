// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelSceneError, createModelScene, type ModelSceneOptions } from './modelScene'

afterEach(() => vi.restoreAllMocks())

function options(canvas: HTMLCanvasElement): ModelSceneOptions {
  return {
    canvas,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    bounds: { min: [0, 0, 0], max: [1, 1, 0] },
    view: null,
    selected: false,
    onSelect: () => undefined,
    onViewChange: () => undefined,
    onPerformance: () => undefined,
    onContextLost: () => undefined,
  }
}

describe('B2 · createModelScene 的上下文有效性检查', () => {
  it('复用已丢失上下文的 canvas：明确报“上下文已失效”，不把 three 的 alpha TypeError 暴露给界面', () => {
    const canvas = document.createElement('canvas')
    // 浏览器语义：调用过 loseContext() 的 canvas，再次 getContext 返回同一个已丢上下文，
    // getContextAttributes() 为 null。
    vi.spyOn(canvas, 'getContext').mockReturnValue({
      getContextAttributes: () => null,
    } as unknown as WebGL2RenderingContext)

    let caught: unknown = null
    try {
      createModelScene(options(canvas))
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(ModelSceneError)
    const failure = caught as ModelSceneError
    expect(failure.code).toBe('WEBGL2_UNAVAILABLE')
    expect(failure.message).toContain('上下文已失效')
    expect(failure.message).toContain('需要新建 canvas')
    expect(failure.message).not.toContain('alpha')
  })
})
