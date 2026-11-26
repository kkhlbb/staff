import type {
  M2DrawingVector,
  M2ModelMesh,
} from '../../desktop/shared/project-agent/m2-preview'
import type {
  PartMesh,
  RowMajorMatrix4,
  SimulationLoopSpec,
} from '../workspace/project-agent/assembly3dTypes'

const IDENTITY_4X4: RowMajorMatrix4 = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
]

function buildBoxGeometry(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
): { readonly positions: number[]; readonly indices: number[] } {
  const positions = [
    // Bottom face (0..3)
    x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0,
    // Top face (4..7)
    x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1,
  ]
  // 12 triangles (2 per face): bottom (0..2), top (2..4), front (4..6), right (6..8), back (8..10), left (10..12)
  const indices = [
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4,
    1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6,
    3, 0, 4, 3, 4, 7,
  ]
  return { positions, indices }
}

function buildCylinderPrism(
  radius: number,
  length: number,
  segments = 12,
  axis: 'x' | 'z' = 'z',
  offset: readonly [number, number, number] = [0, 0, 0],
): { readonly positions: number[]; readonly indices: number[] } {
  const positions: number[] = []
  const indices: number[] = []
  const [ox, oy, oz] = offset

  // Center vertices for caps: 0 = start cap center, 1 = end cap center
  if (axis === 'x') {
    positions.push(ox, oy, oz, ox + length, oy, oz)
  } else {
    positions.push(ox, oy, oz, ox, oy, oz + length)
  }

  for (let i = 0; i < segments; i += 1) {
    const theta = (2 * Math.PI * i) / segments
    const c = Math.cos(theta) * radius
    const s = Math.sin(theta) * radius
    if (axis === 'x') {
      positions.push(ox, oy + c, oz + s)
      positions.push(ox + length, oy + c, oz + s)
    } else {
      positions.push(ox + c, oy + s, oz)
      positions.push(ox + c, oy + s, oz + length)
    }
  }

  // Start cap triangles (segments)
  for (let i = 0; i < segments; i += 1) {
    const next = (i + 1) % segments
    const a = 2 + i * 2
    const b = 2 + next * 2
    indices.push(0, b, a)
  }
  // End cap triangles (segments)
  for (let i = 0; i < segments; i += 1) {
    const next = (i + 1) % segments
    const a = 2 + i * 2 + 1
    const b = 2 + next * 2 + 1
    indices.push(1, a, b)
  }
  // Side triangles (2 * segments)
  for (let i = 0; i < segments; i += 1) {
    const next = (i + 1) % segments
    const a0 = 2 + i * 2
    const a1 = 2 + i * 2 + 1
    const b0 = 2 + next * 2
    const b1 = 2 + next * 2 + 1
    indices.push(a0, b0, b1, a0, b1, a1)
  }

  return { positions, indices }
}

/**
 * Builds a rectangular plate mesh with a subdivided nx*ny grid on both bottom and top faces
 * so interior vertices (including center) capture smooth 3D warpage/displacement fields.
 */
function buildSubdividedPlateGeometry(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  nx = 4,
  ny = 4,
): {
  readonly positions: number[]
  readonly indices: number[]
  readonly bottomTriCount: number
  readonly topTriCount: number
} {
  const positions: number[] = []
  const indices: number[] = []
  const stride = nx + 1
  const layerVerts = (nx + 1) * (ny + 1)

  // Bottom grid (0 .. layerVerts - 1)
  for (let iy = 0; iy <= ny; iy += 1) {
    const y = y0 + ((y1 - y0) * iy) / ny
    for (let ix = 0; ix <= nx; ix += 1) {
      const x = x0 + ((x1 - x0) * ix) / nx
      positions.push(x, y, z0)
    }
  }
  // Top grid (layerVerts .. 2 * layerVerts - 1)
  for (let iy = 0; iy <= ny; iy += 1) {
    const y = y0 + ((y1 - y0) * iy) / ny
    for (let ix = 0; ix <= nx; ix += 1) {
      const x = x0 + ((x1 - x0) * ix) / nx
      positions.push(x, y, z1)
    }
  }

  // Bottom triangles (2 * nx * ny)
  for (let iy = 0; iy < ny; iy += 1) {
    for (let ix = 0; ix < nx; ix += 1) {
      const a = iy * stride + ix
      const b = a + 1
      const c = a + stride + 1
      const d = a + stride
      indices.push(a, c, b, a, d, c)
    }
  }
  const bottomTriCount = 2 * nx * ny

  // Top triangles (2 * nx * ny)
  for (let iy = 0; iy < ny; iy += 1) {
    for (let ix = 0; ix < nx; ix += 1) {
      const a = layerVerts + iy * stride + ix
      const b = a + 1
      const c = a + stride + 1
      const d = a + stride
      indices.push(a, b, c, a, c, d)
    }
  }
  const topTriCount = 2 * nx * ny

  // 4 side walls
  for (let ix = 0; ix < nx; ix += 1) {
    // Front wall (iy = 0)
    const b0 = ix
    const b1 = ix + 1
    const t0 = layerVerts + b0
    const t1 = layerVerts + b1
    indices.push(b0, b1, t1, b0, t1, t0)
    // Back wall (iy = ny)
    const rb0 = ny * stride + ix
    const rb1 = rb0 + 1
    const rt0 = layerVerts + rb0
    const rt1 = layerVerts + rb1
    indices.push(rb1, rb0, rt0, rb1, rt0, rt1)
  }
  for (let iy = 0; iy < ny; iy += 1) {
    // Left wall (ix = 0)
    const b0 = iy * stride
    const b1 = (iy + 1) * stride
    const t0 = layerVerts + b0
    const t1 = layerVerts + b1
    indices.push(b1, b0, t0, b1, t0, t1)
    // Right wall (ix = nx)
    const rb0 = iy * stride + nx
    const rb1 = (iy + 1) * stride + nx
    const rt0 = layerVerts + rb0
    const rt1 = layerVerts + rb1
    indices.push(rb0, rb1, rt1, rb0, rt1, rt0)
  }

  return { positions, indices, bottomTriCount, topTriCount }
}

