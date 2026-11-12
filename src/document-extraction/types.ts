/**
 * V3.6 阶段 1：任务书 PDF 自动提取的领域契约（纯数据，不依赖 Electron/React/IndexedDB）。
 *
 * 三条不可交换的边界：
 * 1. 提取只产生“待人工确认”的隔离草稿；本模块不写项目文件、不改 target、不建条款版本、
 *    不改已有绑定、不提交，也不调用任何计算。
 * 2. 任何数值字段都必须带完整出处（确切 PDF 版本、页码、选区、原文片段、页框）；
 *    缺任何一项，该数值不进入候选，只留 issue。见 isEvidenceComplete（回退实验 M02 的目标）。
 * 3. 默认状态只能是 pending 或 blocked；confirmed 只能由显式人工确认动作写入。见 draft.ts
 *    （回退实验 M01 的目标）。
 */
import type { PdfPageBox, PdfRect } from '../sources/pdfCoordinates'

/**
 * 提取规则版本；参与幂等键与候选身份。
 * 2：同符号多处不同赋值改为逐处候选（不再整批 AMBIGUOUS_ASSIGNMENT 阻塞）；
 *    同值多处合并；坏处单独 issue。规则语义变化必须升版本，旧草稿需主动重提。
 * 3：单位允许从显式文字继承（同一表格表头 / 同一页「单位：」或图注 / 页范围第一页的
 *    文档级声明），继承必须带声明出处；同作用域两个不同单位 → UNIT_CONFLICT 阻塞。
 *    显式单位不被覆盖；没有声明时 UNKNOWN_UNIT 原义不变。语义变了 → 升版本。
 * 4：表达式末尾单位只认三种明确形态（`X = 表达式 = 数值 单位`、`符号 = 数值 ± 偏差 单位`、
 *    `符号 = 数值 单位`），单位出处写进 evidence；中间表达式只作原文字符串保留，不做算术求值；
 *    多个等号结果不一致 → INCONSISTENT_REDUNDANT_VALUE 阻塞，不择优；单字母小写下标片段
 *    （i=0 / i=1）不再当尺寸候选。语义变了 → 升版本。
 * 5：形态 1 的中间式不再限定“纯加减”：允许字母/乘除/括号（`B1=B1+B1under=135+250/2=260 mm`），
 *    被采用的仍然是末尾那枚显式结果值，仍不做算术求值；中间块出现单位/汉字（说明夹着另一处
 *    赋值）或中间块是孤立符号（符号链）→ 不认，交回既有阻塞。符号位接受希腊字母（`Δ0`、`δL`）。
 *    另：带显式末尾值的行先按赋值行解析，不再被 `FORMULA_UNSUPPORTED` 抢先拦下
 *    （`FORMULA_UNSUPPORTED` 判定条件本身未改，取不到条目时仍原样记录）。语义变了 → 升版本。
 * 6：页跨度超过 `MAX_EXTRACTION_PAGES` 不再整份拒绝（旧行为：一条 `PAGE_LIMIT` + 0 候选），
 *    改为按上限**顺序切块**，逐块跑同一套逐页扫描，再合并成一份草稿。切的是页数组，
 *    同一 revision 仍只解析一次文件。合并语义 = “整份一次扫描”的语义：
 *    - 组成环条目跨块合并后统一 resolve，`occurrence` 按**全局出现顺序**编号（1/2、2/2），
 *      同符号同值跨块仍合并成一条；
 *    - 候选与问题按（页, 位置）统一排序，两次运行结果完全一致；
 *    - 单块失败只标 `CHUNK_FAILED` + 页范围，其余块结果照常返回；每块处理结果都留
 *      `CHUNK_PROCESSED` issue（可追，不静默丢块）；
 *    - 无文本层的页仍只在该页标 `NO_TEXT_LAYER`，其余页照常出候选；
 *    - `sourceIdentity` 仍是原 PDF 的 revisionId + sha256，不因切块变化。
 *    语义变了 → 升版本（旧草稿不与新候选混并）。
 */
export const EXTRACTOR_VERSION = 'document-extractor-6'

/**
 * 页数上限：单个提取块最多多少页。页跨度超过它时按顺序切块，
 * 不再是“整份拒绝”的阈值（见 parse.ts 的 planExtractionChunks）。
 */
