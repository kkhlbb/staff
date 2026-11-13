/**
 * Real product-service evidence, analogous to desktop/tests/intentExport.test.ts.
 * Run: INGEST_READINGS_MANIFEST=/absolute/manifest.json npx vitest run
 *      --config scripts/ingest-readings-evidence.config.ts
 * No OCR, mocked extraction, fabricated evidence, or model response injection.
 * Native open/save choosers alone are injected; disk IO and product services are real.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { createHarness } from '../desktop/tests/helpers/a04'
import { AgentToolService } from '../desktop/main/agentToolService'
import { ApprovalStore } from '../desktop/main/approvalStore'
import { createIntentProjectSnapshot } from '../desktop/main/intentProject'
import { ExtractionService } from '../desktop/main/extractionService'
import { registerSourceChannels } from '../desktop/main/sourceChannels'
import { registerDrawingChannels } from '../desktop/main/drawingChannels'
import { DrawingExportStore } from '../desktop/main/drawingExportStore'
import { extractPdfTextPages } from '../desktop/main/pdfTextExtract'
import { inspectSourcePdf } from '../desktop/main/pdfSourceInspect'
import { IPC_CHANNELS, type SourceImportValue, type DrawingExportValue } from '../desktop/shared/contracts'
import { decodeProjectFile, encodeProjectFile } from '../src/project-file/codec'
import { planApplication } from '../src/document-extraction'
import { stableFingerprint } from '../src/revisions/canonical'
import { serializeEvidence } from './evidence-json'

type Reading = {
  kind: 'dimension'; symbol: string; nominalQ: number
  upperDeviationQ: number; lowerDeviationQ: number; unit: 'mm'
}
type Manifest = {
  seedFile?: string
  pdfFile?: string
  page: number
  statement: string
  // Human transcription with source locator; never asserted to be OCR output.
  truth: Reading[]
  truthLocator: string
  // Exactly one nominal is deliberately 10x truth. The script does NOT auto-correct it.
  readings: Reading[]
  // Existing PDF path needs explicit production mapping. Intent projects use applyIntentDraft.
  mapping?: Record<string, unknown>
  // These are explicit human-provided supporting engineering facts, NOT PDF text.
  setup?: { command: 'setChain' | 'setBinding' | 'setRequirement'; input: Record<string, unknown>; userText: string }[]
}
const ROOT = process.cwd()
const OUT = path.join(ROOT, 'docs/evidence/ingest-readings')
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const objects = (value: unknown): Record<string, unknown>[] => {
  if (value === null || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(objects)
  return [value as Record<string, unknown>, ...Object.values(value).flatMap(objects)]
}
function must<T extends { ok: boolean }>(value: T): asserts value is T & { ok: true } {
  expect(value.ok, JSON.stringify(value)).toBe(true)
}
function validate(manifest: Manifest) {

  expect(manifest.truthLocator, 'Manual transcription must name a real source locator').toBeTruthy()
  expect(Number.isSafeInteger(manifest.page) && manifest.page > 0).toBe(true)
  expect(manifest.statement.trim().length).toBeGreaterThan(0)
  expect(manifest.readings).toHaveLength(3)
  expect(manifest.truth).toHaveLength(3)
  expect(new Set(manifest.readings.map(r => r.symbol)).size).toBe(3)
  const mismatches: string[] = []
  for (const reading of manifest.readings) {
    expect(reading.kind).toBe('dimension')
    expect(reading.unit).toBe('mm')
    for (const q of [reading.nominalQ, reading.upperDeviationQ, reading.lowerDeviationQ]) expect(Number.isSafeInteger(q)).toBe(true)
    const truth = manifest.truth.find(r => r.symbol === reading.symbol)
    expect(truth, `Missing human truth for ${reading.symbol}`).toBeDefined()
    expect(reading.upperDeviationQ).toBe(truth!.upperDeviationQ)
    expect(reading.lowerDeviationQ).toBe(truth!.lowerDeviationQ)
    if (reading.nominalQ !== truth!.nominalQ) {
      expect(truth!.nominalQ).not.toBe(0)
      expect(reading.nominalQ).toBe(truth!.nominalQ * 10)
      mismatches.push(reading.symbol)
    }
  }
  expect(mismatches, 'Exactly one deliberate 10x error').toHaveLength(1)
  return mismatches[0]
}

it('ingest_readings: real scanned source, verification gates, per-item decisions, commit and exports', async () => {
  const manifestPath = process.env.INGEST_READINGS_MANIFEST
  if (!manifestPath) throw new Error('BLOCKED: set INGEST_READINGS_MANIFEST to a reviewed human-transcription manifest; see scripts/ingest-readings-evidence.md')
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Manifest
  const wrongSymbol = validate(manifest)
  const pdf = path.resolve(manifest.pdfFile ?? 'docs/evidence/ocr/scanned/r2-tolerance-domain-scanned-300dpi.pdf')
  const pdfBytes = new Uint8Array(await fs.readFile(pdf))
  const inspection = await inspectSourcePdf(pdfBytes)
  expect(manifest.page).toBeLessThanOrEqual(inspection.pageCount)
  const rawPages = await extractPdfTextPages(pdfBytes, { from: 1, to: inspection.pageCount })
  // Verify EVERY page, not merely the selected page or a regex on PDF bytes.
  expect(rawPages.length).toBe(inspection.pageCount)
  expect(rawPages.every(p => p.items.length === 0), 'Scanned PDF unexpectedly contains a text layer').toBe(true)
  const seed = manifest.seedFile
    ? await decodeProjectFile(new Uint8Array(await fs.readFile(path.resolve(manifest.seedFile))))
    : { ok: true as const, value: { snapshot: createIntentProjectSnapshot({ name: '外部读数验收',
      identity: { actorId: '验收转录', sessionLabel: '合成装配；读数来自扫描页' }, appVersion: 'evidence', electronVersion: 'evidence' }) } }
  must(seed)
  await fs.mkdir(OUT, { recursive: true })
  const h = await createHarness({ debounceMs: 60_000 })
  const checks: Record<string, unknown>[] = []
  const record = async (name: string, value: unknown) => fs.writeFile(path.join(OUT, name), serializeEvidence(value))
  try {
    const opened = await h.openSample(seed.value.snapshot, 'ingest-readings-run')
    const session = h.projectService.getSession(opened.sessionId)!
    const service = new AgentToolService({ controller: h.controller, projectService: h.projectService,
      recovery: h.recovery, rootDir: h.workspace, approvals: new ApprovalStore({ rootDir: h.workspace }) })
    const extraction = new ExtractionService({ controller: h.controller, projectService: h.projectService, recovery: h.recovery })
    registerSourceChannels(h.ipc, {
      guard: h.guard, controller: h.controller, projectService: h.projectService, recovery: h.recovery,
      pickSourcePath: async () => pdf,
      io: {
        kindOf: async file => { try { const s = await fs.lstat(file); return s.isSymbolicLink() ? 'symlink' : s.isFile() ? 'file' : 'other' } catch { return 'missing' } },
        sizeOf: async file => (await fs.stat(file)).size,
        readUpTo: async (file, max) => new Uint8Array((await fs.readFile(file)).subarray(0, max)),
      },
    })
    const imported = await h.invoke<SourceImportValue>(IPC_CHANNELS.sourceImport, { sessionId: opened.sessionId, baseEditSeq: session.acceptedSeq })
    must(imported)
    expect(imported.value.sha256).toBe(sha(pdfBytes))
    for (const [index, setup] of (manifest.setup ?? []).entries()) {
      const result = await service.run(1, setup.command, setup.input, { userText: setup.userText, turnId: `evidence-setup-${index}` })
      must(result)
    }
    const source = { kind: 'pdf-page', revisionId: imported.value.revisionId, sha256: imported.value.sha256, page: manifest.page }
    const payload = { projectId: session.snapshot.project.id, source, statement: manifest.statement, readings: manifest.readings }
    // Cast only permits this runner to be prepared before the new core command is added.
    // It does not provide an implementation, fake response, or alternate ingestion path.
    const ingested = await service.run(1, 'ingest_readings' as Parameters<AgentToolService['run']>[1], payload,
      { userText: manifest.statement, turnId: 'evidence-manual-readings' })
    must(ingested)
    expect(objects(ingested.data).some(item => item.requiresVerification === true && item.batchConfirmable === false),
      'Tool response must expose verification flags').toBe(true)
    const draft = session.snapshot.project.extractionDrafts.find(d =>
      d.candidates.some(c => objects(c).some(e => e.kind === 'agent-read' && e.statement === manifest.statement)))
    expect(draft, 'Core must persist an agent-read draft').toBeDefined()
    const target = () => session.snapshot.project.extractionDrafts.find(d => d.draftId === draft!.draftId)!
    const candidates = target().candidates.filter(c => objects(c).some(e => e.kind === 'agent-read' && e.statement === manifest.statement))
    expect(candidates).toHaveLength(3)
    for (const candidate of candidates) {
      expect(candidate.kind).toBe('ring')
      if (candidate.kind !== 'ring') throw new Error('Reading was not converted to a ring')
      const input = manifest.readings.find(r => r.symbol === candidate.data.symbol)
      expect(input).toBeDefined()
      expect(candidate.data.nominal?.valueQ).toBe(input!.nominalQ)
      expect(candidate.data.upperDeviation?.valueQ).toBe(input!.upperDeviationQ)
      expect(candidate.data.lowerDeviation?.valueQ).toBe(input!.lowerDeviationQ)
      expect(candidate.status).toBe('pending')
      expect(candidate).toMatchObject({ requiresVerification: true, batchConfirmable: false })
      const evidence = objects(candidate).filter(e => e.kind === 'agent-read')
      expect(evidence.length).toBeGreaterThan(0)
      for (const item of evidence) {
        expect(item.source).toEqual(source)
        expect(item.statement).toBe(manifest.statement)
        expect(item.actorId).toBe(session.snapshot.project.actorId)
        expect(item.sessionSeq).toBe(session.snapshot.project.sessionSeq)
        expect(typeof item.turnId).toBe('string')
        expect(item.modelId).toBeNull()
      }
    }
    const assertNoDisguise = (value: unknown) => {
      for (const item of objects(value).filter(e => e.kind === 'pdf-text')) {
        expect(JSON.stringify(item)).not.toContain('agent-read')
        expect(JSON.stringify(item)).not.toContain(manifest.statement)
      }
      // A downgrade that removed agent-read entirely must also fail.
      expect(objects(value).some(e => e.kind === 'agent-read' && e.statement === manifest.statement)).toBe(true)
    }
    assertNoDisguise(target())
    await record('ingest-response.json', { payload, response: ingested, wrongSymbol, truth: manifest.truth, truthLocator: manifest.truthLocator })
    const pending = await encodeProjectFile(session.snapshot)
    must(pending)
    await fs.writeFile(path.join(OUT, 'pending.cunlian'), pending.value.bytes)
    const beforeBatch = stableFingerprint(target())
    const seq = session.acceptedSeq
    const batch = await extraction.confirmBatch({ sessionId: opened.sessionId, baseEditSeq: seq,
      draftId: target().draftId, candidateIds: candidates.map(c => c.candidateId) })
    expect(batch.ok, 'M46: batch MUST be rejected').toBe(false)
    if (batch.ok) throw new Error('Batch unexpectedly accepted')
    expect(batch.error.code).toBe('EXTRACTION_BATCH_REJECTED')
    expect(stableFingerprint(target())).toBe(beforeBatch)
    expect(session.acceptedSeq).toBe(seq)
    await record('batch-rejected.json', { response: batch, unchanged: true, draft: target() })
    checks.push({ id: 'batch-rejected-zero-write', code: batch.error.code })
    const plan = planApplication(target(), { source: target().sourceIdentity, candidateIds: candidates.map(c => c.candidateId) })
    expect(plan.ok, 'Pending readings cannot enter application plan').toBe(false)
    if (plan.ok) throw new Error('Unverified plan unexpectedly accepted')
    expect(plan.code).toBe('NOT_CONFIRMED')
    if (session.snapshot.project.sourceKind === 'user-intent') {
      const refused = await service.applyIntentDraft(1)
      expect(refused.ok).toBe(false)
      if (refused.ok) throw new Error('Unverified apply unexpectedly accepted')
      expect(refused.code).toBe('NOT_CONFIRMED')
      await record('unconfirmed-apply-rejected.json', { response: refused, plan })
    }
    const direct = await service.commitApprovedDraft(1, {
      approvalId: 'no-approval', draftId: target().draftId, previewFingerprint: 'no-preview',
    })
    expect(direct.ok).toBe(false)
    await record('unconfirmed-commit-rejected.json', { response: direct, plan,
      note: 'Direct commit has no approval; NOT_CONFIRMED plan/apply is the separate verification gate.' })
    checks.push({ id: 'unconfirmed-plan-rejected', code: plan.code })
    // Real single-item extraction decisions (not confirmCandidate directly).
    // Confirm supporting candidates too, if the reviewed seed contains formula/geometry/requirement.
    for (const candidate of [...target().candidates]) {
      if (candidate.status === 'confirmed') continue
      const latest = target().candidates.find(c => c.candidateId === candidate.candidateId)!
      const decided = await extraction.decide({ sessionId: opened.sessionId, baseEditSeq: session.acceptedSeq,
        draftId: target().draftId, candidateId: latest.candidateId, editRevision: latest.editRevision,
        action: 'confirm', confirmed: true })
      must(decided)
    }
    for (const candidate of candidates) {
      expect(target().decisions.some(d => d.candidateId === candidate.candidateId && d.action === 'confirm' && !d.batchId)).toBe(true)
    }
    await record('confirmed-project-fragment.json', { source, statement: manifest.statement, draft: target(),
      note: 'Deliberate wrong reading is not auto-corrected. Confirmation records human responsibility, not OCR accuracy.' })
    const confirmed = await encodeProjectFile(session.snapshot)
    must(confirmed)
    await fs.writeFile(path.join(OUT, 'confirmed.cunlian'), confirmed.value.bytes)
    if (session.snapshot.project.sourceKind === 'user-intent') {
      must(await service.applyIntentDraft(1))
    } else {
      if (!manifest.mapping) throw new Error('BLOCKED: PDF project needs an explicit complete production mapping in the manifest')
      const planToken = await service.issueAfterDecision(1, target().draftId)
      expect(planToken).not.toBeNull()
      must(await service.run(1, 'apply', { planToken, baseRevisionId: session.snapshot.project.currentRevisionId,
        candidateIds: target().candidates.map(c => c.candidateId), mapping: manifest.mapping }))
    }
    must(await service.previewLatestDraft(1))
    const summary = service.previewSummary(1)
    must(summary)
    expect(summary.data).not.toBeNull()
    const approval = await service.issueApproval(1, summary.data!.previewId, { userAttestationAcknowledged: true })
    must(approval)
    const committed = await service.commitApprovedDraft(1, { approvalId: approval.data.approvalId,
      draftId: summary.data!.draftId, previewFingerprint: summary.data!.previewFingerprint })
    expect(committed).toMatchObject({ ok: false, code: 'CONSTRAINT_VIOLATED', details: { causeCode: 'REQUIREMENT_NOT_SATISFIED' } })
    await record('wrong-reading-commit-rejected.json', { committed, note: '原样保留10倍错值；固定条款不满足，产品拒绝提交' })
    const correctedReading = manifest.truth.find((r) => r.symbol === wrongSymbol)!
    const correctionStatement = `验收核对更正：第${manifest.page}页 ${wrongSymbol} 实为5 mm（非50），上偏差0，下偏差-0.1。`
    must(await service.run(1, 'ingest_readings', { projectId: session.snapshot.project.id, draftId: target().draftId,
      source, statement: correctionStatement, readings: [correctedReading] }, { userText: correctionStatement, turnId: 'evidence-correction' }))
    expect((await service.applyIntentDraft(1)).ok, '更正后旧确认失效').toBe(false)
    const correctedCandidate = target().candidates.find((c) => c.kind === 'ring' && c.data.symbol === wrongSymbol)!
    must(await extraction.decide({ sessionId: opened.sessionId, baseEditSeq: session.acceptedSeq,
      draftId: target().draftId, candidateId: correctedCandidate.candidateId, editRevision: correctedCandidate.editRevision,
      action: 'confirm', confirmed: true }))
    must(await service.applyIntentDraft(1))
    must(await service.previewLatestDraft(1))
    const correctedSummary = service.previewSummary(1)
    must(correctedSummary)
    expect(correctedSummary.data).not.toBeNull()
    const correctedApproval = await service.issueApproval(1, correctedSummary.data!.previewId, { userAttestationAcknowledged: true })
    must(correctedApproval)
    const finalCommit = await service.commitApprovedDraft(1, { approvalId: correctedApproval.data.approvalId,
      draftId: correctedSummary.data!.draftId, previewFingerprint: correctedSummary.data!.previewFingerprint })
    must(finalCommit)
    // Read actual committed file, not just an in-memory receipt.
    expect(session.path).not.toBeNull()
    const disk = new Uint8Array(await fs.readFile(session.path!))
    const reopened = await decodeProjectFile(disk)
    must(reopened)
    assertNoDisguise(reopened.value.snapshot.project)
    for (const reading of manifest.truth) {
      const term = reopened.value.snapshot.project.dimensionChain.terms.find(t => t.symbol === reading.symbol)
      expect(term, `Committed chain must actually use reading ${reading.symbol}`).toBeDefined()
      expect(term!.nominalQ).toBe(reading.nominalQ)
      expect(term!.upperDeviationQ).toBe(reading.upperDeviationQ)
      expect(term!.lowerDeviationQ).toBe(reading.lowerDeviationQ)
    }
    await fs.writeFile(path.join(OUT, 'committed.cunlian'), disk)
    await record('commit-result.json', { committed: finalCommit, project: reopened.value.snapshot.project })
    await record('project-fragment.json', { terms: reopened.value.snapshot.project.dimensionChain.terms,
      note: '由真实提交文件解码后节选；保留读数来源、原话和实际数值。' })
    const targets: { kind: string; target: string }[] = []
    registerDrawingChannels(h.ipc, {
      guard: h.guard, controller: h.controller, projectService: h.projectService, recovery: h.recovery,
      exportStore: new DrawingExportStore(),
      pickExportPath: async (_windowId, kind, suggested) => {
        const targetPath = path.join(OUT, suggested)
        targets.push({ kind, target: targetPath }); return targetPath
      },
      confirmOverwrite: async () => true,
      printPdf: async () => { throw new Error('This evidence exports SVG and DXF, not PDF') },
    })
    const drawing = session.snapshot.project.drawings[0]
    expect(drawing).toBeDefined()
    for (const channel of [IPC_CHANNELS.drawingExportSvg, IPC_CHANNELS.drawingExportDxfR12]) {
      const exported = await h.invoke<DrawingExportValue>(channel, { sessionId: opened.sessionId,
        baseEditSeq: session.acceptedSeq, drawingId: drawing!.drawingId, drawingFingerprint: drawing!.dataFingerprint })
      must(exported)
      const bytes = new Uint8Array(await fs.readFile(targets.at(-1)!.target))
      expect(sha(bytes)).toBe(exported.value.sha256)
      const text = new TextDecoder(channel === IPC_CHANNELS.drawingExportSvg ? 'utf8' : 'gb18030').decode(bytes)
      expect(text, 'Export must identify agent-read/manual reading provenance').toMatch(/agent-read|读数|人工/u)
      expect(text, 'Export must identify source page').toMatch(new RegExp(`第\\s*${manifest.page}\\s*页|page\\s*[:：]?\\s*${manifest.page}`, 'iu'))
      expect(text).toContain(String(session.snapshot.project.actorId))
      checks.push({ id: channel, sha256: exported.value.sha256, fileName: exported.value.fileName })
    }
    await record('service-result.json', { verdict: 'pass', checks, pdf: { file: path.relative(ROOT, pdf), sha256: sha(pdfBytes), textItems: rawPages.map(p => p.items.length) },
      limitation: '本次不含看图能力；读数为已审阅人工转录。服务取证不是打包 UI 取证，后者单独运行 ingestReadings.mjs。' })
  } catch (error) {
    await record('service-result.json', { verdict: 'fail', checks, error: error instanceof Error ? error.message : String(error) })
    throw error
  } finally { await h.dispose() }
})