function buildRectLines(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): readonly { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number }[] {
  return [
    { x1: x0, y1: y0, x2: x1, y2: y0 },
    { x1: x1, y1: y0, x2: x1, y2: y1 },
    { x1: x1, y1: y1, x2: x0, y2: y1 },
    { x1: x0, y1: y1, x2: x0, y2: y0 },
  ]
}

// ---------------------------------------------------------------------------
// 1. builtin-mounting-plate (安装板 + 参考盖板)
// ---------------------------------------------------------------------------

const plateBox = buildBoxGeometry(0, 0, 0, 80, 50, 8)
const coverBox = buildBoxGeometry(0, 0, 0, 80, 50, 4)

export const MOUNTING_PLATE_PART_MESHES: readonly PartMesh[] = [
  {
    partId: 'part-mounting-plate',
    displayName: '安装板',
    color: '#4c78a8',
    positions: plateBox.positions,
    indices: plateBox.indices,
    faceTriangleRanges: [
      {
        partId: 'part-mounting-plate',
        objectId: 'feat-plate-top',
        featureRef: 'plate/top-face',
        label: '顶基准面',
        geometryKind: 'face',
        startTriangle: 2,
        endTriangle: 4,
      },
      {
        partId: 'part-mounting-plate',
        objectId: 'feat-right-end-face',
        featureRef: 'plate/right-end-face',
        label: '右端面',
        geometryKind: 'face',
        startTriangle: 6,
        endTriangle: 8,
      },
    ],
    edgeSegments: [
      {
        featureId: 'feat-left-hole-axis',
        partId: 'part-mounting-plate',
        label: '左 Ø10 通孔轴线',
        kind: 'cylindrical-hole-axis',
        points: [20, 25, 0, 20, 25, 8],
      },
      {
        featureId: 'feat-right-hole-axis',
        partId: 'part-mounting-plate',
        label: '右 Ø10 通孔轴线',
        kind: 'cylindrical-hole-axis',
        points: [60, 25, 0, 60, 25, 8],
      },
    ],
    nominalTransform: IDENTITY_4X4,
    bounds: { min: [0, 0, 0], max: [80, 50, 8] },
    explodeVector: [0, 0, -0.8],
  },
  {
    partId: 'part-reference-cover',
    displayName: '参考盖板',
    color: '#72b7b2',
    positions: coverBox.positions,
    indices: coverBox.indices,
    faceTriangleRanges: [
      {
        partId: 'part-reference-cover',
        objectId: 'feat-cover-bottom',
        featureRef: 'cover/bottom-face',
        label: '底贴合面',
        geometryKind: 'face',
        startTriangle: 0,
        endTriangle: 2,
      },
      {
        partId: 'part-reference-cover',
        objectId: 'feat-cover-top',
        featureRef: 'cover/top-face',
        label: '顶表面',
        geometryKind: 'face',
        startTriangle: 2,
        endTriangle: 4,
      },
    ],
    nominalTransform: [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 10],
      [0, 0, 0, 1],
    ],
    bounds: { min: [0, 0, 0], max: [80, 50, 4] },
    explodeVector: [0, 0, 1.0],
  },
]

