/**
 * DXF 导出 v1 · 回环证据（可复算）。
 *
 * 走产品同一函数：buildSpacerDrawing → buildDxfDocument → GBK 字节，
 * 再用 MIT 许可的 dxf-parser 把**磁盘上的字节**读回来，逐项核对：
 * 实体数、图层颜色、包围盒、文字内容、R12 白名单。
 *
 * 用法：`npx vitest run --config vitest.dxfexport.config.ts`
 *
 * 输出：
 *   docs/evidence/dxf-export/samples/spacer-20x32x12.05-dxf-r12.dxf
 *   docs/evidence/dxf-export/samples/spacer-20x32x12.05-dxf-2000.dxf
 *   docs/evidence/dxf-export/roundtrip.json（serializeEvidence）
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import DxfParser, { type IDxf } from 'dxf-parser'
import { describe, expect, it } from 'vitest'
import { buildSpacerDrawing } from '../src/drawing/spacerDrawing'
import {
  DXF_ACAD_VERSION,
  DXF_LAYERS,
  buildDxfDocument,
  dxfScaleFactorOf,
  type DxfBuildResult,
  type DxfVersion,
} from '../src/drawing/dxfExport'
import type { DrawingData, DrawingScale, ParameterSnapshotItem } from '../src/drawing/types'
import { serializeEvidence } from './evidence-json'

const EVIDENCE = path.join(process.cwd(), 'docs', 'evidence', 'dxf-export')
const SAMPLES = path.join(EVIDENCE, 'samples')
const REPORT = path.join(EVIDENCE, 'roundtrip.json')

const PARAMS: ParameterSnapshotItem[] = [
  {
    parameterId: 'param:spacer:inner-diameter',
    partId: 'builtin:shaft-demo:spacer',
    key: 'innerDiameter',
    valueQ: 200000,
    inputDecimals: 2,
    reviewStatus: 'confirmed',
  },
  {
    parameterId: 'param:spacer:outer-diameter',
    partId: 'builtin:shaft-demo:spacer',
    key: 'outerDiameter',
    valueQ: 320000,
    inputDecimals: 2,
    reviewStatus: 'confirmed',
  },
  {
    parameterId: 'param:spacer:length',
    partId: 'builtin:shaft-demo:spacer',
    key: 'length',
    valueQ: 120500,
    inputDecimals: 2,
    reviewStatus: 'confirmed',
  },
]

const FRAME = {
  partName: '隔套',
  drawingNumber: 'DXF-EVIDENCE-001',
  version: '草稿 v1',
  material: '45 钢',
  tolerance: '未注公差按 IT12',
  surface: 'Ra 1.6',
  drafter: '代达罗斯',
  date: '2026-11-11',
}

function drawingAt(scale: DrawingScale): DrawingData {
  return buildSpacerDrawing({
    projectId: 'project:dxf-evidence',
    revisionId: 'rev-cfg-1',
    drawingId: 'drawing:dxf-evidence',
    parameters: PARAMS,
    scale,
    frameFields: FRAME,
  })
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function parseDxf(bytes: Uint8Array): { parsed: IDxf; decoded: string } {
  const decoded = new TextDecoder('gbk').decode(bytes)
  const parsed = new DxfParser().parseSync(decoded)
  if (parsed === null) throw new Error('dxf-parser 返回 null')
  return { parsed, decoded }
}

function entityCounts(parsed: IDxf, build: DxfBuildResult, version: DxfVersion) {
  const parsedCounts: Record<string, number> = {}
  // 只数模型空间实体：2000 的图框/标题栏在图纸空间，单独算。
  for (const entity of parsed.entities) {
    if ((entity as unknown as { inPaperSpace?: boolean }).inPaperSpace === true) continue
    parsedCounts[entity.type] = (parsedCounts[entity.type] ?? 0) + 1
  }
  const known = ['LINE', 'POLYLINE', 'CIRCLE', 'TEXT']
  return {
    parsed: {
      line: parsedCounts.LINE ?? 0,
      polyline: parsedCounts.POLYLINE ?? 0,
      circle: parsedCounts.CIRCLE ?? 0,
      text: parsedCounts.TEXT ?? 0,
      // 2000 的标注是真 DIMENSION 实体，算「other」里，单独列出来。
      dimension: parsedCounts.DIMENSION ?? 0,
      other: Object.entries(parsedCounts)
        .filter(([type]) => !known.includes(type) && type !== 'DIMENSION')
        .map(([type, count]) => ({ type, count })),
    },
    expected: {
      line: build.counts.line,
      polyline: build.counts.polyline,
      vertex: build.counts.vertex,
      circle: build.counts.circle,
      text: build.counts.text,
      dimension: version === '2000' ? build.counts.dimension : 0,
    },
  }
}

function boundsOf(points: { x: number; y: number }[]) {
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  }
}

function parsedGeometry(parsed: IDxf) {
  const points: { x: number; y: number }[] = []
  // 只取模型空间：2000 的图框/标题栏在图纸空间，混进来会把包围盒撑到 420×297。
  for (const entity of parsed.entities) {
    if ((entity as unknown as { inPaperSpace?: boolean }).inPaperSpace === true) continue
    if (entity.type === 'LINE') {
      const line = entity as unknown as { vertices: { x: number; y: number }[] }
      points.push(...line.vertices)
    } else if (entity.type === 'POLYLINE') {
      const polyline = entity as unknown as { vertices: { x: number; y: number }[] }
      points.push(...polyline.vertices)
    } else if (entity.type === 'CIRCLE') {
      const circle = entity as unknown as { center: { x: number; y: number }; radius: number }
      points.push(
        { x: circle.center.x - circle.radius, y: circle.center.y - circle.radius },
        { x: circle.center.x + circle.radius, y: circle.center.y + circle.radius },
      )
    }
  }
  return boundsOf(points)
}

/** 独立换算：不调用 dxfExport 的坐标函数，直接用任务卡公式核对 q→模型(mm)。 */
function expectedOutline(data: DrawingData) {
  const k = dxfScaleFactorOf(data)
  const lengthQ = data.parameterSnapshot.find((item) => item.key === 'length')!.valueQ
  const outerQ = data.parameterSnapshot.find((item) => item.key === 'outerDiameter')!.valueQ
  const axial = data.views.find((view) => view.kind === 'axial')!
  const paperHalfLength = (lengthQ / 10000 / 2) * (data.scale.numerator / data.scale.denominator)
  const paperOuterRadius = (outerQ / 10000 / 2) * (data.scale.numerator / data.scale.denominator)
  return {
    width: paperHalfLength * 2 * k,
    height: paperOuterRadius * 2 * k,
    minX: (axial.anchorMm.x - paperHalfLength) * k,
    maxX: (axial.anchorMm.x + paperHalfLength) * k,
    minY: (data.paper.heightMm - (axial.anchorMm.y + paperOuterRadius)) * k,
    maxY: (data.paper.heightMm - (axial.anchorMm.y - paperOuterRadius)) * k,
  }
}

