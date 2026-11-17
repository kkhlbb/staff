import { describe, expect, it } from 'vitest'
import { FileStore, sha256Bytes, type FileOps } from '../main/fileStore'
import { ProjectService } from '../main/projectService'
import { createSampleSnapshot } from '../../src/project-file/__fixtures__/sampleProjectFile'
import { decodeProjectFile, encodeProjectFile } from '../../src/project-file/codec'

function memoryPort() {
  const files = new Map<string, Uint8Array>()
  let reached!: () => void
  let release!: () => void
  const atRename = new Promise<void>(resolve => { reached = resolve })
  const resume = new Promise<void>(resolve => { release = resolve })
  const ops: FileOps = {
    async statKind(p) { return p === '/projects' ? 'directory' : files.has(p) ? 'file' : 'missing' },
    async readFile(p) { const b = files.get(p); if (!b) throw Error(`missing ${p}`); return b.slice() },
    async writeExclusive(p, b) { if (files.has(p)) throw Error('EEXIST'); files.set(p, b.slice()) },
    async rename(a, b) { reached(); await resume; const bytes = files.get(a); if (!bytes) throw Error('missing temp'); files.set(b, bytes); files.delete(a) },
    async remove(p) { files.delete(p) },
    async syncDirectory() {},
  }
  return { files, ops, atRename, release: () => release() }
}

describe('S01 production FileStore memory-port save transaction', () => {
  it.each(['save', 'saveAs'].flatMap(mode => [1, 2, 3].map(run => ({ mode, run }))))('preserves a newer stage during suspended $mode rename (run $run)', async ({ mode }) => {
    const port = memoryPort()
    const service = new ProjectService({ store: new FileStore({ ops: port.ops }) })
    const snapshot = await createSampleSnapshot()
    const encoded = await encodeProjectFile(snapshot)
    if (!encoded.ok) throw Error(encoded.error.message)
    const fingerprint = mode === 'save' ? await sha256Bytes(encoded.value.bytes) : null
    if (mode === 'save') port.files.set('/projects/test.cunlian', encoded.value.bytes)
    const opened = service.adoptSnapshot(snapshot, mode === 'save' ? '/projects/test.cunlian' : null, fingerprint)
    if (!opened.ok) throw Error(opened.error.message)
    const id = opened.value.sessionId
    expect((await service.stage(id, 1, { ...snapshot, project: { ...snapshot.project, name: 'saving' } })).ok).toBe(true)
    const saving = mode === 'save'
      ? service.save(id, { editSeq: 1, expectedFingerprint: fingerprint })
      : service.saveAs(id, { editSeq: 1, expectedFingerprint: null, targetPath: '/projects/test.cunlian' })
    await port.atRename
    const staging = service.stage(id, 2, { ...snapshot, project: { ...snapshot.project, name: 'new edit' } })
    port.release()
    expect((await staging).ok).toBe(true)
    expect((await saving).ok).toBe(true)
    const session = service.getSession(id)!
    expect(session.snapshot.project.name).toBe('new edit')
    expect(session.acceptedSeq).toBe(2)
    expect(session.savedSeq).toBe(1)
    expect(service.dirtySessionCount()).toBe(1)
    const decoded = await decodeProjectFile(port.files.get('/projects/test.cunlian')!)
    if (!decoded.ok) throw Error(decoded.error.message)
    expect(decoded.value.snapshot.project.name).toBe('saving')
  })
})
