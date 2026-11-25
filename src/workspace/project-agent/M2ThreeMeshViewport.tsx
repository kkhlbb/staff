import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
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
  WebGLRenderer,
} from 'three'
import {
  resolveMeshTrianglePick,
  type M2CameraState,
  type M2MeshTriangleRange,
  type M2ModelMesh,
} from './m2WorkbenchBridge'

export interface M2ThreeMeshViewportProps {
  readonly modelMesh: M2ModelMesh
  readonly camera: M2CameraState
  readonly selectedObjectId: string | null
  readonly highlightedFeatureIds: ReadonlySet<string>
  readonly theme?: 'light' | 'dark'
  readonly onPickRange: (range: M2MeshTriangleRange) => void
  readonly onUpdateCamera: (updater: (prev: M2CameraState) => M2CameraState) => void
}

const DEG2RAD = Math.PI / 180

function computeBoundsCenterAndRadius(mesh: M2ModelMesh): {
  readonly center: readonly [number, number, number]
  readonly radius: number
} {
  const { min, max } = mesh.bounds
  const cx = (min[0] + max[0]) / 2
  const cy = (min[1] + max[1]) / 2
  const cz = (min[2] + max[2]) / 2
  const dx = max[0] - min[0]
  const dy = max[1] - min[1]
  const dz = max[2] - min[2]
  const radius = Math.max(1, Math.hypot(dx, dy, dz) / 2)
  return { center: [cx, cy, cz], radius }
}

function buildPrimaryBufferGeometry(mesh: M2ModelMesh): BufferGeometry {
  const geom = new BufferGeometry()
  const posArray =
    mesh.positions instanceof Float32Array ? mesh.positions : new Float32Array(mesh.positions)
  const idxArray =
    mesh.indices instanceof Uint32Array ? mesh.indices : new Uint32Array(mesh.indices)
  geom.setAttribute('position', new Float32BufferAttribute(posArray, 3))
  geom.setIndex(new Uint32BufferAttribute(idxArray, 1))
  if (mesh.normals && mesh.normals.length === posArray.length) {
    const normArray =
      mesh.normals instanceof Float32Array ? mesh.normals : new Float32BufferAttribute(new Float32Array(mesh.normals), 3)
    geom.setAttribute(
      'normal',
      normArray instanceof Float32BufferAttribute
        ? normArray
        : new Float32BufferAttribute(normArray, 3),
    )
  } else {
    geom.computeVertexNormals()
  }
  geom.computeBoundingSphere()
  return geom
}