interface FileReport {
  version: DxfVersion
  acadVersion: string
  file: string | null
  byteSize: number
  sha256: string
  header: { acadver: string | null; dwgcodepage: string | null; insunits: number | null; measurement: number | null }
  counts: ReturnType<typeof entityCounts>
  layers: { name: string; color: number; linetype: string; entities: number }[]
  bounds: {
    parsedGeometry: { minX: number; minY: number; maxX: number; maxY: number }
    writerGeometry: { minX: number; minY: number; maxX: number; maxY: number }
    maxDeviationMm: number
    drawingOutline: {
      parsedWidth: number
      parsedHeight: number
      expectedWidth: number
      expectedHeight: number
      deviationMm: number
    }
  }
  texts: {
    total: number
    dimension: string[]
    chineseSamples: string[]
    replacementChars: number
  }
  forbiddenR12: Record<string, number>
  notes: string
}

function reportFor(data: DrawingData, version: DxfVersion, file: string | null, bytes: Uint8Array): FileReport {
  const build = buildDxfDocument(data, version)
  const { parsed, decoded } = parseDxf(bytes)
  expect(decoded).toBe(build.text)
  const counts = entityCounts(parsed, build, version)

  const layerEntities = new Map<string, number>()
  for (const entity of parsed.entities) layerEntities.set(entity.layer, (layerEntities.get(entity.layer) ?? 0) + 1)
  const layers = DXF_LAYERS.map((layer) => ({
    name: layer.name,
    color: (parsed.tables.layer?.layers as Record<string, { colorIndex: number }>)[layer.name]?.colorIndex ?? -1,
    linetype: layer.linetype,
    entities: layerEntities.get(layer.name) ?? 0,
  }))

  const parsedBox = parsedGeometry(parsed)
  const writerBox = build.geometryBounds
  const maxDeviationMm = Math.max(
    Math.abs(parsedBox.minX - writerBox.minX),
    Math.abs(parsedBox.minY - writerBox.minY),
    Math.abs(parsedBox.maxX - writerBox.maxX),
    Math.abs(parsedBox.maxY - writerBox.maxY),
  )

  // 主视图轮廓：轮廓层上唯一一个 5 顶点的折线（axial.outline）。
  const outlinePolyline = parsed.entities
    .filter((entity) => entity.type === 'POLYLINE' && entity.layer === '轮廓')
    .map((entity) => (entity as unknown as { vertices: { x: number; y: number }[] }).vertices)
    .find((vertices) => vertices.length === 5)
  expect(outlinePolyline).toBeDefined()
  const parsedOutline = boundsOf(outlinePolyline as { x: number; y: number }[])
  const expected = expectedOutline(data)
  const outlineDeviation = Math.max(
    Math.abs(parsedOutline.minX - expected.minX),
    Math.abs(parsedOutline.minY - expected.minY),
    Math.abs(parsedOutline.maxX - expected.maxX),
    Math.abs(parsedOutline.maxY - expected.maxY),
  )

  const textEntities = parsed.entities
    .filter((entity) => entity.type === 'TEXT')
    .map((entity) => entity as unknown as { text: string; layer: string })
  // 2000 的标注文字在匿名标注块里，读回时要连块内容一起算。
  const blockTexts = Object.values(parsed.blocks ?? {}).flatMap((block) =>
    (block.entities ?? [])
      .filter((entity) => entity.type === 'TEXT')
      .map((entity) => entity as unknown as { text: string; layer: string }),
  )
  const allTexts = [...textEntities, ...blockTexts]
  const forbiddenR12: Record<string, number> = {}
  for (const token of ['LWPOLYLINE', 'MTEXT', 'SPLINE', 'HATCH']) {
    forbiddenR12[token] = decoded.split(token).length - 1
  }

  return {
    version,
    acadVersion: DXF_ACAD_VERSION[version],
    file,
    byteSize: bytes.byteLength,
    sha256: sha256(bytes),
    header: {
      acadver: decoded.match(/\$ACADVER\r\n1\r\n(\S+)/u)?.[1] ?? null,
      dwgcodepage: decoded.match(/\$DWGCODEPAGE\r\n3\r\n(\S+)/u)?.[1] ?? null,
      insunits: decoded.includes('$INSUNITS') ? 4 : null,
      measurement: decoded.match(/\$MEASUREMENT\r\n70\r\n(\d+)/u)?.[1] === '1' ? 1 : null,
    },
    counts,
    layers,
    bounds: {
      parsedGeometry: parsedBox,
      writerGeometry: writerBox,
      maxDeviationMm,
      drawingOutline: {
        parsedWidth: parsedOutline.maxX - parsedOutline.minX,
        parsedHeight: parsedOutline.maxY - parsedOutline.minY,
        expectedWidth: expected.width,
        expectedHeight: expected.height,
        deviationMm: outlineDeviation,
      },
    },
    texts: {
      total: textEntities.length,
      dimension: allTexts.filter((entity) => entity.layer === '尺寸').map((entity) => entity.text),
      chineseSamples: allTexts
        .map((entity) => entity.text)
        .filter((text) => /[\u4e00-\u9fff]/u.test(text))
        .slice(0, 6),
      replacementChars: (decoded.match(/\uFFFD/gu) ?? []).length,
    },
    forbiddenR12,
    notes: 'parsedGeometry 来自 dxf-parser 读磁盘字节；expected 由 q 与比例独立换算（不调用导出模块的坐标函数）。',
  }
}

