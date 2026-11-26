import type {
  M2CheckItem,
  M2DrawingAnnotationItem,
  M2ModelFeatureItem,
  M2PreviewSnapshot,
  M2RequirementItem,
} from '../../desktop/shared/project-agent/m2-preview'
import type { M1TaskbookReference } from '../workspace/project-agent/m1WorkbenchBridge'
import type { ChainDefinition, DimensionTerm } from '../domain/types'
import { parseMm } from '../domain/units'
import type { AssemblyModelV1 } from '../project-file/types'

export type BuiltinTemplateId =
  | 'builtin-mounting-plate'
  | 'builtin-shaft-spacer'
  | 'builtin-compliant-cover-warpage'

export interface BuiltinTemplateProjectDefaults {
  readonly projectId: string
  readonly projectName: string
  readonly baseRevision: string | null
  readonly draftRevision: string | null
  readonly isSample?: boolean
  readonly summary: string
}

export interface BuiltinTemplateDefinition {
  readonly templateId: BuiltinTemplateId
  readonly displayName: string
  readonly category: '3d-part' | '1d-chain'
  readonly summary: string
  readonly schemaVersion: 11
  readonly readonly: true
  readonly projectDefaults: BuiltinTemplateProjectDefaults
  readonly previewSnapshot: M2PreviewSnapshot
  readonly taskbooks: readonly M1TaskbookReference[]
  readonly chain: ChainDefinition | null
  readonly assembly3d: AssemblyModelV1
  readonly regressionNotes: readonly string[]
}

export interface ClonedTemplateDraft {
  readonly draftId: string
  readonly templateId: BuiltinTemplateId
  readonly projectId: string
  readonly projectName: string
  readonly baseRevision: string | null
  readonly draftRevision: string
  readonly summary: string
  readonly createdAt: string
  readonly previewSnapshot: M2PreviewSnapshot
  readonly taskbooks: M1TaskbookReference[]
  readonly chain: ChainDefinition | null
  readonly assembly3d: AssemblyModelV1
  readonly regressionNotes: string[]
}

export interface CloneTemplateOptions {
  readonly projectId?: string
  readonly projectName?: string
  readonly draftRevision?: string
  readonly now?: () => Date
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (ArrayBuffer.isView(value)) {
    return value
  }
  if (!Object.isFrozen(value)) {
    Object.freeze(value)
  }
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    deepFreeze(record[key])
  }
  return value
}

function deepClone<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (value instanceof Uint8Array) {
    return new Uint8Array(value) as unknown as T
  }
  if (value instanceof Float32Array) {
    return new Float32Array(value) as unknown as T
  }
  if (value instanceof Uint32Array) {
    return new Uint32Array(value) as unknown as T
  }
  if (value instanceof Date) {
    return new Date(value.getTime()) as unknown as T
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item)) as unknown as T
  }
  const cloned: Record<string, unknown> = {}
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    cloned[key] = deepClone(record[key])
  }
  return cloned as T
}

const IDENTITY_TRANSFORM = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
] as const satisfies AssemblyModelV1['parts'][number]['nominalTransform']

const COVER_PLATE_TRANSFORM = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 10],
  [0, 0, 0, 1],
] as const satisfies AssemblyModelV1['parts'][number]['nominalTransform']

const MOUNTING_PLATE_FEATURES: readonly M2ModelFeatureItem[] = [
  {
    objectId: 'obj-right-hole',
    breadcrumb: '安装板 › 右孔 › 圆柱面',
    featureRef: 'plate/right-hole/cylinder',
    partName: '安装板',
    role: '右孔圆柱面',
    kind: 'hole',
    linkedAnnotationIds: ['ann-right-margin', 'ann-right-hole-dia'],
    bounds: { x: 66, y: 46, w: 12, h: 12 },
  },
  {
    objectId: 'obj-left-hole',
    breadcrumb: '安装板 › 左孔 › 圆柱面',
    featureRef: 'plate/left-hole/cylinder',
    partName: '安装板',
    role: '左孔圆柱面',
    kind: 'hole',
    linkedAnnotationIds: ['ann-hole-pitch'],
    bounds: { x: 24, y: 46, w: 12, h: 12 },
  },
  {
    objectId: 'obj-right-face',
    breadcrumb: '安装板 › 右端面',
    featureRef: 'plate/right-end-face',
    partName: '安装板',
    role: '右端面',
    kind: 'face',
    linkedAnnotationIds: ['ann-right-margin', 'ann-plate-length'],
    bounds: { x: 86, y: 20, w: 6, h: 60 },
  },
  {
    objectId: 'obj-cover-gap',
    breadcrumb: '参考盖板 › 底面与安装板顶面间隙',
    featureRef: 'assembly/cover-plate/top-gap',
    partName: '参考盖板',
    role: '顶面法向间隙',
    kind: 'gap',
    linkedAnnotationIds: ['ann-cover-gap'],
    bounds: { x: 18, y: 12, w: 64, h: 10 },
  },
]

const MOUNTING_PLATE_ANNOTATIONS: readonly M2DrawingAnnotationItem[] = [
  {
    annotationId: 'ann-right-margin',
    label: '右孔至右端面边距',
    valueText: '15.0 mm (最差 ≥ 13.0 mm)',
    view: 'top',
    linkedFeatureIds: ['obj-right-hole', 'obj-right-face'],
    requirementIds: ['req-right-margin'],
  },
  {
    annotationId: 'ann-right-hole-dia',
    label: '右孔孔径',
    valueText: 'Ø10.0 ±0.1 mm',
    view: 'top',
    linkedFeatureIds: ['obj-right-hole'],
    requirementIds: ['req-plate-geometry'],
  },
  {
    annotationId: 'ann-hole-pitch',
    label: '两孔中心距',
    valueText: '40.0 mm',
    view: 'top',
    linkedFeatureIds: ['obj-left-hole', 'obj-right-hole'],
    requirementIds: ['req-plate-geometry'],
  },
  {
    annotationId: 'ann-plate-length',
    label: '安装板外形长度',
    valueText: '80.0 × 50.0 × 8.0 mm',
    view: 'front',
    linkedFeatureIds: ['obj-right-face'],
    requirementIds: ['req-plate-geometry'],
  },
  {
    annotationId: 'ann-cover-gap',
    label: '盖板与安装板间隙',
    valueText: '2.0 mm [1.7, 2.3]',
    view: 'side',
    linkedFeatureIds: ['obj-cover-gap'],
    requirementIds: ['req-cover-gap'],
  },
]