export const MOUNTING_PLATE_MODEL_MESH: M2ModelMesh = {
  frameId: 'world',
  positions: [
    ...plateBox.positions,
    ...coverBox.positions.map((v, idx) => (idx % 3 === 2 ? v + 10 : v)),
  ],
  indices: [
    ...plateBox.indices,
    ...coverBox.indices.map((i) => i + 8),
  ],
  triangleRanges: [
    { startTriangle: 0, endTriangle: 6, objectId: 'obj-left-hole', featureRef: 'plate/left-hole/cylinder', role: '安装板左孔区', partName: '安装板' },
    { startTriangle: 6, endTriangle: 8, objectId: 'obj-right-face', featureRef: 'plate/right-end-face', role: '安装板右端面', partName: '安装板' },
    { startTriangle: 8, endTriangle: 12, objectId: 'obj-right-hole', featureRef: 'plate/right-hole/cylinder', role: '安装板右孔区', partName: '安装板' },
    { startTriangle: 12, endTriangle: 24, objectId: 'obj-cover-gap', featureRef: 'assembly/cover-plate/top-gap', role: '参考盖板', partName: '参考盖板' },
  ],
  bounds: { min: [0, 0, 0], max: [80, 50, 14] },
}

export const MOUNTING_PLATE_DRAWING_VECTOR: M2DrawingVector = {
  unit: 'mm',
  revision: 'draft-2',
  displayDecimals: 1,
  convention: 'first-angle',
  views: [
    {
      id: 'top',
      title: '俯视图（安装板双孔）',
      size: [80, 50],
      lines: buildRectLines(0, 0, 80, 50),
      circles: [
        { cx: 20, cy: 25, r: 5 },
        { cx: 60, cy: 25, r: 5 },
      ],
      hiddenLines: [
        { x1: 12, y1: 25, x2: 28, y2: 25 },
        { x1: 20, y1: 17, x2: 20, y2: 33 },
        { x1: 52, y1: 25, x2: 68, y2: 25 },
        { x1: 60, y1: 17, x2: 60, y2: 33 },
      ],
    },
    {
      id: 'front',
      title: '主视图（板厚与参考盖板）',
      size: [80, 14],
      lines: [
        ...buildRectLines(0, 0, 80, 8),
        ...buildRectLines(0, 10, 80, 14),
      ],
      circles: [],
      hiddenLines: [
        { x1: 15, y1: 0, x2: 15, y2: 8 },
        { x1: 25, y1: 0, x2: 25, y2: 8 },
        { x1: 55, y1: 0, x2: 55, y2: 8 },
        { x1: 65, y1: 0, x2: 65, y2: 8 },
      ],
    },
    {
      id: 'side',
      title: '侧视图（2.0 mm 间隙）',
      size: [50, 14],
      lines: [
        ...buildRectLines(0, 0, 50, 8),
        ...buildRectLines(0, 10, 50, 14),
      ],
      circles: [],
      hiddenLines: [
        { x1: 20, y1: 0, x2: 20, y2: 8 },
        { x1: 30, y1: 0, x2: 30, y2: 8 },
      ],
    },
  ],
  annotations: [
    {
      annotationId: 'ann-hole-pitch',
      view: 'top',
      side: 'top',
      lane: 0,
      label: '两孔中心距',
      valueText: '40.0 mm',
      valueMm: 40,
      witnesses: [[20, 50], [60, 50]],
      linkedFeatureIds: ['obj-left-hole', 'obj-right-hole'],
    },
    {
      annotationId: 'ann-right-margin',
      view: 'top',
      side: 'bottom',
      lane: 0,
      label: '右孔至右端面边距',
      valueText: '15.0 mm (≥ 13.0)',
      valueMm: 15,
      witnesses: [[65, 0], [80, 0]],
      linkedFeatureIds: ['obj-right-hole', 'obj-right-face'],
    },
    {
      annotationId: 'ann-right-hole-dia',
      view: 'top',
      side: 'right',
      lane: 0,
      label: '右孔孔径',
      valueText: 'Ø10.0 ±0.1 mm',
      valueMm: 10,
      witnesses: [[60, 20], [60, 30]],
      linkedFeatureIds: ['obj-right-hole'],
    },
    {
      annotationId: 'ann-plate-length',
      view: 'front',
      side: 'bottom',
      lane: 0,
      label: '安装板外形长度',
      valueText: '80.0 × 50.0 × 8.0 mm',
      valueMm: 80,
      witnesses: [[0, 0], [80, 0]],
      linkedFeatureIds: ['obj-right-face'],
    },
    {
      annotationId: 'ann-cover-gap',
      view: 'side',
      side: 'right',
      lane: 0,
      label: '盖板与安装板间隙',
      valueText: '2.0 mm [1.7, 2.3]',
      valueMm: 2,
      witnesses: [[50, 8], [50, 10]],
      linkedFeatureIds: ['obj-cover-gap'],
    },
  ],
}

