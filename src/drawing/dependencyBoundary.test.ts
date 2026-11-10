/**
 * 依赖边界测试（V3-C）：把两条红线固化成可执行断言。
 *
 * 1. 标注数字只能来自 parameter q，不能来自像素/缩放后几何；
 * 2. PDF 必须走 printToPDF 读同一份 DrawingData，不能截图/整页 image。
 *
 * 这两条同时挡住 MUT-C1 / MUT-C2：变异后本文件必须变红。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderDrawingSvg, validateDrawingSvgMarkup } from './renderDrawingSvg'
import { formatQWithDecimals, resolveDimension } from './formatDimension'
import { buildSpacerDrawing } from './spacerDrawing'
import { parseSpacerParameters } from '../parts/spacerParameters'

const root = process.cwd()

function source(relative: string): string {
  return readFileSync(path.join(root, relative), 'utf8')
}

/** 去掉注释后再做“源码不得出现”的扫描，避免注释里的反例词汇误报。 */
function codeOnly(relative: string): string {
  return source(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('MUT-C1 边界：标注只读参数真值', () => {
  it('resolveDimension 不引用几何/像素/DPR/zoom，只查 parameterId', () => {
    const text = codeOnly('src/drawing/formatDimension.ts')
    expect(text).toContain('resolveDimension')
    for (const forbidden of [
      'getBBox',
      'clientWidth',
      'devicePixelRatio',
      'scaleFactor',
      'geometryMm',
      'primitives',
      'toFixed',
    ]) {
      expect(text).not.toContain(forbidden)
    }
    expect(text).toContain('parameterId')
    expect(text).toContain('item.valueQ')
  })

  it('同一 q 在不同比例/不同画布缩放下标注文字完全相同', () => {
    const parsed = parseSpacerParameters({
      innerDiameter: '20.00',
      outerDiameter: '32.00',
      length: '12.10',
    })
    if (!parsed.ok) throw new Error(parsed.message)
    const texts = new Set<string>()
    for (const scale of [
      { numerator: 2, denominator: 1 },
      { numerator: 1, denominator: 1 },
      { numerator: 1, denominator: 2 },
      { numerator: 1, denominator: 10 },
    ]) {
      const data = buildSpacerDrawing({
        projectId: 'project-boundary',
        revisionId: 'rev-1',
        drawingId: 'drawing-boundary',
        parameters: parsed.parameters,
        scale,
        frameFields: {
          partName: '隔套',
          drawingNumber: '',
          version: '',
          material: '',
          tolerance: '',
          surface: '',
          drafter: '',
          date: '',
        },
      })
      const svg = renderDrawingSvg(data)
      const lengthText = svg.match(/data-annotation-id="ann.length"[\s\S]*?class="t-dim">([^<]+)</)?.[1]
      texts.add(lengthText ?? 'missing')
    }
    expect([...texts]).toEqual(['12.10'])
    // 12.1001 不能在两位/三位小数下被裁成 12.10。
    expect(formatQWithDecimals(121001, 2)).toBeNull()
    expect(resolveDimension('param:spacer:length', parsed.parameters).ok).toBe(true)
  })
})

describe('MUT-C2 边界：PDF 不读像素', () => {
  it('drawingPdf 必须调用 printToPDF，且不得出现截图/位图 API', () => {
    const text = codeOnly('desktop/main/drawingPdf.ts')
    expect(text).toContain('printToPDF')
    expect(text).toContain('PRINT_PDF_OPTIONS')
    for (const forbidden of [
      'capturePage',
      'captureScreenshot',
      'toDataURL',
      'nativeImage',
      'toPNG',
      'image/png',
      'getUserMedia',
    ]) {
      expect(text).not.toContain(forbidden)
    }
  })

  it('打印页只接收 SVG + 字体 data URL，不接收位图或路径', () => {
    const text = codeOnly('src/desktop/drawingPrintEntry.ts')
    expect(text).toContain('svg: string')
    expect(text).toContain('fonts: PrintFontAsset[]')
    for (const forbidden of ['bitmap', 'dataUrlPng', 'canvas.toDataURL', 'ipcRenderer', 'require(']) {
      expect(text).not.toContain(forbidden)
    }
  })

  it('SVG 序列化器不输出 image/foreignObject/script，校验器拒绝注入', () => {
    const parsed = parseSpacerParameters({
      innerDiameter: '20.00',
      outerDiameter: '32.00',
      length: '12.00',
    })
    if (!parsed.ok) throw new Error(parsed.message)
    const data = buildSpacerDrawing({
      projectId: 'project-boundary',
      revisionId: 'rev-1',
      drawingId: 'drawing-boundary',
      parameters: parsed.parameters,
      scale: { numerator: 1, denominator: 1 },
      frameFields: {
        partName: '隔套',
        drawingNumber: '',
        version: '',
        material: '',
        tolerance: '',
        surface: '',
        drafter: '',
        date: '',
      },
    })
    const svg = renderDrawingSvg(data)
    expect(svg).not.toMatch(/<image|<foreignObject|<script/)
    const injected = svg.replace('</svg>', '<image href="https://evil.example/x.png"/></svg>')
    expect(validateDrawingSvgMarkup(injected, data).ok).toBe(false)
  })
})
