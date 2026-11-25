import { createHash, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import type { IpcMainInvokeEvent } from 'electron'
import { expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../shared/contracts'
import { installM2PreviewChannels } from '../main/project-agent/m2/channels'
import { runMountingPlate, runMountingPlateDrawing } from '../main/project-agent/m2/engine.mjs'
import { openM2DraftStore } from '../main/project-agent/m2/draftStore'
import { M2Pipeline } from '../main/project-agent/m2/pipeline'
import type { M2PreviewEvent, M2Result } from '../shared/project-agent/m2-preview'

const projectId = 'plate-project'
async function source() {
  const bytes = await readFile(new URL('./fixtures/agent-refactor/mounting-plate-taskbook.pdf', import.meta.url))
  return { documentRef: 'source-1', documentName: 'mounting-plate-taskbook.pdf', bytes, pageCount: 2,
    sha256: createHash('sha256').update(bytes).digest('hex') }
}
function stream(pipeline: M2Pipeline) {
  const events: M2PreviewEvent[] = []
  pipeline.subscribe(event => events.push(event))
  const wait = (revision: string, type: M2PreviewEvent['type']) =>
    vi.waitFor(() => expect(events.some(event => event.revision === revision && event.type === type)).toBe(true), { timeout: 15_000 })
  return { events, wait }
}

it('locates the actual PDF evidence with measured inputs, thresholds and linked annotations', async () => {
  const pipeline = new M2Pipeline(projectId, 2, 3)
  const { wait } = stream(pipeline)
  expect(await pipeline.importRequirements(await source())).toEqual({ jobId: expect.any(String), revision: 'draft-1' })
  await wait('draft-1', 'task_completed')
  for (const [requirementId, page, thresholdText] of [['MP-03', 1, '≥ 13 mm'], ['MP-05', 2, '≥ 1.5 mm']] as const) {
    const evidence = pipeline.locate({ projectId, revision: 'draft-1', target: { kind: 'check', checkId: requirementId, requirementId } })
    expect(evidence).toMatchObject({ anchors: [{ page, documentRef: 'source-1' }], thresholdText })
    expect(evidence.featureIds).not.toHaveLength(0)
    expect(evidence.annotationIds).not.toHaveLength(0)
    expect(evidence.inputs).not.toHaveLength(0)
  }
  expect(pipeline.snapshot().checks.map(check => check.status)).toEqual(Array(5).fill('pass'))
}, 20_000)

it('A08 fences a slow canceled drawing and retries an independently failed drawing', async () => {
  let release!: () => void
  const slow = new Promise<void>(resolve => { release = resolve })
  const build = vi.fn(runMountingPlate)
  const draw: typeof runMountingPlateDrawing = async (report, options) => {
    if (report.revision === 'draft-2') {
      await slow
      // Simulate a worker that delivered after cancellation.
      return runMountingPlateDrawing(report)
    }
    if (report.revision === 'draft-3' && options?.attempt === 1) {
      return runMountingPlateDrawing(report, { ...options, drawing: { convention: 'invalid' } })
    }
    return runMountingPlateDrawing(report, options)
  }
  const pipeline = new M2Pipeline(projectId, 2, 3, { build, draw })
  const { events, wait } = stream(pipeline)
  await pipeline.importRequirements(await source())
  await wait('draft-1', 'task_completed')
  const change = { kind: 'moveRightHoleX', deltaQ: 10_000 } as const
  const old = pipeline.stageChange('draft-1', 'move-1', change)
  await wait('draft-2', 'model_ready')
  expect(pipeline.cancelJob(old.jobId)).toBe(true)
  pipeline.stageChange('draft-2', 'move-2', change)
  await wait('draft-3', 'drawing_failed')
  expect(pipeline.snapshot()).toMatchObject({
    model: { revision: 'draft-3' }, drawing: { revision: 'draft-1', status: 'ready' },
    drawingFailure: { failedRevision: 'draft-3', reason: expect.stringContaining('projectionFailed') },
    checks: expect.arrayContaining([expect.objectContaining({ checkId: 'MP-03', status: 'fail', summary: '[12.75, 13.25] mm' })]),
  })
  release()
  const request = { projectId, revision: 'draft-3', requestId: 'retry-1' }
  const result = await pipeline.retryDrawing(request)
  expect(await pipeline.retryDrawing(request)).toEqual(result)
  expect(build).toHaveBeenCalledTimes(3)
  const current = pipeline.snapshot()
  expect(current.modelMesh).toMatchObject({ plate: { triangles: expect.any(Array) } })
  expect(current.drawingVector).toMatchObject({ revision: 'draft-3', views: expect.any(Array) })
  expect(current.drawing.fingerprint).toBe(current.model.fingerprint)
  expect(current.drawing.revision).toBe('draft-3')
  expect(events.filter(event => event.revision === 'draft-2').map(event => event.type)).toEqual(['model_ready', 'checks_updated'])
  expect(events.at(-1)).toMatchObject({ type: 'task_completed', fingerprint: result.fingerprint, scopeEpoch: 2, writerEpoch: 3 })
}, 20_000)

it('guards all M2 IPC methods using the caller frame and rechecks subscription delivery', async () => {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<M2Result<unknown>>>()
  const frame = { url: 'file:///workspace', send: vi.fn() }
  const event = { sender: { id: 2, mainFrame: frame }, senderFrame: frame } as unknown as IpcMainInvokeEvent
  const grant = { authorizationRef: 'grant' }
  let live = true
  const pdf = await source()
  const close = installM2PreviewChannels({ handle: (channel, handler) => handlers.set(channel, handler) }, {
    guard: { verify: (sender: { isMainFrame: boolean }) => sender.isMainFrame ? { ok: true } :
      { ok: false, error: { code: 'FORBIDDEN_SENDER', message: 'forbidden' } } } as never,
    sessionFor: () => ({ sessionId: 'test', projectId, path: '/project', fingerprint: 'fp' }),
    authority: { resolve: async () => grant, workbenchCut: async () => ({
      seal() { if (!live) throw Error('AUTH_REQUIRED') }, snapshot: { writerEpoch: 1 }, writable: true,
    }) } as never,
    sources: () => [pdf],
  })
  const methods = ['getM2PreviewSnapshot', 'locateM2Evidence', 'retryM2Drawing', 'submitM2Clarification', 'subscribeM2PreviewEvents'] as const
  for (const method of methods) {
    await expect(handlers.get(IPC_CHANNELS[method])!({ ...event, senderFrame: { url: frame.url } } as IpcMainInvokeEvent, {}))
      .resolves.toMatchObject({ ok: false, error: { code: 'FORBIDDEN_SENDER' } })
  }
  const token = randomUUID()
  await expect(handlers.get(IPC_CHANNELS.subscribeM2PreviewEvents)!(event, { projectId }, token)).resolves.toEqual({ ok: true, value: { subscriptionId: token } })
  await expect(handlers.get(IPC_CHANNELS.getM2PreviewSnapshot)!(event, { projectId })).resolves.toMatchObject({ ok: true })
  await vi.waitFor(() => expect(frame.send).toHaveBeenCalledWith(IPC_CHANNELS.m2PreviewEvent, token, expect.objectContaining({ type: 'task_completed' })), { timeout: 15_000 })
  expect(await handlers.get(IPC_CHANNELS.locateM2Evidence)!(event, {
    projectId, revision: 'draft-1', target: { kind: 'requirement', requirementId: 'MP-04' },
  })).toMatchObject({ ok: true, value: { anchors: [{ page: 2 }] } })
  expect(await handlers.get(IPC_CHANNELS.retryM2Drawing)!(event, {
    projectId, revision: 'draft-1', requestId: 'no-failure',
  })).toMatchObject({ ok: false, error: { code: 'DRAWING_NOT_RETRYABLE' } })
  const change = await close.modelChangePort(event, projectId)
  expect(change?.select('hole-2')).toContain('hole.right.axis')
  const staged = change?.stage('model-tool', 10_000)
  expect(staged).toMatchObject({ revision: 'draft-2', jobId: expect.any(String) })
  expect((await close.modelChangePort(event, projectId))?.stage('model-tool', 10_000)).toEqual(staged)
  await expect(handlers.get(IPC_CHANNELS.submitM2Clarification)!(event, {
    projectId, revision: 'draft-2', requestId: 'correction', targetId: 'MP-04',
    mode: 'correct_interpretation', content: 'Plate thickness: 8.5 ± 0.2 mm.',
  })).resolves.toMatchObject({ ok: true, value: { nextRevision: 'draft-3' } })
  const eventCount = frame.send.mock.calls.length
  live = false
  expect(() => change?.stage('revoked', 10_000)).toThrow('AUTH_REQUIRED')
  expect(await handlers.get(IPC_CHANNELS.getM2PreviewSnapshot)!(event, { projectId })).toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } })
  close.invalidate(2)
  await expect(handlers.get(IPC_CHANNELS.locateM2Evidence)!(event, {
    projectId, revision: 'draft-3', target: { kind: 'requirement', requirementId: 'MP-04' },
  })).resolves.toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } })
  expect(frame.send).toHaveBeenCalledTimes(eventCount)
}, 20_000)

