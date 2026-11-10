/**
 * 两版图纸的字段级比较（D-COMPARE）。
 *
 * 不存第二份图元：两侧都由各自版本的冻结输入重建；比较按稳定 ID
 * （parameterId / annotationId / primitiveId / viewId）join，不用数组下标或名称。
 * 指纹相同只说明数据相同；不同时必须给出字段级差异，不新增任意 epsilon。
 */
import { canonicalJson } from './canonical'
import { dimensionText, resolveDimension } from '../drawing/formatDimension'
import type { DrawingData } from '../drawing/types'

export type DrawingDiffScope = 'meta' | 'parameter' | 'annotation' | 'primitive' | 'version'

export interface DrawingFieldDiff {
  scope: DrawingDiffScope
  /** 稳定对象 ID；元数据为字段名。 */
  id: string
  field: string
  before: string | null
  after: string | null
  /** added/removed 用于稳定 ID 只在一侧存在。 */
  kind: 'changed' | 'added' | 'removed'
}

export interface DrawingCompareSide {
  label: string
  revisionId: string
  drawingId: string
  templateVersion: number
  scale: { numerator: number; denominator: number }
  data: DrawingData
}

export interface DrawingCompareValue {
  left: DrawingCompareSide | null
  right: DrawingCompareSide
  diff: DrawingFieldDiff[]
  /** 左图不能重建时的明确原因；不为 null 时 diff 为空。 */
  leftUnavailableReason: string | null
  unchanged: boolean
}

function text(value: unknown): string {
  if (value === null || value === undefined) return '—'
  return typeof value === 'string' ? value : canonicalJson(value)
}

function annotationText(data: DrawingData, parameterId: string, kind: 'diameter' | 'length'): string {
  const resolved = resolveDimension(parameterId, data.parameterSnapshot)
  return resolved.ok ? dimensionText(resolved.value, kind) : '解析失败'
}

