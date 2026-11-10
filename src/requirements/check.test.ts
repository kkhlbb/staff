/**
 * V3.5 Beta：数值表与四态判定用例（规格 §4，任务卡 §9）。
 *
 * 数值逐格来自任务卡独立复算：
 * S=12.00 → C=[1500,2500]、裕量 +500/+500、满足；
 * S=12.04 → C=[1100,2100]、+100/+900、满足；
 * S=12.10 → C=[500,1500]、-500/+1500、不满足；
 * S=12.05 → C=[1000,2000]、0/+1000、边界相等仍满足。
 */
import { describe, expect, it } from 'vitest'
import type { ProjectFileSnapshot } from '../project-file/types'
import { parseProjectVersioned } from '../project-file/validation'
import { createSpacerSnapshot } from '../project-file/__fixtures__/spacerProjectFile'
import { SAMPLE_PROJECT_ID } from '../project-file/__fixtures__/sampleProjectFile'
import { computeCandidateRequirementCheck } from './check'
import type { RequirementCheckInput, RequirementCheckValue } from './check'
import type { RequirementDraftInput } from './fingerprint'
import {
  buildRequirementFingerprintInput,
  computeRequirementInputFingerprint,
  isRequirementCheckStale,
} from './fingerprint'
import {
  activeRequirement,
  createRequirementProject,
  draftWithLength,
  pendingEditOf,
  REQUIREMENT_SOURCE,
} from './__fixtures__/requirementFixture'
import type { RequirementRevision } from './types'

let checkSequence = 0

