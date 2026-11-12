/**
 * V3-D 基准摘要与令牌（主进程权威、纯函数）。
 *
 * 设计要点（任务卡 §4.1）：
 * - 基准不是单个 currentRevisionId：链、参数、绑定、图纸、模型、来源、版本
 *   全部纳入分组摘要；
 * - 同时携带单调 baseGeneration 与 acceptedSeq：**改后改回**仍产生不同摘要，
 *   旧令牌不会复活；
 * - 只存摘要、不存正文；拒绝时按分组给出“哪一类基准变了”。
 */
import { ENGINE_VERSION } from '../domain/calculate'
import { REVIEW_RULES_VERSION } from '../review/rules'
import { sha256Hex } from '../sources/hash'
import { canonicalJson, stableFingerprint } from './canonical'
import type { ProjectFileParameterBindingLink, ProjectFileSnapshot } from '../project-file/types'
import { SPACER_TEMPLATE_VERSION } from '../drawing/types'
import type { ProjectFileSpacerParameter } from '../project-file/types'
import { isPdfRequirementSource } from '../requirements/types'

export const D_GENERATOR_VERSION = 'spacer-drawing-generator-v1'

export type BaseGroupId =
  | 'chain'
  | 'parameters'
  | 'bindings'
  | 'drawing'
  | 'models'
  | 'sources'
  | 'requirement'
  | 'versions'
  | 'revision'

export const BASE_GROUP_LABEL: Record<BaseGroupId, string> = {
  chain: '尺寸链（数值/目标/假设/关系修订）',
  parameters: '隔套参数（值/显示位/来源备注/参数修订）',
  bindings: '参数绑定集合',
  drawing: '图纸引用（模板/比例/图框/指纹）',
  models: '模型当前版本与附件',
  sources: '来源文档/版本/绑定/附件可用性',
  requirement: '任务书条款（版本/区间/来源）',
  versions: '引擎/规则/生成器版本',
  revision: '正式版本指针与编辑代数',
}

export interface BaseGroupDigest {
  id: BaseGroupId
  hash: string
}

export interface BaseDigest {
  /** 分组摘要的稳定哈希。 */
  token: string
  groups: BaseGroupDigest[]
  generation: number
  acceptedSeq: number
  currentRevisionId: string
}

export function parameterBindingLinks(
  snapshot: ProjectFileSnapshot,
): ProjectFileParameterBindingLink[] {
  return snapshot.project.dimensionLinks.filter(
    (link): link is ProjectFileParameterBindingLink => link.kind === 'parameter-binding',
  )
}

function chainInput(snapshot: ProjectFileSnapshot): unknown {
  const chain = snapshot.project.dimensionChain
  return {
    relationRevision: snapshot.project.relationRevision,
    relationReview:
      snapshot.project.relationReview === null
        ? null
        : {
            relationRevision: snapshot.project.relationReview.relationRevision,
            fingerprint: snapshot.project.relationReview.fingerprint,
          },
    target: chain.target,
    assumptions: chain.assumptions,
    terms: chain.terms.map((term) => ({
      id: term.id,
      symbol: term.symbol,
      name: term.name,
      nominalQ: term.nominalQ,
      lowerDeviationQ: term.lowerDeviationQ,
      upperDeviationQ: term.upperDeviationQ,
      sign: term.sign,
      termRevision: term.termRevision,
    })),
  }
}

function parameterInput(parameters: readonly ProjectFileSpacerParameter[]): unknown {
  return [...parameters]
    .map((parameter) => ({
      parameterId: parameter.parameterId,
      partId: parameter.partId,
      key: parameter.key,
      valueQ: parameter.valueQ,
      inputDecimals: parameter.inputDecimals,
      parameterRevision: parameter.parameterRevision,
      sourceNote: parameter.sourceNote ?? '',
    }))
    .sort((left, right) => (left.parameterId < right.parameterId ? -1 : 1))
}

function bindingInput(snapshot: ProjectFileSnapshot): unknown {
  return parameterBindingLinks(snapshot)
    .map((link) => ({
      bindingId: link.bindingId,
      termId: link.termId,
      partId: link.partId,
      parameterId: link.parameterId,
      syncField: link.syncField,
    }))
    .sort((left, right) => (left.bindingId < right.bindingId ? -1 : 1))
}

