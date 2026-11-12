/**
 * ADR-001 第 3 步：无任务书项目的建立与“对话写草稿”（main 侧纯逻辑）。
 *
 * 边界：
 * - 只改 `project.extractionDrafts` / `project.attestations` / 身份与来源字段；
 *   不改尺寸链、参数、绑定、条款、图纸，也不调用计算；
 * - 提交仍走 commitApprovedDraft（planApplication + 重算 + 授权），这里没有提交入口；
 * - 所有由人给出的数值都必须通过 `src/intent` 的原话/数值校验。
 */
import { randomUUID } from 'node:crypto'
import type { ExtractionDraft, UserAttestation } from '../../src/document-extraction/types'
import { provenanceKey, uniqueProvenance } from '../../src/document-extraction/types'
import {
  createIntentDraft,
  intentDraftId,
  setBindingInDraft,
  setChainInDraft,
  setRequirementInDraft,
  INTENT_EXTRACTOR_VERSION,
  type IntentBinding,
  type IntentParameterKey,
} from '../../src/intent/draft'
import {
  ACTOR_ID_MAX_LENGTH,
  SESSION_LABEL_MAX_LENGTH,
  normalizeText,
  type IntentInputErrorCode,
  type IntentSession,
  type IntentTurn,
} from '../../src/intent/types'
import type { ProjectFileProject, ProjectFileSnapshot } from '../../src/project-file/types'
import { createNewProjectSnapshot } from './newProject'

export interface IntentIdentity {
  readonly actorId: string
  readonly sessionLabel: string | null
}

/** 控制字符（含换行）检查：不用正则，避免把 \x00 写进表达式。 */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

export type IntentToolName = 'createProject' | 'setChain' | 'setRequirement' | 'setBinding'

export function validateActorId(value: unknown): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof value !== 'string') return { ok: false, message: '责任人自述必须是文本' }
  const trimmed = value.trim()
  if (trimmed === '') return { ok: false, message: '请先填写责任人自述（你自己怎么称呼）' }
  if (trimmed.length > ACTOR_ID_MAX_LENGTH) {
    return { ok: false, message: `责任人自述最多 ${ACTOR_ID_MAX_LENGTH} 个字符` }
  }
  if (hasControlCharacter(trimmed)) {
    return { ok: false, message: '责任人自述不能包含换行或控制字符' }
  }
  return { ok: true, value: trimmed }
}

export function validateSessionLabel(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  if (hasControlCharacter(trimmed)) return null
  return normalizeText(trimmed).slice(0, SESSION_LABEL_MAX_LENGTH)
}

/** 没有任何业务内容的新建项目（新建 → 未导入、未提取、未建图）。 */
export function isBlankProject(snapshot: ProjectFileSnapshot): boolean {
  const project = snapshot.project
  return (
    snapshot.documents.length === 0 &&
    snapshot.revisions.length === 0 &&
    snapshot.attachments.length === 0 &&
    snapshot.events.length === 0 &&
    project.extractionDrafts.length === 0 &&
    project.parameters.length === 0 &&
    project.drawings.length === 0 &&
    project.modelRevisions.length === 0 &&
    project.dimensionLinks.length === 0 &&
    project.requirementRevisions.length === 0 &&
    project.attestations.length === 0 &&
    snapshot.fileRevisions.length <= 1
  )
}

export interface CreateIntentProjectOptions {
  readonly name: string
  readonly identity: IntentIdentity
  readonly appVersion: string
  readonly electronVersion: string
  readonly now?: () => Date
  readonly newId?: () => string
}

/**
 * 新建无任务书项目：来源种类是 `user-intent`，责任人写进项目文件，
 * 输入会话从 1 开始，同时建立空意图草稿（还没有任何候选）。
 *
 * 起始链仍是“新建项目”的占位链（两个明确标注的占位环）：领域校验要求
 * 2..20 个组成环，而真实组成环要等用户开口。占位链在提交时被用户给出的
 * 组成环整体替换；它永远不会被当作“用户给的值”写进版本。
 */
