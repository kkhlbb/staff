import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import {
  AmbientLight,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Uint32BufferAttribute,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import {
  applyPartGroupTransform,
  applyVertexColorField,
  applyVertexDisplacementField,
  computeAssemblyBounds,
  computeAssemblyCentroid,
  computePartExplodedMatrix4,
} from './assembly3dMath'
import type {
  Css2dAnnotationItem,
  DatumDefinition,
  DeformationViewMode,
  GdtDisplayMode,
  GdtFeatureControl,
  PartDisplacementField,
  PartEdgeSegment,
  PartMesh,
  PickedFeatureGeometryKind,
  VertexColorFieldChannel,
  VertexDisplacementChannel,
} from './assembly3dTypes'
import type { ReportViewportSnapshots } from '../../report/types'
import { Gdt3dOverlayLayer, type ProjectedGdtAnchor } from './components/Gdt3dOverlayLayer'
import { computeFeatureWorldAnchor, type GdtCalloutPatch } from './gdt3dMath'
import {
  applyExaggeratedDisplacement,
  buildVertexColorBuffer,
  computeAnimationPhase,
  interpolatePartDisplacementField,
  mapNormalizedValueToTurboColor,
  turboRgbToCssHex,
  type InterpolatedPartDisplacement,
} from './physics3dMath'
import {
  resolveMeshTrianglePick,
  type M2CameraState,
  type M2MeshTriangleRange,
  type M2ModelMesh,
} from './m2WorkbenchBridge'

export interface AssemblyPickPayload {
  readonly objectId: string
  readonly partId: string
  readonly partName: string
  readonly featureLabel: string
  readonly geometryKind: PickedFeatureGeometryKind
  readonly additive: boolean
}

export interface ViewportSnapshotHandle {
  captureSnapshots(): ReportViewportSnapshots
}

export interface M2ThreeMeshViewportProps {
  readonly modelMesh: M2ModelMesh
  readonly camera: M2CameraState
  readonly selectedObjectId: string | null
  readonly selectedObjectIds?: readonly string[]
  readonly highlightedFeatureIds: ReadonlySet<string>
  readonly theme?: 'light' | 'dark'
  readonly onPickRange: (range: M2MeshTriangleRange) => void
  readonly onUpdateCamera: (updater: (prev: M2CameraState) => M2CameraState) => void
  /** M1B multi-part 3D assembly extensions (inactive when omitted). */
  readonly partMeshes?: readonly PartMesh[]
  readonly explosionFactor?: number
  readonly xrayMode?: boolean
  readonly hiddenPartIds?: ReadonlySet<string>
  readonly additivePickMode?: boolean
  readonly onPickAssemblyFeature?: (payload: AssemblyPickPayload) => void
  /** M3 pre-wired CSS2DRenderer annotation container & items. */
  readonly annotationLayerRef?: RefObject<HTMLDivElement | null>
  readonly css2dAnnotations?: readonly Css2dAnnotationItem[]
  /** M3G 3D GD&T Feature Control Frames, Datums & interactive overlay props. */
  readonly gdtControls?: readonly GdtFeatureControl[]
  readonly datums?: readonly DatumDefinition[]
  readonly gdtPreviewControls?: readonly GdtFeatureControl[]
  readonly gdtPreviewDatums?: readonly DatumDefinition[]
  readonly gdtDisplayMode?: GdtDisplayMode
  readonly onChangeGdtDisplayMode?: (mode: GdtDisplayMode) => void
  readonly focusedLoopFeatureIds?: ReadonlySet<string>
  readonly goldenPulseFeatureIds?: ReadonlySet<string>
  readonly goldenPulseGdtIds?: ReadonlySet<string>
  readonly gdtReadOnly?: boolean
  readonly editingGdtId?: string | null
  readonly onSelectGdtCallout?: (gdtId: string | null) => void
  readonly onHoverGdtCallout?: (
    target: {
      readonly gdtId?: string
      readonly datumId?: string
      readonly featureId: string
      readonly partId?: string
    } | null,
  ) => void
  readonly onUpdateGdtCallout?: (
    gdtId: string,
    patch: GdtCalloutPatch,
  ) => void
  readonly onDeleteGdtCallout?: (gdtId: string) => void
  /** Optional handle ref exposing on-demand 3D PNG snapshot capture (nominal & heatmap). */
  readonly snapshotHandleRef?: { current: ViewportSnapshotHandle | null }
  /** M4 pre-wired BufferGeometry vertexColors & displacement channels. */
  readonly colorFieldChannels?: readonly VertexColorFieldChannel[]
  readonly displacementChannels?: readonly VertexDisplacementChannel[]
  /** M4F1 compliant deformation heatmap & 60fps exaggerated animation props. */
  readonly displacementFields?: readonly PartDisplacementField[]
  readonly deformationMode?: DeformationViewMode
  readonly onChangeDeformationMode?: (mode: DeformationViewMode) => void
  readonly exaggerationScale?: number
  readonly onChangeExaggerationScale?: (scale: number) => void
  readonly showDeformationControls?: boolean
  readonly hideDeformationControlsInViewport?: boolean
  readonly hideGdtModeToggle?: boolean
  readonly animationPlaying?: boolean
  readonly onToggleAnimationPlaying?: () => void
}

const DEG2RAD = Math.PI / 180

function computeBoundsCenterAndRadius(bounds: {
  readonly min: readonly [number, number, number]
  readonly max: readonly [number, number, number]
}): {
  readonly center: readonly [number, number, number]
  readonly radius: number
} {
  const { min, max } = bounds
  const cx = (min[0] + max[0]) / 2
  const cy = (min[1] + max[1]) / 2
  const cz = (min[2] + max[2]) / 2
  const dx = max[0] - min[0]
  const dy = max[1] - min[1]
  const dz = max[2] - min[2]
  const radius = Math.max(1, Math.hypot(dx, dy, dz) / 2)
  return { center: [cx, cy, cz], radius }
}

function buildBufferGeometryFromRaw(
  positions: readonly number[] | Float32Array,
  indices: readonly number[] | Uint32Array | Uint16Array,
  normals?: readonly number[] | Float32Array,
): { readonly geometry: BufferGeometry; readonly basePositions: Float32Array } {
  const geom = new BufferGeometry()
  const posArray = positions instanceof Float32Array ? new Float32Array(positions) : new Float32Array(positions)
  const idxArray = indices instanceof Uint32Array ? indices : new Uint32Array(indices)
  geom.setAttribute('position', new Float32BufferAttribute(posArray, 3))
  geom.setIndex(new Uint32BufferAttribute(idxArray, 1))
  if (normals && normals.length === posArray.length) {
    const normArray = normals instanceof Float32Array ? normals : new Float32Array(normals)
    geom.setAttribute('normal', new Float32BufferAttribute(normArray, 3))
  } else {
    geom.computeVertexNormals()
  }
  geom.computeBoundingSphere()
  return { geometry: geom, basePositions: new Float32Array(posArray) }
}

function buildHighlightGeometry(
  positions: readonly number[] | Float32Array,
  indices: readonly number[] | Uint32Array | Uint16Array,
  triangleRanges: readonly M2MeshTriangleRange[],
  highlightedFeatureIds: ReadonlySet<string>,
): BufferGeometry | null {
  if (highlightedFeatureIds.size === 0 || triangleRanges.length === 0) {
    return null
  }
  const highlightedIndices: number[] = []
  const totalTriangles = Math.floor(indices.length / 3)
  for (const range of triangleRanges) {
    if (!highlightedFeatureIds.has(range.objectId)) continue
    const start = Math.max(0, range.startTriangle)
    const end = Math.min(totalTriangles, range.endTriangle)
    for (let t = start; t < end; t += 1) {
      highlightedIndices.push(indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2])
    }
  }
  if (highlightedIndices.length === 0) return null
  const geom = new BufferGeometry()
  const posArray = positions instanceof Float32Array ? positions : new Float32Array(positions)
  geom.setAttribute('position', new Float32BufferAttribute(posArray, 3))
  geom.setIndex(new Uint32BufferAttribute(new Uint32Array(highlightedIndices), 1))
  geom.computeVertexNormals()
  return geom
}

function positionCameraFromState(
  threeCamera: PerspectiveCamera,
  cameraState: M2CameraState,
  center: readonly [number, number, number],
  radius: number,
  orbitControls?: OrbitControls | null,
): void {
  const yawRad = cameraState.yawDeg * DEG2RAD
  const pitchRad = Math.max(-85, Math.min(85, cameraState.pitchDeg)) * DEG2RAD
  const zoomScale = Math.max(0.4, Math.min(3, cameraState.zoomPercent / 100))
  const distance = (radius * 2.8) / zoomScale
  const cosPitch = Math.cos(pitchRad)
  const x = center[0] + distance * cosPitch * Math.sin(yawRad)
  const y = center[1] + distance * Math.sin(pitchRad)
  const z = center[2] + distance * cosPitch * Math.cos(yawRad)
  threeCamera.position.set(x, y, z)
  if (orbitControls) {
    orbitControls.target.set(center[0], center[1], center[2])
    orbitControls.update()
  } else {
    threeCamera.lookAt(center[0], center[1], center[2])
  }
  threeCamera.updateMatrixWorld()
}

