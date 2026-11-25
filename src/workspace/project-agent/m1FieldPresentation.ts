import {
  isM1Activity,
  isM1ActivityStatus,
  isM1ContextFields,
  isM1CreateSpacerDraft,
  isM1DraftOccupancy,
  isM1EventPage,
  isM1ReadRecoveryCode,
  isM1SpacerDraft,
  isM1WriterRejectionCode,
  spacerDraftEligibility,
} from '../../../desktop/shared/project-agent/m1-fields.ts'
import type {
  M1Activity,
  M1ContextFields,
  M1CreateSpacerDraft,
  M1DraftOccupancy,
  M1EventPageFields,
  M1SpacerDraft,
} from '../../../desktop/shared/project-agent/m1-fields.ts'
import { formatMm } from '../../../src/domain/units.ts'

export const M1_FORMAL_SAVE_ENABLED = false as const
export const M1_PRODUCTION_API_CONNECTED = false as const
export const M1_SYNTHETIC_BADGE = '模拟' as const

export type M1ActivityStatus = M1Activity['status']
export type M1ConnectionState = M1ContextFields['snapshot']['connection']
export type M1AuthorizationState =
  | 'unauthorized'
  | 'authorized-readonly'
  | 'authorized-writable'
export type M1SpacerSource = M1SpacerDraft['sources']['innerDiameterQ']
export type M1Question = NonNullable<M1SpacerDraft['question']>
export type M1QuestionReason = M1Question['reason']
export type M1Anchor = M1Question['anchors'][number]
export type M1AnchorRegion = NonNullable<M1Anchor['region']>
export type M1SpacerDraftEligibilityVerdict = ReturnType<typeof spacerDraftEligibility>
export type M1ReadRecoveryCode =
  typeof isM1ReadRecoveryCode extends (value: unknown) => value is infer T ? T : never
export type M1WriterRejectionCode =
  typeof isM1WriterRejectionCode extends (value: unknown) => value is infer T ? T : never

export interface M1PresentationOptions {
  readonly synthetic?: boolean
}

export interface M1ConnectionPresentation {
  readonly state: M1ConnectionState
  readonly label: string
}

export interface M1AuthorizationPresentation {
  readonly state: M1AuthorizationState
  readonly authorized: boolean
  readonly canWrite: boolean
  readonly label: string
}

export interface M1WriterOccupancyPresentation {
  readonly occupied: boolean
  readonly epoch: number
  readonly label: string
}

export interface M1AnchorPresentation {
  readonly documentRef: string
  readonly documentFingerprint: string
  readonly page: number
  readonly excerpt: string
  readonly region: Readonly<M1AnchorRegion> | null
}

export interface M1QuestionPresentation {
  readonly questionId: string
  readonly reason: M1QuestionReason
  readonly reasonLabel: string
  readonly prompt: string
  readonly anchors: readonly M1AnchorPresentation[]
}

export interface M1SpacerSourcePresentation {
  readonly type: M1SpacerSource['type']
  readonly label: string
  readonly anchor: M1AnchorPresentation | null
}

export interface M1SpacerDraftPresentation {
  readonly draftRevision: string
  readonly innerDiameterQ: number
  readonly outerDiameterQ: number
  readonly lengthQ: number
  readonly innerDiameterMm: string
  readonly outerDiameterMm: string
  readonly lengthMm: string
  readonly sources: Readonly<{
    innerDiameterQ: M1SpacerSourcePresentation
    outerDiameterQ: M1SpacerSourcePresentation
    lengthQ: M1SpacerSourcePresentation
  }>
  readonly question: M1QuestionPresentation | null
  readonly formalSaveEnabled: false
  readonly productionApiConnected: false
}

export interface M1CreateSpacerDraftPresentation {
  readonly type: M1CreateSpacerDraft['type']
  readonly innerDiameterQ: number
  readonly outerDiameterQ: number
  readonly lengthQ: number
  readonly innerDiameterMm: string
  readonly outerDiameterMm: string
  readonly lengthMm: string
  readonly formalSaveEnabled: false
  readonly productionApiConnected: false
}

