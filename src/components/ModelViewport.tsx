/**
 * 导入 STL 的 3D 视图容器（V3-B2）。
 *
 * - 懒加载 modelScene；首次进入 3D 标签才加载 three；
 * - 单一整体网格：不提供爆炸滑条，并明确说明原因；
 * - 初始化/懒加载失败、contextlost → 局部降级 + 重试，不动项目数据；
 * - 相机/选择只是 UI 状态，不写项目、不触发 dirty。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DemoViewState } from '../parts/shaftDemo'
import type { ModelSceneHandle, ModelSceneProbe } from '../parts/modelScene'
import type { StlGeometry } from '../parts/stlValidation'
import './ModelViewport.css'

type SceneModule = typeof import('../parts/modelScene')

export interface ModelRenderGeometry {
  revisionId: string
  fileName: string
  encoding: 'binary' | 'ascii'
  triangleCount: number
  positions: Float32Array
  normals: Float32Array
  bounds: StlGeometry['bounds']
}

export interface ModelViewportProps {
  geometry: ModelRenderGeometry
  selected: boolean
  onSelect: (selected: boolean) => void
  active: boolean
  view: DemoViewState | null
  onViewChange: (view: DemoViewState) => void
  sceneLoader?: () => Promise<SceneModule>
}

interface Failure {
  code: string
  message: string
}

const defaultLoader = (): Promise<SceneModule> => import('../parts/modelScene')

function describeFailure(error: unknown): Failure {
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string') {
    const typed = error as { code: string; message?: string }
    return { code: typed.code, message: typed.message ?? '未知原因' }
  }
  return { code: 'SCENE_LOAD_FAILED', message: error instanceof Error ? error.message : String(error) }
}

export function ModelViewport(props: ModelViewportProps) {
  const { geometry, selected, active, sceneLoader = defaultLoader } = props
  const stageRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<ModelSceneHandle | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [failure, setFailure] = useState<Failure | null>(null)
  const [probe, setProbe] = useState<ModelSceneProbe | null>(null)
  const [perf, setPerf] = useState<'normal' | 'degraded' | 'insufficient'>('normal')
  const [generation, setGeneration] = useState(0)

  const propsRef = useRef(props)
  useEffect(() => { propsRef.current = props })

  const handlers = useMemo(() => ({
    onSelect: (value: boolean) => propsRef.current.onSelect(value),
    onViewChange: (view: DemoViewState) => propsRef.current.onViewChange(view),
    onPerformance: (level: 'degraded' | 'insufficient') => setPerf(level),
    onContextLost: () => {
      setStatus('error')
      setFailure({ code: 'CONTEXT_LOST', message: 'WebGL 上下文丢失' })
    },
  }), [])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    // 每次建场都用新建的 canvas：dispose(true) 会 loseContext，上下文丢失是终态，
    // 同一个 canvas 再次 getContext('webgl2') 只会拿回已丢失的旧上下文
    // （getContextAttributes() === null，three 读 alpha 时抛错）。
    const canvas = document.createElement('canvas')
    canvas.setAttribute('role', 'img')
    canvas.setAttribute('aria-label', '导入模型三维视图：左键拖动旋转，滚轮缩放，右键或 Shift+拖动平移，单击整体选择')
    canvas.setAttribute('aria-describedby', 'model-viewport-status')
    stage.insertBefore(canvas, stage.firstChild)
    let cancelled = false
    let handle: ModelSceneHandle | null = null
    setStatus('loading')
    setFailure(null)
    setPerf('normal')

    const create = async (): Promise<void> => {
      try {
        const module = await sceneLoader()
        if (cancelled) return
        const created = module.createModelScene({
          canvas,
          positions: geometry.positions,
          normals: geometry.normals,
          bounds: geometry.bounds,
          view: propsRef.current.view,
          selected: propsRef.current.selected,
          onSelect: handlers.onSelect,
          onViewChange: handlers.onViewChange,
          onPerformance: handlers.onPerformance,
          onContextLost: handlers.onContextLost,
        })
        if (cancelled) {
          created.dispose(true)
          return
        }
        handle = created
        sceneRef.current = created
        setProbe(created.probe)
        setStatus('ready')
        created.setActive(propsRef.current.active)
      } catch (error) {
        if (!cancelled) {
          setStatus('error')
          setFailure(describeFailure(error))
        }
      }
    }
    void create()

    return () => {
      cancelled = true
      const current = handle ?? sceneRef.current
      sceneRef.current = null
      current?.dispose(true)
      canvas.remove()
    }
    // 几何身份由 revisionId 决定；同一版本内不重建场景。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation, sceneLoader, geometry.revisionId])

  useEffect(() => {
    if (status === 'ready') sceneRef.current?.setSelected(selected)
  }, [selected, status])

  useEffect(() => {
    if (status === 'ready') sceneRef.current?.setActive(active)
  }, [active, status])

  const ready = status === 'ready'
  const retry = useCallback(() => {
    setFailure(null)
    setPerf('normal')
    setStatus('loading')
    setGeneration((value) => value + 1)
  }, [])

  const statusBits = [
    ready ? '3D 就绪' : status === 'loading' ? '正在载入 3D' : '3D 暂不可用',
    ready ? 'WebGL2' : '',
    perf === 'degraded' ? '已降低显示分辨率' : '',
    perf === 'insufficient' ? '性能不足：仍可手动操作或切换其他标签' : '',
  ].filter(Boolean)

  return (
    <div
      className="model-viewport"
      data-three-state={status}
      data-webgl2={probe ? 'true' : 'false'}
      data-dpr={probe ? String(probe.dpr) : ''}
      data-triangle-count={String(geometry.triangleCount)}
    >
      <p className="model-viewport__banner">
        <strong>导入模型 · {geometry.fileName}</strong>{' '}
        {geometry.encoding === 'binary' ? '二进制' : 'ASCII'} STL · {geometry.triangleCount.toLocaleString('en-US')} 面 ·
        整体网格，不提供部件爆炸；旋转/缩放/平移只改相机，原顶点与 q 不变。
      </p>
      <div className="model-viewport__toolbar" role="toolbar" aria-label="模型视图操作">
        <span className="model-viewport__group">
          <button type="button" disabled={!ready} onClick={() => sceneRef.current?.zoomBy(1.25)} aria-label="放大">放大</button>
          <button type="button" disabled={!ready} onClick={() => sceneRef.current?.zoomBy(0.8)} aria-label="缩小">缩小</button>
        </span>
        <button type="button" disabled={!ready} onClick={() => sceneRef.current?.resetView()}>重置视角</button>
        <button type="button" disabled title="整体网格不支持部件爆炸">爆炸（整体网格不支持）</button>
      </div>
      <div className="model-viewport__stage" ref={stageRef}>
        {status === 'error' && (
          <div className="model-viewport__fallback" role="alert">
            <strong>3D 暂不可用：{failure?.code ?? 'UNKNOWN'}</strong>
            <p>{failure?.message ?? '未知原因'}。项目数据、属性与其他标签仍可用；可尝试重试。</p>
            <button type="button" onClick={retry}>重试 3D 视图</button>
          </div>
        )}
        {status === 'loading' && <p className="model-viewport__loading" role="status">正在载入 3D 视图…</p>}
      </div>
      <p id="model-viewport-status" className="model-viewport__status" role="status">
        {statusBits.join(' · ')}
        <span className="model-viewport__selection">当前选择：{selected ? '整体模型' : '未选择'}</span>
      </p>
    </div>
  )
}
