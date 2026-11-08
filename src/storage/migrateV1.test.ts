import { describe, expect, it } from 'vitest'
import { parseMm } from '../domain/units'
import {
  migrateDraftV1,
  migrateProjectV1,
  type V1Project,
} from './migrateV1'

function legacyProject(): V1Project {
  return {
    schemaVersion: 1,
    engineVersion: 'v1-engine',
    id: 'p-1',
    name: '旧项目',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-02T00:00:00.000Z',
    working: {
      terms: [
        {
          id: 'H',
          symbol: 'H',
          name: '机架',
          nominalQ: parseMm('100'),
          lowerDeviationQ: parseMm('0'),
          upperDeviationQ: parseMm('0.1'),
          sign: 1,
          sourceNote: '旧备注',
        },
        {
          id: 'B',
          symbol: 'B',
          name: '轴',
          nominalQ: parseMm('99.9'),
          lowerDeviationQ: parseMm('-0.05'),
          upperDeviationQ: parseMm('0'),
          sign: -1,
          sourceNote: '',
        },
      ],
      target: { minQ: parseMm('0.05'), maxQ: parseMm('0.2') },
      assumptions: '旧假设',
      relationConfirmed: true,
    },
    baseline: {
      savedAt: '2025-01-01T12:00:00.000Z',
      definition: {
        terms: [
          {
            id: 'B-H',
            symbol: 'H',
            name: '机架',
            nominalQ: parseMm('100'),
            lowerDeviationQ: parseMm('0'),
            upperDeviationQ: parseMm('0.05'),
            sign: 1,
            sourceNote: '',
          },
          {
            id: 'B-B',
            symbol: 'B',
            name: '轴',
            nominalQ: parseMm('99.9'),
            lowerDeviationQ: parseMm('-0.05'),
            upperDeviationQ: parseMm('0'),
            sign: -1,
            sourceNote: '',
          },
        ],
        target: null,
        assumptions: '',
        relationConfirmed: true,
      },
    },
  }
}

const options = { migratedAt: '2026-11-08T00:00:00.000Z', backupId: 'backup-1' }

describe('migrateProjectV1：保留数据、清除无凭据确认', () => {
  it('项目/基线/数值/方向保留，termRevision=1，确认凭据为空', () => {
    const migrated = migrateProjectV1(legacyProject(), options)
    expect(migrated.ok).toBe(true)
    if (!migrated.ok) {
      return
    }
    const { project, clearedManualConfirmation, clearedBaselineConfirmation } =
      migrated.value

    expect(project.schemaVersion).toBe(2)
    expect(project.id).toBe('p-1')
    expect(project.name).toBe('旧项目')
    expect(project.engineVersion).toBe('v1-engine')
    expect(project.working.terms.map((term) => term.id)).toEqual(['H', 'B'])
    expect(project.working.terms.map((term) => term.termRevision)).toEqual([1, 1])
    expect(project.working.terms[0].nominalQ).toBe(parseMm('100'))
    expect(project.working.terms[1].sign).toBe(-1)
    expect(project.working.terms[0].sourceNote).toBe('旧备注')
    expect(project.working.target).toEqual({
      minQ: parseMm('0.05'),
      maxQ: parseMm('0.2'),
    })
    expect(project.working.assumptions).toBe('旧假设')
    expect(project.relationRevision).toBe(1)
    expect(project.relationReview).toBeNull()
    expect(project.migration).toEqual({
      fromSchemaVersion: 1,
      migratedAt: options.migratedAt,
      backupId: options.backupId,
    })
    expect(project.baseline?.savedAt).toBe('2025-01-01T12:00:00.000Z')
    expect(project.baseline?.definition.terms.map((term) => term.termRevision)).toEqual([
      1, 1,
    ])
    expect(clearedManualConfirmation).toBe(true)
    expect(clearedBaselineConfirmation).toBe(true)
  })

  it('V1 未确认时不声称清除过确认', () => {
    const raw = legacyProject()
    raw.working.relationConfirmed = false
    if (raw.baseline !== null) {
      raw.baseline.definition.relationConfirmed = false
    }
    const migrated = migrateProjectV1(raw, options)
    expect(migrated.ok).toBe(true)
    if (migrated.ok) {
      expect(migrated.value.clearedManualConfirmation).toBe(false)
      expect(migrated.value.clearedBaselineConfirmation).toBe(false)
      expect(migrated.value.project.relationReview).toBeNull()
    }
  })

  it('数值非法时整体失败，不返回半迁移项目', () => {
    const raw = legacyProject()
    raw.working.terms[0].nominalQ = 0
    const migrated = migrateProjectV1(raw, options)
    expect(migrated.ok).toBe(false)
    if (!migrated.ok) {
      expect(migrated.error.code).toBe('invalid_v1_project')
      expect(migrated.error.message).toContain('基本尺寸')
    }
  })

  it('基线损坏时整体失败，不静默丢弃基线', () => {
    const raw = legacyProject()
    if (raw.baseline !== null) {
      raw.baseline.definition.terms = []
    }
    const migrated = migrateProjectV1(raw, options)
    expect(migrated.ok).toBe(false)
  })

  it('不是 v1 记录时拒绝', () => {
    const migrated = migrateProjectV1({ ...legacyProject(), schemaVersion: 2 }, options)
    expect(migrated.ok).toBe(false)
  })
})

describe('migrateDraftV1：保留无效输入、清确认', () => {
  it('无效草稿原样保留，补 termRevision 与 relationRevision', () => {
    const draft = migrateDraftV1({
      projectId: 'p-1',
      savedAt: '2025-01-02T00:00:00.000Z',
      draft: {
        terms: [
          {
            id: 'H',
            symbol: 'H',
            name: '机架',
            nominal: '',
            lower: '0.0000',
            upper: '0.1000',
            sign: 1,
            sourceNote: '',
          },
        ],
        targetMin: '',
        targetMax: 'bad',
        assumptions: '',
        relationConfirmed: true,
      },
    })
    expect(draft).not.toBeNull()
    expect(draft?.relationRevision).toBe(1)
    expect(draft?.terms[0].nominal).toBe('')
    expect(draft?.terms[0].termRevision).toBe(1)
    expect(draft?.targetMax).toBe('bad')
  })

  it('结构损坏时返回 null，由调用方保留原记录并说明', () => {
    expect(migrateDraftV1({ draft: { terms: 'not-array' } })).toBeNull()
  })
})