export interface M1ActivityStatusPresentation {
  readonly status: M1ActivityStatus
  readonly label: string
}

export interface M1ActivityPresentation {
  readonly taskId: string
  readonly projectId: string
  readonly source: M1Activity['source']
  readonly baseRevision: string | null
  readonly draftRevision: string | null
  readonly status: M1ActivityStatus
  readonly statusLabel: string
  readonly lastStep: string | null
  readonly question: M1QuestionPresentation | null
  readonly errorCode: string | null
  readonly updatedAtMs: number
}

export interface M1ContextPresentation {
  readonly projectId: string
  readonly draftRevision: string | null
  readonly cursor: number
  readonly connection: M1ConnectionPresentation
  readonly authorization: M1AuthorizationPresentation
  readonly writer: M1WriterOccupancyPresentation
  readonly spacerDraft: M1SpacerDraftPresentation | null
  readonly activities: readonly M1ActivityPresentation[]
  readonly formalSaveEnabled: false
  readonly productionApiConnected: false
  readonly synthetic: boolean
  readonly syntheticBadge: typeof M1_SYNTHETIC_BADGE | null
}

export type M1ContextPresentationResult =
  | Readonly<{
      ok: true
      value: M1ContextPresentation
      formalSaveEnabled: false
      productionApiConnected: false
    }>
  | Readonly<{
      ok: false
      reason: 'INVALID_M1_CONTEXT'
      formalSaveEnabled: false
      productionApiConnected: false
    }>

export type M1SpacerDraftPresentationResult =
  | Readonly<{ ok: true; value: M1SpacerDraftPresentation }>
  | Readonly<{ ok: false; reason: 'INVALID_SPACER_DRAFT' }>

export type M1CreateSpacerDraftPresentationResult =
  | Readonly<{ ok: true; value: M1CreateSpacerDraftPresentation }>
  | Readonly<{ ok: false; reason: 'INVALID_CREATE_SPACER_DRAFT' }>

export type M1ActivityStatusPresentationResult =
  | Readonly<{ ok: true; value: M1ActivityStatusPresentation }>
  | Readonly<{ ok: false; reason: 'INVALID_ACTIVITY_STATUS' }>

export type M1ActivityPresentationResult =
  | Readonly<{ ok: true; value: M1ActivityPresentation }>
  | Readonly<{ ok: false; reason: 'INVALID_ACTIVITY' }>

export interface M1SpacerDraftEligibilityPresentation {
  readonly occupancy: M1DraftOccupancy | null
  readonly verdict: M1SpacerDraftEligibilityVerdict
  readonly eligible: boolean
  readonly label: string
  readonly formalSaveEnabled: false
  readonly productionApiConnected: false
}

export interface M1AcceptedEventPage {
  readonly events: readonly Readonly<{ projectId: string; sequence: number }>[]
  readonly nextConsumerCursor: number
  readonly highWatermark: number
  readonly hasMoreEvents: boolean
  readonly advanced: boolean
}

export type M1EventPageAcceptanceResult =
  | Readonly<{
      ok: true
      value: M1AcceptedEventPage
      productionApiConnected: false
    }>
  | Readonly<{
      ok: false
      reason: 'INVALID_EVENT_PAGE'
      nextConsumerCursor: null
      advanced: false
      productionApiConnected: false
    }>

export type M1ReadRecoveryPresentationResult =
  | Readonly<{
      ok: true
      code: M1ReadRecoveryCode
      action: 'refetchSnapshot' | 'requireAuthorization'
      shouldRefetchSnapshot: boolean
      shouldClearRestrictedView: boolean
      skipGapsAllowed: false
      replayFromStartAllowed: false
      label: string
      productionApiConnected: false
    }>
  | Readonly<{
      ok: false
      reason: 'UNKNOWN_READ_RECOVERY_CODE'
      productionApiConnected: false
    }>

export type M1WriterRejectionPresentationResult =
  | Readonly<{
      ok: true
      code: M1WriterRejectionCode
      category: 'authorization' | 'occupancy'
      label: string
      productionApiConnected: false
    }>
  | Readonly<{
      ok: false
      reason: 'UNKNOWN_WRITER_REJECTION_CODE'
      productionApiConnected: false
    }>

