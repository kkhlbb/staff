import { readFile } from 'node:fs/promises'
import { createGeometryManager } from '../../../src/core/geometry/geometryManager.mjs'
import { fixtureWriter } from '../fixtures/suiteB/build-step.mjs'
import { fetchExternal, isMain, manifest, parseArgs, sha256 } from '../fetch-external.mjs'

const mb = bytes => bytes / 1024 ** 2
const attachment = (id, fileName, bytes) => ({ id, blobKey: id, fileName, bytes, sha256: sha256(bytes) })
const execution = id => ({ jobId: id, attempt: 1, projectId: id, revision: 'bench-v1', timeoutMs: 120_000 })
const missingMetrics = () => Object.fromEntries([
  'solidCount', 'groupCount', 'faceCount', 'holeAxisCount', 'importMs', 'hlrMs', 'rssDeltaMb',
].map(key => [key, null]))

function describeSource(bytes) {
  const text = bytes.toString('latin1')
  return {
    assemblyOccurrences: [...text.matchAll(/\bNEXT_ASSEMBLY_USAGE_OCCURRENCE\s*\(/gi)].length,
    solidEntities: [...text.matchAll(/\bMANIFOLD_SOLID_BREP\s*\(/gi)].length,
    advancedFaceEntities: [...text.matchAll(/\bADVANCED_FACE\s*\(/gi)].length,
    productNames: [...text.matchAll(/\bPRODUCT\s*\(\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'/gi)]
      .flatMap(match => match.slice(1).filter(Boolean)),
    rgbEntities: [...text.matchAll(/\bCOLOUR_RGB\s*\(/gi)].length,
  }
}

async function fileCase(manager, asset, input) {
  const { id, file, case: group } = asset
  const name = group + ' ' + id
  const metrics = missingMetrics()
  const thresholds = { solidCountMin: group === 'A3' ? 2 : 1, faceCountMin: 1, hlrViews: ['front', 'top', 'left'],
    ...(group === 'A3' && { groupCountMin: 1, sourceOccurrenceCountMin: 2 }) }
  if (input.status !== 'READY') return {
    id: name.replace(' ', '-'), name, status: input.status, durationMs: 0, reason: input.reason, metrics, thresholds,
  }
  const start = performance.now()
  const rss = process.memoryUsage.rss()
  const defects = []
  const options = execution(name)
  try {
    const bytes = await readFile(input.path)
    if (sha256(bytes) !== asset.sha256) throw Error('STEP changed after cache verification')
    const source = describeSource(bytes)
    metrics.source = source
    if (group === 'A3' && source.assemblyOccurrences === 0) {
      metrics.assemblyAccepted = false
      defects.push('Official FTC input has no STEP assembly occurrences')
    }
    const step = attachment(id, file, bytes)
    const importStart = performance.now()
    let imported
    try {
      imported = await manager.importStep(step, options)
    } finally {
      metrics.importMs = performance.now() - importStart
    }
    const { report } = imported
    const groups = report.assembly.assemblyGroups ?? []
    const parts = report.assembly.parts
    Object.assign(metrics, {
      solidCount: parts.length, groupCount: groups.length,
      faceCount: report.parts.reduce((sum, part) => sum + part.faces.length, 0),
      holeAxisCount: report.features.filter(feature => feature.kind === 'cylindrical-hole-axis').length,
      xcafGroups: groups,
      xcafInstances: parts.map(({ displayName, color, nominalTransform, groupId }) =>
        ({ displayName, color, nominalTransform, groupId })),
    })
    metrics.importAccepted = metrics.solidCount > 0 && metrics.faceCount >= thresholds.faceCountMin &&
      report.parts.every(part => part.faces.length > 0 && part.volumeMm3 > 0)
    if (!metrics.importAccepted) defects.push('Import lacks non-empty solid topology')
    if (group === 'A3') {
      metrics.assemblyAccepted = source.assemblyOccurrences >= thresholds.sourceOccurrenceCountMin &&
        parts.length >= thresholds.solidCountMin && groups.length >= thresholds.groupCountMin &&
        parts.every(part => groups.some(g => g.id === part.groupId) &&
          source.productNames.includes(part.displayName) && /^#[0-9a-f]{6}$/i.test(part.color) &&
          part.color !== '#8094a6' && part.nominalTransform.flat().every(Number.isFinite))
      if (!metrics.assemblyAccepted && source.assemblyOccurrences > 0) {
        defects.push('Assembly tree or expected XCAF metadata was not recovered')
      }
    }
    const hlrStart = performance.now()
    try {
      const projected = await manager.importStep(step, { ...options, drawing: {} })
      metrics.hlrViews = projected.report.projection.views.map(view => ({
        id: view.id, edges: view.geometry.length, hasVisible: view.geometry.some(edge => edge.style === 'visible'),
      }))
      metrics.hlrCacheHit = projected.metrics.threadId === imported.metrics.threadId &&
        projected.metrics.cachedShapeBuilds === imported.metrics.cachedShapeBuilds
      metrics.hlrAccepted = metrics.hlrCacheHit && metrics.hlrViews.length === thresholds.hlrViews.length &&
        metrics.hlrViews.every((view, i) => view.id === thresholds.hlrViews[i] && view.edges > 0 && view.hasVisible)
      if (!metrics.hlrAccepted) defects.push('Three non-empty HLR views were not returned on the warm shape cache')
    } finally {
      metrics.hlrMs = performance.now() - hlrStart
    }
  } catch (error) {
    defects.push(error.message)
  } finally {
    try {
      await manager.release(options.projectId, options.revision)
    } catch (error) {
      defects.push('Release: ' + error.message)
    }
    metrics.rssDeltaMb = mb(process.memoryUsage.rss() - rss)
  }
  return { id: name.replace(' ', '-'), name, status: defects.length ? 'FAIL' : 'PASS',
    durationMs: performance.now() - start, metrics, thresholds,
    ...(defects.length && { defectNote: defects.join('; ') }) }
}

async function xcafControl(manager) {
  const start = performance.now()
  const name = 'Local XCAF assembly metadata control'
  const metrics = {}
  const expected = [
    { displayName: 'L bracket', translation: [0, 0, 0], color: '#597aa3' },
    { displayName: 'Flange', translation: [26, 19, 5], color: '#9e917d' },
  ]
  const thresholds = { distanceMmMax: 1e-6, expected }
  let defectNote
  try {
    const write = await fixtureWriter()
    const bytes = write('l-bracket-flange')
    const step = attachment('A3-control', 'l-bracket-flange.step', bytes)
    const { report: { assembly } } = await manager.importStep(step, { jobId: step.id, attempt: 1 })
    metrics.instances = assembly.parts.map(({ displayName, nominalTransform, color, groupId }) =>
      ({ displayName, nominalTransform, color, groupId }))
    metrics.groups = assembly.assemblyGroups ?? []
    const [root] = metrics.groups
    if (metrics.groups.length !== 1 || root.name !== 'l-bracket-flange' || root.parentGroupId ||
        metrics.instances.length !== expected.length || !expected.every(reference => metrics.instances.some(instance =>
          instance.displayName === reference.displayName && instance.color === reference.color && instance.groupId === root.id &&
          instance.nominalTransform.every((row, i) => row.every((value, j) =>
            Math.abs(value - (j === 3 && i < 3 ? reference.translation[i] : Number(i === j))) <= thresholds.distanceMmMax))))) {
      throw Error('Round-trip assembly group, part name, instance pose or RGB differs from the authored fixture')
    }
  } catch (error) {
    defectNote = error.message
  }
  return { id: 'A3-LOCAL-XCAF', name, status: defectNote ? 'FAIL' : 'PASS',
    durationMs: performance.now() - start, metrics, thresholds, ...(defectNote && { defectNote }) }
}

async function memoryCase(inputs) {
  const start = performance.now()
  const samples = []
  const models = []
  const thresholds = { rounds: 10, minimumModels: 2, releasedHandles: 0, workerThreads: 1, wasmInitializations: 1 }
  const manager = createGeometryManager()
  const name = '10 rounds of complex STEP load/release'
  const errors = []
  let baseline
  try {
    for (const asset of manifest.nist.assets.filter(asset => ['A2', 'A4'].includes(asset.case))) {
      const input = inputs.find(input => input.id === asset.id && input.status === 'READY')
      if (!input) continue
      const bytes = await readFile(input.path)
      if (sha256(bytes) !== asset.sha256) throw Error('STEP changed after cache verification: ' + asset.id)
      models.push({ source: 'NIST AP242', step: attachment(asset.id, asset.file, bytes) })
    }
    if (models.length < thresholds.minimumModels) {
      const write = await fixtureWriter()
      for (const id of ['shell-four-corner-clamps', 'stepped-shaft-seat-cover']) {
        models.push({ source: 'Local OCCT assembly substitute', step: attachment(id, id + '.step', write(id)) })
      }
    }
    baseline = process.memoryUsage.rss()
    for (let i = 0; i < thresholds.rounds; i++) {
      const options = execution('A5-' + (i + 1))
      const loads = []
      let released
      try {
        for (const { step } of models) {
          const { metrics, report } = await manager.importStep(step, options)
          loads.push({ id: step.id, ...metrics, solidCount: report.parts.length })
        }
      } finally {
        released = (await manager.release(options.projectId, options.revision)).metrics
        samples.push({ round: i + 1, loads, released,
          peakSampleRssMb: mb(Math.max(released.rss, ...loads.map(load => load.rss))),
          releasedRssMb: mb(released.rss) })
      }
    }
  } catch (error) {
    errors.push(error.message)
  } finally {
    try { await manager.close() } catch (error) { errors.push(error.message) }
  }
  const stats = samples.flatMap(row => [...row.loads, row.released])
  const threadCount = new Set(stats.map(row => row.threadId)).size
  const watermarks = samples.map(row => row.releasedRssMb)
  const tail = watermarks.slice(-5)
  const sustainedRssGrowth = tail.length === 5 && tail.slice(1).every((rss, i) => rss > tail[i])
  const metrics = {
    samples, models: models.map(({ step, source }) => ({ id: step.id, sha256: step.sha256, source })),
    baselineRssMb: baseline === undefined ? null : mb(baseline),
    peakSampleRssMb: samples.length ? Math.max(...samples.map(row => row.peakSampleRssMb)) : null,
    releasedRssMb: watermarks.at(-1) ?? null,
    rssDeltaMb: watermarks.length ? watermarks.at(-1) - mb(baseline) : null,
    firstToLastReleasedRssDeltaMb: watermarks.length ? watermarks.at(-1) - watermarks[0] : null,
    sustainedRssGrowth, threadCount,
  }
  if (samples.length !== thresholds.rounds || threadCount !== thresholds.workerThreads ||
      stats.some(row => row.wasmInitializations !== thresholds.wasmInitializations) ||
      samples.some(row => row.released.cachedShapeHandles !== thresholds.releasedHandles ||
        row.loads.length !== models.length || row.loads.some(load => !load.solidCount))) {
    errors.push('Incomplete load/release, retained native handles, or worker recycled')
  }
  if (sustainedRssGrowth) errors.push('Process RSS rose at all five final release samples; investigate retention')
  return { id: 'A5', name, status: errors.length ? 'FAIL' : 'PASS', durationMs: performance.now() - start,
    metrics, thresholds, ...(errors.length && { defectNote: errors.join('; ') }) }
}

function distribution(cases, field) {
  const values = cases.map(row => row.metrics[field]).filter(Number.isFinite).sort((a, b) => a - b)
  const percentile = p => values[Math.ceil(values.length * p) - 1] ?? null
  return { count: values.length, p50: percentile(0.5), p95: percentile(0.95) }
}

function acceptance(cases, field) {
  const passed = cases.filter(row => row.metrics[field]).length
  return { passed, attempted: cases.length, rate: cases.length ? passed / cases.length : null }
}

export async function runSuite(options = {}) {
  const start = performance.now()
  const inputs = await fetchExternal(options)
  const manager = createGeometryManager()
  const files = []
  let control
  try {
    for (const asset of manifest.nist.assets) files.push(await fileCase(manager, asset, inputs.find(row => row.id === asset.id)))
    control = await xcafControl(manager)
  } finally {
    await manager.close()
  }
  const attempted = files.filter(row => row.status !== 'SKIPPED_EXTERNAL_ASSET')
  const cases = [...files, control, await memoryCase(inputs)]
  const skipped = files.length - attempted.length
  return { suiteId: 'A', title: 'STEP / XCAF geometry and topology', authority: manifest.nist.source,
    status: cases.some(row => row.status === 'FAIL') ? 'FAIL' : skipped ? 'PARTIAL' : 'PASS',
    durationMs: performance.now() - start,
    summary: {
      externalAttempted: attempted.length, externalSkipped: skipped,
      import: acceptance(attempted, 'importAccepted'),
      assemblyTree: acceptance(attempted.filter(row => row.id.startsWith('A3-')), 'assemblyAccepted'),
      projection: acceptance(attempted, 'hlrAccepted'),
      importMs: distribution(attempted, 'importMs'), hlrMs: distribution(attempted, 'hlrMs'),
      timing: 'Nearest-rank percentiles; import includes topology, HLR is a warm-cache worker request including IPC.',
      rss: 'MiB; process-wide RSS sampled at request completion. The final five release samples are checked for monotonic growth.',
    }, cases }
}

if (isMain(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) console.log('Usage: node suiteA-step-xcaf.mjs [--offline-dir PATH | --external] [--cache-dir PATH]')
  else console.log(JSON.stringify(await runSuite(options), null, 2))
}
