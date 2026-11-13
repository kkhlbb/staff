// @vitest-environment node
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createSampleSnapshot } from '../../src/project-file/__fixtures__/sampleProjectFile'
import { decodeProjectFile, encodeProjectFile } from '../../src/project-file/codec'
import { selectionToSourceRect, type SketchView } from '../../src/sketch/selection'
import { syntheticHeic, syntheticJpeg, syntheticPng } from '../../src/sketch/__fixtures__/syntheticImage'
import { SKETCH_IMAGE_MAX_BYTES } from '../../src/sketch/imageFormat'
import { IPC_CHANNELS, type IpcResult } from '../shared/contracts'
import { createHarness, type Harness } from './helpers/a04'
import { createModelFileIo } from '../main/modelIo'
import { registerSketchChannels } from '../main/sketchChannels'

const harnesses: Harness[] = []
afterEach(async () => {
  while (harnesses.length > 0) await harnesses.pop()!.dispose()
})

async function setup() {
  const h = await createHarness({ debounceMs: 5 })
  harnesses.push(h)
  let picked: string | null = null
  let counter = 0
  registerSketchChannels(h.ipc, {
    guard: h.guard,
    controller: h.controller,
    projectService: h.projectService,
    recovery: h.recovery,
    pickImagePath: async () => picked,
    io: createModelFileIo(),
    newId: () => `t${(counter += 1)}`,
    now: () => new Date('2026-11-13T10:00:00.000Z'),
  })
  const snapshot = await createSampleSnapshot()
  snapshot.project.actorId = '绘图员'
  snapshot.project.sessionSeq = 1
  const opened = await h.openSample(snapshot)
  async function importBytes(bytes: Uint8Array, name: string): Promise<IpcResult<unknown>> {
    const file = path.join(h.directory, name)
    await fsp.writeFile(file, bytes)
    picked = file
    return h.invoke(IPC_CHANNELS.sketchImageImport, {
      sessionId: opened.sessionId, baseEditSeq: h.projectService.getSession(opened.sessionId)!.acceptedSeq,
    })
  }
  const session = () => h.projectService.getSession(opened.sessionId)!
  return { h, opened, importBytes, session }
}

describe('草图通道：图片导入（真实文件、真实哈希）', () => {
  it('PNG 字节作为附件进项目文件，哈希与像素尺寸由 main 自算', async () => {
    const { importBytes, session } = await setup()
    const bytes = syntheticPng(1200, 800)
    const result = await importBytes(bytes, 'sketch-synthetic-1200x800.png')
    expect(result.ok, JSON.stringify(result)).toBe(true)
    if (!result.ok) return
    const value = result.value as {
      imageId: string; sha256: string; width: number; height: number; orientation: number
      byteSize: number; snapshot: { revisions: { id: string; sha256: string; pageCount: number }[]; blobs: unknown[] }
    }
    expect(value.imageId).toMatch(/^sr-/)
    expect(value.width).toBe(1200)
    expect(value.height).toBe(800)
    expect(value.byteSize).toBe(bytes.byteLength)
    expect(value.orientation).toBe(1)
    const live = session().snapshot
    const revision = live.revisions.find((item) => item.id === value.imageId)!
    expect(revision.sha256).toBe(value.sha256)
    expect(revision.pageCount).toBe(1)
    const attachment = live.attachments.find((item) => item.blobKey === revision.blobKey)!
    expect(Buffer.from(attachment.bytes).equals(Buffer.from(bytes))).toBe(true)
  })

  it('21 MiB 图片被拒绝且不写会话', async () => {
    const { importBytes, session } = await setup()
    const oversized = new Uint8Array(SKETCH_IMAGE_MAX_BYTES + 1)
    oversized.set(syntheticPng(10, 10, 0).subarray(0, 25), 0)
    const before = JSON.stringify(session().snapshot.revisions)
    const result = await importBytes(oversized, 'huge-synthetic.png')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('TOO_LARGE')
    expect(result.error.message).toContain('20.0 MiB')
    expect(JSON.stringify(session().snapshot.revisions)).toBe(before)
  })

  it('HEIC 明确提示并给 sips 转换命令，不静默失败', async () => {
    const { importBytes } = await setup()
    const result = await importBytes(syntheticHeic(), 'IMG_0001.HEIC')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('UNSUPPORTED_IMAGE_FORMAT')
    expect(result.error.message).toContain('sips -s format jpeg')
  })

  it('扩展名是 .png 但字节不是 PNG/JPEG 时按文件头拒绝', async () => {
    const { importBytes } = await setup()
    const result = await importBytes(new TextEncoder().encode('not an image'), 'fake.png')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('UNSUPPORTED_IMAGE_FORMAT')
  })

  it('baseEditSeq 过期时拒绝导入，不覆盖其它编辑', async () => {
    const { h, opened } = await setup()
    const file = path.join(h.directory, 'sketch-synthetic-stale.png')
    await fsp.writeFile(file, syntheticPng(100, 100))
    const result = await h.invoke(IPC_CHANNELS.sketchImageImport, {
      sessionId: opened.sessionId, baseEditSeq: 99,
    }) as IpcResult<unknown>
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('STALE_EDIT')
    // 取消/失败路径不应留下任何文档。
    expect(h.projectService.getSession(opened.sessionId)!.snapshot.revisions.length).toBeGreaterThan(0)
  })
})

