import '../mcp/register-ts.mjs'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import net from 'node:net'

const apiKey = 'cloud-smoke-writer-secret'
const peerKey = 'cloud-smoke-secondary-secret'
const human = 'cloud-smoke-human-secret'

async function reservePort() {
  const reservation = net.createServer()
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
  const { port } = reservation.address()
  await new Promise(resolve => reservation.close(resolve))
  return port
}

async function withCloudServer(envOverrides, run) {
  const root = await mkdtemp(join(tmpdir(), 'cunlian-cloud-smoke-'))
  const port = await reservePort()
  let child
  try {
    child = spawn(process.execPath, ['cloud/server/index.mjs'], {
      cwd: new URL('..', import.meta.url),
      env: {
        ...process.env,
        PORT: String(port),
        HOST: '127.0.0.1',
        CUNLIAN_DATA: root,
        FEATURE_3D_ASSEMBLY_M1: 'false',
        CUNLIAN_APPROVAL_SECRET: human,
        CUNLIAN_KEYS: JSON.stringify([
          { name: 'writer', key: apiKey, write: true, takeover: true },
          { name: 'peer', key: peerKey, write: true },
        ]),
        ...envOverrides,
      },
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    const lines = createInterface({ input: child.stdout })
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Service startup timed out')), 35000)
      child.once('exit', code => { clearTimeout(timeout); reject(Error('Service stopped with code ' + code)) })
      lines.on('line', line => {
        if (line.includes('"type":"listening"')) {
          clearTimeout(timeout)
          resolve()
        }
        if (process.env.CUNLIAN_SMOKE_LOG) console.error(line)
      })
    })
    return await run('http://127.0.0.1:' + port)
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
      await once(child, 'exit')
    }
    await rm(root, { recursive: true, force: true })
  }
}

