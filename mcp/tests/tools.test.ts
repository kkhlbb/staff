/**
 * 五个工具的行为与边界：真实文件、真实字节、幂等、拒绝非法输入。
 * 另外锁死红线：工具清单只有这五个，且没有任何写项目/提交/删除类工具。
 */
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { TOOLS } from '../tools/index'
import { runCalcChain } from '../tools/calc-chain'
import { runCheckRequirement } from '../tools/check-requirement'
import { runDescribeProject } from '../tools/describe-project'
import { runReadTaskbook } from '../tools/read-taskbook'
import { runRenderDrawing } from '../tools/render-drawing'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const PDF = `${ROOT}docs/evidence/V3.5/fixtures/taskbook-2p.pdf`
const PROJECT = `${ROOT}docs/evidence/v40-stage4/fixtures/a40-1204.cunlian`

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'cunlian-mcp-test-'))
}

describe('红线：工具清单固定为五个只读/计算工具', () => {
  it('没有写项目/提交/保存/删除类工具', () => {
    expect(TOOLS.map((tool) => tool.definition.name)).toEqual([
      'read_taskbook',
      'calc_chain',
      'check_requirement',
      'render_drawing',
      'describe_project',
    ])
    for (const tool of TOOLS) {
      expect(tool.definition.name).not.toMatch(/write|save|commit|push|delete|update|merge/i)
    }
  })

  it('五个工具都返回 readOnly: true（render_drawing 只新增导出文件）', async () => {
    const dir = await tempDir()
    const outputs = [
      await runCalcChain({
        parameters: { innerDiameterQ: 200000, outerDiameterQ: 320000, lengthQ: 120000 },
      }),
      await runCheckRequirement({ cQ: 1500, cMaxQ: 2500, lowerQ: 1000, upperQ: 3000 }),
      await runDescribeProject({ path: PROJECT }),
      await runRenderDrawing({
        parameters: { innerDiameter: '20.00', outerDiameter: '32.00', length: '12.00' },
        format: 'svg',
        outputDir: dir,
      }),
    ]
    for (const output of outputs) {
      expect(output.readOnly).toBe(true)
    }
  })
})