export function createIntentProjectSnapshot(options: CreateIntentProjectOptions): ProjectFileSnapshot {
  const now = options.now ?? (() => new Date())
  const newId = options.newId ?? (() => randomUUID())
  const base = createNewProjectSnapshot({
    name: options.name,
    template: 'empty',
    appVersion: options.appVersion,
    electronVersion: options.electronVersion,
    now,
    newId,
  })
  const createdAt = now().toISOString()
  const session: IntentSession = {
    actorId: options.identity.actorId,
    sessionSeq: 1,
    sessionLabel: options.identity.sessionLabel,
  }
  const draft = createIntentDraft({
    projectId: base.project.id,
    session,
    turn: { userText: '', turnId: 'create-project', at: createdAt },
  })
  const project: ProjectFileProject = {
    ...base.project,
    sourceKind: 'user-intent',
    actorId: session.actorId,
    sessionSeq: session.sessionSeq,
    sessionLabel: session.sessionLabel,
    attestations: [],
    extractionDrafts: [draft],
    engineVersion: base.project.engineVersion,
    dimensionChain: {
      ...base.project.dimensionChain,
      assumptions: '无任务书项目：组成环尚未给出（新建占位链，提交前会被用户给出的组成环替换）',
    },
    updatedAt: createdAt,
  }
  return {
    ...base,
    project,
    fileRevisions: base.fileRevisions.map((revision) => ({ ...revision, project })),
  }
}

/** 把一个空白的新建项目就地转成无任务书项目（保持 projectId，不切会话）。 */
export function convertBlankProjectToIntent(
  snapshot: ProjectFileSnapshot,
  options: { name?: string; identity: IntentIdentity; now?: () => Date },
): ProjectFileSnapshot {
  if (!isBlankProject(snapshot)) {
    throw new Error('当前项目已经有内容，不能改成无任务书项目')
  }
  const now = (options.now ?? (() => new Date()))().toISOString()
  const project = snapshot.project
  const session: IntentSession = {
    actorId: options.identity.actorId,
    sessionSeq: 1,
    sessionLabel: options.identity.sessionLabel,
  }
  const draft = createIntentDraft({
    projectId: project.id,
    session,
    turn: { userText: '', turnId: 'create-project', at: now },
  })
  const nextProject: ProjectFileProject = {
    ...project,
    name: options.name ?? project.name,
    sourceKind: 'user-intent',
    actorId: session.actorId,
    sessionSeq: session.sessionSeq,
    sessionLabel: session.sessionLabel,
    attestations: [],
    extractionDrafts: [draft],
    dimensionChain: {
      ...project.dimensionChain,
      assumptions: '无任务书项目：组成环尚未给出（新建占位链，提交前会被用户给出的组成环替换）',
    },
    updatedAt: now,
  }
  return {
    ...snapshot,
    project: nextProject,
    fileRevisions: snapshot.fileRevisions.map((revision) =>
      revision.revisionId === snapshot.project.currentRevisionId
        ? { ...revision, project: nextProject }
        : revision,
    ),
  }
}

export function intentDraftOf(project: ProjectFileProject): ExtractionDraft | null {
  return project.extractionDrafts.find((draft) => draft.draftId === intentDraftId(project.id)) ?? null
}

function nextSessionSeq(project: ProjectFileProject, turnId: string): number {
  const current = project.sessionSeq < 1 ? 1 : project.sessionSeq
  const last = project.attestations[project.attestations.length - 1]
  if (last === undefined) return current
  return last.turnId !== turnId ? current + 1 : current
}

function attestationsOfDraft(draft: ExtractionDraft): UserAttestation[] {
  const refs = draft.candidates.flatMap((candidate) => [
    ...(candidate.provenance ?? []),
    ...candidate.evidence,
  ])
  return uniqueProvenance(refs).filter(
    (ref): ref is UserAttestation => ref.kind === 'user-attestation',
  )
}

export interface IntentCommandOutcome {
  readonly project: ProjectFileProject
  readonly draft: ExtractionDraft
  readonly addedAttestations: number
  readonly sessionSeq: number
}

export type IntentCommandResult =
  | { ok: true; value: IntentCommandOutcome }
  | { ok: false; code: IntentInputErrorCode; message: string }

