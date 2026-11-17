import { afterEach, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { createHarness, stageRename, type Harness } from './helpers/a04'
import { nodeFileOps } from '../main/fileStore'
import { createSampleSnapshot } from '../../src/project-file/__fixtures__/sampleProjectFile'
import { IPC_CHANNELS, type ProjectOpenValue } from '../shared/contracts'

const harnesses: Harness[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const h of harnesses.splice(0)) await h.dispose() })
async function setup(failRename = false, newRevision = false) {
  let enabled = false
  let reached!: () => void
  let release!: () => void
  const atRename = new Promise<void>(r => { reached = r })
  const resume = new Promise<void>(r => { release = r })
  const h = await createHarness({ choices: ['discard'], debounceMs: 60000, fileOps: { ...nodeFileOps,
    async rename(from, to) {
      if (enabled && to.endsWith('.cunlian')) {
        enabled = false; reached(); await resume
        if (failRename) throw Error('injected rename failure')
      }
      return nodeFileOps.rename(from, to)
    },
  } })
  harnesses.push(h)
  const opened = await h.openSample()
  const session = h.projectService.getSession(opened.sessionId)!
  const original = await fs.readFile(session.path!)
  const project = { ...session.snapshot.project, name: 'approved', currentRevisionId: newRevision ? 'approved-revision' : session.snapshot.project.currentRevisionId }
  const candidate = { ...session.snapshot, project,
    fileRevisions: newRevision ? [...session.snapshot.fileRevisions, {
      revisionId: project.currentRevisionId, parentId: session.snapshot.project.currentRevisionId,
      createdAt: project.updatedAt, reason: 'queue regression', project,
    }] : session.snapshot.fileRevisions,
  }
  await h.recovery.stage(session.sessionId, session.snapshot, 0, h.controller.recoveryMeta(session, session.snapshot))
  expect((await h.recovery.flush(session.sessionId)).state).toBe('written')
  enabled = true
  const commit = h.projectService.commitCandidate(session.sessionId, {
    baseEditSeq: 0, candidate, guard: () => null,
  })
  await atRename
  return { h, opened, session, commit, original, release }
}

it('S02 transaction is per-session: unrelated session progresses while commit rename is suspended', async () => {
  const s = await setup()
  try {
    const other = s.h.projectService.adoptSnapshot(await createSampleSnapshot(), null, null)
    if (!other.ok) throw Error(other.error.message)
    expect((await s.h.projectService.stage(other.value.sessionId, 1, s.h.projectService.getSession(other.value.sessionId)!.snapshot)).ok).toBe(true)
    expect(s.session.acceptedSeq).toBe(0)
  } finally { s.release(); await s.commit }
})

it.each([false, true])('S02 queued production stage preserves full edit or returns recoverable conflict (rename failure=%s)', async failRename => {
  const s = await setup(failRename)
  const staging = stageRename(s.h, s.opened, 1, 'new edit')
  let settled = false
  void staging.then(() => { settled = true })
  await Promise.resolve()
  expect(settled).toBe(false) // No successful BUSY acknowledgement.
  s.release()
  const committed = await s.commit
  expect(committed.ok).toBe(!failRename)
  const staged = await staging
  const expected = failRename ? 1 : 2
  if (failRename) expect(staged).toMatchObject({ ok: true, value: { acceptedSeq: expected, recovery: 'pending' } })
  else expect(staged).toMatchObject({ ok: false, error: { code: 'STALE_EDIT', message: expect.stringContaining('未自动合并'), detail: expect.stringContaining('恢复状态=written') } })
  expect(s.session.snapshot.project.name).toBe(failRename ? 'new edit' : 'approved')
  expect(s.session.acceptedSeq).toBe(1)
  expect(s.session.savedSeq).toBe(failRename ? 0 : 1)
  expect(s.h.controller.isDirty(s.session)).toBe(true)
  if (failRename) expect(await fs.readFile(s.session.path!)).toEqual(s.original)
  else await s.h.controller.noteSaveCommitted(s.session, s.session.path!, s.session.fingerprint!)
  expect((await s.h.recovery.flush(s.session.sessionId)).state).toBe('written')
  const recovered = await s.h.recovery.readPersisted(s.session.sessionId)
  expect(recovered.ok && recovered.value.project.name).toBe('new edit')
})