describe('read_taskbook', () => {
  it('真实 PDF：候选带页/选区/原文出处，出处完整性由 isProvenanceCompleteness 判', async () => {
    const result = await runReadTaskbook({ pdfPath: PDF, pageFrom: 1, pageTo: 2 })
    expect(result.pageCount).toBe(2)
    expect(result.extractorVersion).toBe('document-extractor-8')
    const candidates = result.candidates as Record<string, unknown>[]
    expect(candidates.length).toBeGreaterThan(0)
    for (const candidate of candidates) {
      const values = candidate.values as {
        valueQ: number | null;
        unit: string | null;
        provenance: { complete: boolean; page: number; rectPdf: number[]; textSnippet: string }[]
      }[]
      for (const value of values) {
        expect(value.provenance.length).toBeGreaterThan(0)
        for (const ref of value.provenance) {
          expect(ref.complete).toBe(true)
          expect(ref.page).toBeGreaterThanOrEqual(1)
          expect(ref.rectPdf).toHaveLength(4)
          expect(ref.textSnippet.length).toBeGreaterThan(0)
          // 单位不是 mm 时 valueQ 必须为 null，不静默换算。
          if (value.unit !== 'mm') expect(value.valueQ).toBeNull()
        }
      }
    }
    expect(Array.isArray(result.blockers)).toBe(true)
  })

  it('不存在的路径 → NOT_FOUND；相对路径 → INVALID_ARGUMENTS', async () => {
    await expect(runReadTaskbook({ pdfPath: '/no/such/file.pdf' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await expect(runReadTaskbook({ pdfPath: 'docs/x.pdf' })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENTS',
    })
  })
})

describe('calc_chain / check_requirement 输入校验', () => {
  it('parameters 与 terms 必须二选一', async () => {
    await expect(runCalcChain({})).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' })
    await expect(
      runCalcChain({
        parameters: { innerDiameterQ: 200000, outerDiameterQ: 320000, lengthQ: 120000 },
        terms: [
          { symbol: 'A', nominalQ: 1, lowerDeviationQ: 0, upperDeviationQ: 0, sign: 1 },
          { symbol: 'B', nominalQ: 1, lowerDeviationQ: 0, upperDeviationQ: 0, sign: -1 },
        ],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' })
  })

  it('q 必须是安全整数；外径必须大于内径（走内核参数校验）', async () => {
    await expect(
      runCalcChain({
        parameters: { innerDiameterQ: 200000.5, outerDiameterQ: 320000, lengthQ: 120000 },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' })
    await expect(
      runCalcChain({
        parameters: { innerDiameterQ: 320000, outerDiameterQ: 200000, lengthQ: 120000 },
      }),
    ).rejects.toThrow(/外径必须大于内径/)
  })

  it('terms 模式走同一内核：与手算极值一致', async () => {
    const result = await runCalcChain({
      terms: [
        { symbol: 'H', nominalQ: 522000, lowerDeviationQ: -200, upperDeviationQ: 200, sign: 1 },
        { symbol: 'B1', nominalQ: 200000, lowerDeviationQ: -100, upperDeviationQ: 100, sign: -1 },
        { symbol: 'S', nominalQ: 120000, lowerDeviationQ: -100, upperDeviationQ: 100, sign: -1 },
        { symbol: 'B2', nominalQ: 200000, lowerDeviationQ: -100, upperDeviationQ: 100, sign: -1 },
      ],
      target: { minQ: 1000, maxQ: 3000 },
    })
    const view = result.result as { nominalQ: number; minQ: number; maxQ: number }
    expect(view).toMatchObject({ nominalQ: 2000, minQ: 1500, maxQ: 2500 })
    const target = result.target as { status: string; lowerMarginQ: number }
    expect(target.status).toBe('within')
    expect(target.lowerMarginQ).toBe(500)
  })

  it('check_requirement 拒绝下界大于上界、cMaxQ 小于 cQ', async () => {
    await expect(runCheckRequirement({ cQ: 0, lowerQ: 3000, upperQ: 1000 })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENTS',
    })
    await expect(
      runCheckRequirement({ cQ: 2000, cMaxQ: 1000, lowerQ: 0, upperQ: 3000 }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' })
  })
})

describe('render_drawing', () => {
  it('SVG：真实文件 + 字节数 + SHA-256 + 无外部来源标记', async () => {
    const dir = await tempDir()
    const result = await runRenderDrawing({
      parameters: { innerDiameter: '20.00', outerDiameter: '32.00', length: '12.05' },
      format: 'svg',
      outputDir: dir,
    })
    const filePath = result.filePath as string
    expect(filePath.startsWith(dir)).toBe(true)
    const info = await stat(filePath)
    expect(info.size).toBe(result.byteSize)
    expect(info.size).toBeGreaterThan(1000)
    const bytes = await readFile(filePath)
    expect(bytes.subarray(0, 5).toString('utf8')).toBe('<?xml')
    expect(result.sourceMarker).toContain('无外部原文件')
    expect(result.unprovenanced).toBe(true)
    expect(String(result.sha256)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('DXF 2000：AC1015 头 + 尺寸实体；拒绝非法格式与相对目录', async () => {
    const dir = await tempDir()
    const result = await runRenderDrawing({
      parameters: { innerDiameter: '20.00', outerDiameter: '32.00', length: '12.10' },
      format: 'dxf',
      dxfVersion: '2000',
      outputDir: dir,
    })
    const text = (await readFile(result.filePath as string)).toString('latin1')
    expect(text).toContain('AC1015')
    expect(text).toContain('DIMENSION')
    expect(String(result.fileName)).toMatch(/DXF-AC1015\.dxf$/)

    await expect(
      runRenderDrawing({
        parameters: { innerDiameter: '20.00', outerDiameter: '32.00', length: '12.00' },
        format: 'pdf',
        outputDir: dir,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' })
    await expect(
      runRenderDrawing({
        parameters: { innerDiameter: '20.00', outerDiameter: '32.00', length: '12.00' },
        format: 'svg',
        outputDir: 'relative/dir',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' })
  })
})

describe('describe_project', () => {
  it('真实 .cunlian：正式版本、参数、组成环、条款；只读', async () => {
    const result = await runDescribeProject({ path: PROJECT })
    expect(result.project).toMatchObject({ id: 'project-a', sourceKind: 'pdf' })
    expect((result.parameters as unknown[]).length).toBe(3)
    expect((result.terms as unknown[]).length).toBe(4)
    expect(result.formalVersion).not.toBeNull()
    const requirement = result.requirement as { lowerQ: number; upperQ: number } | null
    expect(requirement).not.toBeNull()
    expect(requirement?.lowerQ).toBe(1000)
    expect(requirement?.upperQ).toBe(3000)
    const provenance = result.provenance as { incomplete: number; items: unknown[] }
    expect(provenance.incomplete).toBe(0)
    expect(result.readOnly).toBe(true)
  })

  it('不是项目文件 → TOOL_FAILED（不猜结构）', async () => {
    await expect(runDescribeProject({ path: PDF })).rejects.toMatchObject({ code: 'TOOL_FAILED' })
  })
})

describe('幂等：同输入连跑 3 次，输出字节一致', () => {
  it('calc_chain / check_requirement / describe_project / read_taskbook', async () => {
    const inputs = [
      () => runCalcChain({
        parameters: { innerDiameterQ: 200000, outerDiameterQ: 320000, lengthQ: 120000 },
      }),
      () => runCheckRequirement({ cQ: 500, cMaxQ: 1500, lowerQ: 1000, upperQ: 3000 }),
      () => runDescribeProject({ path: PROJECT }),
      () => runReadTaskbook({ pdfPath: PDF, pageFrom: 1, pageTo: 2 }),
    ]
    for (const run of inputs) {
      const outputs = [JSON.stringify(await run()), JSON.stringify(await run()), JSON.stringify(await run())]
      expect(new Set(outputs).size).toBe(1)
    }
  })

  it('render_drawing 连跑 3 次：同一路径、同一字节、同一 SHA-256', async () => {
    const dir = await tempDir()
    const call = () =>
      runRenderDrawing({
        parameters: { innerDiameter: '20.00', outerDiameter: '32.00', length: '12.04' },
        format: 'dxf',
        dxfVersion: 'r12',
        outputDir: dir,
      })
    const results = [await call(), await call(), await call()]
    expect(new Set(results.map((item) => item.sha256)).size).toBe(1)
    expect(new Set(results.map((item) => item.filePath)).size).toBe(1)
    const bytes = await readFile(results[0].filePath as string)
    expect(bytes.byteLength).toBe(results[0].byteSize)
  })
})
