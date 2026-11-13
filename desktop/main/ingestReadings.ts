import { z } from 'zod'
import { createHash } from 'node:crypto'
import { ingestReadings } from '../../src/document-extraction/ingestReadings'
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

/** 只绑定现有文件与用户自述，外部读数不冒充提取。当前仅接人报数，不提供看图能力。 */
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
  if (source.kind === 'image') return fail('UNSUPPORTED_SCOPE', '图片读数接口已预留；当前没有可核验图片库，请先以 PDF 页导入')
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
