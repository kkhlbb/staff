// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { createSpacerSnapshot, spacerParameters } from '../project-file/__fixtures__/spacerProjectFile'
import { computeChange } from '../revisions/compute'
import { buildCommitCandidate } from '../revisions/commit'
import { calculateChain } from '../domain/calculate'
import { draftToChain, workspaceReducer } from './draft'
import { officialDraft, resolveDraft } from './draftSync'
import { DesktopChainView } from '../components/DesktopSessionViews'
import type { ProjectFileSnapshot } from '../project-file/types'
import { encodeProjectFile, decodeProjectFile } from '../project-file/codec'

const now = '2026-11-10T12:00:00.000Z'
function commit(base: ProjectFileSnapshot, length: string) {
  const revisionId = `rev-${length}`
  const computation = computeChange(base, {
    parameters: spacerParameters({ length }, 2),
    bindings: base.project.dimensionLinks.filter(x => x.kind === 'parameter-binding'),
  }, { revisionId, now })
  return buildCommitCandidate(base, computation, { revisionId, analysisSnapshotId: `analysis-${length}`, createdAt: now, reason: 'draft sync regression', restoredFromRevisionId: null, reauthenticateBindings: false }).snapshot
}
function assertViews(snapshot: ProjectFileSnapshot, q: number, min: number, max: number) {
  expect(snapshot.project.dimensionChain.terms.find(x => x.id === 't-s')?.nominalQ).toBe(q)
  const parsed = draftToChain(snapshot.draft!)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) throw new Error('invalid draft')
  expect(parsed.chain.terms.find(x => x.id === 't-s')?.nominalQ).toBe(q)
  expect(snapshot.draft!.relationRevision).toBe(snapshot.project.relationRevision)
  expect(calculateChain(parsed.chain)).toMatchObject({ minQ: min, maxQ: max })
  render(<DesktopChainView snapshot={snapshot} edit={vi.fn()} disabled={false} />)
  expect(screen.getByRole('region', { name: '当前计算结果' }).textContent).toContain(`${(min / 10000).toFixed(3)} 至 ${(max / 10000).toFixed(3)}`)
  expect(screen.getByRole('textbox', { name: /S 基本尺寸/ })).toHaveValue((q / 10000).toFixed(3))
  cleanup()
}
afterEach(cleanup)
describe('V3.5 draft sync', () => {
  it.each([
    ['FIX-01', '12.04', 120400, 1100, 2100],
    ['FIX-03', '12.05', 120500, 1000, 2000],
  ] as const)('%s: top-level draft, official chain and visible calculation', async (_id, length, q, min, max) => {
    assertViews(commit(await createSpacerSnapshot(), length), q, min, max)
  })
  it('FIX-01/03: sequential commits update top-level draft, official chain and visible calculation', async () => {
    const base = await createSpacerSnapshot()
    const original = structuredClone(base)
    const first = commit(base, '12.04')
    assertViews(first, 120400, 1100, 2100)
    const second = commit(first, '12.05')
    assertViews(second, 120500, 1000, 2000)
    expect(base).toEqual(original)
    expect(second.analysisSnapshots.slice(0, first.analysisSnapshots.length)).toEqual(first.analysisSnapshots)
    expect(second.fileRevisions.slice(0, first.fileRevisions.length)).toEqual(first.fileRevisions)
  })
  it('FIX-04: encode/decode preserves synced inputs and historical references', async () => {
    const saved = commit(await createSpacerSnapshot(), '12.05')
    const encoded = await encodeProjectFile(saved)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) throw new Error(encoded.error.message)
    const decoded = await decodeProjectFile(encoded.value.bytes)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) throw new Error(decoded.error.message)
    assertViews(decoded.value.snapshot, 120500, 1000, 2000)
    expect(decoded.value.snapshot.bindings).toEqual(saved.bindings)
    expect(decoded.value.snapshot.analysisSnapshots).toEqual(saved.analysisSnapshots)
  })
  it('FIX-05: proven historical mirror uses official values without changing archive', async () => {
    const base = await createSpacerSnapshot()
    base.draft = officialDraft(base.project.dimensionChain, base.project.relationRevision)
    const next = commit(base, '12.05')
    next.draft = base.draft
    const before = structuredClone(next)
    expect(resolveDraft(next).kind).toBe('stale-mirror')
    render(<DesktopChainView snapshot={next} edit={vi.fn()} disabled={false} />)
    expect(screen.getByText(/旧草稿.*已由正式版本/)).toBeVisible()
    expect(screen.getByRole('region', { name: '当前计算结果' })).toHaveTextContent('0.100 至 0.200')
    expect(next).toEqual(before)
  })
  it('FIX-06: real numeric/invalid/structural/target edits survive, with original basis', async () => {
    for (const action of [
      { type: 'updateField', termId: 't-h', field: 'nominal', value: '52.01' },
      { type: 'updateField', termId: 't-h', field: 'nominal', value: 'oops' },
      { type: 'removeTerm', termId: 't-h' },
      { type: 'setTarget', targetMin: '0.2', targetMax: '0.3' },
    ] as const) {
      const base = await createSpacerSnapshot()
      base.draft = workspaceReducer(officialDraft(base.project.dimensionChain, base.project.relationRevision), action)
      const input = structuredClone(base.draft)
      const next = commit(base, '12.05')
      expect(next.draft).toEqual({ ...input, basisRelationRevision: input.relationRevision })
      expect(resolveDraft(next).kind).toBe('edited')
      const edit = vi.fn()
      render(<DesktopChainView snapshot={next} edit={edit} disabled={false} />)
      expect(screen.getByText(/草稿基于关系版本/)).toBeVisible()
      fireEvent.click(screen.getByRole('button', { name: '保留我的编辑' }))
      expect(edit).toHaveBeenCalledWith({ type: 'replaceDraft', draft: next.draft })
      cleanup()
      const encoded = await encodeProjectFile(next)
      expect(encoded.ok).toBe(true)
      if (!encoded.ok) throw new Error(encoded.error.message)
      const decoded = await decodeProjectFile(encoded.value.bytes)
      expect(decoded.ok).toBe(true)
      if (decoded.ok) expect(decoded.value.snapshot.draft).toEqual(next.draft)
    }
  })
  it('FIX-06: reset requires explicit confirmation; cancel and keep preserve every field', async () => {
    const base = await createSpacerSnapshot()
    base.draft = { ...officialDraft(base.project.dimensionChain, base.project.relationRevision), basisRelationRevision: base.project.relationRevision, assumptions: 'keep me' }
    const next = commit(base, '12.05')
    const edit = vi.fn()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<DesktopChainView snapshot={next} edit={edit} disabled={false} />)
    fireEvent.click(screen.getByRole('button', { name: '按正式重算' }))
    expect(edit).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: '按正式重算' }))
    expect(edit).toHaveBeenCalledWith({ type: 'replaceDraft', draft: officialDraft(next.project.dimensionChain, next.project.relationRevision) })
    confirm.mockRestore()
  })
  it('unknown legacy numeric edits are not overwritten merely because structure matches', async () => {
    const base = await createSpacerSnapshot()
    base.draft = officialDraft(base.project.dimensionChain, 0)
    base.draft.terms[0]!.nominal = '99.0000'
    expect(resolveDraft(base).kind).toBe('edited')
  })
})