export const MOUNTING_PLATE_SIMULATION_SPEC: SimulationLoopSpec = {
  id: 'loop-mounting-plate-gap',
  title: '安装板-参考盖板法向间隙',
  measurementKind: 'gap',
  nominalMm: 2.0,
  lslMm: 1.5,
  uslMm: 2.5,
  sampleCount: 50000,
  seed: 20261126,
  contributors: [
    {
      id: 'contrib-plate-thickness',
      label: '安装板厚度公差',
      partId: 'part-mounting-plate',
      featureId: 'feat-plate-top',
      partName: '安装板',
      featureLabel: '顶基准面',
      currentTolMm: 0.2,
      minTolMm: 0.04,
      maxTolMm: 0.4,
      stepMm: 0.02,
      sensitivity: 1.0,
      sign: -1,
      formatPrefix: '±',
    },
    {
      id: 'contrib-cover-height',
      label: '参考盖板安装高度公差',
      partId: 'part-reference-cover',
      featureId: 'feat-cover-bottom',
      partName: '参考盖板',
      featureLabel: '底贴合面',
      currentTolMm: 0.1,
      minTolMm: 0.02,
      maxTolMm: 0.25,
      stepMm: 0.01,
      sensitivity: 1.0,
      sign: 1,
      formatPrefix: '±',
    },
    {
      id: 'contrib-right-hole-pos',
      label: '安装板右孔边距偏移',
      partId: 'part-mounting-plate',
      featureId: 'feat-right-hole-axis',
      partName: '安装板',
      featureLabel: '右 Ø10 通孔轴线',
      currentTolMm: 0.12,
      minTolMm: 0.02,
      maxTolMm: 0.25,
      stepMm: 0.01,
      sensitivity: 0.5,
      sign: 1,
      formatPrefix: 'Ø',
    },
  ],
}

// ---------------------------------------------------------------------------
// 2. builtin-shaft-spacer (隔套 + 阶梯轴/端盖)
// ---------------------------------------------------------------------------

const spacerCyl = buildCylinderPrism(12, 59.8, 12, 'x', [20, 12, 12])
const shaftCyl = buildCylinderPrism(6, 100, 12, 'x', [0, 12, 12])

export const SHAFT_SPACER_PART_MESHES: readonly PartMesh[] = [
  {
    partId: 'part-shaft-spacer',
    displayName: '隔套',
    color: '#e45756',
    positions: spacerCyl.positions,
    indices: spacerCyl.indices,
    faceTriangleRanges: [
      {
        partId: 'part-shaft-spacer',
        objectId: 'feat-spacer-left-end',
        featureRef: 'spacer/left-end-face',
        label: '左接触端面',
        geometryKind: 'face',
        startTriangle: 0,
        endTriangle: 12,
      },
      {
        partId: 'part-shaft-spacer',
        objectId: 'feat-spacer-right-end',
        featureRef: 'spacer/right-end-face',
        label: '右接触端面',
        geometryKind: 'face',
        startTriangle: 12,
        endTriangle: 24,
      },
    ],
    edgeSegments: [
      {
        featureId: 'feat-spacer-bore-axis',
        partId: 'part-shaft-spacer',
        label: '内孔 Ø12 轴线',
        kind: 'cylindrical-hole-axis',
        points: [20, 12, 12, 79.8, 12, 12],
      },
    ],
    nominalTransform: IDENTITY_4X4,
    bounds: { min: [20, 0, 0], max: [79.8, 24, 24] },
    explodeVector: [0, 0, 1.0],
  },
  {
    partId: 'part-stepped-shaft',
    displayName: '阶梯轴/端盖',
    color: '#64748b',
    positions: shaftCyl.positions,
    indices: shaftCyl.indices,
    faceTriangleRanges: [
      {
        partId: 'part-stepped-shaft',
        objectId: 'feat-shaft-shoulder',
        featureRef: 'shaft/left-shoulder',
        label: '左轴肩定位面',
        geometryKind: 'face',
        startTriangle: 0,
        endTriangle: 12,
      },
      {
        partId: 'part-stepped-shaft',
        objectId: 'feat-shaft-cap-face',
        featureRef: 'shaft/right-cap-face',
        label: '右端盖贴合面',
        geometryKind: 'face',
        startTriangle: 12,
        endTriangle: 24,
      },
    ],
    edgeSegments: [
      {
        featureId: 'feat-shaft-axis',
        partId: 'part-stepped-shaft',
        label: '阶梯轴中心线',
        kind: 'cylindrical-hole-axis',
        points: [0, 12, 12, 100, 12, 12],
      },
    ],
    nominalTransform: IDENTITY_4X4,
    bounds: { min: [0, 6, 6], max: [100, 18, 18] },
    explodeVector: [0, 0, -0.8],
  },
]

