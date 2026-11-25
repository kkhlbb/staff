import '../../mcp/register-ts.mjs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHmac } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { VolumeStorageAdapter } from './storage.mjs'
import { configFrom } from './config.mjs'
import { startWebhooks } from './webhooks.mjs'

const { createCloudServer } = await import('./index.mjs')
const { runScenario } = await import('./scenario.mjs')
const { decodeProjectFile } = await import('../../src/project-file/codec.ts')
const apiKey = 'test-writer-cloud-secret'
const peerKey = 'test-secondary-cloud-secret'
const human = 'test-approval-cloud-secret'
const roster = [{ name: 'operator', key: apiKey, write: true, takeover: true }, { name: 'peer', key: peerKey, write: true }]
const taskbook = await readFile(new URL('../../desktop/tests/fixtures/agent-refactor/mounting-plate-taskbook.pdf', import.meta.url))
const quiet = () => {}

async function fixture(t, env = {}) {
  const root = await mkdtemp(join(tmpdir(), 'cunlian-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const config = configFrom({ CUNLIAN_DATA: root, CUNLIAN_KEYS: JSON.stringify(roster),
    CUNLIAN_APPROVAL_SECRET: human, ...env })
  async function start() {
    const service = await createCloudServer(config, quiet)
    await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve))
    const origin = 'http://127.0.0.1:' + service.server.address().port
    const request = (path, { key = apiKey, headers, body, ...request } = {}) => fetch(origin + path, {
      ...request, headers: { authorization: 'Bearer ' + key, ...headers,
        ...(body !== undefined && !(body instanceof FormData) && { 'content-type': 'application/json' }) },
      ...(body !== undefined && { body: body instanceof FormData ? body : JSON.stringify(body) }),
      signal: AbortSignal.timeout(4000),
    })
    return { ...service, origin, request }
  }
  return { start, root }
}

async function value(response, status = 200) {
  const content = await response.json()
  assert.equal(response.status, status, JSON.stringify(content))
  return content.value ?? content
}

function form(kind, fileName, file) {
  const data = new FormData()
  data.set('kind', kind)
  data.set('fileName', fileName)
  data.set('file', new Blob([file]), fileName)
  return data
}

test('HTTP, remote MCP, and all five same-source numerical scenarios', async t => {
  const { start } = await fixture(t)
  const service = await start()
  try {
    await runScenario({ origin: service.origin, apiKey, peerKey, human, taskbook })
  } finally {
    await service.close()
  }
})

test('project attachments, archive import, and formal revisions round-trip through the volume', async t => {
  const { start } = await fixture(t)
  let service = await start()
  const projects = '/api/v1/projects'
  try {
    const project = await value(await service.request(projects, { method: 'POST', body: { name: 'archive', template: 'builtin-shaft-spacer' } }), 201)
    const path = projects + '/' + project.projectId
    await value(await service.request(path + '/writer', { method: 'POST', body: { expectedWriterEpoch: 0 } }))
    const data = Buffer.from('solid fixture\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid fixture\n')
    const model = await value(await service.request(path + '/attachments', { method: 'POST', body: form('stl', 'test.stl', data) }), 201)
    const step = await value(await service.request(path + '/attachments', { method: 'POST', body: form('step', 'test.step', Buffer.from('ISO-10303-21;')) }), 422)
    assert.equal(step.error.code, 'FEATURE_DISABLED')
    const draftPath = path + '/drafts/' + project.draftRevision
    const review = await service.request(draftPath + '/review', { headers: { 'x-cunlian-approval': human } })
    const { review: checks } = await value(review)
    const result = await value(await service.request(draftPath + '/commit', { method: 'POST', body: {
      ...project, name: undefined, checksetFingerprint: checks.checksetFingerprint,
      confirmationToken: review.headers.get('x-cunlian-confirmation-token'), requestId: 'archive',
    } }), 201)
    await service.close()
    service = await start()
    assert.equal((await value(await service.request(draftPath + '/commit'))).result.committedRevision, result.committedRevision)
    assert.deepEqual(Buffer.from(await (await service.request(model.path)).arrayBuffer()), data)
    const state = await service.storage.read(project.projectId)
    const archive = Buffer.from(state.archive, 'base64')
    const decoded = await decodeProjectFile(archive)
    assert(decoded.ok)
    assert.equal(decoded.value.snapshot.project.currentRevisionId, result.committedRevision)
    assert.equal(decoded.value.snapshot.events.at(-1).type, 'project_revision_committed')
    assert.equal(decoded.value.snapshot.project.modelRevisions[0].triangleCount, 1)
    assert.equal(decoded.value.snapshot.project.drawings[0].revisionId, result.committedRevision)
    const imported = await value(await service.request(projects + '/import', { method: 'POST', body: form('cunlian', 'saved.cunlian', archive) }), 201)
    const oldModel = await service.request(projects + '/' + imported.projectId + '/attachments/' + model.revisionId)
    assert.deepEqual(Buffer.from(await oldModel.arrayBuffer()), data)
    assert.equal((await service.request(projects + '/' + project.projectId, { key: peerKey })).status, 403)
  } finally {
    await service.close()
  }
})