function taskbookVariant(pages: string[][]) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${4 + 2 * i} 0 R`).join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>']
  for (const lines of pages) {
    const data = 'BT /F1 10 Tf 30 790 Td 14 TL ' + lines.map(line => {
      const escaped = line.replace(/[\\()]/g, '\\$&').replaceAll('Ø', '\\330').replaceAll('±', '\\261')
      return `(${escaped}) Tj T*`
    }).join(' ') + ' ET'
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 900 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objects.length + 2} 0 R >>`,
      `<< /Length ${data.length} >>\nstream\n${data}\nendstream`)
  }
  let file = '%PDF-1.4\n'
  const offsets = objects.map((object, i) => {
    const offset = file.length
    file += `${i + 1} 0 obj\n${object}\nendobj\n`
    return offset
  })
  const xref = file.length
  file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  const bytes = Buffer.from(file, 'ascii')
  return { bytes, pageCount: pages.length, documentRef: 'variant', documentName: 'mounting-plate-variant.pdf',
    sha256: createHash('sha256').update(bytes).digest('hex') }
}

it('A07 keeps missing datum, conflicting thickness and unsupported GD&T distinct through clarification and reopen', async ({ onTestFinished }) => {
  const input = taskbookVariant([
    ['MP-01 Plate 80 x 50 x 8 mm. Origin lower-left bottom corner. Length along X, width along Y.',
      'MP-02 Two Ø10 mm through holes run along Z. Left hole (20, 25) mm. Right hole (60, 25) mm.',
      'MP-03 X tolerance: ±0.2 mm. Y tolerance: ±0.2 mm. Diameter tolerance: ±0.1 mm. Edge shall be at least 13 mm.'],
    ['MP-04 Reference cover bottom face: Z = 10 ± 0.1 mm. Plate thickness: 9 ± 0.2 mm.',
      'MP-05 Clearance shall be at least 1.5 mm.',
      'MP-06 Flatness shall not exceed 0.02 mm.'],
  ])
  const directory = await mkdtemp(path.join(tmpdir(), 'cunlian-m2-pipeline-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const store = openM2DraftStore(directory, projectId, 'verified-file')
  const pipeline = new M2Pipeline(projectId, 1, 1, undefined, undefined, store)
  const { wait } = stream(pipeline)
  await pipeline.importRequirements(input)
  await wait('draft-1', 'drawing_failed')
  expect(pipeline.snapshot().requirements.map(r => [r.requirementId, r.status])).toEqual([
    ['MP-01', 'confirmed'], ['MP-02', 'needsClarification'], ['MP-03', 'confirmed'],
    ['MP-04', 'conflict'], ['MP-05', 'confirmed'], ['MP-06', 'uncovered'],
  ])
  expect(pipeline.locate({ projectId, revision: 'draft-1', target: { kind: 'requirement', requirementId: 'MP-04' } }).anchors.map(a => a.page)).toEqual([1, 2])
  const answer = {
    projectId, revision: 'draft-1', targetId: 'MP-02', mode: 'answer', requestId: 'datum-1',
    content: 'Two Ø10 mm through holes run along Z. Left hole center (X, Y): (20, 25) mm. Right hole center (X, Y): (60, 25) mm.',
  } as const
  const result = pipeline.clarify(answer)
  expect(result.nextRevision).toBe('draft-2')
  expect(pipeline.clarify(answer)).toEqual(result)
  const thickness = pipeline.clarify({
    projectId, revision: 'draft-2', targetId: 'MP-04', mode: 'correct_interpretation', requestId: 'thick-1',
    content: 'Reference cover bottom face: Z = 10 ± 0.1 mm. Plate thickness: 8.5 ± 0.2 mm.',
  })
  expect(thickness.nextRevision).toBe('draft-3')
  await wait('draft-3', 'task_completed')
  const snapshot = pipeline.snapshot()
  expect(snapshot.model.isDraft).toBe(true)
  expect(snapshot.requirements.find(r => r.requirementId === 'MP-04')).toMatchObject({
    status: 'confirmed', interpretation: expect.stringContaining('8.5'), anchor: { page: 2, excerpt: expect.stringContaining('9 ±') },
  })
  expect(snapshot.checks.find(c => c.checkId === 'MP-05')).toMatchObject({ status: 'fail', summary: '[1.2, 1.8] mm' })
  expect(snapshot.checks.find(c => c.checkId === 'MP-06')?.status).toBe('uncovered')
  expect(snapshot.annotations.find(a => a.annotationId === 'plate.thickness')?.valueText).toBe('8.50 mm')
  pipeline.dispose()
  const reopened = new M2Pipeline(projectId, 2, 1, undefined, undefined, store)
  const resumed = stream(reopened)
  await reopened.importRequirements(input)
  await resumed.wait('draft-3', 'task_completed')
  expect(reopened.snapshot().model.fingerprint).toBe(snapshot.model.fingerprint)
  expect(reopened.snapshot().requirements).toEqual(snapshot.requirements)
  reopened.dispose()
}, 20_000)