function drawingInput(snapshot: ProjectFileSnapshot): unknown {
  return snapshot.project.drawings.map((drawing) => ({
    drawingId: drawing.drawingId,
    drawingDataVersion: drawing.drawingDataVersion,
    templateId: drawing.templateId,
    templateVersion: drawing.templateVersion,
    partId: drawing.partId,
    revisionId: drawing.revisionId,
    parameterIds: drawing.parameterIds,
    paper: drawing.paper,
    scale: drawing.scale,
    frameFields: drawing.frameFields,
    status: drawing.status,
    dataFingerprint: drawing.dataFingerprint,
  }))
}

function modelInput(snapshot: ProjectFileSnapshot): unknown {
  return {
    parts: snapshot.project.parts.map((part) => ({
      partId: part.partId,
      currentModelRevisionId: part.currentModelRevisionId,
    })),
    revisions: snapshot.project.modelRevisions.map((revision) => ({
      modelRevisionId: revision.modelRevisionId,
      partId: revision.partId,
      attachmentSha256: revision.attachmentSha256,
      byteSize: revision.byteSize,
    })),
  }
}

type SourceSnapshotLike = Pick<
  ProjectFileSnapshot,
  'documents' | 'revisions' | 'bindings' | 'blobs' | 'missingAttachments'
>

/**
 * 参数绑定确认凭据的“来源清单”。
 *
 * 只纳入尺寸链来源绑定实际引用的文档/版本/附件：这些才是参数值的人工核对依据。
 * 不能把项目里所有附件都算进来——例如 V3.5 的任务书 PDF 由 RequirementRevision
 * 自己的 source 冻结并进入 requirement 基准分组，与参数 binding 无关；若把它也
 * 算入 sourceBasis，确认条款就会把未改动的参数绑定误判为“待核”。
 *
 * 归属变化（新增/改绑来源、绑定的版本换版、附件声明缺失）仍会改变摘要，
 * 从而让旧确认失效。
 */
function sourceInput(snapshot: SourceSnapshotLike): unknown {
  const bindings = snapshot.bindings.map((binding) => ({
    bindingId: binding.id,
    termId: binding.termId,
    revisionId: binding.revisionId,
    documentId: binding.documentId,
    page: binding.page,
    rectPdf: binding.rectPdf,
    pageBoxPdf: binding.pageBoxPdf,
    reviewedTermRevision: binding.reviewedTermRevision,
    reviewedAt: binding.reviewedAt,
    historicalAcceptance: binding.historicalAcceptance,
  }))
  const boundRevisionIds = new Set(snapshot.bindings.map((binding) => binding.revisionId))
  const boundDocumentIds = new Set(snapshot.bindings.map((binding) => binding.documentId))
  const revisions = snapshot.revisions.filter((revision) => boundRevisionIds.has(revision.id))
  const documents = snapshot.documents.filter((document) => boundDocumentIds.has(document.id))
  const boundBlobKeys = new Set(revisions.map((revision) => revision.blobKey))
  const missingKeys = new Set(
    snapshot.missingAttachments
      .map((item) => item.blobKey)
      .filter((blobKey) => boundBlobKeys.has(blobKey)),
  )
  return {
    documents: documents.map((document) => ({
      documentId: document.id,
      latestRevisionId: document.latestRevisionId,
    })),
    revisions: revisions.map((revision) => ({
      revisionId: revision.id,
      documentId: revision.documentId,
      blobKey: revision.blobKey,
      sha256: revision.sha256,
      byteSize: revision.byteSize,
    })),
    bindings,
    blobs: snapshot.blobs
      .filter((blob) => boundBlobKeys.has(blob.blobKey))
      .map((blob) => ({
        blobKey: blob.blobKey,
        sha256: blob.sha256,
        byteSize: blob.byteSize,
        // 可用性按“是否声明缺失”派生：与 DTO 一致，main 与 renderer 可独立重算。
        declaredMissing: missingKeys.has(blob.blobKey),
      })),
  }
}

export function sourceFingerprint(snapshot: SourceSnapshotLike): string {
  return stableFingerprint(sourceInput(snapshot))
}

/**
 * 条款分组：任何条款版本/区间/来源/确认依据变化都会改变基准摘要，
 * 从而让旧预览与旧令牌失效（改后改回也因代数推进而失效）。
 */