test('simultaneous lease acquisition is serialized; expired holders cannot stage', async t => {
  const { start } = await fixture(t, { CUNLIAN_LEASE_MS: '500' })
  const service = await start()
  try {
    const project = await value(await service.request('/api/v1/projects', { method: 'POST', body: { name: 'lease', template: 'chain-demo' } }), 201)
    const path = '/api/v1/projects/' + project.projectId
    await value(await service.request(path + '/authorization', { method: 'POST', key: peerKey }))
    const responses = await Promise.all([apiKey, peerKey].map(key =>
      service.request(path + '/writer', { method: 'POST', key, body: { expectedWriterEpoch: 0 } })))
    assert.deepEqual(responses.map(item => item.status).sort(), [200, 409])
    const winner = responses[0].status === 200 ? apiKey : peerKey
    await delay(550)
    const expired = await value(await service.request(path + '/drafts/changes', { method: 'POST', key: winner, body: {
      change: { baseRevision: project.baseRevision, expectedDraftRevision: project.draftRevision, idempotencyKey: 'expired',
        operation: { type: 'createSpacerDraft' }, sources: {} },
    } }), 409)
    assert.equal(expired.error.code, 'WRITER_LEASE_REQUIRED')
  } finally {
    await service.close()
  }
})

test('legacy SSE and principal tool scopes', async t => {
  const scoped = [{ name: 'operator', key: apiKey, write: true, tools: ['capabilities'] }, roster[1]]
  const { start } = await fixture(t, { CUNLIAN_KEYS: JSON.stringify(scoped) })
  const { request, close } = await start()
  try {
    const response = await request('/sse', { headers: { accept: 'text/event-stream' } })
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const endpoint = decoder.decode((await reader.read()).value).match(/data: (\/messages\?sessionId=\S+)/)[1]
    const body = { jsonrpc: '2.0', id: 1, method: 'tools/list' }
    assert.equal((await request(endpoint, { key: peerKey, method: 'POST', body })).status, 404)
    assert.equal((await request(endpoint, { method: 'POST', body })).status, 202)
    const frame = decoder.decode((await reader.read()).value).split('data: ')[1]
    assert.deepEqual(JSON.parse(frame).result.tools.map(row => row.name), ['capabilities'])
    await reader.cancel()
    assert.equal((await request('/mcp', { method: 'POST', body: { jsonrpc: '2.0', method: 'notifications/initialized' } })).status, 202)
    assert.equal((await request('/mcp', { method: 'POST', headers: { 'mcp-protocol-version': 'bogus' }, body })).status, 400)
  } finally {
    await close()
  }
})

test('persisted webhook retries with a verified signature and removes delivery on success', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cunlian-webhook-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const storage = new VolumeStorageAdapter(root)
  await storage.init()
  const url = 'https://gateway.example.org/hook'
  const webhookSecret = 'test-signing-cloud-secret'
  const config = configFrom({ CUNLIAN_API_KEY: apiKey, CUNLIAN_WEBHOOK_URLS: url, CUNLIAN_WEBHOOK_SECRET: webhookSecret })
  await storage.write('test', { outbox: [{ url, result: { projectId: 'test', committedRevision: 'r1' }, attempts: 0, next: 0 }] })
  const calls = []
  const rows = []
  const stop = startWebhooks(storage, config, row => rows.push(row), {
    pollMs: 10, retryMs: 10,
    deliver: async (received, options) => {
      calls.push({ received, options })
      return new Response(null, { status: calls.length === 1 ? 503 : 204 })
    },
  })
  try {
    const deadline = Date.now() + 3000
    while (rows.length < 2 && Date.now() < deadline) await delay(10)
    assert.deepEqual(rows.map(row => row.delivered), [false, true])
    assert.deepEqual((await storage.read('test')).outbox, [])
    for (const { received, options } of calls) {
      assert.equal(received.href, url)
      assert.equal(options.redirect, 'error')
      const expected = createHmac('sha256', webhookSecret).update(options.headers['x-cunlian-timestamp'] + '.' + options.body).digest('hex')
      assert.equal(options.headers['x-cunlian-signature'], 'sha256=' + expected)
    }
  } finally {
    stop()
  }
})