const spacerVertexCount = spacerCyl.positions.length / 3
export const SHAFT_SPACER_MODEL_MESH: M2ModelMesh = {
  frameId: 'world',
  positions: [...spacerCyl.positions, ...shaftCyl.positions],
  indices: [
    ...spacerCyl.indices,
    ...shaftCyl.indices.map((i) => i + spacerVertexCount),
  ],
  triangleRanges: [
    { startTriangle: 0, endTriangle: 12, objectId: 'obj-spacer-bore', featureRef: 'spacer/inner-diameter', role: '隔套左端面', partName: '隔套' },
    { startTriangle: 12, endTriangle: 24, objectId: 'obj-spacer-end-face', featureRef: 'spacer/right-end-face', role: '隔套右端面', partName: '隔套' },
    { startTriangle: 24, endTriangle: 48, objectId: 'obj-spacer-body', featureRef: 'spacer/outer-diameter', role: '隔套外圆柱面', partName: '隔套' },
  ],
  bounds: { min: [0, 0, 0], max: [100, 24, 24] },
}

export const SHAFT_SPACER_DRAWING_VECTOR: M2DrawingVector = {
  unit: 'mm',
  revision: 'v3',
  displayDecimals: 2,
  convention: 'first-angle',
  views: [
    {
      id: 'front',
      title: '主视图（隔套与阶梯轴装配）',
      size: [100, 24],
      lines: [
        // Stepped shaft outline (Ø12, length 100)
        ...buildRectLines(0, 6, 100, 18),
        // Spacer sleeve outline (Ø24, length 59.8, positioned at x=20..79.8)
        ...buildRectLines(20, 0, 79.8, 24),
      ],
      circles: [],
      hiddenLines: [
        // Bore centerline & inner diameter dashed lines
        { x1: 0, y1: 12, x2: 100, y2: 12 },
        { x1: 20, y1: 6, x2: 79.8, y2: 6 },
        { x1: 20, y1: 18, x2: 79.8, y2: 18 },
      ],
    },
    {
      id: 'side',
      title: '左视图（Ø24 / Ø12 同心圆）',
      size: [24, 24],
      lines: [],
      circles: [
        { cx: 12, cy: 12, r: 12 },
        { cx: 12, cy: 12, r: 6 },
      ],
      hiddenLines: [
        { x1: 0, y1: 12, x2: 24, y2: 12 },
        { x1: 12, y1: 0, x2: 12, y2: 24 },
      ],
    },
  ],
  annotations: [
    {
      annotationId: 'ann-spacer-length',
      view: 'front',
      side: 'top',
      lane: 0,
      label: '隔套长度 L',
      valueText: '59.80 ±0.02 mm',
      valueMm: 59.8,
      witnesses: [[20, 24], [79.8, 24]],
      linkedFeatureIds: ['obj-spacer-body', 'obj-spacer-end-face'],
    },
    {
      annotationId: 'ann-spacer-axial-gap',
      view: 'front',
      side: 'bottom',
      lane: 0,
      label: '轴向封闭环间隙',
      valueText: '0.20 mm [0.18, 0.29]',
      valueMm: 0.2,
      witnesses: [[79.8, 0], [100, 0]],
      linkedFeatureIds: ['obj-spacer-end-face'],
    },
    {
      annotationId: 'ann-spacer-od',
      view: 'side',
      side: 'right',
      lane: 0,
      label: '隔套外径 OD',
      valueText: 'Ø24.00 mm',
      valueMm: 24,
      witnesses: [[24, 0], [24, 24]],
      linkedFeatureIds: ['obj-spacer-body'],
    },
    {
      annotationId: 'ann-spacer-id',
      view: 'side',
      side: 'bottom',
      lane: 0,
      label: '隔套内径 ID',
      valueText: 'Ø12.00 mm',
      valueMm: 12,
      witnesses: [[6, 0], [18, 0]],
      linkedFeatureIds: ['obj-spacer-bore'],
    },
  ],
}

export const SHAFT_SPACER_SIMULATION_SPEC: SimulationLoopSpec = {
  id: 'loop-spacer-axial-gap',
  title: '隔套一维轴向封闭环间隙',
  measurementKind: 'gap',
  nominalMm: 0.2,
  lslMm: 0.1,
  uslMm: 0.3,
  sampleCount: 50000,
  seed: 20261127,
  contributors: [
    {
      id: 'contrib-spacer-length',
      label: '隔套长度 S 公差',
      partId: 'part-shaft-spacer',
      featureId: 'feat-spacer-right-end',
      partName: '隔套',
      featureLabel: '右接触端面',
      currentTolMm: 0.02,
      minTolMm: 0.005,
      maxTolMm: 0.08,
      stepMm: 0.005,
      sensitivity: 1.0,
      sign: -1,
      formatPrefix: '±',
    },
    {
      id: 'contrib-shaft-slot',
      label: '机架轴向槽宽 H 公差',
      partId: 'part-stepped-shaft',
      featureId: 'feat-shaft-cap-face',
      partName: '阶梯轴/端盖',
      featureLabel: '右端盖贴合面',
      currentTolMm: 0.03,
      minTolMm: 0.005,
      maxTolMm: 0.08,
      stepMm: 0.005,
      sensitivity: 1.0,
      sign: 1,
      formatPrefix: '±',
    },
    {
      id: 'contrib-bearing-width',
      label: '双侧轴承宽度 B1+B2 公差',
      partId: 'part-stepped-shaft',
      featureId: 'feat-shaft-shoulder',
      partName: '阶梯轴/端盖',
      featureLabel: '左轴肩定位面',
      currentTolMm: 0.02,
      minTolMm: 0.005,
      maxTolMm: 0.06,
      stepMm: 0.005,
      sensitivity: 1.0,
      sign: -1,
      formatPrefix: '±',
    },
  ],
}

