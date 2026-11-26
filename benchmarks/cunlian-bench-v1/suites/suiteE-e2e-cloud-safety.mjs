import '../../../mcp/register-ts.mjs'
import { createHash } from 'node:crypto'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { check, measure, result } from '../run.mjs'
import { axialChain } from './suiteC-gdt-accuracy.mjs'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const sha256 = value => createHash('sha256').update(value).digest('hex')
const thresholds = { documents: 6, pages: 269, wrongPending: 0 }

async function pdf(repoRoot, offlineDir) {
  const { BASELINE_RELATIVE_PATH, MANIFEST_RELATIVE_PATH, defaultCorpusDir, measureCorpus } = await import('../../../scripts/real-docs/metrics.mjs')
  const manifestPath = join(repoRoot, MANIFEST_RELATIVE_PATH)
  const corpusDir = offlineDir ?? process.env.REAL_DOC_CORPUS ?? defaultCorpusDir()
  try {
    const { summary } = await measureCorpus({ manifestPath, corpusDir })
    return check(summary.documents === 6 && summary.pages === 269 &&
      summary.correctness.pendingChecked === summary.candidates.pending &&
      summary.correctness.pendingChecked > 0 && summary.correctness.wrongPending === 0,
    { source: 'Live manifest-verified PDF extraction (GT-02)', corpusDir, ...summary },
    'Live extraction did not reproduce the corpus coverage or correctness required by GT-02.')
  } catch (error) {
    if (error.code !== 'CORPUS_MISSING') throw error
    const audit = JSON.parse(await readFile(join(repoRoot, 'docs/evidence/ground-truth/scope-audit.json'), 'utf8'))
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    const baseline = JSON.parse(await readFile(join(repoRoot, BASELINE_RELATIVE_PATH), 'utf8'))
    return { status: 'SKIPPED_EXTERNAL_ASSET', reason: error.message, metrics: {
      source: 'Historical checked-in GT-02 audit and extraction baseline', corpusDir,
      documents: manifest.documents.length, pages: manifest.documents.reduce((sum, item) => sum + item.pages, 0),
      correctness: audit.correctness, candidates: baseline.summary?.candidates ?? baseline.measured?.summary?.candidates,
      confirmableRate: baseline.summary?.confirmableRate ?? baseline.measured?.summary?.confirmableRate,
    } }
  }
}

async function offlineReport(assembly, request, stamp) {
  const { buildReport } = await import('../../../src/report/buildReport.ts')
  const { chainConclusion, REPORT_SAMPLES } = await import('../../../src/report/chainConclusion.ts')
  const chain = { ...axialChain, target: { minQ: 2450, maxQ: 3550 } }
  const conclusions = chainConclusion(chain, request.seed)
  return buildReport(request, { sampleCount: REPORT_SAMPLES, distribution: 'uniform', ...stamp }, assembly, {
    conclusions,
    evidence: [{ target: 'inspection', ref: {
      kind: 'user-attestation', actorId: 'benchmark', at: '2026-11-26T00:00:00Z',
      sessionSeq: 1, sessionLabel: 'Bench evidence', statement: 'BENCH02-EVIDENCE-ENTRY',
      fieldPath: 'inspection',
    } }],
  })
}