async function evaluate(
  snapshot: ProjectFileSnapshot,
  draft: RequirementDraftInput | null,
  overrides: Partial<RequirementCheckInput> = {},
): Promise<RequirementCheckValue> {
  checkSequence += 1
  const result = await computeCandidateRequirementCheck({
    snapshot,
    requirementRevisions: snapshot.project.requirementRevisions,
    activeRequirementRevisionId: snapshot.project.activeRequirementRevisionId,
    pendingEdit: null,
    draft,
    baseRevisionId: snapshot.project.currentRevisionId,
    baseGeneration: 0,
    acceptedSeq: 1,
    checkedAt: '2026-11-09T10:00:00.000Z',
    checkId: `check-test-${checkSequence}`,
    inputIssue: null,
    ...overrides,
  })
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`)
  }
  return result.value
}

describe('V3.5 数值表：1q=0.0001mm、闭区间、边界相等算满足', () => {
  const cases = [
    {
      length: '12.00',
      minQ: 1500,
      maxQ: 2500,
      lowerMarginQ: 500,
      upperMarginQ: 500,
      status: 'satisfied',
    },
    {
      length: '12.04',
      minQ: 1100,
      maxQ: 2100,
      lowerMarginQ: 100,
      upperMarginQ: 900,
      status: 'satisfied',
    },
    {
      length: '12.10',
      minQ: 500,
      maxQ: 1500,
      lowerMarginQ: -500,
      upperMarginQ: 1500,
      status: 'unsatisfied',
    },
    {
      length: '12.05',
      minQ: 1000,
      maxQ: 2000,
      lowerMarginQ: 0,
      upperMarginQ: 1000,
      status: 'satisfied',
    },
  ] as const

  for (const item of cases) {
    it(`S=${item.length} → C=[${item.minQ},${item.maxQ}]，条款 ${item.status}`, async () => {
      const project = await createRequirementProject({ length: '12.00' })
      const draft = draftWithLength(project.snapshot, item.length)
      const value = await evaluate(project.snapshot, draft)

      expect(value.check.status).toBe(item.status)
      expect(value.check.resultInterval).toEqual({ minQ: item.minQ, maxQ: item.maxQ })
      expect(value.check.margins).toEqual({
        lowerQ: item.lowerMarginQ,
        upperQ: item.upperMarginQ,
      })
      // 候选链的 target 未被条款区间覆盖。
      expect(value.chain?.target).toEqual({ minQ: 1000, maxQ: 3000 })
      // 原项目目标独立计算，与条款判定互不覆盖。
      expect(value.originalTargetResult?.minQ).toBe(item.minQ)
      expect(value.originalTargetResult?.maxQ).toBe(item.maxQ)
      // 满足才可进入原人工确认流程；不是“已批准”。
      expect(value.evaluation.eligibleForCommit).toBe(item.status === 'satisfied')
    })
  }

  it('S=12.04 的条款区间与原目标相同也不改写 chain.target', async () => {
    const project = await createRequirementProject({ length: '12.00' })
    const before = JSON.stringify(project.snapshot.project.dimensionChain)
    const value = await evaluate(project.snapshot, draftWithLength(project.snapshot, '12.04'))
    expect(value.requirementResult?.minQ).toBe(1100)
    expect(JSON.stringify(project.snapshot.project.dimensionChain)).toBe(before)
  })

  it('B35-07 P35-T：原目标 0.2000～0.4000 与条款 0.1000～0.3000 双向独立', async () => {
    const project = await createRequirementProject({
      length: '12.00',
      target: { minQ: 2000, maxQ: 4000 },
    })
    // S=12.00：条款满足、原目标下界越界。
    const at1200 = await evaluate(project.snapshot, draftWithLength(project.snapshot, '12.00'))
    expect(at1200.check.status).toBe('satisfied')
    expect(at1200.originalTargetResult?.status).toBe('outside')
    expect(at1200.originalTargetResult?.lowerMarginQ).toBe(-500)
    expect(project.snapshot.project.dimensionChain.target).toEqual({ minQ: 2000, maxQ: 4000 })

    // S=11.90：原目标满足、条款上界越界；不得因原目标绿灯显示通过。
    const at1190 = await evaluate(project.snapshot, draftWithLength(project.snapshot, '11.90'))
    expect(at1190.check.resultInterval).toEqual({ minQ: 2500, maxQ: 3500 })
    expect(at1190.check.status).toBe('unsatisfied')
    expect(at1190.check.margins).toEqual({ lowerQ: 1500, upperQ: -500 })
    expect(at1190.originalTargetResult?.status).toBe('within')
    expect(at1190.evaluation.eligibleForCommit).toBe(false)
    // 条款区间没有写回原链。
    expect(at1190.chain?.target).toEqual({ minQ: 2000, maxQ: 4000 })
  })

  it('零宽条款区间：恰好等于 Cmin/Cmax 才算满足', async () => {
    const project = await createRequirementProject({
      length: '12.00',
      lower: '0.1500',
      upper: '0.2500',
    })
    const exact = await evaluate(project.snapshot, draftWithLength(project.snapshot, '12.00'))
    expect(exact.check.status).toBe('satisfied')
    expect(exact.check.margins).toEqual({ lowerQ: 0, upperQ: 0 })

    const narrower = await createRequirementProject({
      length: '12.00',
      lower: '0.1500',
      upper: '0.2499',
    })
    const over = await evaluate(narrower.snapshot, draftWithLength(narrower.snapshot, '12.00'))
    expect(over.check.status).toBe('unsatisfied')
    expect(over.check.reasonCodes).toContain('UPPER_VIOLATED')
  })
})

describe('V3.5 四态：待确认与未检查的判据不同', () => {
  it('无条款 → 未检查，清空当前区间与裕量', async () => {
    const snapshot = await createSpacerSnapshot({ length: '12.00', confirmed: true })
    const value = await evaluate(snapshot, draftWithLength(snapshot, '12.04'))
    expect(value.check.status).toBe('unchecked')
    expect(value.check.reasonCodes).toContain('NO_REQUIREMENT')
    expect(value.check.resultInterval).toBeNull()
    expect(value.check.margins).toBeNull()
    expect(value.check.evidenceRef).toBeNull()
    expect(value.evaluation.eligibleForCommit).toBe(false)
  })

  it('输入超精度 → 未检查，不沿用旧满足', async () => {
    const project = await createRequirementProject()
    const value = await evaluate(project.snapshot, draftWithLength(project.snapshot, '12.04'), {
      inputIssue: { field: 'length', code: 'precision', message: '最多 4 位小数' },
    })
    expect(value.check.status).toBe('unchecked')
    expect(value.check.reasonCodes).toContain('INPUT_PRECISION')
    expect(value.check.resultInterval).toBeNull()
    expect(value.check.margins).toBeNull()
  })

  it('规则不支持 → 未检查（不是待确认，也不出数值）', async () => {
    const project = await createRequirementProject()
    const unsupported: RequirementRevision = {
      ...activeRequirement(project.snapshot),
      ruleType: 'strict-interval-mm' as RequirementRevision['ruleType'],
    }
    const value = await evaluate(project.snapshot, draftWithLength(project.snapshot, '12.04'), {
      requirementRevisions: [unsupported],
    })
    expect(value.check.status).toBe('unchecked')
    expect(value.check.reasonCodes).toContain('UNSUPPORTED_RULE')
    expect(value.check.resultInterval).toBeNull()
  })

  it('条款表单未确认 → 待确认，可保留明确标记的候选数值', async () => {
    const project = await createRequirementProject()
    const value = await evaluate(project.snapshot, draftWithLength(project.snapshot, '12.04'), {
      pendingEdit: pendingEditOf(activeRequirement(project.snapshot)),
    })
    expect(value.check.status).toBe('pending-confirmation')
    expect(value.check.reasonCodes).toContain('REQUIREMENT_EDIT_UNCONFIRMED')
    expect(value.check.resultInterval).toEqual({ minQ: 1100, maxQ: 2100 })
    expect(value.check.margins).toEqual({ lowerQ: 100, upperQ: 900 })
    expect(value.evaluation.eligibleForCommit).toBe(false)
  })

  it('PDF 换版 → 待确认（需核对新版），旧满足不再当前有效', async () => {
    const project = await createRequirementProject()
    const base = project.snapshot
    const sourceRevision = base.revisions[0]!
    const second = {
      ...sourceRevision,
      id: 'sr-2',
      createdAt: '2026-11-09T11:00:00.000Z',
    }
    const upgraded: ProjectFileSnapshot = {
      ...base,
      documents: base.documents.map((document) => ({
        ...document,
        latestRevisionId: 'sr-2',
      })),
      revisions: [sourceRevision, second],
    }
    const value = await evaluate(upgraded, draftWithLength(upgraded, '12.04'))
    expect(value.check.status).toBe('pending-confirmation')
    expect(value.check.reasonCodes).toContain('SOURCE_VERSION_CHANGED')
    // 旧条款仍指向旧版本，仍可定位原文。
    expect(value.check.evidenceRef?.source.revisionId).toBe('sr-1')
    expect(value.check.resultInterval).toEqual({ minQ: 1100, maxQ: 2100 })
  })

  it('条款引用的 PDF 字节不可读 → 待确认', async () => {
    const project = await createRequirementProject()
    const unreadable: ProjectFileSnapshot = {
      ...project.snapshot,
      attachments: [],
      missingAttachments: [
        {
          revisionId: 'sr-1',
          documentId: 'doc-1',
          blobKey: 'blob-1',
          reason: 'declared-missing',
        },
      ],
    }
    const value = await evaluate(unreadable, draftWithLength(unreadable, '12.04'))
    expect(value.check.status).toBe('pending-confirmation')
    expect(value.check.reasonCodes).toContain('SOURCE_UNREADABLE')
  })

  it('条款确认后新增绑定 → 待确认；已确认绑定下单纯改长度不降级', async () => {
    const project = await createRequirementProject()
    const base = project.snapshot
    const inner = base.project.parameters.find((parameter) => parameter.key === 'innerDiameter')!
    const withBinding: ProjectFileSnapshot = {
      ...base,
      project: {
        ...base.project,
        dimensionLinks: [
          ...base.project.dimensionLinks,
          {
            kind: 'parameter-binding',
            bindingId: 'binding:inner-h',
            termId: 't-h',
            partId: inner.partId,
            parameterId: inner.parameterId,
            syncField: 'nominal',
            createdAt: '2026-11-09T11:30:00.000Z',
          },
        ],
      },
    }
    const added = await evaluate(withBinding, draftWithLength(withBinding, '12.04'))
    expect(added.check.status).toBe('pending-confirmation')
    expect(added.check.reasonCodes).toContain('BINDING_ADDED')

    // 同一条款、同一绑定，只改长度：仍按数值给满足，不因参数修订前进降级。
    const lengthOnly = await evaluate(base, draftWithLength(base, '12.04'))
    expect(lengthOnly.check.status).toBe('satisfied')
  })

  it('改绑已有环 → 待确认', async () => {
    const project = await createRequirementProject()
    const base = project.snapshot
    const outer = base.project.parameters.find((parameter) => parameter.key === 'outerDiameter')!
    const rebound: ProjectFileSnapshot = {
      ...base,
      project: {
        ...base.project,
        dimensionLinks: [
          {
            ...(base.project.dimensionLinks[0] as unknown as Record<string, unknown>),
            parameterId: outer.parameterId,
          },
        ] as unknown as ProjectFileSnapshot['project']['dimensionLinks'],
      },
    }
    const value = await evaluate(rebound, draftWithLength(rebound, '12.04'))
    expect(value.check.status).toBe('pending-confirmation')
    expect(value.check.reasonCodes).toContain('BINDING_REBOUND')
  })
})

describe('V3.5 指纹与过期派生', () => {
  it('同输入同指纹；草稿/条款/来源/target 任一变化即不同', async () => {
    const project = await createRequirementProject({ target: { minQ: 2000, maxQ: 4000 } })
    const snapshot = project.snapshot
    const requirement = activeRequirement(snapshot)
    const draft = draftWithLength(snapshot, '12.04')
    const build = (input: {
      draft?: RequirementDraftInput | null
      requirement?: RequirementRevision | null
      target?: { minQ: number; maxQ: number } | null
      latestRevisionId?: string
    }) => {
      const withTarget =
        input.target === undefined
          ? snapshot
          : {
              ...snapshot,
              project: {
                ...snapshot.project,
                dimensionChain: { ...snapshot.project.dimensionChain, target: input.target },
              },
            }
      const withLatest =
        input.latestRevisionId === undefined
          ? withTarget
          : {
              ...withTarget,
              documents: withTarget.documents.map((document) => ({
                ...document,
                latestRevisionId: input.latestRevisionId!,
              })),
            }
      return computeRequirementInputFingerprint(
        buildRequirementFingerprintInput({
          snapshot: withLatest,
          requirement: input.requirement === undefined ? requirement : input.requirement,
          draft: input.draft === undefined ? draft : input.draft,
          baseRevisionId: snapshot.project.currentRevisionId,
          baseGeneration: 0,
          acceptedSeq: 1,
        }),
      )
    }

    const baseline = await build({})
    expect(await build({})).toBe(baseline)
    expect(await build({ draft: draftWithLength(snapshot, '12.10') })).not.toBe(baseline)
    expect(
      await build({
        requirement: { ...requirement, upperQ: requirement.upperQ + 1 },
      }),
    ).not.toBe(baseline)
    expect(await build({ target: { minQ: 1000, maxQ: 3000 } })).not.toBe(baseline)
    expect(await build({ latestRevisionId: 'sr-2' })).not.toBe(baseline)
    expect(await build({ draft: { ...draft, draftRevision: 2 } })).not.toBe(baseline)
  })

  it('历史检查不存“已通过”布尔：过期由当前指纹派生', async () => {
    const project = await createRequirementProject()
    const value = await evaluate(project.snapshot, draftWithLength(project.snapshot, '12.04'))
    const check = value.check
    expect(check.status).toBe('satisfied')
    expect(Object.keys(check)).not.toContain('passed')

    const current = await computeRequirementInputFingerprint(
      buildRequirementFingerprintInput({
        snapshot: project.snapshot,
        requirement: activeRequirement(project.snapshot),
        draft: draftWithLength(project.snapshot, '12.04'),
        baseRevisionId: project.snapshot.project.currentRevisionId,
        baseGeneration: 0,
        acceptedSeq: 1,
      }),
    )
    expect(check.inputFingerprint).toBe(current)
    expect(isRequirementCheckStale(check, current)).toBe(false)
    expect(isRequirementCheckStale(check, `${current}-changed`)).toBe(true)
    // 历史 check 的原 status 不被改写。
    expect(check.status).toBe('satisfied')
  })
})

describe('V3.5 持久化契约：条款与检查可按当前 schema 保存/读回', () => {
  it('条款版本、活动指针与检查证据通过严格 schema8 解析', async () => {
    const project = await createRequirementProject()
    const value = await evaluate(project.snapshot, draftWithLength(project.snapshot, '12.04'))
    const withCheck: ProjectFileSnapshot = {
      ...project.snapshot,
      project: { ...project.snapshot.project, currentRequirementCheck: value.check },
    }
    const parsed = parseProjectVersioned(withCheck.project)
    expect(parsed.ok).toBe(true)
    if (parsed.ok && parsed.value.version === 6) {
      expect(parsed.value.project.activeRequirementRevisionId).toBe('reqrev-1')
      expect(parsed.value.project.currentRequirementCheck?.status).toBe('satisfied')
    } else {
      throw new Error('条款项目没有被解析为 schema8')
    }
  })

  it('未检查检查不得携带当前区间/裕量（严格 schema 拒绝）', async () => {
    const snapshot = await createSpacerSnapshot({ length: '12.00' })
    const value = await evaluate(snapshot, draftWithLength(snapshot, '12.04'))
    const broken = {
      ...snapshot.project,
      currentRequirementCheck: {
        ...value.check,
        resultInterval: { minQ: 1000, maxQ: 2000 },
      },
    }
    const parsed = parseProjectVersioned(broken)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error.code).toBe('INVALID_RECORD')
  })

  it('条款来源哈希与版本不一致时拒绝保存', async () => {
    const project = await createRequirementProject()
    const broken = {
      ...project.snapshot,
      project: {
        ...project.snapshot.project,
        requirementRevisions: [
          {
            ...activeRequirement(project.snapshot),
            source: { ...REQUIREMENT_SOURCE, sha256: 'a'.repeat(64), blobKey: 'blob-1' },
          },
        ],
      },
    }
    const { assembleSnapshot } = await import('../project-file/validation')
    const result = assembleSnapshot({
      project: broken.project,
      draft: broken.draft,
      documents: broken.documents,
      revisions: broken.revisions,
      bindings: broken.bindings,
      blobs: broken.blobs,
      events: broken.events,
      analysisSnapshots: broken.analysisSnapshots,
      importSnapshots: broken.importSnapshots,
      migrationBackups: broken.migrationBackups,
      legacyArchive: broken.legacyArchive,
      fileRevisions: broken.fileRevisions,
      attachments: broken.attachments,
      missingAttachments: broken.missingAttachments,
      snapshotReferences: broken.snapshotReferences,
      manifestMeta: broken.manifestMeta,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('HASH_MISMATCH')
  })
})

describe('V3.5 夹具自检：P35-A 基线', () => {
  it('基线条款为 0.1000～0.3000，原目标 0.1000～0.3000，条款版本不可变', async () => {
    const project = await createRequirementProject()
    const requirement = activeRequirement(project.snapshot)
    expect(requirement.lowerQ).toBe(1000)
    expect(requirement.upperQ).toBe(3000)
    expect(requirement.projectId).toBe(SAMPLE_PROJECT_ID)
    expect(requirement.parentRevisionId).toBeNull()
    expect(requirement.confirmedAgainstLatestRevisionId).toBe('sr-1')
    expect(project.snapshot.project.dimensionChain.target).toEqual({ minQ: 1000, maxQ: 3000 })
    expect(project.baselineCheck.status).toBe('satisfied')
    expect(project.snapshot.fileRevisions.map((revision) => revision.revisionId)).toContain('rev-cfg-1')
  })
})
