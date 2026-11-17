import { promises as fs } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createHarness, failingWriteOps } from './helpers/a04'
import { ChangeService } from '../main/changeService'
import { createSpacerSnapshot } from '../../src/project-file/__fixtures__/spacerProjectFile'
import { createRequirementProject } from '../../src/requirements/__fixtures__/requirementFixture'
import { officialDraft, resolveDraft } from '../../src/workspace/draftSync'
import { DesktopChainView } from '../../src/components/DesktopSessionViews'
import { calculateChain } from '../../src/domain/calculate'
import { draftToChain } from '../../src/workspace/draft'
import type { ProjectFileSnapshot } from '../../src/project-file/types'

function visible(snapshot: ProjectFileSnapshot) {
  return renderToStaticMarkup(createElement(DesktopChainView, { snapshot, edit: () => {}, disabled: false }))
}
async function setup(fail: boolean, requirement = false) {
  const h = await createHarness(fail ? { fileOps: failingWriteOps('ENOSPC') } : {})
  const snapshot = requirement ? (await createRequirementProject({ target: { minQ: 1800, maxQ: 3000 } })).snapshot : await createSpacerSnapshot({ confirmed: true })
  snapshot.draft = officialDraft(snapshot.project.dimensionChain, snapshot.project.relationRevision)
  const opened = await h.openSample(snapshot, 'draft-sync-main')
  let id = 0
  const service = new ChangeService({ projectService: h.projectService, recovery: h.recovery, controller: h.controller, now: () => new Date('2026-11-10T00:00:00.000Z'), newId: () => `sync-${++id}` })
  return { h, service, opened }
}
async function change(ctx: Awaited<ReturnType<typeof setup>>, length: string) {
  const { h, opened, service } = ctx
  const sessionId = opened.sessionId
  const current = h.projectService.getSession(sessionId)!
  const d = await service.stage(sessionId, { sessionId, baseEditSeq: current.acceptedSeq, inputs: { innerDiameter: '20.00', outerDiameter: '32.00', length }, reason: 'regression' })
  if (!d.ok) throw new Error(d.error.message)
  const p = await service.preview(sessionId, d.value.baseToken, d.value.draftToken)
  if (!p.ok) throw new Error(p.error.message)
  const result = await service.apply({ sessionId, baseToken: d.value.baseToken, draftToken: d.value.draftToken, previewId: p.value.previewId, previewToken: p.value.previewToken, requestId: `request-${length}`, reason: 'regression' })
  return { result, preview: p.value }
}

describe('FIX-06/07/08 main transactions with rendered calculation', () => {
  it('FIX-06: independent editing survives a successful commit and can be reopened from disk', async () => {
    const ctx = await setup(false)
    try {
      const session = ctx.h.projectService.getSession(ctx.opened.sessionId)!
      const basis = session.snapshot.project.relationRevision
      const draft = { ...session.snapshot.draft!, basisRelationRevision: basis, assumptions: 'my uncommitted input' }
      expect((await ctx.h.projectService.stage(session.sessionId, 1, { ...session.snapshot, draft })).ok).toBe(true)
      const { result } = await change(ctx, '12.05')
      expect(result.ok).toBe(true)
      const after = ctx.h.projectService.getSession(session.sessionId)!.snapshot
      expect(after.project.dimensionChain.terms.find(x => x.id === 't-s')?.nominalQ).toBe(120500)
      expect(after.draft).toEqual(draft)
      expect(resolveDraft(after).kind).toBe('edited')
      const html = visible(after)
      expect(html).toContain('0.150 至 0.250')
      expect(html).toContain(`草稿基于关系版本 ${basis}，正式已是 ${after.project.relationRevision}`)
      const reopened = await ctx.h.projectService.openFile(ctx.opened.path!)
      if (!reopened.ok) throw new Error(reopened.error.message)
      const restored = ctx.h.projectService.getSession(reopened.value.sessionId)!.snapshot
      expect(restored.draft).toEqual(draft)
      expect(visible(restored)).toContain('0.150 至 0.250')
    } finally { await ctx.h.dispose() }
  })
  it('FIX-07: failed commit and failed save preserve official data, frozen history and invalid user input', async () => {
    const ctx = await setup(true)
    try {
      const session = ctx.h.projectService.getSession(ctx.opened.sessionId)!
      const draft = structuredClone(session.snapshot.draft!)
      draft.basisRelationRevision = session.snapshot.project.relationRevision
      draft.terms[0]!.nominal = 'invalid-kept'
      expect((await ctx.h.projectService.stage(session.sessionId, 1, { ...session.snapshot, draft })).ok).toBe(true)
      const original = structuredClone(session.snapshot)
      const disk = await fs.readFile(ctx.opened.path!)
      const { result } = await change(ctx, '12.05')
      expect(result.ok).toBe(false)
      expect(session.snapshot).toEqual(original)
      expect(session.snapshot.draft!.terms[0]!.nominal).toBe('invalid-kept')
      expect(session.snapshot.project.dimensionChain.terms.find(x => x.id === 't-s')?.nominalQ).toBe(120000)
      expect(visible(session.snapshot)).toContain('输入无效，当前结果不可用')
      const saved = await ctx.h.projectService.save(session.sessionId, { editSeq: session.acceptedSeq, expectedFingerprint: session.fingerprint })
      expect(saved.ok).toBe(false)
      expect(session.snapshot).toEqual(original)
      expect(await fs.readFile(ctx.opened.path!)).toEqual(disk)
      expect(visible(session.snapshot)).toContain('invalid-kept')
    } finally { await ctx.h.dispose() }
  })
  it('FIX-08: original target outside while taskbook satisfied; both use committed 12.05', async () => {
    const ctx = await setup(false, true)
    try {
      const { result } = await change(ctx, '12.05')
      expect(result.ok).toBe(true)
      const s = ctx.h.projectService.getSession(ctx.opened.sessionId)!.snapshot
      expect(s.project.dimensionChain.terms.find(x => x.id === 't-s')?.nominalQ).toBe(120500)
      const parsed = draftToChain(s.draft!)
      if (!parsed.ok) throw new Error('invalid draft')
      expect(parsed.chain.terms.find(x => x.id === 't-s')?.nominalQ).toBe(120500)
      expect(calculateChain(parsed.chain)).toMatchObject({ status: 'outside', minQ: 1000, maxQ: 2000 })
      expect(s.project.currentRequirementCheck).toMatchObject({ status: 'satisfied', resultInterval: { minQ: 1000, maxQ: 2000 } })
      expect(visible(s)).toContain('超出目标')
      expect(visible(s)).toContain('0.100 至 0.200')
      expect(s.project.dimensionChain.target).toEqual({ minQ: 1800, maxQ: 3000 })
    } finally { await ctx.h.dispose() }
  })
})
