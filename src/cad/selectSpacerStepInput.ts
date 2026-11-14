import type { ProjectFileRevision, ProjectFileSnapshot, ProjectFileSpacerParameter } from '../project-file/types'
import { SPACER_PART_ID, SPACER_PARAMETER_KEYS } from '../drawing/types'
import { validateSpacerParameterSnapshot } from '../parts/spacerParameters'
import { canonicalJson, stableFingerprint } from '../revisions/canonical'
import type { CadGenerationInput } from './types'

export type { CadGenerationInput } from './types'
export const STEP_GENERATOR_VERSION = 'spacer-step-generator-v1' as const

// Fingerprints are comparison tokens, not cryptographic signatures. Encode UTF-8
// first so the existing FNV implementation does not discard Unicode high bytes.
function fingerprint(value: unknown): string {
  return stableFingerprint(Array.from(new TextEncoder().encode(canonicalJson(value))))
}

export function geometryFingerprint(input: Pick<CadGenerationInput,
  'template' | 'generatorVersion' | 'unit' | 'axis' | 'origin' | 'innerDiameterQ' | 'outerDiameterQ' | 'lengthQ'>): string {
  return fingerprint({ template: input.template, generatorVersion: input.generatorVersion,
    unit: input.unit, axis: input.axis, origin: input.origin,
    innerDiameterQ: input.innerDiameterQ, outerDiameterQ: input.outerDiameterQ, lengthQ: input.lengthQ })
}

export function inputFingerprint(input: Omit<CadGenerationInput, 'inputFingerprint'>): string {
  return fingerprint({ revisionId: input.revisionId, projectId: input.projectId, partId: input.partId,
    template: input.template, generatorVersion: input.generatorVersion, unit: input.unit, axis: input.axis,
    origin: input.origin, innerDiameterQ: input.innerDiameterQ, outerDiameterQ: input.outerDiameterQ,
    lengthQ: input.lengthQ, parameters: input.parameters, source: input.source,
    fileStatus: input.fileStatus, historicalByteIdentical: input.historicalByteIdentical,
    geometryFingerprint: input.geometryFingerprint })
}

/** Caller must obtain revision from fileRevisions, never wrap current/draft parameters. */
export function selectSpacerStepInput(revision: ProjectFileRevision, partId: string): CadGenerationInput {
  if (!revision || !revision.revisionId || !revision.project || revision.project.currentRevisionId !== revision.revisionId) {
    throw new Error('请选择正式历史版本；不能以当前参数或草稿替代')
  }
  if (partId !== SPACER_PART_ID) throw new Error('STEP 仅支持隔套，不支持装配或任意回转体')
  if (revision.project.schemaVersion < 5) throw new Error('该正式历史版本没有冻结隔套参数')
  const parameters = revision.project.parameters as ProjectFileSpacerParameter[]
  const checked = validateSpacerParameterSnapshot(parameters)
  if (!checked.ok) throw new Error(checked.message)
  for (const p of parameters) {
    if (p.reviewStatus !== 'pending' && p.reviewStatus !== 'confirmed') throw new Error('草稿参数不能正式导出 STEP；请选择正式历史版本')
    if (p.parameterRevision !== undefined && (!Number.isSafeInteger(p.parameterRevision) || p.parameterRevision < 1)) throw new Error('历史参数修订号不合法')
    if (revision.project.schemaVersion >= 6 && p.parameterRevision === undefined) throw new Error('历史参数缺少修订号')
  }
  const byKey = new Map(parameters.map(p => [p.key, p]))
  const safeParameters = Object.freeze(SPACER_PARAMETER_KEYS.map(key => {
    const p = byKey.get(key)!
    const recorded = p.sourceNote !== undefined || p.provenance !== undefined
    return Object.freeze({ parameterId: p.parameterId, key,
      parameterRevision: p.parameterRevision ?? null,
      reviewStatus: p.reviewStatus as 'pending' | 'confirmed',
      source: Object.freeze({ kind: recorded ? 'recorded' as const : 'unrecorded' as const,
        fingerprint: fingerprint({ note: p.sourceNote ?? null, provenance: p.provenance ?? null }) }) })
  }))
  const geometry = {
    template: 'spacer-hollow-cylinder' as const, generatorVersion: STEP_GENERATOR_VERSION,
    unit: 'mm' as const, axis: 'X' as const, origin: 'part-center' as const,
    innerDiameterQ: byKey.get('innerDiameter')!.valueQ,
    outerDiameterQ: byKey.get('outerDiameter')!.valueQ, lengthQ: byKey.get('length')!.valueQ,
  }
  const sourceKind = 'sourceKind' in revision.project ? revision.project.sourceKind : 'pdf'
  const withoutFingerprint = { ...geometry, revisionId: revision.revisionId, projectId: revision.project.id,
    partId, parameters: safeParameters,
    source: Object.freeze({ kind: sourceKind, fingerprint: fingerprint({ kind: sourceKind,
      parameters: safeParameters.map(p => p.source), sourceManifest: revision.evidence?.sourceManifest ?? null,
      identity: 'actorId' in revision.project ? { actorId: revision.project.actorId, sessionSeq: revision.project.sessionSeq,
        sessionLabel: revision.project.sessionLabel } : null }) }),
    fileStatus: 'historical-frozen' as const, historicalByteIdentical: null,
    geometryFingerprint: geometryFingerprint(geometry) }
  return Object.freeze({ ...withoutFingerprint, inputFingerprint: inputFingerprint(withoutFingerprint) })
}

/** Lookup is deliberately exact; no fallback to project.currentRevisionId or draft. */
export function selectSpacerStepInputFromSnapshot(snapshot: Pick<ProjectFileSnapshot, 'fileRevisions'>, revisionId: string, partId: string): CadGenerationInput {
  const matches = snapshot.fileRevisions.filter(revision => revision.revisionId === revisionId)
  if (!revisionId || matches.length !== 1) throw new Error('请选择唯一的正式历史版本；未选择或草稿不能导出 STEP')
  return selectSpacerStepInput(matches[0], partId)
}