function projectPointFallback(
  x: number,
  y: number,
  z: number,
  center: readonly [number, number, number],
  radius: number,
  camera: M2CameraState,
): readonly [number, number] {
  const yaw = camera.yawDeg * DEG2RAD
  const pitch = Math.max(-85, Math.min(85, camera.pitchDeg)) * DEG2RAD
  const dx = x - center[0]
  const dy = y - center[1]
  const dz = z - center[2]
  const cosY = Math.cos(yaw)
  const sinY = Math.sin(yaw)
  const rx = dx * cosY - dz * sinY
  const rz1 = dx * sinY + dz * cosY
  const cosP = Math.cos(pitch)
  const sinP = Math.sin(pitch)
  const ry = dy * cosP - rz1 * sinP
  const scale = (90 / Math.max(1, radius)) * (camera.zoomPercent / 100)
  return [160 + rx * scale, 110 - ry * scale]
}

interface PartSceneEntry {
  readonly part: PartMesh
  readonly group: Group
  readonly mesh: Mesh
  readonly geometry: BufferGeometry
  readonly basePositions: Float32Array
  readonly material: MeshStandardMaterial
  readonly edgeLines: LineSegments
  readonly featureEdgeSegments: Array<{ readonly segment: PartEdgeSegment; readonly lines: LineSegments }>
  highlightMesh: Mesh | null
  highlightGeometry: BufferGeometry | null
  cachedColorBuffer: Float32Array | null
}

interface ThreeSceneController {
  updateSingleMesh(mesh: M2ModelMesh, highlighted: ReadonlySet<string>): void
  updatePartsGeometry(
    parts: readonly PartMesh[],
    highlighted: ReadonlySet<string>,
    explosionFactor: number,
    xrayMode: boolean,
    hiddenPartIds?: ReadonlySet<string>,
  ): void
  updatePartsTransforms(
    parts: readonly PartMesh[],
    explosionFactor: number,
    hiddenPartIds?: ReadonlySet<string>,
  ): void
  updatePartsAppearance(
    highlighted: ReadonlySet<string>,
    xrayMode: boolean,
  ): void
  applyM4Channels(
    colorChannels?: readonly VertexColorFieldChannel[],
    displacementChannels?: readonly VertexDisplacementChannel[],
  ): void
  applyDeformationVisuals(
    mode: DeformationViewMode,
    interpolatedByPart: ReadonlyMap<string, InterpolatedPartDisplacement>,
    globalMaxMm: number,
    scale: number,
    phase: number,
  ): void
  updateCamera(
    camera: M2CameraState,
    bounds: { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] },
  ): void
  updateCss2dAnchors(
    anchors: ReadonlyArray<{
      readonly id: string
      readonly label: string
      readonly position: readonly [number, number, number]
    }>,
  ): void
  updateTheme(theme: 'light' | 'dark'): void
  captureSnapshots(hasDisplacementFields: boolean): ReportViewportSnapshots
  dispose(): void
}

function canAttemptWebGL(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false
  }
  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) {
    return false
  }
  return (
    typeof WebGL2RenderingContext !== 'undefined' ||
    typeof WebGLRenderingContext !== 'undefined'
  )
}