async function reports(seed) {
  const { exportReport } = await import('../../../src/report/exportReport.ts')
  const { advancedGdtFixture } = await import('../../../src/core/solver/test/advancedGdtFixture.mjs')
  const { assembly } = advancedGdtFixture()
  const request = { projectId: 'bench02-project', seed }
  const stamp = { projectName: 'Bench report', revision: 'bench02-revision', isDraft: true,
    appVersion: 'benchmark-fixture', checksetFingerprint: sha256('bench02-checkset') }
  const payload = await offlineReport(assembly, request, stamp)
  if (!payload.conclusions.some(item => item.compliant)) throw Error('Report fixture did not yield compliant conclusions')
  const formats = {}
  let saved
  for (const format of ['html', 'csv', 'json']) {
    const { content } = await exportReport(payload, format)
    if (format === 'json') saved = JSON.parse(content)
    formats[format] = {
      projectId: content.includes(request.projectId), revision: content.includes(stamp.revision),
      checksetFingerprint: content.includes(stamp.checksetFingerprint),
      seed: format === 'json' ? saved.seed === seed :
        format === 'csv' ? content.includes('"seed"') && content.includes('"' + seed + '"') :
          content.includes(String(seed)),
      evidence: content.includes('BENCH02-EVIDENCE-ENTRY'),
    }
  }
  const replay = await offlineReport(assembly, { ...request, seed: saved.seed }, stamp)
  const numericalReplayEqual = saved.conclusions.length > 0 &&
    isDeepStrictEqual(saved.conclusions, JSON.parse(JSON.stringify(replay.conclusions)))
  const formatsComplete = Object.values(formats).every(fields => Object.values(fields).every(Boolean))
  const missing = Object.entries(formats).flatMap(([format, fields]) =>
    Object.entries(fields).filter(([, present]) => !present).map(([field]) => format + '.' + field))
  return check(formatsComplete && numericalReplayEqual,
    { formats, seedFromReport: saved.seed, conclusionCount: saved.conclusions.length, numericalReplayEqual },
    missing.length ? 'Production report export omits required fields: ' + missing.join(', ') :
      'Production report numerical conclusions differ when replayed with its recorded seed.')
}

async function engineeringValidation(seed) {
  const { prepareGdt, evaluateGdt } = await import('../../../src/core/solver/gdt.mjs')
  const { scene } = await import('../../../src/core/solver/spatial.mjs')
  const { axis, face, model, part } = await import('../../../src/core/solver/test/fixture.ts')
  const up = [0, 0, 1]
  const assembly = model([part('plate')], [
    face('first-plane', 'plate', [0, 0, 0], up), face('second-plane', 'plate', [0, 0, 20000], up),
    axis('bore', 'plate', [0, 0, 0], up, 30000),
  ])
  assembly.datums = [{ id: 'A', featureId: 'first-plane' }, { id: 'B', featureId: 'second-plane' },
    { id: 'axis', featureId: 'bore' }]
  assembly.gdt = [
    { id: 'parallel-datums', kind: 'position', featureId: 'bore', toleranceQ: 1000, datumIds: ['A', 'B'] },
    { id: 'cylinder-datum', kind: 'cylindricity', featureId: 'bore', toleranceQ: 1000, datumIds: ['A'] },
    { id: 'runout-mmc', kind: 'circular-runout', featureId: 'bore', toleranceQ: 1000,
      datumIds: ['axis'], modifier: 'MMC', featureSizeToleranceQ: { lowerQ: 0, upperQ: 1000 } },
  ]
  const parameters = new Map()
  const prepared = prepareGdt(assembly, scene(assembly), parameters, new Map(), 64, seed)
  const { metrics: { warnings } } = evaluateGdt(prepared, parameters)
  const expected = [['parallel-datums', 'DRF_DEGENERATE'], ['cylinder-datum', 'DRF_DEGENERATE'], ['runout-mmc', 'ILLEGAL_MODIFIER']]
  const validated = expected.filter(([id, code]) => warnings.some(w => w.gdtId === id && w.code === code)).length
  return { warnings, validated, expected: expected.length }
}

