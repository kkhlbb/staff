import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { CunlianApi } from '../shared/contracts'
import type { M1WorkbenchBridge } from '../../src/workspace/project-agent/m1WorkbenchBridge'
import type { M2WorkbenchBridge } from '../../src/workspace/project-agent/m2WorkbenchBridge'
import type { M3WorkbenchBridge } from '../../src/workspace/project-agent/m3WorkbenchBridge'
import { TOOLS } from '../../mcp/tools/index'
import { runCalcChain } from '../../mcp/tools/calc-chain'
import { runCheckRequirement } from '../../mcp/tools/check-requirement'
import { parseMm } from '../../src/domain/units'
import { decodeProjectFile } from '../../src/project-file/codec'

it('keeps the production preload assignable to all three renderer bridge contracts', () => {
  expectTypeOf<CunlianApi>().toExtend<Required<M1WorkbenchBridge & M2WorkbenchBridge & M3WorkbenchBridge>>()
})

const fixtureRoot = 'docs/evidence/V3.5-draft-sync/fixtures'
const fixtures = [
  ['src/project-file/__fixtures__/b1-project-v1.cunlian', 'a002ef2bf6e56693b6e7f0689b8e995857468fe6382542b96725a8e4a51054ce', 'rev-a1', 120_000, 120_000],
  [fixtureRoot + '/baseline.cunlian', '6699fd19073a40c0c8dc42abd2fe1c27a2f7b7ccf8b7d11d29f8b7ea2818e74f', 'rev-req-3b265652-80ee-4636-8f85-3477ccbdf169', 120_000, 120_000],
  [fixtureRoot + '/legacy-stale.cunlian', '024df419014bbdcbfc081f24b4c91be65833f8bda047941cb1fe70b04d32a941', 'rev-d-b21ba155-9372-4f1b-b4d8-cff97bfc6376', 120_500, 120_000],
  [fixtureRoot + '/old-baseline.cunlian', '50f74124e2b2ef396d1df615e57e69452fdd98d591ff54466a0d1d2c2cd91ef2', 'rev-a1', 120_000, 120_000],
  [fixtureRoot + '/ui-session.cunlian', 'bd3117125ee892eedeee1435a55f83febeb76373cc117192950d686f48b7a0c3', 'rev-d-cc0a10d5-870e-4ad1-9102-a36c993cae67', 120_500, 120_500],
  ['docs/evidence/display-3dp/fixtures/saved-after-12.05-copy.cunlian', '024df419014bbdcbfc081f24b4c91be65833f8bda047941cb1fe70b04d32a941', 'rev-d-b21ba155-9372-4f1b-b4d8-cff97bfc6376', 120_500, 120_000],
] as const

describe('M0 legacy compatibility', () => {
  it('keeps the five registered names, parameter keys and dimension encodings', () => {
    const definitions = TOOLS.map(({ definition }) => definition)
    expect(definitions.map(({ name, inputSchema }) => [
      name, Object.keys(inputSchema.properties as object).sort(),
    ])).toEqual([
      ['read_taskbook', ['pageFrom', 'pageTo', 'pdfPath']],
      ['calc_chain', ['assumptions', 'formula', 'parameters', 'target', 'terms']],
      ['check_requirement', ['cMaxQ', 'cQ', 'inclusive', 'lowerQ', 'note', 'upperQ']],
      ['render_drawing', ['dxfVersion', 'format', 'outputDir', 'parameters']],
      ['describe_project', ['path']],
    ])
    const calc = definitions[1].inputSchema
    expect(calc).toMatchObject({ properties: {
      parameters: { properties: {
        innerDiameterQ: { type: 'integer' }, outerDiameterQ: { type: 'integer' }, lengthQ: { type: 'integer' },
      } },
      terms: { items: { properties: {
        nominalQ: { type: 'integer' }, lowerDeviationQ: { type: 'integer' }, upperDeviationQ: { type: 'integer' },
      } } },
    } })
    expect(definitions[2].inputSchema).toMatchObject({ properties: {
      cQ: { type: 'integer' }, cMaxQ: { type: 'integer' }, lowerQ: { type: 'integer' }, upperQ: { type: 'integer' },
    } })
    expect(definitions[3].inputSchema).toMatchObject({ properties: { parameters: { properties: {
      innerDiameter: { type: 'string' }, outerDiameter: { type: 'string' }, length: { type: 'string' },
    } } } })
  })

  it.each(fixtures)('decodes %s with its independent draft', async (path, sha, revision, formalQ, draftQ) => {
    const bytes = await readFile(path)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha)
    const decoded = await decodeProjectFile(bytes)
    if (!decoded.ok) throw new Error(decoded.error.message)
    const { project, draft } = decoded.value.snapshot
    expect(project.currentRevisionId).toBe(revision)
    expect(project.dimensionChain.terms.find((term) => term.id === 't-s')?.nominalQ).toBe(formalQ)
    const length = draft?.terms.find((term) => term.id === 't-s')?.nominal
    expect(length).toBeDefined()
    expect(parseMm(length!)).toBe(draftQ)
  })

  it.each([
    ['12.00', 1500, 2500, 'satisfied', 500],
    ['12.04', 1100, 2100, 'satisfied', 100],
    ['12.10', 500, 1500, 'exceeded', -500],
    ['12.05', 1000, 2000, 'satisfied', 0],
  ] as const)('retains the %s mm A10 verdict', async (length, minQ, maxQ, status, marginQ) => {
    const calc = await runCalcChain({ parameters: {
      innerDiameterQ: 200_000, outerDiameterQ: 320_000, lengthQ: parseMm(length),
    } })
    expect(calc.result).toMatchObject({ minQ, maxQ })
    const interval = calc.result as { minQ: number; maxQ: number }
    const check = await runCheckRequirement({
      cQ: interval.minQ, cMaxQ: interval.maxQ, lowerQ: 1000, upperQ: 3000, inclusive: true,
    })
    expect(check).toMatchObject({ status, margins: { marginQ } })
  })
})
