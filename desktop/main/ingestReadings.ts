import { z } from 'zod'
import { createHash } from 'node:crypto'
import { ingestReadings } from '../../src/document-extraction/ingestReadings'
import { imagePixelSize } from '../../src/sketch/imageSize'
import { sketchStatement } from '../../src/sketch/readings'
import { sourceRectInBounds } from '../../src/sketch/selection'
import { EXTRACTOR_VERSION } from '../../src/document-extraction'
import { stableId } from '../../src/document-extraction/ids'
import { intentDraftOf, validateActorId } from './intentProject'
import type { ProjectFileSnapshot } from '../../src/project-file/types'

const id = z.string().trim().min(1).max(240)
const sha = z.string().regex(/^[a-f0-9]{64}$/iu)
export const ingestReadingsSchema = z.object({
  projectId: id.optional(), draftId: id.optional(),
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('pdf-page'), revisionId: id, sha256: sha, page: z.number().int().positive() }).strict(),
    z.object({ kind: z.literal('image'), imageId: id, sha256: sha }).strict(),
  ]),
  statement: z.string().min(1).max(4000),
  readings: z.array(z.object({ kind: z.literal('dimension'), symbol: id,
    nominalQ: z.number().int().safe(), upperDeviationQ: z.number().int().safe(),
    lowerDeviationQ: z.number().int().safe(), unit: z.literal('mm') }).strict()).min(1).max(20),
}).strict().refine((v) => v.projectId !== undefined || v.draftId !== undefined)

/** 只绑定现有文件与用户自述，外部读数不冒充提取。模型侧入口不提供看图能力。 */
export function ingestIntoSnapshot(snapshot: ProjectFileSnapshot, args: unknown,
  context: { userText: string; turnId: string; at: string; actorId?: string }) {
  const fail = (code: 'INVALID_INPUT' | 'SOURCE_CHANGED' | 'UNSUPPORTED_SCOPE', message: string) => ({ ok: false as const, code, message })
  const parsed = ingestReadingsSchema.safeParse(args)
  if (!parsed.success) return fail('INVALID_INPUT', '读数参数不合法（需 projectId 或 draftId、source、statement、整数 q 读数）')
  const input = parsed.data
  if (!context.userText.includes(input.statement) || input.statement.trim() === '') return fail('INVALID_INPUT', '读数说明必须逐字来自用户原话；本次不含看图能力')
  const project = snapshot.project
  if (input.projectId !== undefined && input.projectId !== project.id) return fail('INVALID_INPUT', '项目不匹配')
  const actor = validateActorId(project.actorId ?? context.actorId)
  if (!actor.ok) return fail('INVALID_INPUT', actor.message)
  const source = input.source
  if (source.kind === 'image') {
    // 模型/工具入口不接图片：没有看图能力，也没有用户框选的坐标。
    // 用户看图填数的入口是 sketchIngestIntoSnapshot（同一领域函数，位置由用户框选）。
    return fail('UNSUPPORTED_SCOPE', '模型工具入口不接收图片读数；草图上框选读数请在“草图读数”面板里提交')
  }
  const revision = snapshot.revisions.find((r) => r.id === source.revisionId)
  const attachment = snapshot.attachments.find((a) => a.blobKey === revision?.blobKey)
  if (!revision || revision.sha256 !== source.sha256 || source.page > revision.pageCount ||
    !attachment || createHash('sha256').update(attachment.bytes).digest('hex') !== source.sha256) return fail('SOURCE_CHANGED', '读数来源页不存在、越界或哈希不一致')
  let draft = input.draftId === undefined ? intentDraftOf(project) : project.extractionDrafts.find((d) => d.draftId === input.draftId)
  if (input.draftId !== undefined && draft == null) return fail('INVALID_INPUT', '读数草稿不存在')
  if (draft == null) {
    const draftId = stableId('readings', [project.id, revision.id])
    draft = project.extractionDrafts.find((d) => d.draftId === draftId) ?? {
      draftId, draftRevision: 1, status: 'draft' as const, projectId: project.id,
      baseToken: project.currentRevisionId,
      sourceIdentity: { documentId: revision.documentId, revisionId: revision.id, sha256: revision.sha256,
        blobKey: revision.blobKey, pageCount: revision.pageCount },
      pageRange: { from: 1, to: revision.pageCount }, extractorVersion: EXTRACTOR_VERSION,
      idempotencyKey: stableId('readings-key', [project.id, revision.id]), candidates: [], issues: [], decisions: [],
    }
  }
  const result = ingestReadings(draft, { ...input, actorId: actor.value,
    sessionSeq: Math.max(1, project.sessionSeq), at: context.at, turnId: context.turnId, modelId: null })
  if (!result.ok) return fail('INVALID_INPUT', result.message)
  const nextDraft = result.value
  return { ok: true as const, snapshot: { ...snapshot, project: { ...project, actorId: actor.value,
    sessionSeq: Math.max(1, project.sessionSeq), updatedAt: context.at,
    extractionDrafts: [...project.extractionDrafts.filter((d) => d.draftId !== nextDraft.draftId), nextDraft] } },
    data: { status: 'pending' as const, requiresVerification: true as const, batchConfirmable: false as const,
      draftId: nextDraft.draftId, candidates: nextDraft.candidates.filter((c) => c.kind === 'ring' && input.readings.some((r) => r.symbol === c.data.symbol)) } }
}

const sketchRect = z.tuple([
  z.number().int().min(0), z.number().int().min(0),
  z.number().int().min(1), z.number().int().min(1),
])