async function runGa3dReportSmoke(origin) {
  const api = '/api/v1'
  const call = async (path, { method = 'GET', data, status = 200, headers = {} } = {}) => {
    const response = await fetch(origin + path, {
      method,
      headers: {
        ...headers,
        authorization: 'Bearer ' + apiKey,
        ...(data !== undefined && !(data instanceof FormData) && { 'content-type': 'application/json' }),
      },
      ...(data !== undefined && { body: data instanceof FormData ? data : JSON.stringify(data) }),
      signal: AbortSignal.timeout(35000),
    })
    const out = await response.json()
    assert.equal(response.status, status, method + ' ' + path + ' ' + JSON.stringify(out))
    return out.value ?? out
  }

  const caps = await call(api + '/capabilities')
  assert.equal(caps.FEATURE_3D_ASSEMBLY_M1, true)
  assert.equal(caps.attachments.includes('step'), true)

  const { advancedGdtFixture } = await import('../src/core/solver/test/advancedGdtFixture.mjs')
  const { createNewProjectSnapshot } = await import('../desktop/main/newProject.ts')
  const { encodeProjectFile } = await import('../src/project-file/codec.ts')

  const { assembly } = advancedGdtFixture()
  const gdtKinds = new Set(assembly.gdt.map(item => item.kind))
  assert.equal(gdtKinds.size, 10, `expected 10 GD&T kinds, got ${gdtKinds.size}`)

  const snapshot = createNewProjectSnapshot({
    name: 'GA 3D Smoke', template: 'empty', appVersion: '1.0.0', electronVersion: 'smoke',
  })
  snapshot.project.assembly3d = { ...assembly, datums: [], gdt: [], physics: undefined }
  const stepBytes = Buffer.from('ISO-10303-21;\nEND-ISO-10303-21;')
  const stepSha = createHash('sha256').update(stepBytes).digest('hex')
  const attachmentIds = [...new Set(assembly.parts.map(part => part.attachmentId).filter(Boolean))]
  snapshot.project.stepAttachments = attachmentIds.map(id => ({ id, blobKey: `${id}-bytes`, fileName: `${id}.step` }))
  for (const id of attachmentIds) {
    snapshot.blobs.push({ projectId: snapshot.project.id, blobKey: `${id}-bytes`, sha256: stepSha, byteSize: stepBytes.length })
    snapshot.attachments.push({ blobKey: `${id}-bytes`, bytes: stepBytes })
  }
  const encoded = await encodeProjectFile(snapshot)
  assert(encoded.ok, JSON.stringify(encoded))

  const form = new FormData()
  form.set('kind', 'cunlian')
  form.set('fileName', 'ga-smoke.cunlian')
  form.set('file', new Blob([encoded.value.bytes]), 'ga-smoke.cunlian')
  const ref = await call(api + '/projects/import', { method: 'POST', status: 201, data: form })
  const { projectId, baseRevision } = ref
  const path = api + '/projects/' + projectId
  const { writerEpoch } = await call(path + '/writer', { method: 'POST', data: { expectedWriterEpoch: 0 } })

  const evidence = [{
    kind: 'user-attestation', actorId: 'ga-smoke-operator', at: '2026-11-26T00:00:00Z',
    sessionSeq: 1, sessionLabel: null, statement: 'Staged for GA smoke', fieldPath: 'assembly3d',
  }]

  const stagedDatums = await call(path + '/drafts/datums', {
    method: 'POST',
    data: {
      baseRevision, expectedDraftRevision: null, expectedWriterEpoch: writerEpoch,
      idempotencyKey: 'ga-datums', items: assembly.datums.map(value => ({ value, evidence })),
    },
  })
  const stagedGdt = await call(path + '/drafts/gdt', {
    method: 'POST',
    data: {
      baseRevision, expectedDraftRevision: stagedDatums.draftRevision, expectedWriterEpoch: writerEpoch,
      idempotencyKey: 'ga-gdt', items: assembly.gdt.map(value => ({ value, evidence })),
    },
  })
  const gdtAnalysis = await call(`${path}/drafts/${stagedGdt.draftRevision}/gdt-stackup`, {
    method: 'POST',
    data: { expectedWriterEpoch: writerEpoch, monteCarlo: { seed: 137, samples: 1000, distribution: 'normal' } },
  })
  assert.equal(gdtAnalysis.baseline.contributions.length, assembly.gdt.length)

  const stagedPhysics = await call(path + '/drafts/physics', {
    method: 'POST',
    data: {
      baseRevision, expectedDraftRevision: stagedGdt.draftRevision, expectedWriterEpoch: writerEpoch,
      idempotencyKey: 'ga-physics', physics: assembly.physics,
      evidenceByField: { '/materials': evidence, '/compliantModels': evidence },
    },
  })
  const compliantAnalysis = await call(`${path}/drafts/${stagedPhysics.draftRevision}/compliant-stackup`, {
    method: 'POST',
    data: { expectedWriterEpoch: writerEpoch, monteCarlo: { seed: 137, samples: 1000, distribution: 'normal' } },
  })
  assert.ok(compliantAnalysis.summary)
  assert.ok(compliantAnalysis.displacementFields.length >= 1)

  const review = await call(`${path}/drafts/${stagedPhysics.draftRevision}/review`, {
    headers: { 'x-cunlian-approval': human },
  })
  assert.ok(review.gdtSnapshot, 'expected gdtSnapshot in GA review')
  assert.ok(review.compliantSnapshot, 'expected compliantSnapshot in GA review')
  const expectedFingerprint = review.review.checksetFingerprint

  const htmlReport = await call(`${path}/report`, { method: 'POST', data: { format: 'html', seed: 137 } })
  assert.equal(htmlReport.revision, stagedPhysics.draftRevision)
  assert.equal(htmlReport.checksetFingerprint, expectedFingerprint)
  assert.equal(createHash('sha256').update(htmlReport.content).digest('hex'), htmlReport.sha256)
  assert.doesNotMatch(htmlReport.content, /(?:href|src)\s*=\s*["'](?:https?:)?\/\//i, 'HTML report must have zero external CDN links')
  assert.match(htmlReport.content, new RegExp(projectId))
  assert.match(htmlReport.content, new RegExp(stagedPhysics.draftRevision))
  assert.match(htmlReport.content, new RegExp(expectedFingerprint))
  assert.match(htmlReport.content, /137/)
  assert.match(htmlReport.content, /Staged for GA smoke/)

  const csvReport = await call(`${path}/report`, { method: 'POST', data: { format: 'csv', seed: 137 } })
  assert.equal(csvReport.revision, stagedPhysics.draftRevision)
  assert.equal(csvReport.checksetFingerprint, expectedFingerprint)
  assert.match(csvReport.content, new RegExp(projectId))
  assert.match(csvReport.content, new RegExp(expectedFingerprint))

  const jsonReport = await call(`${path}/report`, { method: 'POST', data: { format: 'json', seed: 137 } })
  const parsed = JSON.parse(jsonReport.content)
  assert.equal(parsed.projectId, projectId)
  assert.equal(parsed.revision, stagedPhysics.draftRevision)
  assert.equal(parsed.checksetFingerprint, expectedFingerprint)
  assert.equal(parsed.seed, 137)
  assert.ok(Array.isArray(parsed.evidence) && parsed.evidence.length > 0, 'JSON report must include EvidenceRef appendix')

  const mcpRes = await call('/mcp', {
    method: 'POST',
    headers: { accept: 'application/json' },
    data: { jsonrpc: '2.0', id: 99, method: 'tools/call', params: { name: 'export_simulation_report', arguments: { projectId, format: 'json', seed: 137 } } },
  })
  assert.equal(Boolean(mcpRes.result.isError), false, JSON.stringify(mcpRes))
  assert.equal(mcpRes.result.structuredContent.revision, jsonReport.revision)
  assert.equal(mcpRes.result.structuredContent.checksetFingerprint, expectedFingerprint)
  assert.equal(
    createHash('sha256').update(mcpRes.result.structuredContent.content).digest('hex'),
    mcpRes.result.structuredContent.sha256,
  )
  console.log('cloud smoke (FEATURE_3D_ASSEMBLY_M1=true + 10 GD&T + compliant + HTML/CSV/JSON report) passed')
}

await withCloudServer({ FEATURE_3D_ASSEMBLY_M1: 'false' }, async origin => {
  const { runScenario } = await import('../cloud/server/scenario.mjs')
  await runScenario({
    origin, apiKey, peerKey, human,
    taskbook: await readFile(new URL('../desktop/tests/fixtures/agent-refactor/mounting-plate-taskbook.pdf', import.meta.url)),
  })
  console.log('cloud smoke (FEATURE_3D_ASSEMBLY_M1=false baseline) passed')
})

await withCloudServer({ FEATURE_3D_ASSEMBLY_M1: 'true' }, runGa3dReportSmoke)
console.log('cloud smoke dual-state GA passed')