export const MAX_EXTRACTION_PAGES = 100
export const MAX_EXTRACTION_CANDIDATES = 200
export const MAX_EXTRACTION_ISSUES = 200

export const EXTRACTION_KINDS = ['ring', 'interval', 'formula', 'part-dimension'] as const
export type ExtractionKind = (typeof EXTRACTION_KINDS)[number]

export const CANDIDATE_STATUSES = ['pending', 'blocked', 'confirmed', 'rejected', 'stale'] as const
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number]

export const CONFIDENCE_LEVELS = ['high', 'medium', 'low', 'unknown'] as const
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number]

/** 明确原因码；状态不允许只有文案。 */
export const EXTRACTION_REASON_CODES = [
  // 出处
  'SOURCE_UNRESOLVED',
  'SOURCE_PAGE_OUT_OF_RANGE',
  // 单位
  'UNSUPPORTED_UNIT',
  'UNKNOWN_UNIT',
  'UNIT_CONFLICT',
  // 数值
  'NUMBER_UNSUPPORTED',
  'PRECISION_UNSUPPORTED',
  'RANGE_CONFLICT',
  'AMBIGUOUS_ASSIGNMENT',
  'AMBIGUOUS_DEVIATION',
  'DEVIATION_SIGN_MISSING',
  /** 同一赋值里多个等号的结果值互不一致（`A = 10 = 12 mm`）：阻塞整条，不挑一个。 */
  'INCONSISTENT_REDUNDANT_VALUE',
  // 文本层与版面
  'NO_TEXT_LAYER',
  'PAGE_RANGE_INVALID',
  /** 旧版“整份拒绝”的页数上限码；`document-extractor-6` 起不再产生，保留以读旧草稿。 */
  'PAGE_LIMIT',
  'NO_TABLE_HEADER',
  'UNSUPPORTED_TABLE_LAYOUT',
  'ENDPOINT_SEMANTICS_MISSING',
  // 公式
  'FORMULA_UNSUPPORTED',
  'FORMULA_UNRESOLVED_OPERAND',
  'FORMULA_CONFLICT',
  'FORMULA_VALUE_CONFLICT',
  // 冲突组
  'CONFLICT_GROUP_MEMBER',
] as const
export type ExtractionReasonCode = (typeof EXTRACTION_REASON_CODES)[number]

export const EXTRACTION_ISSUE_CODES = [
  ...EXTRACTION_REASON_CODES,
  'EXTRACTION_EMPTY',
  /**
   * 只出现在 issue 上的切块踪迹（不是候选阻塞原因，不进 reasonCodes）：
   * - CHUNK_PROCESSED：该块处理完成（warning），message 写明页范围与本块扫描结果；
   * - CHUNK_FAILED：该块处理抛错（blocked），message 写明页范围与错误原因，其余块结果照常保留。
   */
  'CHUNK_PROCESSED',
  'CHUNK_FAILED',
] as const
export type ExtractionIssueCode = (typeof EXTRACTION_ISSUE_CODES)[number]

/** 提取的 PDF 版本身份；禁止以后自动替换成 latest。 */
export interface ExtractionSourceIdentity {
  readonly documentId: string
  readonly revisionId: string
  readonly sha256: string
  readonly blobKey: string
  readonly pageCount: number
}

/**
 * 每段 PDF 文本层出处必须齐全：确切版本 + 页码 + 未旋转 PDF 点选区 + 页框 + 原文片段。
 * textSnippet 保留 PDF 文本层原样（可能含康熙部首）；normalizedSnippet 是 NFKC 后的匹配文本。
 */
export interface ExtractionEvidence {
  readonly documentId: string
  readonly revisionId: string
  readonly sha256: string
  readonly blobKey: string
  readonly page: number
  readonly rectPdf: PdfRect
  readonly pageBoxPdf: PdfPageBox
  readonly textSnippet: string
  readonly normalizedSnippet: string
  readonly textItemIndexes: readonly number[]
}