// ---------------------------------------------------------------------------
// 3. builtin-compliant-cover-warpage (薄铝盖板 + 弹性隔套 + 双定位孔安装板)
// ---------------------------------------------------------------------------

const warpagePlateBox = buildBoxGeometry(0, 0, 0, 80, 50, 8)
const elasticSpacerCyl = buildCylinderPrism(6, 2, 12, 'z', [0, 0, 0])
const thinCoverBox = buildSubdividedPlateGeometry(0, 0, 0, 80, 50, 1.5, 4, 4)

export const COMPLIANT_COVER_PART_MESHES: readonly PartMesh[] = [
  {
    partId: 'part-mounting-plate',
    displayName: '双定位孔安装板',
    color: '#4c78a8',
    positions: warpagePlateBox.positions,
    indices: warpagePlateBox.indices,
    faceTriangleRanges: [
      {
        partId: 'part-mounting-plate',
        objectId: 'feat-plate-datum-a',
        featureRef: 'plate/top-face',
        label: '顶面（基准 A）',
        geometryKind: 'face',
        startTriangle: 2,
        endTriangle: 4,
      },
      {
        partId: 'part-mounting-plate',
        objectId: 'feat-plate-bottom',
        featureRef: 'plate/bottom-face',
        label: '底基准面',
        geometryKind: 'face',
        startTriangle: 0,
        endTriangle: 2,
      },
    ],
    edgeSegments: [
      {
        featureId: 'feat-plate-datum-b',
        partId: 'part-mounting-plate',
        label: '左定位孔（基准 B）',
        kind: 'cylindrical-hole-axis',
        points: [20, 25, 0, 20, 25, 8],
      },
      {
        featureId: 'feat-plate-right-hole',
        partId: 'part-mounting-plate',
        label: '右定位孔（⌖ Ø0.12 MMC）',
        kind: 'cylindrical-hole-axis',
        points: [60, 25, 0, 60, 25, 8],
      },
    ],
    nominalTransform: IDENTITY_4X4,
    bounds: { min: [0, 0, 0], max: [80, 50, 8] },
    explodeVector: [0, 0, -0.9],
  },
  {
    partId: 'part-elastic-spacer',
    displayName: '弹性隔套',
    color: '#f58518',
    positions: elasticSpacerCyl.positions,
    indices: elasticSpacerCyl.indices,
    faceTriangleRanges: [
      {
        partId: 'part-elastic-spacer',
        objectId: 'feat-spacer-bottom',
        featureRef: 'spacer/bottom-face',
        label: '下贴合面',
        geometryKind: 'face',
        startTriangle: 0,
        endTriangle: 12,
      },
      {
        partId: 'part-elastic-spacer',
        objectId: 'feat-spacer-top',
        featureRef: 'spacer/top-face',
        label: '顶面接触环',
        geometryKind: 'face',
        startTriangle: 12,
        endTriangle: 24,
      },
    ],
    nominalTransform: [
      [1, 0, 0, 40],
      [0, 1, 0, 25],
      [0, 0, 1, 8],
      [0, 0, 0, 1],
    ],
    bounds: { min: [-6, -6, 0], max: [6, 6, 2] },
    explodeVector: [0, 0, 0.3],
  },
  {
    partId: 'part-thin-al-cover',
    displayName: '薄铝盖板 (1.5mm 6061)',
    color: '#72b7b2',
    positions: thinCoverBox.positions,
    indices: thinCoverBox.indices,
    faceTriangleRanges: [
      {
        partId: 'part-thin-al-cover',
        objectId: 'feat-cover-bottom',
        featureRef: 'cover/bottom-face',
        label: '底面（翘曲 0.28 mm）',
        geometryKind: 'face',
        startTriangle: 0,
        endTriangle: thinCoverBox.bottomTriCount,
      },
      {
        partId: 'part-thin-al-cover',
        objectId: 'feat-cover-top',
        featureRef: 'cover/top-face',
        label: '盖板顶面',
        geometryKind: 'face',
        startTriangle: thinCoverBox.bottomTriCount,
        endTriangle: thinCoverBox.bottomTriCount + thinCoverBox.topTriCount,
      },
    ],
    edgeSegments: [
      { featureId: 'feat-cover-clamp-1', partId: 'part-thin-al-cover', label: '左下锁紧孔', kind: 'cylindrical-hole-axis', points: [8, 8, 0, 8, 8, 1.5] },
      { featureId: 'feat-cover-clamp-2', partId: 'part-thin-al-cover', label: '右下锁紧孔', kind: 'cylindrical-hole-axis', points: [72, 8, 0, 72, 8, 1.5] },
      { featureId: 'feat-cover-clamp-3', partId: 'part-thin-al-cover', label: '左上锁紧孔', kind: 'cylindrical-hole-axis', points: [8, 42, 0, 8, 42, 1.5] },
      { featureId: 'feat-cover-clamp-4', partId: 'part-thin-al-cover', label: '右上锁紧孔', kind: 'cylindrical-hole-axis', points: [72, 42, 0, 72, 42, 1.5] },
    ],
    nominalTransform: [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 10],
      [0, 0, 0, 1],
    ],
    bounds: { min: [0, 0, 0], max: [80, 50, 1.5] },
    explodeVector: [0, 0, 1.2],
  },
]

