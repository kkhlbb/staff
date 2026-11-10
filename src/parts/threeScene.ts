/**
 * 内置轴系示例的 WebGL 场景（GPU owner，唯一持有 renderer/controls/几何实例）。
 *
 * 本模块只被 ThreeViewport 通过动态 import 加载，因此 three 不进首屏 chunk。
 *
 * 生命周期（任务卡 V3-B1 §3.5）：
 * - create → setExplodeT/setSelectedPartId/setActive/resetView/zoomBy → dispose；
 * - 按需 RAF：change/selection/explode/resize 才画一帧，静止即停（无无限 animate）；
 * - 单一 owner 释放几何/材质/轮廓/renderer，dispose 幂等；
 * - 初始化失败、contextlost 只报错并停 RAF，不影响其他标签与保存屏障。
 *
 * 参考：
 * - three r187 OrbitControls（examples/jsm/controls/OrbitControls.js）：
 *   构造函数连接 DOM、change 事件、disabled/damping=false、update、dispose；
 * - three r187 WebGLRenderer / Raycaster 官方文档（r163 起不再支持 WebGL1，故要求 WebGL2）。
 */
import {
  AmbientLight,
  Color,
  DirectionalLight,
  EdgesGeometry,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
  type WebGLRendererParameters,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { createDemoAssembly, type DemoAssembly } from './shaftDemoGeometry'
import {
  EXPLODED_BOUNDS,
  cloneViewState,
  demoPart,
  normalizeSelectedPartId,
  normalizeViewState,
  type BuiltinPartId,
  type DemoViewState,
} from './shaftDemo'
import { FrameMeter } from './frameStats'
import { canBeginPick, isClickGesture, nearestPartHit, ndcFromClient } from './selection'

export type SceneErrorCode = 'WEBGL2_UNAVAILABLE' | 'RENDERER_INIT_FAILED'

export class DemoSceneError extends Error {
  readonly code: SceneErrorCode

  constructor(code: SceneErrorCode, message: string, detail?: string) {
    super(detail ? `${message}（${detail}）` : message)
    this.name = 'DemoSceneError'
    this.code = code
  }
}

export interface SceneProbe {
  webgl: 'webgl2'
  glVersion: string
  glRenderer: string
  glVendor: string
  antialias: boolean
  dpr: number
}

export interface DemoSceneOptions {
  canvas: HTMLCanvasElement
  selectedPartId: BuiltinPartId | null
  explodeT: number
  view: DemoViewState | null
  /** D：隔套示意几何尺寸（mm）；缺省用 B1 固定值。 */
  spacerMm?: { innerRadius: number; outerRadius: number; length: number }
  onSelectPart(partId: BuiltinPartId | null): void
  onViewChange(view: DemoViewState): void
  onPerformance(level: 'degraded' | 'insufficient'): void
  onContextLost(): void
}

export interface DemoSceneHandle {
  readonly probe: SceneProbe
  setExplodeT(t: number): void
  setSelectedPartId(partId: BuiltinPartId | null): void
  /** D：按当前草稿/正式参数替换隔套网格；不改变选择/相机/爆炸。 */
  setSpacerDimensions(dimensions: { innerRadius: number; outerRadius: number; length: number }): void
  spacerLengthMm(): number
  setActive(active: boolean): void
  resetView(): void
  zoomBy(factor: number): void
  getView(): DemoViewState
  /** 已渲染帧数（证据/调试）。 */
  frameCount(): number
  dispose(forceContextLoss: boolean): void
}

const SELECT_COLOR = 0xc7d2fe
const SELECT_EMISSIVE = 0x3730a3
const EDGE_COLOR = 0x3730a3
const BACKGROUND = '#F5F7FA'
const FOV = 45
const NEAR = 0.5
const FAR = 5000
const DEG2RAD = Math.PI / 180

/**
 * 默认 framing：把「完整爆炸包围盒」的 8 个角点都装进视锥，四周至少 10% 留白。
 *
 * 用包围盒逐角点求最小距离，而不是包围球：球会多留 30%+ 空白，导致模型在画布上过小。
 * 仍以 t=1（爆炸 100%）为适配目标，所以拉到 100% 也不会被裁切。
 */
export function framingDistanceForAspect(aspect: number, direction: Vector3): number {
  const safeAspect = Number.isFinite(aspect) && aspect > 0.2 ? aspect : 1
  const tanV = Math.tan((FOV * DEG2RAD) / 2)
  const tanH = tanV * safeAspect
  const margin = 1.1
  const forward = direction.clone().normalize().negate()
  const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize()
  const up = new Vector3().crossVectors(right, forward).normalize()
  let distance = 1
  for (const x of [EXPLODED_BOUNDS.min[0], EXPLODED_BOUNDS.max[0]]) {
    for (const y of [EXPLODED_BOUNDS.min[1], EXPLODED_BOUNDS.max[1]]) {
      for (const z of [EXPLODED_BOUNDS.min[2], EXPLODED_BOUNDS.max[2]]) {
        const corner = new Vector3(x, y, z)
        const u = corner.dot(right)
        const v = corner.dot(up)
        const w = corner.dot(forward)
        // 角点深度 = distance + w；要求 |v| * margin ≤ depth * tanV 且 |u| * margin ≤ depth * tanH。
        distance = Math.max(
          distance,
          (Math.abs(v) * margin) / tanV - w,
          (Math.abs(u) * margin) / tanH - w,
        )
      }
    }
  }
  return distance
}

/** 默认斜视：能看到端面孔与台阶，而不是正对轴线。 */
export function defaultViewForAspect(aspect: number): DemoViewState {
  const direction = new Vector3(0.85, 0.42, 1).normalize()
  const distance = Math.max(1, framingDistanceForAspect(aspect, direction))
  return {
    position: [direction.x * distance, direction.y * distance, direction.z * distance],
    target: [0, 0, 0],
    zoom: 1,
  }
}

function glString(gl: WebGL2RenderingContext, name: number): string {
  const value = gl.getParameter(name)
  return typeof value === 'string' ? value : String(value)
}

export function createDemoScene(options: DemoSceneOptions): DemoSceneHandle {
  const { canvas } = options
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: true,
    depth: true,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
    failIfMajorPerformanceCaveat: false,
  }) as WebGL2RenderingContext | null
  if (!gl) {
    throw new DemoSceneError('WEBGL2_UNAVAILABLE', '当前环境无法创建 WebGL2 上下文')
  }

  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
  const probe: SceneProbe = {
    webgl: 'webgl2',
    glVersion: glString(gl, gl.VERSION),
    glRenderer: debugInfo ? glString(gl, debugInfo.UNMASKED_RENDERER_WEBGL) : '扩展不可用',
    glVendor: debugInfo ? glString(gl, debugInfo.UNMASKED_VENDOR_WEBGL) : '扩展不可用',
    antialias: gl.getContextAttributes()?.antialias ?? false,
    dpr: Math.min(globalThis.devicePixelRatio || 1, 2),
  }

  let renderer: WebGLRenderer
  try {
    const params: WebGLRendererParameters = { canvas, context: gl, antialias: probe.antialias }
    renderer = new WebGLRenderer(params)
  } catch (error) {
    throw new DemoSceneError('RENDERER_INIT_FAILED', 'WebGLRenderer 初始化失败', error instanceof Error ? error.message : String(error))
  }
  renderer.setPixelRatio(probe.dpr)
  renderer.setClearColor(new Color(BACKGROUND), 1)

  const scene = new Scene()
  scene.background = new Color(BACKGROUND)
  const camera = new PerspectiveCamera(FOV, 1, NEAR, FAR)
  camera.position.set(0, 0, 1)

  const ambient = new AmbientLight(0xffffff, 1.1)
  const hemisphere = new HemisphereLight(0xffffff, 0x6b7a90, 1.2)
  const key = new DirectionalLight(0xffffff, 2.1)
  key.position.set(140, 210, 180)
  const fill = new DirectionalLight(0xdfe7f5, 0.8)
  fill.position.set(-180, -90, -140)
  scene.add(ambient, hemisphere, key, fill)

  const assembly: DemoAssembly = createDemoAssembly(options.spacerMm)
  scene.add(assembly.root)
  assembly.setExplodeT(options.explodeT)

  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = false
  controls.autoRotate = false
  controls.minDistance = 40
  controls.maxDistance = 2000

  const raycaster = new Raycaster()
  const meter = new FrameMeter()
  const meshes = assembly.parts.map((part) => part.mesh)

  let active = true
  let disposed = false
  let rafId = 0
  let frames = 0
  let currentDpr = probe.dpr
  let width = 0
  let height = 0
  let selected: BuiltinPartId | null = normalizeSelectedPartId(options.selectedPartId)
  let outline: LineSegments | null = null
  let outlineGeometry: BufferGeometry | null = null
  let viewTimer: number | null = null

  const emitView = () => {
    if (disposed) return
    options.onViewChange(readView())
  }
  const scheduleEmitView = () => {
    if (viewTimer !== null) window.clearTimeout(viewTimer)
    // 拖动期间不必每次都通知 React，避免每帧 setState。
    viewTimer = window.setTimeout(() => {
      viewTimer = null
      emitView()
    }, 80)
  }

  function readView(): DemoViewState {
    return {
      position: [camera.position.x, camera.position.y, camera.position.z],
      target: [controls.target.x, controls.target.y, controls.target.z],
      zoom: camera.zoom,
    }
  }

  function applySize(): void {
    const nextWidth = canvas.clientWidth
    const nextHeight = canvas.clientHeight
    if (!(nextWidth > 0) || !(nextHeight > 0)) return
    if (nextWidth === width && nextHeight === height) return
    width = nextWidth
    height = nextHeight
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    renderer.setPixelRatio(currentDpr)
    renderer.setSize(width, height, false)
    invalidate()
  }

  function invalidate(): void {
    if (disposed || !active || rafId !== 0) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    rafId = window.requestAnimationFrame(tick)
  }

  function tick(now: number): void {
    rafId = 0
    if (disposed || !active) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    if (width === 0 || height === 0) {
      applySize()
      if (width === 0 || height === 0) return
    }
    controls.update()
    renderer.render(scene, camera)
    frames += 1
    const verdict = meter.noteFrame(now)
    if (verdict === 'degrade') {
      currentDpr = 1
      renderer.setPixelRatio(1)
      renderer.setSize(width, height, false)
      options.onPerformance('degraded')
    } else if (verdict === 'warn') {
      options.onPerformance('insufficient')
    }
  }

  function disposeOutline(): void {
    if (!outline) return
    assembly.parts.find((part) => part.id === selected)?.group.remove(outline)
    outlineGeometry?.dispose()
    ;(outline.material as LineBasicMaterial).dispose()
    outline = null
    outlineGeometry = null
  }

  function applySelected(partId: BuiltinPartId | null): void {
    for (const part of assembly.parts) {
      const isSelected = part.id === partId
      part.material.color.setHex(isSelected ? SELECT_COLOR : part.definition.color)
      part.material.emissive.setHex(isSelected ? SELECT_EMISSIVE : 0x000000)
      part.material.emissiveIntensity = isSelected ? 0.12 : 0
      part.material.needsUpdate = false
    }
    disposeOutline()
    if (partId) {
      const part = assembly.parts.find((item) => item.id === partId)
      if (part) {
        outlineGeometry = new EdgesGeometry(part.geometry, 25)
        outline = new LineSegments(outlineGeometry, new LineBasicMaterial({ color: EDGE_COLOR, depthWrite: false }))
        outline.name = `${partId}:outline`
        // 轮廓与表面共面会闪烁：微微外扩 0.15%，不改变几何顶点与任何参数。
        outline.scale.setScalar(1.0015)
        part.group.add(outline)
      }
    }
    invalidate()
  }

  const onControlsChange = () => {
    invalidate()
    scheduleEmitView()
  }
  const onControlsStart = () => {
    meter.setActive(true)
    invalidate()
  }
  const onControlsEnd = () => {
    meter.setActive(false)
    if (viewTimer !== null) {
      window.clearTimeout(viewTimer)
      viewTimer = null
    }
    emitView()
    invalidate()
  }
  controls.addEventListener('change', onControlsChange)
  controls.addEventListener('start', onControlsStart)
  controls.addEventListener('end', onControlsEnd)

  const activePointers = new Set<number>()
  let downSample: { x: number; y: number; pointerId: number } | null = null

  const onPointerDown = (event: PointerEvent) => {
    activePointers.add(event.pointerId)
    if (!canBeginPick(
      { button: event.button, pointerType: event.pointerType, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey },
      activePointers.size,
    )) {
      downSample = null
      return
    }
    downSample = { x: event.clientX, y: event.clientY, pointerId: event.pointerId }
  }

  const onPointerUp = (event: PointerEvent) => {
    activePointers.delete(event.pointerId)
    const sample = downSample
    downSample = null
    if (!sample || sample.pointerId !== event.pointerId || disposed || !active) return
    if (!isClickGesture(sample, { x: event.clientX, y: event.clientY })) return
    const rect = canvas.getBoundingClientRect()
    const ndc = ndcFromClient(event.clientX, event.clientY, rect)
    if (!ndc) return
    camera.updateMatrixWorld()
    assembly.root.updateMatrixWorld(true)
    raycaster.setFromCamera(new Vector2(ndc.x, ndc.y), camera)
    const hit = nearestPartHit(raycaster.intersectObjects(meshes, false))
    options.onSelectPart(hit ? hit.partId : null)
    invalidate()
  }

  const onPointerCancel = (event: PointerEvent) => {
    activePointers.delete(event.pointerId)
    downSample = null
  }

  const onContextLost = (event: Event) => {
    // preventDefault 让浏览器允许后续恢复；我们按不可用处理并等待用户重试。
    event.preventDefault()
    if (rafId !== 0) {
      window.cancelAnimationFrame(rafId)
      rafId = 0
    }
    meter.setActive(false)
    options.onContextLost()
  }

  const onVisibilityChange = () => {
    const visible = document.visibilityState !== 'hidden'
    meter.setVisible(visible)
    if (!visible) {
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId)
        rafId = 0
      }
      return
    }
    applySize()
    invalidate()
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerCancel)
  canvas.addEventListener('contextmenu', preventDefault)
  canvas.addEventListener('webglcontextlost', onContextLost)
  document.addEventListener('visibilitychange', onVisibilityChange)

  function preventDefault(event: Event): void {
    event.preventDefault()
  }

  const observer = new ResizeObserver(() => {
    applySize()
  })
  observer.observe(canvas)

  // 初始 pose：外部传入则沿用（切标签保留），否则按当前画布纵横比 framing。
  const incoming = normalizeViewState(options.view)
  const initialView = incoming ?? defaultViewForAspect(canvas.clientWidth > 0 && canvas.clientHeight > 0 ? canvas.clientWidth / canvas.clientHeight : 1.6)
  camera.position.set(...initialView.position)
  controls.target.set(...initialView.target)
  camera.zoom = initialView.zoom
  camera.updateProjectionMatrix()
  controls.update()
  applySelected(normalizeSelectedPartId(options.selectedPartId))
  applySize()
  invalidate()

  return {
    probe,
    setExplodeT(t: number) {
      if (disposed) return
      if (!Number.isFinite(t)) return
      assembly.setExplodeT(Math.min(1, Math.max(0, t)))
      invalidate()
    },
    setSelectedPartId(partId: BuiltinPartId | null) {
      if (disposed) return
      const next = normalizeSelectedPartId(partId)
      if (next === selected) return
      selected = next
      applySelected(next)
    },
    setSpacerDimensions(dimensions) {
      if (disposed) return
      assembly.setSpacerDimensions(dimensions)
      invalidate()
    },
    spacerLengthMm() {
      return assembly.spacerLengthMm()
    },
    setActive(next: boolean) {
      if (disposed) return
      active = next
      controls.enabled = next
      meter.setActive(false)
      if (!next) {
        if (rafId !== 0) {
          window.cancelAnimationFrame(rafId)
          rafId = 0
        }
        return
      }
      applySize()
      invalidate()
    },
    resetView() {
      if (disposed) return
      const aspect = height > 0 ? width / height : 1.6
      const view = defaultViewForAspect(aspect)
      camera.position.set(...view.position)
      controls.target.set(...view.target)
      camera.zoom = view.zoom
      camera.updateProjectionMatrix()
      controls.update()
      emitView()
      invalidate()
    },
    zoomBy(factor: number) {
      if (disposed || !Number.isFinite(factor) || factor <= 0) return
      camera.zoom = Math.min(8, Math.max(0.2, camera.zoom * factor))
      camera.updateProjectionMatrix()
      emitView()
      invalidate()
    },
    getView() {
      return readView()
    },
    frameCount() {
      return frames
    },
    dispose(forceContextLoss: boolean) {
      if (disposed) return
      disposed = true
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId)
        rafId = 0
      }
      if (viewTimer !== null) {
        window.clearTimeout(viewTimer)
        viewTimer = null
      }
      observer.disconnect()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerCancel)
      canvas.removeEventListener('contextmenu', preventDefault)
      canvas.removeEventListener('webglcontextlost', onContextLost)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      controls.removeEventListener('change', onControlsChange)
      controls.removeEventListener('start', onControlsStart)
      controls.removeEventListener('end', onControlsEnd)
      controls.dispose()
      disposeOutline()
      scene.remove(assembly.root)
      assembly.dispose()
      scene.clear()
      renderer.dispose()
      if (forceContextLoss) gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}

/** 供属性/工具条展示的部件名（避免组件重复查表）。 */
export function partDisplayName(id: BuiltinPartId): string {
  return demoPart(id).name
}

/** 组装 viewState 的可复制副本（对外只暴露纯数据）。 */
export function copyView(view: DemoViewState): DemoViewState {
  return cloneViewState(view)
}