const CONNECTION_LABELS: Readonly<Record<M1ConnectionState, string>> = Object.freeze({
  disconnected: '未连接',
  connecting: '连接中',
  connected: '已连接',
})

const ACTIVITY_STATUS_LABELS: Readonly<Record<M1ActivityStatus, string>> = Object.freeze({
  queued: '排队中',
  running: '运行中',
  awaitingInput: '等待输入',
  interrupted: '已中断',
  succeeded: '已成功',
  failed: '已失败',
  cancelled: '已取消',
})

const QUESTION_REASON_LABELS: Readonly<Record<M1QuestionReason, string>> = Object.freeze({
  missing: '缺少信息',
  conflict: '信息冲突',
  ambiguousReference: '引用不明确',
})

const ELIGIBILITY_LABELS: Readonly<Record<M1SpacerDraftEligibilityVerdict, string>> = Object.freeze({
  eligible: '可创建隔套草稿',
  DRAFT_NOT_EMPTY: '当前草稿非空，不可直接创建',
  INVALID_REQUEST: '无效的草稿占用状态',
})

function projectAnchor(anchor: M1Anchor): M1AnchorPresentation {
  return Object.freeze({
    documentRef: anchor.documentRef,
    documentFingerprint: anchor.documentFingerprint,
    page: anchor.page,
    excerpt: anchor.excerpt,
    region: anchor.region === null ? null : Object.freeze({ ...anchor.region }),
  })
}

function projectQuestion(question: M1Question | null): M1QuestionPresentation | null {
  if (question === null) return null
  return Object.freeze({
    questionId: question.questionId,
    reason: question.reason,
    reasonLabel: QUESTION_REASON_LABELS[question.reason],
    prompt: question.prompt,
    anchors: Object.freeze(question.anchors.map(projectAnchor)),
  })
}

function projectSpacerSource(source: M1SpacerSource): M1SpacerSourcePresentation {
  if (source.type === 'userInput') {
    return Object.freeze({
      type: 'userInput',
      label: '用户输入',
      anchor: null,
    })
  }
  return Object.freeze({
    type: 'document',
    label: '文档摘录',
    anchor: projectAnchor(source.anchor),
  })
}

function projectSpacerDraft(draft: M1SpacerDraft): M1SpacerDraftPresentation {
  return Object.freeze({
    draftRevision: draft.draftRevision,
    innerDiameterQ: draft.innerDiameterQ,
    outerDiameterQ: draft.outerDiameterQ,
    lengthQ: draft.lengthQ,
    innerDiameterMm: formatMm(draft.innerDiameterQ),
    outerDiameterMm: formatMm(draft.outerDiameterQ),
    lengthMm: formatMm(draft.lengthQ),
    sources: Object.freeze({
      innerDiameterQ: projectSpacerSource(draft.sources.innerDiameterQ),
      outerDiameterQ: projectSpacerSource(draft.sources.outerDiameterQ),
      lengthQ: projectSpacerSource(draft.sources.lengthQ),
    }),
    question: projectQuestion(draft.question),
    formalSaveEnabled: M1_FORMAL_SAVE_ENABLED,
    productionApiConnected: M1_PRODUCTION_API_CONNECTED,
  })
}

function projectActivity(activity: M1Activity): M1ActivityPresentation {
  return Object.freeze({
    taskId: activity.taskId,
    projectId: activity.projectId,
    source: activity.source,
    baseRevision: activity.baseRevision,
    draftRevision: activity.draftRevision,
    status: activity.status,
    statusLabel: ACTIVITY_STATUS_LABELS[activity.status],
    lastStep: activity.lastStep,
    question: projectQuestion(activity.question),
    errorCode: activity.errorCode,
    updatedAtMs: activity.updatedAtMs,
  })
}

function projectConnection(connection: M1ConnectionState): M1ConnectionPresentation {
  return Object.freeze({
    state: connection,
    label: CONNECTION_LABELS[connection],
  })
}

