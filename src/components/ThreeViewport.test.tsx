// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThreeViewport, type ThreeViewportProps } from './ThreeViewport'
import type { DemoSceneHandle, DemoSceneOptions } from '../parts/threeScene'
import type { BuiltinPartId, DemoViewState } from '../parts/shaftDemo'

interface FakeHandle {
  options: DemoSceneOptions
  disposed: boolean
  selected: (BuiltinPartId | null | undefined)[]
  explode: number[]
  active: boolean[]
  resets: number
  zooms: number[]
  disposeArgs: boolean[]
}

interface Harness {
  loader: () => Promise<typeof import('../parts/threeScene')>
  handles: FakeHandle[]
  failImport: Error | null
  failCreate: Error | null
}

/** 伪场景模块：记录命令调用，不创建任何真实 WebGL 资源。 */
function harness(): Harness {
  const state: Harness = {
    handles: [],
    failImport: null,
    failCreate: null,
    loader: async () => {
      if (state.failImport) throw state.failImport
      const module = {
        createDemoScene: (options: DemoSceneOptions): DemoSceneHandle => {
          if (state.failCreate) throw state.failCreate
          const record: FakeHandle = {
            options, disposed: false, selected: [], explode: [], active: [], resets: 0, zooms: [], disposeArgs: [],
          }
          const handle: DemoSceneHandle = {
            probe: { webgl: 'webgl2', glVersion: 'WebGL 2.0 (Mock)', glRenderer: 'Mock GPU', glVendor: 'Mock', antialias: true, dpr: 2 },
            setSelectedPartId: (partId) => { record.selected.push(partId) },
            setSpacerDimensions: () => undefined,
            spacerLengthMm: () => 12,
            setExplodeT: (t) => { record.explode.push(t) },
            setActive: (next) => { record.active.push(next) },
            resetView: () => { record.resets += 1 },
            zoomBy: (factor) => { record.zooms.push(factor) },
            getView: () => ({ position: [0, 0, 0], target: [0, 0, 0], zoom: 1 }),
            frameCount: () => 0,
            dispose: (force) => { record.disposed = true; record.disposeArgs.push(force) },
          }
          state.handles.push(record)
          return handle
        },
      }
      return module as unknown as typeof import('../parts/threeScene')
    },
  }
  return state
}

const VIEW: DemoViewState = { position: [10, 10, 10], target: [0, 0, 0], zoom: 1 }

function renderViewport(extra: Partial<ThreeViewportProps> = {}) {
  const kit = harness()
  const onSelectPart = vi.fn<(partId: BuiltinPartId | null) => void>()
  const onExplodeTChange = vi.fn<(t: number) => void>()
  const onViewStateChange = vi.fn<(view: DemoViewState) => void>()
  const props: ThreeViewportProps = {
    selectedPartId: null,
    explodeT: 0,
    active: true,
    viewState: VIEW,
    sceneLoader: kit.loader,
    onSelectPart,
    onExplodeTChange,
    onViewStateChange,
    ...extra,
  }
  const rendered = render(<ThreeViewport {...props} />)
  return { kit, props, onSelectPart, onExplodeTChange, onViewStateChange, ...rendered }
}

afterEach(() => { vi.restoreAllMocks() })

