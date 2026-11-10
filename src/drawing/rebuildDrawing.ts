/**
 * 从项目持久化数据重建 DrawingData（V3-C-03）。
 *
 * 只凭参数 + 模板 + 比例 + 图框字段重建，不读图元数组；重建后必须与保存的
 * dataFingerprint 一致，否则按数据不一致处理，不用默认值补齐。
 *
 * UI 预览与 main 导出共用本函数，避免出现“预览一套、导出另一套”。
 */
import type { ProjectFileDrawingRecord, ProjectFileProject } from '../project-file/types'
import { validateSpacerParameterSnapshot } from '../parts/spacerParameters'
import { buildSpacerDrawing, DrawingBuildError } from './spacerDrawing'
import type { DrawingData } from './types'

export type RebuildDrawingResult =
  | { ok: true; data: DrawingData; record: ProjectFileDrawingRecord }
  | { ok: false; message: string; detail?: string }

export function rebuildDrawingFromProject(project: ProjectFileProject): RebuildDrawingResult {
  const record = project.drawings[0]
  if (record === undefined) {
    return { ok: false, message: '当前项目尚无图纸草稿' }
  }
  const parameters = validateSpacerParameterSnapshot(project.parameters)
  if (!parameters.ok) {
    return { ok: false, message: `隔套参数不合法：${parameters.message}` }
  }
  try {
    const data = buildSpacerDrawing({
      projectId: project.id,
      revisionId: record.revisionId,
      drawingId: record.drawingId,
      parameters: parameters.parameters,
      scale: record.scale,
      frameFields: record.frameFields,
    })
    if (data.fingerprint !== record.dataFingerprint) {
      return {
        ok: false,
        message: '图纸重建指纹与保存值不一致',
        detail: `saved=${record.dataFingerprint}, rebuilt=${data.fingerprint}`,
      }
    }
    return { ok: true, data, record }
  } catch (error) {
    if (error instanceof DrawingBuildError) {
      return { ok: false, message: error.message, detail: error.detail }
    }
    throw error
  }
}
