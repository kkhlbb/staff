import { it, expect } from 'vitest'
import { nodeFileOps } from '../main/fileStore'
import { createHarness } from './helpers/a04'
import { RecoveryStore } from '../main/recovery'
import { nodeWorkspaceOps } from '../main/workspaceJson'

it('S01 recovery cleanup and a new recovery stage are serialized across async file removal', async () => {
  const h = await createHarness()
  let reached!: () => void
  let release!: () => void
  const deleting = new Promise<void>(r => { reached = r })
  const resume = new Promise<void>(r => { release = r })
  const store = new RecoveryStore({ rootDir: h.workspace, debounceMs: 60000, ops: { ...nodeWorkspaceOps, async remove(p) { if (p.endsWith('.cunlian')) { reached(); await resume } return nodeWorkspaceOps.remove(p) } } })
  try {
    const opened = await h.openSample()
    const session = h.projectService.getSession(opened.sessionId)!
    const meta = h.controller.recoveryMeta(session, session.snapshot)
    await store.stage(session.sessionId, session.snapshot, 1, meta)
    await store.flush(session.sessionId)
    const cleanup = store.discardSaved(session.sessionId, 1, () => true)
    await deleting
    const latest = { ...session.snapshot, project: { ...session.snapshot.project, name: 'after cleanup started' } }
    const staged = store.stage(session.sessionId, latest, 2, meta)
    release()
    await cleanup
    expect((await staged).state).toBe('pending')
    expect((await store.flush(session.sessionId)).state).toBe('written')
    const read = await store.readPersisted(session.sessionId)
    if (!read.ok) throw Error(read.error.message)
    expect(read.value.project.name).toBe('after cleanup started')
    await store.discard(session.sessionId)
  } finally { release(); await h.dispose() }
})

it('S01 successful save retains the newer staged recovery draft', async () => {
  let active = false
  let reached!: () => void
  let release!: () => void
  const barrier = new Promise<void>(r => { reached = r })
  const resume = new Promise<void>(r => { release = r })
  const h = await createHarness({ debounceMs: 60000, fileOps: { ...nodeFileOps, async rename(a,b) { if (active && b.endsWith('.cunlian')) { active = false; reached(); await resume } await nodeFileOps.rename(a,b) } } })
  try {
    const opened = await h.openSample()
    const session = h.projectService.getSession(opened.sessionId)!
    const before = session.snapshot
    expect((await h.projectService.stage(session.sessionId, 1, { ...before, project: { ...before.project, name: 'saved' } })).ok).toBe(true)
    await h.recovery.stage(session.sessionId, session.snapshot, 1, h.controller.recoveryMeta(session, session.snapshot))
    active = true
    const saving = h.controller.saveSession(session)
    await barrier
    const staging = h.projectService.stage(session.sessionId, 2, { ...before, project: { ...before.project, name: 'new recovery' } })
    release()
    expect((await staging).ok).toBe(true)
    await h.recovery.stage(session.sessionId, session.snapshot, 2, h.controller.recoveryMeta(session, session.snapshot))
    expect((await saving).ok).toBe(true)
    expect(h.recovery.stateOf(session.sessionId)).not.toBe('none')
    expect((await h.recovery.flush(session.sessionId)).state).toBe('written')
    const persisted = await h.recovery.readPersisted(session.sessionId)
    if (!persisted.ok) throw Error(persisted.error.message)
    expect(persisted.value.project.name).toBe('new recovery')
  } finally { release(); await h.dispose() }
})
