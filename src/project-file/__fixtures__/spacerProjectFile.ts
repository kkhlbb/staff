/**
 * D 测试夹具：隔套三参数 + 参数绑定 + 图纸引用 的自洽聚合。
 *
 * 与 C 的 sampleProjectFile 共用尺寸链与来源；额外写入参数/绑定/图纸，
 * 供 LINK-01/02、派生状态、原子提交与双图比较使用。
 */
import type { ChangeEvent } from '../../history/events'
import { buildSpacerDrawing } from '../../drawing/spacerDrawing'
import { parseSpacerParameters } from '../../parts/spacerParameters'
import {
  SPACER_PARAMETER_IDS,
  SPACER_PART_ID,
} from '../../drawing/types'
import type {
  ProjectFileParameterBindingLink,
  ProjectFileSnapshot,
  ProjectFileSpacerParameter,
} from '../types'
import { createSampleSnapshot, SAMPLE_PROJECT_ID } from './sampleProjectFile'
import { sourceBasisOf } from '../../revisions/digest'
import { DEFAULT_FRAME_FIELDS } from '../../revisions/compute'

export const SPACER_LENGTH_PARAMETER_ID = SPACER_PARAMETER_IDS.length

export function spacerParameters(
  values: { innerDiameter?: string; outerDiameter?: string; length?: string } = {},
  revision = 1,
): ProjectFileSpacerParameter[] {
  const parsed = parseSpacerParameters({
    innerDiameter: values.innerDiameter ?? '20.00',
    outerDiameter: values.outerDiameter ?? '32.00',
    length: values.length ?? '12.00',
  })
  if (!parsed.ok) throw new Error(parsed.message)
  return parsed.parameters.map((parameter) => ({
    ...parameter,
    parameterRevision: revision,
    reviewStatus: 'draft' as const,
  }))
}

export async function createSpacerSnapshot(options: {
  length?: string
  innerDiameter?: string
  outerDiameter?: string
  /** 写入一条匹配当前基准的确认事件；false 时没有确认凭据。 */
  confirmed?: boolean
  material?: string
} = {}): Promise<ProjectFileSnapshot> {
  const base = await createSampleSnapshot()
  const parameters = spacerParameters(
    {
      length: options.length,
      innerDiameter: options.innerDiameter,
      outerDiameter: options.outerDiameter,
    },
    1,
  )
  const drawing = buildSpacerDrawing({
    projectId: SAMPLE_PROJECT_ID,
    revisionId: base.project.currentRevisionId,
    drawingId: `drawing:${SAMPLE_PROJECT_ID}:spacer`,
    parameters,
    scale: { numerator: 1, denominator: 1 },
    frameFields: { ...DEFAULT_FRAME_FIELDS, material: options.material ?? '' },
  })
  const binding: ProjectFileParameterBindingLink = {
    kind: 'parameter-binding',
    bindingId: 'binding:spacer-length',
    termId: 't-s',
    partId: SPACER_PART_ID,
    parameterId: SPACER_LENGTH_PARAMETER_ID,
    syncField: 'nominal',
    createdAt: '2026-11-09T08:00:00.000Z',
  }
  const project = {
    ...base.project,
    parts: [
      {
        partId: SPACER_PART_ID,
        kind: 'builtin-demo' as const,
        name: '隔套',
        currentModelRevisionId: null,
        origin: 'builtin' as const,
      },
    ],
    parameters,
    drawings: [
      {
        drawingId: drawing.drawingId,
        drawingDataVersion: 1 as const,
        templateId: drawing.templateId,
        templateVersion: drawing.templateVersion,
        partId: drawing.partId,
        revisionId: drawing.revisionId,
        parameterIds: drawing.parameterSnapshot.map((item) => item.parameterId),
        paper: drawing.paper,
        scale: drawing.scale,
        frameFields: { ...DEFAULT_FRAME_FIELDS, material: options.material ?? '' },
        status: 'pending-review-draft' as const,
        dataFingerprint: drawing.fingerprint,
      },
    ],
    dimensionLinks: [binding],
  }
  const snapshot: ProjectFileSnapshot = {
    ...base,
    project,
    fileRevisions: base.fileRevisions.map((revision) => ({ ...revision, project })),
  }
  if (options.confirmed === true) {
    const lengthParameter = parameters.find(
      (parameter) => parameter.parameterId === SPACER_LENGTH_PARAMETER_ID,
    )!
    const term = project.dimensionChain.terms.find((item) => item.id === 't-s')!
    const event: ChangeEvent = {
      id: 'parameter_binding_confirmed:fixture',
      projectId: SAMPLE_PROJECT_ID,
      type: 'parameter_binding_confirmed',
      createdAt: '2026-11-09T08:05:00.000Z',
      bindingId: binding.bindingId,
      parameterId: lengthParameter.parameterId,
      termId: term.id,
      parameterRevision: lengthParameter.parameterRevision,
      termRevision: term.termRevision,
      drawingId: drawing.drawingId,
      drawingFingerprint: drawing.fingerprint,
      sourceBasis: sourceBasisOf(snapshot, lengthParameter.sourceNote),
      revisionIdAtCommit: base.project.currentRevisionId,
      scope: 'nominal-only',
    }
    snapshot.events = [...snapshot.events, event]
  }
  return snapshot
}