/**
 * ADR-001：出处从“单一 PDF 身份”泛化为 `EvidenceRef` 联合类型。
 *
 * `pdf-text` 就是现有的 `ExtractionEvidence`，**字段一个不动**（I5）。
 * `kind` 可选：既有 evidence 没有该字段，读取方一律按 pdf-text 解释；
 * 解析器写出时也保持旧形状，保证候选/出处 JSON 与改前逐字节一致。
 */
export interface PdfTextEvidence extends ExtractionEvidence {
  readonly kind?: 'pdf-text'
}

/** 扫描件 OCR 出处：仍以 PDF 版本 + 页 + 选区为锚，必须带置信度（不许静默采信低置信）。 */
export interface PdfOcrEvidence {
  readonly kind: 'pdf-ocr'
  readonly documentId: string
  readonly revisionId: string
  readonly sha256: string
  readonly blobKey: string
  readonly page: number
  readonly rectPdf: PdfRect
  readonly pageBoxPdf: PdfPageBox
  readonly textSnippet: string
  readonly confidence: number
}

/** 草绘照片 / 样品照片出处：锚在图片本身（imageId + sha256），不挂 PDF 版本。 */
export interface ImageOcrEvidence {
  readonly kind: 'image-ocr'
  readonly imageId: string
  readonly sha256: string
  readonly fileName: string
  readonly rectPdf: PdfRect
  readonly recognizedText: string
  readonly confidence: number
}

/**
 * 用户断言出处：回答“谁在哪一次输入里这么说的”。
 *
 * 按 ADR-001 §11：`actorId` 用户手输、`sessionSeq` 项目内自增、`sessionLabel` 备注，
 * 不用 UUID（本地生成的 id 证明不了身份，只解决“这条记录归哪一次输入”）。
 * 撤销只追加留痕字段，出处本身不被删除（I4 出处不可抹）。
 *
 * 注意：`provenance` 不是防伪机制；它回答“这个值当初从哪来”，不回答“这个值是真话吗”。
 */
export interface UserAttestation {
  readonly kind: 'user-attestation'
  /** 本机用户标识（手输，非姓名，不许自由文本）。 */
  readonly actorId: string
  /** ISO 时间。 */
  readonly at: string
  /** 项目内自增序号（1、2、3…），界面上显示为“第 3 次输入”。 */
  readonly sessionSeq: number
  /** 用户备注名（可空），例如「2026-11-12 复检」。 */
  readonly sessionLabel: string | null
  /** 用户原话，逐字保留。 */
  readonly statement: string
  /** 这话是在定哪个字段。 */
  readonly fieldPath: string
  /**
   * 哪一轮对话（任务/输入）说的。由 main 绑定当前 Agent 任务 ID，不由模型提供；
   * 旧断言没有该字段（按 null 读），不重算、不改值。
   */
  readonly turnId?: string | null
  /** 显式撤销留痕；撤销不删除出处。 */
  readonly revokedAt?: string | null
  readonly revokedBy?: string | null
  readonly revokedStatement?: string | null
}

export type EvidenceRefKind = 'pdf-text' | 'pdf-ocr' | 'image-ocr' | 'user-attestation'

/** 一个数值/候选/决定/应用计划项所依据的出处。 */
export type EvidenceRef = PdfTextEvidence | PdfOcrEvidence | ImageOcrEvidence | UserAttestation

/** 出处种类；缺省 `kind` 就是 pdf-text（兼容改前的 evidence 形状）。 */
export function evidenceRefKind(ref: EvidenceRef): EvidenceRefKind | null {
  const kind = (ref as { readonly kind?: unknown }).kind
  if (kind === undefined) return 'pdf-text'
  if (
    kind === 'pdf-text' ||
    kind === 'pdf-ocr' ||
    kind === 'image-ocr' ||
    kind === 'user-attestation'
  ) {
    return kind
  }
  return null
}

