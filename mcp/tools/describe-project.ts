/**
 * 工具 `describe_project`：只读描述一个 `.cunlian` 项目文件。
 *
 * 复用 `decodeProjectFile`（容器校验、schema 兼容、内嵌引用一致性都在里面）；
 * 出处完整性只由 `isProvenanceCompleteness` 判定，不另写一份。
 *
 * 输出的是“文件里记了什么”，不是“我同意它”：当前条款状态是
 * `currentRequirementCheck` 的**历史证据**，本工具不重新判定、不写盘。
 */
import { readFile, stat } from 'node:fs/promises'
import { decodeProjectFile } from '../../src/project-file/codec'
import {
  candidateNumericFields,
  candidateProvenance,
  decisionProvenance,
  evidenceRefKind,
  isProvenanceCompleteness,
  provenanceKey,
  uniqueProvenance,
  valueProvenance,
  type EvidenceRef,
} from '../../src/document-extraction/types'
import { isPdfRequirementSource } from '../../src/requirements/types'
import {
  asObject,
  readString,
  requireAbsolutePath,
  ToolInputError,
} from '../lib/args'
import { mm, sha256, success } from '../lib/format'

export const describeProjectDefinition = {
  name: 'describe_project',
  title: '只读描述 .cunlian 项目',
  description:
    '.cunlian（ZIP）绝对路径 → 正式版本、三参数、尺寸链组成环、活动条款、出处清单。只读：只解码与读取，不提交、不保存、不改任何字段。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      path: { type: 'string', description: '.cunlian 项目文件绝对路径。' },
    },
    required: ['path'],
  },
} as const

function provenanceView(ref: EvidenceRef): Record<string, unknown> {
  const kind = evidenceRefKind(ref)
  const base = { kind, complete: isProvenanceCompleteness(ref), key: provenanceKey(ref) }
  if (kind === 'user-attestation') {
    const attestation = ref as Extract<EvidenceRef, { kind: 'user-attestation' }>
    return {
      ...base,
      actorId: attestation.actorId,
      at: attestation.at,
      sessionSeq: attestation.sessionSeq,
      fieldPath: attestation.fieldPath,
      statement: attestation.statement,
    }
  }
  if (kind === 'image-ocr') {
    const image = ref as Extract<EvidenceRef, { kind: 'image-ocr' }>
    return {
      ...base,
      imageId: image.imageId,
      sha256: image.sha256,
      fileName: image.fileName,
      rectPdf: image.rectPdf,
      confidence: image.confidence,
    }
  }
  const anchored = ref as Extract<EvidenceRef, { page: number }>
  return {
    ...base,
    documentId: anchored.documentId,
    revisionId: anchored.revisionId,
    sha256: anchored.sha256,
    page: anchored.page,
    rectPdf: anchored.rectPdf,
    pageBoxPdf: anchored.pageBoxPdf,
    textSnippet: anchored.textSnippet.slice(0, 160),
  }
}

function requirementSourceView(
  source: import('../../src/requirements/types').RequirementSourceRef,
): Record<string, unknown> {
  if (!isPdfRequirementSource(source)) {
    const attestation = source.attestation
    return {
      kind: 'user-attestation',
      complete: isProvenanceCompleteness(attestation),
      actorId: attestation.actorId,
      at: attestation.at,
      sessionSeq: attestation.sessionSeq,
      statement: attestation.statement,
      fieldPath: attestation.fieldPath,
    }
  }
  return {
    kind: 'pdf',
    documentId: source.documentId,
    revisionId: source.revisionId,
    sha256: source.sha256,
    blobKey: source.blobKey,
    page: source.page,
    rectPdf: source.rectPdf,
    pageBoxPdf: source.pageBoxPdf,
  }
}