describe('草图通道：四向 EXIF 坐标落点', () => {
  const width = 1200
  const height = 800
  const view: SketchView = { zoom: 1, panX: 0, panY: 0 }
  const start = { x: 100, y: 60 }
  const end = { x: 340, y: 200 }
  // 手算对照表（显示坐标 → 原图像素），独立于实现：见任务卡 B。
  const expected: Record<1 | 3 | 6 | 8, [number, number, number, number]> = {
    1: [100, 60, 240, 140],
    3: [860, 600, 240, 140],
    6: [60, 460, 140, 240],
    8: [1000, 100, 140, 240],
  }

  it.each([1, 3, 6, 8] as const)('orientation=%i：屏幕框换算为原图像素并原样存进候选', async (orientation) => {
    const { importBytes, h, opened } = await setup()
    const result = await importBytes(syntheticJpeg(width, height, orientation), `sketch-synthetic-o${orientation}.jpg`)
    expect(result.ok, JSON.stringify(result)).toBe(true)
    if (!result.ok) return
    const image = result.value as { imageId: string; sha256: string; orientation: number }
    expect(image.orientation).toBe(orientation)

    const rect = selectionToSourceRect({ orientation, sourceWidth: width, sourceHeight: height, view, start, end })
    expect(rect).not.toBeNull()
    expect([rect!.x, rect!.y, rect!.width, rect!.height]).toEqual(expected[orientation])

    const session = h.projectService.getSession(opened.sessionId)!
    const submitted = await h.invoke(IPC_CHANNELS.sketchIngestReadings, {
      sessionId: opened.sessionId,
      baseEditSeq: session.acceptedSeq,
      payload: {
        source: { kind: 'image', imageId: image.imageId, sha256: image.sha256 },
        readings: [{ kind: 'dimension', symbol: 'A', nominalQ: 25_000,
          upperDeviationQ: 21, lowerDeviationQ: 0, unit: 'mm' }],
        boxes: [{ symbol: 'A', rect: [rect!.x, rect!.y, rect!.width, rect!.height] }],
      },
    }) as IpcResult<{ draftId: string; candidates: { provenance: { source: { region?: { index: number; rect: number[] } } }[] }[] }>
    expect(submitted.ok, JSON.stringify(submitted)).toBe(true)
    if (!submitted.ok) return
    const provenance = submitted.value.candidates[0]!.provenance[0]!
    expect(provenance.source.region).toEqual({ index: 1, rect: expected[orientation] })
  })
})