const MOUNTING_PLATE_REQUIREMENTS: readonly M2RequirementItem[] = [
  {
    requirementId: 'req-right-margin',
    title: '右孔至右端面剩余材料 ≥ 13 mm',
    interpretation: '在 X/Y 位置 ±0.2 mm、孔径 ±0.1 mm 独立变化下，最小剩余材料不得低于 13 mm。',
    required: true,
    status: 'confirmed',
    anchor: {
      documentRef: 'doc-plate-taskbook',
      documentName: '安装板任务书.pdf',
      page: 2,
      region: { x: 110, y: 240, width: 420, height: 64, unit: 'pdfPoint1000' },
      excerpt: '右孔至右端面的剩余材料在全部允许变化下至少为 13 mm。',
    },
    linkedFeatureIds: ['obj-right-hole', 'obj-right-face'],
    linkedAnnotationIds: ['ann-right-margin'],
  },
  {
    requirementId: 'req-cover-gap',
    title: '参考盖板与安装板间隙 ≥ 1.5 mm',
    interpretation: '盖板底面 Z = 10 ±0.1 mm，安装板厚度 8 ±0.2 mm，沿法向间隙至少 1.5 mm。',
    required: true,
    status: 'confirmed',
    anchor: {
      documentRef: 'doc-plate-taskbook',
      documentName: '安装板任务书.pdf',
      page: 2,
      region: { x: 110, y: 340, width: 430, height: 72, unit: 'pdfPoint1000' },
      excerpt: '参考盖板底面 Z 为 10 ±0.1 mm，安装板厚度 8 ±0.2 mm，要求间隙至少 1.5 mm。',
    },
    linkedFeatureIds: ['obj-cover-gap'],
    linkedAnnotationIds: ['ann-cover-gap'],
  },
  {
    requirementId: 'req-datum-conflict',
    title: '孔中心基准与厚度说明复核',
    interpretation: '当前识别到两处厚度说明不一致，且孔中心基准需确认。',
    required: true,
    status: 'needsClarification',
    clarificationReason: 'conflict',
    clarificationPrompt: '请确认安装板厚度以第 1 页 8 mm 为准，并确认孔中心基准面。',
    anchor: {
      documentRef: 'doc-plate-taskbook',
      documentName: '安装板任务书.pdf',
      page: 1,
      region: { x: 96, y: 180, width: 410, height: 58, unit: 'pdfPoint1000' },
      excerpt: '长方形安装板 80 × 50 × 8 mm，两只直径 10 mm 的通孔中心 (20,25) 与 (60,25) mm。',
    },
    linkedFeatureIds: ['obj-left-hole', 'obj-right-hole'],
    linkedAnnotationIds: ['ann-hole-pitch'],
  },
]

const MOUNTING_PLATE_CHECKS: readonly M2CheckItem[] = [
  {
    checkId: 'chk-right-margin',
    requirementId: 'req-right-margin',
    title: '右孔至右端面最小剩余材料',
    required: true,
    status: 'pass',
    summary: '名义 15.0 mm，最差区间 [14.75, 15.25] mm ≥ 13.0 mm',
    linkedFeatureIds: ['obj-right-hole', 'obj-right-face'],
    linkedAnnotationIds: ['ann-right-margin'],
    revisionFingerprint: 'fp-draft-2',
    anchor: MOUNTING_PLATE_REQUIREMENTS[0].anchor,
  },
  {
    checkId: 'chk-cover-gap',
    requirementId: 'req-cover-gap',
    title: '参考盖板与安装板法向间隙',
    required: true,
    status: 'pass',
    summary: '名义 2.0 mm，区间 [1.7, 2.3] mm ≥ 1.5 mm',
    linkedFeatureIds: ['obj-cover-gap'],
    linkedAnnotationIds: ['ann-cover-gap'],
    revisionFingerprint: 'fp-draft-2',
    anchor: MOUNTING_PLATE_REQUIREMENTS[1].anchor,
  },
  {
    checkId: 'chk-datum-clarify',
    requirementId: 'req-datum-conflict',
    title: '孔中心基准与厚度冲突澄清',
    required: true,
    status: 'needsClarification',
    summary: '存在缺失基准或来源冲突，需设计师逐条回答或纠正解释',
    clarificationReason: 'conflict',
    clarificationPrompt: '请确认中心距与厚度来源，确认后再继续重算。',
    linkedFeatureIds: ['obj-left-hole', 'obj-right-hole'],
    linkedAnnotationIds: ['ann-hole-pitch'],
    revisionFingerprint: 'fp-draft-2',
    anchor: MOUNTING_PLATE_REQUIREMENTS[2].anchor,
  },
]

const MOUNTING_PLATE_TASKBOOKS: readonly M1TaskbookReference[] = [
  {
    refId: 'tb-plate-p1',
    documentName: '安装板任务书.pdf',
    page: 1,
    excerpt: '长方形安装板 80 × 50 × 8 mm，两只直径 10 mm 通孔中心 (20,25) 与 (60,25) mm。',
  },
  {
    refId: 'tb-plate-p2',
    documentName: '安装板任务书.pdf',
    page: 2,
    excerpt: '右孔至右端面剩余材料在全部允许变化下至少 13 mm；参考盖板间隙至少 1.5 mm。',
  },
]