async function withCloud(enabled, work) {
  const { configFrom } = await import('../../../cloud/server/config.mjs')
  const { createCloudServer } = await import('../../../cloud/server/http.mjs')
  const data = await mkdtemp(join(tmpdir(), 'cunlian-cloud-bench-'))
  const key = 'bench02-ephemeral-writer'
  const peerKey = 'bench02-ephemeral-peer'
  const config = configFrom({ CUNLIAN_DATA: data, FEATURE_3D_ASSEMBLY_M1: String(enabled),
    CUNLIAN_KEYS: JSON.stringify([{ name: 'bench02', key, write: true }, { name: 'peer', key: peerKey, write: true }]) })
  let service
  try {
    service = await createCloudServer(config, () => {})
    await new Promise((resolve, reject) => {
      service.server.once('error', reject)
      service.server.listen(0, '127.0.0.1', resolve)
    })
    const origin = 'http://127.0.0.1:' + service.server.address().port
    const call = async (path, input, { credential = key, method } = {}) => {
      const form = input instanceof FormData
      const response = await fetch(origin + '/api/v1' + path, {
        method: method ?? (input === undefined ? 'GET' : 'POST'),
        headers: { authorization: 'Bearer ' + credential,
          ...(!form && input !== undefined && { 'content-type': 'application/json' }) },
        body: form ? input : JSON.stringify(input), signal: AbortSignal.timeout(30_000),
      })
      const body = await response.json()
      return { path, status: response.status, body: body.value ?? body }
    }
    return await work(call, peerKey)
  } finally {
    try { await service?.close() } finally { await rm(data, { recursive: true, force: true }) }
  }
}

function requireStatus(response, expected) {
  if (response.status !== expected) throw Error(response.path + ' HTTP ' + response.status + ': ' + JSON.stringify(response.body))
  return response.body
}

async function leaseSerialization() {
  return withCloud(false, async (call, peerKey) => {
    const project = requireStatus(await call('/projects', { name: 'Lease concurrency', template: 'chain-demo' }), 201)
    const path = '/projects/' + project.projectId
    requireStatus(await call(path + '/authorization', undefined, { credential: peerKey, method: 'POST' }), 200)
    const responses = await Promise.all([
      call(path + '/writer', { expectedWriterEpoch: 0 }),
      call(path + '/writer', { expectedWriterEpoch: 0 }, { credential: peerKey }),
    ])
    const statuses = responses.map(item => item.status).sort((a, b) => a - b)
    return { statuses, conflictFraction: isDeepStrictEqual(statuses, [200, 409]) ? 1 : 0 }
  })
}