function projectAuthorization(
  authorization: M1ContextFields['snapshot']['authorization'],
): M1AuthorizationPresentation {
  if (!authorization.authorized) {
    return Object.freeze({
      state: 'unauthorized',
      authorized: false,
      canWrite: false,
      label: '未授权',
    })
  }
  if (!authorization.canWrite) {
    return Object.freeze({
      state: 'authorized-readonly',
      authorized: true,
      canWrite: false,
      label: '已授权（只读）',
    })
  }
  return Object.freeze({
    state: 'authorized-writable',
    authorized: true,
    canWrite: true,
    label: '已授权（可写）',
  })
}

function projectWriter(
  writer: M1ContextFields['snapshot']['writer'],
): M1WriterOccupancyPresentation {
  return Object.freeze({
    occupied: writer.occupied,
    epoch: writer.epoch,
    label: writer.occupied ? '写入位已占用' : '写入位空闲',
  })
}

export function presentM1ActivityStatus(input: unknown): M1ActivityStatusPresentationResult {
  if (!isM1ActivityStatus(input)) {
    return Object.freeze({ ok: false, reason: 'INVALID_ACTIVITY_STATUS' })
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      status: input,
      label: ACTIVITY_STATUS_LABELS[input],
    }),
  })
}

export function presentM1Activity(input: unknown): M1ActivityPresentationResult {
  if (!isM1Activity(input)) {
    return Object.freeze({ ok: false, reason: 'INVALID_ACTIVITY' })
  }
  return Object.freeze({
    ok: true,
    value: projectActivity(input),
  })
}

export function presentM1SpacerDraft(input: unknown): M1SpacerDraftPresentationResult {
  if (!isM1SpacerDraft(input)) {
    return Object.freeze({ ok: false, reason: 'INVALID_SPACER_DRAFT' })
  }
  return Object.freeze({
    ok: true,
    value: projectSpacerDraft(input),
  })
}

export function presentM1CreateSpacerDraft(
  input: unknown,
): M1CreateSpacerDraftPresentationResult {
  if (!isM1CreateSpacerDraft(input)) {
    return Object.freeze({ ok: false, reason: 'INVALID_CREATE_SPACER_DRAFT' })
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      type: input.type,
      innerDiameterQ: input.innerDiameterQ,
      outerDiameterQ: input.outerDiameterQ,
      lengthQ: input.lengthQ,
      innerDiameterMm: formatMm(input.innerDiameterQ),
      outerDiameterMm: formatMm(input.outerDiameterQ),
      lengthMm: formatMm(input.lengthQ),
      formalSaveEnabled: M1_FORMAL_SAVE_ENABLED,
      productionApiConnected: M1_PRODUCTION_API_CONNECTED,
    }),
  })
}

export function presentM1Context(
  input: unknown,
  options?: M1PresentationOptions,
): M1ContextPresentationResult {
  if (!isM1ContextFields(input)) {
    return Object.freeze({
      ok: false,
      reason: 'INVALID_M1_CONTEXT',
      formalSaveEnabled: M1_FORMAL_SAVE_ENABLED,
      productionApiConnected: M1_PRODUCTION_API_CONNECTED,
    })
  }

  const synthetic = options?.synthetic ?? true
  const { snapshot, activities } = input

  return Object.freeze({
    ok: true,
    value: Object.freeze({
      projectId: snapshot.projectId,
      draftRevision: snapshot.draftRevision,
      cursor: snapshot.cursor,
      connection: projectConnection(snapshot.connection),
      authorization: projectAuthorization(snapshot.authorization),
      writer: projectWriter(snapshot.writer),
      spacerDraft: snapshot.spacerDraft === null ? null : projectSpacerDraft(snapshot.spacerDraft),
      activities: Object.freeze(activities.map(projectActivity)),
      formalSaveEnabled: M1_FORMAL_SAVE_ENABLED,
      productionApiConnected: M1_PRODUCTION_API_CONNECTED,
      synthetic,
      syntheticBadge: synthetic ? M1_SYNTHETIC_BADGE : null,
    }),
    formalSaveEnabled: M1_FORMAL_SAVE_ENABLED,
    productionApiConnected: M1_PRODUCTION_API_CONNECTED,
  })
}

