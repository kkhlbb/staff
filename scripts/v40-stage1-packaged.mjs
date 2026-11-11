import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { serializeEvidence } from './evidence-json.ts'
const appDir = path.resolve('out/寸链-darwin-arm64/寸链.app')
const exe = path.join(appDir, 'Contents/MacOS/寸链')
const seed = path.resolve(process.argv[2] ?? 'docs/evidence/v40-stage1/fixtures/a40-01-seed.cunlian')
const dir = 'docs/evidence/v40-stage1'
const port = 9341
const existing = spawnSync('pgrep', ['-fx', exe], { encoding: 'utf8' })
const isolatedHome = process.env.V40_APP_HOME
if (existing.status === 0 && !isolatedHome) throw new Error('BLOCKED: packaged app already running; will not take over user process')
const before = await fs.readFile(seed)
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
if (isolatedHome) {
  await fs.mkdir(path.join(isolatedHome, 'Library/Application Support'), { recursive: true })
  env.HOME = isolatedHome
  env.CFFIXED_USER_HOME = isolatedHome
}
const marker = `--v40-stage1-evidence=${Date.now()}`
const launchArgs = ['-n', '-W', '-a', appDir, '--stdout', path.resolve(dir, 'logs/packaged-main.stdout.log'), '--stderr', path.resolve(dir, 'logs/packaged-main.stderr.log'), '--env', 'ELECTRON_RUN_AS_NODE', ...(isolatedHome ? ['--env', `HOME=${isolatedHome}`, '--env', `CFFIXED_USER_HOME=${isolatedHome}`] : []), seed, '--args', `--remote-debugging-port=${port}`, marker]
const child = spawn('open', launchArgs, { env, stdio: ['ignore', 'pipe', 'pipe'] })
let appOutput = ''
child.stdout.on('data', data => { appOutput += data })
child.stderr.on('data', data => { appOutput += data })
let socket
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
try {
  let target
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`app exited ${child.exitCode}: ${appOutput}`)
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page') } catch { /* wait for CDP */ }
    if (target) break
    await sleep(200)
  }
  if (!target) throw new Error('BLOCKED: no packaged CDP target')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  let seq = 0; const pending = new Map()
  socket.addEventListener('message', e => { const r = JSON.parse(e.data); if (pending.has(r.id)) { pending.get(r.id)(r); pending.delete(r.id) } })
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve); socket.addEventListener('error', reject) })
  function send(method, params) { const id = ++seq; return new Promise(resolve => { pending.set(id, resolve); socket.send(JSON.stringify({ id, method, params })) }) }
  async function evaluate(expression) {
    let timer
    const response = await Promise.race([
      send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('CDP evaluation timed out')), 30_000) }),
    ]).finally(() => clearTimeout(timer))
    if (response.result?.exceptionDetails) throw new Error(JSON.stringify(response.result.exceptionDetails))
    return response.result?.result?.value
  }
  await sleep(1000)
  // open -n delivered the seed only to the newly launched, isolated test instance.
  let attached = await evaluate('window.cunlian?.reattachSession()')
  if (attached?.ok && attached.value?.session === null) {
    const opened = await evaluate('window.cunlian.openProject()')
    if (!opened?.ok) throw new Error(`open queued seed failed: ${JSON.stringify(opened)}`)
  }
  for (let i = 0; i < 100; i++) {
    attached = await evaluate('window.cunlian?.reattachSession()')
    if (attached?.ok && attached.value?.snapshot?.project?.id === 'v40-stage1-seed') break
    await sleep(200)
  }
  if (attached?.value?.snapshot?.project?.id !== 'v40-stage1-seed') throw new Error(`seed not active: ${JSON.stringify(attached)}`)
  async function chain() {
    const api = window.cunlian, trace = []
    async function call(name, input, summary) {
      const start = performance.now(), callerRequest = input?.requestId ?? crypto.randomUUID()
      const output = await api[name](input)
      trace.push({ step: trace.length + 1, tool: name, input, output: summary ? summary(output) : output,
        elapsedMs: performance.now() - start, requestId: output.requestId ?? callerRequest,
        requestIdOrigin: output.requestId ? 'service' : 'caller-correlation-legacy-ipc' })
      if (!output.ok) throw new Error(`${name}: ${JSON.stringify(output)}`)
      return output.data ?? output.value
    }
    const initial = await api.reattachSession()
    let seq = initial.value.editSeq
    const sessionId = initial.value.sessionId, baseRevisionId = initial.value.snapshot.project.currentRevisionId
    const run = await call('runExtraction', { sessionId, baseEditSeq: seq, revisionId: 'sr-1', pageFrom: 1, pageTo: 2, requestId: crypto.randomUUID() }, r => ({ ok: r.ok, candidateCount: r.value?.candidateCount, draftId: r.value?.draftId, acceptedSeq: r.value?.acceptedSeq }))
    seq = run.acceptedSeq
    const extraction = run.snapshot.project.extractionDrafts.find(d => d.draftId === run.draftId)
    let planToken
    for (const c of extraction.candidates) {
      const decision = await call('decideExtraction', { sessionId, baseEditSeq: seq, draftId: extraction.draftId, candidateId: c.candidateId, editRevision: c.editRevision, action: 'confirm', confirmed: true }, r => ({ ok: r.ok, status: r.value?.status, decisionId: r.value?.decisionId, planTokenIssued: Boolean(r.value?.planToken), acceptedSeq: r.value?.acceptedSeq }))
      seq = decision.acceptedSeq; planToken = decision.planToken
    }
    const inputs = await call('getConfirmedInputs', { draftId: extraction.draftId }, r => ({ ok: r.ok, objectVersion: r.objectVersion, candidates: r.data?.candidates.map(c => ({ kind: c.kind, status: c.status, editRevision: c.editRevision })), decisions: r.data?.decisions.length }))
    const request = { planToken, baseRevisionId, candidateIds: inputs.candidates.map(c => c.candidateId), mapping: {
      spacerPart: 'builtin:shaft-demo:spacer', ringSymbols: ['H', 'B1', 'S', 'B2'], formulaId: inputs.candidates.find(c => c.kind === 'formula').candidateId, requirement: true, linkLengthToSymbol: 'S',
    } }
    const summarize = r => ({ ok: r.ok, objectVersion: r.objectVersion, draftId: r.data?.draftId, draftRevision: r.data?.draftRevision, geometry: r.data?.geometry, checkStatus: r.data?.checkStatus, result: r.data?.computation?.result, requirementPreview: r.data?.requirementPreview, missing: r.data?.missing })
    const applied = await call('applyConfirmedInputs', request, summarize)
    const duplicate = await call('applyConfirmedInputs', request, summarize)
    const preview = await call('previewAndCheck', { toolMode: 'agent', draftId: applied.draftId, baseRevisionId }, summarize)
    const context = await call('getProjectContext', undefined, r => ({ ok: r.ok, objectVersion: r.objectVersion, projectId: r.data?.projectId, revisionId: r.data?.revisionId, draftId: r.data?.draft?.draftId, formalParameters: r.data?.parameters }))
    const staged = await call('stageParameterChange', { toolMode: 'agent', draftId: applied.draftId, baseRevisionId, parameter: 'length', deltaMm: '0.04', lockedKeys: ['innerDiameter', 'outerDiameter'] }, summarize)
    const changedPreview = await call('previewAndCheck', { toolMode: 'agent', draftId: staged.draftId, baseRevisionId }, summarize)
    const final = await api.reattachSession()
    return { trace, applied, duplicateId: duplicate.draftId, preview, changedPreview, currentDraftId: context.draft.draftId,
      formalUnchanged: JSON.stringify(final.value.snapshot.project.dimensionChain) === JSON.stringify(initial.value.snapshot.project.dimensionChain) && final.value.snapshot.project.currentRevisionId === baseRevisionId && final.value.snapshot.project.parameters.length === 0 && final.value.snapshot.project.requirementRevisions.length === 0,
      sourceSha256: extraction.sourceIdentity.sha256, candidateCount: inputs.candidates.length,
      runtime: { electron: navigator.userAgent, location: location.href } }
  }
  const result = await evaluate(`(${chain.toString()})()`)
  if (!result) throw new Error('no chain result')
  const d = result.applied
  const assert = (name, condition) => { console.log(`${condition ? 'PASS' : 'FAIL'} ${name}`); if (!condition) throw new Error(name) }
  assert('7 real-PDF candidates confirmed', result.candidateCount === 7)
  assert('geometry 20/32/12 mm q', JSON.stringify(d.geometry) === JSON.stringify({ innerDiameterQ: 200000, outerDiameterQ: 320000, lengthQ: 120000 }))
  assert('chain directions H-B1-S-B2', JSON.stringify(d.chain.terms.map(t => [t.symbol, t.nominalQ, t.lowerDeviationQ, t.upperDeviationQ, t.sign])) === JSON.stringify([['H',522000,-200,200,1],['B1',200000,-100,100,-1],['S',120000,-100,100,-1],['B2',200000,-100,100,-1]]))
  assert('length binding', d.bindings.length === 1 && d.bindings[0].termId === 't-s' && d.bindings[0].parameterId === 'param:spacer:length')
  assert('draft-only requirement [0.1000,0.3000]', d.requirementEdit.lowerText === '0.1000' && d.requirementEdit.upperText === '0.3000' && d.requirementPreview.status === 'pending-confirmation')
  assert('baseline [0.1500,0.2500]', result.preview.computation.result.minQ === 1500 && result.preview.computation.result.maxQ === 2500)
  assert('drawing parameters same q', JSON.stringify(d.computation.drawing.data.parameterSnapshot.map(p => p.valueQ)) === JSON.stringify([200000,320000,120000]))
  assert('idempotent draft identity', result.duplicateId === d.draftId && result.currentDraftId === d.draftId)
  assert('increment is integer-q and preview checks [0.1100,0.2100]', result.changedPreview.geometry.lengthQ === 120400 && result.changedPreview.computation.result.minQ === 1100 && result.changedPreview.computation.result.maxQ === 2100)
  assert('formal version and target untouched', result.formalUnchanged)
  assert('seed project disk bytes untouched', before.equals(await fs.readFile(seed)))
  const draftPath = path.join(isolatedHome ?? process.env.HOME, 'Library/Application Support/寸链/workspace/agent-inputs', `${createHash('sha256').update('v40-stage1-seed').digest('hex')}.json`)
  const persisted = JSON.parse(await fs.readFile(draftPath, 'utf8'))
  assert('actual workspace draft+recovery record read back', persisted.payload.draft.draftId === d.draftId && persisted.payload.recovery.basePath === seed)
  await fs.writeFile(`${dir}/a40-01-packaged-trace.json`, serializeEvidence({ ...result, persistedDraftPath: draftPath, seedSha256: createHash('sha256').update(before).digest('hex'), generatedAt: new Date().toISOString() }))
  console.log(`PASS packaged A40-01 trace written; steps=${result.trace.length}`)
} finally {
  socket?.close()
  // Terminate ONLY the process carrying our unique launch marker, never a pre-existing app.
  const processes = spawnSync('ps', ['-axo', 'pid,args'], { encoding: 'utf8' }).stdout ?? ''
  for (const line of processes.split('\n')) {
    const match = /^\s*(\d+)\s+(.*)$/u.exec(line)
    if (match && match[2].startsWith(`${exe} `) && match[2].includes(marker)) process.kill(Number(match[1]), 'SIGKILL')
  }
  child.kill('SIGKILL')
  await fs.writeFile(`${dir}/logs/packaged-runtime.log`, appOutput)
}