export async function runDescribeProject(
  rawArguments: unknown,
): Promise<Record<string, unknown>> {
  const args = asObject(rawArguments ?? {}, 'arguments')
  const path = requireAbsolutePath(
    readString(args, 'path', { required: true, maxLength: 1000 })!,
    'path',
  )
  const info = await stat(path).catch(() => null)
  if (info === null || !info.isFile()) {
    throw new ToolInputError('NOT_FOUND', '项目文件不存在或不是普通文件', path)
  }
  const bytes = new Uint8Array(await readFile(path))
  const digest = await sha256(bytes)
  const decoded = await decodeProjectFile(bytes)
  if (!decoded.ok) {
    throw new ToolInputError(
      'TOOL_FAILED',
      `项目文件读取失败：${decoded.error.message}`,
      decoded.error.code,
    )
  }

  const { project, fileRevisions } = decoded.value.snapshot
  const currentRevision =
    fileRevisions.find((revision) => revision.revisionId === project.currentRevisionId) ?? null

  const activeRequirement =
    project.activeRequirementRevisionId === null
      ? null
      : project.requirementRevisions.find(
          (revision) => revision.revisionId === project.activeRequirementRevisionId,
        ) ?? null

  // 出处清单：只收项目里真实存在的 EvidenceRef（断言账本 + 提取草稿的数值/决定），
  // 按唯一实现 provenanceKey 去重；完整性只由 isProvenanceCompleteness 判。
  const refs: EvidenceRef[] = [...project.attestations]
  for (const draft of project.extractionDrafts) {
    for (const candidate of draft.candidates) {
      for (const { value } of candidateNumericFields(candidate)) {
        refs.push(...valueProvenance(value))
      }
      refs.push(...candidateProvenance(candidate))
    }
    for (const decision of draft.decisions) {
      refs.push(...decisionProvenance(decision))
    }
  }
  const provenance = uniqueProvenance(refs).map(provenanceView)
  const incomplete = provenance.filter((item) => item.complete !== true)

  return success('describe_project', {
    file: { path, byteSize: bytes.byteLength, sha256: digest },
    manifest: {
      formatVersion: decoded.value.manifest.formatVersion,
      createdAt: decoded.value.manifest.createdAt,
      writer: decoded.value.manifest.writer,
      counts: decoded.value.manifest.counts,
    },
    project: {
      id: project.id,
      name: project.name,
      schemaVersion: project.schemaVersion,
      engineVersion: project.engineVersion,
      sourceKind: project.sourceKind,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      currentRevisionId: project.currentRevisionId,
    },
    formalVersion:
      currentRevision === null
        ? null
        : {
            revisionId: currentRevision.revisionId,
            parentId: currentRevision.parentId,
            createdAt: currentRevision.createdAt,
            reason: currentRevision.reason,
            fileRevisionCount: fileRevisions.length,
          },
    parameters: project.parameters.map((parameter) => ({
      parameterId: parameter.parameterId,
      key: parameter.key,
      valueQ: parameter.valueQ,
      valueMm: mm(parameter.valueQ),
      inputDecimals: parameter.inputDecimals,
      parameterRevision: parameter.parameterRevision,
      reviewStatus: parameter.reviewStatus,
      sourceNote: parameter.sourceNote ?? '',
      source: '用户输入（项目记录）',
    })),
    terms: project.dimensionChain.terms.map((term) => ({
      id: term.id,
      symbol: term.symbol,
      name: term.name,
      nominalQ: term.nominalQ,
      nominalMm: mm(term.nominalQ),
      lowerDeviationQ: term.lowerDeviationQ,
      lowerDeviationMm: mm(term.lowerDeviationQ),
      upperDeviationQ: term.upperDeviationQ,
      upperDeviationMm: mm(term.upperDeviationQ),
      sign: term.sign,
      termRevision: term.termRevision,
      sourceNote: term.sourceNote,
    })),
    requirement:
      activeRequirement === null
        ? null
        : {
            requirementId: activeRequirement.requirementId,
            revisionId: activeRequirement.revisionId,
            ruleType: activeRequirement.ruleType,
            confirmedText: activeRequirement.confirmedText,
            lowerQ: activeRequirement.lowerQ,
            lowerMm: mm(activeRequirement.lowerQ),
            upperQ: activeRequirement.upperQ,
            upperMm: mm(activeRequirement.upperQ),
            confirmedAt: activeRequirement.confirmedAt,
            changeReason: activeRequirement.changeReason,
            source: requirementSourceView(activeRequirement.source),
            revisionCount: project.requirementRevisions.length,
          },
    recordedCheck:
      project.currentRequirementCheck === null
        ? null
        : {
            checkId: project.currentRequirementCheck.checkId,
            status: project.currentRequirementCheck.status,
            reasonCodes: [...project.currentRequirementCheck.reasonCodes],
            resultInterval: project.currentRequirementCheck.resultInterval,
            margins: project.currentRequirementCheck.margins,
            checkedAt: project.currentRequirementCheck.checkedAt,
            note: '这是文件里记录的历史检查证据，本次读取未重新判定。',
          },
    provenance: {
      total: provenance.length,
      incomplete: incomplete.length,
      items: provenance,
    },
    readOnly: true,
  })
}
