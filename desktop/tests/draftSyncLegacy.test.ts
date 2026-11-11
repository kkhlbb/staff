import { promises as fs } from 'node:fs'
import { it, expect } from 'vitest'
import { decodeProjectFile, encodeProjectFile } from '../../src/project-file/codec'
import { officialDraft, resolveDraft } from '../../src/workspace/draftSync'
import { calculateChain } from '../../src/domain/calculate'
import { serializeEvidence } from '../../scripts/evidence-json'

it('FIX-05/09: actual independent legacy file and frozen references; prepare isolated UI seed', async () => {
  const original = new Uint8Array(await fs.readFile('docs/evidence/V3.5-draft-sync/fixtures/legacy-stale.cunlian'))
  const decoded = await decodeProjectFile(original)
  if (!decoded.ok) throw new Error(decoded.error.message)
  const snapshot = decoded.value.snapshot
  const before = structuredClone(snapshot)
  const resolved = resolveDraft(snapshot)
  expect(resolved.kind).toBe('stale-mirror')
  expect(resolved.message).toBe('旧草稿（关系版本 1）已由正式版本 3 取代')
  expect(snapshot).toEqual(before)
  const old = snapshot.fileRevisions.find(x => x.project.schemaVersion === 8 && x.project.parameters.find(p => p.key === 'length')?.valueQ === 120000 && x.project.activeRequirementRevisionId != null)!
  expect(old).toBeDefined()
  if (old.project.schemaVersion !== 8) throw new Error('UI seed requires schema8 historical project')
  const seed = { ...snapshot, project: old.project, draft: officialDraft(old.project.dimensionChain, old.project.relationRevision), fileRevisions: snapshot.fileRevisions.slice(0, snapshot.fileRevisions.indexOf(old) + 1) }
  const encoded = await encodeProjectFile(seed)
  if (!encoded.ok) throw new Error(encoded.error.message)
  expect(calculateChain(old.project.dimensionChain)).toMatchObject({ minQ: 1500, maxQ: 2500 })
  if (process.env.DRAFT_SYNC_RECORD === '1') {
    await fs.mkdir('docs/evidence/V3.5-draft-sync/fixtures', { recursive: true })
    await fs.writeFile('docs/evidence/V3.5-draft-sync/fixtures/baseline.cunlian', encoded.value.bytes)
    await fs.writeFile('docs/evidence/V3.5-draft-sync/legacy.json', serializeEvidence({ message: resolved.message, formalQ: snapshot.project.dimensionChain.terms.find(x => x.id === 't-s')?.nominalQ, storedDraft: snapshot.draft, effectiveDraft: resolved.draft, originalResult: calculateChain(old.project.dimensionChain), oldReports: snapshot.analysisSnapshots.map(x => ({ id: x.id, result: x.result, sourceManifest: x.sourceManifest })), source: old.project.requirementRevisions[0]?.source }))
  }
})