export function requirementInput(snapshot: ProjectFileSnapshot): unknown {
  return {
    activeRequirementRevisionId: snapshot.project.activeRequirementRevisionId,
    revisions: [...snapshot.project.requirementRevisions]
      .map((revision) => ({
        requirementId: revision.requirementId,
        revisionId: revision.revisionId,
        parentRevisionId: revision.parentRevisionId,
        ruleType: revision.ruleType,
        lowerQ: revision.lowerQ,
        upperQ: revision.upperQ,
        confirmedText: revision.confirmedText,
        confirmedAt: revision.confirmedAt,
        confirmedAgainstLatestRevisionId: revision.confirmedAgainstLatestRevisionId,
        source: isPdfRequirementSource(revision.source)
          ? {
              documentId: revision.source.documentId,
              revisionId: revision.source.revisionId,
              sha256: revision.source.sha256,
              blobKey: revision.source.blobKey,
              page: revision.source.page,
              rectPdf: revision.source.rectPdf,
              pageBoxPdf: revision.source.pageBoxPdf,
            }
          : {
              kind: 'user-attestation',
              actorId: revision.source.attestation.actorId,
              sessionSeq: revision.source.attestation.sessionSeq,
              fieldPath: revision.source.attestation.fieldPath,
              statement: revision.source.attestation.statement,
            },
        bindingBasisDigest: revision.bindingBasis.digest,
      }))
      .sort((left, right) => (left.revisionId < right.revisionId ? -1 : 1)),
  }
}

/** 一次确认事件的来源基准：来源清单指纹 + 该参数来源备注。 */
export function sourceBasisOf(snapshot: SourceSnapshotLike, sourceNote: string | undefined): string {
  return `${sourceFingerprint(snapshot)}:${sourceNote ?? ''}`
}

export async function computeBaseDigest(
  snapshot: ProjectFileSnapshot,
  input: { sessionId: string; generation: number; acceptedSeq: number },
): Promise<BaseDigest> {
  const raw: { id: BaseGroupId; value: unknown }[] = [
    { id: 'chain', value: chainInput(snapshot) },
    { id: 'parameters', value: parameterInput(snapshot.project.parameters) },
    { id: 'bindings', value: bindingInput(snapshot) },
    { id: 'drawing', value: drawingInput(snapshot) },
    { id: 'models', value: modelInput(snapshot) },
    { id: 'sources', value: sourceInput(snapshot) },
    { id: 'requirement', value: requirementInput(snapshot) },
    {
      id: 'versions',
      value: {
        engineVersion: snapshot.project.engineVersion,
        reviewRulesVersion: REVIEW_RULES_VERSION,
        generatorVersion: `${D_GENERATOR_VERSION}/${SPACER_TEMPLATE_VERSION}`,
        engineConstant: ENGINE_VERSION,
      },
    },
    {
      id: 'revision',
      value: {
        projectId: snapshot.project.id,
        sessionId: input.sessionId,
        currentRevisionId: snapshot.project.currentRevisionId,
        generation: input.generation,
        acceptedSeq: input.acceptedSeq,
        name: snapshot.project.name,
      },
    },
  ]
  const groups: BaseGroupDigest[] = []
  for (const group of raw) {
    groups.push({ id: group.id, hash: await sha256Hex(new TextEncoder().encode(canonicalJson(group.value))) })
  }
  const token = await sha256Hex(new TextEncoder().encode(canonicalJson(groups)))
  return {
    token,
    groups,
    generation: input.generation,
    acceptedSeq: input.acceptedSeq,
    currentRevisionId: snapshot.project.currentRevisionId,
  }
}

/** 草稿令牌：覆盖草稿值、显示位、来源备注、绑定意图、理由与单调草稿修订号。 */
export async function computeDraftToken(input: {
  draftId: string
  draftRevision: number
  parameters: readonly ProjectFileSpacerParameter[]
  bindings: readonly ProjectFileParameterBindingLink[]
  reason: string
}): Promise<string> {
  return sha256Hex(
    new TextEncoder().encode(
      canonicalJson({
        draftId: input.draftId,
        draftRevision: input.draftRevision,
        parameters: parameterInput(input.parameters),
        bindings: input.bindings.map((link) => ({
          bindingId: link.bindingId,
          termId: link.termId,
          partId: link.partId,
          parameterId: link.parameterId,
          syncField: link.syncField,
        })),
        reason: input.reason,
      }),
    ),
  )
}

export interface BaseChange {
  id: BaseGroupId
  label: string
}

/** 拒绝时逐项说明哪类基准变了；分组未变但代数前进时也明确提示。 */
export function explainBaseChange(before: BaseDigest, after: BaseDigest): BaseChange[] {
  const previous = new Map(before.groups.map((group) => [group.id, group.hash]))
  const changes: BaseChange[] = []
  for (const group of after.groups) {
    if (previous.get(group.id) !== group.hash) {
      changes.push({ id: group.id, label: BASE_GROUP_LABEL[group.id] })
    }
  }
  if (changes.length === 0 && before.token !== after.token) {
    changes.push({ id: 'revision', label: BASE_GROUP_LABEL.revision })
  }
  return changes
}
