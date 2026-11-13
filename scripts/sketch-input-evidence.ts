/**
 * 手绘草图入口：服务层端到端证据（真实通道、真实文件、真实提交）。
 *
 * 运行：npx vitest run --config vitest.sketchevidence.config.ts
 *
 * 边界：夹具是「合成夹具，非真实手绘照片」——现有产品导出图纸 PDF 经 sips 转 PNG，
 * 再转 JPEG 并注入 EXIF 方向；不做 OCR、不做图像识别、不按像素推算毫米。
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
import { registerSketchChannels } from '../desktop/main/sketchChannels'
import { registerDrawingChannels } from '../desktop/main/drawingChannels'
import { DrawingExportStore } from '../desktop/main/drawingExportStore'
import { createModelFileIo } from '../desktop/main/modelIo'
import { IPC_CHANNELS, type SketchImageImportValue, type SketchIngestValue, type DrawingExportValue } from '../desktop/shared/contracts'
import { decodeProjectFile, encodeProjectFile } from '../src/project-file/codec'
import { planApplication } from '../src/document-extraction'
import { selectionToSourceRect, type SketchView } from '../src/sketch/selection'
import { serializeEvidence } from './evidence-json'

const ROOT = process.cwd()
const OUT = path.join(ROOT, 'docs/evidence/sketch-input')
const FIX = path.join(OUT, 'fixtures')
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

type Reading = {
  kind: 'dimension'; symbol: string; nominalQ: number
  upperDeviationQ: number; lowerDeviationQ: number; unit: 'mm'
}

// 合成草图上的三条读数；L2 是故意 10 倍错值（真值 0.5 mm，写成 5 mm）。
const TRUTH: Reading[] = [
  { kind: 'dimension', symbol: 'L1', nominalQ: 300_000, upperDeviationQ: 0, lowerDeviationQ: -2000, unit: 'mm' },
  { kind: 'dimension', symbol: 'L2', nominalQ: 5000, upperDeviationQ: 0, lowerDeviationQ: -1000, unit: 'mm' },
  { kind: 'dimension', symbol: 'L3', nominalQ: 430_000, upperDeviationQ: 2000, lowerDeviationQ: 0, unit: 'mm' },
]
const SUBMITTED: Reading[] = TRUTH.map((reading) => reading.symbol === 'L2'
  ? { ...reading, nominalQ: 50_000 } : reading)

// 无任务书项目必须由用户给出装配式与方向；这是验收用的合成装配条件，不声称真实装配。
const SETUP_STATEMENT = '装配式 L3 - L1 - L2；三处尺寸 L1 30 上偏差 0 下偏差 -0.2，L2 0.5 上偏差 0 下偏差 -0.1，L3 43 上偏差 0.2 下偏差 0。'

// 屏幕框（显示坐标，CSS px）→ 原图像素 rect 的手算对照表；与实现无关，见任务卡 B。
const FIXTURE_W = 2400
const FIXTURE_H = 1696
const FOUR_WAY_EXPECTED: Record<1 | 3 | 6 | 8, [number, number, number, number]> = {
  1: [100, 60, 240, 140],
  3: [2060, 1496, 240, 140],
  6: [60, 1356, 140, 240],
  8: [2200, 100, 140, 240],
}

function must<T extends { ok: boolean }>(value: T): asserts value is T & { ok: true } {
  expect(value.ok, JSON.stringify(value)).toBe(true)
}

it('手绘草图：图片导入 → 三处框选 → 三读数（含 10 倍错值）→ 提交 → 出图', async () => {
  await fs.mkdir(OUT, { recursive: true })
  const checks: Record<string, unknown>[] = []
  const record = async (name: string, value: unknown) => fs.writeFile(path.join(OUT, name), serializeEvidence(value))
  const basePath = path.join(FIX, 'sketch-synthetic-base.png')
  const baseBytes = new Uint8Array(await fs.readFile(basePath))
  const h = await createHarness({ debounceMs: 60_000 })
  let picked = basePath
  const targets: { kind: string; target: string }[] = []
  try {
    const project = createIntentProjectSnapshot({ name: '手绘草图验收', appVersion: 'evidence', electronVersion: 'evidence',
      identity: { actorId: '验收绘图员', sessionLabel: '合成夹具；读数由验收人输入' } })
    const opened = await h.openSample(project, 'sketch-input')
    const session = () => h.projectService.getSession(opened.sessionId)!
    registerSketchChannels(h.ipc, {
      guard: h.guard, controller: h.controller, projectService: h.projectService, recovery: h.recovery,
      pickImagePath: async () => picked,
      io: createModelFileIo(),
      now: () => new Date('2026-11-13T10:00:00.000Z'),
    })
    const service = new AgentToolService({ controller: h.controller, projectService: h.projectService,
      recovery: h.recovery, rootDir: h.workspace, approvals: new ApprovalStore({ rootDir: h.workspace }) })
    const extraction = new ExtractionService({ controller: h.controller, projectService: h.projectService, recovery: h.recovery })
    // A-0：无任务书项目先由用户给出装配式（方向）；这是合成验收条件，不冒充真实装配。
    must(await service.run(1, 'setChain', {
      statement: SETUP_STATEMENT,
      rings: [
        { symbol: 'L1', nominalMm: '30', upperDeviationMm: '0', lowerDeviationMm: '-0.2' },
        { symbol: 'L2', nominalMm: '0.5', upperDeviationMm: '0', lowerDeviationMm: '-0.1' },
        { symbol: 'L3', nominalMm: '43', upperDeviationMm: '0.2', lowerDeviationMm: '0' },
      ],
      formula: 'L3 - L1 - L2',
    }, { userText: SETUP_STATEMENT, turnId: 'evidence-setup-chain' }))
    const BINDING_STATEMENT = '验收合成隔套，内径 20，外径 32，长 12.05；不是真实零件尺寸。'
    must(await service.run(1, 'setBinding', {
      statement: BINDING_STATEMENT,
      parameters: [
        { parameter: 'innerDiameter', mm: '20' },
        { parameter: 'outerDiameter', mm: '32' },
        { parameter: 'length', mm: '12.05' },
      ],
    }, { userText: BINDING_STATEMENT, turnId: 'evidence-setup-binding' }))
    registerDrawingChannels(h.ipc, {
      guard: h.guard, controller: h.controller, projectService: h.projectService, recovery: h.recovery,
      exportStore: new DrawingExportStore(),
      pickExportPath: async (_windowId, kind, suggested) => {
        const target = path.join(OUT, suggested)
        targets.push({ kind, target }); return target
      },
      confirmOverwrite: async () => true,
      printPdf: async () => { throw new Error('本证据只导出 SVG / DXF，不打印 PDF') },
    })

    // A-1：导入 PNG（字节进 .cunlian，main 自算哈希与像素尺寸）。
    const imported = await h.invoke<SketchImageImportValue>(IPC_CHANNELS.sketchImageImport,
      { sessionId: opened.sessionId, baseEditSeq: session().acceptedSeq })
    must(imported)
    expect(imported.value.sha256).toBe(sha(baseBytes))
    expect(imported.value.width).toBe(FIXTURE_W)
    expect(imported.value.height).toBe(FIXTURE_H)
    const imageId = imported.value.imageId
    const imageSha = imported.value.sha256
    checks.push({ id: 'image-imported', imageId, sha256: imageSha, width: imported.value.width,
      height: imported.value.height, bytesInProject: session().snapshot.attachments.some(
        (item) => sha(item.bytes) === imageSha) })
    expect(session().snapshot.attachments.some((item) => sha(item.bytes) === imageSha),
      '图片字节必须作为附件存在项目快照里').toBe(true)

    // A-2：三处框选（原图像素，来自 UI 同一套坐标换算）+ 三条读数，L2 故意错 10 倍。
    const view: SketchView = { zoom: 1, panX: 0, panY: 0 }
    const boxes = [
      { symbol: 'L1', start: { x: 120, y: 300 }, end: { x: 360, y: 430 } },
      { symbol: 'L2', start: { x: 700, y: 480 }, end: { x: 980, y: 600 } },
      { symbol: 'L3', start: { x: 1500, y: 1200 }, end: { x: 1750, y: 1340 } },
    ].map((box) => {
      const rect = selectionToSourceRect({ orientation: 1, sourceWidth: FIXTURE_W, sourceHeight: FIXTURE_H,
        view, start: box.start, end: box.end })
      if (rect === null) throw new Error(`框选未产生 rect：${box.symbol}`)
      return { symbol: box.symbol, rect: [rect.x, rect.y, rect.width, rect.height] as [number, number, number, number] }
    })
    const submitted = await h.invoke<SketchIngestValue>(IPC_CHANNELS.sketchIngestReadings, {
      sessionId: opened.sessionId, baseEditSeq: session().acceptedSeq,
      payload: { source: { kind: 'image', imageId, sha256: imageSha }, readings: SUBMITTED, boxes },
    })
    must(submitted)
    const draftId = submitted.value.draftId
    const draft = () => session().snapshot.project.extractionDrafts.find((item) => item.draftId === draftId)!
    expect(draft().candidates.filter((candidate) => candidate.kind === 'ring')).toHaveLength(3)
    const l2 = draft().candidates.find((candidate) => candidate.kind === 'ring' && candidate.data.symbol === 'L2')!
    expect(l2.kind === 'ring' && l2.data.nominal?.valueQ).toBe(50_000)
    for (const candidate of draft().candidates.filter((item) => item.kind === 'ring')) {
      expect(candidate).toMatchObject({ status: 'pending', requiresVerification: true, batchConfirmable: false })
      const ref = (candidate.provenance ?? []).find((item) => item.kind === 'agent-read')
      expect(ref, '候选必须带图片出处').toBeDefined()
      if (ref?.kind !== 'agent-read') throw new Error('provenance kind mismatch')
      expect(ref.source).toMatchObject({ kind: 'image', imageId, sha256: imageSha })
      expect(ref.statement).toContain('第 ')
      expect(ref.statement).toContain('个框选')
      expect(JSON.stringify(candidate)).not.toContain('image-ocr')
      expect(JSON.stringify(candidate)).not.toContain('"kind":"pdf-text"')
    }
    const pendingFile = await encodeProjectFile(session().snapshot)
    must(pendingFile)
    await fs.writeFile(path.join(OUT, 'pending.cunlian'), pendingFile.value.bytes)
    await record('submit-response.json', { readings: SUBMITTED, truth: TRUTH, boxes,
      note: 'L2 故意 10 倍错值（真值 0.5 mm，提交 5 mm）；产品不自动纠正。' })
    checks.push({ id: 'three-unverified-readings', draftId, candidates: draft().candidates.length })

    // A-3：批量确认必须整批拒绝；未确认不能进计划。
    const beforeBatch = JSON.stringify(draft().decisions)
    const batch = await extraction.confirmBatch({ sessionId: opened.sessionId, baseEditSeq: session().acceptedSeq,
      draftId, candidateIds: draft().candidates.map((candidate) => candidate.candidateId) })
    expect(batch.ok).toBe(false)
    if (!batch.ok) expect(batch.error.code).toBe('EXTRACTION_BATCH_REJECTED')
    expect(JSON.stringify(draft().decisions)).toBe(beforeBatch)
    await record('batch-rejected.json', { response: batch })
    const plan = planApplication(draft(), { source: draft().sourceIdentity,
      candidateIds: draft().candidates.map((candidate) => candidate.candidateId) })
    expect(plan.ok).toBe(false)
    if (!plan.ok) expect(plan.code).toBe('NOT_CONFIRMED')
    checks.push({ id: 'batch-rejected-zero-write' })

    // A-4：真实逐条确认（图片读数没有批量确认）；连同 setChain 留下的装配式候选。
    for (const symbol of draft().candidates.map((candidate) =>
      candidate.kind === 'ring' ? candidate.data.symbol : candidate.candidateId)) {
      const candidate = draft().candidates.find((item) =>
        item.kind === 'ring' ? item.data.symbol === symbol : item.candidateId === symbol)!
      if (candidate.status === 'confirmed') continue
      const decided = await extraction.decide({ sessionId: opened.sessionId, baseEditSeq: session().acceptedSeq,
        draftId, candidateId: candidate.candidateId, editRevision: candidate.editRevision,
        action: 'confirm', confirmed: true })
      must(decided)
    }
    expect(draft().decisions.every((decision) => decision.batchId === undefined)).toBe(true)

    // A-5：应用 → 预览 → 授权 → 提交（原样带着 10 倍错值，不“修好”）。
    must(await service.applyIntentDraft(1))
    must(await service.previewLatestDraft(1))
    const summary = service.previewSummary(1)
    must(summary)
    expect(summary.data).not.toBeNull()
    const approval = await service.issueApproval(1, summary.data!.previewId, { userAttestationAcknowledged: true })
    must(approval)
    const committed = await service.commitApprovedDraft(1, { approvalId: approval.data.approvalId,
      draftId: summary.data!.draftId, previewFingerprint: summary.data!.previewFingerprint })
    must(committed)
    expect(session().path).not.toBeNull()
    const disk = new Uint8Array(await fs.readFile(session().path!))
    const reopened = await decodeProjectFile(disk)
    must(reopened)
    await fs.writeFile(path.join(OUT, 'committed.cunlian'), disk)
    const terms = reopened.value.snapshot.project.dimensionChain.terms
    expect(terms.find((term) => term.symbol === 'L2')?.nominalQ).toBe(50_000)
    await record('project-fragment.json', {
      note: '由真实提交文件解码后节选；保留 kind=agent-read、source.kind=image、imageId、sha256、rect、statement。',
      chainTerms: terms,
      proofs: terms.map((term) => ({
        symbol: term.symbol, nominalQ: term.nominalQ,
        provenance: (term.provenance ?? []).map((ref) => ref.kind === 'agent-read' ? ({
          kind: ref.kind, actorId: ref.actorId, statement: ref.statement, modelId: ref.modelId,
          source: ref.source,
        }) : ref),
      })),
    })
    expect(JSON.stringify(terms)).not.toContain('image-ocr')
    expect(JSON.stringify(terms)).not.toContain('pdf-text')

    // A-6：真实导出 SVG，标题栏来源必须是图片 + 第 N 个框选。
    const drawing = session().snapshot.project.drawings[0]
    if (drawing === undefined) throw new Error('提交后没有图纸记录')
    const drawingExport = await h.invoke<DrawingExportValue>(IPC_CHANNELS.drawingExportSvg, {
      sessionId: opened.sessionId, baseEditSeq: session().acceptedSeq,
      drawingId: drawing.drawingId, drawingFingerprint: drawing.dataFingerprint,
    })
    must(drawingExport)
    const svgPath = targets.find((item) => item.kind === 'svg')!.target
    const svg = await fs.readFile(svgPath, 'utf8')
    expect(svg).toContain('读数来源：图片')
    expect(svg).toMatch(/读数来源：图片，第 \d 个框选/)
    checks.push({ id: 'drawing-source-image', svg: path.relative(ROOT, svgPath) })
    await record('drawing-source.json', { svgFile: path.relative(ROOT, svgPath),
      basisLine: svg.match(/读数来源：[^<"]+/u)?.[0] ?? null })

    // B：四向（EXIF 1/3/6/8）——同一屏幕框换算回原图坐标，落点各不相同且都在界内。
    const fourWay: Record<string, unknown>[] = []
    const expectedByOrientation: Record<number, [number, number, number, number]> = FOUR_WAY_EXPECTED
    for (const orientation of [1, 3, 6, 8] as const) {
      picked = path.join(FIX, `sketch-synthetic-o${orientation}.jpg`)
      const image = await h.invoke<SketchImageImportValue>(IPC_CHANNELS.sketchImageImport,
        { sessionId: opened.sessionId, baseEditSeq: session().acceptedSeq })
      must(image)
      expect(image.value.orientation).toBe(orientation)
      const rect = selectionToSourceRect({ orientation, sourceWidth: image.value.width,
        sourceHeight: image.value.height, view, start: { x: 100, y: 60 }, end: { x: 340, y: 200 } })
      expect(rect).not.toBeNull()
      const actual: [number, number, number, number] = [rect!.x, rect!.y, rect!.width, rect!.height]
      expect(actual, `orientation ${orientation} 的换算必须等于手算对照表`).toEqual(expectedByOrientation[orientation])
      expect(actual[0] + actual[2] <= image.value.width && actual[1] + actual[3] <= image.value.height).toBe(true)
      const submission = await h.invoke<SketchIngestValue>(IPC_CHANNELS.sketchIngestReadings, {
        sessionId: opened.sessionId, baseEditSeq: session().acceptedSeq,
        payload: { source: { kind: 'image', imageId: image.value.imageId, sha256: image.value.sha256 },
          readings: [{ kind: 'dimension', symbol: 'R', nominalQ: 10_000,
            upperDeviationQ: 0, lowerDeviationQ: 0, unit: 'mm' }],
          boxes: [{ symbol: 'R', rect: actual }] },
      })
      must(submission)
      const ref = (submission.value.candidates[0]!.provenance ?? []).find((item) => item.kind === 'agent-read')
      if (ref?.kind !== 'agent-read') throw new Error('四向候选缺少图片出处')
      expect(ref.source).toMatchObject({ kind: 'image', imageId: image.value.imageId,
        sha256: image.value.sha256, region: { index: 1, rect: actual } })
      fourWay.push({ orientation, displayWidth: image.value.width, displayHeight: image.value.height,
        screenRect: [100, 60, 240, 140], sourceRect: actual, matchesHandComputedTable: true })
    }
    await record('four-orientation.json', { fixture: '合成夹具，非真实手绘照片（sips 渲染 + 注入 EXIF）',
      sourceSize: { width: FIXTURE_W, height: FIXTURE_H }, view,
      note: '屏幕框 [100,60,240,140] 相同；原图像素 rect 按 EXIF 方向不同。', rows: fourWay })
    checks.push({ id: 'four-orientation', rows: fourWay.length })

    // D：边界（真实文件，真实拒绝）。
    const oversizedPath = path.join(h.directory, 'sketch-synthetic-21MiB.png')
    const oversized = Buffer.alloc(20 * 1024 * 1024 + 1)
    baseBytes.subarray(0, 64).forEach((value, index) => { oversized[index] = value })
    await fs.writeFile(oversizedPath, oversized)
    picked = oversizedPath
    const tooLarge = await h.invoke(IPC_CHANNELS.sketchImageImport, { sessionId: opened.sessionId,
      baseEditSeq: session().acceptedSeq })
    expect(tooLarge.ok).toBe(false)
    if (!tooLarge.ok) expect(tooLarge.error.code).toBe('TOO_LARGE')
    picked = path.join(FIX, 'sketch-synthetic-heic.heic')
    await fs.writeFile(picked, new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
      0, 0, 0, 0, 0, 0, 0, 0]))
    const heic = await h.invoke(IPC_CHANNELS.sketchImageImport, { sessionId: opened.sessionId,
      baseEditSeq: session().acceptedSeq })
    expect(heic.ok).toBe(false)
    if (!heic.ok) {
      expect(heic.error.code).toBe('UNSUPPORTED_IMAGE_FORMAT')
      expect(heic.error.message).toContain('sips -s format jpeg')
    }
    picked = basePath
    const unboxedImage = await h.invoke<SketchImageImportValue>(IPC_CHANNELS.sketchImageImport,
      { sessionId: opened.sessionId, baseEditSeq: session().acceptedSeq })
    must(unboxedImage)
    const unboxed = await h.invoke<SketchIngestValue>(IPC_CHANNELS.sketchIngestReadings, {
      sessionId: opened.sessionId, baseEditSeq: session().acceptedSeq,
      payload: { source: { kind: 'image', imageId: unboxedImage.value.imageId,
        sha256: unboxedImage.value.sha256 },
        readings: [{ kind: 'dimension', symbol: 'N1', nominalQ: 12_000,
          upperDeviationQ: 0, lowerDeviationQ: -500, unit: 'mm' }],
        boxes: [{ symbol: 'N1', rect: null }] },
    })
    must(unboxed)
    const unboxedRef = (unboxed.value.candidates[0]!.provenance ?? []).find((item) => item.kind === 'agent-read')
    if (unboxedRef?.kind !== 'agent-read') throw new Error('未框选候选缺少图片出处')
    if (unboxedRef.source.kind !== 'image') throw new Error('未框选候选来源不是图片')
    expect(unboxedRef.statement).toContain('未框选，无位置')
    expect(unboxedRef.source.region).toEqual({ index: 1, rect: null })
    await record('boundaries.json', {
      tooLarge: { code: tooLarge.ok ? null : tooLarge.error.code, message: tooLarge.ok ? null : tooLarge.error.message },
      heic: { code: heic.ok ? null : heic.error.code, message: heic.ok ? null : heic.error.message },
      unboxed: { statement: unboxedRef.statement, region: unboxedRef.source.region },
    })
    checks.push({ id: 'boundaries', tooLarge: 'TOO_LARGE', heic: 'UNSUPPORTED_IMAGE_FORMAT', unboxed: 'no-position' })

    await record('service-result.json', { verdict: 'pass', checks,
      scope: '真实通道 + 真实文件 + 真实提交；UI 截图见 desktop/tests/e2e/sketchInput.mjs。',
      limitation: '合成夹具，非真实手绘照片。未做 OCR、未做比例标定、HEIC 不支持。' })
  } finally {
    await h.dispose()
  }
})
