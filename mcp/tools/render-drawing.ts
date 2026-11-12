/**
 * 工具 `render_drawing`：用产品同一条出图路径生成 SVG / DXF（只写调用方指定的输出文件）。
 *
 * 出图**只调用** `src/drawing/spacerDrawing.ts` 的模板与
 * `src/drawing/renderDrawingSvg.ts` / `src/drawing/dxfExport.ts`；生成后按产品
 * 导出通道的方式把写出的字节读回来做结构校验，再报字节数与 SHA-256。
 *
 * 这是唯一的“写东西”的工具，写的只是新导出文件（不写项目、不改参数、不提交）。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildSpacerDrawing } from '../../src/drawing/spacerDrawing'
import { renderDrawingSvg, validateDrawingSvgMarkup } from '../../src/drawing/renderDrawingSvg'
import {
  buildDxfDocument,
  DXF_ACAD_VERSION,
  sourceMarkerOf,
  validateDxfBytes,
  type DxfVersion,
} from '../../src/drawing/dxfExport'
import { SPACER_PART_ID } from '../../src/drawing/types'
import { parseSpacerParameters } from '../../src/parts/spacerParameters'
import type { ProjectFileSpacerParameter } from '../../src/project-file/types'
import {
  asObject,
  readEnum,
  readString,
  requireAbsolutePath,
  ToolInputError,
} from '../lib/args'
import { sha256, success } from '../lib/format'
import {
  MCP_DRAWING_ID,
  MCP_PROJECT_ID,
  MCP_REVISION_ID,
  MCP_PROVENANCE_NOTE,
  mcpFrameFields,
} from '../lib/spacer'

const FORMATS = ['svg', 'dxf'] as const
const DXF_VERSIONS = ['r12', '2000'] as const
const SAFE_NUMBER = /^-?\d+(?:\.\d+)?$/

export const renderDrawingDefinition = {
  name: 'render_drawing',
  title: '出图（SVG / DXF）',
  description:
    '按隔套参数生成 A4 工程图 SVG 或 DXF（R12 / 2000），写入调用方指定的绝对目录，返回真实文件路径、字节数、SHA-256 与「用户输入，无外部原文件」依据标记。只新增导出文件，不写项目、不提交。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          innerDiameter: { type: 'string', description: '内径，十进制 mm 字符串，最多 4 位小数' },
          outerDiameter: { type: 'string', description: '外径，十进制 mm 字符串，最多 4 位小数' },
          length: { type: 'string', description: '长度，十进制 mm 字符串，最多 4 位小数' },
        },
        required: ['innerDiameter', 'outerDiameter', 'length'],
      },
      format: { type: 'string', enum: ['svg', 'dxf'] },
      dxfVersion: {
        type: 'string',
        enum: ['r12', '2000'],
        description: 'format=dxf 时的版本；默认 2000。',
      },
      outputDir: { type: 'string', description: '输出目录的绝对路径（不存在则创建）。' },
    },
    required: ['parameters', 'format', 'outputDir'],
  },
} as const

function parametersOf(raw: unknown): ProjectFileSpacerParameter[] {
  const input = asObject(raw, 'parameters')
  const parsed = parseSpacerParameters({
    innerDiameter: readString(input, 'innerDiameter', { required: true, maxLength: 32 })!,
    outerDiameter: readString(input, 'outerDiameter', { required: true, maxLength: 32 })!,
    length: readString(input, 'length', { required: true, maxLength: 32 })!,
  })
  if (!parsed.ok) {
    throw new ToolInputError(
      'INVALID_ARGUMENTS',
      `隔套参数不合法（${parsed.field}）：${parsed.message}`,
      parsed.reason,
    )
  }
  return parsed.parameters.map((parameter) => ({ ...parameter, parameterRevision: 1 }))
}

function safeToken(value: string): string {
  if (!SAFE_NUMBER.test(value)) {
    throw new ToolInputError('INVALID_ARGUMENTS', '文件名只接受十进制数值文本', value)
  }
  return value
}

export async function runRenderDrawing(rawArguments: unknown): Promise<Record<string, unknown>> {
  const args = asObject(rawArguments ?? {}, 'arguments')
  const parameters = parametersOf(args.parameters)
  const format = readEnum(args, 'format', FORMATS, { required: true })!
  const dxfVersion =
    format === 'dxf' ? readEnum(args, 'dxfVersion', DXF_VERSIONS) ?? ('2000' as DxfVersion) : null
  const outputDir = requireAbsolutePath(
    readString(args, 'outputDir', { required: true, maxLength: 1000 })!,
    'outputDir',
  )

  const texts = asObject(args.parameters, 'parameters')
  const drawing = buildSpacerDrawing({
    projectId: MCP_PROJECT_ID,
    revisionId: MCP_REVISION_ID,
    drawingId: MCP_DRAWING_ID,
    partId: SPACER_PART_ID,
    parameters,
    scale: { numerator: 1, denominator: 1 },
    frameFields: mcpFrameFields('草稿 · 第 1 版'),
  })

  const baseName = [
    'spacer',
    `i${safeToken(String(texts.innerDiameter))}`,
    `o${safeToken(String(texts.outerDiameter))}`,
    `l${safeToken(String(texts.length))}`,
  ].join('-')

  let bytes: Uint8Array
  let extension: string
  if (format === 'svg') {
    const markup = renderDrawingSvg(drawing)
    const check = validateDrawingSvgMarkup(markup, drawing)
    if (!check.ok) {
      throw new ToolInputError('TOOL_FAILED', 'SVG 结构校验失败', check.errors.join('；'))
    }
    bytes = new TextEncoder().encode(markup)
    extension = 'svg'
  } else {
    const built = buildDxfDocument(drawing, dxfVersion as DxfVersion)
    bytes = built.bytes
    extension = `DXF-${DXF_ACAD_VERSION[dxfVersion as DxfVersion]}.dxf`
  }

  await mkdir(outputDir, { recursive: true })
  const filePath = join(outputDir, `${baseName}-${extension}`)
  await writeFile(filePath, bytes)

  // 与产品导出通道一致：写出的字节读回来做结构校验，校验不过就报错，不报成功。
  const written = new Uint8Array(await readFile(filePath))
  if (format === 'svg') {
    const check = validateDrawingSvgMarkup(new TextDecoder().decode(written), drawing)
    if (!check.ok) {
      throw new ToolInputError('TOOL_FAILED', '写出后 SVG 校验失败', check.errors.join('；'))
    }
  } else {
    const check = validateDxfBytes(written, drawing, dxfVersion as DxfVersion)
    if (!check.ok) {
      throw new ToolInputError('TOOL_FAILED', '写出后 DXF 校验失败', check.errors.join('；'))
    }
  }

  const digest = await sha256(written)
  const sourceMarker = sourceMarkerOf(drawing)
  return success('render_drawing', {
    format,
    dxfVersion,
    filePath,
    fileName: filePath.split('/').pop() ?? filePath,
    byteSize: written.byteLength,
    sha256: digest,
    drawingId: drawing.drawingId,
    drawingFingerprint: drawing.fingerprint,
    sourceMarker,
    unprovenanced: sourceMarker.includes('无外部原文件'),
    parameters: parameters.map((parameter) => ({
      key: parameter.key,
      valueQ: parameter.valueQ,
      inputDecimals: parameter.inputDecimals,
    })),
    provenance: MCP_PROVENANCE_NOTE,
    readOnly: true,
  })
}