const MOUNTING_PLATE_ASSEMBLY: AssemblyModelV1 = {
  schemaVersion: 1,
  units: 'mm',
  parts: [
    {
      id: 'part-mounting-plate',
      displayName: '安装板',
      color: '#4c78a8',
      nominalTransform: [
        [...IDENTITY_TRANSFORM[0]],
        [...IDENTITY_TRANSFORM[1]],
        [...IDENTITY_TRANSFORM[2]],
        [...IDENTITY_TRANSFORM[3]],
      ],
      kind: 'parametric-primitive',
      baseKind: 'plate',
      sizeQ: {
        lengthQ: parseMm('80.0000'),
        widthQ: parseMm('50.0000'),
        thicknessQ: parseMm('8.0000'),
      },
      modifiers: [
        {
          id: 'mod-left-hole',
          kind: 'through-hole',
          originQ: [parseMm('20.0000'), parseMm('25.0000'), 0],
          axis: [0, 0, 1],
          diameterQ: parseMm('10.0000'),
        },
        {
          id: 'mod-right-hole',
          kind: 'through-hole',
          originQ: [parseMm('60.0000'), parseMm('25.0000'), 0],
          axis: [0, 0, 1],
          diameterQ: parseMm('10.0000'),
        },
      ],
    },
    {
      id: 'part-reference-cover',
      displayName: '参考盖板',
      color: '#72b7b2',
      nominalTransform: [
        [...COVER_PLATE_TRANSFORM[0]],
        [...COVER_PLATE_TRANSFORM[1]],
        [...COVER_PLATE_TRANSFORM[2]],
        [...COVER_PLATE_TRANSFORM[3]],
      ],
      kind: 'parametric-primitive',
      baseKind: 'plate',
      sizeQ: {
        lengthQ: parseMm('80.0000'),
        widthQ: parseMm('50.0000'),
        thicknessQ: parseMm('4.0000'),
      },
      modifiers: [],
    },
  ],
  features: [
    {
      id: 'feat-plate-top',
      partId: 'part-mounting-plate',
      signature: 'plate/top-face',
      kind: 'face',
      surface: 'plane',
      originQ: [parseMm('40.0000'), parseMm('25.0000'), parseMm('8.0000')],
      normal: [0, 0, 1],
    },
    {
      id: 'feat-cover-bottom',
      partId: 'part-reference-cover',
      signature: 'cover/bottom-face',
      kind: 'face',
      surface: 'plane',
      originQ: [parseMm('40.0000'), parseMm('25.0000'), parseMm('10.0000')],
      normal: [0, 0, -1],
    },
    {
      id: 'feat-right-hole-axis',
      partId: 'part-mounting-plate',
      signature: 'plate/right-hole/cylinder',
      kind: 'cylindrical-hole-axis',
      originQ: [parseMm('60.0000'), parseMm('25.0000'), 0],
      axis: [0, 0, 1],
      radiusQ: parseMm('5.0000'),
    },
    {
      id: 'feat-right-end-face',
      partId: 'part-mounting-plate',
      signature: 'plate/right-end-face',
      kind: 'face',
      surface: 'plane',
      originQ: [parseMm('80.0000'), parseMm('25.0000'), parseMm('4.0000')],
      normal: [1, 0, 0],
    },
  ],
  mates: [
    {
      id: 'mate-cover-gap',
      kind: 'distance',
      constrainedDofs: ['tz'],
      featureIds: ['feat-plate-top', 'feat-cover-bottom'],
      distanceQ: parseMm('2.0000'),
    },
  ],
  datums: [{ id: 'datum-a', label: 'A', featureId: 'feat-plate-top' }],
  gdt: [],
  measurements: [
    {
      id: 'meas-cover-gap',
      kind: 'gap',
      featureIds: ['feat-plate-top', 'feat-cover-bottom'],
    },
    {
      id: 'meas-right-margin',
      kind: 'center-distance',
      featureIds: ['feat-right-hole-axis', 'feat-right-end-face'],
    },
  ],
}

function createSpacerTerm(
  id: string,
  symbol: string,
  name: string,
  nominal: string,
  lower: string,
  upper: string,
  sign: 1 | -1,
): DimensionTerm {
  return {
    id,
    symbol,
    name,
    nominalQ: parseMm(nominal),
    lowerDeviationQ: parseMm(lower),
    upperDeviationQ: parseMm(upper),
    sign,
    sourceNote: '内置隔套兼容模板基准（12.00 / 12.04 / 12.10 / 12.05 回归基准）',
    termRevision: 1,
  }
}

const SHAFT_SPACER_CHAIN: ChainDefinition = {
  terms: [
    createSpacerTerm('spacer-term-h', 'H', '机架轴向槽宽', '100.0000', '0.0000', '0.0300', 1),
    createSpacerTerm('spacer-term-b1', 'B1', '左侧轴承宽度', '20.0000', '-0.0200', '0.0000', -1),
    createSpacerTerm('spacer-term-s', 'S', '隔套长度', '59.8000', '-0.0200', '0.0200', -1),
    createSpacerTerm('spacer-term-b2', 'B2', '右侧轴承宽度', '20.0000', '-0.0200', '0.0000', -1),
  ],
  target: {
    minQ: parseMm('0.1000'),
    maxQ: parseMm('0.3000'),
  },
  assumptions: '一维轴向刚体接触装配，隔套长度 S 联动参数与经典回归基准一致。',
}

const SHAFT_SPACER_FEATURES: readonly M2ModelFeatureItem[] = [
  {
    objectId: 'obj-spacer-body',
    breadcrumb: '隔套 › 外圆柱面',
    featureRef: 'spacer/outer-diameter',
    partName: '隔套',
    role: '外径 Ø24.0 mm',
    kind: 'other',
    linkedAnnotationIds: ['ann-spacer-od', 'ann-spacer-length'],
    bounds: { x: 26, y: 26, w: 48, h: 48 },
  },
  {
    objectId: 'obj-spacer-bore',
    breadcrumb: '隔套 › 内孔圆柱面',
    featureRef: 'spacer/inner-diameter',
    partName: '隔套',
    role: '内径 Ø12.0 mm',
    kind: 'hole',
    linkedAnnotationIds: ['ann-spacer-id'],
    bounds: { x: 38, y: 38, w: 24, h: 24 },
  },
  {
    objectId: 'obj-spacer-end-face',
    breadcrumb: '隔套 › 右端面（轴向接触面）',
    featureRef: 'spacer/right-end-face',
    partName: '隔套',
    role: '轴向接触端面',
    kind: 'face',
    linkedAnnotationIds: ['ann-spacer-length', 'ann-spacer-axial-gap'],
    bounds: { x: 74, y: 26, w: 8, h: 48 },
  },
]

const SHAFT_SPACER_ANNOTATIONS: readonly M2DrawingAnnotationItem[] = [
  {
    annotationId: 'ann-spacer-length',
    label: '隔套长度 L',
    valueText: '59.80 ±0.02 mm',
    view: 'front',
    linkedFeatureIds: ['obj-spacer-body', 'obj-spacer-end-face'],
    requirementIds: ['req-spacer-axial-gap'],
  },
  {
    annotationId: 'ann-spacer-od',
    label: '隔套外径 OD',
    valueText: 'Ø24.00 mm',
    view: 'side',
    linkedFeatureIds: ['obj-spacer-body'],
    requirementIds: ['req-spacer-geometry'],
  },
  {
    annotationId: 'ann-spacer-id',
    label: '隔套内径 ID',
    valueText: 'Ø12.00 mm',
    view: 'side',
    linkedFeatureIds: ['obj-spacer-bore'],
    requirementIds: ['req-spacer-geometry'],
  },
  {
    annotationId: 'ann-spacer-axial-gap',
    label: '轴向封闭环间隙',
    valueText: '0.20 mm [0.18, 0.29]',
    view: 'front',
    linkedFeatureIds: ['obj-spacer-end-face'],
    requirementIds: ['req-spacer-axial-gap'],
  },
]

