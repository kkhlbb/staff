/**
 * V3-D 参数联动：领域类型（纯数据，不依赖 Electron/React/IndexedDB）。
 *
 * 单一真源边界：
 * - 参数值真值仍是整数 q（valueQ），inputDecimals 只影响显示；
 * - “已确认”不落布尔字段：参数绑定是否有效由完整确认事件凭据派生
 *   （见 status.ts 的派生表），C 的 parameter.reviewStatus 只作历史兼容标签。
 */
import type { ChainDefinition, ChainResult } from '../domain/types'
import type { DrawingData } from '../drawing/types'
import type { ProjectFileDrawingRecord, ProjectFileParameterBindingLink } from '../project-file/types'

/** 草稿参数输入（十进制字符串；main 用 tryParseMm 解析，不做浮点乘法）。 */
export interface ParameterTextInputs {
  innerDiameter: string
  outerDiameter: string
  length: string
}

/** 一次绑定意图：只能落在草稿里，确认时才写入正式聚合。 */
export interface BindingIntent {
  termId: string
  partId: string
  parameterId: string
}

export interface BindingDiffRow {
  bindingId: string
  termId: string
  termSymbol: string
  parameterId: string
  parameterLabel: string
  beforeNominalQ: number
  afterNominalQ: number
  /** 数值是否真的变化；相等时仍列出“被引用，值未变”。 */
  changed: boolean
}

export interface ParameterDiffRow {
  parameterId: string
  key: 'innerDiameter' | 'outerDiameter' | 'length'
  beforeQ: number | null
  afterQ: number
  beforeDecimals: number | null
  afterDecimals: number
  beforeSourceNote: string
  afterSourceNote: string
  /** 工程值变化（valueQ 不同）。 */
  valueChanged: boolean
  /** 只有显示/来源元数据变化时标“工程值未变”。 */
  displayChanged: boolean
  sourceNoteChanged: boolean
}

/** 一版图纸的冻结生成输入；重建只用它，不读当前参数。 */
export interface DrawingGenerationInput {
  drawingId: string
  partId: string
  templateId: 'spacer-a4-landscape'
  templateVersion: number
  drawingDataVersion: 1
  projectId: string
  revisionId: string
  parameters: {
    parameterId: string
    partId: string
    key: 'innerDiameter' | 'outerDiameter' | 'length'
    valueQ: number
    inputDecimals: number
    reviewStatus: 'draft' | 'pending' | 'confirmed'
    sourceNote?: string
    /**
     * 读数/来源出处必须随冻结输入一起保留：它参与参数快照与图纸指纹。
     * 缺了它重建出的 fingerprint 会与保存值不符（旧版实现在这里丢过）。
     */
    provenance?: readonly import('../document-extraction/types').EvidenceRef[]
  }[]
  scale: { numerator: number; denominator: number }
  frameFields: ProjectFileDrawingRecord['frameFields']
}

export interface ChangeComputation {
  parameters: import('../project-file/types').ProjectFileSpacerParameter[]
  bindings: ProjectFileParameterBindingLink[]
  chain: ChainDefinition
  previousChain: ChainDefinition
  previousResult: ChainResult
  result: ChainResult
  termDiffs: BindingDiffRow[]
  parameterDiffs: ParameterDiffRow[]
  changedTermIds: string[]
  affectedTermIds: string[]
  unboundTermIds: string[]
  drawing: {
    record: ProjectFileDrawingRecord
    data: DrawingData
    /** 旧指向（若有）的冻结输入，用于双图并排。 */
    previous: DrawingGenerationInput | null
    previousData: DrawingData | null
    previousProblem: string | null
  }
  /** 每个有效绑定的确认凭据基准；写入事件时原样带上。 */
  credentials: {
    bindingId: string
    parameterId: string
    termId: string
    parameterRevision: number
    termRevision: number
    drawingId: string
    drawingFingerprint: string
    sourceBasis: string
  }[]
}