function buildHighlightGeometry(
  mesh: M2ModelMesh,
  highlightedFeatureIds: ReadonlySet<string>,
): BufferGeometry | null {
  if (highlightedFeatureIds.size === 0 || mesh.triangleRanges.length === 0) {
    return null
  }
  const highlightedIndices: number[] = []
  const totalTriangles = Math.floor(mesh.indices.length / 3)
  for (const range of mesh.triangleRanges) {
    if (!highlightedFeatureIds.has(range.objectId)) continue
    const start = Math.max(0, range.startTriangle)
    const end = Math.min(totalTriangles, range.endTriangle)
    for (let t = start; t < end; t += 1) {
      highlightedIndices.push(mesh.indices[t * 3], mesh.indices[t * 3 + 1], mesh.indices[t * 3 + 2])
    }
  }
  if (highlightedIndices.length === 0) return null
  const geom = new BufferGeometry()
  const posArray =
    mesh.positions instanceof Float32Array ? mesh.positions : new Float32Array(mesh.positions)
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
  threeCamera.lookAt(center[0], center[1], center[2])
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

interface ThreeSceneController {
  updateMesh(mesh: M2ModelMesh, highlighted: ReadonlySet<string>): void
  updateHighlight(mesh: M2ModelMesh, highlighted: ReadonlySet<string>): void
  updateCamera(camera: M2CameraState, mesh: M2ModelMesh): void
  updateTheme(theme: 'light' | 'dark'): void
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
  highlightedFeatureIds,
  theme = 'light',
  onPickRange,
  onUpdateCamera,
}: M2ThreeMeshViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const controllerRef = useRef<ThreeSceneController | null>(null)
  const [renderMode, setRenderMode] = useState<'webgl' | 'fallback'>(() =>
    canAttemptWebGL() ? 'webgl' : 'fallback',
  )

  const modelMeshRef = useRef(modelMesh)
  const cameraRef = useRef(camera)
  const highlightedRef = useRef(highlightedFeatureIds)
  const themeRef = useRef(theme)
  const onPickRangeRef = useRef(onPickRange)
  const onUpdateCameraRef = useRef(onUpdateCamera)

  useEffect(() => {
    themeRef.current = theme
    controllerRef.current?.updateTheme(theme)
  }, [theme])

  useEffect(() => {
    modelMeshRef.current = modelMesh
  }, [modelMesh])

  useEffect(() => {
    cameraRef.current = camera
  }, [camera])

  useEffect(() => {
    highlightedRef.current = highlightedFeatureIds
  }, [highlightedFeatureIds])

  useEffect(() => {
    onPickRangeRef.current = onPickRange
  }, [onPickRange])

  useEffect(() => {
    onUpdateCameraRef.current = onUpdateCamera
  }, [onUpdateCamera])

  // Initialize Three.js WebGLRenderer once when mounted; degrade gracefully if WebGL is unavailable.
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

    const ambient = new AmbientLight(0xffffff, 1.0)
    const hemi = new HemisphereLight(0xffffff, 0x64748b, 1.0)
    const key = new DirectionalLight(0xffffff, 1.8)
    key.position.set(120, 180, 140)
    const fill = new DirectionalLight(0xdbeafe, 0.7)
    fill.position.set(-140, -80, -100)
    scene.add(ambient, hemi, key, fill)

    const primaryMaterial = new MeshStandardMaterial({
      color: initialDark ? 0x64748b : 0xcbd5e1,
      metalness: 0.15,
      roughness: 0.55,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    })
    const edgeMaterial = new LineBasicMaterial({ color: initialDark ? 0x94a3b8 : 0x334155 })
    const highlightMaterial = new MeshStandardMaterial({
      color: initialDark ? 0x4b83ff : 0x1e5eff,
      emissive: initialDark ? 0x1e40af : 0x1749cc,
      emissiveIntensity: 0.35,
      metalness: 0.1,
      roughness: 0.4,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })

    let primaryGeometry = buildPrimaryBufferGeometry(modelMeshRef.current)
    const primaryMesh = new Mesh(primaryGeometry, primaryMaterial)
    scene.add(primaryMesh)

    let edgeGeometry = new EdgesGeometry(primaryGeometry, 25)
    const edgeLines = new LineSegments(edgeGeometry, edgeMaterial)
    scene.add(edgeLines)

    let highlightGeometry = buildHighlightGeometry(modelMeshRef.current, highlightedRef.current)
    let highlightMesh: Mesh | null = null
    if (highlightGeometry) {
      highlightMesh = new Mesh(highlightGeometry, highlightMaterial)
      scene.add(highlightMesh)
    }

    const raycaster = new Raycaster()
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
    }

    const scheduleRender = () => {
      if (disposed || rafId !== 0) return
      if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
        rafId = window.requestAnimationFrame(renderFrame)
      } else {
        renderFrame()
      }
    }

    const syncCamera = (camState: M2CameraState, meshData: M2ModelMesh) => {
      const { center, radius } = computeBoundsCenterAndRadius(meshData)
      positionCameraFromState(threeCamera, camState, center, radius)
      scheduleRender()
    }

    syncCamera(cameraRef.current, modelMeshRef.current)

    let dragStart: { x: number; y: number } | null = null
    let lastDrag: { x: number; y: number } | null = null

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      dragStart = { x: event.clientX, y: event.clientY }
      lastDrag = { x: event.clientX, y: event.clientY }
    }

    const onPointerMove = (event: PointerEvent) => {
      if (!lastDrag) return
      const dx = event.clientX - lastDrag.x
      const dy = event.clientY - lastDrag.y
      lastDrag = { x: event.clientX, y: event.clientY }
      if (dx === 0 && dy === 0) return
      onUpdateCameraRef.current((prev) => ({
        ...prev,
        yawDeg: Math.round(prev.yawDeg + dx * 0.6),
        pitchDeg: Math.max(-85, Math.min(85, Math.round(prev.pitchDeg + dy * 0.5))),
      }))
    }

    const onPointerUp = (event: PointerEvent) => {
      const start = dragStart
      dragStart = null
      lastDrag = null
      if (!start || disposed) return
      const dist = Math.hypot(event.clientX - start.x, event.clientY - start.y)
      if (dist >= 6) return
      const rect = canvas.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1
      const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1
      threeCamera.updateMatrixWorld()
      primaryMesh.updateMatrixWorld(true)
      raycaster.setFromCamera(new Vector2(ndcX, ndcY), threeCamera)
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
      dragStart = null
      lastDrag = null
    }

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const delta = event.deltaY < 0 ? 15 : -15
      onUpdateCameraRef.current((prev) => ({
        ...prev,
        zoomPercent: Math.max(40, Math.min(300, prev.zoomPercent + delta)),
      }))
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
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerCancel)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('webglcontextlost', onContextLost)

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            scheduleRender()
          })
        : null
    resizeObserver?.observe(canvas)

    const replaceHighlight = (meshData: M2ModelMesh, highlighted: ReadonlySet<string>) => {
      if (highlightMesh) {
        scene.remove(highlightMesh)
        highlightMesh = null
      }
      if (highlightGeometry) {
        highlightGeometry.dispose()
        highlightGeometry = null
      }
      const nextGeom = buildHighlightGeometry(meshData, highlighted)
      if (nextGeom) {
        highlightGeometry = nextGeom
        highlightMesh = new Mesh(highlightGeometry, highlightMaterial)
        scene.add(highlightMesh)
      }
      scheduleRender()
    }

    const controller: ThreeSceneController = {
      updateMesh(meshData, highlighted) {
        if (disposed) return
        const nextPrimary = buildPrimaryBufferGeometry(meshData)
        primaryMesh.geometry = nextPrimary
        primaryGeometry.dispose()
        primaryGeometry = nextPrimary

        const nextEdges = new EdgesGeometry(nextPrimary, 25)
        edgeLines.geometry = nextEdges
        edgeGeometry.dispose()
        edgeGeometry = nextEdges

        replaceHighlight(meshData, highlighted)
        syncCamera(cameraRef.current, meshData)
      },
      updateHighlight(meshData, highlighted) {
        if (disposed) return
        replaceHighlight(meshData, highlighted)
      },
      updateCamera(camState, meshData) {
        if (disposed) return
        syncCamera(camState, meshData)
      },
      updateTheme(nextTheme) {
        if (disposed) return
        const isDark = nextTheme === 'dark'
        const bgColor = new Color(isDark ? '#0B0E14' : '#EEF1F5')
        renderer.setClearColor(bgColor, 1)
        scene.background = bgColor
        primaryMaterial.color.setHex(isDark ? 0x64748b : 0xcbd5e1)
        edgeMaterial.color.setHex(isDark ? 0x94a3b8 : 0x334155)
        highlightMaterial.color.setHex(isDark ? 0x4b83ff : 0x1e5eff)
        highlightMaterial.emissive.setHex(isDark ? 0x1e40af : 0x1749cc)
        scheduleRender()
      },
      dispose() {
        if (disposed) return
        disposed = true
        if (rafId !== 0 && typeof window !== 'undefined') {
          window.cancelAnimationFrame(rafId)
          rafId = 0
        }
        resizeObserver?.disconnect()
        canvas.removeEventListener('pointerdown', onPointerDown)
        canvas.removeEventListener('pointermove', onPointerMove)
        canvas.removeEventListener('pointerup', onPointerUp)
        canvas.removeEventListener('pointercancel', onPointerCancel)
        canvas.removeEventListener('wheel', onWheel)
        canvas.removeEventListener('webglcontextlost', onContextLost)
        scene.remove(primaryMesh, edgeLines)
        if (highlightMesh) scene.remove(highlightMesh)
        primaryGeometry.dispose()
        edgeGeometry.dispose()
        highlightGeometry?.dispose()
        primaryMaterial.dispose()
        edgeMaterial.dispose()
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

  // Refresh mesh geometry in-place when modelMesh changes without resetting camera
  useEffect(() => {
    controllerRef.current?.updateMesh(modelMesh, highlightedFeatureIds)
  }, [modelMesh, highlightedFeatureIds])

  // Sync camera state without rebuilding mesh
  useEffect(() => {
    controllerRef.current?.updateCamera(camera, modelMesh)
  }, [camera, modelMesh])

  // Fallback projected polygons (used in jsdom / non-WebGL environments)
  const fallbackProjection = useMemo(() => {
    const { center, radius } = computeBoundsCenterAndRadius(modelMesh)
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
    return { totalTriangles, projectedTriangles }
  }, [modelMesh, camera])

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

  return (
    <div
      className="pa-three-stage"
      data-testid="m2-three-viewport"
      data-render-mode={renderMode === 'webgl' ? 'webgl-3d' : 'fallback-3d'}
      data-triangle-count={String(fallbackProjection.totalTriangles)}
      data-selected-object-id={selectedObjectId ?? ''}
    >
      {renderMode === 'webgl' ? (
        <canvas
          ref={canvasRef}
          className="pa-three-canvas"
          role="img"
          aria-label="三维实体网格画布：左键拖拽旋转，滚轮缩放，点击面拾取特征"
        />
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
            {fallbackProjection.projectedTriangles.map((tri) => {
              const objId = tri.range?.objectId ?? ''
              const isHighlighted = objId !== '' && highlightedFeatureIds.has(objId)
              const isSelected = objId !== '' && selectedObjectId === objId
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
          </g>
          <text x="10" y="16" className="pa-svg-meta-text">
            3D 网格投影（{fallbackProjection.totalTriangles} 三角面 · 降级模式）
          </text>
        </svg>
      )}
    </div>
  )
}