const SHAFT_SPACER_REQUIREMENTS: readonly M2RequirementItem[] = [
  {
    requirementId: 'req-spacer-axial-gap',
    title: '轴向装配间隙维持在 [0.10, 0.30] mm',
    interpretation: '由机架槽宽 H、两只轴承 B1/B2 与隔套长度 S 组成的一维轴向尺寸链满足极值目标区间。',
    required: true,
    status: 'confirmed',
    anchor: {
      documentRef: 'doc-spacer-baseline',
      documentName: '隔套轴向尺寸链基准.pdf',
      page: 1,
      region: { x: 90, y: 160, width: 420, height: 60, unit: 'pdfPoint1000' },
      excerpt: '隔套轴向装配间隙目标区间 [0.10, 0.30] mm，保留 12.00/12.04/12.10/12.05 回归基准。',
    },
    linkedFeatureIds: ['obj-spacer-body', 'obj-spacer-end-face'],
    linkedAnnotationIds: ['ann-spacer-length', 'ann-spacer-axial-gap'],
  },
]

const SHAFT_SPACER_CHECKS: readonly M2CheckItem[] = [
  {
    checkId: 'chk-spacer-axial-gap',
    requirementId: 'req-spacer-axial-gap',
    title: '隔套一维轴向间隙极值检查',
    required: true,
    status: 'pass',
    summary: '名义 0.20 mm，极值区间 [0.18, 0.29] mm ∈ [0.10, 0.30] mm',
    linkedFeatureIds: ['obj-spacer-body', 'obj-spacer-end-face'],
    linkedAnnotationIds: ['ann-spacer-length', 'ann-spacer-axial-gap'],
    revisionFingerprint: 'fp-spacer-v3',
    anchor: SHAFT_SPACER_REQUIREMENTS[0].anchor,
  },
]

const SHAFT_SPACER_TASKBOOKS: readonly M1TaskbookReference[] = [
  {
    refId: 'tb-spacer-p1',
    documentName: '隔套轴向尺寸链基准.pdf',
    page: 1,
    excerpt: '隔套内径 Ø12.00 mm、外径 Ø24.00 mm、长度 59.80 ±0.02 mm，轴向间隙目标 [0.10, 0.30] mm。',
  },
]

const SHAFT_SPACER_ASSEMBLY: AssemblyModelV1 = {
  schemaVersion: 1,
  units: 'mm',
  parts: [
    {
      id: 'part-shaft-spacer',
      displayName: '隔套',
      color: '#e45756',
      nominalTransform: [
        [...IDENTITY_TRANSFORM[0]],
        [...IDENTITY_TRANSFORM[1]],
        [...IDENTITY_TRANSFORM[2]],
        [...IDENTITY_TRANSFORM[3]],
      ],
      kind: 'parametric-primitive',
      baseKind: 'cylinder-spacer',
      sizeQ: {
        innerDiameterQ: parseMm('12.0000'),
        outerDiameterQ: parseMm('24.0000'),
        lengthQ: parseMm('59.8000'),
      },
      modifiers: [],
    },
  ],
  features: [
    {
      id: 'feat-spacer-left-end',
      partId: 'part-shaft-spacer',
      signature: 'spacer/left-end-face',
      kind: 'face',
      surface: 'plane',
      originQ: [0, 0, 0],
      normal: [0, 0, -1],
    },
    {
      id: 'feat-spacer-right-end',
      partId: 'part-shaft-spacer',
      signature: 'spacer/right-end-face',
      kind: 'face',
      surface: 'plane',
      originQ: [0, 0, parseMm('59.8000')],
      normal: [0, 0, 1],
    },
    {
      id: 'feat-spacer-bore-axis',
      partId: 'part-shaft-spacer',
      signature: 'spacer/inner-diameter',
      kind: 'cylindrical-hole-axis',
      originQ: [0, 0, 0],
      axis: [0, 0, 1],
      radiusQ: parseMm('6.0000'),
    },
  ],
  mates: [],
  datums: [{ id: 'datum-spacer-axis', label: 'A', featureId: 'feat-spacer-bore-axis' }],
  gdt: [],
  measurements: [
    {
      id: 'meas-spacer-length',
      kind: 'gap',
      featureIds: ['feat-spacer-left-end', 'feat-spacer-right-end'],
    },
  ],
}

const SPACER_ELEVATED_TRANSFORM = [
  [1, 0, 0, 40],
  [0, 1, 0, 25],
  [0, 0, 1, 8],
  [0, 0, 0, 1],
] as const satisfies AssemblyModelV1['parts'][number]['nominalTransform']

const COMPLIANT_COVER_FEATURES: readonly M2ModelFeatureItem[] = [
  {
    objectId: 'obj-cover-surface',
    breadcrumb: '薄铝盖板 › 底面（初始翘曲 0.28 mm）',
    featureRef: 'cover/bottom-face',
    partName: '薄铝盖板',
    role: '翘曲拉平基准面',
    kind: 'face',
    linkedAnnotationIds: ['ann-cover-flatness', 'ann-residual-gap'],
    bounds: { x: 16, y: 14, w: 68, h: 12 },
  },
  {
    objectId: 'obj-plate-datum-a',
    breadcrumb: '安装板 › 顶面（基准 A）',
    featureRef: 'plate/top-face',
    partName: '安装板',
    role: '基准 A 平面',
    kind: 'face',
    linkedAnnotationIds: ['ann-residual-gap'],
    bounds: { x: 16, y: 30, w: 68, h: 10 },
  },
  {
    objectId: 'obj-plate-datum-b',
    breadcrumb: '安装板 › 左定位孔（基准 B）',
    featureRef: 'plate/left-hole/cylinder',
    partName: '安装板',
    role: '基准 B 圆柱孔',
    kind: 'hole',
    linkedAnnotationIds: ['ann-right-hole-pos'],
    bounds: { x: 24, y: 48, w: 12, h: 12 },
  },
  {
    objectId: 'obj-plate-right-hole',
    breadcrumb: '安装板 › 右定位孔（⌖ Ø0.12 MMC）',
    featureRef: 'plate/right-hole/cylinder',
    partName: '安装板',
    role: '位置度受控孔',
    kind: 'hole',
    linkedAnnotationIds: ['ann-right-hole-pos'],
    bounds: { x: 64, y: 48, w: 12, h: 12 },
  },
  {
    objectId: 'obj-elastic-spacer',
    breadcrumb: '弹性隔套 › 顶面接触环',
    featureRef: 'spacer/top-face',
    partName: '弹性隔套',
    role: '轴向预紧压缩承载面',
    kind: 'other',
    linkedAnnotationIds: ['ann-spacer-preload', 'ann-residual-gap'],
    bounds: { x: 44, y: 24, w: 12, h: 8 },
  },
]