export function compareDrawingData(
  left: DrawingCompareSide,
  right: DrawingCompareSide,
): DrawingFieldDiff[] {
  const diff: DrawingFieldDiff[] = []

  const push = (
    scope: DrawingDiffScope,
    id: string,
    field: string,
    before: unknown,
    after: unknown,
  ) => {
    if (text(before) !== text(after)) {
      diff.push({ scope, id, field, before: text(before), after: text(after), kind: 'changed' })
    }
  }

  // 版本元数据单独列；不算工程值变化。
  push('version', 'revisionId', '生成版本', left.revisionId, right.revisionId)
  push('version', 'drawingId', '图纸 ID', left.drawingId, right.drawingId)
  push('version', 'fingerprint', '图纸指纹', left.data.fingerprint, right.data.fingerprint)

  // 图纸元字段。
  push('meta', 'templateVersion', '模板版本', left.templateVersion, right.templateVersion)
  push('meta', 'paper.format', '纸张', left.data.paper.format, right.data.paper.format)
  push('meta', 'paper.orientation', '方向', left.data.paper.orientation, right.data.paper.orientation)
  push(
    'meta',
    'scale',
    '比例',
    `${left.scale.numerator}:${left.scale.denominator}`,
    `${right.scale.numerator}:${right.scale.denominator}`,
  )
  push('meta', 'projection', '投影', left.data.projection.convention, right.data.projection.convention)
  for (const field of Object.keys(right.data.frame.fields)) {
    push('meta', `frame.${field}`, `图框 ${field}`, left.data.frame.fields[field], right.data.frame.fields[field])
  }
  for (const view of right.data.views) {
    const before = left.data.views.find((item) => item.viewId === view.viewId)
    if (before === undefined) {
      diff.push({ scope: 'meta', id: view.viewId, field: '视图', before: null, after: view.kind, kind: 'added' })
    } else {
      push('meta', view.viewId, '视图锚点', before.anchorMm, view.anchorMm)
      push('meta', view.viewId, '视图缩放', before.scaleFactor, view.scaleFactor)
    }
  }

  // 参数：工程字段与显示/来源字段分开比较。
  const parameterIds = new Set([
    ...left.data.parameterSnapshot.map((item) => item.parameterId),
    ...right.data.parameterSnapshot.map((item) => item.parameterId),
  ])
  for (const parameterId of parameterIds) {
    const before = left.data.parameterSnapshot.find((item) => item.parameterId === parameterId)
    const after = right.data.parameterSnapshot.find((item) => item.parameterId === parameterId)
    if (before === undefined || after === undefined) {
      diff.push({
        scope: 'parameter',
        id: parameterId,
        field: '参数',
        before: before === undefined ? null : String(before.valueQ),
        after: after === undefined ? null : String(after.valueQ),
        kind: before === undefined ? 'added' : 'removed',
      })
      continue
    }
    push('parameter', parameterId, '工程值 valueQ', before.valueQ, after.valueQ)
    push('parameter', parameterId, '部件', before.partId, after.partId)
    push('parameter', parameterId, '键', before.key, after.key)
    push('parameter', parameterId, '显示小数位', before.inputDecimals, after.inputDecimals)
    push('parameter', parameterId, '来源备注', before.sourceNote ?? '', after.sourceNote ?? '')
  }

  // 标注按 annotationId join；参数值变化时即使 annotation 对象未变，也显示文字变化。
  const annotationIds = new Set([
    ...left.data.annotations.map((item) => item.annotationId),
    ...right.data.annotations.map((item) => item.annotationId),
  ])
  for (const annotationId of annotationIds) {
    const before = left.data.annotations.find((item) => item.annotationId === annotationId)
    const after = right.data.annotations.find((item) => item.annotationId === annotationId)
    if (before === undefined || after === undefined) {
      diff.push({
        scope: 'annotation',
        id: annotationId,
        field: '标注',
        before: before === undefined ? null : before.kind,
        after: after === undefined ? null : after.kind,
        kind: before === undefined ? 'added' : 'removed',
      })
      continue
    }
    push('annotation', annotationId, '类型', before.kind, after.kind)
    push('annotation', annotationId, '参数', before.parameterId, after.parameterId)
    push('annotation', annotationId, '视图', before.viewId, after.viewId)
    push(
      'annotation',
      annotationId,
      '尺寸几何',
      before.dimensionGeometryMm,
      after.dimensionGeometryMm,
    )
    push('annotation', annotationId, '文字位置', before.textPositionMm, after.textPositionMm)
    push('annotation', annotationId, '文字锚点', before.textAnchor, after.textAnchor)
    push('annotation', annotationId, '样式', before.styleId, after.styleId)
    push(
      'annotation',
      annotationId,
      '标注文字',
      annotationText(left.data, before.parameterId, before.kind),
      annotationText(right.data, after.parameterId, after.kind),
    )
  }

  // 图元按 primitiveId join。
  const primitiveIds = new Set([
    ...left.data.primitives.map((item) => item.primitiveId),
    ...right.data.primitives.map((item) => item.primitiveId),
  ])
  for (const primitiveId of primitiveIds) {
    const before = left.data.primitives.find((item) => item.primitiveId === primitiveId)
    const after = right.data.primitives.find((item) => item.primitiveId === primitiveId)
    if (before === undefined || after === undefined) {
      diff.push({
        scope: 'primitive',
        id: primitiveId,
        field: '图元',
        before: before === undefined ? null : before.kind,
        after: after === undefined ? null : after.kind,
        kind: before === undefined ? 'added' : 'removed',
      })
      continue
    }
    push('primitive', primitiveId, '类型', before.kind, after.kind)
    push('primitive', primitiveId, '几何', before.geometryMm, after.geometryMm)
    push('primitive', primitiveId, '样式', before.styleId, after.styleId)
    push('primitive', primitiveId, '区域', before.area, after.area)
    push('primitive', primitiveId, '视图', before.viewId ?? '', after.viewId ?? '')
  }

  return diff
}

export function compareDrawings(
  left: DrawingCompareSide | null,
  right: DrawingCompareSide,
  leftUnavailableReason: string | null,
): DrawingCompareValue {
  if (left === null) {
    return {
      left: null,
      right,
      diff: [],
      leftUnavailableReason: leftUnavailableReason ?? '该版本无图纸，不能重建旧图',
      unchanged: false,
    }
  }
  const diff = compareDrawingData(left, right)
  const engineering = diff.filter((item) => item.scope !== 'version')
  return {
    left,
    right,
    diff,
    leftUnavailableReason: null,
    // fingerprint 相同即可判同数据；不同则必须已有字段级差异。
    unchanged: engineering.length === 0,
  }
}
