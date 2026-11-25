import assert from 'node:assert/strict'
import openapi from '../contracts/openapi.json' with { type: 'json' }
import { matches, tools } from './contracts.mjs'
import { computeSpacerChain } from '../../mcp/lib/spacer.ts'
import { createMountingPlate } from '../../desktop/main/project-agent/m2/model.mjs'
import { runMountingPlate } from '../../desktop/main/project-agent/m2/engine.mjs'
import { importRequirements, interpret } from '../../desktop/main/project-agent/m2/requirements.ts'
import { inspectSourcePdf } from '../../desktop/main/pdfSourceInspect.ts'
import { statisticalSummaryOf } from '../../src/domain/statistics.ts'
import { digest } from './projects.mjs'

export async function runScenario({ origin, apiKey, peerKey, human, taskbook }) {
  const api = '/api/v1'
  const pairs = new Map()
  const call = async (path, { method = 'GET', data, status = 200, key = apiKey, headers = {}, raw = false } = {}) => {
    const response = await fetch(origin + path, {
      method, headers: { ...headers, ...(key && { authorization: 'Bearer ' + key }),
        ...(data !== undefined && !(data instanceof FormData) && { 'content-type': 'application/json' }) },
      ...(data !== undefined && { body: data instanceof FormData ? data : JSON.stringify(data) }),
      signal: AbortSignal.timeout(35000),
    })
    if (raw && response.status === status) return response
    const out = await response.json()
    assert.equal(response.status, status, method + ' ' + path + ' ' + JSON.stringify(out))
    return out.value ?? out
  }
  async function rpc(method, params, options = {}) {
    const response = await call('/mcp', { method: 'POST', raw: true, ...options,
      data: { jsonrpc: '2.0', id: 1, method, params },
      headers: { accept: 'application/json' },
    })
    return (await response.json()).result
  }
  async function tool(name, args, options) {
    const result = await rpc('tools/call', { name, arguments: args }, options)
    assert(!result.isError, name + ': ' + result.content[0].text)
    const value = result.structuredContent
    assert(matches(value, tools.find(tool => tool.name === name).outputSchema), name + ': ' + JSON.stringify(value))
    pairs.set(name, value)
    return value
  }
  assert.deepEqual(await call('/healthz', { key: '' }), { status: 'ok' })
  assert.equal((await call(api + '/capabilities')).FEATURE_3D_ASSEMBLY_M1, false)
  assert.equal((await call(api + '/capabilities', { key: '', status: 401 })).error.code, 'UNAUTHORIZED')
  assert.equal((await call(api + '/capabilities', { key: '', headers: { 'x-api-key': apiKey, 'x-forwarded-proto': 'https' } })).writerLeases, true)
  assert.equal((await call('/mcp', { method: 'POST', status: 403, headers: { origin: 'https://other.example' } })).error.code, 'ORIGIN_FORBIDDEN')
  assert.equal((await rpc('initialize', { protocolVersion: '2025-06-18' })).protocolVersion, '2025-06-18')
  assert.deepEqual((await rpc('tools/list')).tools, tools)
  const stream = await call('/mcp', { raw: true, headers: { accept: 'text/event-stream' } })
  const reader = stream.body.getReader()
  assert.match(new TextDecoder().decode((await reader.read()).value), /connected/)
  await reader.cancel()
  const sse = await call('/mcp', { method: 'POST', raw: true, headers: { accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: 6, method: 'ping' } })
  assert.match(await sse.text(), /event: message\ndata: .*"id":6/)

  await tool('capabilities', {})
  const project = await call(api + '/projects', { method: 'POST', status: 201,
    data: { name: 'Smoke spacer', template: 'builtin-shaft-spacer' } })
  const { projectId, baseRevision } = project
  const path = api + '/projects/' + projectId
  const draft = revision => path + '/drafts/' + revision
  assert((await call(api + '/projects')).projects.some(row => row.projectId === projectId))
  await tool('authorizeProject', { projectId }, { key: peerKey })
  await tool('getContext', { projectId })
  await tool('getExternalActivities', { projectId })
  await tool('readWriterContext', { projectId })
  const firstLease = await tool('acquireWriter', { projectId, expectedWriterEpoch: 0 })
  assert.equal((await call(path + '/writer', { method: 'POST', key: peerKey, status: 409,
    data: { expectedWriterEpoch: firstLease.writerEpoch } })).error.code, 'WRITER_OCCUPIED')
  await tool('revokeWriter', { projectId })
  await tool('takeOverWriter', { projectId, expectedWriterEpoch: firstLease.writerEpoch + 1 })
  await tool('describe_project', { path: path + '/archive' })
  const request = (revision, checksetFingerprint, confirmationToken) => ({
    projectId, baseRevision, draftRevision: revision, checksetFingerprint, confirmationToken, requestId: 'smoke-commit',
  })
  async function review(revision) {
    const response = await call(draft(revision) + '/review', { raw: true, headers: { 'x-cunlian-approval': human } })
    const { value } = await response.json()
    assert(matches(value.review, openapi.components.schemas.CheckSet))
    return { ...value.review, token: response.headers.get('x-cunlian-confirmation-token') }
  }

  let current = project.draftRevision
  let bad
  let good
  for (const [lengthQ, minQ, maxQ, pass] of [
    [120000, 1500, 2500, true], [120400, 1100, 2100, true], [121000, 500, 1500, false], [120500, 1000, 2000, true],
  ]) {
    const { draftRevision } = await tool('stageChange', { projectId, change: {
      baseRevision, expectedDraftRevision: current, idempotencyKey: 'smoke-' + lengthQ,
      operation: { type: 'createSpacerDraft', lengthQ }, sources: { lengthQ: { type: 'userInput' } },
    } })
    current = draftRevision
    const parameters = { innerDiameterQ: 200000, outerDiameterQ: 320000, lengthQ }
    const sameSource = computeSpacerChain(parameters)
    const options = { samples: 5000, distribution: 'normal', seed: 137 }
    const simulation = await call(draft(current) + '/simulation', { method: 'POST',
      data: { chain: sameSource.chain, monteCarlo: options } })
    assert(matches(simulation.extreme, openapi.components.schemas.Extreme))
    assert(matches(simulation.statistical, openapi.components.schemas.Statistics))
    assert.deepEqual(simulation.extreme, sameSource.result)
    assert.deepEqual(simulation.statistical, statisticalSummaryOf(sameSource.chain, sameSource.result, options))
    assert.deepEqual([simulation.extreme.minQ, simulation.extreme.maxQ], [minQ, maxQ])
    await tool('calc_chain', { parameters })
    await tool('check_requirement', { cQ: minQ, cMaxQ: maxQ, lowerQ: 1000, upperQ: 3000 })
    const checked = await call(draft(current) + '/checks', { method: 'POST' })
    assert.equal(checked.checks[0].status, pass ? 'pass' : 'fail')
    good = await review(current)
    assert.equal(good.checksetFingerprint, checked.checksetFingerprint)
    if (!pass) {
      bad = good
      assert.equal((await call(draft(current) + '/commit', { method: 'POST', status: 422,
        data: request(current, bad.checksetFingerprint, bad.token) })).error.code, 'CHECKS_BLOCKED')
    }
    console.log('spacer lengthQ=' + lengthQ + ' interval=' + minQ + '..' + maxQ + ' ' + checked.checks[0].status)
  }
  assert.equal((await call(draft(current) + '/commit', { method: 'POST', status: 409,
    data: request(current, bad.checksetFingerprint, bad.token) })).error.code, 'STALE_CHECKSET')
  assert.equal((await call(draft(current) + '/commit', { method: 'POST', status: 422,
    data: request(current, good.checksetFingerprint, bad.token) })).error.code, 'CONFIRMATION_INVALID')
  const mesh = await call(draft(current) + '/mesh')
  assert(matches(mesh, openapi.components.schemas.Mesh))
  assert(mesh.indices.length > 0)
  assert((await call(draft(current) + '/geometry', { method: 'POST', data: {} })).geometryFingerprint)
  const committed = await call(draft(current) + '/commit', { method: 'POST', status: 201,
    data: request(current, good.checksetFingerprint, good.token) })
  assert.deepEqual(await call(draft(current) + '/commit'), { state: 'committed', result: committed })
  assert.equal((await call(draft(current) + '/commit', { method: 'POST', status: 409,
    data: request(current, good.checksetFingerprint, good.token) })).error.code, 'STALE_BASE')
  assert((await call(path + '/events?afterSequence=0&limit=100')).events.some(row => row.type === 'project_revision_committed'))

  async function drawing(prefix, pattern = /<svg/) {
    let fingerprint
    for (const [format, content] of [['svg', pattern], ['dxf-r12', /AC1009/], ['dxf-2000', /AC1015/]]) {
      const response = await call(prefix + '/drawing/' + format, { raw: true })
      assert.match(await response.text(), content)
      const received = response.headers.get('x-drawing-fingerprint')
      assert.match(received, /\S/)
      if (fingerprint) assert.equal(received, fingerprint)
      fingerprint = received
    }
  }
  await drawing(draft(current))
  const rendered = await tool('render_drawing', { parameters: { innerDiameter: '20.00', outerDiameter: '32.00', length: '12.05' },
    format: 'svg', outputDir: '/exports' })
  const artifact = await call(rendered.filePath, { raw: true })
  assert.equal(digest(Buffer.from(await artifact.arrayBuffer())), rendered.sha256)
  await call(rendered.filePath, { key: peerKey, status: 404 })

  const form = new FormData()
  form.set('kind', 'pdf')
  form.set('fileName', 'mounting-plate-taskbook.pdf')
  form.set('file', new Blob([taskbook]), 'mounting-plate-taskbook.pdf')
  const plate = await call(api + '/projects/import', { method: 'POST', status: 201, data: form })
  const platePath = api + '/projects/' + plate.projectId
  assert(plate.draftRevision, 'PDF taskbook should seed mounting plate')
  const builtIn = await call(api + '/projects', { method: 'POST', status: 201, data: { name: 'fixture', template: 'builtin-mounting-plate' } })
  const fixtureMesh = await call(api + '/projects/' + builtIn.projectId + '/drafts/' + builtIn.draftRevision + '/mesh')
  assert(matches(fixtureMesh, openapi.components.schemas.Mesh))
  const plateEvents = await call(platePath + '/events')
  const attachmentId = plateEvents.events.find(row => row.type === 'attachment_uploaded').attachmentId
  const pdfPath = platePath + '/attachments/' + attachmentId
  await tool('read_taskbook', { pdfPath })
  const bytes = await call(pdfPath, { raw: true })
  assert.equal(digest(Buffer.from(await bytes.arrayBuffer())), digest(taskbook))
  const inspection = await inspectSourcePdf(taskbook)
  const { model } = interpret(await importRequirements({ bytes: taskbook, documentRef: pdfPath,
    documentName: 'mounting-plate-taskbook.pdf', sha256: digest(taskbook), pageCount: inspection.pageCount }))
  const direct = await runMountingPlate({ ...model, revision: plate.draftRevision })
  const plateDraft = platePath + '/drafts/' + plate.draftRevision
  const plateChecks = await call(plateDraft + '/checks', { method: 'POST' })
  for (const id of ['MP-03', 'MP-05', 'fixedPose']) {
    const source = direct.checks.find(row => row.id === id)
    const exposed = JSON.parse(plateChecks.checks.find(row => row.checkId === id).summary)
    for (const field of ['intervalMm', 'nominalMm', 'relation', 'marginMm', 'status']) assert.deepEqual(exposed[field], source[field])
  }
  const clean = mesh => Object.fromEntries(Object.entries(mesh).filter(([key]) => key !== 'frameId'))
  const plateMesh = await call(plateDraft + '/mesh')
  assert.deepEqual(clean(plateMesh.plate), clean(direct.mesh.plate))
  assert.deepEqual(clean(plateMesh.cover), clean(direct.mesh.cover))
  assert.equal(createMountingPlate().holes.length, model.holes.length)
  await drawing(plateDraft, /<circle/)
  await tool('acquireWriter', { projectId: plate.projectId, expectedWriterEpoch: 0 })
  const moved = await tool('moveRightHoleX', { projectId: plate.projectId, baseRevision: plate.baseRevision,
    expectedDraftRevision: plate.draftRevision, idempotencyKey: 'move', deltaQ: 1000 })
  assert.notEqual(moved.revision, plate.draftRevision)
  assert.equal(pairs.size, 15)
  assert.equal((await call('/review/' + projectId + '/' + current, { key: '', raw: true })).status, 200)
  console.log('mounting plate PDF, mesh, edge, clearance and fixed pose match the desktop engine')
  console.log('15 MCP tools exercised and their successful results validated')
}