const COMPLIANT_COVER_ANNOTATIONS: readonly M2DrawingAnnotationItem[] = [
  {
    annotationId: 'ann-cover-flatness',
    label: '薄铝盖板自由态平面度',
    valueText: '⏥ 0.28 mm (6061-T6, t = 1.5 mm)',
    view: 'front',
    linkedFeatureIds: ['obj-cover-surface'],
    requirementIds: ['req-cover-warpage'],
  },
  {
    annotationId: 'ann-right-hole-pos',
    label: '右定位孔位置度',
    valueText: '⌖ Ø0.12 Ⓜ | A | B Ⓜ',
    view: 'top',
    linkedFeatureIds: ['obj-plate-right-hole', 'obj-plate-datum-b'],
    requirementIds: ['req-right-hole-pos'],
  },
  {
    annotationId: 'ann-spacer-preload',
    label: '四角锁紧预紧力与隔套压缩',
    valueText: '4 × 450 N (总预紧 1800 ±180 N)',
    view: 'side',
    linkedFeatureIds: ['obj-elastic-spacer'],
    requirementIds: ['req-residual-gap'],
  },
  {
    annotationId: 'ann-residual-gap',
    label: '锁紧后残余间隙封闭环',
    valueText: '2.00 mm [1.55, 2.30] (计入柔性形变)',
    view: 'side',
    linkedFeatureIds: ['obj-cover-surface', 'obj-plate-datum-a', 'obj-elastic-spacer'],
    requirementIds: ['req-residual-gap'],
  },
]

const COMPLIANT_COVER_REQUIREMENTS: readonly M2RequirementItem[] = [
  {
    requirementId: 'req-residual-gap',
    title: '薄铝盖板四角锁紧后中心残余间隙 ≥ 1.50 mm',
    interpretation:
      '1.5 mm 6061-T6 铝盖板存在 0.28 mm 初始翘曲，经四角 450 N 螺栓锁紧并叠加弹性隔套压缩后，中心残余间隙需不低于 1.50 mm。',
    required: true,
    status: 'confirmed',
    anchor: {
      documentRef: 'doc-cover-warpage-spec',
      documentName: '薄铝盖板翘曲锁紧任务书.pdf',
      page: 1,
      region: { x: 96, y: 180, width: 420, height: 72, unit: 'pdfPoint1000' },
      excerpt: '薄铝盖板 80×50×1.5 mm（6061-T6），自由态平面度 ⏥ 0.28 mm，四角螺栓锁紧后残余间隙 ≥ 1.50 mm。',
    },
    linkedFeatureIds: ['obj-cover-surface', 'obj-plate-datum-a', 'obj-elastic-spacer'],
    linkedAnnotationIds: ['ann-residual-gap', 'ann-spacer-preload'],
  },
  {
    requirementId: 'req-cover-warpage',
    title: '盖板自由态平面度 ⏥ 0.28 mm',
    interpretation: '自由态薄板最大初始翘曲峰值为 0.28 ±0.04 mm，作为柔性锁紧拉平初始输入。',
    required: true,
    status: 'confirmed',
    anchor: {
      documentRef: 'doc-cover-warpage-spec',
      documentName: '薄铝盖板翘曲锁紧任务书.pdf',
      page: 1,
      region: { x: 96, y: 270, width: 410, height: 60, unit: 'pdfPoint1000' },
      excerpt: '盖板底面自由态平面度 ⏥ 0.28 mm，需与弹性隔套压缩耦合分析。',
    },
    linkedFeatureIds: ['obj-cover-surface'],
    linkedAnnotationIds: ['ann-cover-flatness'],
  },
  {
    requirementId: 'req-right-hole-pos',
    title: '安装板右定位孔位置度 ⌖ Ø0.12 MMC（相对 A / B）',
    interpretation: '以安装板顶面为基准 A、左 Ø10 mm 孔为基准 B，右 Ø10 mm 孔满足 ⌖ Ø0.12 MMC。',
    required: true,
    status: 'confirmed',
    anchor: {
      documentRef: 'doc-cover-warpage-spec',
      documentName: '薄铝盖板翘曲锁紧任务书.pdf',
      page: 2,
      region: { x: 96, y: 210, width: 410, height: 60, unit: 'pdfPoint1000' },
      excerpt: '安装板双定位孔 Ø10 ±0.10 mm，右孔位置度 ⌖ Ø0.12 MMC 相对基准 A / B。',
    },
    linkedFeatureIds: ['obj-plate-right-hole', 'obj-plate-datum-b'],
    linkedAnnotationIds: ['ann-right-hole-pos'],
  },
]

const COMPLIANT_COVER_CHECKS: readonly M2CheckItem[] = [
  {
    checkId: 'chk-residual-gap-compliant',
    requirementId: 'req-residual-gap',
    title: '薄铝盖板锁紧后残余间隙（柔性耦合）',
    required: true,
    status: 'pass',
    summary: '刚体名义 2.00 mm；计入 0.28 mm 翘曲拉平与隔套压缩后残余间隙满足 ≥ 1.50 mm',
    linkedFeatureIds: ['obj-cover-surface', 'obj-plate-datum-a', 'obj-elastic-spacer'],
    linkedAnnotationIds: ['ann-residual-gap', 'ann-cover-flatness'],
    revisionFingerprint: 'fp-cover-warpage-v1',
    anchor: COMPLIANT_COVER_REQUIREMENTS[0].anchor,
  },
  {
    checkId: 'chk-right-hole-pos',
    requirementId: 'req-right-hole-pos',
    title: '安装板右孔位置度 ⌖ Ø0.12 MMC',
    required: true,
    status: 'pass',
    summary: '位置度 ⌖ Ø0.12 MMC（基准 A / B Ⓜ）含最大实体补偿校验通过',
    linkedFeatureIds: ['obj-plate-right-hole', 'obj-plate-datum-b'],
    linkedAnnotationIds: ['ann-right-hole-pos'],
    revisionFingerprint: 'fp-cover-warpage-v1',
    anchor: COMPLIANT_COVER_REQUIREMENTS[2].anchor,
  },
]

const COMPLIANT_COVER_TASKBOOKS: readonly M1TaskbookReference[] = [
  {
    refId: 'tb-cover-warpage-p1',
    documentName: '薄铝盖板翘曲锁紧任务书.pdf',
    page: 1,
    excerpt: '1.5 mm 6061-T6 薄铝盖板（初始翘曲 0.28 mm）四角锁紧 + 弹性隔套压缩 + 残余间隙封闭环。',
  },
  {
    refId: 'tb-cover-warpage-p2',
    documentName: '薄铝盖板翘曲锁紧任务书.pdf',
    page: 2,
    excerpt: '双定位孔安装板基准 A/B，右孔位置度 ⌖ Ø0.12 MMC，盖板平面度 ⏥ 0.28 mm。',
  },
]