it('S02 duplicate queued sequence is rejected clearly; it cannot replace the first queued edit', async () => {
  const s = await setup()
  const staging = stageRename(s.h, s.opened, 1, 'first user edit')
  const duplicate = await stageRename(s.h, s.opened, 1, 'duplicate must not win')
  expect(duplicate).toMatchObject({ ok: false, error: { code: 'STALE_EDIT' } })
  s.release(); await s.commit
  expect(await staging).toMatchObject({ ok: false, error: { code: 'STALE_EDIT' } })
  const recovered = await s.h.recovery.readPersisted(s.session.sessionId)
  expect(recovered.ok && recovered.value.project.name).toBe('first user edit')
})

it('S02 recovery exception is explicit, retains older recovery, blocks saving conflict and does not poison queue', async () => {
  const s = await setup()
  const staging = stageRename(s.h, s.opened, 1, 'new edit')
  vi.spyOn(s.h.recovery, 'stage').mockRejectedValueOnce(Error('recovery unavailable'))
  s.release(); expect((await s.commit).ok).toBe(true)
  expect(await staging).toMatchObject({ ok: false, error: { code: 'STALE_EDIT', detail: expect.stringContaining('恢复草稿写入失败') } })
  expect(s.session.snapshot.project.name).toBe('approved')
  expect(s.h.controller.isDirty(s.session)).toBe(true)
  const older = await s.h.recovery.readPersisted(s.session.sessionId)
  expect(older.ok && older.value.project.name).toBe(s.opened.snapshot.project.name)
  expect(await s.h.projectService.save(s.session.sessionId, { editSeq: 1, expectedFingerprint: s.session.fingerprint })).toMatchObject({ ok: false, error: { code: 'STALE_EDIT' } })
  expect((await stageRename(s.h, { ...s.opened, snapshot: s.session.snapshot }, 3, 'retry edit')).ok).toBe(true)
  expect((await s.h.recovery.flush(s.session.sessionId)).state).toBe('written')
  const recovered = await s.h.recovery.readPersisted(s.session.sessionId)
  expect(recovered.ok && recovered.value.project.name).toBe('retry edit')
})

it('S02 rejected task does not poison queue; save queued after close cannot write a stale session', async () => {
  const s = await setup()
  const rejected = s.h.projectService.transaction(s.session.sessionId, async () => { throw Error('injected task failure') })
  const checkedRejection = expect(rejected).rejects.toThrow('injected task failure')
  const closing = s.h.projectService.closeSession(s.session.sessionId)
  const saving = s.h.projectService.save(s.session.sessionId, { editSeq: 1, expectedFingerprint: s.session.fingerprint })
  s.release(); expect((await s.commit).ok).toBe(true)
  await checkedRejection; await closing
  expect(await saving).toMatchObject({ ok: false, error: { code: 'STALE_SESSION' } })
  expect(s.h.projectService.getSession(s.session.sessionId)).toBeNull()
})

it('S02 late old-revision DTO is not merged, is recoverable as a separate copy, and can be explicitly saved', async () => {
  const s = await setup(false, true)
  s.release(); expect((await s.commit).ok).toBe(true)
  expect(await stageRename(s.h, s.opened, 1, 'late user edit')).toMatchObject({ ok: false, error: { code: 'STALE_EDIT', detail: expect.stringContaining('恢复状态=written') } })
  expect(s.session.snapshot.project.currentRevisionId).toBe('approved-revision')
  expect(s.session.snapshot.project.name).toBe('approved')
  const recovered = await s.h.recovery.readPersisted(s.session.sessionId)
  expect(recovered.ok && recovered.value.project.currentRevisionId).toBe(s.opened.snapshot.project.currentRevisionId)
  expect(recovered.ok && recovered.value.project.name).toBe('late user edit')
  const listed = await s.h.recovery.list()
  if (!listed.ok) throw Error(listed.error.message)
  const restored = await s.h.invoke<ProjectOpenValue>(IPC_CHANNELS.recoveryRestore, { recoveryId: listed.value.items[0].recoveryId })
  if (!restored.ok) throw Error(restored.error.message)
  expect(restored.value.path).toBeNull()
  expect(restored.value.snapshot.project.name).toBe('late user edit')
  const saved = await s.h.projectService.saveAs(restored.value.sessionId, { editSeq: restored.value.editSeq, expectedFingerprint: null, targetPath: s.h.samplePath('recovered-copy.cunlian') })
  expect(saved.ok).toBe(true)
})
