/**
 * 真实 Electron 出图取证脚本（不随应用打包，不注册 IPC，不进入产品路径）。
 *
 * 用生产模块 buildSpacerDrawing → renderDrawingSvg → printDrawingToPdf 生成
 * SVG 与 PDF，校验 PDF 结构并把产物写到证据目录。运行：
 *
 *   npx vite build --config vite.print.config.ts --outDir .vite/harness-print
 *   npx vite build --config vite.harness.config.ts
 *   npx electron .vite/harness/pdf-harness.cjs
 */
import { app } from 'electron'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildSpacerDrawing } from '../../../src/drawing/spacerDrawing'
import { parseSpacerParameters } from '../../../src/parts/spacerParameters'
import { renderDrawingSvg } from '../../../src/drawing/renderDrawingSvg'
import { printDrawingToPdf } from '../../main/drawingPdf'
import { checkPdf } from '../../main/pdfCheck'

app.disableHardwareAcceleration()

const FRAME = {
  partName: '隔套',
  drawingNumber: '',
  version: '',
  material: '',
  tolerance: '',
  surface: '',
  drafter: '',
  date: '',
}

async function main(): Promise<number> {
  await app.whenReady()
  const root = process.cwd()
  const evidenceDir = process.env.CUNLIAN_EVIDENCE_DIR ?? path.join(root, 'docs/evidence/V3-C')
  await fsp.mkdir(evidenceDir, { recursive: true })

  const parsed = parseSpacerParameters({
    innerDiameter: '20.00',
    outerDiameter: '32.00',
    length: '12.00',
  })
  if (!parsed.ok) throw new Error(parsed.message)
  const data = buildSpacerDrawing({
    projectId: 'project-evidence-c',
    revisionId: 'rev-evidence-c',
    drawingId: 'drawing:project-evidence-c:spacer',
    parameters: parsed.parameters,
    scale: { numerator: 1, denominator: 1 },
    frameFields: FRAME,
  })
  const svg = renderDrawingSvg(data)
  await fsp.writeFile(path.join(evidenceDir, 'spacer-a4-1to1.svg'), svg, 'utf8')
  await fsp.writeFile(
    path.join(evidenceDir, 'spacer-a4-1to1.drawingdata.json'),
    JSON.stringify(data, null, 2),
    'utf8',
  )

  // 五个登记比例各留一份 SVG；参数与标注文字必须不变。
  const scaleSummaries = []
  for (const scale of [
    { numerator: 2, denominator: 1 },
    { numerator: 1, denominator: 1 },
    { numerator: 1, denominator: 2 },
    { numerator: 1, denominator: 5 },
    { numerator: 1, denominator: 10 },
  ]) {
    const scaled = buildSpacerDrawing({
      projectId: data.projectId,
      revisionId: data.revisionId,
      drawingId: data.drawingId,
      parameters: data.parameterSnapshot,
      scale,
      frameFields: FRAME,
    })
    const key = `${scale.numerator}to${scale.denominator}`
    await fsp.writeFile(
      path.join(evidenceDir, `spacer-a4-${key}.svg`),
      renderDrawingSvg(scaled),
      'utf8',
    )
    scaleSummaries.push({
      scale: `${scale.numerator}:${scale.denominator}`,
      fingerprint: scaled.fingerprint,
      fits: scaled.layout.fits,
      annotations: scaled.annotations.map((annotation) => ({
        id: annotation.annotationId,
        parameterId: annotation.parameterId,
      })),
    })
  }
  await fsp.writeFile(
    path.join(evidenceDir, 'scale-summary.json'),
    JSON.stringify(scaleSummaries, null, 2),
    'utf8',
  )

  const fontDir = path.join(root, 'public', 'fonts')
  const fonts = await Promise.all(
    [
      { family: 'Noto Sans SC Cunlian', file: 'NotoSansSC-Cunlian-subset.woff2' },
      { family: 'Noto Sans Math Cunlian', file: 'NotoSansMath-Cunlian-symbols.woff2' },
    ].map(async (asset) => ({
      family: asset.family,
      dataUrl: `data:font/woff2;base64,${(await fsp.readFile(path.join(fontDir, asset.file))).toString('base64')}`,
    })),
  )
  const printEntry =
    process.env.CUNLIAN_PRINT_ENTRY ??
    path.join(root, '.vite', 'harness-print', 'index.print.html')

  const pdf = await printDrawingToPdf({
    svg,
    fonts,
    drawingId: data.drawingId,
    fingerprint: data.fingerprint,
    printEntryUrl: pathToFileURL(printEntry).toString(),
  })
  const pdfPath = path.join(evidenceDir, 'spacer-a4-1to1.pdf')
  await fsp.writeFile(pdfPath, pdf)
  const report = checkPdf(pdf)
  await fsp.writeFile(
    path.join(evidenceDir, 'spacer-a4-1to1.pdfcheck.json'),
    JSON.stringify({ fingerprint: data.fingerprint, byteSize: pdf.byteLength, ...report }, null, 2),
    'utf8',
  )
  console.log(
    JSON.stringify({
      ok: report.ok,
      pdfPath,
      svgPath: path.join(evidenceDir, 'spacer-a4-1to1.svg'),
      byteSize: pdf.byteLength,
      pageCount: report.pageCount,
      effectiveWidthPt: report.effectiveWidthPt,
      effectiveHeightPt: report.effectiveHeightPt,
      fonts: report.fonts,
      embeddedFontCount: report.embeddedFontCount,
      imageCount: report.imageCount,
      vectorOperatorCount: report.vectorOperatorCount,
      errors: report.errors,
    }),
  )
  return report.ok ? 0 : 1
}

main()
  .then((code) => {
    app.exit(code)
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error))
    app.exit(1)
  })
