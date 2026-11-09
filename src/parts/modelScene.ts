/**
 * 导入 STL 的 WebGL 场景（V3-B2，GPU owner）。
 *
 * - 只接收已通过 `parseStl` 严格校验的 position/normal 数组，不再解析原始字节；
 * - 原顶点坐标直接进 BufferGeometry，不缩放、不居中改写；适配只动相机；
 * - 单一整体网格：拾取只有“整体选中/取消”，不做 STL group→部件映射；
 * - 按需 RAF，静止即停；dispose 幂等；contextlost 只降级 3D，不影响项目数据。
 */
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  type WebGLRendererParameters,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { FrameMeter } from './frameStats'
import { normalizeViewState, type DemoViewState } from './shaftDemo'

export interface ModelBounds {
  min: readonly [number, number, number]
  max: readonly [number, number, number]
}

export interface ModelSceneOptions {
  canvas: HTMLCanvasElement
  positions: Float32Array
  normals: Float32Array
  bounds: ModelBounds
  view: DemoViewState | null
  selected: boolean
  onSelect(selected: boolean): void
  onViewChange(view: DemoViewState): void
  onPerformance(level: 'degraded' | 'insufficient'): void
  onContextLost(): void
}

export interface ModelSceneProbe {
  webgl: 'webgl2'
  glVersion: string
  glRenderer: string
  dpr: number
}

export interface ModelSceneHandle {
  readonly probe: ModelSceneProbe
  setSelected(selected: boolean): void
  setActive(active: boolean): void
  resetView(): void
  zoomBy(factor: number): void
  getView(): DemoViewState
  frameCount(): number
  dispose(forceContextLoss: boolean): void
}

export class ModelSceneError extends Error {
  readonly code: 'WEBGL2_UNAVAILABLE' | 'RENDERER_INIT_FAILED'

  constructor(code: 'WEBGL2_UNAVAILABLE' | 'RENDERER_INIT_FAILED', message: string, detail?: string) {
    super(detail === undefined ? message : `${message}（${detail}）`)
    this.name = 'ModelSceneError'
    this.code = code
  }
}

const BACKGROUND = '#F5F7FA'
const SELECT_COLOR = 0xc7d2fe
const BASE_COLOR = 0xb9c3cf
const FOV = 45
const NEAR = 0.01
const DEG2RAD = Math.PI / 180