test('3D cannot advertise readiness on a runtime without the assembly kernel', () => {
  assert.throws(
    () => configFrom({ CUNLIAN_API_KEY: apiKey, FEATURE_3D_ASSEMBLY_M1: 'true' }, { assemblyKernelAvailable: false }),
    /assembly kernel/,
  )
})

test('dual-state FEATURE_3D_ASSEMBLY_M1 reports false by default and true when enabled with Track B kernel', async t => {
  const offFixture = await fixture(t, { FEATURE_3D_ASSEMBLY_M1: 'false' })
  const offService = await offFixture.start()
  try {
    assert.deepEqual(await (await fetch(offService.origin + '/healthz')).json(), { status: 'ok' })
    const capsOff = await value(await offService.request('/api/v1/capabilities'))
    assert.equal(capsOff.FEATURE_3D_ASSEMBLY_M1, false)
    assert.deepEqual(capsOff.attachments, ['pdf', 'stl'])
  } finally {
    await offService.close()
  }

  const onFixture = await fixture(t, { FEATURE_3D_ASSEMBLY_M1: 'true' })
  const onService = await onFixture.start()
  try {
    assert.deepEqual(await (await fetch(onService.origin + '/healthz')).json(), { status: 'ok' })
    const capsOn = await value(await onService.request('/api/v1/capabilities'))
    assert.equal(capsOn.FEATURE_3D_ASSEMBLY_M1, true)
    assert.deepEqual(capsOn.attachments, ['pdf', 'stl', 'step'])
  } finally {
    await onService.close()
  }
})

test('expired human token cannot commit a still-current draft', async t => {
  const { start } = await fixture(t, { CUNLIAN_CONFIRMATION_MS: '120' })
  const { request, close } = await start()
  try {
    const project = await value(await request('/api/v1/projects', { method: 'POST', body: { name: 'expiry', template: 'chain-demo' } }), 201)
    const path = '/api/v1/projects/' + project.projectId
    await value(await request(path + '/writer', { method: 'POST', body: { expectedWriterEpoch: 0 } }))
    const draft = path + '/drafts/' + project.draftRevision
    const review = await request(draft + '/review', { headers: { 'x-cunlian-approval': human } })
    const { review: checks } = await value(review)
    const token = review.headers.get('x-cunlian-confirmation-token')
    await delay(150)
    const result = await value(await request(draft + '/commit', { method: 'POST', body: {
      projectId: project.projectId, baseRevision: project.baseRevision, draftRevision: project.draftRevision,
      checksetFingerprint: checks.checksetFingerprint, confirmationToken: token, requestId: 'expired',
    } }), 422)
    assert.equal(result.error.code, 'CONFIRMATION_INVALID')
    assert.deepEqual(await value(await request(draft + '/commit')), { state: 'awaiting-confirmation' })
  } finally {
    await close()
  }
})

test('HttpTransport getReview -> commitDraft succeeds end-to-end with server-issued confirmation token', async t => {
  const { createHttpTransport } = await import('../../src/transport/httpTransport.ts')
  const { start } = await fixture(t)
  const { origin, request, close } = await start()
  try {
    const transport = createHttpTransport({ baseUrl: origin, apiKey, approvalSecret: human })
    const created = await transport.createProject({ name: 'http-e2e', template: 'builtin-shaft-spacer' })
    assert.equal(created.ok, true)
    const { projectId, baseRevision, draftRevision } = created.value
    const lease = await transport.acquireWriter({ projectId, expectedWriterEpoch: 0 })
    assert.equal(lease.ok, true)

    const rawReview = await request(`/api/v1/projects/${projectId}/drafts/${draftRevision}/review`, {
      headers: { 'x-cunlian-approval': human },
    })
    const exposed = rawReview.headers.get('access-control-expose-headers') ?? ''
    assert.match(exposed, /X-Cunlian-Confirmation-Token/i)
    assert.match(exposed, /X-Drawing-Fingerprint/i)

    const review = await transport.getReview({ projectId, draftRevision })
    assert.equal(review.ok, true)
    assert.ok(review.value.confirmationToken, 'expected server-issued confirmationToken from getReview()')

    const committed = await transport.commitDraft({
      projectId,
      baseRevision,
      draftRevision,
      checksetFingerprint: review.value.review.checksetFingerprint,
      confirmationToken: review.value.confirmationToken,
      requestId: 'http-e2e-commit-1',
    })
    assert.equal(committed.ok, true, JSON.stringify(committed))
    assert.equal(committed.value.committedDraftRevision, draftRevision)

    const status = await transport.getCommitStatus({ projectId, draftRevision })
    assert.equal(status.ok, true)
    assert.equal(status.value.state, 'committed')
    assert.equal(status.value.result.committedRevision, committed.value.committedRevision)
  } finally {
    await close()
  }
})
