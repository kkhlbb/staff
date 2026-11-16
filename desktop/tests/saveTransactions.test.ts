import { describe, expect, it } from 'vitest'
import { FileStore, type FileOps } from '../main/fileStore'
import { ProjectService } from '../main/projectService'
import { createSampleSnapshot } from '../../src/project-file/__fixtures__/sampleProjectFile'
import { decodeProjectFile } from '../../src/project-file/codec'

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
  it.each([1, 2, 3])('preserves a newer stage during suspended rename (run %s)', async () => {
    const port = memoryPort()
    const service = new ProjectService({ store: new FileStore({ ops: port.ops }) })
    const snapshot = await createSampleSnapshot()
    const opened = service.adoptSnapshot(snapshot, null, null)
    if (!opened.ok) throw Error(opened.error.message)
    const id = opened.value.sessionId
    expect(service.stage(id, 1, { ...snapshot, project: { ...snapshot.project, name: 'saving' } }).ok).toBe(true)
    const saving = service.saveAs(id, { editSeq: 1, expectedFingerprint: null, targetPath: '/projects/test.cunlian' })
    await port.atRename
    expect(service.stage(id, 2, { ...snapshot, project: { ...snapshot.project, name: 'new edit' } }).ok).toBe(true)
    port.release()
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