const plateVerts = warpagePlateBox.positions.length / 3
const elasticVerts = elasticSpacerCyl.positions.length / 3
const shiftedElasticPositions = elasticSpacerCyl.positions.map((v, i) =>
  i % 3 === 0 ? v + 40 : i % 3 === 1 ? v + 25 : v + 8,
)
const shiftedCoverPositions = thinCoverBox.positions.map((v, i) => (i % 3 === 2 ? v + 10 : v))

export const COMPLIANT_COVER_MODEL_MESH: M2ModelMesh = {
  frameId: 'world',
  positions: [...warpagePlateBox.positions, ...shiftedElasticPositions, ...shiftedCoverPositions],
  indices: [
    ...warpagePlateBox.indices,
    ...elasticSpacerCyl.indices.map((i) => i + plateVerts),
    ...thinCoverBox.indices.map((i) => i + plateVerts + elasticVerts),
  ],
  triangleRanges: [
    { startTriangle: 0, endTriangle: 4, objectId: 'obj-plate-datum-a', featureRef: 'plate/top-face', role: '安装板基准 A 平面', partName: '双定位孔安装板' },
    { startTriangle: 4, endTriangle: 8, objectId: 'obj-plate-datum-b', featureRef: 'plate/left-hole/cylinder', role: '基准 B 孔区', partName: '双定位孔安装板' },
    { startTriangle: 8, endTriangle: 12, objectId: 'obj-plate-right-hole', featureRef: 'plate/right-hole/cylinder', role: '右定位孔区', partName: '双定位孔安装板' },
    { startTriangle: 12, endTriangle: 60, objectId: 'obj-elastic-spacer', featureRef: 'spacer/top-face', role: '弹性隔套', partName: '弹性隔套' },
    { startTriangle: 60, endTriangle: 60 + thinCoverBox.indices.length / 3, objectId: 'obj-cover-surface', featureRef: 'cover/bottom-face', role: '薄铝盖板底面', partName: '薄铝盖板' },
  ],
  bounds: { min: [0, 0, 0], max: [80, 50, 11.5] },
}

