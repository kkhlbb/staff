// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { TOOLS } from '../../mcp/tools'
import { M1_LOCAL_OPERATIONS } from '../../desktop/main/project-agent/m1LocalTransport'
import mcp from '../../cloud/contracts/mcp-tools.json'
import rest from '../../cloud/contracts/openapi.json'
import flags from '../../cloud/contracts/feature-flags.schema.json'
import { FEATURE_3D_ASSEMBLY_M1 } from '../transport'
import { assemblyModelV1Schema } from './assembly3d'
import { provenanceRefSchema } from './validation'

// TypeScript widens enum/type literals when importing JSON. The tests exercise the actual schemas.
const fromJson = (schema: unknown) => z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0])

const fixture = (relative: string) => fileURLToPath(new URL(`../../${relative}`, import.meta.url))

describe('Cloud contract freeze', () => {
  it('publishes the same five stdio tool names and input schemas and ten local bridge operations', () => {
    expect(mcp.tools.slice(0, TOOLS.length).map(tool => tool.name)).toEqual(TOOLS.map(tool => tool.definition.name))
    expect(mcp.tools.slice(TOOLS.length).map(tool => tool.name).sort()).toEqual([...M1_LOCAL_OPERATIONS].sort())
    for (const [index, tool] of TOOLS.entries()) {
      expect(mcp.tools[index].inputSchema).toEqual(tool.definition.inputSchema)
    }
    for (const tool of mcp.tools) {
      expect(tool.outputSchema.type).toBe('object')
      expect(() => fromJson(tool.inputSchema)).not.toThrow()
      expect(() => fromJson(tool.outputSchema)).not.toThrow()
    }
  })

  it('validates actual structured outputs for the five stdio tools', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'cunlian-contract-'))
    try {
      const args = [
        { pdfPath: fixture('docs/evidence/V3.5/fixtures/taskbook-2p.pdf'), pageFrom: 1, pageTo: 2 },
        { parameters: { innerDiameterQ: 200000, outerDiameterQ: 320000, lengthQ: 120000 } },
        { cQ: 1500, lowerQ: 1000, upperQ: 3000 },
        { parameters: { innerDiameter: '20.00', outerDiameter: '32.00', length: '12.00' }, format: 'svg', outputDir },
        { path: fixture('docs/evidence/v40-stage4/fixtures/a40-1204.cunlian') },
      ]
      for (const [index, tool] of TOOLS.entries()) {
        const contract = mcp.tools[index]
        expect(fromJson(contract.inputSchema).safeParse(args[index]).success, contract.name).toBe(true)
        const serializable = JSON.parse(JSON.stringify(await tool.run(args[index])))
        const result = fromJson(contract.outputSchema).safeParse(serializable)
        expect(result.success, `${contract.name}: ${JSON.stringify(result.error)}`).toBe(true)
      }
    } finally {
      await rm(outputDir, { recursive: true, force: true })
    }
  })

  it('matches the local writer boundary for lease receipts, spacer changes, and right-hole movement', () => {
    const contract = (name: string) => {
      const tool = mcp.tools.find(tool => tool.name === name)
      if (!tool) throw Error(`Missing contract: ${name}`)
      return { input: fromJson(tool.inputSchema), output: fromJson(tool.outputSchema) }
    }
    const projectId = 'project-a'
    const baseRevision = 'a'.repeat(64)
    const draftRevision = 'draft-1'
    const context = { baseRevision, draftRevision: null, cursor: 0, spacerDraft: null, mountingPlateDraftRevision: draftRevision }
    expect(contract('readWriterContext').output.safeParse(context).success).toBe(true)
    for (const name of ['acquireWriter', 'takeOverWriter']) {
      const receipt = { writerEpoch: 1, baseRevision, draftRevision: null }
      expect(contract(name).output.safeParse(receipt).success).toBe(true)
      expect(contract(name).output.safeParse({ ...receipt, writerToken: 'private' }).success).toBe(false)
    }
    const stage = contract('stageChange')
    const change = { baseRevision, expectedDraftRevision: null, idempotencyKey: 'stage-1', sources: {},
      operation: { type: 'createSpacerDraft' } }
    expect(stage.input.safeParse({ projectId, change }).success).toBe(true)
    expect(stage.input.safeParse({ projectId, change: { ...change, operation: { type: 'resumeSpacerDraft' } } }).success).toBe(false)
    const operation = { type: 'resumeSpacerDraft', taskId: 'task-a', innerDiameterQ: 100 }
    expect(stage.input.safeParse({ projectId, change: { ...change, operation } }).success).toBe(true)
    const move = contract('moveRightHoleX')
    const position = { projectId, baseRevision, expectedDraftRevision: draftRevision, idempotencyKey: 'move-1' }
    for (const deltaQ of [-100, 100]) expect(move.input.safeParse({ ...position, deltaQ }).success).toBe(true)
    for (const deltaQ of [0, 1.5]) expect(move.input.safeParse({ ...position, deltaQ }).success).toBe(false)
    expect(move.output.safeParse({ jobId: 'job-1', revision: 'draft-2' }).success).toBe(true)
  })

  it('keeps check-set binding, callback, five evidence branches and the disabled flag in the contract', () => {
    const path = '/api/v1/projects/{projectId}/drafts/{draftRevision}/commit'
    const commit = rest.paths[path].post
    expect(Object.keys(commit.callbacks.committed)).toEqual(['{$request.body#/webhook/url}'])
    const payload = fromJson(rest.components.schemas.CommitDraftRequest)
    const request = { projectId: 'p', draftRevision: 'draft-1', checksetFingerprint: 'csfp-a',
      baseRevision: null, confirmationToken: 'human-review', requestId: 'request-1' }
    expect(payload.safeParse(request).success).toBe(true)
    expect(payload.safeParse({ ...request, checksetFingerprint: undefined }).success).toBe(false)
    expect(payload.safeParse({ ...request, webhook: { url: 'http://example.test' } }).success).toBe(false)
    const { $schema: assemblyDialect, ...assembly } = z.toJSONSchema(assemblyModelV1Schema)
    const { $schema: evidenceDialect, ...evidence } = z.toJSONSchema(provenanceRefSchema)
    expect(evidenceDialect).toBe(assemblyDialect)
    expect(rest.components.schemas.AssemblyModelV1).toEqual(assembly)
    expect(rest.components.schemas.EvidenceRef).toEqual(evidence)
    expect(rest.components.schemas.EvidenceRef.anyOf).toHaveLength(5)
    expect(flags.properties.FEATURE_3D_ASSEMBLY_M1.default).toBe(FEATURE_3D_ASSEMBLY_M1)
    expect(FEATURE_3D_ASSEMBLY_M1).toBe(false)
  })

  it('resolves each OpenAPI reference and matches paths, path parameters, and unique operation IDs', () => {
    const ids = new Set<string>()
    for (const [path, methods] of Object.entries(rest.paths)) {
      expect(path === '/healthz' || path.startsWith('/api/v1/')).toBe(true)
      const placeholders = Array.from(path.matchAll(/\{([^}]+)\}/g), match => match[1])
      for (const operation of Object.values(methods)) {
        const params: { in: string; required?: boolean; name: string }[] =
          'parameters' in operation ? operation.parameters : []
        expect(params.filter(param => param.in === 'path' && param.required).map(param => param.name)).toEqual(placeholders)
        expect(ids.has(operation.operationId)).toBe(false)
        ids.add(operation.operationId)
      }
    }
    const visit = (value: unknown) => {
      if (!value || typeof value !== 'object') return
      for (const [key, child] of Object.entries(value)) {
        if (key === '$ref' && typeof child === 'string') {
          const [file, pointer] = child.split('#/')
          expect(['', './mcp-tools.json']).toContain(file)
          let target: unknown = file ? mcp : rest
          for (const segment of pointer.split('/')) {
            target = (target as Record<string, unknown>)[segment.replaceAll('~1', '/').replaceAll('~0', '~')]
          }
          expect(target, child).toBeDefined()
        } else visit(child)
      }
    }
    visit(rest)
  })
})
