import { it, expect } from 'vitest'
import { FileStore, type FileOps } from '../main/fileStore'
import { ProjectService } from '../main/projectService'
import { createSampleSnapshot } from '../../src/project-file/__fixtures__/sampleProjectFile'

it.each([1, 2, 3])('S02 candidate commit must not overwrite a stage after the final guard (run %s)', async () => {
  const files = new Map<string, Uint8Array>()
  let pause!: () => void
  let resume!: () => void
  const atRename = new Promise<void>(r => { pause = r })
  const barrier = new Promise<void>(r => { resume = r })
  const ops: FileOps = {
    async statKind(p) { return p === '/projects' ? 'directory' : files.has(p) ? 'file' : 'missing' },
    async readFile(p) { const b = files.get(p); if (!b) throw Error('missing'); return b.slice() },
    async writeExclusive(p,b) { files.set(p,b.slice()) },
    async rename(a,b) { pause(); await barrier; files.set(b, files.get(a)!); files.delete(a) },
    async remove(p) { files.delete(p) }, async syncDirectory() {},
  }
  const service = new ProjectService({ store: new FileStore({ ops }) })
  const snapshot = await createSampleSnapshot()
  const opened = service.adoptSnapshot(snapshot, null, null)
  if (!opened.ok) throw Error(opened.error.message)
  const id = opened.value.sessionId
  const session = service.getSession(id)!
  let guards = 0
  const candidate = { ...snapshot, project: { ...snapshot.project, name: 'approved' } }
  const commit = service.commitCandidate(id, { baseEditSeq: 0, candidate, targetPath: '/projects/test.cunlian', guard: () => { guards++; return session.acceptedSeq === 0 ? null : 'changed' } })
  await atRename
  expect(guards).toBeGreaterThanOrEqual(2)
  expect(service.stage(id, 1, { ...snapshot, project: { ...snapshot.project, name: 'new edit' } }).ok).toBe(true)
  resume()
  await commit
  expect(session.snapshot.project.name).toBe('new edit')
  expect(session.acceptedSeq).toBeGreaterThan(session.savedSeq)
})
