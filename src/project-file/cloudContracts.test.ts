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
import gdt from '../../cloud/contracts/mcp-gdt-tools.json'
import compliant from '../../cloud/contracts/mcp-compliant-tools.json'
import report from '../../cloud/contracts/mcp-report-tools.json'
import type { ExportSimulationReportRequest, ExportSimulationReportResult } from '../transport/types'
import rest from '../../cloud/contracts/openapi.json'
import flags from '../../cloud/contracts/feature-flags.schema.json'
import { FEATURE_3D_ASSEMBLY_M1 } from '../transport/types'
import { assemblyModelV1Schema, micMatrixPayloadV1Schema } from './assembly3d'
import { provenanceRefSchema } from './validation'

// TypeScript widens enum/type literals when importing JSON. The tests exercise the actual schemas.
const fromJson = (schema: unknown) => z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0])

const fixture = (relative: string) => fileURLToPath(new URL(`../../${relative}`, import.meta.url))

const resolve = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(resolve)
  if (!value || typeof value !== 'object') return value
  if ('$ref' in value && typeof value.$ref === 'string') {
    const name = value.$ref.split('/').at(-1) as keyof typeof rest.components.schemas
    return resolve(rest.components.schemas[name])
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolve(child)]))
}

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

  it('binds M3 drafting to a lease, revision, and EvidenceRef, with the same REST and MCP schemas', () => {
    const draft = { projectId: 'p', draftRevision: 'draft-1' }
    const writer = { projectId: draft.projectId, expectedWriterEpoch: 1 }
    const revision = { baseRevision: 'base-1', expectedDraftRevision: null, idempotencyKey: 'stage-1' }
    const evidence = { kind: 'user-attestation', actorId: 'reviewer', at: '2026-01-01',
      sessionSeq: 1, sessionLabel: null, statement: 'Use datum A', fieldPath: 'datumIds' }
    const control = { id: 'gdt-1', kind: 'position', featureId: 'hole', toleranceQ: 200, datumIds: ['a'] }
    const monteCarlo = { seed: 7, samples: 50000, distribution: 'normal' }
    const metrics = { cpk: 1.2, ppm: 7, threeSigmaIntervalMm: [0.1, 0.2], contributions: [{
      gdtId: control.id, label: 'Position', kind: 'position', varianceSharePct: 20,
      bonusMeanMm: 0.03, datumShiftContributionPct: 15,
    }], warnings: [{ code: 'DRF_DEGENERATE', gdtId: control.id, message: 'Coincident axes' }] }
    const examples = [
      { input: { ...writer, ...revision, items: [{ value: { id: 'a', label: 'A', featureId: 'hole' }, evidence: [evidence] }] },
        output: { ...draft, warnings: [] } },
      { input: { ...writer, ...revision, items: [{ value: control, evidence: [evidence] }] },
        output: { ...draft, warnings: metrics.warnings } },
      { input: { ...draft, ...writer, monteCarlo, edits: [{ gdtId: control.id, modifier: 'LMC' }] },
        output: { ...draft, monteCarlo, baseline: metrics, whatIf: metrics } },
    ]

    expect(gdt.tools.map(tool => tool.name)).toEqual(['stage_datum', 'stage_gdt', 'analyze_gdt_stackup'])
    for (const [index, tool] of gdt.tools.entries()) {
      const operation = Object.values(rest.paths).flatMap(path => Object.values(path))
        .find(candidate => candidate.operationId === tool.name)
      if (!operation || !('x-feature-flag' in operation)) throw Error('Missing gated operation')
      expect(operation['x-feature-flag']).toBe('FEATURE_3D_ASSEMBLY_M1')
      const { input, output } = examples[index]
      const mcpInput = fromJson(tool.inputSchema)
      const mcpOutput = fromJson(tool.outputSchema)
      expect(mcpInput.safeParse(input).success, tool.name).toBe(true)
      expect(mcpInput.safeParse({ ...input, expectedWriterEpoch: undefined }).success).toBe(false)
      expect(mcpInput.safeParse({ ...input, confirmationToken: 'human-only' }).success).toBe(false)
      expect(mcpOutput.safeParse(output).success, tool.name).toBe(true)
      if ('items' in input) {
        expect(mcpInput.safeParse({ ...input, items: [{ ...input.items[0], evidence: [] }] }).success).toBe(false)
        expect(mcpInput.safeParse({ ...input, expectedDraftRevision: undefined }).success).toBe(false)
      }
      if (tool.name === 'stage_gdt') {
        for (const value of [{ ...control, datumIds: [] }, { ...control, kind: 'flatness' }]) {
          expect(mcpInput.safeParse({ ...input, items: [{ value, evidence: [evidence] }] }).success).toBe(false)
        }
      }
      const response = resolve(operation.responses['200'].content['application/json'].schema)
      expect(fromJson(response).safeParse({ ok: true, value: output }).success).toBe(true)
      const restInput = resolve(operation.requestBody.content['application/json'].schema)
      if (tool.name === 'stage_gdt') {
        const advanced = [
          { ...control, kind: 'profile-surface', datumIds: [], unequalProfileOuterFraction: 0.75 },
          { ...control, kind: 'circular-runout', modifier: 'MMC' },
          { ...control, kind: 'total-runout' },
          { ...control, kind: 'cylindricity', datumIds: [] },
          { ...control, kind: 'composite-position', lowerSegment: { toleranceQ: 100, datumIds: [] } },
        ]
        const invalid = [
          { ...advanced[0], unequalProfileOuterFraction: 1.1 },
          { ...advanced[1], datumIds: [] },
          { ...advanced[3], datumIds: ['a'] },
          { ...advanced[4], lowerSegment: undefined },
        ]
        for (const value of [...advanced, ...invalid]) {
          const body = { ...revision, expectedWriterEpoch: writer.expectedWriterEpoch, items: [{ value, evidence: [evidence] }] }
          const request = { ...body, projectId: writer.projectId }
          expect(mcpInput.safeParse(request).success, value.kind).toBe(advanced.includes(value))
          expect(fromJson(restInput).safeParse(body).success, value.kind).toBe(advanced.includes(value))
        }
      }
      const body = Object.fromEntries(Object.entries(input)
        .filter(([key]) => key !== 'projectId' && key !== 'draftRevision'))
      expect(fromJson(restInput).safeParse(body).success).toBe(true)
    }
  })

  it('publishes matching REST and remote MCP contracts for leased M4 drafts and analysis', () => {
    const evidence = { kind: 'user-attestation', actorId: 'reviewer', at: '2026-11-26',
      sessionSeq: 1, sessionLabel: null, statement: 'Preload is 20 N', fieldPath: 'preloadN' }
    const projectId = 'p'
    const draft = { projectId, draftRevision: 'draft-2' }
    const writer = { projectId, expectedWriterEpoch: 1, baseRevision: 'base-1',
      expectedDraftRevision: null, idempotencyKey: 'stage-1' }
    const physics = { compliantModels: [
      { id: 'compression', kind: 'axial-compression', partId: 'plate', featureId: 'face', preloadN: 20 },
    ] }
    const payload = { schemaVersion: 1, partId: 'plate', units: 'mm', forceUnits: 'N',
      controlPointsMm: [[0, 0, 0]], measurePointsMm: [[0, 0, 1]], sensitivityMatrix: [[0.01]] }
    const attachment = { kind: 'mic-matrix', revisionId: 'mic-1', blobKey: 'mic-blob',
      path: 'attachments/mic-blob.bin', sha256: 'a'.repeat(64), byteSize: 200 }
    const monteCarlo = { seed: 7, samples: 50000, distribution: 'normal' }
    const rigidBaseline = { cpk: 1.5, ppm: 20, threeSigmaIntervalMm: [0.02, 0.03] }
    const compliantResult = { cpk: 1.25, ppm: 120, threeSigmaIntervalMm: [0.02, 0.04] }
    const summary = { rigidBaseline, compliantResult, flexDeltaCpk: -0.25, flexContributionItems: [
      { modelId: 'compression', kind: 'axial-compression', label: 'Preload', varianceSharePct: 12 },
    ] }
    const examples = [
      { input: { ...writer, physics, evidenceByField: { '/compliantModels/0/preloadN': [evidence] } },
        output: { ...draft, physics } },
      { input: { ...writer, fileName: 'plate.json', payload, evidence: [evidence] },
        output: { ...draft, attachment } },
      { input: { ...draft, expectedWriterEpoch: 1, monteCarlo, whatIf: physics },
        output: { ...draft, monteCarlo, summary, displacementFields: [
          { partId: 'plate', maxDisplacementMm: 0.04, minDisplacementMm: 0.04, samples: [
            { posMm: [0, 0, 1], dispMm: [0, 0, 0.04], magMm: 0.04 },
          ] },
        ] } },
    ]

    const micSchema = structuredClone(rest.components.schemas.MicMatrixPayloadV1)
    const { $schema: dialect, ...generated } = z.toJSONSchema(micMatrixPayloadV1Schema)
    expect(dialect).toBe('https://json-schema.org/draft/2020-12/schema')
    expect(micSchema).toEqual({ ...generated, description: expect.stringContaining('one matrix row') })
    expect(compliant.tools.map(tool => tool.name)).toEqual(['stage_physics', 'import_mic_matrix', 'analyze_compliant_stackup'])
    for (const [index, tool] of compliant.tools.entries()) {
      const operation = Object.values(rest.paths).flatMap(path => Object.values(path))
        .find(candidate => candidate.operationId === tool.name)
      if (!operation || !('x-feature-flag' in operation)) throw Error('Missing gated M4 operation')
      expect(operation['x-feature-flag']).toBe('FEATURE_3D_ASSEMBLY_M1')
      const { input, output } = examples[index]
      const mcpInput = fromJson(tool.inputSchema)
      const mcpOutput = fromJson(tool.outputSchema)
      expect(mcpInput.safeParse(input).success, tool.name).toBe(true)
      expect(mcpInput.safeParse({ ...input, expectedWriterEpoch: undefined }).success).toBe(false)
      expect(mcpInput.safeParse({ ...input, confirmationToken: 'human-only' }).success).toBe(false)
      expect(mcpOutput.safeParse(output).success, tool.name).toBe(true)
      if ('expectedDraftRevision' in input) {
        expect(mcpInput.safeParse({ ...input, expectedDraftRevision: undefined }).success).toBe(false)
      }
      if ('physics' in input) {
        expect(mcpInput.safeParse({ ...input, physics: { ...physics, micMatrixRef: 'mic-1' } }).success).toBe(false)
        expect(mcpInput.safeParse({ ...input, evidenceByField: { '/compliantModels/0/preloadN': [] } }).success).toBe(false)
      }
      if ('payload' in input) {
        expect(mcpInput.safeParse({ ...input, evidence: [] }).success).toBe(false)
        expect(mcpInput.safeParse({ ...input, payload: { ...payload, units: 'cm' } }).success).toBe(false)
      }

      const response = fromJson(resolve(operation.responses['200'].content['application/json'].schema))
      expect(response.safeParse({ ok: true, value: output }).success).toBe(true)
      const restInput = fromJson(resolve(operation.requestBody.content['application/json'].schema))
      const body = Object.fromEntries(Object.entries(input)
        .filter(([key]) => key !== 'projectId' && key !== 'draftRevision'))
      expect(restInput.safeParse(body).success).toBe(true)
    }
  })

  it('freezes report request and result parity between REST and remote MCP', () => {
    const path = rest.paths['/api/v1/projects/{projectId}/report'].post
    expect(report.tools).toHaveLength(1)
    const [tool] = report.tools
    expect(tool.name).toBe(path.operationId)
    const { projectId: projectIdSchema, ...bodyProperties } = tool.inputSchema.properties
    expect(path.parameters[0].schema).toEqual(projectIdSchema)
    const bodySchema = resolve(path.requestBody.content['application/json'].schema)
    expect(bodySchema).toEqual({
      ...tool.inputSchema, properties: bodyProperties, required: ['format'],
    })
    expect(tool.outputSchema.oneOf).toEqual(rest.components.schemas.ExportSimulationReportResult.oneOf)

    const restInput = fromJson(bodySchema)
    const mcpInput = fromJson(tool.inputSchema)
    const mcpOutput = fromJson(tool.outputSchema)
    const response = fromJson(resolve(path.responses['200'].content['application/json'].schema))
    const request: ExportSimulationReportRequest = {
      projectId: 'demo', format: 'html', seed: 4294967295, includeSnapshots: true,
      viewportSnapshots: { nominalPngDataUrl: 'data:image/png;base64,aGVsbG8=' },
    }
    const { projectId, ...body } = request
    for (const format of ['html', 'pdf', 'csv', 'json']) {
      expect(mcpInput.safeParse({ projectId, format }).success).toBe(true)
      expect(restInput.safeParse({ ...body, format }).success).toBe(true)
    }
    for (const patch of [{ format: 'svg' }, { seed: -1 }, { seed: 4294967296 }, { seed: 1.5 },
      { viewportSnapshots: { nominalPngDataUrl: 'https://example.test/image.png' } }]) {
      expect(mcpInput.safeParse({ ...request, ...patch }).success).toBe(false)
      expect(restInput.safeParse({ ...body, ...patch }).success).toBe(false)
    }
    expect(mcpInput.safeParse(body).success).toBe(false)
    const binding = {
      fileName: 'report.html', mimeType: 'text/html', sha256: 'a'.repeat(64),
      revision: 'draft-1', checksetFingerprint: 'checkset-1',
    } as const
    const inline: ExportSimulationReportResult = { ...binding, content: '<html></html>' }
    const pathResult: ExportSimulationReportResult = { ...binding, filePath: '/reports/report.html' }
    for (const result of [inline, pathResult]) {
      expect(mcpOutput.safeParse(result).success).toBe(true)
      expect(response.safeParse({ ok: true, value: result }).success).toBe(true)
    }
    for (const result of [binding, { ...inline, filePath: '/report.html' },
      { ...inline, sha256: 'invalid' }, { ...inline, revision: undefined },
      { ...inline, checksetFingerprint: undefined }]) {
      expect(mcpOutput.safeParse(result).success).toBe(false)
      expect(response.safeParse({ ok: true, value: result }).success).toBe(false)
    }
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
