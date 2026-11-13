/**
 * 从**历史版本的冻结输入**重出图纸字节（任务卡 B）。
 *
 * 语义（红线）：
 * - 重出是**只读**：不写回版本记录、不改任何已导出文件；
 * - 只用该版本记录里的模板 ID/版本、参数快照、比例、图框与 ID，**不读当前项目参数**，
 *   也**不用当前模板版本顶上**——模板版本不在本构建支持范围就明确报“不能重建”；
 * - 重建出的 DrawingData 必须与版本保存的 dataFingerprint 一致；
 * - 版本创建时冻结了当时的导出字节摘要（`evidence.drawingExports`），重出后逐字节
 *   比对 SHA-256；不一致就报“重出字节与冻结摘要不一致”，不拿“看起来像”的图冒充。
 *
 * 为什么摘要可信：SVG 与 DXF 生成器都是纯函数（无时间、无随机数、无环境信息），
 * 同一份 DrawingData 必得同一份字节；因此冻结摘要一旦与数据指纹同源，
 * 就能证明重出的字节等于当时导出的字节。
 */
import { buildDxfDocument } from '../drawing/dxfExport'
import { sha256Bytes } from '../drawing/fingerprint'
import { renderDrawingSvg } from '../drawing/renderDrawingSvg'
import {
  SPACER_TEMPLATE_ID,
  SPACER_TEMPLATE_VERSION,
  type DrawingData,
} from '../drawing/types'
import type {
  ProjectFileDrawingExportDigest,
  ProjectFileDrawingRecord,
  ProjectFileRevision,
} from '../project-file/types'
import { rebuildFromGenerationInput } from './rebuild'
import type { DrawingGenerationInput } from './types'

/** 导出器版本：实现改变（字节定义改变）时必须递增，旧摘要不再声称可比。 */
export const DRAWING_EXPORT_GENERATOR_VERSION = 'drawing-export-generator-v1'

export interface FileDigest {
  sha256: string
  byteSize: number
}

/** 版本创建时冻结的导出摘要（只记录摘要，不存第二份图）。 */
export type DrawingExportDigest = ProjectFileDrawingExportDigest

export function drawingExportBytes(data: DrawingData): { svg: Uint8Array; dxf2000: Uint8Array } {
  const svg = new TextEncoder().encode(renderDrawingSvg(data))
  const dxf2000 = buildDxfDocument(data, '2000').bytes
  return { svg, dxf2000 }
}

export function computeDrawingExportDigest(data: DrawingData): DrawingExportDigest {
  const { svg, dxf2000 } = drawingExportBytes(data)
  return {
    generatorVersion: DRAWING_EXPORT_GENERATOR_VERSION,
    templateId: data.templateId,
    templateVersion: data.templateVersion,
    svg: { sha256: sha256Bytes(svg), byteSize: svg.byteLength },
    dxf2000: { sha256: sha256Bytes(dxf2000), byteSize: dxf2000.byteLength },
  }
}

export type RedrawResult =
  | {
      ok: true
      revisionId: string
      data: DrawingData
      svg: Uint8Array
      dxf2000: Uint8Array
      /** 本次重出算出的摘要。 */
      redrawn: DrawingExportDigest
      /** 版本创建时冻结的摘要；旧版本没有该字段。 */
      recorded: DrawingExportDigest | null
      /** 逐字节与冻结摘要一致；null = 该版本没有冻结摘要，无法对照。 */
      byteIdentical: boolean | null
    }
  | { ok: false; reason: string; detail?: string }

function drawingsOf(project: ProjectFileRevision['project']): ProjectFileDrawingRecord[] {
  return 'drawings' in project && Array.isArray(project.drawings)
    ? (project.drawings as ProjectFileDrawingRecord[])
    : []
}

function parametersOf(
  project: ProjectFileRevision['project'],
): DrawingGenerationInput['parameters'] {
  if (!('parameters' in project) || !Array.isArray(project.parameters)) return []
  return project.parameters as DrawingGenerationInput['parameters']
}