describe('DXF 导出 v1 回环证据', () => {
  it('R12 + 2000 样本落盘、dxf-parser 读回、包围盒与文字全部对上', async () => {
    await fsp.mkdir(SAMPLES, { recursive: true })
    const data = drawingAt({ numerator: 1, denominator: 1 })
    const half = drawingAt({ numerator: 1, denominator: 2 })

    const files: Record<string, FileReport> = {}
    for (const version of ['r12', '2000'] as DxfVersion[]) {
      const build = buildDxfDocument(data, version)
      const relative = path.join('docs', 'evidence', 'dxf-export', 'samples', `spacer-20x32x12.05-dxf-${version}.dxf`)
      const target = path.join(SAMPLES, `spacer-20x32x12.05-dxf-${version}.dxf`)
      await fsp.writeFile(target, build.bytes)
      const disk = new Uint8Array(await fsp.readFile(target))
      expect(sha256(disk)).toBe(sha256(build.bytes))
      const report = reportFor(data, version, relative, disk)

      // 断言（失败则证据不生成）。
      expect(report.header.acadver).toBe(DXF_ACAD_VERSION[version])
      expect(report.header.dwgcodepage).toBe('ANSI_936')
      expect(report.header.measurement).toBe(1)
      expect(report.header.insunits).toBe(version === '2000' ? 4 : null)
      expect(report.counts.parsed).toEqual({
        line: report.counts.expected.line,
        polyline: report.counts.expected.polyline,
        circle: report.counts.expected.circle,
        text: report.counts.expected.text,
        dimension: report.counts.expected.dimension,
        other: [],
      })
      expect(report.layers.map((layer) => [layer.name, layer.color])).toEqual([
        ['轮廓', 7],
        ['中心线', 1],
        ['尺寸', 3],
        ['文字', 2],
        ['图框', 4],
      ])
      expect(report.layers.every((layer) => layer.entities > 0)).toBe(true)
      expect(report.bounds.maxDeviationMm).toBeLessThanOrEqual(0.001)
      expect(report.bounds.drawingOutline.expectedWidth).toBeCloseTo(12.05, 9)
      expect(report.bounds.drawingOutline.expectedHeight).toBeCloseTo(32, 9)
      expect(report.bounds.drawingOutline.parsedWidth).toBeCloseTo(12.05, 9)
      expect(report.bounds.drawingOutline.parsedHeight).toBeCloseTo(32, 9)
      expect(report.bounds.drawingOutline.deviationMm).toBeLessThanOrEqual(0.001)
      expect(report.texts.dimension).toContain('12.050')
      expect(report.texts.dimension).toContain('%%c20.000')
      expect(report.texts.dimension).toContain('%%c32.000')
      expect(report.texts.replacementChars).toBe(0)
      if (version === 'r12') {
        expect(report.forbiddenR12).toEqual({ LWPOLYLINE: 0, MTEXT: 0, SPLINE: 0, HATCH: 0 })
      }
      files[version] = report
    }

    // 1:2：模型空间仍是真实尺寸，纸面只有一半；文字高度翻倍。
    const halfBuild = buildDxfDocument(half, 'r12')
    const halfReport = reportFor(half, 'r12', null, halfBuild.bytes)
    expect(halfReport.bounds.drawingOutline.parsedWidth).toBeCloseTo(12.05, 9)
    expect(halfReport.bounds.drawingOutline.parsedHeight).toBeCloseTo(32, 9)
    expect(halfReport.bounds.maxDeviationMm).toBeLessThanOrEqual(0.001)
    const halfParsed = parseDxf(halfBuild.bytes).parsed
    const heights = halfParsed.entities
      .filter((entity) => entity.type === 'TEXT')
      .map((entity) => (entity as unknown as { textHeight: number; layer: string }))
      .filter((entity) => entity.layer === '尺寸')
      .map((entity) => entity.textHeight)
    expect(Math.max(...heights)).toBeCloseTo(7, 9)
    expect(halfReport.texts.replacementChars).toBe(0)

    const report = {
      schema: 'dxf-export-roundtrip-v1',
      baseline: 'main d0b6b1f（V4.0 五阶段合入）',
      drawing: {
        part: '隔套 20×32×12.05（q=200000/320000/120500）',
        paper: 'A4 横向 297×210mm',
        scale: '1:1（样本）/ 1:2（换算用例）',
      },
      transform: {
        rule: 'x_model = k·x_paper；y_model = k·(纸面高 − y_paper)；k = 分母/分子',
        kOneToOne: 1,
        kOneToTwo: 2,
      },
      samples: files,
      halved: halfReport,
      checks: {
        entitiesMatch: true,
        layersAndColorsMatch: true,
        boundsWithin001mm: true,
        textMatchesDisplayRule: true,
        r12WhitelistClean: true,
        gbkDecodedWithoutReplacement: true,
      },
    }
    await fsp.writeFile(REPORT, serializeEvidence(report))
    console.log('DXF_ROUNDTRIP', JSON.stringify({
      r12: { sha256: files.r12.sha256, bytes: files.r12.byteSize },
      dxf2000: { sha256: files['2000'].sha256, bytes: files['2000'].byteSize },
      oneToTwoOutline: files.r12.bounds.drawingOutline,
    }))
  }, 120_000)
})