describe('B1 · ThreeViewport 生命周期', () => {
  it('懒加载成功后渲染 canvas，状态与探针可见（不伪造 WebGL2）', async () => {
    const { kit } = renderViewport()
    expect(screen.getByText('正在载入 3D 视图…')).toBeInTheDocument()
    await screen.findByText(/3D 就绪/)
    expect(screen.getByRole('img', { name: /轴系示意装配三维视图/ })).toBeInTheDocument()
    const root = document.querySelector('.three-viewport')!
    expect(root.getAttribute('data-three-state')).toBe('ready')
    expect(root.getAttribute('data-webgl2')).toBe('true')
    expect(root.getAttribute('data-gl-version')).toBe('WebGL 2.0 (Mock)')
    expect(root.getAttribute('data-part-count')).toBe('5')
    expect(kit.handles).toHaveLength(1)
    expect(kit.handles[0].options.view).toEqual(VIEW)
  })

  it('props 变化走命令接口，不重建场景', async () => {
    const { kit, props, rerender } = renderViewport()
    await waitFor(() => expect(kit.handles).toHaveLength(1))
    rerender(<ThreeViewport {...props} selectedPartId="builtin:shaft-demo:spacer" explodeT={0.5} />)
    await waitFor(() => expect(String(kit.handles[0].selected.at(-1))).toBe('builtin:shaft-demo:spacer'))
    expect(kit.handles[0].explode.at(-1)).toBe(0.5)
    rerender(<ThreeViewport {...props} selectedPartId="builtin:shaft-demo:spacer" explodeT={0.5} active={false} />)
    await waitFor(() => expect(kit.handles[0].active.at(-1)).toBe(false))
    expect(kit.handles).toHaveLength(1)
    expect(kit.handles[0].disposed).toBe(false)
  })

  it('画布选中回调直达父级', async () => {
    const { kit, onSelectPart } = renderViewport()
    await waitFor(() => expect(kit.handles).toHaveLength(1))
    act(() => kit.handles[0].options.onSelectPart('builtin:shaft-demo:bearing-left'))
    expect(onSelectPart).toHaveBeenCalledWith('builtin:shaft-demo:bearing-left')
    act(() => kit.handles[0].options.onSelectPart(null))
    expect(onSelectPart).toHaveBeenLastCalledWith(null)
  })

  it('工具条：装配/爆炸/滑条/重置视角/复位装配/缩放语义分开', async () => {
    const { kit, onExplodeTChange } = renderViewport({ selectedPartId: 'builtin:shaft-demo:spacer', explodeT: 0.5 })
    await waitFor(() => expect(kit.handles).toHaveLength(1))
    const slider = screen.getByRole('slider', { name: '爆炸程度' })
    expect(slider).toHaveValue('50')
    expect(screen.getByText('当前选择：隔套')).toBeInTheDocument()
    fireEvent.change(slider, { target: { value: '100' } })
    expect(onExplodeTChange).toHaveBeenLastCalledWith(1)
    fireEvent.change(slider, { target: { value: '0' } })
    expect(onExplodeTChange).toHaveBeenLastCalledWith(0)
    fireEvent.click(screen.getByRole('button', { name: '爆炸' }))
    expect(onExplodeTChange).toHaveBeenLastCalledWith(1)
    fireEvent.click(screen.getByRole('button', { name: '装配' }))
    expect(onExplodeTChange).toHaveBeenLastCalledWith(0)
    const before = onExplodeTChange.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: '重置视角' }))
    expect(kit.handles[0].resets).toBe(1)
    expect(onExplodeTChange.mock.calls.length).toBe(before)
    fireEvent.click(screen.getByRole('button', { name: '复位装配' }))
    expect(onExplodeTChange).toHaveBeenLastCalledWith(0)
    expect(kit.handles[0].resets).toBe(2)
    fireEvent.click(screen.getByRole('button', { name: '放大' }))
    fireEvent.click(screen.getByRole('button', { name: '缩小' }))
    expect(kit.handles[0].zooms).toEqual([1.25, 0.8])
  })
})

