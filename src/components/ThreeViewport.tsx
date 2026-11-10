/**
 * 3D 视图容器（React 侧）：只做状态机、工具条与失败降级，GPU 资源全部在
 * 动态 import 的 threeScene 里，首次进入 3D 标签才加载 three。
 *
 * 任务卡 V3-B1 §3.4/§3.5：
 * - 装配/爆炸滑条、重置视角、复位装配、放大/缩小；按钮可 Tab 聚焦；
 * - 初始化失败、懒加载失败、contextlost → 局部“3D 暂不可用”+ 重试，其他标签不受影响；
 * - 不写项目、不触发 stageDraft、不产生 dirty；选中/相机/爆炸只在本会话 UI 状态里。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BUILTIN_PART_IDS,
  demoPart,
  explodeTFromSlider,
  type BuiltinPartId,
  type DemoViewState,
} from '../parts/shaftDemo'
import type { DemoSceneHandle, DemoSceneOptions, SceneProbe } from '../parts/threeScene'
import './ThreeViewport.css'

type SceneModule = typeof import('../parts/threeScene')

export interface ThreeViewportProps {
  selectedPartId: BuiltinPartId | null
  onSelectPart: (partId: BuiltinPartId | null) => void
  explodeT: number
  onExplodeTChange: (t: number) => void
  /** 标签是否可见：隐藏时暂停渲染与 controls 输入，但保留选择/pose。 */
  active: boolean
  viewState: DemoViewState | null
  onViewStateChange: (view: DemoViewState) => void
  /** D：隔套示意几何（mm）；缺省用 B1 固定值。 */
  spacerMm?: { innerRadius: number; outerRadius: number; length: number }
  /** 仅供测试注入懒加载失败/构造失败；产品路径是动态 import。 */
  sceneLoader?: () => Promise<SceneModule>
}

interface SceneFailure {
  code: string
  message: string
}

const defaultLoader = (): Promise<SceneModule> => import('../parts/threeScene')

function describeFailure(error: unknown): SceneFailure {
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string') {
    const typed = error as { code: string; message?: string }
    return { code: typed.code, message: typed.message ?? '未知原因' }
  }
  return { code: 'SCENE_LOAD_FAILED', message: error instanceof Error ? error.message : String(error) }
}