/** 该版本是否具备重建所需的冻结输入（只看记录本身，不看当前项目）。 */
export function revisionRebuildability(
  revision: ProjectFileRevision,
): { ok: true; record: ProjectFileDrawingRecord } | { ok: false; reason: string; detail?: string } {
  const drawings = drawingsOf(revision.project)
  const record = drawings[0]
  if (record === undefined) {
    return {
      ok: false,
      reason: '该版本没有冻结图纸输入（drawings 为空），不能重建',
    }
  }
  if (record.templateId !== SPACER_TEMPLATE_ID) {
    return { ok: false, reason: `未知图纸模板：${String(record.templateId)}，不能重建` }
  }
  if (record.templateVersion !== SPACER_TEMPLATE_VERSION) {
    return {
      ok: false,
      reason:
        `该版本模板版本 v${record.templateVersion} 不在当前构建支持范围（v${SPACER_TEMPLATE_VERSION}），` +
        '不能重建；不拿当前模板冒充旧图',
    }
  }
  const parameters = parametersOf(revision.project)
  if (parameters.length !== 3) {
    return {
      ok: false,
      reason: '该版本缺少完整隔套参数（需内径/外径/长度三项），不能重建',
      detail: `parameters=${parameters.length}`,
    }
  }
  return { ok: true, record }
}

/** 从历史版本记录重出 SVG 与 DXF 2000，并与冻结摘要逐字节对照。 */
export function redrawRevision(revision: ProjectFileRevision): RedrawResult {
  const rebuildable = revisionRebuildability(revision)
  if (!rebuildable.ok) return rebuildable
  const { record } = rebuildable

  const input: DrawingGenerationInput = {
    drawingId: record.drawingId,
    partId: record.partId,
    templateId: record.templateId,
    templateVersion: record.templateVersion,
    drawingDataVersion: record.drawingDataVersion,
    projectId: revision.project.id,
    revisionId: record.revisionId,
    parameters: parametersOf(revision.project),
    scale: record.scale,
    frameFields: record.frameFields,
  }

  const rebuilt = rebuildFromGenerationInput(input, record.dataFingerprint)
  if (!rebuilt.ok) {
    return { ok: false, reason: `按冻结输入重建失败：${rebuilt.reason}`, detail: rebuilt.detail }
  }
  const data = rebuilt.data

  const recorded = revision.evidence?.drawingExports ?? null
  if (recorded !== null) {
    if (recorded.generatorVersion !== DRAWING_EXPORT_GENERATOR_VERSION) {
      return {
        ok: false,
        reason:
          `该版本的导出摘要由 ${recorded.generatorVersion} 生成，当前导出器为 ` +
          `${DRAWING_EXPORT_GENERATOR_VERSION}，无法声称字节一致`,
      }
    }
    if (
      recorded.templateId !== record.templateId ||
      recorded.templateVersion !== record.templateVersion
    ) {
      return {
        ok: false,
        reason: '冻结导出摘要的模板与版本记录不一致，不能重建',
        detail:
          `digest=${recorded.templateId}@v${recorded.templateVersion}, ` +
          `record=${record.templateId}@v${record.templateVersion}`,
      }
    }
  }

  const { svg, dxf2000 } = drawingExportBytes(data)
  const redrawn: DrawingExportDigest = {
    generatorVersion: DRAWING_EXPORT_GENERATOR_VERSION,
    templateId: data.templateId,
    templateVersion: data.templateVersion,
    svg: { sha256: sha256Bytes(svg), byteSize: svg.byteLength },
    dxf2000: { sha256: sha256Bytes(dxf2000), byteSize: dxf2000.byteLength },
  }

  if (recorded !== null) {
    const mismatches: string[] = []
    if (redrawn.svg.sha256 !== recorded.svg.sha256) {
      mismatches.push(`svg: 重出=${redrawn.svg.sha256} 冻结=${recorded.svg.sha256}`)
    }
    if (redrawn.dxf2000.sha256 !== recorded.dxf2000.sha256) {
      mismatches.push(
        `dxf2000: 重出=${redrawn.dxf2000.sha256} 冻结=${recorded.dxf2000.sha256}`,
      )
    }
    if (mismatches.length > 0) {
      return {
        ok: false,
        reason: '重出字节与冻结导出摘要不一致，不能冒充旧图',
        detail: mismatches.join('；'),
      }
    }
  }

  return {
    ok: true,
    revisionId: revision.revisionId,
    data,
    svg,
    dxf2000,
    redrawn,
    recorded,
    byteIdentical: recorded === null ? null : true,
  }
}