describe('B1 · ThreeViewport 失败与降级', () => {
  it('懒加载失败：局部提示 + 可聚焦重试，工具条禁用', async () => {
    const kit = harness()
    kit.failImport = new Error('chunk load failed')
    render(<ThreeViewport {...{
      selectedPartId: null, onSelectPart: vi.fn(), explodeT: 0, onExplodeTChange: vi.fn(),
      active: true, viewState: null, onViewStateChange: vi.fn(), sceneLoader: kit.loader,
    }} />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('3D 暂不可用：SCENE_LOAD_FAILED')
    expect(alert).toHaveTextContent('chunk load failed')
    expect(screen.getByRole('button', { name: '重试 3D 视图' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '爆炸' })).toBeDisabled()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(document.querySelector('.three-viewport')!.getAttribute('data-three-state')).toBe('error')
    expect(kit.handles).toHaveLength(0)
  })

  it('WebGL2 不可用：显示错误码，重试成功后只剩一个 canvas', async () => {
    const kit = harness()
    kit.failCreate = Object.assign(new Error('当前环境无法创建 WebGL2 上下文'), { name: 'DemoSceneError', code: 'WEBGL2_UNAVAILABLE' })
    render(<ThreeViewport {...{
      selectedPartId: null, onSelectPart: vi.fn(), explodeT: 0, onExplodeTChange: vi.fn(),
      active: true, viewState: null, onViewStateChange: vi.fn(), sceneLoader: kit.loader,
    }} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('WEBGL2_UNAVAILABLE')
    kit.failCreate = null
    fireEvent.click(screen.getByRole('button', { name: '重试 3D 视图' }))
    await screen.findByText(/3D 就绪/)
    expect(document.querySelectorAll('canvas')).toHaveLength(1)
    expect(kit.handles).toHaveLength(1)
  })

  it('contextlost 后转局部错误并停渲染，重试完整清理旧实例', async () => {
    const { kit } = renderViewport()
    await waitFor(() => expect(kit.handles).toHaveLength(1))
    act(() => kit.handles[0].options.onContextLost())
    expect(await screen.findByRole('alert')).toHaveTextContent('CONTEXT_LOST')
    expect(document.querySelectorAll('canvas')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '重试 3D 视图' }))
    await screen.findByText(/3D 就绪/)
    expect(kit.handles).toHaveLength(2)
    expect(kit.handles[0].disposed).toBe(true)
    expect(kit.handles[0].disposeArgs).toEqual([true])
    expect(document.querySelectorAll('canvas')).toHaveLength(1)
  })

  it('降级/性能不足提示来自场景回调，不自动禁用交互', async () => {
    const { kit } = renderViewport()
    await waitFor(() => expect(kit.handles).toHaveLength(1))
    act(() => kit.handles[0].options.onPerformance('degraded'))
    expect(screen.getByText(/已降低显示分辨率/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '爆炸' })).toBeEnabled()
    act(() => kit.handles[0].options.onPerformance('insufficient'))
    expect(screen.getByText(/性能不足/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '爆炸' })).toBeEnabled()
  })
})

describe('B1 · ThreeViewport StrictMode 与释放', () => {
  it('StrictMode 双挂载不产生第二个实例：懒加载未 resolve 前 effect 已被取消', async () => {
    const kit = harness()
    const { unmount } = render(<StrictMode>
      <ThreeViewport {...{
        selectedPartId: null, onSelectPart: vi.fn(), explodeT: 0, onExplodeTChange: vi.fn(),
        active: true, viewState: null, onViewStateChange: vi.fn(), sceneLoader: kit.loader,
      }} />
    </StrictMode>)
    await screen.findByText(/3D 就绪/)
    expect(document.querySelectorAll('canvas')).toHaveLength(1)
    // 开发期 setup→cleanup→setup：第一次在动态 import resolve 前被取消，没有多余上下文。
    expect(kit.handles).toHaveLength(1)
    expect(kit.handles[0].disposed).toBe(false)
    unmount()
    expect(kit.handles[0].disposed).toBe(true)
    expect(kit.handles[0].disposeArgs).toEqual([true])
  })

  it('卸载后 canvas 移除且实例只释放一次', async () => {
    const { kit, unmount } = renderViewport()
    await waitFor(() => expect(kit.handles).toHaveLength(1))
    unmount()
    expect(document.querySelectorAll('canvas')).toHaveLength(0)
    expect(kit.handles[0].disposeArgs).toEqual([true])
  })
})