async function parity(seed, samples) {
  const { calculateChain } = await import('../../../src/domain/calculate.ts')
  const { statisticalSummaryOf } = await import('../../../src/domain/statistics.ts')
  const { createNewProjectSnapshot } = await import('../../../desktop/main/newProject.ts')
  const { encodeProjectFile } = await import('../../../src/project-file/codec.ts')
  const { createGdtAnalyzer } = await import('../../../mcp/lib/gdt.ts')
  const { createCompliantAnalyzer } = await import('../../../mcp/lib/compliant.ts')
  const { gdtFixture } = await import('../../../src/core/solver/test/gdtFixture.mjs')
  const { materialPresets } = await import('../../../src/core/solver/materials.ts')
  const { gdtConclusions } = await import('../../../src/report/gdtConclusions.mjs')
  const { chainConclusion } = await import('../../../src/report/chainConclusion.ts')
  const { assembly } = gdtFixture()
  assembly.physics = { enabled: true, materials: [{ ...materialPresets['steel-45'], partId: 'spacer', presetId: 'steel-45', deltaTemperatureK: 0 }],
    compliantModels: [{ id: 'preload', kind: 'axial-compression', partId: 'spacer',
      featureId: 'spacer-top', preloadN: 800, effectiveAreaMm2: 25, lengthMm: 12 }] }
  const source = createNewProjectSnapshot({ name: 'Benchmark parity', template: 'empty',
    appVersion: 'benchmark-fixture', electronVersion: 'benchmark-fixture' })
  const chain = { ...axialChain, target: { minQ: 2450, maxQ: 3550 } }
  source.project.dimensionChain = chain
  source.project.assembly3d = assembly
  const geometry = Buffer.from('ISO-10303-21;\nEND-ISO-10303-21;')
  source.project.stepAttachments = [{ id: 'step-a', blobKey: 'step-a-bytes', fileName: 'fixture.step' }]
  source.blobs.push({ projectId: source.project.id, blobKey: 'step-a-bytes', sha256: sha256(geometry), byteSize: geometry.length })
  source.attachments.push({ blobKey: 'step-a-bytes', bytes: geometry })
  const archive = await encodeProjectFile(source)
  if (!archive.ok) throw Error(JSON.stringify(archive))
  const monteCarlo = { seed, samples, distribution: 'uniform' }
  const extreme = calculateChain(chain)
  const desktopStatistics = statisticalSummaryOf(chain, extreme, monteCarlo)
  const states = {}
  for (const enabled of [false, true]) {
    states[enabled] = await withCloud(enabled, async call => {
      const capabilities = requireStatus(await call('/capabilities'), 200)
      const form = new FormData()
      form.set('kind', 'cunlian')
      form.set('fileName', 'benchmark.cunlian')
      form.set('file', new Blob([archive.value.bytes]))
      const { projectId, baseRevision } = requireStatus(await call('/projects/import', form), 201)
      const project = '/projects/' + projectId
      const { writerEpoch } = requireStatus(await call(project + '/writer', { expectedWriterEpoch: 0 }), 200)
      const builtIn = requireStatus(await call('/projects', {
        name: 'Dimension parity', template: 'builtin-shaft-spacer',
      }), 201)
      const dimensionPath = '/projects/' + builtIn.projectId + '/drafts/' + builtIn.draftRevision
      const dimension = requireStatus(await call(dimensionPath + '/simulation', { chain, monteCarlo }), 200)
      let draftRevision = builtIn.draftRevision
      if (enabled) {
        const evidence = [{ kind: 'user-attestation', actorId: 'bench02', at: '2026-11-26T00:00:00Z',
          sessionSeq: 1, sessionLabel: 'Benchmark', statement: 'Synthetic datum fixture', fieldPath: 'assembly3d' }]
        const staged = requireStatus(await call(project + '/drafts/datums', {
          baseRevision, expectedDraftRevision: null, expectedWriterEpoch: writerEpoch, idempotencyKey: 'bench02-datum',
          items: [{ value: assembly.datums[0], evidence }],
        }), 200)
        draftRevision = staged.draftRevision
      }
      const gatedProject = enabled ? project : "/projects/" + builtIn.projectId
      const draft = gatedProject + '/drafts/' + draftRevision
      const options = { expectedWriterEpoch: writerEpoch, monteCarlo }
      const gdt = await call(draft + '/gdt-stackup', options)
      const flexible = await call(draft + '/compliant-stackup', options)
      const report = await call(gatedProject + '/report', { format: 'json', seed })
      const base = { featureFlagCorrect: capabilities.FEATURE_3D_ASSEMBLY_M1 === enabled,
        dimensionsExact: isDeepStrictEqual(dimension.extreme, extreme) &&
          isDeepStrictEqual(dimension.statistical, desktopStatistics) }
      if (!enabled) {
        const disabledEndpoints = Object.fromEntries(Object.entries({ gdt, flexible, report }).map(([name, response]) => [
          name, { status: response.status, code: response.body.error?.code ?? null },
        ]))
        return { ...base, disabledEndpoints, gatedAsConfigured: Object.values(disabledEndpoints).every(item =>
          item.status === 422 && item.code === 'FEATURE_DISABLED') }
      }
      const request = { ...options, projectId, draftRevision }
      const gdtAnalyzer = createGdtAnalyzer()
      const flexAnalyzer = createCompliantAnalyzer()
      try {
        const localGdt = await gdtAnalyzer.run(assembly, request)
        const localFlexible = await flexAnalyzer.run(assembly, request)
        const cloudReport = JSON.parse(requireStatus(report, 200).content)
        const localReport = [...chainConclusion(chain, seed), ...gdtConclusions(assembly, seed, cloudReport.sampleCount).conclusions]
        return { ...base, gdtExact: isDeepStrictEqual(requireStatus(gdt, 200), localGdt),
          flexibleExact: isDeepStrictEqual(requireStatus(flexible, 200), localFlexible),
          reportExact: localReport.length > 0 && isDeepStrictEqual(cloudReport.conclusions,
            JSON.parse(JSON.stringify(localReport))) }
      } finally {
        await Promise.all([gdtAnalyzer.close(), flexAnalyzer.close()])
      }
    })
  }
  const success = states.false.featureFlagCorrect && states.false.dimensionsExact && states.false.gatedAsConfigured &&
    states.true.featureFlagCorrect && states.true.dimensionsExact && states.true.gdtExact &&
    states.true.flexibleExact && states.true.reportExact
  if (!success) return check(false, { states }, 'Cloud behavior differs from the desktop core or the configured feature gate.')
  return { status: 'SKIPPED_EXTERNAL_ASSET', reason: 'Flag-off cloud intentionally exposes no GD&T, compliance, or report results to compare.',
    metrics: { states, localImplementation: 'Desktop authority analyzer modules and report numerical core',
      cloudImplementation: 'Live loopback REST service; synthetic archive for numerical parity' } }
}

