import { describe, expect, it } from 'vitest'
import { createSpacerSnapshot } from '../project-file/__fixtures__/spacerProjectFile'
import { SPACER_PART_ID } from '../drawing/types'
import type { ProjectFileSpacerParameter } from '../project-file/types'
import { geometryFingerprint, inputFingerprint, selectSpacerStepInput, selectSpacerStepInputFromSnapshot } from './selectSpacerStepInput'

async function fixture() {
  const snapshot = await createSpacerSnapshot({ length: '12.0001', confirmed: true })
  const revision = snapshot.fileRevisions[0]
  revision.project = structuredClone(revision.project)
  revision.project.parameters = structuredClone(snapshot.project.parameters).map(p => ({ ...p, reviewStatus: 'confirmed' }))
  return { snapshot, revision }
}

describe('STEP frozen historical input', () => {
  it('uses selected historical q, never current or draft; freezes a detached input without backfill', async () => {
    const { snapshot, revision } = await fixture()
    const before = JSON.stringify(revision)
    snapshot.project.parameters.find(p => p.key === 'length')!.valueQ = 999999
    const input = selectSpacerStepInputFromSnapshot(snapshot, revision.revisionId, SPACER_PART_ID)
    expect(input.lengthQ).toBe(120001)
    expect(input.fileStatus).toBe('historical-frozen')
    expect(input.historicalByteIdentical).toBeNull()
    expect(Object.isFrozen(input)).toBe(true)
    expect(Object.isFrozen(input.parameters)).toBe(true)
    expect(JSON.stringify(revision)).toBe(before)
  })
  it('separates geometry from version/review/source identity; omits private materials', async () => {
    const { revision } = await fixture()
    const first = selectSpacerStepInput(revision, SPACER_PART_ID)
    const parameter = revision.project.parameters[0] as ProjectFileSpacerParameter
    parameter.sourceNote = '私人材料 李某'
    parameter.reviewStatus = 'pending'
    const next = selectSpacerStepInput(revision, SPACER_PART_ID)
    expect(next.geometryFingerprint).toBe(first.geometryFingerprint)
    expect(next.inputFingerprint).not.toBe(first.inputFingerprint)
    expect(JSON.stringify(next)).not.toContain('私人材料')
    parameter.valueQ += 1
    expect(selectSpacerStepInput(revision, SPACER_PART_ID).geometryFingerprint).not.toBe(first.geometryFingerprint)
  })
  it('normalizes parameter order without substituting q or half-q diameters', async () => {
    const { revision } = await fixture()
    const parameter = revision.project.parameters[0] as ProjectFileSpacerParameter
    parameter.valueQ = 200001
    const first = selectSpacerStepInput(revision, SPACER_PART_ID)
    revision.project.parameters.reverse()
    expect(selectSpacerStepInput(revision, SPACER_PART_ID)).toEqual(first)
    expect(first.innerDiameterQ).toBe(200001)
    expect(geometryFingerprint(first)).toBe(first.geometryFingerprint)
    expect(inputFingerprint(first)).toBe(first.inputFingerprint)
  })
  it('tracks revision and user-input source identity without changing nominal geometry', async () => {
    const { revision } = await fixture()
    const first = selectSpacerStepInput(revision, SPACER_PART_ID)
    revision.revisionId = 'another-history'
    revision.project.currentRevisionId = revision.revisionId
    const second = selectSpacerStepInput(revision, SPACER_PART_ID)
    expect(second.geometryFingerprint).toBe(first.geometryFingerprint)
    expect(second.inputFingerprint).not.toBe(first.inputFingerprint)
    if ('sourceKind' in revision.project) revision.project.sourceKind = 'user-intent'
    const third = selectSpacerStepInput(revision, SPACER_PART_ID)
    expect(third.source.kind).toBe('user-intent')
    expect(third.inputFingerprint).not.toBe(second.inputFingerprint)
    expect(third.geometryFingerprint).toBe(second.geometryFingerprint)
  })
  it('does not alter manufacturing tolerance, drawing scale or private frame identity', async () => {
    const { revision } = await fixture()
    const before = selectSpacerStepInput(revision, SPACER_PART_ID)
    revision.project.dimensionChain.terms[0].upperDeviationQ += 10
    revision.project.drawings = []
    expect(selectSpacerStepInput(revision, SPACER_PART_ID)).toEqual(before)
  })
  it('rejects unselected revision, unknown revision/part and a draft masquerading as revision', async () => {
    const { snapshot, revision } = await fixture()
    for (const id of ['', 'draft-id']) expect(() => selectSpacerStepInputFromSnapshot(snapshot, id, SPACER_PART_ID)).toThrow(/正式历史版本/)
    expect(() => selectSpacerStepInput(revision, 'other')).toThrow(/隔套/)
    revision.project.currentRevisionId = 'draft-id'
    expect(() => selectSpacerStepInput(revision, SPACER_PART_ID)).toThrow(/正式历史版本/)
  })
  it.each(['missing', 'duplicate', 'extra', 'id', 'part', 'fraction', 'unsafe', 'zero', 'negative', 'nan', 'infinity', 'range', 'equal', 'draft', 'parameterRevision'])(
    'rejects malformed historical input: %s', async mutation => {
      const { revision } = await fixture()
      const parameters = revision.project.parameters as ProjectFileSpacerParameter[]
      if (mutation === 'missing') parameters.pop()
      if (mutation === 'duplicate') parameters[1] = structuredClone(parameters[0])
      if (mutation === 'extra') parameters.push(structuredClone(parameters[0]))
      if (mutation === 'id') parameters[0].parameterId = 'wrong'
      if (mutation === 'part') parameters[0].partId = 'wrong'
      if (mutation === 'fraction') parameters[0].valueQ = 1.5
      if (mutation === 'unsafe') parameters[0].valueQ = Number.MAX_SAFE_INTEGER + 1
      if (mutation === 'zero') parameters[0].valueQ = 0
      if (mutation === 'negative') parameters[0].valueQ = -1
      if (mutation === 'nan') parameters[0].valueQ = NaN
      if (mutation === 'infinity') parameters[0].valueQ = Infinity
      if (mutation === 'range') parameters[0].valueQ = 1_000_000_000_000_000
      if (mutation === 'equal') parameters[1].valueQ = parameters[0].valueQ
      if (mutation === 'draft') parameters[0].reviewStatus = 'draft'
      if (mutation === 'parameterRevision') parameters[0].parameterRevision = 0
      expect(() => selectSpacerStepInput(revision, SPACER_PART_ID)).toThrow()
    },
  )
})
