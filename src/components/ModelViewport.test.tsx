// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ModelViewport, type ModelRenderGeometry } from './ModelViewport'
import type { ModelSceneHandle, ModelSceneOptions } from '../parts/modelScene'

/**
 * 用伪场景模块复刻真实浏览器的上下文语义：
 * dispose(true) == loseContext()，同一个 canvas 再次建场时 getContext 仍是已丢的旧上下文，
 * getContextAttributes() 为 null，three 抛 "Cannot read properties of null (reading 'alpha')"。
 * 这里不冒充 GPU 渲染，只验证容器是否在每次建场时换新 canvas。
 */
function createFakeScene() {
  const lost = new WeakSet<HTMLCanvasElement>()
  const creations: Array<{ canvas: HTMLCanvasElement; ok: boolean; options: ModelSceneOptions }> = []
  const disposed: HTMLCanvasElement[] = []
  let failuresLeft = 0

  const loader = async () => {
    const createModelScene = (options: ModelSceneOptions): ModelSceneHandle => {
      const canvas = options.canvas
      if (lost.has(canvas)) {
        creations.push({ canvas, ok: false, options })
        const error = new Error("WebGLRenderer 初始化失败（Cannot read properties of null (reading 'alpha')）")
        throw Object.assign(error, { name: 'ModelSceneError', code: 'RENDERER_INIT_FAILED' })
      }
      if (failuresLeft > 0) {
        failuresLeft -= 1
        creations.push({ canvas, ok: false, options })
        const error = new Error('WebGLRenderer 初始化失败（模拟一次 GPU 初始化失败）')
        throw Object.assign(error, { name: 'ModelSceneError', code: 'RENDERER_INIT_FAILED' })
      }
      creations.push({ canvas, ok: true, options })
      let done = false
      const handle: ModelSceneHandle = {
        probe: { webgl: 'webgl2', glVersion: 'WebGL 2.0 (Fake)', glRenderer: 'Fake GPU', dpr: 1 },
        setSelected: () => undefined,
        setActive: () => undefined,
        resetView: () => undefined,
        zoomBy: () => undefined,
        getView: () => ({ position: [0, 0, 0], target: [0, 0, 0], zoom: 1 }),
        frameCount: () => 0,
        dispose(forceContextLoss: boolean) {
          if (done) return
          done = true
          disposed.push(canvas)
          if (forceContextLoss) lost.add(canvas)
        },
      }
      return handle
    }
    return { createModelScene } as unknown as typeof import('../parts/modelScene')
  }

  return {
    loader,
    creations,
    disposed,
    failNext(times = 1) {
      failuresLeft = times
    },
    lastOptions(): ModelSceneOptions | undefined {
      return creations[creations.length - 1]?.options
    },
  }
}

function makeGeometry(index: number): ModelRenderGeometry {
  return {
    revisionId: `rev-${index}`,
    fileName: `probe-${index}.stl`,
    encoding: 'binary',
    triangleCount: 1,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    bounds: { min: [0, 0, 0], max: [1, 1, 0] },
  }
}

function viewport(geometry: ModelRenderGeometry, loader: ReturnType<typeof createFakeScene>['loader']) {
  return (
    <ModelViewport
      geometry={geometry}
      selected={false}
      onSelect={() => undefined}
      active
      view={null}
      onViewChange={() => undefined}
      sceneLoader={loader}
    />
  )
}

function state(container: HTMLElement): string | null {
  return container.querySelector('.model-viewport')?.getAttribute('data-three-state') ?? null
}

function canvasCount(): number {
  return document.querySelectorAll('.model-viewport__stage canvas').length
}

afterEach(() => cleanup())

describe('B2 · 导入模型替换与重试的 canvas 生命周期', () => {
  it('连续替换 6 次都能建场：每次换新 canvas，旧场景释放，页面始终只有一张 canvas', async () => {
    const fake = createFakeScene()
    const { container, rerender } = render(viewport(makeGeometry(0), fake.loader))

    await waitFor(() => expect(state(container)).toBe('ready'))
    expect(canvasCount()).toBe(1)

    for (let index = 1; index <= 6; index += 1) {
      rerender(viewport(makeGeometry(index), fake.loader))
      await waitFor(() => expect(state(container)).toBe('ready'))
      expect(canvasCount()).toBe(1)
    }

    // 7 次建场（首发 + 6 次替换）全部成功，且每次拿到的是不同的 canvas 元素。
    expect(fake.creations).toHaveLength(7)
    expect(fake.creations.every((item) => item.ok)).toBe(true)
    expect(new Set(fake.creations.map((item) => item.canvas)).size).toBe(7)
    expect(fake.disposed).toHaveLength(6)
    expect(new Set(fake.disposed).size).toBe(6)
    // 当前 canvas 就是最后一次建场用的那张，没有旧 canvas 残留。
    const currentCanvas = container.querySelector('.model-viewport__stage canvas')
    expect(currentCanvas).toBe(fake.creations[6].canvas)
  })

  it('初始化失败后重试：释放失败画布、新建 canvas，成功后仍只有一张 canvas', async () => {
    const fake = createFakeScene()
    fake.failNext(1)
    const { container } = render(viewport(makeGeometry(0), fake.loader))

    await waitFor(() => expect(state(container)).toBe('error'))
    expect(screen.getByRole('alert')).toHaveTextContent('RENDERER_INIT_FAILED')
    expect(canvasCount()).toBe(1)
    const failedCanvas = fake.creations[0].canvas

    fireEvent.click(screen.getByRole('button', { name: '重试 3D 视图' }))
    await waitFor(() => expect(state(container)).toBe('ready'))

    expect(fake.creations).toHaveLength(2)
    expect(fake.creations[1].canvas).not.toBe(failedCanvas)
    expect(fake.creations[1].ok).toBe(true)
    expect(canvasCount()).toBe(1)
    expect(container.querySelector('.model-viewport__stage canvas')).toBe(fake.creations[1].canvas)
  })

  it('context lost 后重试：旧场景只释放一次，新场景用新 canvas，重试不叠加 canvas', async () => {
    const fake = createFakeScene()
    const { container } = render(viewport(makeGeometry(0), fake.loader))
    await waitFor(() => expect(state(container)).toBe('ready'))
    const firstCanvas = fake.creations[0].canvas

    // 模拟浏览器 contextlost：像 modelScene 的真实回调那样只降级 UI，不重建。
    fake.lastOptions()?.onContextLost()
    await waitFor(() => expect(state(container)).toBe('error'))
    expect(canvasCount()).toBe(1)

    fireEvent.click(screen.getByRole('button', { name: '重试 3D 视图' }))
    await waitFor(() => expect(state(container)).toBe('ready'))

    expect(fake.creations).toHaveLength(2)
    expect(fake.creations[1].canvas).not.toBe(firstCanvas)
    expect(fake.disposed).toEqual([firstCanvas])
    expect(canvasCount()).toBe(1)
  })
})
