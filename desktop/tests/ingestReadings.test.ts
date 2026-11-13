// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createSampleSnapshot } from '../../src/project-file/__fixtures__/sampleProjectFile'
import { ingestIntoSnapshot } from '../main/ingestReadings'
import { AgentToolService } from '../main/agentToolService'
import { ApprovalStore } from '../main/approvalStore'
import { createHarness } from './helpers/a04'
import { decodeProjectFile, encodeProjectFile } from '../../src/project-file/codec'
const fixture = async () => {
  const snapshot = await createSampleSnapshot()
  snapshot.project.actorId = '读数人'
  snapshot.project.sessionSeq = 1
  const revision = snapshot.revisions[0]!
  const args = { projectId: snapshot.project.id,
    source: { kind: 'pdf-page', revisionId: revision.id, sha256: revision.sha256, page: 1 },
    statement: '用户报数L1 30，0/-0.2 mm',
    readings: [{ kind: 'dimension', symbol: 'L1', nominalQ: 300000, upperDeviationQ: 0, lowerDeviationQ: -2000, unit: 'mm' }] }
  const context = { userText: args.statement, turnId: 'read-turn', at: '2026-11-13T12:00:00.000Z' }
  return { snapshot, args, context }
}
describe('桌面读数入口', () => {
  it('真实run串行写入恢复草稿，响应核对标记，项目容器可往返且无pdf-text伪装', async () => {
    const h = await createHarness({ debounceMs: 60000 })
    try {
      const { snapshot, args, context } = await fixture()
      const opened = await h.openSample(snapshot)
      const session = h.projectService.getSession(opened.sessionId)!
      const service = new AgentToolService({ controller: h.controller, projectService: h.projectService,
        recovery: h.recovery, rootDir: h.workspace, approvals: new ApprovalStore({ rootDir: h.workspace }) })
      const result = await service.run(1, 'ingest_readings', args, context)
      expect(result).toMatchObject({ ok: true, data: { status: 'pending', requiresVerification: true, batchConfirmable: false } })
      const draft = session.snapshot.project.extractionDrafts.find((d) => d.candidates.some((c) => c.provenance?.some((r) => r.kind === 'agent-read')))!
      expect(draft).toBeDefined()
      const encoded = await encodeProjectFile(session.snapshot)
      expect(encoded.ok, JSON.stringify(encoded)).toBe(true)
      if (!encoded.ok) return
      const decoded = await decodeProjectFile(encoded.value.bytes)
      expect(decoded.ok).toBe(true)
      if (!decoded.ok) return
      const reopened = decoded.value.snapshot.project.extractionDrafts.find((d) => d.draftId === draft.draftId)!
      expect(reopened.candidates[0]).toMatchObject({ requiresVerification: true, batchConfirmable: false, evidence: [],
        provenance: [{ kind: 'agent-read', actorId: '读数人', modelId: null, statement: args.statement }] })
    } finally { await h.dispose() }
  })
  it.each(['project', 'revision', 'hash', 'page', 'identity', 'statement', 'image', 'actorOverride', 'fraction'])(
    '%s 输入错误原子拒绝，不写项目', async (kind) => {
      const { snapshot, args, context } = await fixture()
      let payload: unknown = args
      switch (kind) {
        case 'project': payload = { ...args, projectId: 'other' }; break
        case 'revision': payload = { ...args, source: { ...args.source, revisionId: 'other' } }; break
        case 'hash': payload = { ...args, source: { ...args.source, sha256: 'b'.repeat(64) } }; break
        case 'page': payload = { ...args, source: { ...args.source, page: 9999 } }; break
        case 'identity': snapshot.project.actorId = null; break
        case 'statement': context.userText = '别的话'; break
        case 'image': payload = { ...args, source: { kind: 'image', imageId: 'i', sha256: 'b'.repeat(64) } }; break
        case 'actorOverride': payload = { ...args, actorId: '伪造身份' }; break
        case 'fraction': payload = { ...args, readings: [{ ...args.readings[0], nominalQ: 1.5 }] }; break
      }
      const before = JSON.stringify(snapshot)
      expect(ingestIntoSnapshot(snapshot, payload, context).ok).toBe(false)
      expect(JSON.stringify(snapshot)).toBe(before)
    })
})