function isConfidence(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

/**
 * 出处完整性判据（**唯一入口**，M02 变异目标）。
 *
 * `pdf-text` 分支与改造前的 `isEvidenceComplete` 逐条等价：同样的字段检查、
 * 同样的矩形包含容差 1e-6、缺任何一项都返回 false。禁止为任何新类型另写一份校验。
 * 空数组/空值一律 false（I2：出处为空 = 非法）。
 */
export function isProvenanceCompleteness(ref: EvidenceRef | null | undefined): boolean {
  if (!ref) return false
  const kind = evidenceRefKind(ref)
  if (kind === 'pdf-text') {
    const evidence = ref as ExtractionEvidence
    if (
      evidence.documentId.trim() === '' ||
      evidence.revisionId.trim() === '' ||
      evidence.sha256.trim() === '' ||
      evidence.blobKey.trim() === ''
    ) {
      return false
    }
    if (!Number.isSafeInteger(evidence.page) || evidence.page < 1) return false
    if (evidence.textSnippet.trim() === '') return false
    if (!evidence.textItemIndexes.every((index) => Number.isSafeInteger(index) && index >= 0)) {
      return false
    }
    const rect = evidence.rectPdf
    const box = evidence.pageBoxPdf
    if (rect.length !== 4 || box.length !== 4) return false
    if (!rect.every((value) => Number.isFinite(value))) return false
    if (!box.every((value) => Number.isFinite(value))) return false
    const [x0, y0, x1, y1] = rect
    if (!(x1 > x0) || !(y1 > y0)) return false
    const [bx0, by0, bx1, by1] = box
    if (!(bx1 > bx0) || !(by1 > by0)) return false
    const epsilon = 1e-6
    if (x0 < bx0 - epsilon || y0 < by0 - epsilon) return false
    if (x1 > bx1 + epsilon || y1 > by1 + epsilon) return false
    return true
  }
  if (kind === 'pdf-ocr') {
    const ocr = ref as PdfOcrEvidence
    if (
      ocr.documentId.trim() === '' ||
      ocr.revisionId.trim() === '' ||
      ocr.sha256.trim() === '' ||
      ocr.blobKey.trim() === ''
    ) {
      return false
    }
    if (!Number.isSafeInteger(ocr.page) || ocr.page < 1) return false
    if (ocr.textSnippet.trim() === '') return false
    if (!isConfidence(ocr.confidence)) return false
    const rect = ocr.rectPdf
    const box = ocr.pageBoxPdf
    if (rect.length !== 4 || box.length !== 4) return false
    if (!rect.every((value) => Number.isFinite(value))) return false
    if (!box.every((value) => Number.isFinite(value))) return false
    const [x0, y0, x1, y1] = rect
    if (!(x1 > x0) || !(y1 > y0)) return false
    const [bx0, by0, bx1, by1] = box
    if (!(bx1 > bx0) || !(by1 > by0)) return false
    const epsilon = 1e-6
    if (x0 < bx0 - epsilon || y0 < by0 - epsilon) return false
    if (x1 > bx1 + epsilon || y1 > by1 + epsilon) return false
    return true
  }
  if (kind === 'image-ocr') {
    const image = ref as ImageOcrEvidence
    if (
      image.imageId.trim() === '' ||
      image.sha256.trim() === '' ||
      image.fileName.trim() === '' ||
      image.recognizedText.trim() === ''
    ) {
      return false
    }
    if (!isConfidence(image.confidence)) return false
    const rect = image.rectPdf
    if (rect.length !== 4 || !rect.every((value) => Number.isFinite(value))) return false
    const [x0, y0, x1, y1] = rect
    return x1 > x0 && y1 > y0
  }
  if (kind === 'user-attestation') {
    const attestation = ref as UserAttestation
    if (
      attestation.actorId.trim() === '' ||
      attestation.fieldPath.trim() === '' ||
      attestation.statement.trim() === ''
    ) {
      return false
    }
    if (attestation.at.trim() === '' || Number.isNaN(Date.parse(attestation.at))) return false
    if (!Number.isSafeInteger(attestation.sessionSeq) || attestation.sessionSeq < 1) return false
    if (attestation.sessionLabel !== null && typeof attestation.sessionLabel !== 'string') {
      return false
    }
    return true
  }
  return false
}

/**
 * 改造前的名字保留为**别名**（不是第二份实现）：旧调用方与旧用例继续可用，
 * 但唯一实现只有 `isProvenanceCompleteness`。新代码一律用新名字。
 */
export function isEvidenceComplete(
  evidence: ExtractionEvidence | null | undefined,
): boolean {
  return isProvenanceCompleteness(evidence)
}

/** evidenceKey 只需文本锚点四要素；pdf-ocr 复用同一格式，避免第二套 key。 */
interface TextAnchorEvidence {
  readonly revisionId: string
  readonly page: number
  readonly rectPdf: PdfRect
  readonly textSnippet: string
}

/**
 * PDF 文本层出处的去重身份。**输出字符串与改造前逐字节一致**（I5）：
 * `revisionId#page#x0#y0#x1#y1#textSnippet`。
 */
export function evidenceKey(evidence: TextAnchorEvidence): string {
  const [x0, y0, x1, y1] = evidence.rectPdf
  return [
    evidence.revisionId,
    evidence.page,
    x0.toFixed(2),
    y0.toFixed(2),
    x1.toFixed(2),
    y1.toFixed(2),
    evidence.textSnippet,
  ].join('#')
}

/**
 * 按 kind 生成出处身份：pdf-text 分支直接委托 `evidenceKey`（不重写格式），
 * 其它种类追加种类后缀，保证不同 kind 的同坐标出处不会撞在一起。
 */
export function provenanceKey(ref: EvidenceRef): string {
  const kind = evidenceRefKind(ref)
  if (kind === 'pdf-text') return evidenceKey(ref as PdfTextEvidence)
  if (kind === 'pdf-ocr') return `${evidenceKey(ref as PdfOcrEvidence)}#pdf-ocr`
  if (kind === 'image-ocr') {
    const image = ref as ImageOcrEvidence
    const [x0, y0, x1, y1] = image.rectPdf
    return [
      image.imageId,
      image.sha256,
      x0.toFixed(2),
      y0.toFixed(2),
      x1.toFixed(2),
      y1.toFixed(2),
      image.recognizedText,
      'image-ocr',
    ].join('#')
  }
  if (kind === 'user-attestation') {
    const attestation = ref as UserAttestation
    return [
      attestation.actorId,
      attestation.sessionSeq,
      attestation.fieldPath,
      attestation.statement,
      'user-attestation',
    ].join('#')
  }
  throw new Error('未知出处种类：无法生成 provenanceKey')
}

/** 按 kind 去重（保持首次出现顺序）；pdf 分支的 key 与改前一致。 */
export function uniqueProvenance(refs: readonly EvidenceRef[]): readonly EvidenceRef[] {
  const seen = new Set<string>()
  const out: EvidenceRef[] = []
  for (const item of refs) {
    const key = provenanceKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

/** pdf-text 分支的旧名字：唯一实现是 uniqueProvenance。 */
export function uniqueEvidence(
  evidence: readonly ExtractionEvidence[],
): readonly ExtractionEvidence[] {
  return uniqueProvenance(evidence) as readonly ExtractionEvidence[]
}

/**
 * 出处失效判定（I3，按 kind 分开）：
 * - pdf-text / pdf-ocr：所属 revision 的 sha256 变了（或版本不再可用）→ stale；
 * - image-ocr：图片 sha256 变了（或图片不再可用）→ stale；
 * - user-attestation：**不因文件变化 stale**，只能被显式撤销（revoked 与 stale 分开报）。
 */
export type ProvenanceValidity = 'valid' | 'stale' | 'revoked'

export interface ProvenanceSourceState {
  /** 当前仍可用的 PDF 版本与其哈希。 */
  readonly revisions: readonly { readonly revisionId: string; readonly sha256: string }[]
  /** 当前仍可用的图片与其哈希。 */
  readonly images?: readonly { readonly imageId: string; readonly sha256: string }[]
}

export function provenanceValidity(
  ref: EvidenceRef,
  state: ProvenanceSourceState,
): ProvenanceValidity {
  const kind = evidenceRefKind(ref)
  if (kind === 'pdf-text' || kind === 'pdf-ocr') {
    const anchor = ref as PdfTextEvidence
    const current = state.revisions.find((item) => item.revisionId === anchor.revisionId)
    return current !== undefined && current.sha256 === anchor.sha256 ? 'valid' : 'stale'
  }
  if (kind === 'image-ocr') {
    const image = ref as ImageOcrEvidence
    const current = (state.images ?? []).find((item) => item.imageId === image.imageId)
    return current !== undefined && current.sha256 === image.sha256 ? 'valid' : 'stale'
  }
  if (kind === 'user-attestation') {
    const attestation = ref as UserAttestation
    return (attestation.revokedAt ?? null) === null ? 'valid' : 'revoked'
  }
  return 'stale'
}

/** 用户断言只能被显式撤销：追加撤销留痕，不删出处、不改原话。 */
export function revokeAttestation(
  attestation: UserAttestation,
  revoke: { readonly by: string; readonly at: string; readonly statement: string },
): UserAttestation {
  return {
    ...attestation,
    revokedBy: revoke.by,
    revokedAt: revoke.at,
    revokedStatement: reviveStatement(revoke.statement),
  }
}

function reviveStatement(statement: string): string {
  return statement.trim() === '' ? '（未填写撤销说明）' : statement
}


/** 单个数值字段：原文十进制字符串 + 原始位数 + 精确 q（只在 mm 且格式合法时有值）。 */
export interface QuantityValue {
  /** 原文数字串，保留正负号与尾零，例如 "+0.02" / "0.1000"。 */
  readonly text: string
  readonly decimals: number
  /** 整数 q（1 mm = 10000 q）；单位不是 mm 或解析失败时为 null，绝不换算。 */
  readonly valueQ: number | null
  /** 原文单位串；未写为 null。 */
  readonly unitText: string | null
  /** 只接受 'mm'；inch 等一律 null，由 reasonCodes 标明。 */
  readonly unit: 'mm' | null
  readonly evidence: readonly ExtractionEvidence[]
  /**
   * ADR-001：该数值的出处集合（I2：至少一条，空数组等同非法）。
   * 可选以读旧草稿/旧项目；缺省时由 `evidence` 逐条映射为 pdf-text 出处，值不改、不重算。
   * 解析器写出时与 `evidence` 同源，pdf-text 分支逐字节一致（I5）。
   */
  readonly provenance?: readonly EvidenceRef[]
}

export interface RingCandidateData {
  readonly symbol: string | null
  readonly name: string | null
  readonly nominal: QuantityValue | null
  readonly upperDeviation: QuantityValue | null
  readonly lowerDeviation: QuantityValue | null
}

/**
 * 同一符号多处赋值时，该候选在 group 内的位置（1-based）。
 *
 * - 只在同一符号出现 **多个不同取值** 时写入；取值相同的多处已合并成一条候选，
 *   此时 total=1，不写 occurrence（null/缺省）。
 * - 一条候选对应一处取值，出处仍是该处自己的页/选区/原文片段/item 索引。
 * - 互斥由 draft.confirmCandidate 强制：同一 ring group 只允许一条已确认。
 */
export interface ExtractionOccurrence {
  readonly index: number
  readonly total: number
}

export interface IntervalCandidateData {
  readonly outputSymbol: string | null
  readonly lower: QuantityValue | null
  readonly upper: QuantityValue | null
  readonly lowerInclusive: boolean | null
  readonly upperInclusive: boolean | null
  /** 端点语义自身的出处（“含两端”/"闭区间"），缺失不能默认闭区间。 */
  readonly endpointEvidence: readonly ExtractionEvidence[]
}

export interface FormulaOperand {
  readonly symbol: string
  readonly sign: 1 | -1
}

export interface FormulaCandidateData {
  readonly outputSymbol: string | null
  /** 原文表达式（保留原符号与空格）。 */
  readonly rawExpression: string
  /** 归一化后的表达式，仅用于展示与比较。 */
  readonly expression: string
  readonly operands: readonly FormulaOperand[]
  /** 仅支持当前引擎可表达的线性加减；遇到乘除/括号为 true。 */
  readonly unsupported: boolean
  readonly conflict: boolean
}

export interface PartDimensionData {
  readonly partName: string | null
  readonly innerDiameter: QuantityValue | null
  readonly outerDiameter: QuantityValue | null
  readonly length: QuantityValue | null
}

interface CandidateBase {
  readonly candidateId: string
  readonly kind: ExtractionKind
  readonly groupId: string | null
  /** 候选所依据的原文片段（整行，未归一）。 */
  readonly rawText: string
  readonly page: number
  readonly status: CandidateStatus
  readonly confidence: ConfidenceLevel
  readonly confidenceBasis: readonly string[]
  readonly reasonCodes: readonly ExtractionReasonCode[]
  readonly evidence: readonly ExtractionEvidence[]
  /**
   * ADR-001：候选级出处集合（公式表达式等候选级依据）。
   * 可选以读旧草稿；缺省时由 `evidence` 逐条映射为 pdf-text 出处。
   */
  readonly provenance?: readonly EvidenceRef[]
  /** 人工编辑代数；每次编辑 +1，旧确认随之失效。 */
  readonly editRevision: number
  /**
   * 同一符号多处赋值时的位置标记；单值候选与其它类型为 null/缺省。
   * 可选是为了读旧 schema8 文件（当时还没有该字段），读取方一律用 `?? null`。
   */
  readonly occurrence?: ExtractionOccurrence | null
}

export type ExtractionCandidate =
  | (CandidateBase & { readonly kind: 'ring'; readonly data: RingCandidateData })
  | (CandidateBase & { readonly kind: 'interval'; readonly data: IntervalCandidateData })
  | (CandidateBase & { readonly kind: 'formula'; readonly data: FormulaCandidateData })
  | (CandidateBase & { readonly kind: 'part-dimension'; readonly data: PartDimensionData })

export interface ExtractionIssue {
  readonly issueId: string
  readonly code: ExtractionIssueCode
  readonly severity: 'blocked' | 'warning'
  readonly message: string
  readonly page: number | null
  readonly candidateIds: readonly string[]
  readonly evidence: readonly ExtractionEvidence[]
  /**
   * 切块踪迹（纯加法字段，可选）：这条 issue 属于哪一块、覆盖哪些页（1-based 闭区间）。
   * 旧草稿没有该字段，读取方一律用 `?? null`；页跨度不超过上限的单块提取不写。
   */
  readonly chunk?: ExtractionChunkRef | null
}

/**
 * 大文档切块的块标记。`index` 从 1 开始、按页升序；`from`/`to` 是 1-based 闭区间，
 * 且 `to - from + 1 <= MAX_EXTRACTION_PAGES`。它只描述“哪一块”，不改候选身份。
 */
export interface ExtractionChunkRef {
  readonly index: number
  readonly from: number
  readonly to: number
}

export type DecisionAction = 'confirm' | 'reject' | 'edit' | 'revoke'

export interface ExtractionDecision {
  readonly decisionId: string
  readonly candidateId: string
  readonly action: DecisionAction
  /** 决定时所针对的候选编辑代数；候选再次编辑后旧决定失效。 */
  readonly candidateEditRevision: number
  readonly decidedAt: string
  /** 本地操作身份（不是实名批准）。 */
  readonly actor: string
  readonly reason: string | null
  /** 决定时的数值快照（JSON 字符串），防止事后篡改。 */
  readonly valueSnapshot: string
  readonly evidence: readonly ExtractionEvidence[]
  /** ADR-001：决定时的出处集合；旧决定缺省时由 evidence 映射。 */
  readonly provenance?: readonly EvidenceRef[]
  readonly invalidatedByEditRevision: number | null
}

export interface ExtractionPageRange {
  readonly from: number
  readonly to: number
}

export interface ExtractionDraft {
  readonly draftId: string
  readonly draftRevision: number
  readonly status: 'draft'
  readonly projectId: string
  readonly baseToken: string
  readonly sourceIdentity: ExtractionSourceIdentity
  readonly pageRange: ExtractionPageRange
  readonly extractorVersion: string
  readonly idempotencyKey: string
  readonly candidates: readonly ExtractionCandidate[]
  readonly issues: readonly ExtractionIssue[]
  readonly decisions: readonly ExtractionDecision[]
  /**
   * ADR-001 第 3 步（schema 10）：无任务书草稿的“参数 ↔ 组成环”绑定意图。
   * 参数值仍取自用户给出的基本尺寸；有来源的 PDF 草稿不写该字段。
   */
  readonly intentBindings?: readonly {
    readonly parameter: 'innerDiameter' | 'outerDiameter' | 'length'
    readonly symbol: string
    readonly valueQ: number
    readonly text: string
  }[]
}

export type ExtractionErrorCode =
  | 'PAGE_RANGE_INVALID'
  | 'CANDIDATE_NOT_FOUND'
  | 'CANDIDATE_BLOCKED'
  | 'CANDIDATE_REJECTED'
  | 'CANDIDATE_STALE'
  | 'GROUP_ALREADY_CONFIRMED'
  | 'STALE_EDIT_REVISION'
  | 'EXPLICIT_CONFIRMATION_REQUIRED'
  | 'ACTOR_REQUIRED'
  | 'DECIDED_AT_REQUIRED'
  | 'REASON_REQUIRED'
  | 'EVIDENCE_REQUIRED'
  | 'FIELD_UNSUPPORTED'
  | 'VALUE_UNSUPPORTED'
  | 'NOT_CONFIRMED'
  | 'STALE_DECISION'
  | 'SOURCE_STALE'
  | 'SOURCE_IDENTITY_MISMATCH'
  | 'EXTRACTOR_VERSION_MISMATCH'
  /** user-attestation 的 actorId/sessionSeq 与当前会话不一致（跨会话伪造）。 */
  | 'ATTESTATION_SESSION_MISMATCH'
  /** user-attestation 已被显式撤销：出处仍在，但不再有效。 */
  | 'PROVENANCE_REVOKED'

export type ExtractionResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false
      readonly code: ExtractionErrorCode
      readonly message: string
    }

export function extractionFailure<T>(
  code: ExtractionErrorCode,
  message: string,
): ExtractionResult<T> {
  return { ok: false, code, message }
}

export function extractionSuccess<T>(value: T): ExtractionResult<T> {
  return { ok: true, value }
}

/** 遍历候选的数值字段；用于通用校验（出处完整性、确认快照、应用门禁）。 */
export function candidateNumericFields(
  candidate: ExtractionCandidate,
): { field: string; value: QuantityValue }[] {
  const out: { field: string; value: QuantityValue }[] = []
  const push = (field: string, value: QuantityValue | null): void => {
    if (value) out.push({ field, value })
  }
  if (candidate.kind === 'ring') {
    push('nominal', candidate.data.nominal)
    push('upperDeviation', candidate.data.upperDeviation)
    push('lowerDeviation', candidate.data.lowerDeviation)
  } else if (candidate.kind === 'interval') {
    push('lower', candidate.data.lower)
    push('upper', candidate.data.upper)
  } else if (candidate.kind === 'part-dimension') {
    push('innerDiameter', candidate.data.innerDiameter)
    push('outerDiameter', candidate.data.outerDiameter)
    push('length', candidate.data.length)
  }
  return out
}

/** 候选当前数值快照；决定/应用都以它比较，避免只看状态布尔。 */
export function candidateValueSnapshot(candidate: ExtractionCandidate): string {
  return JSON.stringify(
    candidateNumericFields(candidate).map(({ field, value }) => ({
      field,
      text: value.text,
      unit: value.unitText,
      valueQ: value.valueQ,
    })),
  )
}

/**
 * 数值的出处集合（**唯一映射入口**）：优先取显式 `provenance`；
 * 旧草稿/旧项目缺省时把 `evidence` 逐条解释为 pdf-text（字段原样，不补造、不改值）。
 * 显式给出空数组表示“没有出处”，不会再回退到 evidence —— 空 = 非法（I2）。
 */
export function valueProvenance(value: QuantityValue): readonly EvidenceRef[] {
  if (value.provenance !== undefined) return value.provenance
  return value.evidence.map((evidence) => evidence as PdfTextEvidence)
}

/** 候选级出处集合（公式表达式等）；语义同 `valueProvenance`。 */
export function candidateProvenance(candidate: ExtractionCandidate): readonly EvidenceRef[] {
  if (candidate.provenance !== undefined) return candidate.provenance
  return candidate.evidence.map((evidence) => evidence as PdfTextEvidence)
}

/** 决定的出处集合；语义同 `valueProvenance`。 */
export function decisionProvenance(decision: ExtractionDecision): readonly EvidenceRef[] {
  if (decision.provenance !== undefined) return decision.provenance
  return decision.evidence.map((evidence) => evidence as PdfTextEvidence)
}
