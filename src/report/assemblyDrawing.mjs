import { createHash, randomUUID } from 'node:crypto'
import { createGeometryManager } from '../core/geometry/geometryManager.mjs'

export async function assemblyDrawing(snapshot, assembly, revision, { workerUrl, signal, timeoutMs = 15_000 } = {}) {
  if (!assembly?.parts.length) return undefined
  const manager = createGeometryManager(workerUrl)
  try {
    const required = new Set(assembly.parts.filter(part => part.kind === 'imported-step').map(part => part.attachmentId))
    const attachments = (snapshot.project.stepAttachments ?? []).filter(item => required.has(item.id)).flatMap(item => {
      const attachment = snapshot.attachments.find(blob => blob.blobKey === item.blobKey)
      if (!attachment) return []
      const sha256 = createHash('sha256').update(attachment.bytes).digest('hex')
      return [{ ...item, bytes: attachment.bytes, sha256 }]
    })
    if (attachments.length !== required.size) return undefined
    const { report } = await manager.rebuildAssembly(assembly, {
      jobId: randomUUID(), attempt: 1, projectId: snapshot.project.id, revision,
      attachments, drawing: { export: true }, signal, timeoutMs,
    })
    return report.exports?.svg
  } catch (error) {
    if (signal?.aborted) throw error
    return undefined
  } finally {
    await manager.close()
  }
}
