import { describe, expect, it } from 'vitest'
import {
  cloneTemplateToDraft,
  getBuiltinTemplate,
  listBuiltinTemplates,
} from './registry'
import { assemblyModelV1Schema } from '../project-file/assembly3d'

describe('src/templates/registry', () => {
  it('lists both builtin-mounting-plate and builtin-shaft-spacer templates with complete Schema 11 data', () => {
    const templates = listBuiltinTemplates()
    expect(templates).toHaveLength(2)

    const ids = templates.map((t) => t.templateId)
    expect(ids).toEqual(['builtin-mounting-plate', 'builtin-shaft-spacer'])

    const plate = getBuiltinTemplate('builtin-mounting-plate')
    const spacer = getBuiltinTemplate('builtin-shaft-spacer')
    expect(plate).toBeDefined()
    expect(spacer).toBeDefined()

    expect(plate!.schemaVersion).toBe(11)
    expect(plate!.readonly).toBe(true)
    expect(plate!.previewSnapshot.features.length).toBeGreaterThanOrEqual(4)
    expect(plate!.previewSnapshot.annotations.length).toBeGreaterThanOrEqual(5)
    expect(plate!.previewSnapshot.requirements.length).toBeGreaterThanOrEqual(3)
    expect(plate!.previewSnapshot.checks.length).toBeGreaterThanOrEqual(3)
    expect(plate!.taskbooks.length).toBeGreaterThanOrEqual(2)
    expect(assemblyModelV1Schema.safeParse(plate!.assembly3d).success).toBe(true)

    expect(spacer!.schemaVersion).toBe(11)
    expect(spacer!.readonly).toBe(true)
    expect(spacer!.chain).not.toBeNull()
    expect(spacer!.chain!.terms).toHaveLength(4)
    expect(spacer!.previewSnapshot.features.length).toBeGreaterThanOrEqual(3)
    expect(spacer!.previewSnapshot.checks.length).toBeGreaterThanOrEqual(1)
    expect(assemblyModelV1Schema.safeParse(spacer!.assembly3d).success).toBe(true)
  })

  it('deeply freezes built-in template definitions so originals cannot be mutated', () => {
    const templates = listBuiltinTemplates()
    expect(Object.isFrozen(templates)).toBe(true)

    const plate = getBuiltinTemplate('builtin-mounting-plate')!
    expect(Object.isFrozen(plate)).toBe(true)
    expect(Object.isFrozen(plate.previewSnapshot)).toBe(true)
    expect(Object.isFrozen(plate.previewSnapshot.features)).toBe(true)
    expect(Object.isFrozen(plate.previewSnapshot.features[0])).toBe(true)
    expect(Object.isFrozen(plate.previewSnapshot.features[0].linkedAnnotationIds)).toBe(true)
    expect(Object.isFrozen(plate.assembly3d)).toBe(true)
    expect(Object.isFrozen(plate.assembly3d.parts[0])).toBe(true)

    expect(() => {
      ;(plate.previewSnapshot.features[0] as { breadcrumb: string }).breadcrumb = 'mutated'
    }).toThrow(TypeError)

    const spacer = getBuiltinTemplate('builtin-shaft-spacer')!
    expect(Object.isFrozen(spacer.chain)).toBe(true)
    expect(Object.isFrozen(spacer.chain!.terms[0])).toBe(true)
    expect(() => {
      ;(spacer.chain!.terms[0] as { nominalQ: number }).nominalQ = 999
    }).toThrow(TypeError)
  })

  it('deeply clones a template into an independent mutable draft without polluting original or sibling clones', () => {
    const plateOriginal = getBuiltinTemplate('builtin-mounting-plate')!
    const cloneA = cloneTemplateToDraft('builtin-mounting-plate')
    const cloneB = cloneTemplateToDraft('builtin-mounting-plate')

    expect(cloneA.draftId).not.toBe(cloneB.draftId)
    expect(cloneA.projectId).not.toBe(cloneB.projectId)
    expect(cloneA.previewSnapshot.projectId).toBe(cloneA.projectId)
    expect(cloneB.previewSnapshot.projectId).toBe(cloneB.projectId)

    // Mutate deeply nested fields in cloneA
    const mutableFeaturesA = cloneA.previewSnapshot.features as unknown as Array<{
      breadcrumb: string
      linkedAnnotationIds: string[]
      bounds?: { x: number; y: number; w: number; h: number }
    }>
    mutableFeaturesA[0].breadcrumb = '已修改的右孔'
    mutableFeaturesA[0].linkedAnnotationIds.push('ann-custom-extra')
    if (mutableFeaturesA[0].bounds) {
      mutableFeaturesA[0].bounds.x = 99
    }
    ;(cloneA.previewSnapshot.checks as unknown as Array<{ summary: string }>)[0].summary =
      '已修改检查摘要'
    cloneA.taskbooks[0] = {
      ...cloneA.taskbooks[0],
      excerpt: '已修改任务书摘录',
    }
    cloneA.assembly3d.parts[0].displayName = '自定义安装板'

    // Original template remains 100% untouched
    expect(plateOriginal.previewSnapshot.features[0].breadcrumb).toBe('安装板 › 右孔 › 圆柱面')
    expect(plateOriginal.previewSnapshot.features[0].linkedAnnotationIds).not.toContain(
      'ann-custom-extra',
    )
    expect(plateOriginal.previewSnapshot.features[0].bounds?.x).toBe(66)
    expect(plateOriginal.previewSnapshot.checks[0].summary).toContain('名义 15.0 mm')
    expect(plateOriginal.assembly3d.parts[0].displayName).toBe('安装板')

    // Sibling cloneB remains 100% untouched
    expect(cloneB.previewSnapshot.features[0].breadcrumb).toBe('安装板 › 右孔 › 圆柱面')
    expect(cloneB.previewSnapshot.features[0].linkedAnnotationIds).not.toContain('ann-custom-extra')
    expect(cloneB.previewSnapshot.features[0].bounds?.x).toBe(66)
    expect(cloneB.previewSnapshot.checks[0].summary).toContain('名义 15.0 mm')
    expect(cloneB.assembly3d.parts[0].displayName).toBe('安装板')

    // Also test spacer chain deep clone isolation
    const spacerOriginal = getBuiltinTemplate('builtin-shaft-spacer')!
    const spacerClone = cloneTemplateToDraft('builtin-shaft-spacer')
    spacerClone.chain!.terms[2].nominalQ = 120500
    spacerClone.chain!.target!.minQ = 500
    expect(spacerOriginal.chain!.terms[2].nominalQ).toBe(598000)
    expect(spacerOriginal.chain!.target!.minQ).toBe(1000)
  })

  it('throws an explicit error for unknown templateId', () => {
    expect(() => cloneTemplateToDraft('non-existent-template')).toThrow(
      /Unknown builtin template: non-existent-template/,
    )
    expect(getBuiltinTemplate('non-existent-template')).toBeUndefined()
  })
})