/** 包围盒 8 角点全部进视锥所需距离（四周 10% 留白）。 */
export function framingDistanceForBounds(
  bounds: ModelBounds,
  aspect: number,
  direction: Vector3,
): number {
  const safeAspect = Number.isFinite(aspect) && aspect > 0.2 ? aspect : 1
  const tanV = Math.tan((FOV * DEG2RAD) / 2)
  const tanH = tanV * safeAspect
  const margin = 1.1
  const forward = direction.clone().normalize().negate()
  const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize()
  const up = new Vector3().crossVectors(right, forward).normalize()
  const center = new Vector3(
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  )
  let distance = 1e-3
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) {
        const corner = new Vector3(x, y, z).sub(center)
        const u = corner.dot(right)
        const v = corner.dot(up)
        const w = corner.dot(forward)
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

export function defaultModelView(bounds: ModelBounds, aspect: number): DemoViewState {
  const direction = new Vector3(0.85, 0.42, 1).normalize()
  const distance = framingDistanceForBounds(bounds, aspect, direction)
  const center = new Vector3(
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  )
  return {
    position: [
      center.x + direction.x * distance,
      center.y + direction.y * distance,
      center.z + direction.z * distance,
    ],
    target: [center.x, center.y, center.z],
    zoom: 1,
  }
}

function glString(gl: WebGL2RenderingContext, name: number): string {
  const value = gl.getParameter(name)
  return typeof value === 'string' ? String(value) : String(value)
}

export function createModelScene(options: ModelSceneOptions): ModelSceneHandle {
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
    throw new ModelSceneError('WEBGL2_UNAVAILABLE', '当前环境无法创建 WebGL2 上下文')
  }
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info')
  const probe: ModelSceneProbe = {
    webgl: 'webgl2',
    glVersion: glString(gl, gl.VERSION),
    glRenderer: debugInfo ? glString(gl, debugInfo.UNMASKED_RENDERER_WEBGL) : '扩展不可用',
    dpr: Math.min(globalThis.devicePixelRatio || 1, 2),
  }

  let renderer: WebGLRenderer
  try {
    const params: WebGLRendererParameters = { canvas, context: gl, antialias: true }
    renderer = new WebGLRenderer(params)
  } catch (error) {
    throw new ModelSceneError(
      'RENDERER_INIT_FAILED',
      'WebGLRenderer 初始化失败',
      error instanceof Error ? error.message : String(error),
    )
  }
  renderer.setPixelRatio(probe.dpr)
  renderer.setClearColor(new Color(BACKGROUND), 1)

  const scene = new Scene()
  scene.background = new Color(BACKGROUND)
  const camera = new PerspectiveCamera(FOV, 1, NEAR, 100000)

  scene.add(new AmbientLight(0xffffff, 1.1))
  scene.add(new HemisphereLight(0xffffff, 0x6b7a90, 1.2))
  const key = new DirectionalLight(0xffffff, 2.1)
  key.position.set(1, 1.4, 1.2)
  const fill = new DirectionalLight(0xdfe7f5, 0.8)
  fill.position.set(-1.4, -0.8, -1)
  scene.add(key, fill)

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(options.positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(options.normals, 3))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  const material = new MeshStandardMaterial({
    color: BASE_COLOR,
    metalness: 0.15,
    roughness: 0.55,
    side: DoubleSide,
  })
  const mesh = new Mesh(geometry, material)
  mesh.name = 'imported-model'
  scene.add(mesh)

  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = false
  controls.autoRotate = false
  const span = Math.max(
    options.bounds.max[0] - options.bounds.min[0],
    options.bounds.max[1] - options.bounds.min[1],
    options.bounds.max[2] - options.bounds.min[2],
  )
  controls.minDistance = Math.max(span * 0.02, 1e-3)
  controls.maxDistance = Math.max(span * 50, 1)

  const raycaster = new Raycaster()
  const meter = new FrameMeter()
  let active = true
  let disposed = false
  let rafId = 0
  let frames = 0
  let width = 0
  let height = 0
  let selected = options.selected
  let viewTimer: number | null = null

  function readView(): DemoViewState {
    return {
      position: [camera.position.x, camera.position.y, camera.position.z],
      target: [controls.target.x, controls.target.y, controls.target.z],
      zoom: camera.zoom,
    }
  }

  function applySelected(next: boolean): void {
    selected = next
    material.color.setHex(next ? SELECT_COLOR : BASE_COLOR)
    material.emissive.setHex(next ? 0x3730a3 : 0x000000)
    material.emissiveIntensity = next ? 0.12 : 0
    material.needsUpdate = false
    invalidate()
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
    renderer.setPixelRatio(probe.dpr)
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
    if (width === 0 || height === 0) {
      applySize()
      if (width === 0 || height === 0) return
    }
    controls.update()
    renderer.render(scene, camera)
    frames += 1
    const verdict = meter.noteFrame(now)
    if (verdict === 'degrade') {
      renderer.setPixelRatio(1)
      renderer.setSize(width, height, false)
      options.onPerformance('degraded')
    } else if (verdict === 'warn') {
      options.onPerformance('insufficient')
    }
  }

  const scheduleEmitView = (): void => {
    if (viewTimer !== null) window.clearTimeout(viewTimer)
    viewTimer = window.setTimeout(() => {
      viewTimer = null
      if (!disposed) options.onViewChange(readView())
    }, 80)
  }
  const onControlsChange = (): void => {
    invalidate()
    scheduleEmitView()
  }
  const onControlsStart = (): void => {
    meter.setActive(true)
    invalidate()
  }
  const onControlsEnd = (): void => {
    meter.setActive(false)
    if (viewTimer !== null) {
      window.clearTimeout(viewTimer)
      viewTimer = null
    }
    if (!disposed) options.onViewChange(readView())
    invalidate()
  }
  controls.addEventListener('change', onControlsChange)
  controls.addEventListener('start', onControlsStart)
  controls.addEventListener('end', onControlsEnd)

  let downSample: { x: number; y: number; pointerId: number } | null = null
  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey) {
      downSample = null
      return
    }
    downSample = { x: event.clientX, y: event.clientY, pointerId: event.pointerId }
  }
  const onPointerUp = (event: PointerEvent): void => {
    const sample = downSample
    downSample = null
    if (sample === null || sample.pointerId !== event.pointerId || disposed || !active) return
    if (Math.hypot(event.clientX - sample.x, event.clientY - sample.y) > 4) return
    const rect = canvas.getBoundingClientRect()
    if (!(rect.width > 0) || !(rect.height > 0)) return
    const ndc = new Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    )
    camera.updateMatrixWorld()
    mesh.updateMatrixWorld(true)
    raycaster.setFromCamera(ndc, camera)
    const hit = raycaster.intersectObject(mesh, false).length > 0
    options.onSelect(hit)
    applySelected(hit)
  }
  const onContextLost = (event: Event): void => {
    event.preventDefault()
    if (rafId !== 0) {
      window.cancelAnimationFrame(rafId)
      rafId = 0
    }
    meter.setActive(false)
    options.onContextLost()
  }
  const preventDefault = (event: Event): void => {
    event.preventDefault()
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', () => { downSample = null })
  canvas.addEventListener('contextmenu', preventDefault)
  canvas.addEventListener('webglcontextlost', onContextLost)
  const observer = new ResizeObserver(() => applySize())
  observer.observe(canvas)

  const incoming = normalizeViewState(options.view)
  const initialView =
    incoming ?? defaultModelView(options.bounds, width > 0 && height > 0 ? width / height : 1.6)
  camera.position.set(...initialView.position)
  controls.target.set(...initialView.target)
  camera.zoom = initialView.zoom
  camera.updateProjectionMatrix()
  controls.update()
  applySelected(selected)
  applySize()
  invalidate()

  return {
    probe,
    setSelected(next: boolean) {
      if (disposed) return
      if (next === selected) return
      applySelected(next)
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
      const view = defaultModelView(options.bounds, height > 0 ? width / height : 1.6)
      camera.position.set(...view.position)
      controls.target.set(...view.target)
      camera.zoom = view.zoom
      camera.updateProjectionMatrix()
      controls.update()
      options.onViewChange(readView())
      invalidate()
    },
    zoomBy(factor: number) {
      if (disposed || !Number.isFinite(factor) || factor <= 0) return
      camera.zoom = Math.min(8, Math.max(0.05, camera.zoom * factor))
      camera.updateProjectionMatrix()
      options.onViewChange(readView())
      invalidate()
    },
    getView: readView,
    frameCount: () => frames,
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
      canvas.removeEventListener('contextmenu', preventDefault)
      canvas.removeEventListener('webglcontextlost', onContextLost)
      controls.removeEventListener('change', onControlsChange)
      controls.removeEventListener('start', onControlsStart)
      controls.removeEventListener('end', onControlsEnd)
      controls.dispose()
      scene.remove(mesh)
      geometry.dispose()
      material.dispose()
      scene.clear()
      renderer.dispose()
      if (forceContextLoss) gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}