export function ThreeViewport(props: ThreeViewportProps) {
  const { selectedPartId, explodeT, active, sceneLoader = defaultLoader } = props
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<DemoSceneHandle | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [failure, setFailure] = useState<SceneFailure | null>(null)
  const [probe, setProbe] = useState<SceneProbe | null>(null)
  const [perf, setPerf] = useState<'normal' | 'degraded' | 'insufficient'>('normal')
  const [generation, setGeneration] = useState(0)

  // 初始创建时读取最新 props，又不让 props 变化重建场景；ref 只在提交后同步。
  const propsRef = useRef(props)
  useEffect(() => { propsRef.current = props })

  const handlers = useMemo(() => ({
    onSelectPart: (partId: BuiltinPartId | null) => propsRef.current.onSelectPart(partId),
    onViewChange: (view: DemoViewState) => propsRef.current.onViewStateChange(view),
    onPerformance: (level: 'degraded' | 'insufficient') => setPerf(level),
    onContextLost: () => {
      setStatus('error')
      setFailure({ code: 'CONTEXT_LOST', message: 'WebGL 上下文丢失' })
    },
  }), [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    let handle: DemoSceneHandle | null = null
    setStatus('loading')
    setFailure(null)
    setPerf('normal')

    const create = async () => {
      try {
        const module = await sceneLoader()
        if (cancelled) return
        const options: DemoSceneOptions = {
          canvas,
          selectedPartId: propsRef.current.selectedPartId,
          explodeT: propsRef.current.explodeT,
          view: propsRef.current.viewState,
          ...(propsRef.current.spacerMm === undefined ? {} : { spacerMm: propsRef.current.spacerMm }),
          onSelectPart: handlers.onSelectPart,
          onViewChange: handlers.onViewChange,
          onPerformance: handlers.onPerformance,
          onContextLost: handlers.onContextLost,
        }
        const created = module.createDemoScene(options)
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
    }
  }, [generation, sceneLoader, handlers])

  useEffect(() => {
    if (status !== 'ready') return
    sceneRef.current?.setSelectedPartId(selectedPartId)
  }, [selectedPartId, status])

  useEffect(() => {
    if (status !== 'ready') return
    sceneRef.current?.setExplodeT(explodeT)
  }, [explodeT, status])

  // D：草稿参数变化时只替换隔套网格；选择/相机/爆炸保持不变。
  useEffect(() => {
    if (status !== 'ready') return
    const spacer = props.spacerMm
    if (spacer === undefined) return
    sceneRef.current?.setSpacerDimensions(spacer)
  }, [status, props.spacerMm])

  useEffect(() => {
    if (status !== 'ready') return
    sceneRef.current?.setActive(active)
  }, [active, status])

  const ready = status === 'ready'

  /** 重试：先把状态切回 loading，让 canvas 重新挂载，再递增 generation 重建场景。 */
  const retry = useCallback(() => {
    setFailure(null)
    setPerf('normal')
    setStatus('loading')
    setGeneration((value) => value + 1)
  }, [])

  const onSlider = useCallback((raw: string) => {
    const next = explodeTFromSlider(raw)
    if (next === null) return
    propsRef.current.onExplodeTChange(next)
  }, [])

  const resetAssembly = useCallback(() => {
    propsRef.current.onExplodeTChange(0)
    sceneRef.current?.resetView()
  }, [])

  const selectedName = selectedPartId ? demoPart(selectedPartId).name : '未选择'
  const sliderValue = Math.round(Math.min(1, Math.max(0, explodeT)) * 100)
  const statusBits = [
    ready ? '3D 就绪' : status === 'loading' ? '正在载入 3D' : '3D 暂不可用',
    ready ? 'WebGL2' : '',
    perf === 'degraded' ? '已降低显示分辨率' : '',
    perf === 'insufficient' ? '性能不足：仍可手动操作或切换其他标签' : '',
  ].filter(Boolean)

  return (
    <div
      className="three-viewport"
      data-three-state={status}
      data-webgl2={probe ? 'true' : 'false'}
      data-dpr={probe ? String(probe.dpr) : ''}
      data-gl-version={probe?.glVersion ?? ''}
      data-gl-renderer={probe?.glRenderer ?? ''}
      data-part-count={String(BUILTIN_PART_IDS.length)}
    >
      <p className="three-viewport__banner">
        <strong>内置轴系示例 · 示意装配</strong>{' '}
        隔套示意几何随当前参数草稿/正式值更新（只影响网格）；其他部件固定示意。项目数据可保存；3D 视图状态仅本次会话保留，重开应用后需重新打开示例。
      </p>
      <div className="three-viewport__toolbar" role="toolbar" aria-label="3D 视图操作">
        <button type="button" disabled={!ready} onClick={() => props.onExplodeTChange(0)}>装配</button>
        <button type="button" disabled={!ready} onClick={() => props.onExplodeTChange(1)}>爆炸</button>
        <label className="three-viewport__slider">
          <span className="three-viewport__slider-label">爆炸程度</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={sliderValue}
            disabled={!ready}
            aria-label="爆炸程度"
            aria-valuetext={sliderValue === 0 ? '装配' : `爆炸 ${sliderValue}%`}
            onChange={(event) => onSlider(event.target.value)}
          />
          <output aria-hidden="true">{sliderValue}%</output>
        </label>
        <span className="three-viewport__gap" aria-hidden="true" />
        <span className="three-viewport__group">
          <button type="button" disabled={!ready} onClick={() => sceneRef.current?.zoomBy(1.25)} aria-label="放大">放大</button>
          <button type="button" disabled={!ready} onClick={() => sceneRef.current?.zoomBy(0.8)} aria-label="缩小">缩小</button>
        </span>
        <span className="three-viewport__group">
          <button type="button" disabled={!ready} onClick={() => sceneRef.current?.resetView()}>重置视角</button>
          <button type="button" disabled={!ready} onClick={resetAssembly}>复位装配</button>
        </span>
      </div>
      <div className="three-viewport__stage">
        {status === 'error' ? (
          <div className="three-viewport__fallback" role="alert">
            <strong>3D 暂不可用：{failure?.code ?? 'UNKNOWN'}</strong>
            <p>{failure?.message ?? '未知原因'}。项目树与只读属性仍可用，其他标签不受影响；可尝试重试。</p>
            <button type="button" onClick={retry}>重试 3D 视图</button>
          </div>
        ) : (
          <canvas
            key={generation}
            ref={canvasRef}
            role="img"
            aria-label="轴系示意装配三维视图：左键拖动旋转，滚轮缩放，右键或 Shift+拖动平移，单击部件选择"
            aria-describedby="three-viewport-status"
          />
        )}
        {status === 'loading' && <p className="three-viewport__loading" role="status">正在载入 3D 视图…</p>}
      </div>
      <p id="three-viewport-status" className="three-viewport__status" role="status">
        {statusBits.join(' · ')}
        <span className="three-viewport__selection">当前选择：{selectedName}</span>
      </p>
    </div>
  )
}
