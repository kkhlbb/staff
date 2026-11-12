/**
 * V4.0 阶段 4：导出产物证据（可复算）。
 *
 * 走与「侧栏导出已保存版本」完全相同的代码路径：
 *   decodeProjectFile → rebuildDrawingFromProject → renderDrawingSvg → DrawingExportStore.save
 * 唯一不经过的是系统保存对话框（纯 GUI，见 README §7 的可复现步骤）。
 *
 * 用法：
 *   npx vitest run --config vitest.v40stage4export.config.ts
 *
 * 输出：
 *   docs/evidence/v40-stage4/artifacts/a40-1204-approved.svg
 *   docs/evidence/v40-stage4/export-artifact.json
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeProjectFile } from '../src/project-file/codec'
import { rebuildDrawingFromProject } from '../src/drawing/rebuildDrawing'
import { renderDrawingSvg, validateDrawingSvgMarkup } from '../src/drawing/renderDrawingSvg'
import { sha256Hex } from '../src/sources/hash'
import { DrawingExportStore } from '../desktop/main/drawingExportStore'
import { serializeEvidence } from './evidence-json'

const EVIDENCE = path.join(process.cwd(), 'docs', 'evidence', 'v40-stage4')
/**
 * 输入是仓库里 e2e 走查用的已保存版本（不会被真实模型验收改写，产物可复算）；
 * A40-04 每次运行会把 12.04 的基线另存为 fixtures/a40-1204.cunlian，
 * 那份带当次随机 revisionId，不适合当“可复算产物”的输入。
 */
const SOURCE = path.join(EVIDENCE, 'fixtures', 'a40-project.cunlian')
const ARTIFACT_DIR = path.join(EVIDENCE, 'artifacts')
const ARTIFACT = path.join(ARTIFACT_DIR, 'a40-project-approved.svg')
const REPORT = path.join(EVIDENCE, 'export-artifact.json')

describe('V4.0 阶段 4 导出产物', () => {
  it('已保存版本 → 真 SVG（矢量、A4 横向、回执哈希与磁盘一致）', async () => {
    const projectBytes = new Uint8Array(await fsp.readFile(SOURCE))
    const decoded = await decodeProjectFile(projectBytes)
    if (!decoded.ok) throw new Error(`项目解码失败：${decoded.error.code} ${decoded.error.message}`)

    const rebuilt = rebuildDrawingFromProject(decoded.value.snapshot.project)
    if (!rebuilt.ok) throw new Error(`图纸重建失败：${rebuilt.message}`)
    const drawing = rebuilt.data
    const svg = renderDrawingSvg(drawing)
    const bytes = new TextEncoder().encode(svg)

    // 结构与产品导出前的校验同一个函数。
    const markup = validateDrawingSvgMarkup(svg, drawing)

    await fsp.mkdir(ARTIFACT_DIR, { recursive: true })
    const store = new DrawingExportStore()
    const existing = await store.fingerprint(ARTIFACT)
    const saved = await store.save({
      targetPath: ARTIFACT,
      kind: 'svg',
      bytes,
      expectedFingerprint: existing,
      verify: async (written) => {
        const report = validateDrawingSvgMarkup(new TextDecoder().decode(written), drawing)
        return report.ok ? { ok: true } : { ok: false, message: report.errors.join('；') }
      },
    })
    if (!saved.ok) throw new Error(`落盘失败：${saved.error.code} ${saved.error.message}`)

    const diskBytes = new Uint8Array(await fsp.readFile(ARTIFACT))
    const diskHash = await sha256Hex(diskBytes)
    const text = new TextDecoder().decode(diskBytes)
    const report = {
      source: path.relative(process.cwd(), SOURCE),
      sourceSha256: await sha256Hex(projectBytes),
      artifact: path.relative(process.cwd(), ARTIFACT),
      byteSize: diskBytes.byteLength,
      sha256: diskHash,
      receiptSha256: saved.value.fingerprint,
      receiptMatchesDisk: saved.value.fingerprint === diskHash,
      renderValid: markup.ok,
      vector: {
        pathElements: (text.match(/<path[ >]/gu) ?? []).length,
        textElements: (text.match(/<text[ >]/gu) ?? []).length,
        imageElements: (text.match(/<image[ >]/gu) ?? []).length,
      },
      paper: {
        width: /<svg[^>]*width="([^"]+)"/u.exec(text)?.[1] ?? null,
        height: /<svg[^>]*height="([^"]+)"/u.exec(text)?.[1] ?? null,
        viewBox: /<svg[^>]*viewBox="([^"]+)"/u.exec(text)?.[1] ?? null,
      },
      note: '走 decodeProjectFile → rebuildDrawingFromProject → renderDrawingSvg → DrawingExportStore 的真实导出路径；未经过系统保存对话框（GUI 步骤见 README §7）。',
    }
    await fsp.writeFile(REPORT, serializeEvidence({ schema: 'v40stage4-export-artifact', ...report }))
    console.log('EXPORT_ARTIFACT', JSON.stringify(report))

    expect(report.receiptMatchesDisk).toBe(true)
    expect(report.renderValid).toBe(true)
    expect(report.byteSize).toBeGreaterThan(2_000)
    expect(report.paper.width).toBe('297mm')
    expect(report.paper.height).toBe('210mm')
    expect(report.vector.pathElements).toBeGreaterThan(0)
    expect(report.vector.textElements).toBeGreaterThan(0)
    expect(report.vector.imageElements).toBe(0)
  }, 120_000)
})