export function M2ThreeMeshViewport({
  modelMesh,
  camera,
  selectedObjectId,
  selectedObjectIds,
  highlightedFeatureIds,
  theme = 'light',
  onPickRange,
  onUpdateCamera,
  partMeshes,
  explosionFactor = 0,
  xrayMode = false,
  hiddenPartIds,
  additivePickMode = false,
  onPickAssemblyFeature,
  annotationLayerRef,
  css2dAnnotations = [],
  gdtControls = [],
  datums = [],
  gdtPreviewControls = [],
  gdtPreviewDatums = [],
  gdtDisplayMode = 'smart',
  onChangeGdtDisplayMode,
  focusedLoopFeatureIds,
  goldenPulseFeatureIds,
  goldenPulseGdtIds,
  gdtReadOnly = false,
  editingGdtId = null,
  onSelectGdtCallout,
  onHoverGdtCallout,
  onUpdateGdtCallout,
  onDeleteGdtCallout,
  colorFieldChannels,
  displacementChannels,
  displacementFields,
  deformationMode: deformationModeProp,
  onChangeDeformationMode,
  exaggerationScale: exaggerationScaleProp,
  onChangeExaggerationScale,
  showDeformationControls,
  hideDeformationControlsInViewport = false,
  hideGdtModeToggle = false,
  animationPlaying: animationPlayingProp,
  onToggleAnimationPlaying,
  snapshotHandleRef,
}: M2ThreeMeshViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const css2dHostRef = useRef<HTMLDivElement | null>(null)
  const controllerRef = useRef<ThreeSceneController | null>(null)
  const [renderMode, setRenderMode] = useState<'webgl' | 'fallback'>(() =>
    canAttemptWebGL() ? 'webgl' : 'fallback',
  )
  const [localDeformationMode, setLocalDeformationMode] = useState<DeformationViewMode>('nominal')
  const [localExaggerationScale, setLocalExaggerationScale] = useState<number>(25)
  const [localAnimationPlaying, setLocalAnimationPlaying] = useState<boolean>(true)
  const isAnimationPlaying = animationPlayingProp ?? localAnimationPlaying
  const toggleAnimationPlaying = () => {
    if (onToggleAnimationPlaying) onToggleAnimationPlaying()
    else setLocalAnimationPlaying((prev) => !prev)
  }
  const [deformationEmptyHint, setDeformationEmptyHint] = useState<string | null>(null)
  const isMultiPart = Boolean(partMeshes && partMeshes.length > 0)

  const effectiveDeformationMode: DeformationViewMode = deformationModeProp ?? localDeformationMode
  const effectiveExaggerationScale = Math.max(
    1,
    Math.min(50, exaggerationScaleProp ?? localExaggerationScale),
  )

  useEffect(() => {
    if (!snapshotHandleRef) return
    const hasFields = Boolean(displacementFields && displacementFields.length > 0)
    snapshotHandleRef.current = {
      captureSnapshots: () => {
        if (renderMode !== 'webgl' || !controllerRef.current) return {}
        return controllerRef.current.captureSnapshots(hasFields)
      },
    }
    return () => {
      snapshotHandleRef.current = null
    }
  }, [snapshotHandleRef, renderMode, displacementFields])
  const displayDeformationHud =
    showDeformationControls ?? (isMultiPart || Boolean(displacementFields && displacementFields.length > 0))

  // Pre-compute per-part interpolated displacement fields (zero rebuild of BufferGeometry!)
  const { interpolatedByPart, globalMaxDisplacementMm } = useMemo(() => {
    const map = new Map<string, InterpolatedPartDisplacement>()
    let globalMax = 0
    if (!displacementFields || displacementFields.length === 0) {
      return { interpolatedByPart: map, globalMaxDisplacementMm: 0 }
    }
    const fieldByPart = new Map(displacementFields.map((f) => [f.partId, f]))
    if (isMultiPart && partMeshes) {
      for (const part of partMeshes) {
        const field = fieldByPart.get(part.partId)
        if (!field) continue
        const interp = interpolatePartDisplacementField(part.positions, field)
        map.set(part.partId, interp)
        if (interp.maxDisplacementMm > globalMax) globalMax = interp.maxDisplacementMm
      }
    } else {
      for (const field of displacementFields) {
        if (field.maxDisplacementMm > globalMax) globalMax = field.maxDisplacementMm
      }
    }
    return { interpolatedByPart: map, globalMaxDisplacementMm: globalMax }
  }, [displacementFields, isMultiPart, partMeshes])

  const handleSelectDeformationMode = (nextMode: DeformationViewMode) => {
    const hasFields = Boolean(displacementFields && displacementFields.length > 0 && globalMaxDisplacementMm > 1e-6)
    if (nextMode !== 'nominal' && !hasFields) {
      setDeformationEmptyHint('当前暂无柔性形变位移场，请先选中零件「开启/配置柔性形变」。')
    } else {
      setDeformationEmptyHint(null)
    }
    if (nextMode === 'animation') {
      setLocalAnimationPlaying(true)
    }
    if (onChangeDeformationMode) {
      onChangeDeformationMode(nextMode)
    } else {
      setLocalDeformationMode(nextMode)
    }
  }

  const handleChangeExaggeration = (nextScale: number) => {
    const clamped = Math.max(1, Math.min(50, Math.round(nextScale)))
    if (onChangeExaggerationScale) {
      onChangeExaggerationScale(clamped)
    } else {
      setLocalExaggerationScale(clamped)
    }
  }

  // Stable key representing part geometry identity (excludes explosionFactor & nominalTransform)
  const partGeometryIdentity = useMemo(() => {
    if (!partMeshes || partMeshes.length === 0) return ''
    return partMeshes
      .map((p) => `${p.partId}:${p.positions.length}:${p.indices.length}`)
      .join('|')
  }, [partMeshes])

  // Track BufferGeometry build count without triggering re-renders on pure matrix updates
  const geometryBuildCount = useMemo(() => {
    return isMultiPart ? (partGeometryIdentity ? 1 : 0) : 1
  }, [isMultiPart, partGeometryIdentity])

  const modelMeshRef = useRef(modelMesh)
  const partMeshesRef = useRef(partMeshes)
  const cameraRef = useRef(camera)
  const highlightedRef = useRef(highlightedFeatureIds)
  const themeRef = useRef(theme)
  const explosionRef = useRef(explosionFactor)
  const xrayRef = useRef(xrayMode)
  const hiddenPartsRef = useRef(hiddenPartIds)
  const additiveRef = useRef(additivePickMode)
  const onPickRangeRef = useRef(onPickRange)
  const onPickAssemblyRef = useRef(onPickAssemblyFeature)
  const onUpdateCameraRef = useRef(onUpdateCamera)

  useEffect(() => {
    themeRef.current = theme
    controllerRef.current?.updateTheme(theme)
  }, [theme])

  useEffect(() => {
    modelMeshRef.current = modelMesh
  }, [modelMesh])

  useEffect(() => {
    partMeshesRef.current = partMeshes
  }, [partMeshes])

  useEffect(() => {
    cameraRef.current = camera
  }, [camera])

  useEffect(() => {
    highlightedRef.current = highlightedFeatureIds
  }, [highlightedFeatureIds])

  useEffect(() => {
    explosionRef.current = explosionFactor
  }, [explosionFactor])

  useEffect(() => {
    xrayRef.current = xrayMode
  }, [xrayMode])

  useEffect(() => {
    hiddenPartsRef.current = hiddenPartIds
  }, [hiddenPartIds])

  useEffect(() => {
    additiveRef.current = additivePickMode
  }, [additivePickMode])

  useEffect(() => {
    onPickRangeRef.current = onPickRange
  }, [onPickRange])

  useEffect(() => {
    onPickAssemblyRef.current = onPickAssemblyFeature
  }, [onPickAssemblyFeature])

  useEffect(() => {
    onUpdateCameraRef.current = onUpdateCamera
  }, [onUpdateCamera])

  // Initialize Three.js WebGLRenderer + OrbitControls once when mounted; degrade gracefully if WebGL is unavailable.
  useEffect(() => {
    if (renderMode !== 'webgl') return
    const canvas = canvasRef.current
    if (!canvas) return

    let gl: WebGL2RenderingContext | WebGLRenderingContext | null
    try {
      gl =
        (canvas.getContext('webgl2', { antialias: true, alpha: false }) as WebGL2RenderingContext | null) ??
        (canvas.getContext('webgl', { antialias: true, alpha: false }) as WebGLRenderingContext | null)
    } catch {
      gl = null
    }

    if (!gl) {
      queueMicrotask(() => setRenderMode('fallback'))
      return
    }

    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ canvas, context: gl, antialias: true })
    } catch {
      queueMicrotask(() => setRenderMode('fallback'))
      return
    }

    const initialDark = themeRef.current === 'dark'
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2))
    renderer.setClearColor(new Color(initialDark ? '#0B0E14' : '#EEF1F5'), 1)

    const scene = new Scene()
    scene.background = new Color(initialDark ? '#0B0E14' : '#EEF1F5')
    const threeCamera = new PerspectiveCamera(42, 16 / 10, 0.1, 10000)

    const orbitControls = new OrbitControls(threeCamera, canvas)
    orbitControls.enableDamping = true
    orbitControls.dampingFactor = 0.08
    orbitControls.enablePan = true
    orbitControls.enableZoom = true

    const ambient = new AmbientLight(0xffffff, 0.95)
    const hemi = new HemisphereLight(0xfaf9f6, 0x5a5853, 0.95)
    const key = new DirectionalLight(0xfffaf4, 1.65)
    key.position.set(120, 180, 140)
    const fill = new DirectionalLight(0xf2f0ea, 0.65)
    fill.position.set(-140, -80, -100)
    scene.add(ambient, hemi, key, fill)

    const primaryMaterial = new MeshStandardMaterial({
      color: initialDark ? 0x6c6a63 : 0xc4c0b6,
      metalness: 0.08,
      roughness: 0.72,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    })
    const edgeMaterial = new LineBasicMaterial({ color: initialDark ? 0x9d9a92 : 0x625f57 })
    const featureEdgeMaterial = new LineBasicMaterial({ color: 0xcfa15c })
    const highlightMaterial = new MeshStandardMaterial({
      color: initialDark ? 0xcc785c : 0xb85d3e,
      emissive: initialDark ? 0x7c3e2b : 0x6e311d,
      emissiveIntensity: 0.32,
      metalness: 0.08,
      roughness: 0.52,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })

    // Single-part meshes
    const singleGroup = new Group()
    let { geometry: primaryGeometry } = buildBufferGeometryFromRaw(
      modelMeshRef.current.positions,
      modelMeshRef.current.indices,
      modelMeshRef.current.normals,
    )
    const primaryMesh = new Mesh(primaryGeometry, primaryMaterial)
    singleGroup.add(primaryMesh)

    let edgeGeometry = new EdgesGeometry(primaryGeometry, 25)
    const edgeLines = new LineSegments(edgeGeometry, edgeMaterial)
    singleGroup.add(edgeLines)

    let highlightGeometry = buildHighlightGeometry(
      modelMeshRef.current.positions,
      modelMeshRef.current.indices,
      modelMeshRef.current.triangleRanges,
      highlightedRef.current,
    )
    let highlightMesh: Mesh | null = null
    if (highlightGeometry) {
      highlightMesh = new Mesh(highlightGeometry, highlightMaterial)
      singleGroup.add(highlightMesh)
    }
    scene.add(singleGroup)

    // Multi-part assembly groups
    const assemblyRoot = new Group()
    scene.add(assemblyRoot)
    const partEntries = new Map<string, PartSceneEntry>()

    // Three.js CSS2DRenderer for 3D-tracked GD&T surface anchor nodes
    const css2dGroup = new Group()
    scene.add(css2dGroup)
    const css2dRenderer = new CSS2DRenderer()
    css2dRenderer.domElement.className = 'pa-three-css2d-dom'
    css2dRenderer.domElement.style.position = 'absolute'
    css2dRenderer.domElement.style.top = '0'
    css2dRenderer.domElement.style.left = '0'
    css2dRenderer.domElement.style.pointerEvents = 'none'
    const css2dHost = css2dHostRef.current
    if (css2dHost) {
      css2dHost.appendChild(css2dRenderer.domElement)
    }

    const raycaster = new Raycaster()
    raycaster.params.Line = { threshold: 2.5 }
    let rafId = 0
    let disposed = false

    const renderFrame = () => {
      rafId = 0
      if (disposed) return
      const width = canvas.clientWidth || 320
      const height = canvas.clientHeight || 220
      threeCamera.aspect = width / height
      threeCamera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
      renderer.render(scene, threeCamera)
      css2dRenderer.setSize(width, height)
      css2dRenderer.render(scene, threeCamera)
    }

    const scheduleRender = () => {
      if (disposed || rafId !== 0) return
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        rafId = window.requestAnimationFrame(renderFrame)
      } else {
        renderFrame()
      }
    }

    const onControlsChange = () => {
      scheduleRender()
    }
    orbitControls.addEventListener('change', onControlsChange)

    const disposeParts = () => {
      for (const entry of partEntries.values()) {
        assemblyRoot.remove(entry.group)
        entry.geometry.dispose()
        entry.material.dispose()
        entry.edgeLines.geometry.dispose()
        for (const seg of entry.featureEdgeSegments) {
          seg.lines.geometry.dispose()
        }
        entry.highlightGeometry?.dispose()
      }
      partEntries.clear()
    }

    const rebuildParts = (
      parts: readonly PartMesh[],
      highlighted: ReadonlySet<string>,
      explode: number,
      xray: boolean,
      hidden?: ReadonlySet<string>,
    ) => {
      disposeParts()
      const centroid = computeAssemblyCentroid(parts)
      for (const part of parts) {
        const group = new Group()
        const { geometry, basePositions } = buildBufferGeometryFromRaw(
          part.positions,
          part.indices,
          part.normals,
        )
        const material = new MeshStandardMaterial({
          color: new Color(part.color),
          metalness: 0.08,
          roughness: 0.68,
          side: DoubleSide,
          transparent: xray,
          opacity: xray ? 0.28 : 1,
          depthWrite: !xray,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        })
        const mesh = new Mesh(geometry, material)
        mesh.userData = { partId: part.partId }
        group.add(mesh)

        const edges = new LineSegments(new EdgesGeometry(geometry, 25), edgeMaterial)
        group.add(edges)

        const featureEdgeSegments: Array<{ readonly segment: PartEdgeSegment; readonly lines: LineSegments }> = []
        for (const seg of part.edgeSegments ?? []) {
          const segGeom = new BufferGeometry()
          segGeom.setAttribute('position', new Float32BufferAttribute(new Float32Array(seg.points), 3))
          const segLines = new LineSegments(segGeom, featureEdgeMaterial)
          segLines.userData = { segment: seg }
          group.add(segLines)
          featureEdgeSegments.push({ segment: seg, lines: segLines })
        }

        const hlGeom = buildHighlightGeometry(
          part.positions,
          part.indices,
          part.faceTriangleRanges,
          highlighted,
        )
        let hlMesh: Mesh | null = null
        if (hlGeom) {
          hlMesh = new Mesh(hlGeom, highlightMaterial)
          hlMesh.renderOrder = 2
          group.add(hlMesh)
        }

        const matrix = computePartExplodedMatrix4(part, centroid, explode)
        applyPartGroupTransform(group, matrix)
        group.visible = !hidden?.has(part.partId)
        assemblyRoot.add(group)

        partEntries.set(part.partId, {
          part,
          group,
          mesh,
          geometry,
          basePositions,
          material,
          edgeLines: edges,
          featureEdgeSegments,
          highlightMesh: hlMesh,
          highlightGeometry: hlGeom,
          cachedColorBuffer: null,
        })
      }
      singleGroup.visible = parts.length === 0
      assemblyRoot.visible = parts.length > 0
      scheduleRender()
    }

    const syncCamera = (
      camState: M2CameraState,
      bounds: { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] },
    ) => {
      const { center, radius } = computeBoundsCenterAndRadius(bounds)
      positionCameraFromState(threeCamera, camState, center, radius, orbitControls)
      scheduleRender()
    }

    if (partMeshesRef.current && partMeshesRef.current.length > 0) {
      rebuildParts(
        partMeshesRef.current,
        highlightedRef.current,
        explosionRef.current,
        xrayRef.current,
        hiddenPartsRef.current,
      )
      syncCamera(
        cameraRef.current,
        computeAssemblyBounds(partMeshesRef.current, explosionRef.current, hiddenPartsRef.current),
      )
    } else {
      syncCamera(cameraRef.current, modelMeshRef.current.bounds)
    }

    let pointerDownPos: { x: number; y: number } | null = null

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      pointerDownPos = { x: event.clientX, y: event.clientY }
    }

    const onPointerUp = (event: PointerEvent) => {
      const start = pointerDownPos
      pointerDownPos = null
      if (!start || disposed) return
      const dist = Math.hypot(event.clientX - start.x, event.clientY - start.y)
      if (dist >= 6) return
      const rect = canvas.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1
      const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1
      threeCamera.updateMatrixWorld()
      raycaster.setFromCamera(new Vector2(ndcX, ndcY), threeCamera)

      const activeParts = partMeshesRef.current
      if (activeParts && activeParts.length > 0) {
        const additive = event.shiftKey || additiveRef.current
        // 1. Check discrete edges / cylindrical hole axes first for precision picking
        const edgeTargets: LineSegments[] = []
        const meshTargets: Mesh[] = []
        for (const entry of partEntries.values()) {
          if (!entry.group.visible) continue
          entry.group.updateMatrixWorld(true)
          meshTargets.push(entry.mesh)
          for (const seg of entry.featureEdgeSegments) {
            edgeTargets.push(seg.lines)
          }
        }

        const edgeHits = raycaster.intersectObjects(edgeTargets, false)
        const firstEdge = edgeHits[0]
        if (firstEdge) {
          const seg = firstEdge.object.userData.segment as PartEdgeSegment | undefined
          const partEntry = seg ? partEntries.get(seg.partId) : undefined
          if (seg && partEntry) {
            onPickAssemblyRef.current?.({
              objectId: seg.featureId,
              partId: seg.partId,
              partName: partEntry.part.displayName,
              featureLabel: seg.label,
              geometryKind: seg.kind,
              additive,
            })
            return
          }
        }

        // 2. Check part face triangles
        const meshHits = raycaster.intersectObjects(meshTargets, false)
        const firstMesh = meshHits[0]
        if (firstMesh && typeof firstMesh.faceIndex === 'number') {
          const partId = firstMesh.object.userData.partId as string | undefined
          const partEntry = partId ? partEntries.get(partId) : undefined
          if (partEntry) {
            const picked = resolveMeshTrianglePick(
              firstMesh.faceIndex,
              partEntry.part.faceTriangleRanges,
            )
            const matchedRange = picked
              ? partEntry.part.faceTriangleRanges.find((r) => r.objectId === picked.objectId)
              : undefined
            if (matchedRange) {
              onPickAssemblyRef.current?.({
                objectId: matchedRange.objectId,
                partId: partEntry.part.partId,
                partName: partEntry.part.displayName,
                featureLabel: matchedRange.label ?? matchedRange.role ?? '表面',
                geometryKind: matchedRange.geometryKind ?? 'face',
                additive,
              })
            }
          }
        }
        return
      }

      // Single-part mode raycast
      primaryMesh.updateMatrixWorld(true)
      const hits = raycaster.intersectObject(primaryMesh, false)
      const firstHit = hits[0]
      if (firstHit && typeof firstHit.faceIndex === 'number') {
        const picked = resolveMeshTrianglePick(
          firstHit.faceIndex,
          modelMeshRef.current.triangleRanges,
        )
        if (picked) {
          onPickRangeRef.current(picked)
        }
      }
    }

    const onPointerCancel = () => {
      pointerDownPos = null
    }

    const onContextLost = (event: Event) => {
      event.preventDefault()
      if (rafId !== 0 && typeof window !== 'undefined') {
        window.cancelAnimationFrame(rafId)
        rafId = 0
      }
      setRenderMode('fallback')
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerCancel)
    canvas.addEventListener('webglcontextlost', onContextLost)

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            scheduleRender()
          })
        : null
    resizeObserver?.observe(canvas)

    const replaceSingleHighlight = (meshData: M2ModelMesh, highlighted: ReadonlySet<string>) => {
      if (highlightMesh) {
        singleGroup.remove(highlightMesh)
        highlightMesh = null
      }
      if (highlightGeometry) {
        highlightGeometry.dispose()
        highlightGeometry = null
      }
      const nextGeom = buildHighlightGeometry(
        meshData.positions,
        meshData.indices,
        meshData.triangleRanges,
        highlighted,
      )
      if (nextGeom) {
        highlightGeometry = nextGeom
        highlightMesh = new Mesh(highlightGeometry, highlightMaterial)
        singleGroup.add(highlightMesh)
      }
      scheduleRender()
    }

    const controller: ThreeSceneController = {
      updateSingleMesh(meshData, highlighted) {
        if (disposed) return
        singleGroup.visible = true
        assemblyRoot.visible = false
        const { geometry: nextPrimary } = buildBufferGeometryFromRaw(
          meshData.positions,
          meshData.indices,
          meshData.normals,
        )
        primaryMesh.geometry = nextPrimary
        primaryGeometry.dispose()
        primaryGeometry = nextPrimary

        const nextEdges = new EdgesGeometry(nextPrimary, 25)
        edgeLines.geometry = nextEdges
        edgeGeometry.dispose()
        edgeGeometry = nextEdges

        replaceSingleHighlight(meshData, highlighted)
        syncCamera(cameraRef.current, meshData.bounds)
      },
      updatePartsGeometry(parts, highlighted, explode, xray, hidden) {
        if (disposed) return
        rebuildParts(parts, highlighted, explode, xray, hidden)
      },
      updatePartsTransforms(parts, explode, hidden) {
        if (disposed) return
        // Zero re-triangulation: update ONLY each part's THREE.Group 4x4 Matrix4 & visibility
        const centroid = computeAssemblyCentroid(parts)
        for (const part of parts) {
          const entry = partEntries.get(part.partId)
          if (!entry) continue
          const matrix = computePartExplodedMatrix4(part, centroid, explode)
          applyPartGroupTransform(entry.group, matrix)
          entry.group.visible = !hidden?.has(part.partId)
        }
        scheduleRender()
      },
      updatePartsAppearance(highlighted, xray) {
        if (disposed) return
        highlightMaterial.depthTest = !xray
        highlightMaterial.opacity = xray ? 0.92 : 1
        highlightMaterial.transparent = xray
        for (const entry of partEntries.values()) {
          entry.material.transparent = xray
          entry.material.opacity = xray ? 0.28 : 1
          entry.material.depthWrite = !xray
          entry.material.needsUpdate = true

          if (entry.highlightMesh) {
            entry.group.remove(entry.highlightMesh)
            entry.highlightMesh = null
          }
          if (entry.highlightGeometry) {
            entry.highlightGeometry.dispose()
            entry.highlightGeometry = null
          }
          const nextHl = buildHighlightGeometry(
            entry.part.positions,
            entry.part.indices,
            entry.part.faceTriangleRanges,
            highlighted,
          )
          if (nextHl) {
            entry.highlightGeometry = nextHl
            entry.highlightMesh = new Mesh(nextHl, highlightMaterial)
            entry.highlightMesh.renderOrder = 2
            entry.group.add(entry.highlightMesh)
          }
        }
        scheduleRender()
      },
      applyM4Channels(colors, displacements) {
        if (disposed) return
        if (colors) {
          for (const ch of colors) {
            const entry = partEntries.get(ch.partId)
            if (!entry) continue
            if (applyVertexColorField(entry.geometry, ch)) {
              entry.material.vertexColors = true
              entry.material.needsUpdate = true
            }
          }
        }
        if (displacements) {
          for (const ch of displacements) {
            const entry = partEntries.get(ch.partId)
            if (!entry) continue
            applyVertexDisplacementField(entry.geometry, entry.basePositions, ch)
          }
        }
        scheduleRender()
      },
      applyDeformationVisuals(mode, interpolatedMap, globalMaxMm, scale, phase) {
        if (disposed) return
        for (const [partId, entry] of partEntries.entries()) {
          const posAttr = entry.geometry.getAttribute('position')
          const interp = interpolatedMap.get(partId)
          if (mode === 'nominal' || !interp || globalMaxMm <= 1e-9) {
            if (posAttr && posAttr.array instanceof Float32Array) {
              posAttr.array.set(entry.basePositions)
              posAttr.needsUpdate = true
            }
            if (entry.material.vertexColors) {
              entry.material.vertexColors = false
              entry.material.color.set(entry.part.color)
              entry.material.needsUpdate = true
            }
            continue
          }

          // Write Turbo/Jet vertex colors in-place using cached buffer
          const colorBuf = buildVertexColorBuffer(
            interp.magnitudes,
            globalMaxMm,
            entry.cachedColorBuffer ?? undefined,
          )
          entry.cachedColorBuffer = colorBuf
          applyVertexColorField(entry.geometry, { partId, colors: colorBuf })
          if (!entry.material.vertexColors) {
            entry.material.vertexColors = true
            entry.material.color.setHex(0xffffff)
            entry.material.needsUpdate = true
          }

          // Update vertex positions in-place without rebuilding BufferGeometry
          if (posAttr && posAttr.array instanceof Float32Array) {
            if (mode === 'animation') {
              applyExaggeratedDisplacement(
                entry.basePositions,
                interp.displacements,
                posAttr.array,
                scale,
                phase,
              )
            } else {
              applyExaggeratedDisplacement(
                entry.basePositions,
                interp.displacements,
                posAttr.array,
                1,
                1,
              )
            }
            posAttr.needsUpdate = true
          }
        }
        scheduleRender()
      },
      updateCamera(camState, bounds) {
        if (disposed) return
        syncCamera(camState, bounds)
      },
      updateCss2dAnchors(anchors) {
        if (disposed) return
        while (css2dGroup.children.length > 0) {
          css2dGroup.remove(css2dGroup.children[0])
        }
        for (const item of anchors) {
          const el = document.createElement('div')
          el.className = 'pa-css2d-world-anchor'
          el.dataset.anchorId = item.id
          el.setAttribute('aria-hidden', 'true')
          const obj = new CSS2DObject(el)
          obj.position.set(item.position[0], item.position[1], item.position[2])
          css2dGroup.add(obj)
        }
        scheduleRender()
      },
      updateTheme(nextTheme) {
        if (disposed) return
        const isDark = nextTheme === 'dark'
        const bgColor = new Color(isDark ? '#0B0E14' : '#EEF1F5')
        renderer.setClearColor(bgColor, 1)
        scene.background = bgColor
        primaryMaterial.color.setHex(isDark ? 0x6c6a63 : 0xc4c0b6)
        edgeMaterial.color.setHex(isDark ? 0x9d9a92 : 0x625f57)
        highlightMaterial.color.setHex(isDark ? 0xcc785c : 0xb85d3e)
        highlightMaterial.emissive.setHex(isDark ? 0x7c3e2b : 0x6e311d)
        scheduleRender()
      },
      captureSnapshots(hasDisplacementFields) {
        if (disposed) return {}
        try {
          renderFrame()
          const currentUrl = canvas.toDataURL('image/png')
          if (!currentUrl || !currentUrl.startsWith('data:image/png')) {
            return {}
          }
          return hasDisplacementFields
            ? { nominalPngDataUrl: currentUrl, heatmapPngDataUrl: currentUrl }
            : { nominalPngDataUrl: currentUrl }
        } catch {
          return {}
        }
      },
      dispose() {
        if (disposed) return
        disposed = true
        if (rafId !== 0 && typeof window !== 'undefined') {
          window.cancelAnimationFrame(rafId)
          rafId = 0
        }
        orbitControls.removeEventListener('change', onControlsChange)
        orbitControls.dispose()
        resizeObserver?.disconnect()
        canvas.removeEventListener('pointerdown', onPointerDown)
        canvas.removeEventListener('pointerup', onPointerUp)
        canvas.removeEventListener('pointercancel', onPointerCancel)
        canvas.removeEventListener('webglcontextlost', onContextLost)
        while (css2dGroup.children.length > 0) {
          css2dGroup.remove(css2dGroup.children[0])
        }
        css2dRenderer.domElement.remove()
        disposeParts()
        scene.remove(singleGroup, assemblyRoot, css2dGroup)
        primaryGeometry.dispose()
        edgeGeometry.dispose()
        highlightGeometry?.dispose()
        primaryMaterial.dispose()
        edgeMaterial.dispose()
        featureEdgeMaterial.dispose()
        highlightMaterial.dispose()
        scene.clear()
        renderer.dispose()
      },
    }

    controllerRef.current = controller

    return () => {
      controllerRef.current = null
      controller.dispose()
    }
  }, [renderMode])

  // Single-part mesh updates
  useEffect(() => {
    if (isMultiPart) return
    controllerRef.current?.updateSingleMesh(modelMesh, highlightedFeatureIds)
  }, [isMultiPart, modelMesh, highlightedFeatureIds])

  // Multi-part geometry rebuild ONLY when part geometry identity changes (never on explosion/transform!)
  useEffect(() => {
    if (!isMultiPart || !partMeshes) return
    controllerRef.current?.updatePartsGeometry(
      partMeshes,
      highlightedRef.current,
      explosionRef.current,
      xrayRef.current,
      hiddenPartsRef.current,
    )
  }, [isMultiPart, partGeometryIdentity, partMeshes])

  // Multi-part zero-retriangulation Matrix4 + visibility updates
  useEffect(() => {
    if (!isMultiPart || !partMeshes) return
    controllerRef.current?.updatePartsTransforms(partMeshes, explosionFactor, hiddenPartIds)
  }, [isMultiPart, partMeshes, explosionFactor, hiddenPartIds])

  // Multi-part X-Ray & highlight updates
  useEffect(() => {
    if (!isMultiPart) return
    controllerRef.current?.updatePartsAppearance(highlightedFeatureIds, xrayMode)
  }, [isMultiPart, highlightedFeatureIds, xrayMode])

  // M4 pre-wired vertex color / displacement updates
  useEffect(() => {
    if (!isMultiPart || (!colorFieldChannels && !displacementChannels)) return
    controllerRef.current?.applyM4Channels(colorFieldChannels, displacementChannels)
  }, [isMultiPart, colorFieldChannels, displacementChannels])

  // M4F1 vertexColors heatmap + 60fps requestAnimationFrame exaggerated displacement loop (zero geometry rebuild)
  useEffect(() => {
    if (!isMultiPart) return
    if (effectiveDeformationMode !== 'animation' || !isAnimationPlaying) {
      controllerRef.current?.applyDeformationVisuals(
        effectiveDeformationMode,
        interpolatedByPart,
        globalMaxDisplacementMm,
        effectiveExaggerationScale,
        effectiveDeformationMode === 'animation' ? 1 : 0,
      )
      return
    }

    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      controllerRef.current?.applyDeformationVisuals(
        'animation',
        interpolatedByPart,
        globalMaxDisplacementMm,
        effectiveExaggerationScale,
        1,
      )
      return
    }

    let animRafId = 0
    const startMs = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const step = (nowMs: number) => {
      const elapsedSec = Math.max(0, (nowMs - startMs) / 1000)
      const phase = computeAnimationPhase(elapsedSec)
      controllerRef.current?.applyDeformationVisuals(
        'animation',
        interpolatedByPart,
        globalMaxDisplacementMm,
        effectiveExaggerationScale,
        phase,
      )
      animRafId = window.requestAnimationFrame(step)
    }
    animRafId = window.requestAnimationFrame(step)

    return () => {
      if (animRafId !== 0) {
        window.cancelAnimationFrame(animRafId)
      }
    }
  }, [
    isMultiPart,
    effectiveDeformationMode,
    isAnimationPlaying,
    interpolatedByPart,
    globalMaxDisplacementMm,
    effectiveExaggerationScale,
  ])

  // Sync camera state without rebuilding geometry
  useEffect(() => {
    const bounds =
      isMultiPart && partMeshes
        ? computeAssemblyBounds(partMeshes, explosionFactor, hiddenPartIds)
        : modelMesh.bounds
    controllerRef.current?.updateCamera(camera, bounds)
  }, [camera, isMultiPart, partMeshes, explosionFactor, hiddenPartIds, modelMesh])

  // Fallback projected polygons (used in jsdom / non-WebGL environments)
  const fallbackProjection = useMemo(() => {
    if (isMultiPart && partMeshes) {
      const centroid = computeAssemblyCentroid(partMeshes)
      const bounds = computeAssemblyBounds(partMeshes, explosionFactor, hiddenPartIds)
      const { center, radius } = computeBoundsCenterAndRadius(bounds)
      const v = new Vector3()

      const projectedTriangles: Array<{
        readonly key: string
        readonly partId: string
        readonly partName: string
        readonly partColor: string
        readonly triangleIndex: number
        readonly points: string
        readonly objectId: string
        readonly featureLabel: string
        readonly geometryKind: PickedFeatureGeometryKind
      }> = []

      const projectedEdges: Array<{
        readonly key: string
        readonly segment: PartEdgeSegment
        readonly partName: string
        readonly x1: number
        readonly y1: number
        readonly x2: number
        readonly y2: number
      }> = []

      let totalTriangles = 0

      for (const part of partMeshes) {
        if (hiddenPartIds?.has(part.partId)) continue
        const matrix = computePartExplodedMatrix4(part, centroid, explosionFactor)
        const partTris = Math.floor(part.indices.length / 3)
        totalTriangles += partTris
        const maxPartTris = Math.min(partTris, 120)

        for (let t = 0; t < maxPartTris; t += 1) {
          const i0 = part.indices[t * 3]
          const i1 = part.indices[t * 3 + 1]
          const i2 = part.indices[t * 3 + 2]

          const p0v = v
            .set(part.positions[i0 * 3] ?? 0, part.positions[i0 * 3 + 1] ?? 0, part.positions[i0 * 3 + 2] ?? 0)
            .applyMatrix4(matrix)
          const p0 = projectPointFallback(p0v.x, p0v.y, p0v.z, center, radius, camera)

          const p1v = v
            .set(part.positions[i1 * 3] ?? 0, part.positions[i1 * 3 + 1] ?? 0, part.positions[i1 * 3 + 2] ?? 0)
            .applyMatrix4(matrix)
          const p1 = projectPointFallback(p1v.x, p1v.y, p1v.z, center, radius, camera)

          const p2v = v
            .set(part.positions[i2 * 3] ?? 0, part.positions[i2 * 3 + 1] ?? 0, part.positions[i2 * 3 + 2] ?? 0)
            .applyMatrix4(matrix)
          const p2 = projectPointFallback(p2v.x, p2v.y, p2v.z, center, radius, camera)

          const picked = resolveMeshTrianglePick(t, part.faceTriangleRanges)
          const matchedRange = picked
            ? part.faceTriangleRanges.find((r) => r.objectId === picked.objectId)
            : undefined

          let resolvedFillColor = part.color
          if (effectiveDeformationMode !== 'nominal' && globalMaxDisplacementMm > 1e-9) {
            const interp = interpolatedByPart.get(part.partId)
            if (interp) {
              const avgMag =
                ((interp.magnitudes[i0] ?? 0) +
                  (interp.magnitudes[i1] ?? 0) +
                  (interp.magnitudes[i2] ?? 0)) /
                3
              resolvedFillColor = turboRgbToCssHex(
                mapNormalizedValueToTurboColor(avgMag / globalMaxDisplacementMm),
              )
            }
          }

          projectedTriangles.push({
            key: `${part.partId}-tri-${t}`,
            partId: part.partId,
            partName: part.displayName,
            partColor: resolvedFillColor,
            triangleIndex: t,
            points: `${p0[0].toFixed(1)},${p0[1].toFixed(1)} ${p1[0].toFixed(1)},${p1[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`,
            objectId: matchedRange?.objectId ?? '',
            featureLabel: matchedRange?.label ?? matchedRange?.role ?? '表面',
            geometryKind: matchedRange?.geometryKind ?? 'face',
          })
        }

        for (const seg of part.edgeSegments ?? []) {
          if (seg.points.length < 6) continue
          const a = v.set(seg.points[0], seg.points[1], seg.points[2]).applyMatrix4(matrix)
          const pA = projectPointFallback(a.x, a.y, a.z, center, radius, camera)
          const b = v.set(seg.points[3], seg.points[4], seg.points[5]).applyMatrix4(matrix)
          const pB = projectPointFallback(b.x, b.y, b.z, center, radius, camera)
          projectedEdges.push({
            key: `${part.partId}-seg-${seg.featureId}`,
            segment: seg,
            partName: part.displayName,
            x1: pA[0],
            y1: pA[1],
            x2: pB[0],
            y2: pB[1],
          })
        }
      }

      return {
        mode: 'assembly' as const,
        totalTriangles,
        projectedTriangles,
        projectedEdges,
      }
    }

    const { center, radius } = computeBoundsCenterAndRadius(modelMesh.bounds)
    const totalTriangles = Math.floor(modelMesh.indices.length / 3)
    const projectedTriangles: Array<{
      readonly triangleIndex: number
      readonly points: string
      readonly range: M2MeshTriangleRange | null
    }> = []
    const maxPreviewTriangles = Math.min(totalTriangles, 240)
    for (let t = 0; t < maxPreviewTriangles; t += 1) {
      const i0 = modelMesh.indices[t * 3]
      const i1 = modelMesh.indices[t * 3 + 1]
      const i2 = modelMesh.indices[t * 3 + 2]
      const p0 = projectPointFallback(
        modelMesh.positions[i0 * 3] ?? 0,
        modelMesh.positions[i0 * 3 + 1] ?? 0,
        modelMesh.positions[i0 * 3 + 2] ?? 0,
        center,
        radius,
        camera,
      )
      const p1 = projectPointFallback(
        modelMesh.positions[i1 * 3] ?? 0,
        modelMesh.positions[i1 * 3 + 1] ?? 0,
        modelMesh.positions[i1 * 3 + 2] ?? 0,
        center,
        radius,
        camera,
      )
      const p2 = projectPointFallback(
        modelMesh.positions[i2 * 3] ?? 0,
        modelMesh.positions[i2 * 3 + 1] ?? 0,
        modelMesh.positions[i2 * 3 + 2] ?? 0,
        center,
        radius,
        camera,
      )
      projectedTriangles.push({
        triangleIndex: t,
        points: `${p0[0].toFixed(1)},${p0[1].toFixed(1)} ${p1[0].toFixed(1)},${p1[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`,
        range: resolveMeshTrianglePick(t, modelMesh.triangleRanges),
      })
    }
    return { mode: 'single' as const, totalTriangles, projectedTriangles, projectedEdges: [] }
  }, [
    isMultiPart,
    partMeshes,
    explosionFactor,
    hiddenPartIds,
    modelMesh,
    camera,
    effectiveDeformationMode,
    interpolatedByPart,
    globalMaxDisplacementMm,
  ])

  const fallbackDragRef = useRef<{ x: number; y: number } | null>(null)

  const handleFallbackMouseDown = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (event.button !== 0) return
    fallbackDragRef.current = { x: event.clientX, y: event.clientY }
  }

  const handleFallbackMouseMove = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (!fallbackDragRef.current) return
    const dx = event.clientX - fallbackDragRef.current.x
    const dy = event.clientY - fallbackDragRef.current.y
    fallbackDragRef.current = { x: event.clientX, y: event.clientY }
    if (dx === 0 && dy === 0) return
    onUpdateCamera((prev) => ({
      ...prev,
      yawDeg: Math.round(prev.yawDeg + dx * 0.6),
      pitchDeg: Math.max(-85, Math.min(85, Math.round(prev.pitchDeg + dy * 0.5))),
    }))
  }

  const handleFallbackMouseUp = () => {
    fallbackDragRef.current = null
  }

  const handleFallbackWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    const delta = event.deltaY < 0 ? 15 : -15
    onUpdateCamera((prev) => ({
      ...prev,
      zoomPercent: Math.max(40, Math.min(300, prev.zoomPercent + delta)),
    }))
  }

  const selectedIdSet = useMemo(() => {
    const set = new Set<string>()
    if (selectedObjectId) set.add(selectedObjectId)
    for (const id of selectedObjectIds ?? []) {
      set.add(id)
    }
    return set
  }, [selectedObjectId, selectedObjectIds])

  const featureKindById = useMemo(() => {
    const map = new Map<string, PickedFeatureGeometryKind>()
    if (partMeshes) {
      for (const part of partMeshes) {
        for (const range of part.faceTriangleRanges) {
          map.set(range.objectId, range.geometryKind ?? 'face')
        }
        for (const seg of part.edgeSegments ?? []) {
          map.set(seg.featureId, seg.kind)
        }
      }
    }
    return map
  }, [partMeshes])

  const focusedPartIds = useMemo(() => {
    const set = new Set<string>()
    if (!partMeshes || selectedIdSet.size === 0) return set
    for (const part of partMeshes) {
      const hasSelected =
        part.faceTriangleRanges.some((r) => selectedIdSet.has(r.objectId)) ||
        (part.edgeSegments ?? []).some((s) => selectedIdSet.has(s.featureId))
      if (hasSelected) set.add(part.partId)
    }
    return set
  }, [partMeshes, selectedIdSet])

  const { worldGdtAnchors, projectedGdtAnchors } = useMemo(() => {
    const hasAnyGdt =
      gdtControls.length > 0 ||
      datums.length > 0 ||
      gdtPreviewControls.length > 0 ||
      gdtPreviewDatums.length > 0
    if (!hasAnyGdt) {
      return {
        worldGdtAnchors: [] as Array<{
          readonly id: string
          readonly label: string
          readonly position: readonly [number, number, number]
        }>,
        projectedGdtAnchors: [] as ProjectedGdtAnchor[],
      }
    }

    const bounds =
      isMultiPart && partMeshes
        ? computeAssemblyBounds(partMeshes, explosionFactor, hiddenPartIds)
        : modelMesh.bounds
    const { center, radius } = computeBoundsCenterAndRadius(bounds)

    const resolveAnchor3d = (
      featureId: string,
      anchorOffsetMm?: readonly [number, number, number],
    ): { readonly position: readonly [number, number, number]; readonly partId?: string } => {
      if (isMultiPart && partMeshes) {
        const found = computeFeatureWorldAnchor(
          partMeshes,
          featureId,
          explosionFactor,
          hiddenPartIds,
          anchorOffsetMm,
        )
        if (found) return found
      }
      // Single-mesh triangleRange centroid fallback (used by cloud/web review page)
      const range = modelMesh.triangleRanges.find((r) => r.objectId === featureId)
      if (range) {
        const totalTris = Math.floor(modelMesh.indices.length / 3)
        const start = Math.max(0, range.startTriangle)
        const end = Math.min(totalTris, range.endTriangle)
        let sx = 0
        let sy = 0
        let sz = 0
        let count = 0
        for (let t = start; t < end; t += 1) {
          for (let k = 0; k < 3; k += 1) {
            const idx = modelMesh.indices[t * 3 + k]
            sx += modelMesh.positions[idx * 3] ?? 0
            sy += modelMesh.positions[idx * 3 + 1] ?? 0
            sz += modelMesh.positions[idx * 3 + 2] ?? 0
            count += 1
          }
        }
        if (count > 0) {
          return {
            position: [
              sx / count + (anchorOffsetMm?.[0] ?? 0),
              sy / count + (anchorOffsetMm?.[1] ?? 0),
              sz / count + (anchorOffsetMm?.[2] ?? 0),
            ],
          }
        }
      }
      return {
        position: [
          center[0] + (anchorOffsetMm?.[0] ?? 0),
          center[1] + (anchorOffsetMm?.[1] ?? 0),
          center[2] + (anchorOffsetMm?.[2] ?? 0),
        ],
      }
    }

    const worldList: Array<{
      readonly id: string
      readonly label: string
      readonly position: readonly [number, number, number]
    }> = []
    const projectedList: ProjectedGdtAnchor[] = []

    const pushDatum = (datum: DatumDefinition, isPreview: boolean) => {
      const anchor = resolveAnchor3d(datum.featureId)
      const [sx, sy] = projectPointFallback(
        anchor.position[0],
        anchor.position[1],
        anchor.position[2],
        center,
        radius,
        camera,
      )
      const id = isPreview ? `preview-datum-${datum.id}` : `datum-${datum.id}`
      worldList.push({ id, label: `基准 ${datum.label}`, position: anchor.position })
      projectedList.push({
        id,
        kind: 'datum',
        featureId: datum.featureId,
        partId: anchor.partId,
        anchorX: sx,
        anchorY: sy,
        isPreview,
        datum,
      })
    }

    const pushControl = (control: GdtFeatureControl, isPreview: boolean) => {
      const anchor = resolveAnchor3d(control.featureId, control.anchorOffsetMm)
      const [sx, sy] = projectPointFallback(
        anchor.position[0],
        anchor.position[1],
        anchor.position[2],
        center,
        radius,
        camera,
      )
      const id = isPreview ? `preview-fcf-${control.id}` : control.id
      worldList.push({ id, label: control.kind, position: anchor.position })
      projectedList.push({
        id,
        kind: 'fcf',
        featureId: control.featureId,
        partId: anchor.partId,
        anchorX: sx,
        anchorY: sy,
        isPreview,
        control,
      })
    }

    for (const datum of datums) pushDatum(datum, false)
    for (const datum of gdtPreviewDatums) pushDatum(datum, true)
    for (const control of gdtControls) pushControl(control, false)
    for (const control of gdtPreviewControls) pushControl(control, true)

    return { worldGdtAnchors: worldList, projectedGdtAnchors: projectedList }
  }, [
    gdtControls,
    datums,
    gdtPreviewControls,
    gdtPreviewDatums,
    isMultiPart,
    partMeshes,
    explosionFactor,
    hiddenPartIds,
    modelMesh,
    camera,
  ])

  useEffect(() => {
    controllerRef.current?.updateCss2dAnchors(worldGdtAnchors)
  }, [worldGdtAnchors])

  const effectiveGoldenFeatures = useMemo(
    () => goldenPulseFeatureIds ?? new Set<string>(),
    [goldenPulseFeatureIds],
  )
  const effectiveGoldenGdts = useMemo(
    () => goldenPulseGdtIds ?? new Set<string>(),
    [goldenPulseGdtIds],
  )
  const effectiveLoopFeatures = useMemo(
    () => focusedLoopFeatureIds ?? new Set<string>(),
    [focusedLoopFeatureIds],
  )

  return (
    <div
      className="pa-three-stage"
      data-testid="m2-three-viewport"
      data-render-mode={renderMode === 'webgl' ? 'webgl-3d' : 'fallback-3d'}
      data-assembly-mode={isMultiPart ? 'multi-part' : 'single-part'}
      data-xray-mode={xrayMode ? 'true' : 'false'}
      data-explosion-percent={String(Math.round(explosionFactor * 100))}
      data-geometry-build-count={String(geometryBuildCount)}
      data-triangle-count={String(fallbackProjection.totalTriangles)}
      data-selected-object-id={selectedObjectId ?? ''}
      data-deformation-mode={effectiveDeformationMode}
      data-exaggeration-scale={String(effectiveExaggerationScale)}
      data-animation-playing={
        effectiveDeformationMode === 'animation' && isAnimationPlaying ? 'true' : 'false'
      }
      data-max-displacement-mm={globalMaxDisplacementMm.toFixed(3)}
    >
      {renderMode === 'webgl' ? (
        <>
          <canvas
            ref={canvasRef}
            className="pa-three-canvas"
            role="img"
            aria-label="三维实体网格画布：左键拖拽旋转，右键平移，滚轮缩放，点击面或孔轴拾取特征"
          />
          <div ref={css2dHostRef} className="pa-css2d-webgl-host" aria-hidden="true" />
        </>
      ) : (
        <svg
          className="pa-three-fallback-svg"
          data-testid="m2-three-fallback-svg"
          viewBox="0 0 320 220"
          role="img"
          aria-label="三维实体网格投影视图（无 WebGL 降级模式）"
          onMouseDown={handleFallbackMouseDown}
          onMouseMove={handleFallbackMouseMove}
          onMouseUp={handleFallbackMouseUp}
          onMouseLeave={handleFallbackMouseUp}
          onWheel={handleFallbackWheel}
        >
          <rect x="0" y="0" width="320" height="220" fill="transparent" />
          <g data-testid="m2-three-fallback-mesh">
            {fallbackProjection.mode === 'assembly'
              ? fallbackProjection.projectedTriangles.map((tri) => {
                  const isHighlighted =
                    tri.objectId !== '' && highlightedFeatureIds.has(tri.objectId)
                  const isSelected = tri.objectId !== '' && selectedIdSet.has(tri.objectId)
                  return (
                    <polygon
                      key={tri.key}
                      points={tri.points}
                      fill={isSelected || isHighlighted ? undefined : tri.partColor}
                      fillOpacity={xrayMode ? (isSelected || isHighlighted ? 0.85 : 0.28) : 0.88}
                      data-part-id={tri.partId}
                      data-triangle-index={String(tri.triangleIndex)}
                      data-range-object-id={tri.objectId}
                      data-geometry-kind={tri.geometryKind}
                      data-highlighted={isHighlighted ? 'true' : 'false'}
                      data-selected={isSelected ? 'true' : 'false'}
                      className={
                        isSelected
                          ? 'pa-three-tri pa-three-tri-selected'
                          : isHighlighted
                            ? 'pa-three-tri pa-three-tri-highlighted'
                            : 'pa-three-tri'
                      }
                      onClick={(event) => {
                        if (!tri.objectId) return
                        onPickAssemblyFeature?.({
                          objectId: tri.objectId,
                          partId: tri.partId,
                          partName: tri.partName,
                          featureLabel: tri.featureLabel,
                          geometryKind: tri.geometryKind,
                          additive: event.shiftKey || additivePickMode,
                        })
                      }}
                    />
                  )
                })
              : fallbackProjection.projectedTriangles.map((tri) => {
                  const objId = tri.range?.objectId ?? ''
                  const isHighlighted = objId !== '' && highlightedFeatureIds.has(objId)
                  const isSelected = objId !== '' && selectedIdSet.has(objId)
                  return (
                    <polygon
                      key={tri.triangleIndex}
                      points={tri.points}
                      data-triangle-index={String(tri.triangleIndex)}
                      data-range-object-id={objId}
                      data-highlighted={isHighlighted ? 'true' : 'false'}
                      data-selected={isSelected ? 'true' : 'false'}
                      className={
                        isSelected
                          ? 'pa-three-tri pa-three-tri-selected'
                          : isHighlighted
                            ? 'pa-three-tri pa-three-tri-highlighted'
                            : 'pa-three-tri'
                      }
                      onClick={() => {
                        const picked = resolveMeshTrianglePick(
                          tri.triangleIndex,
                          modelMesh.triangleRanges,
                        )
                        if (picked) {
                          onPickRange(picked)
                        }
                      }}
                    />
                  )
                })}

            {fallbackProjection.mode === 'assembly'
              ? fallbackProjection.projectedEdges.map((edge) => {
                  const isHighlighted = highlightedFeatureIds.has(edge.segment.featureId)
                  const isSelected = selectedIdSet.has(edge.segment.featureId)
                  return (
                    <line
                      key={edge.key}
                      x1={edge.x1.toFixed(1)}
                      y1={edge.y1.toFixed(1)}
                      x2={edge.x2.toFixed(1)}
                      y2={edge.y2.toFixed(1)}
                      strokeWidth={isSelected || isHighlighted ? 3.2 : 2.2}
                      strokeDasharray={
                        edge.segment.kind === 'cylindrical-hole-axis' ? '4 2' : undefined
                      }
                      data-testid={`assembly-edge-${edge.segment.featureId}`}
                      data-part-id={edge.segment.partId}
                      data-range-object-id={edge.segment.featureId}
                      data-geometry-kind={edge.segment.kind}
                      data-highlighted={isHighlighted ? 'true' : 'false'}
                      data-selected={isSelected ? 'true' : 'false'}
                      className={
                        isSelected
                          ? 'pa-three-edge pa-three-edge-selected'
                          : isHighlighted
                            ? 'pa-three-edge pa-three-edge-highlighted'
                            : 'pa-three-edge'
                      }
                      onClick={(event) => {
                        onPickAssemblyFeature?.({
                          objectId: edge.segment.featureId,
                          partId: edge.segment.partId,
                          partName: edge.partName,
                          featureLabel: edge.segment.label,
                          geometryKind: edge.segment.kind,
                          additive: event.shiftKey || additivePickMode,
                        })
                      }}
                    />
                  )
                })
              : null}
          </g>
          <text x="10" y="16" className="pa-svg-meta-text">
            {isMultiPart
              ? `3D 装配投影（${partMeshes?.length ?? 0} 零件 · ${fallbackProjection.totalTriangles} 三角面）`
              : `3D 网格投影（${fallbackProjection.totalTriangles} 三角面 · 降级模式）`}
          </text>
        </svg>
      )}

      {/* M3G 3D GD&T Feature Control Frames, Datums & Smart Anti-Occlusion Layer */}
      {projectedGdtAnchors.length > 0 || onChangeGdtDisplayMode ? (
        <Gdt3dOverlayLayer
          anchors={projectedGdtAnchors}
          datums={[...datums, ...gdtPreviewDatums]}
          featureKindById={featureKindById}
          displayMode={gdtDisplayMode}
          onChangeDisplayMode={onChangeGdtDisplayMode}
          hideModeToggle={hideGdtModeToggle}
          focusedPartIds={focusedPartIds}
          focusedFeatureIds={selectedIdSet}
          focusedLoopFeatureIds={effectiveLoopFeatures}
          goldenPulseFeatureIds={effectiveGoldenFeatures}
          goldenPulseGdtIds={effectiveGoldenGdts}
          readOnly={gdtReadOnly}
          editingGdtId={editingGdtId}
          onSelectGdtCallout={onSelectGdtCallout}
          onHoverGdtCallout={onHoverGdtCallout}
          onUpdateGdtCallout={onUpdateGdtCallout}
          onDeleteGdtCallout={onDeleteGdtCallout}
        />
      ) : null}

      {/* Top-right subtle 4px warm monochromatic deformation scale */}
      {displayDeformationHud && effectiveDeformationMode !== 'nominal' ? (
        <div
          className="pa-heat-scale"
          data-testid="deformation-heatmap-legend"
          role="status"
          aria-label={`形变云图色标：0.00 mm 至 ${globalMaxDisplacementMm.toFixed(3)} mm`}
        >
          <span className="pa-mono">0.00 mm</span>
          <span className="pa-heat-bar" aria-hidden="true" />
          <span className="pa-mono">{globalMaxDisplacementMm.toFixed(3)} mm 变形</span>
        </div>
      ) : null}

      {displayDeformationHud && deformationEmptyHint && globalMaxDisplacementMm <= 1e-6 ? (
        <div
          className="pa-deformation-hint-tr"
          role="status"
          data-testid="deformation-empty-hint"
        >
          {deformationEmptyHint}
        </div>
      ) : null}

      {/* Standalone Deformation Switcher (only when NOT hosted in the bottom 30px viewport control bar) */}
      {displayDeformationHud && !hideDeformationControlsInViewport ? (
        <div
          className="pa-deformation-hud-bl"
          data-testid="deformation-hud"
          aria-label="三维形变云图与夸张动画控制"
        >
          {effectiveDeformationMode === 'animation' ? (
            <div
              className="pa-deformation-anim-pill"
              data-testid="deformation-animation-controls"
            >
              <button
                type="button"
                data-testid="deformation-play-pause-btn"
                className="pa-deformation-play-btn"
                aria-label={isAnimationPlaying ? '暂停夸张动画' : '播放夸张动画'}
                aria-pressed={isAnimationPlaying}
                onClick={toggleAnimationPlaying}
              >
                {isAnimationPlaying ? '暂停' : '播放'}
              </button>
              <label className="pa-deformation-scale-label">
                <span>倍率</span>
                <input
                  type="range"
                  data-testid="exaggeration-scale-slider"
                  aria-label="形变夸张倍率滑块"
                  min={1}
                  max={50}
                  step={1}
                  value={effectiveExaggerationScale}
                  onChange={(e) => handleChangeExaggeration(Number(e.target.value))}
                />
                <span className="pa-mono" data-testid="exaggeration-scale-value">
                  {effectiveExaggerationScale}×
                </span>
              </label>
            </div>
          ) : null}

          <div
            className="pa-deformation-switcher"
            role="group"
            aria-label="形变显示模式切换"
            data-testid="deformation-mode-switcher"
          >
            {(
              [
                { id: 'nominal', label: '名义态' },
                { id: 'heatmap', label: '形变云图' },
                { id: 'animation', label: '夸张动画' },
              ] as const
            ).map((item) => {
              const active = effectiveDeformationMode === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  data-testid={`deformation-mode-${item.id}`}
                  aria-pressed={active}
                  className={
                    active
                      ? 'pa-deformation-mode-btn pa-deformation-mode-btn-active'
                      : 'pa-deformation-mode-btn'
                  }
                  onClick={() => handleSelectDeformationMode(item.id)}
                >
                  {item.label}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      {/* M3 pre-wired CSS2DRenderer annotation overlay container */}
      {isMultiPart || annotationLayerRef || css2dAnnotations.length > 0 ? (
        <div
          ref={annotationLayerRef}
          className="pa-css2d-annotation-layer"
          data-testid="css2d-annotation-layer"
          aria-hidden={css2dAnnotations.length === 0 && projectedGdtAnchors.length === 0}
        >
          {css2dAnnotations.map((ann) => (
            <div key={ann.id} className="pa-css2d-anchor" data-annotation-id={ann.id}>
              {ann.symbol ? <span>{ann.symbol}</span> : null}
              <span>{ann.valueText ?? ann.label}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