export interface IntentCommandInput {
  readonly turn: IntentTurn
  readonly args: Record<string, unknown>
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/**
 * 在项目内应用一次写入工具。失败不返回任何部分结果（调用方保持原快照）。
 */
export function applyIntentCommand(
  project: ProjectFileProject,
  command: 'setChain' | 'setRequirement' | 'setBinding',
  input: IntentCommandInput,
): IntentCommandResult {
  if (project.sourceKind !== 'user-intent' || project.actorId === null) {
    return { ok: false, code: 'ACTOR_REQUIRED', message: '当前项目不是无任务书项目；先建立无任务书项目' }
  }
  const draft = intentDraftOf(project)
  if (draft === null || draft.extractorVersion !== INTENT_EXTRACTOR_VERSION) {
    return { ok: false, code: 'ACTOR_REQUIRED', message: '意图草稿不存在或规则版本已过期，请重新建立' }
  }
  const sessionSeq = nextSessionSeq(project, input.turn.turnId)
  const session: IntentSession = {
    actorId: project.actorId,
    sessionSeq,
    sessionLabel: project.sessionLabel,
  }
  const statement = typeof input.args.statement === 'string' ? input.args.statement : ''
  let result
  if (command === 'setChain') {
    const rings = Array.isArray(input.args.rings) ? input.args.rings : []
    result = setChainInDraft(draft, {
      session,
      turn: input.turn,
      statement,
      rings: rings.map((ring) => {
        const item = ring as Record<string, unknown>
        return {
          symbol: typeof item.symbol === 'string' ? item.symbol : '',
          nominalMm: typeof item.nominalMm === 'string' ? item.nominalMm : '',
          upperDeviationMm: typeof item.upperDeviationMm === 'string' ? item.upperDeviationMm : '',
          lowerDeviationMm: typeof item.lowerDeviationMm === 'string' ? item.lowerDeviationMm : '',
        }
      }),
      ...(typeof input.args.formula === 'string' ? { formula: input.args.formula } : {}),
    })
  } else if (command === 'setRequirement') {
    result = setRequirementInDraft(draft, {
      session,
      turn: input.turn,
      statement,
      lowerMm: typeof input.args.lowerMm === 'string' ? input.args.lowerMm : '',
      upperMm: typeof input.args.upperMm === 'string' ? input.args.upperMm : '',
      lowerInclusive: input.args.lowerInclusive === true,
      upperInclusive: input.args.upperInclusive === true,
    })
  } else {
    const parameters = Array.isArray(input.args.parameters) ? input.args.parameters : []
    result = setBindingInDraft(draft, {
      session,
      turn: input.turn,
      statement,
      parameters: parameters.map((parameter) => {
        const item = parameter as Record<string, unknown>
        return {
          parameter: (typeof item.parameter === 'string'
            ? item.parameter
            : 'length') as IntentParameterKey,
          mm: typeof item.mm === 'string' ? item.mm : '',
          ...(typeof item.symbol === 'string' ? { symbol: item.symbol } : {}),
        }
      }),
    })
  }
  if (!result.ok) return result

  const nextDraft = result.value
  const ledger = new Map<string, UserAttestation>()
  for (const attestation of project.attestations) ledger.set(provenanceKey(attestation), attestation)
  const added = attestationsOfDraft(nextDraft)
  let addedCount = 0
  for (const attestation of added) {
    const key = provenanceKey(attestation)
    if (!ledger.has(key)) addedCount += 1
    ledger.set(key, attestation)
  }
  const nextProject: ProjectFileProject = {
    ...project,
    sessionSeq,
    attestations: [...ledger.values()],
    extractionDrafts: project.extractionDrafts.map((item) =>
      item.draftId === nextDraft.draftId ? nextDraft : item,
    ),
    updatedAt: input.turn.at,
  }
  return {
    ok: true,
    value: { project: nextProject, draft: nextDraft, addedAttestations: addedCount, sessionSeq },
  }
}

/** 参数 ↔ 环绑定（草稿里记录的意图）；供 apply 时生成 mapping。 */
export function intentBindingsOf(draft: ExtractionDraft): IntentBinding[] {
  return [...(draft.intentBindings ?? [])]
}

/** 草稿里的符号列表（保持稳定顺序：按候选 ID 排序）。 */
export function intentRingSymbols(draft: ExtractionDraft): string[] {
  return draft.candidates
    .filter((candidate) => candidate.kind === 'ring' && candidate.data.symbol !== null)
    .map((candidate) => (candidate as Extract<typeof candidate, { kind: 'ring' }>).data.symbol!)
}

export { strings }