describe('草图通道：读数提交与红线', () => {
  async function importPng() {
    const context = await setup()
    const result = await context.importBytes(syntheticPng(1200, 800), 'sketch-synthetic-e2e.png')
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('import failed')
    const image = result.value as { imageId: string; sha256: string }
    return { ...context, image }
  }

  it('三条读数（含 1 条故意错 10 倍）原样进 pending 候选，不自动纠正', async () => {
    const { h, opened, image, session } = await importPng()
    const payload = {
      source: { kind: 'image', imageId: image.imageId, sha256: image.sha256 },
      readings: [
        { kind: 'dimension', symbol: 'L1', nominalQ: 300_000, upperDeviationQ: 0, lowerDeviationQ: -2000, unit: 'mm' },
        // 故意 10 倍：真值 25 mm（250000 q），这里写 250 mm（2500000 q）。
        { kind: 'dimension', symbol: 'L2', nominalQ: 2_500_000, upperDeviationQ: 0, lowerDeviationQ: -1000, unit: 'mm' },
        { kind: 'dimension', symbol: 'L3', nominalQ: 430_000, upperDeviationQ: 2000, lowerDeviationQ: 0, unit: 'mm' },
      ],
      boxes: [
        { symbol: 'L1', rect: [10, 10, 200, 80] },
        { symbol: 'L2', rect: [300, 40, 240, 90] },
        { symbol: 'L3', rect: [700, 500, 180, 70] },
      ],
    }
    const result = await h.invoke(IPC_CHANNELS.sketchIngestReadings, {
      sessionId: opened.sessionId, baseEditSeq: session().acceptedSeq, payload,
    }) as IpcResult<{ draftId: string; candidates: { data: { symbol: string; nominal: { valueQ: number } }; requiresVerification: boolean; batchConfirmable: boolean; status: string; evidence: unknown[]; provenance: { kind: string; source: { kind: string; imageId: string; sha256: string; region: { index: number; rect: number[] } } }[] }[] }>
    expect(result.ok, JSON.stringify(result)).toBe(true)
    if (!result.ok) return
    expect(result.value.candidates).toHaveLength(3)
    const l2 = result.value.candidates.find((candidate) => candidate.data.symbol === 'L2')!
    expect(l2.data.nominal.valueQ).toBe(2_500_000) // 不“修好”，留给人工核对
    for (const candidate of result.value.candidates) {
      expect(candidate.status).toBe('pending')
      expect(candidate.requiresVerification).toBe(true)
      expect(candidate.batchConfirmable).toBe(false)
      expect(candidate.evidence).toEqual([])
      expect(candidate.provenance[0]).toMatchObject({
        kind: 'agent-read', modelId: null,
        source: { kind: 'image', imageId: image.imageId, sha256: image.sha256 },
      })
      expect(candidate.provenance[0]!.source.region.index).toBeGreaterThanOrEqual(1)
    }
    // 项目文件可以编码/解码，region 不丢。
    const encoded = await encodeProjectFile(session().snapshot)
    expect(encoded.ok, JSON.stringify(encoded)).toBe(true)
    if (!encoded.ok) return
    const decoded = await decodeProjectFile(encoded.value.bytes)
    expect(decoded.ok, JSON.stringify(decoded)).toBe(true)
    if (!decoded.ok) return
    const draft = decoded.value.snapshot.project.extractionDrafts.find((item) => item.draftId === result.value.draftId)!
    const region = (draft.candidates[0]!.provenance?.[0] as unknown as { source: { region: { rect: number[] } } }).source.region
    expect(region.rect).toEqual([10, 10, 200, 80])
  })

  it('不框选可以填，但候选固定写“未框选，无位置”', async () => {
    const { h, opened, image, session } = await importPng()
    const result = await h.invoke(IPC_CHANNELS.sketchIngestReadings, {
      sessionId: opened.sessionId, baseEditSeq: session().acceptedSeq,
      payload: {
        source: { kind: 'image', imageId: image.imageId, sha256: image.sha256 },
        readings: [{ kind: 'dimension', symbol: 'B1', nominalQ: 12_000,
          upperDeviationQ: 0, lowerDeviationQ: -500, unit: 'mm' }],
        boxes: [{ symbol: 'B1', rect: null }],
      },
    }) as IpcResult<{ candidates: { provenance: { statement: string; source: { region: { index: number; rect: null } } }[] }[] }>
    expect(result.ok, JSON.stringify(result)).toBe(true)
    if (!result.ok) return
    const provenance = result.value.candidates[0]!.provenance[0]!
    expect(provenance.statement).toContain('未框选，无位置')
    expect(provenance.source.region).toEqual({ index: 1, rect: null })
  })

  it('框选超出原图范围被拒绝，读数不落库', async () => {
    const { h, opened, image, session } = await importPng()
    const before = session().snapshot.project.extractionDrafts.length
    const result = await h.invoke(IPC_CHANNELS.sketchIngestReadings, {
      sessionId: opened.sessionId, baseEditSeq: session().acceptedSeq,
      payload: {
        source: { kind: 'image', imageId: image.imageId, sha256: image.sha256 },
        readings: [{ kind: 'dimension', symbol: 'C1', nominalQ: 10_000,
          upperDeviationQ: 0, lowerDeviationQ: 0, unit: 'mm' }],
        boxes: [{ symbol: 'C1', rect: [1100, 700, 200, 200] }],
      },
    }) as IpcResult<unknown>
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('超出图片范围')
    expect(session().snapshot.project.extractionDrafts.length).toBe(before)
  })

  it('夹带像素→毫米标定字段整批拒绝（无标定就无量取）', async () => {
    const { h, opened, image, session } = await importPng()
    const result = await h.invoke(IPC_CHANNELS.sketchIngestReadings, {
      sessionId: opened.sessionId, baseEditSeq: session().acceptedSeq,
      payload: {
        source: { kind: 'image', imageId: image.imageId, sha256: image.sha256 },
        readings: [{ kind: 'dimension', symbol: 'D1', nominalQ: 10_000,
          upperDeviationQ: 0, lowerDeviationQ: 0, unit: 'mm', mmPerPixel: 0.05 }],
        boxes: [{ symbol: 'D1', rect: [0, 0, 10, 10] }],
        scale: { pxPerMm: 20 },
      },
    }) as IpcResult<unknown>
    expect(result.ok).toBe(false)
  })

  it('图片哈希不符时拒绝（不接受别的图片顶替）', async () => {
    const { h, opened, image, session } = await importPng()
    const result = await h.invoke(IPC_CHANNELS.sketchIngestReadings, {
      sessionId: opened.sessionId, baseEditSeq: session().acceptedSeq,
      payload: {
        source: { kind: 'image', imageId: image.imageId, sha256: 'a'.repeat(64) },
        readings: [{ kind: 'dimension', symbol: 'E1', nominalQ: 10_000,
          upperDeviationQ: 0, lowerDeviationQ: 0, unit: 'mm' }],
        boxes: [{ symbol: 'E1', rect: null }],
      },
    }) as IpcResult<unknown>
    expect(result.ok).toBe(false)
  })
})