export const COMPLIANT_COVER_DRAWING_VECTOR: M2DrawingVector = {
  unit: 'mm',
  revision: 'draft-1',
  displayDecimals: 2,
  convention: 'first-angle',
  views: [
    {
      id: 'top',
      title: '俯视图（四角锁紧孔 + 双定位孔）',
      size: [80, 50],
      lines: buildRectLines(0, 0, 80, 50),
      circles: [
        // 4 corner clamp holes Ø4.5
        { cx: 8, cy: 8, r: 2.25 },
        { cx: 72, cy: 8, r: 2.25 },
        { cx: 8, cy: 42, r: 2.25 },
        { cx: 72, cy: 42, r: 2.25 },
        // 2 locating holes Ø10
        { cx: 20, cy: 25, r: 5 },
        { cx: 60, cy: 25, r: 5 },
        // Center elastic spacer Ø12
        { cx: 40, cy: 25, r: 6 },
      ],
      hiddenLines: [
        { x1: 20, y1: 18, x2: 20, y2: 32 },
        { x1: 60, y1: 18, x2: 60, y2: 32 },
        { x1: 32, y1: 25, x2: 48, y2: 25 },
      ],
    },
    {
      id: 'front',
      title: '主视图（1.5 mm 薄铝盖板 + 弹性隔套）',
      size: [80, 12],
      lines: [
        ...buildRectLines(0, 0, 80, 8),
        ...buildRectLines(34, 8, 46, 10),
        ...buildRectLines(0, 10, 80, 11.5),
      ],
      circles: [],
      hiddenLines: [
        { x1: 15, y1: 0, x2: 15, y2: 8 },
        { x1: 25, y1: 0, x2: 25, y2: 8 },
        { x1: 55, y1: 0, x2: 55, y2: 8 },
        { x1: 65, y1: 0, x2: 65, y2: 8 },
      ],
    },
    {
      id: 'side',
      title: '侧视图（锁紧后残余间隙）',
      size: [50, 12],
      lines: [
        ...buildRectLines(0, 0, 50, 8),
        ...buildRectLines(19, 8, 31, 10),
        ...buildRectLines(0, 10, 50, 11.5),
      ],
      circles: [],
      hiddenLines: [
        { x1: 22, y1: 8, x2: 22, y2: 10 },
        { x1: 28, y1: 8, x2: 28, y2: 10 },
      ],
    },
  ],
  annotations: [
    {
      annotationId: 'ann-right-hole-pos',
      view: 'top',
      side: 'top',
      lane: 0,
      label: '右定位孔位置度',
      valueText: '⌖ Ø0.12 Ⓜ | A | B Ⓜ',
      valueMm: 0.12,
      witnesses: [[20, 50], [60, 50]],
      linkedFeatureIds: ['obj-plate-right-hole', 'obj-plate-datum-b'],
    },
    {
      annotationId: 'ann-cover-flatness',
      view: 'front',
      side: 'top',
      lane: 0,
      label: '薄铝盖板自由态平面度',
      valueText: '⏥ 0.28 mm (6061-T6, t=1.5)',
      valueMm: 0.28,
      witnesses: [[0, 11.5], [80, 11.5]],
      linkedFeatureIds: ['obj-cover-surface'],
    },
    {
      annotationId: 'ann-spacer-preload',
      view: 'side',
      side: 'top',
      lane: 0,
      label: '四角锁紧预紧力与隔套压缩',
      valueText: '4 × 450 N (1800 ±180 N)',
      valueMm: 2.0,
      witnesses: [[19, 10], [31, 10]],
      linkedFeatureIds: ['obj-elastic-spacer'],
    },
    {
      annotationId: 'ann-residual-gap',
      view: 'side',
      side: 'right',
      lane: 0,
      label: '锁紧后残余间隙封闭环',
      valueText: '2.00 mm [1.55, 2.30]',
      valueMm: 2.0,
      witnesses: [[50, 8], [50, 10]],
      linkedFeatureIds: ['obj-cover-surface', 'obj-plate-datum-a', 'obj-elastic-spacer'],
    },
  ],
}

export const COMPLIANT_COVER_SIMULATION_SPEC: SimulationLoopSpec = {
  id: 'loop-compliant-cover-warpage',
  title: '薄铝盖板四角锁紧残余间隙',
  measurementKind: 'gap',
  nominalMm: 2.0,
  lslMm: 1.5,
  uslMm: 2.3,
  sampleCount: 50000,
  seed: 20261128,
  contributors: [
    {
      id: 'contrib-cover-warpage',
      label: '薄铝盖板自由态翘曲平面度',
      partId: 'part-thin-al-cover',
      featureId: 'feat-cover-bottom',
      partName: '薄铝盖板 (1.5mm 6061)',
      featureLabel: '底面（翘曲 0.28 mm）',
      currentTolMm: 0.14,
      minTolMm: 0.02,
      maxTolMm: 0.3,
      stepMm: 0.01,
      sensitivity: 1.0,
      sign: 1,
      formatPrefix: '±',
    },
    {
      id: 'contrib-plate-right-hole-pos',
      label: '安装板右定位孔位置度',
      partId: 'part-mounting-plate',
      featureId: 'feat-plate-right-hole',
      partName: '双定位孔安装板',
      featureLabel: '右定位孔（⌖ Ø0.12 MMC）',
      currentTolMm: 0.12,
      minTolMm: 0.02,
      maxTolMm: 0.25,
      stepMm: 0.01,
      sensitivity: 0.85,
      sign: 1,
      formatPrefix: 'Ø',
    },
    {
      id: 'contrib-elastic-spacer-height',
      label: '弹性隔套高度与预紧压缩',
      partId: 'part-elastic-spacer',
      featureId: 'feat-spacer-top',
      partName: '弹性隔套',
      featureLabel: '顶面接触环',
      currentTolMm: 0.06,
      minTolMm: 0.01,
      maxTolMm: 0.15,
      stepMm: 0.005,
      sensitivity: 1.0,
      sign: -1,
      formatPrefix: '±',
    },
  ],
}
