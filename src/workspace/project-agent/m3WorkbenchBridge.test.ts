import { describe, expect, it } from 'vitest'
import {
  computeCheckSetFingerprint,
  createBoundConfirmation,
  evaluateCompletionReadiness,
  isBoundConfirmationValid,
  isCompletionIntentPrompt,
  mergeExternalProjectNotification,
  mergeExternalProjectNotificationWithWatermarks,
  probeM3WorkbenchBridge,
  summarizeCheckCounts,
  type M3ExternalNotificationWatermarks,
} from './m3WorkbenchBridge'
import {
  DEFAULT_M2_FEATURES,
  DEFAULT_M2_REQUIREMENTS,
  type M2ArtifactSlotState,
  type M2CheckItem,
} from './m2WorkbenchBridge'

const READY_MODEL: M2ArtifactSlotState = {
  status: 'ready',
  revision: 'draft-4',
  revisionOrder: 4,
  isDraft: true,
  fingerprint: 'fp-draft-4',
}

const READY_DRAWING: M2ArtifactSlotState = {
  status: 'ready',
  revision: 'draft-4',
  revisionOrder: 4,
  isDraft: true,
  fingerprint: 'fp-draft-4',
}

describe('m3WorkbenchBridge (M3-FE-01 窄接口探测与纯逻辑守卫)', () => {
  it('F10：按 duck-typing 探测 M3 无碰撞窄接口（commitM3ApprovedDraft），不被旧 preload 同名 commitApprovedDraft 误判', () => {
    const emptyProbe = probeM3WorkbenchBridge({})
    expect(emptyProbe.anyAvailable).toBe(false)
    expect(emptyProbe.missingMethods).toEqual([
      'commitM3ApprovedDraft',
      'undoDraftChange',
      'getMigrationReport',
      'openExternalProjectResult',
      'subscribeM3ExternalProjectEvents',
    ])

    // 旧 preload 仅暴露 commitApprovedDraft 时严禁误判已接线
    const legacyPreloadProbe = probeM3WorkbenchBridge({
      commitApprovedDraft: async () => ({ ok: true, value: {} }),
    })
    expect(legacyPreloadProbe.anyAvailable).toBe(false)
    expect(legacyPreloadProbe.capabilities.commitM3ApprovedDraft).toBe(false)
    expect(legacyPreloadProbe.missingMethods).toContain('commitM3ApprovedDraft')

    const partialProbe = probeM3WorkbenchBridge({
      commitM3ApprovedDraft: async () => ({ ok: false, error: { code: 'INTERNAL', message: 'err' } }),
      getMigrationReport: async () => ({ ok: true, value: null }),
    })
    expect(partialProbe.anyAvailable).toBe(true)
    expect(partialProbe.capabilities.commitM3ApprovedDraft).toBe(true)
    expect(partialProbe.capabilities.getMigrationReport).toBe(true)
    expect(partialProbe.capabilities.undoDraftChange).toBe(false)
    expect(partialProbe.capabilities.openExternalProjectResult).toBe(false)
    expect(partialProbe.capabilities.externalProjectEvents).toBe(false)
  })

  it('准确识别内置对话中的完成意图，避免误拦普通建模修改指令', () => {
    expect(isCompletionIntentPrompt('完成')).toBe(true)
    expect(isCompletionIntentPrompt('完成了！')).toBe(true)
    expect(isCompletionIntentPrompt('保存此版本')).toBe(true)
    expect(isCompletionIntentPrompt('确认完成')).toBe(true)
    expect(isCompletionIntentPrompt('done')).toBe(true)

    expect(isCompletionIntentPrompt('把这个孔向右移 1 mm')).toBe(false)
    expect(isCompletionIntentPrompt('完成后再把右孔向右移 2 mm')).toBe(false)
    expect(isCompletionIntentPrompt('   ')).toBe(false)
  })

  it('统计全部 6 种检查状态计数，并识别必需阻塞条款及关联特征', () => {
    const checks: readonly M2CheckItem[] = [
      {
        checkId: 'c1',
        requirementId: 'r1',
        title: '边距检查',
        required: true,
        status: 'fail',
        summary: '最差低于要求 0.25 mm',
        linkedFeatureIds: ['obj-right-hole', 'obj-right-face'],
        linkedAnnotationIds: ['ann-right-margin'],
      },
      {
        checkId: 'c2',
        requirementId: 'r2',
        title: '间隙检查',
        required: true,
        status: 'pass',
        summary: '通过',
        linkedFeatureIds: ['obj-cover-gap'],
        linkedAnnotationIds: ['ann-cover-gap'],
      },
      {
        checkId: 'c3',
        requirementId: 'r3',
        title: '基准澄清',
        required: true,
        status: 'needsClarification',
        summary: '待澄清',
        linkedFeatureIds: ['obj-left-hole'],
        linkedAnnotationIds: [],
      },
      {
        checkId: 'c4',
        requirementId: 'r4',
        title: '形位公差',
        required: false,
        status: 'uncovered',
        summary: '未覆盖',
        linkedFeatureIds: [],
        linkedAnnotationIds: [],
      },
      {
        checkId: 'c5',
        requirementId: 'r5',
        title: '求解异常',
        required: true,
        status: 'executionFailed',
        summary: '执行失败',
        linkedFeatureIds: [],
        linkedAnnotationIds: [],
      },
      {
        checkId: 'c6',
        requirementId: 'r6',
        title: '异步重算',
        required: true,
        status: 'checking',
        summary: '检查中',
        linkedFeatureIds: [],
        linkedAnnotationIds: [],
      },
    ]

    const counts = summarizeCheckCounts(checks, true)
    expect(counts).toEqual({
      total: 6,
      pass: 1,
      fail: 1,
      needsClarification: 1,
      uncovered: 1,
      executionFailed: 1,
      checking: 1,
    })

    const readiness = evaluateCompletionReadiness({
      draftRevision: 'draft-4',
      model: READY_MODEL,
      drawing: READY_DRAWING,
      checks,
      checksInProgress: true,
      features: DEFAULT_M2_FEATURES,
    })
    expect(readiness.canSaveFormal).toBe(false)
    expect(readiness.isGenerating).toBe(true)
    expect(readiness.blockingChecks.map((b) => b.check.checkId)).toEqual(['c1', 'c3', 'c5', 'c6'])
    expect(readiness.blockingChecks[0].linkedFeatures.map((f) => f.objectId)).toEqual([
      'obj-right-hole',
      'obj-right-face',
    ])
  })

  it('检查集指纹与一次性绑定确认在草稿修订或检查结果变化时自动失效', () => {
    const passChecks: readonly M2CheckItem[] = [
      {
        checkId: 'c1',
        requirementId: 'r1',
        title: '边距检查',
        required: true,
        status: 'pass',
        summary: '通过',
        linkedFeatureIds: ['obj-right-hole'],
        linkedAnnotationIds: ['ann-right-margin'],
        revisionFingerprint: 'fp-draft-4',
      },
    ]

    const fp1 = computeCheckSetFingerprint({
      projectId: 'proj-plate-01',
      baseRevision: 'v1',
      draftRevision: 'draft-4',
      modelFingerprint: 'fp-draft-4',
      drawingFingerprint: 'fp-draft-4',
      checks: passChecks,
    })

    const confirmation = createBoundConfirmation({
      projectId: 'proj-plate-01',
      baseRevision: 'v1',
      draftRevision: 'draft-4',
      checkSetFingerprint: fp1,
      seq: 1,
    })

    expect(
      isBoundConfirmationValid(confirmation, {
        projectId: 'proj-plate-01',
        baseRevision: 'v1',
        draftRevision: 'draft-4',
        checkSetFingerprint: fp1,
      }),
    ).toBe(true)

    // Draft revision changed -> invalidated
    expect(
      isBoundConfirmationValid(confirmation, {
        projectId: 'proj-plate-01',
        baseRevision: 'v1',
        draftRevision: 'draft-5',
        checkSetFingerprint: fp1,
      }),
    ).toBe(false)

    // Check status changed -> fingerprint changed -> invalidated
    const fp2 = computeCheckSetFingerprint({
      projectId: 'proj-plate-01',
      baseRevision: 'v1',
      draftRevision: 'draft-4',
      modelFingerprint: 'fp-draft-4',
      drawingFingerprint: 'fp-draft-4',
      checks: [{ ...passChecks[0], status: 'fail' }],
    })
    expect(fp2).not.toBe(fp1)
    expect(
      isBoundConfirmationValid(confirmation, {
        projectId: 'proj-plate-01',
        baseRevision: 'v1',
        draftRevision: 'draft-4',
        checkSetFingerprint: fp2,
      }),
    ).toBe(false)
  })

  it('F08：正式提交前置守卫阻断空检查、跨修订错配、旧修订检查指纹、空指纹及同修订 drawing_failed', () => {
    const validDraft8Model: M2ArtifactSlotState = {
      status: 'ready',
      revision: 'draft-8',
      revisionOrder: 8,
      isDraft: true,
      fingerprint: 'fp-draft-8',
    }
    const validDraft8Drawing: M2ArtifactSlotState = {
      status: 'ready',
      revision: 'draft-8',
      revisionOrder: 8,
      isDraft: true,
      fingerprint: 'fp-draft-8',
    }
    const passDraft8Checks: readonly M2CheckItem[] = [
      {
        checkId: 'c1',
        requirementId: 'r1',
        title: '边距检查',
        required: true,
        status: 'pass',
        summary: '通过',
        linkedFeatureIds: ['obj-right-hole'],
        linkedAnnotationIds: ['ann-right-margin'],
        revisionFingerprint: 'fp-draft-8',
      },
    ]

    // 1. checks 为空数组 -> 严禁放行
    const emptyChecks = evaluateCompletionReadiness({
      draftRevision: 'draft-8',
      model: validDraft8Model,
      drawing: validDraft8Drawing,
      checks: [],
      checksInProgress: false,
      features: DEFAULT_M2_FEATURES,
    })
    expect(emptyChecks.canSaveFormal).toBe(false)
    expect(emptyChecks.blockReasons.some((r) => r.includes('缺少必需条款检查通过记录'))).toBe(true)

    // 2. 两槽为草稿 7 时传入目标草稿 8 -> 必须阻断
    const draft7Model: M2ArtifactSlotState = {
      status: 'ready',
      revision: 'draft-7',
      revisionOrder: 7,
      isDraft: true,
      fingerprint: 'fp-draft-7',
    }
    const draft7Drawing: M2ArtifactSlotState = {
      status: 'ready',
      revision: 'draft-7',
      revisionOrder: 7,
      isDraft: true,
      fingerprint: 'fp-draft-7',
    }
    const revMismatch = evaluateCompletionReadiness({
      draftRevision: 'draft-8',
      model: draft7Model,
      drawing: draft7Drawing,
      checks: [{ ...passDraft8Checks[0], revisionFingerprint: 'fp-draft-7' }],
      checksInProgress: false,
      features: DEFAULT_M2_FEATURES,
    })
    expect(revMismatch.canSaveFormal).toBe(false)
    expect(revMismatch.artifactsAligned).toBe(false)

    // 3. 必需检查沿用旧草稿 7 指纹或指纹为空 -> 严禁放行草稿 8
    const staleCheckFp = evaluateCompletionReadiness({
      draftRevision: 'draft-8',
      model: validDraft8Model,
      drawing: validDraft8Drawing,
      checks: [{ ...passDraft8Checks[0], revisionFingerprint: 'fp-draft-7' }],
      checksInProgress: false,
      features: DEFAULT_M2_FEATURES,
    })
    expect(staleCheckFp.canSaveFormal).toBe(false)
    expect(staleCheckFp.blockReasons.some((r) => r.includes('指纹不匹配'))).toBe(true)

    const emptyCheckFp = evaluateCompletionReadiness({
      draftRevision: 'draft-8',
      model: validDraft8Model,
      drawing: validDraft8Drawing,
      checks: [{ ...passDraft8Checks[0], revisionFingerprint: '' }],
      checksInProgress: false,
      features: DEFAULT_M2_FEATURES,
    })
    expect(emptyCheckFp.canSaveFormal).toBe(false)

    // 4. 当前草稿存在同修订 drawing_failed（即使 drawing 槽仍为 ready）-> 必须阻断
    const drawingFailed = evaluateCompletionReadiness({
      draftRevision: 'draft-8',
      model: validDraft8Model,
      drawing: validDraft8Drawing,
      drawingFailure: {
        failedRevision: 'draft-8',
        failedRevisionOrder: 8,
        reason: '投影内核异常',
        retryable: true,
      },
      checks: passDraft8Checks,
      checksInProgress: false,
      features: DEFAULT_M2_FEATURES,
    })
    expect(drawingFailed.canSaveFormal).toBe(false)
    expect(drawingFailed.blockReasons.some((r) => r.includes('图纸生成失败记录'))).toBe(true)

    // 5. 全部条件严格满足时放行
    const allValid = evaluateCompletionReadiness({
      draftRevision: 'draft-8',
      model: validDraft8Model,
      drawing: validDraft8Drawing,
      drawingFailure: null,
      checks: passDraft8Checks,
      checksInProgress: false,
      features: DEFAULT_M2_FEATURES,
    })
    expect(allValid.canSaveFormal).toBe(true)
  })

  it('F09：computeCheckSetFingerprint 纳入 summary 与 detail，任何摘要/详情变更都会改变指纹', () => {
    const baseCheck: M2CheckItem = {
      checkId: 'c1',
      requirementId: 'r1',
      title: '边距检查',
      required: true,
      status: 'pass',
      summary: '名义 14.0 mm，最差 13.75 mm',
      detail: '公差分析样本 100%',
      linkedFeatureIds: ['obj-right-hole'],
      linkedAnnotationIds: ['ann-right-margin'],
      revisionFingerprint: 'fp-draft-4',
    }
    const fpBase = computeCheckSetFingerprint({
      projectId: 'proj-1',
      baseRevision: 'v1',
      draftRevision: 'draft-4',
      modelFingerprint: 'fp-draft-4',
      drawingFingerprint: 'fp-draft-4',
      checks: [baseCheck],
    })
    const fpSummaryChanged = computeCheckSetFingerprint({
      projectId: 'proj-1',
      baseRevision: 'v1',
      draftRevision: 'draft-4',
      modelFingerprint: 'fp-draft-4',
      drawingFingerprint: 'fp-draft-4',
      checks: [{ ...baseCheck, summary: '名义 13.2 mm，最差 13.05 mm' }],
    })
    const fpDetailChanged = computeCheckSetFingerprint({
      projectId: 'proj-1',
      baseRevision: 'v1',
      draftRevision: 'draft-4',
      modelFingerprint: 'fp-draft-4',
      drawingFingerprint: 'fp-draft-4',
      checks: [{ ...baseCheck, detail: '含额外温度修正项' }],
    })

    expect(fpSummaryChanged).not.toBe(fpBase)
    expect(fpDetailChanged).not.toBe(fpBase)
  })

  it('F12：同一非当前项目外部通知按 revisionOrder / sequence 单调比较，拒绝旧包覆盖新通知', () => {
    const evDraft9 = {
      eventId: 'ev-9',
      projectId: 'proj-b',
      projectName: '项目 B',
      sequence: 10,
      draftRevision: 'draft-9',
      revisionOrder: 9,
      summary: '草稿 9 最新完成',
    }
    const evOlderDraft7HighSeq = {
      eventId: 'ev-7',
      projectId: 'proj-b',
      projectName: '项目 B',
      sequence: 12,
      draftRevision: 'draft-7',
      revisionOrder: 7,
      summary: '迟到的草稿 7 旧通知',
    }
    const evSameDraftLowerSeq = {
      eventId: 'ev-9-old',
      projectId: 'proj-b',
      projectName: '项目 B',
      sequence: 9,
      draftRevision: 'draft-9',
      revisionOrder: 9,
      summary: '同修订低序号旧包',
    }
    const evNewerDraft10 = {
      eventId: 'ev-10',
      projectId: 'proj-b',
      projectName: '项目 B',
      sequence: 2,
      draftRevision: 'draft-10',
      revisionOrder: 10,
      summary: '草稿 10 更新完成',
    }

    let list = mergeExternalProjectNotification([], evDraft9)
    expect(list).toHaveLength(1)
    expect(list[0].eventId).toBe('ev-9')

    // 旧修订（即使 seq 更大）不得覆盖新通知
    list = mergeExternalProjectNotification(list, evOlderDraft7HighSeq)
    expect(list).toHaveLength(1)
    expect(list[0].eventId).toBe('ev-9')

    // 同修订低序号不得覆盖
    list = mergeExternalProjectNotification(list, evSameDraftLowerSeq)
    expect(list).toHaveLength(1)
    expect(list[0].eventId).toBe('ev-9')

    // 更高修订正常更新替换
    list = mergeExternalProjectNotification(list, evNewerDraft10)
    expect(list).toHaveLength(1)
    expect(list[0].eventId).toBe('ev-10')
  })

  it('E1 & E3：缺失当前修订指纹、存在未确认必需要求或必需要求缺少当前修订通过检查时严禁放行正式提交', () => {
    const passCheckForReq0: M2CheckItem = {
      checkId: 'c1',
      requirementId: 'req-right-margin',
      title: '右孔边距',
      required: true,
      status: 'pass',
      summary: '通过',
      linkedFeatureIds: ['obj-right-hole'],
      linkedAnnotationIds: ['ann-right-margin'],
      revisionFingerprint: 'fp-draft-4',
    }

    // E1: 槽位缺失非空指纹 -> 阻断
    const noFpReadiness = evaluateCompletionReadiness({
      draftRevision: 'draft-4',
      model: { ...READY_MODEL, fingerprint: null },
      drawing: { ...READY_DRAWING, fingerprint: null },
      requirements: [DEFAULT_M2_REQUIREMENTS[0]],
      checks: [passCheckForReq0],
      checksInProgress: false,
      features: DEFAULT_M2_FEATURES,
    })
    expect(noFpReadiness.canSaveFormal).toBe(false)

    // E3a: 存在 needsClarification / conflict / uncovered 必需要求（即使已有检查都通过）-> 阻断并列出阻塞要求
    const unconfirmedReqReadiness = evaluateCompletionReadiness({
      draftRevision: 'draft-4',
      model: READY_MODEL,
      drawing: READY_DRAWING,
      requirements: [DEFAULT_M2_REQUIREMENTS[0], DEFAULT_M2_REQUIREMENTS[2]],
      checks: [passCheckForReq0],
      checksInProgress: false,
      features: DEFAULT_M2_FEATURES,
    })
    expect(unconfirmedReqReadiness.canSaveFormal).toBe(false)
    expect(unconfirmedReqReadiness.blockingRequirements).toHaveLength(1)
    expect(unconfirmedReqReadiness.blockingRequirements[0].requirement.requirementId).toBe(
      'req-datum-conflict',
    )

    // E3b: 已确认必需要求 req-cover-gap 没有任何对应当前修订指纹且 status='pass' 的检查 -> 阻断并列出阻塞要求
    const uncoveredConfirmedReqReadiness = evaluateCompletionReadiness({
      draftRevision: 'draft-4',
      model: READY_MODEL,
      drawing: READY_DRAWING,
      requirements: [DEFAULT_M2_REQUIREMENTS[0], DEFAULT_M2_REQUIREMENTS[1]],
      checks: [passCheckForReq0],
      checksInProgress: false,
      features: DEFAULT_M2_FEATURES,
    })
    expect(uncoveredConfirmedReqReadiness.canSaveFormal).toBe(false)
    expect(uncoveredConfirmedReqReadiness.blockingRequirements).toHaveLength(1)
    expect(uncoveredConfirmedReqReadiness.blockingRequirements[0].requirement.requirementId).toBe(
      'req-cover-gap',
    )
    expect(uncoveredConfirmedReqReadiness.blockingRequirements[0].reason).toBe(
      'missing_passed_check',
    )
  })

  it('E5：computeCheckSetFingerprint 纳入稳定排序的 linkedFeatureIds / linkedAnnotationIds 与规范化 anchor，任意证据或锚点变更必改指纹', () => {
    const baseCheck: M2CheckItem = {
      checkId: 'c1',
      requirementId: 'req-right-margin',
      title: '边距检查',
      required: true,
      status: 'pass',
      summary: '通过',
      linkedFeatureIds: ['obj-right-hole', 'obj-right-face'],
      linkedAnnotationIds: ['ann-right-margin', 'ann-plate-length'],
      revisionFingerprint: 'fp-draft-4',
      anchor: {
        documentRef: 'doc-1',
        documentName: '安装板任务书.pdf',
        page: 2,
        region: { x: 10, y: 20, width: 100, height: 30, unit: 'pdfPoint1000' },
        excerpt: '右孔至右端面至少 13 mm',
      },
    }
    const calc = (check: M2CheckItem) =>
      computeCheckSetFingerprint({
        projectId: 'proj-1',
        baseRevision: 'v1',
        draftRevision: 'draft-4',
        modelFingerprint: 'fp-draft-4',
        drawingFingerprint: 'fp-draft-4',
        checks: [check],
      })

    const fpBase = calc(baseCheck)
    // 数组顺序变化应保持稳定一致
    const fpReordered = calc({
      ...baseCheck,
      linkedFeatureIds: ['obj-right-face', 'obj-right-hole'],
      linkedAnnotationIds: ['ann-plate-length', 'ann-right-margin'],
    })
    expect(fpReordered).toBe(fpBase)

    // linkedFeatureIds / linkedAnnotationIds / anchor 任意字段变更必改指纹
    expect(calc({ ...baseCheck, linkedFeatureIds: ['obj-right-hole'] })).not.toBe(fpBase)
    expect(calc({ ...baseCheck, linkedAnnotationIds: ['ann-right-margin'] })).not.toBe(fpBase)
    expect(calc({ ...baseCheck, anchor: { ...baseCheck.anchor!, page: 3 } })).not.toBe(fpBase)
    expect(
      calc({ ...baseCheck, anchor: { ...baseCheck.anchor!, documentRef: 'doc-2' } }),
    ).not.toBe(fpBase)
    expect(
      calc({
        ...baseCheck,
        anchor: {
          ...baseCheck.anchor!,
          region: { x: 11, y: 20, width: 100, height: 30, unit: 'pdfPoint1000' },
        },
      }),
    ).not.toBe(fpBase)
    expect(
      calc({ ...baseCheck, anchor: { ...baseCheck.anchor!, excerpt: '修改后的摘录' } }),
    ).not.toBe(fpBase)
  })

  it('E6：通知清除或打开后水位表仍持久化保留，旧通知再次到达被严格丢弃不得复活', () => {
    let watermarks: M3ExternalNotificationWatermarks = {}
    let list: readonly {
      readonly eventId: string
      readonly projectId: string
      readonly projectName: string
      readonly sequence: number
      readonly draftRevision: string
      readonly revisionOrder?: number
      readonly summary: string
    }[] = []

    const evDraft9 = {
      eventId: 'ev-b-9',
      projectId: 'proj-b',
      projectName: '项目 B',
      sequence: 10,
      draftRevision: 'draft-9',
      revisionOrder: 9,
      summary: '草稿 9 完成',
    }
    const r1 = mergeExternalProjectNotificationWithWatermarks(list, watermarks, evDraft9)
    expect(r1.accepted).toBe(true)
    list = r1.notifications
    watermarks = r1.watermarks
    expect(list).toHaveLength(1)

    // 用户关闭/清除通知（列表清空，但 watermarks 保留）
    list = []

    // 旧修订通知再次到达 -> 必须被水位表严格丢弃，不得复活
    const evOlder = {
      eventId: 'ev-b-8',
      projectId: 'proj-b',
      projectName: '项目 B',
      sequence: 99,
      draftRevision: 'draft-8',
      revisionOrder: 8,
      summary: '迟到的草稿 8 旧通知',
    }
    const r2 = mergeExternalProjectNotificationWithWatermarks(list, watermarks, evOlder)
    expect(r2.accepted).toBe(false)
    expect(r2.notifications).toHaveLength(0)

    // 同修订同序号/低序号旧通知再次到达 -> 严格丢弃
    const r3 = mergeExternalProjectNotificationWithWatermarks(list, watermarks, {
      ...evDraft9,
      eventId: 'ev-b-9-dup',
      sequence: 10,
    })
    expect(r3.accepted).toBe(false)
    expect(r3.notifications).toHaveLength(0)

    // 更高修订的新通知 -> 正常接收
    const evNewer = {
      eventId: 'ev-b-10',
      projectId: 'proj-b',
      projectName: '项目 B',
      sequence: 1,
      draftRevision: 'draft-10',
      revisionOrder: 10,
      summary: '草稿 10 新完成',
    }
    const r4 = mergeExternalProjectNotificationWithWatermarks(list, watermarks, evNewer)
    expect(r4.accepted).toBe(true)
    expect(r4.notifications).toHaveLength(1)
    expect(r4.notifications[0].eventId).toBe('ev-b-10')
  })

  it('N4：不可比较通知（无 revisionOrder）合并时严禁擦除水位表已有数值型 revisionOrder，后续更旧修订凭更高 sequence 仍被拒绝', () => {
    let watermarks: M3ExternalNotificationWatermarks = {}
    let list: readonly {
      readonly eventId: string
      readonly projectId: string
      readonly projectName: string
      readonly sequence: number
      readonly draftRevision: string
      readonly revisionOrder?: number
      readonly summary: string
    }[] = []

    const evDraft7 = {
      eventId: 'ev-b-7',
      projectId: 'proj-b',
      projectName: '项目 B',
      sequence: 10,
      draftRevision: 'draft-7',
      revisionOrder: 7,
      summary: '草稿 7 完成',
    }
    const r1 = mergeExternalProjectNotificationWithWatermarks(list, watermarks, evDraft7)
    expect(r1.accepted).toBe(true)
    list = r1.notifications
    watermarks = r1.watermarks
    expect(watermarks['proj-b']?.revisionOrder).toBe(7)

    // 收到无数值后缀且无 revisionOrder 的不可比较通知（更高 sequence=12）
    const evOpaque = {
      eventId: 'ev-b-opaque',
      projectId: 'proj-b',
      projectName: '项目 B',
      sequence: 12,
      draftRevision: 'custom-snapshot',
      summary: '不可比较外部通知',
    }
    const r2 = mergeExternalProjectNotificationWithWatermarks(list, watermarks, evOpaque)
    expect(r2.accepted).toBe(true)
    list = r2.notifications
    watermarks = r2.watermarks
    // 水位表必须保留已有的数值型 revisionOrder=7，不得擦除为 null
    expect(watermarks['proj-b']?.revisionOrder).toBe(7)
    expect(watermarks['proj-b']?.sequence).toBe(12)

    // 随后更旧修订 draft-6 凭更高 sequence=25 到达 -> 必须被水位表 revisionOrder=7 拒绝
    const evOlderDraft6 = {
      eventId: 'ev-b-6-late',
      projectId: 'proj-b',
      projectName: '项目 B',
      sequence: 25,
      draftRevision: 'draft-6',
      revisionOrder: 6,
      summary: '更旧草稿 6 迟到通知',
    }
    const r3 = mergeExternalProjectNotificationWithWatermarks(list, watermarks, evOlderDraft6)
    expect(r3.accepted).toBe(false)
    expect(r3.notifications[0]?.eventId).toBe('ev-b-opaque')
  })
})