export function presentM1SpacerDraftEligibility(
  occupancy: unknown,
): M1SpacerDraftEligibilityPresentation {
  const verdict = spacerDraftEligibility(occupancy)
  return Object.freeze({
    occupancy: isM1DraftOccupancy(occupancy) ? occupancy : null,
    verdict,
    eligible: verdict === 'eligible',
    label: ELIGIBILITY_LABELS[verdict],
    formalSaveEnabled: M1_FORMAL_SAVE_ENABLED,
    productionApiConnected: M1_PRODUCTION_API_CONNECTED,
  })
}

export function acceptM1EventPage(
  projectId: string,
  afterSequence: number,
  page: unknown,
): M1EventPageAcceptanceResult {
  if (
    typeof projectId !== 'string' ||
    projectId.trim().length === 0 ||
    !isM1EventPage(projectId, afterSequence)(page)
  ) {
    return Object.freeze({
      ok: false,
      reason: 'INVALID_EVENT_PAGE',
      nextConsumerCursor: null,
      advanced: false,
      productionApiConnected: M1_PRODUCTION_API_CONNECTED,
    })
  }

  const typedPage: M1EventPageFields = page
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      events: Object.freeze(
        typedPage.events.map((entry) =>
          Object.freeze({
            projectId: entry.projectId,
            sequence: entry.sequence,
          }),
        ),
      ),
      nextConsumerCursor: typedPage.nextCursor,
      highWatermark: typedPage.highWatermark,
      hasMoreEvents: typedPage.highWatermark > typedPage.nextCursor,
      advanced: typedPage.nextCursor > afterSequence,
    }),
    productionApiConnected: M1_PRODUCTION_API_CONNECTED,
  })
}

export function presentM1ReadRecovery(code: unknown): M1ReadRecoveryPresentationResult {
  if (!isM1ReadRecoveryCode(code)) {
    return Object.freeze({
      ok: false,
      reason: 'UNKNOWN_READ_RECOVERY_CODE',
      productionApiConnected: M1_PRODUCTION_API_CONNECTED,
    })
  }
  if (code === 'CURSOR_EXPIRED') {
    return Object.freeze({
      ok: true,
      code,
      action: 'refetchSnapshot',
      shouldRefetchSnapshot: true,
      shouldClearRestrictedView: false,
      skipGapsAllowed: false,
      replayFromStartAllowed: false,
      label: '事件游标已过期，需重新拉取快照（禁止跳过缺口或从头重放）',
      productionApiConnected: M1_PRODUCTION_API_CONNECTED,
    })
  }
  return Object.freeze({
    ok: true,
    code,
    action: 'requireAuthorization',
    shouldRefetchSnapshot: false,
    shouldClearRestrictedView: true,
    skipGapsAllowed: false,
    replayFromStartAllowed: false,
    label: '需要重新授权，已清空受限视图',
    productionApiConnected: M1_PRODUCTION_API_CONNECTED,
  })
}

export function presentM1WriterRejection(code: unknown): M1WriterRejectionPresentationResult {
  if (!isM1WriterRejectionCode(code)) {
    return Object.freeze({
      ok: false,
      reason: 'UNKNOWN_WRITER_REJECTION_CODE',
      productionApiConnected: M1_PRODUCTION_API_CONNECTED,
    })
  }
  if (code === 'AUTH_REQUIRED') {
    return Object.freeze({
      ok: true,
      code,
      category: 'authorization',
      label: '需要授权后才能获取写入位',
      productionApiConnected: M1_PRODUCTION_API_CONNECTED,
    })
  }
  if (code === 'WRITER_HELD') {
    return Object.freeze({
      ok: true,
      code,
      category: 'occupancy',
      label: '写入位已被占用',
      productionApiConnected: M1_PRODUCTION_API_CONNECTED,
    })
  }
  return Object.freeze({
    ok: true,
    code,
    category: 'occupancy',
    label: '写入位已失效',
    productionApiConnected: M1_PRODUCTION_API_CONNECTED,
  })
}