const COMPLIANT_COVER_WARPAGE_ASSEMBLY: AssemblyModelV1 = {
  schemaVersion: 1,
  units: 'mm',
  parts: [
    {
      id: 'part-mounting-plate',
      displayName: '双定位孔安装板',
      color: '#4c78a8',
      nominalTransform: [
        [...IDENTITY_TRANSFORM[0]],
        [...IDENTITY_TRANSFORM[1]],
        [...IDENTITY_TRANSFORM[2]],
        [...IDENTITY_TRANSFORM[3]],
      ],
      kind: 'parametric-primitive',
      baseKind: 'plate',
      sizeQ: {
        lengthQ: parseMm('80.0000'),
        widthQ: parseMm('50.0000'),
        thicknessQ: parseMm('8.0000'),
      },
      modifiers: [
        {
          id: 'mod-plate-left-hole',
          kind: 'through-hole',
          originQ: [parseMm('20.0000'), parseMm('25.0000'), 0],
          axis: [0, 0, 1],
          diameterQ: parseMm('10.0000'),
        },
        {
          id: 'mod-plate-right-hole',
          kind: 'through-hole',
          originQ: [parseMm('60.0000'), parseMm('25.0000'), 0],
          axis: [0, 0, 1],
          diameterQ: parseMm('10.0000'),
        },
      ],
    },
    {
      id: 'part-elastic-spacer',
      displayName: '弹性隔套',
      color: '#f58518',
      nominalTransform: [
        [...SPACER_ELEVATED_TRANSFORM[0]],
        [...SPACER_ELEVATED_TRANSFORM[1]],
        [...SPACER_ELEVATED_TRANSFORM[2]],
        [...SPACER_ELEVATED_TRANSFORM[3]],
      ],
      kind: 'parametric-primitive',
      baseKind: 'cylinder-spacer',
      sizeQ: {
        innerDiameterQ: parseMm('6.0000'),
        outerDiameterQ: parseMm('12.0000'),
        lengthQ: parseMm('2.0000'),
      },
      modifiers: [],
    },
    {
      id: 'part-thin-al-cover',
      displayName: '薄铝盖板 (1.5mm 6061)',
      color: '#72b7b2',
      nominalTransform: [
        [...COVER_PLATE_TRANSFORM[0]],
        [...COVER_PLATE_TRANSFORM[1]],
        [...COVER_PLATE_TRANSFORM[2]],
        [...COVER_PLATE_TRANSFORM[3]],
      ],
      kind: 'parametric-primitive',
      baseKind: 'plate',
      sizeQ: {
        lengthQ: parseMm('80.0000'),
        widthQ: parseMm('50.0000'),
        thicknessQ: parseMm('1.5000'),
      },
      modifiers: [
        {
          id: 'mod-cover-clamp-1',
          kind: 'through-hole',
          originQ: [parseMm('8.0000'), parseMm('8.0000'), 0],
          axis: [0, 0, 1],
          diameterQ: parseMm('4.5000'),
        },
        {
          id: 'mod-cover-clamp-2',
          kind: 'through-hole',
          originQ: [parseMm('72.0000'), parseMm('8.0000'), 0],
          axis: [0, 0, 1],
          diameterQ: parseMm('4.5000'),
        },
        {
          id: 'mod-cover-clamp-3',
          kind: 'through-hole',
          originQ: [parseMm('8.0000'), parseMm('42.0000'), 0],
          axis: [0, 0, 1],
          diameterQ: parseMm('4.5000'),
        },
        {
          id: 'mod-cover-clamp-4',
          kind: 'through-hole',
          originQ: [parseMm('72.0000'), parseMm('42.0000'), 0],
          axis: [0, 0, 1],
          diameterQ: parseMm('4.5000'),
        },
      ],
    },
  ],
  features: [
    {
      id: 'feat-plate-datum-a',
      partId: 'part-mounting-plate',
      signature: 'plate/top-face',
      kind: 'face',
      surface: 'plane',
      originQ: [parseMm('40.0000'), parseMm('25.0000'), parseMm('8.0000')],
      normal: [0, 0, 1],
    },
    {
      id: 'feat-plate-datum-b',
      partId: 'part-mounting-plate',
      signature: 'plate/left-hole/cylinder',
      kind: 'cylindrical-hole-axis',
      originQ: [parseMm('20.0000'), parseMm('25.0000'), 0],
      axis: [0, 0, 1],
      radiusQ: parseMm('5.0000'),
    },
    {
      id: 'feat-plate-right-hole',
      partId: 'part-mounting-plate',
      signature: 'plate/right-hole/cylinder',
      kind: 'cylindrical-hole-axis',
      originQ: [parseMm('60.0000'), parseMm('25.0000'), 0],
      axis: [0, 0, 1],
      radiusQ: parseMm('5.0000'),
    },
    {
      id: 'feat-spacer-bottom',
      partId: 'part-elastic-spacer',
      signature: 'spacer/bottom-face',
      kind: 'face',
      surface: 'plane',
      originQ: [0, 0, 0],
      normal: [0, 0, -1],
    },
    {
      id: 'feat-spacer-top',
      partId: 'part-elastic-spacer',
      signature: 'spacer/top-face',
      kind: 'face',
      surface: 'plane',
      originQ: [0, 0, parseMm('2.0000')],
      normal: [0, 0, 1],
    },
    {
      id: 'feat-cover-bottom',
      partId: 'part-thin-al-cover',
      signature: 'cover/bottom-face',
      kind: 'face',
      surface: 'plane',
      originQ: [parseMm('40.0000'), parseMm('25.0000'), 0],
      normal: [0, 0, -1],
    },
    {
      id: 'feat-cover-clamp-1',
      partId: 'part-thin-al-cover',
      signature: 'cover/clamp-hole-1',
      kind: 'cylindrical-hole-axis',
      originQ: [parseMm('8.0000'), parseMm('8.0000'), 0],
      axis: [0, 0, 1],
      radiusQ: parseMm('2.2500'),
    },
    {
      id: 'feat-cover-clamp-2',
      partId: 'part-thin-al-cover',
      signature: 'cover/clamp-hole-2',
      kind: 'cylindrical-hole-axis',
      originQ: [parseMm('72.0000'), parseMm('8.0000'), 0],
      axis: [0, 0, 1],
      radiusQ: parseMm('2.2500'),
    },
    {
      id: 'feat-cover-clamp-3',
      partId: 'part-thin-al-cover',
      signature: 'cover/clamp-hole-3',
      kind: 'cylindrical-hole-axis',
      originQ: [parseMm('8.0000'), parseMm('42.0000'), 0],
      axis: [0, 0, 1],
      radiusQ: parseMm('2.2500'),
    },
    {
      id: 'feat-cover-clamp-4',
      partId: 'part-thin-al-cover',
      signature: 'cover/clamp-hole-4',
      kind: 'cylindrical-hole-axis',
      originQ: [parseMm('72.0000'), parseMm('42.0000'), 0],
      axis: [0, 0, 1],
      radiusQ: parseMm('2.2500'),
    },
  ],
  mates: [
    {
      id: 'mate-plate-spacer',
      kind: 'face-contact',
      constrainedDofs: ['tz', 'rx', 'ry'],
      featureIds: ['feat-plate-datum-a', 'feat-spacer-bottom'],
    },
    {
      id: 'mate-spacer-cover',
      kind: 'face-contact',
      constrainedDofs: ['tz', 'rx', 'ry'],
      featureIds: ['feat-spacer-top', 'feat-cover-bottom'],
    },
  ],
  datums: [
    { id: 'datum-a', label: 'A', featureId: 'feat-plate-datum-a' },
    {
      id: 'datum-b',
      label: 'B',
      featureId: 'feat-plate-datum-b',
      sizeToleranceQ: { lowerQ: parseMm('-0.1000'), upperQ: parseMm('0.1000') },
    },
  ],
  gdt: [
    {
      id: 'gdt-pos-right-hole',
      featureId: 'feat-plate-right-hole',
      kind: 'position',
      toleranceQ: parseMm('0.1200'),
      modifier: 'MMC',
      datumIds: ['datum-a', 'datum-b'],
      datumModifiers: ['RFS', 'MMC'],
      zoneShape: 'cylindrical',
      featureSizeToleranceQ: { lowerQ: parseMm('-0.1000'), upperQ: parseMm('0.1000') },
    },
    {
      id: 'gdt-flatness-cover',
      featureId: 'feat-cover-bottom',
      kind: 'flatness',
      toleranceQ: parseMm('0.2800'),
      datumIds: [],
      zoneShape: 'planar',
    },
  ],
  physics: {
    enabled: true,
    materials: [
      {
        partId: 'part-thin-al-cover',
        presetId: 'al-6061',
        name: '6061-T6 铝合金',
        youngsModulusMpa: 68900,
        poissonRatio: 0.33,
        thermalExpansionPerK: 23.6e-6,
        deltaTemperatureK: 0,
        yieldStrengthMpa: 276,
      },
      {
        partId: 'part-elastic-spacer',
        presetId: 'silicone-epdm',
        name: '硅胶/EPDM 垫片',
        youngsModulusMpa: 50,
        poissonRatio: 0.45,
        thermalExpansionPerK: 150e-6,
        deltaTemperatureK: 0,
        yieldStrengthMpa: 12,
      },
      {
        partId: 'part-mounting-plate',
        presetId: 'steel-45',
        name: '45# 钢',
        youngsModulusMpa: 206000,
        poissonRatio: 0.29,
        thermalExpansionPerK: 11.5e-6,
        deltaTemperatureK: 0,
        yieldStrengthMpa: 355,
      },
    ],
    loads: [
      { featureId: 'feat-cover-clamp-1', forceN: [0, 0, -450] },
      { featureId: 'feat-cover-clamp-2', forceN: [0, 0, -450] },
      { featureId: 'feat-cover-clamp-3', forceN: [0, 0, -450] },
      { featureId: 'feat-cover-clamp-4', forceN: [0, 0, -450] },
    ],
    initialWarp: [
      { featureId: 'feat-cover-bottom', offsetQ: [0, 0, parseMm('0.2800')] },
    ],
    compliantModels: [
      {
        id: 'cm-cover-clamping',
        kind: 'plate-clamping',
        partId: 'part-thin-al-cover',
        surfaceFeatureId: 'feat-cover-bottom',
        thicknessQ: parseMm('1.5000'),
        initialWarpPeakQ: parseMm('0.2800'),
        warpTolQ: parseMm('0.0400'),
        clampFeatureIds: [
          'feat-cover-clamp-1',
          'feat-cover-clamp-2',
          'feat-cover-clamp-3',
          'feat-cover-clamp-4',
        ],
        clampForceN: 450,
        boundaryKind: 'clamped',
      },
      {
        id: 'cm-spacer-compression',
        kind: 'axial-compression',
        partId: 'part-elastic-spacer',
        featureId: 'feat-spacer-top',
        preloadN: 1800,
        preloadTolN: 180,
        effectiveAreaMm2: 84.82,
        lengthMm: 2.0,
        springbackRatio: 0.15,
      },
    ],
  },
  measurements: [
    {
      id: 'meas-residual-cover-gap',
      kind: 'gap',
      featureIds: ['feat-plate-datum-a', 'feat-cover-bottom'],
    },
  ],
}

