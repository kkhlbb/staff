import { beforeEach, describe, expect, it, vi } from 'vitest'
import { calculateChain } from '../domain/calculate'
import { ChangeError, computeChange } from '../revisions/compute'
import { computeCandidateRequirementCheck, createRecomputedRequirementContext, type RequirementCheckInput } from './check'
import { commitRecomputedChange, type CommitRecomputedChangeInput } from './commit'
import { createRequirementProject, draftWithLength } from './__fixtures__/requirementFixture'

vi.mock('../revisions/compute', { spy: true })
vi.mock('../domain/calculate', { spy: true })

async function fixture() {
  const { snapshot } = await createRequirementProject({ target: { minQ: 2000, maxQ: 4000 } })
  const draft = draftWithLength(snapshot, '12.04')
  const checkInput: RequirementCheckInput = {
    snapshot, draft, requirementRevisions: snapshot.project.requirementRevisions,
    activeRequirementRevisionId: snapshot.project.activeRequirementRevisionId,
    pendingEdit: null, baseRevisionId: snapshot.project.currentRevisionId,
    baseGeneration: 0, acceptedSeq: 1, checkedAt: '2026-11-09T10:00:00.000Z',
    checkId: 'orchestration-check', inputIssue: null,
  }
  const preview = await computeCandidateRequirementCheck(checkInput)
  if (!preview.ok) throw new Error(preview.error.message)
  const input: CommitRecomputedChangeInput = {
    ...checkInput, draft, baseRevisionId: snapshot.project.currentRevisionId,
    baseGeneration: 0, acceptedSeq: 1, previewCheck: preview.value.check,
    revisionId: 'orchestration-revision', analysisSnapshotId: 'orchestration-analysis',
    reason: 'test', restoredFromRevisionId: null,
  }
  vi.clearAllMocks()
  return { input, checkInput }
}

function requirementCalculations() {
  return vi.mocked(calculateChain).mock.calls.filter(([chain]) =>
    chain.target?.minQ === 1000 && chain.target.maxQ === 3000)
}

beforeEach(() => vi.clearAllMocks())

describe('S12 bounded recomputation orchestration', () => {
  it('production commit computes from draft once and evaluates numeric requirement once', async () => {
    const { input } = await fixture()
    const result = await commitRecomputedChange(input)
    expect(result.ok).toBe(true)
    expect(computeChange).toHaveBeenCalledTimes(1)
    expect(requirementCalculations()).toHaveLength(1)
  })

  it('standalone check still computes independently, with one numeric verdict per call', async () => {
    const { checkInput } = await fixture()
    const result = await computeCandidateRequirementCheck(checkInput)
    expect(result.ok && result.value.check.status).toBe('satisfied')
    expect(computeChange).toHaveBeenCalledTimes(1)
    expect(requirementCalculations()).toHaveLength(1)
    await computeCandidateRequirementCheck(checkInput)
    expect(computeChange).toHaveBeenCalledTimes(2)
    expect(requirementCalculations()).toHaveLength(2)
  })

  it('every commit recomputes; forged extra computation/chain cannot authorize a changed draft', async () => {
    const { input } = await fixture()
    const first = await commitRecomputedChange(input)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    vi.clearAllMocks()
    const changed = {
      ...input, draft: draftWithLength(input.snapshot, '12.10'),
      computation: first.value.computation, chain: first.value.computation.chain,
      previewComputation: first.value.computation,
    }
    const second = await commitRecomputedChange(changed)
    expect(second.ok ? 'accepted' : second.error.code).toBe('STALE_PREVIEW')
    expect(computeChange).toHaveBeenCalledTimes(1)
    expect(requirementCalculations()).toHaveLength(0)
  })

  it('compute errors win over stale preview and missing requirement', async () => {
    const { input } = await fixture()
    const invalid = { ...input, activeRequirementRevisionId: 'missing', previewCheck: null,
      draft: { ...input.draft, parameters: [] } }
    const result = await commitRecomputedChange(invalid)
    expect(result.ok ? 'accepted' : result.error.code).toBe('INVALID_PARAMETER')
  })

  it('matching fingerprint with forged satisfied status cannot bypass fresh numeric rejection', async () => {
    const { input, checkInput } = await fixture()
    const draft = draftWithLength(input.snapshot, '12.10')
    const actual = await computeCandidateRequirementCheck({ ...checkInput, draft })
    if (!actual.ok) throw new Error(actual.error.message)
    const previewCheck = { ...actual.value.check, status: 'satisfied' as const,
      reasonCodes: ['WITHIN_REQUIREMENT' as const], margins: { lowerQ: 1, upperQ: 1 } }
    vi.clearAllMocks()
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await commitRecomputedChange({ ...input, draft, previewCheck })
      expect(result.ok ? 'accepted' : result.error.code).toBe('REQUIREMENT_NOT_SATISFIED')
    }
    expect(computeChange).toHaveBeenCalledTimes(2)
    expect(requirementCalculations()).toHaveLength(2)
  })

  it('context never takes externally supplied computation as check authority', async () => {
    const { input, checkInput } = await fixture()
    const context = createRecomputedRequirementContext({ ...checkInput, draft: input.draft }, {
      revisionId: input.revisionId, now: input.checkedAt,
    })
    for (const term of context.computation.chain.terms) term.nominalQ = 0
    const result = await context.computeCheck()
    expect(result.ok && result.value.check.resultInterval).toEqual({ minQ: 1100, maxQ: 2100 })
    const forged = { ...checkInput, draft: draftWithLength(input.snapshot, '12.10'),
      chain: context.computation.chain, computation: context.computation }
    const standalone = await computeCandidateRequirementCheck(forged)
    expect(standalone.ok && standalone.value.check.status).toBe('unsatisfied')
  })

  it('stale computation preview wins over a missing requirement, before check runs', async () => {
    const { input } = await fixture()
    const previewComputation = computeChange(input.snapshot, input.draft, {
      revisionId: input.revisionId, now: input.checkedAt,
    })
    vi.clearAllMocks()
    const result = await commitRecomputedChange({ ...input, previewComputation,
      activeRequirementRevisionId: 'missing', draft: draftWithLength(input.snapshot, '12.10') })
    expect(result.ok ? 'accepted' : result.error.code).toBe('STALE_PREVIEW')
    expect(requirementCalculations()).toHaveLength(0)
  })

  it('deps hooks retain their independent call and failure semantics', async () => {
    const { input } = await fixture()
    const compute = vi.fn((...args: Parameters<typeof computeChange>) => computeChange(...args))
    const check = vi.fn(computeCandidateRequirementCheck)
    expect((await commitRecomputedChange({ ...input, deps: { computeChange: compute, computeCheck: check } })).ok).toBe(true)
    expect(compute).toHaveBeenCalledTimes(1)
    expect(check).toHaveBeenCalledTimes(1)
    check.mockClear()
    compute.mockImplementationOnce(() => { throw new ChangeError('INVALID_BINDING', 'test failure') })
    const failed = await commitRecomputedChange({ ...input, deps: { computeChange: compute, computeCheck: check } })
    expect(failed.ok ? 'accepted' : failed.error.code).toBe('INVALID_BINDING')
    expect(check).not.toHaveBeenCalled()
  })
})