/**
 * 手绘草图入口（界面）：用户在图上框选、自己填读数。
 *
 * - 只接受既有图片版本（imageId = revision.id）+ 原图像素矩形；
 * - 不接受、也不存在任何像素→毫米的标定字段（`.strict()` 会整批拒绝）；
 * - 读数一律进 pending 候选，requiresVerification、batchConfirmable=false；
 * - 复用同一个 `ingestReadings` 领域函数与同一份草稿结构，不是第二条管线。
 */
export const sketchIngestSchema = z.object({
  projectId: id.optional(),
  draftId: id.optional(),
  source: z.object({ kind: z.literal('image'), imageId: id, sha256: sha }).strict(),
  readings: ingestReadingsSchema.shape.readings,
  boxes: z.array(z.object({ symbol: id, rect: sketchRect.nullable() }).strict()).min(1).max(20),
}).strict()
  .refine((v) => v.projectId !== undefined || v.draftId !== undefined)
  .refine((v) => v.boxes.length === v.readings.length, { message: '框选记录必须与读数一一对应' })
  .refine((v) => v.boxes.every((box, index) => box.symbol === v.readings[index]?.symbol),
    { message: '框选记录与读数符号不一致' })

export function sketchIngestIntoSnapshot(snapshot: ProjectFileSnapshot, args: unknown,
  context: { turnId: string; at: string; actorId?: string }) {
  const fail = (code: 'INVALID_INPUT' | 'SOURCE_CHANGED', message: string) => ({ ok: false as const, code, message })
  const parsed = sketchIngestSchema.safeParse(args)
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('；')
    return fail('INVALID_INPUT', `草图读数参数不合法：${detail || '需图片、整数 q 读数、原图像素框选'}`)
  }
  const input = parsed.data
  const project = snapshot.project
  if (input.projectId !== undefined && input.projectId !== project.id) return fail('INVALID_INPUT', '项目不匹配')
  const actor = validateActorId(project.actorId ?? context.actorId)
  if (!actor.ok) return fail('INVALID_INPUT', actor.message)
  const revision = snapshot.revisions.find((item) => item.id === input.source.imageId)
  const attachment = snapshot.attachments.find((item) => item.blobKey === revision?.blobKey)
  if (revision === undefined || revision.projectId !== project.id || revision.sha256 !== input.source.sha256 ||
    attachment === undefined || createHash('sha256').update(attachment.bytes).digest('hex') !== input.source.sha256) {
    return fail('SOURCE_CHANGED', '图片不存在、不属于当前项目或哈希不一致')
  }
  const size = imagePixelSize(attachment.bytes)
  if (size === null) return fail('INVALID_INPUT', '无法从图片文件头读出像素尺寸，拒绝保存框选坐标')
  const draft = input.draftId === undefined
    ? (intentDraftOf(project) ?? project.extractionDrafts.find((d) => d.draftId === stableId('readings', [project.id, revision.id])))
    : project.extractionDrafts.find((d) => d.draftId === input.draftId)
  if (input.draftId !== undefined && draft == null) return fail('INVALID_INPUT', '读数草稿不存在')
  const readings = input.readings
  const boxes = input.boxes
  const targetDraft = draft ?? {
    draftId: stableId('readings', [project.id, revision.id]), draftRevision: 1, status: 'draft' as const,
    projectId: project.id, baseToken: project.currentRevisionId,
    sourceIdentity: { documentId: revision.documentId, revisionId: revision.id, sha256: revision.sha256,
      blobKey: revision.blobKey, pageCount: revision.pageCount },
    pageRange: { from: 1, to: 1 }, extractorVersion: EXTRACTOR_VERSION,
    idempotencyKey: stableId('readings-key', [project.id, revision.id]), candidates: [], issues: [], decisions: [],
  }
  // 红线守卫：框选必须是原图像素且在界内；不框选可以，但要留“无位置”说明。
  for (const [index, box] of boxes.entries()) {
    if (box.rect === null) continue
    const [x, y, width, height] = box.rect
    if (!sourceRectInBounds({ x, y, width, height }, size.width, size.height)) {
      return fail('INVALID_INPUT', `第 ${index + 1} 个框选超出图片范围（原图 ${size.width}×${size.height} 像素）`)
    }
  }
  const statements = readings.map((reading, index) =>
    sketchStatement(index + 1, reading.symbol, boxes[index]?.rect != null))
  const regions = boxes.map((box, index) => ({ index: index + 1, rect: box.rect }))
  const result = ingestReadings(targetDraft, {
    source: { kind: 'image', imageId: revision.id, sha256: revision.sha256 },
    statement: statements[0] ?? '手绘草图读数',
    statements,
    regions,
    readings,
    actorId: actor.value, sessionSeq: Math.max(1, project.sessionSeq),
    at: context.at, turnId: context.turnId, modelId: null,
  })
  if (!result.ok) return fail('INVALID_INPUT', result.message)
  const nextDraft = result.value
  const next: ProjectFileSnapshot = { ...snapshot, project: { ...project, actorId: actor.value,
    sessionSeq: Math.max(1, project.sessionSeq), updatedAt: context.at,
    extractionDrafts: [...project.extractionDrafts.filter((d) => d.draftId !== nextDraft.draftId), nextDraft] } }
  return { ok: true as const, snapshot: next,
    data: { status: 'pending' as const, requiresVerification: true as const, batchConfirmable: false as const,
      draftId: nextDraft.draftId,
      candidates: nextDraft.candidates.filter((c) => c.kind === 'ring' && readings.some((r) => r.symbol === c.data.symbol)) } }
}
