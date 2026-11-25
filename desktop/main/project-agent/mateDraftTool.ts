import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import type { ToolSchema } from '../../../src/agent/types'
import { recoverCandidates, stepAttachmentHashes, suggestMateDrafts } from '../../../src/core/solver/mateDrafts'
import { decodeProjectFile } from '../../../src/project-file/codec'
import { PROJECT_FILE_MAX_SOURCE_BYTES } from '../../../src/project-file/types'
import type { LocalM1Session } from './m1LocalAuthority'

export const mateDraftTool: ToolSchema = {
  name: 'suggest_assembly_mates',
  description: '读取已授权项目的 STEP 拓扑，返回带稳定特征引用的配合草案。每条均需人工确认。',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
}

export type MateDraftResult = ReturnType<typeof suggestMateDrafts>

/** Read only the exact authorized native file. The model supplies neither paths nor feature geometry. */
export async function readMateDrafts(session: LocalM1Session, signal: AbortSignal): Promise<MateDraftResult | null> {
  if (!session.path || !session.fingerprint) return null
  const file = await open(session.path, 'r')
  let bytes: Buffer
  try {
    const metadata = await file.stat()
    if (!metadata.isFile() || metadata.size > PROJECT_FILE_MAX_SOURCE_BYTES) throw Error('REFERENCE_STALE')
    bytes = Buffer.alloc(metadata.size)
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
    if (bytesRead !== bytes.length || createHash('sha256').update(bytes).digest('hex') !== session.fingerprint) {
      throw Error('REFERENCE_STALE')
    }
  } finally {
    await file.close()
  }
  signal.throwIfAborted()
  const decoded = await decodeProjectFile(bytes)
  signal.throwIfAborted()
  if (!decoded.ok) return null
  const { project } = decoded.value.snapshot
  if (project.id !== session.projectId) throw Error('REFERENCE_STALE')
  const assembly = project.assembly3d
  if (!assembly || !assembly.parts.some(part => part.kind === 'imported-step')) return null
  return suggestMateDrafts(assembly, recoverCandidates(assembly), undefined, stepAttachmentHashes(decoded.value.snapshot))
}