const BUILTIN_TEMPLATES: readonly BuiltinTemplateDefinition[] = deepFreeze([
  {
    templateId: 'builtin-mounting-plate',
    displayName: '安装板项目',
    category: '3d-part',
    summary: '80 × 50 × 8 mm 安装板与双通孔边距检查',
    schemaVersion: 11,
    readonly: true,
    projectDefaults: {
      projectId: 'proj-plate-01',
      projectName: '安装板项目',
      baseRevision: 'v1',
      draftRevision: 'draft-2',
      summary: '80 × 50 × 8 mm 安装板与双通孔边距检查',
    },
    previewSnapshot: {
      projectId: 'proj-plate-01',
      currentRevision: 'draft-2',
      currentRevisionOrder: 2,
      model: {
        status: 'ready',
        revision: 'draft-2',
        revisionOrder: 2,
        isDraft: true,
        fingerprint: 'fp-draft-2',
      },
      drawing: {
        status: 'ready',
        revision: 'draft-2',
        revisionOrder: 2,
        isDraft: true,
        fingerprint: 'fp-draft-2',
      },
      drawingFailure: null,
      checksInProgress: false,
      features: MOUNTING_PLATE_FEATURES,
      annotations: MOUNTING_PLATE_ANNOTATIONS,
      requirements: MOUNTING_PLATE_REQUIREMENTS,
      checks: MOUNTING_PLATE_CHECKS,
      history: [],
      modelMesh: null,
      drawingVector: null,
    },
    taskbooks: MOUNTING_PLATE_TASKBOOKS,
    chain: null,
    assembly3d: MOUNTING_PLATE_ASSEMBLY,
    regressionNotes: [
      '80 × 50 × 8 mm 矩形安装板，双 Ø10 mm 通孔中心 (20,25) / (60,25) mm',
      '右孔至右端面剩余材料 ≥ 13 mm；参考盖板间隙 ≥ 1.5 mm',
    ],
  },
  {
    templateId: 'builtin-shaft-spacer',
    displayName: '隔套兼容示例',
    category: '1d-chain',
    summary: '一维尺寸链与历史隔套回归示例',
    schemaVersion: 11,
    readonly: true,
    projectDefaults: {
      projectId: 'sample-spacer-01',
      projectName: '隔套兼容示例',
      baseRevision: 'v3',
      draftRevision: null,
      isSample: true,
      summary: '一维尺寸链与历史隔套回归示例',
    },
    previewSnapshot: {
      projectId: 'sample-spacer-01',
      currentRevision: 'v3',
      currentRevisionOrder: 3,
      model: {
        status: 'ready',
        revision: 'v3',
        revisionOrder: 3,
        isDraft: false,
        fingerprint: 'fp-spacer-v3',
      },
      drawing: {
        status: 'ready',
        revision: 'v3',
        revisionOrder: 3,
        isDraft: false,
        fingerprint: 'fp-spacer-v3',
      },
      drawingFailure: null,
      checksInProgress: false,
      features: SHAFT_SPACER_FEATURES,
      annotations: SHAFT_SPACER_ANNOTATIONS,
      requirements: SHAFT_SPACER_REQUIREMENTS,
      checks: SHAFT_SPACER_CHECKS,
      history: [],
      modelMesh: null,
      drawingVector: null,
    },
    taskbooks: SHAFT_SPACER_TASKBOOKS,
    chain: SHAFT_SPACER_CHAIN,
    assembly3d: SHAFT_SPACER_ASSEMBLY,
    regressionNotes: [
      '一维轴向尺寸链 H(100) - B1(20) - S(59.8) - B2(20)，目标间隙 [0.10, 0.30] mm',
      '保留 12.00 / 12.04 / 12.10 / 12.05 历史隔套四组回归基准',
    ],
  },
  {
    templateId: 'builtin-compliant-cover-warpage',
    displayName: '薄铝盖板翘曲锁紧',
    category: '3d-part',
    summary: '1.5 mm 6061 铝盖板四角锁紧 + 0.28 mm 初始翘曲 + 弹性隔套与双孔安装板柔性仿真示例',
    schemaVersion: 11,
    readonly: true,
    projectDefaults: {
      projectId: 'sample-cover-warpage-01',
      projectName: '薄铝盖板翘曲锁紧',
      baseRevision: 'v1',
      draftRevision: 'draft-1',
      isSample: true,
      summary: '1.5 mm 6061 铝盖板四角锁紧 + 0.28 mm 初始翘曲 + 弹性隔套柔性耦合示例',
    },
    previewSnapshot: {
      projectId: 'sample-cover-warpage-01',
      currentRevision: 'draft-1',
      currentRevisionOrder: 1,
      model: {
        status: 'ready',
        revision: 'draft-1',
        revisionOrder: 1,
        isDraft: true,
        fingerprint: 'fp-cover-warpage-v1',
      },
      drawing: {
        status: 'ready',
        revision: 'draft-1',
        revisionOrder: 1,
        isDraft: true,
        fingerprint: 'fp-cover-warpage-v1',
      },
      drawingFailure: null,
      checksInProgress: false,
      features: COMPLIANT_COVER_FEATURES,
      annotations: COMPLIANT_COVER_ANNOTATIONS,
      requirements: COMPLIANT_COVER_REQUIREMENTS,
      checks: COMPLIANT_COVER_CHECKS,
      history: [],
      modelMesh: null,
      drawingVector: null,
    },
    taskbooks: COMPLIANT_COVER_TASKBOOKS,
    chain: null,
    assembly3d: COMPLIANT_COVER_WARPAGE_ASSEMBLY,
    regressionNotes: [
      '1.5 mm 6061-T6 薄铝盖板四角 450 N 锁紧 + 0.28 mm 初始翘曲 + 弹性隔套压缩耦合',
      '预配基准 A/B、右孔位置度 ⌖ Ø0.12 MMC、盖板平面度 ⏥ 0.28 mm 与残余间隙封闭环',
    ],
  },
])