export async function runSuite({ repoRoot = root, offlineDir = null, seed = 20261126, samples = 50000 } = {}) {
  const start = performance.now()
  const cases = [
    await measure('E1', 'Real PDF extraction', thresholds, () => pdf(repoRoot, offlineDir)),
    await measure('E2', 'Desktop and cloud feature-flag parity', { numericalDeviation: 0 }, () => parity(seed, samples)),
    await measure('E3', 'Engineering input validation and service guard coverage', { rejectionOrWarningRate: 1 }, async () => {
      const metrics = await engineeringValidation(seed)
      metrics.writerLease = await leaseSerialization()
      const { matches } = await import('../../../cloud/server/contracts.mjs')
      const openapi = JSON.parse(await readFile(join(repoRoot, 'cloud/contracts/openapi.json'), 'utf8'))
      const schema = openapi.components.schemas.CommitDraftRequest
      const valid = { projectId: 'fixture', baseRevision: null, draftRevision: 'draft',
        requestId: 'fixture', checksetFingerprint: 'fixture-digest', confirmationToken: 'fixture-token' }
      const { confirmationToken: _, ...withoutToken } = valid
      const { checksetFingerprint: __, ...withoutFingerprint } = valid
      metrics.commitContract = {
        validShapeAccepted: matches(valid, schema),
        missingTokenRejected: !matches(withoutToken, schema),
        missingFingerprintRejected: !matches(withoutFingerprint, schema),
      }
      metrics.serviceGuardCoverage = { checksetFingerprint: 'runtime not exercised', commitConfirmation: 'runtime not exercised' }
      if (!Object.values(metrics.commitContract).every(Boolean)) return check(false, metrics,
        'Commit request schema does not enforce the required fingerprint and confirmation fields.')
      if (metrics.validated !== metrics.expected) return check(false, metrics, 'GD&T validation did not issue every required engineering warning.')
      if (metrics.writerLease.conflictFraction !== 1) return check(false, metrics,
        'Two eligible writers did not produce exactly one successful lease and one 409.')
      return { status: 'SKIPPED_EXTERNAL_ASSET', reason: 'Commit contract was checked in-process. Runtime fingerprint and confirmation red-team coverage remains unverified.',
        metrics }
    }),
    await measure('E4', 'Report provenance and seed replay', { formatsComplete: 1, numericalDeviation: 0 }, () => reports(seed)),
  ]
  return result('E', 'End-to-end and engineering safety', 'Repository PDF ground truth, server, desktop and export contracts', start, cases)
}
