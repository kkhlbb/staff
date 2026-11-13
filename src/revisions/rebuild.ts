/**
 * 按**冻结生成输入**重建一版图纸（D：不存第二份图元）。
 *
 * 只用该版本记录里的参数/模板/比例/图框/ID 重建，不读当前参数；重建后必须
 * 与保存的 dataFingerprint 一致。缺参数、未知模板版本、指纹不符都明确返回
 * “不能重建”及原因，绝不拿当前图顶替旧图。
 */
import { buildSpacerDrawing, DrawingBuildError } from '../drawing/spacerDrawing'
import { SPACER_TEMPLATE_ID, SPACER_TEMPLATE_VERSION, type DrawingData } from '../drawing/types'
import type { DrawingGenerationInput } from './types'

export type RebuildResult =
  | { ok: true; data: DrawingData }
  | { ok: false; reason: string; detail?: string }

export function rebuildFromGenerationInput(
  input: DrawingGenerationInput,
  savedFingerprint?: string,
): RebuildResult {
  if (input.templateId !== SPACER_TEMPLATE_ID) {
    return { ok: false, reason: `未知图纸模板：${String(input.templateId)}，不能重建` }
  }
  if (input.templateVersion !== SPACER_TEMPLATE_VERSION) {
    return {
      ok: false,
      reason: `模板版本 v${input.templateVersion} 不受支持（当前支持 v${SPACER_TEMPLATE_VERSION}），不能重建`,
    }
  }
  if (input.parameters.length !== 3) {
    return { ok: false, reason: '该版本缺少完整隔套参数，不能重建旧图' }
  }
  try {
    const data = buildSpacerDrawing({
      projectId: input.projectId,
      revisionId: input.revisionId,
      drawingId: input.drawingId,
      parameters: input.parameters.map((parameter) => ({
        parameterId: parameter.parameterId,
        partId: parameter.partId,
        key: parameter.key,
        valueQ: parameter.valueQ,
        inputDecimals: parameter.inputDecimals,
        reviewStatus: parameter.reviewStatus,
        ...(parameter.provenance === undefined ? {} : { provenance: parameter.provenance }),
        ...(parameter.sourceNote === undefined || parameter.sourceNote === ''
          ? {}
          : { sourceNote: parameter.sourceNote }),
      })),
      scale: input.scale,
      frameFields: input.frameFields,
    })
    if (savedFingerprint !== undefined && data.fingerprint !== savedFingerprint) {
      return {
        ok: false,
        reason: '重建指纹与保存值不一致，不能冒充旧图',
        detail: `saved=${savedFingerprint}, rebuilt=${data.fingerprint}`,
      }
    }
    return { ok: true, data }
  } catch (error) {
    if (error instanceof DrawingBuildError) {
      return { ok: false, reason: `按冻结输入重建失败：${error.message}`, detail: error.detail }
    }
    throw error
  }
}