const TEMPLATE_BY_ID: ReadonlyMap<string, BuiltinTemplateDefinition> = new Map(
  BUILTIN_TEMPLATES.map((tpl) => [tpl.templateId, tpl]),
)

let cloneDraftCounter = 0

/**
 * Returns the frozen list of read-only built-in templates.
 */
export function listBuiltinTemplates(): readonly BuiltinTemplateDefinition[] {
  return BUILTIN_TEMPLATES
}

/**
 * Looks up a read-only built-in template by ID.
 */
export function getBuiltinTemplate(templateId: string): BuiltinTemplateDefinition | undefined {
  return TEMPLATE_BY_ID.get(templateId)
}

/**
 * Deeply clones a read-only built-in template into an independent, mutable draft project.
 * Mutating any nested object, array, feature, annotation, check, mesh, vector, chain,
 * or 3D assembly field in the returned draft NEVER contaminates the template registry
 * or any other cloned draft.
 */
export function cloneTemplateToDraft(
  templateId: BuiltinTemplateId | string,
  options?: CloneTemplateOptions,
): ClonedTemplateDraft {
  const template = TEMPLATE_BY_ID.get(templateId)
  if (!template) {
    throw new Error(`Unknown builtin template: ${templateId}`)
  }

  cloneDraftCounter += 1
  const draftId = `draft-${template.templateId}-${cloneDraftCounter}`
  const projectId =
    options?.projectId?.trim() || `${template.projectDefaults.projectId}-clone-${cloneDraftCounter}`
  const projectName = options?.projectName?.trim() || template.projectDefaults.projectName
  const draftRevision =
    options?.draftRevision?.trim() || template.projectDefaults.draftRevision || 'draft-1'
  const createdAt = (options?.now ? options.now() : new Date()).toISOString()

  const clonedSnapshot = deepClone(template.previewSnapshot)
  const previewSnapshot: M2PreviewSnapshot = {
    ...clonedSnapshot,
    projectId,
    currentRevision: draftRevision,
    model: {
      ...clonedSnapshot.model,
      revision: draftRevision,
      isDraft: true,
    },
    drawing: {
      ...clonedSnapshot.drawing,
      revision: draftRevision,
      isDraft: true,
    },
  }

  return {
    draftId,
    templateId: template.templateId,
    projectId,
    projectName,
    baseRevision: template.projectDefaults.baseRevision,
    draftRevision,
    summary: template.summary,
    createdAt,
    previewSnapshot,
    taskbooks: deepClone([...template.taskbooks]),
    chain: template.chain ? deepClone(template.chain) : null,
    assembly3d: deepClone(template.assembly3d),
    regressionNotes: [...template.regressionNotes],
  }
}
