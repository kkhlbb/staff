import { describe, expect, it } from 'vitest'
import { formatMm } from '../../../src/domain/units.ts'
import {
  M1_SYNTHETIC_FIXTURE_META,
  createSyntheticM1Activity,
  createSyntheticM1Anchor,
  createSyntheticM1ContextFields,
  createSyntheticM1ContextFixture,
  createSyntheticM1CreateSpacerDraft,
  createSyntheticM1Question,
  createSyntheticM1SpacerDraft,
} from './m1FieldFixtures.ts'
import {
  M1_FORMAL_SAVE_ENABLED,
  M1_PRODUCTION_API_CONNECTED,
  M1_SYNTHETIC_BADGE,
  acceptM1EventPage,
  presentM1Activity,
  presentM1ActivityStatus,
  presentM1Context,
  presentM1CreateSpacerDraft,
  presentM1ReadRecovery,
  presentM1SpacerDraft,
  presentM1SpacerDraftEligibility,
  presentM1WriterRejection,
} from './m1FieldPresentation.ts'
import type { M1ActivityStatus } from './m1FieldPresentation.ts'

describe('m1FieldPresentation', () => {
  describe('safety flags and synthetic marking', () => {
    it('keeps formalSaveEnabled and productionApiConnected literally false and marks synthetic presentations as 模拟', () => {
      expect(M1_FORMAL_SAVE_ENABLED).toBe(false)
      expect(M1_PRODUCTION_API_CONNECTED).toBe(false)
      expect(M1_SYNTHETIC_FIXTURE_META.synthetic).toBe(true)
      expect(M1_SYNTHETIC_FIXTURE_META.badge).toBe('模拟')

      const fixture = createSyntheticM1ContextFixture()
      expect(fixture.synthetic).toBe(true)
      expect(fixture.badge).toBe('模拟')
      expect(fixture.formalSaveEnabled).toBe(false)
      expect(fixture.productionApiConnected).toBe(false)

      const result = presentM1Context(fixture.data, { synthetic: fixture.synthetic })
      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(result.formalSaveEnabled).toBe(false)
      expect(result.productionApiConnected).toBe(false)
      expect(result.value.formalSaveEnabled).toBe(false)
      expect(result.value.productionApiConnected).toBe(false)
      expect(result.value.synthetic).toBe(true)
      expect(result.value.syntheticBadge).toBe(M1_SYNTHETIC_BADGE)
    })
  })

  describe('illegal context fail-closed', () => {
    it('rejects unauthorized + canWrite without returning mixed fields', () => {
      const illegal = createSyntheticM1ContextFields({
        snapshot: {
          authorization: { authorized: false, canWrite: true },
        },
      })
      const result = presentM1Context(illegal)
      expect(result).toEqual({
        ok: false,
        reason: 'INVALID_M1_CONTEXT',
        formalSaveEnabled: false,
        productionApiConnected: false,
      })
      expect('value' in result).toBe(false)
    })

    it('rejects extra keys, missing keys, empty text, and invalid shapes', () => {
      const base = createSyntheticM1ContextFields()

      const extraRootKey = { ...base, extra: true }
      const extraSnapshotKey = {
        ...base,
        snapshot: { ...base.snapshot, callerId: 'invented-caller' },
      }
      const missingSnapshotKey = {
        ...base,
        snapshot: {
          projectId: base.snapshot.projectId,
          draftRevision: base.snapshot.draftRevision,
          cursor: base.snapshot.cursor,
          connection: base.snapshot.connection,
          authorization: base.snapshot.authorization,
          spacerDraft: base.snapshot.spacerDraft,
        },
      }
      const emptyProjectId = createSyntheticM1ContextFields({
        snapshot: { projectId: '' },
      })
      const whitespaceLastStep = createSyntheticM1ContextFields({
        activities: [createSyntheticM1Activity({ lastStep: '   ' })],
      })
      const negativeCursor = createSyntheticM1ContextFields({
        snapshot: { cursor: -1 },
      })

      for (const candidate of [
        extraRootKey,
        extraSnapshotKey,
        missingSnapshotKey,
        emptyProjectId,
        whitespaceLastStep,
        negativeCursor,
        null,
        'invalid',
        42,
      ]) {
        const result = presentM1Context(candidate)
        expect(result.ok).toBe(false)
        expect(result.formalSaveEnabled).toBe(false)
        expect(result.productionApiConnected).toBe(false)
      }
    })
  })

  describe('cross-project and draft revision checks', () => {
    it('rejects activity with a different projectId than snapshot.projectId', () => {
      const mixedProject = createSyntheticM1ContextFields({
        snapshot: { projectId: 'proj-alpha' },
        activities: [
          createSyntheticM1Activity({ projectId: 'proj-alpha', taskId: 'task-1' }),
          createSyntheticM1Activity({ projectId: 'proj-beta', taskId: 'task-2' }),
        ],
      })
      const result = presentM1Context(mixedProject)
      expect(result.ok).toBe(false)
    })

    it('rejects spacerDraft.draftRevision !== snapshot.draftRevision', () => {
      const mismatch = createSyntheticM1ContextFields({
        snapshot: {
          draftRevision: 'draft-rev-2',
          spacerDraft: createSyntheticM1SpacerDraft({ draftRevision: 'draft-rev-1' }),
        },
      })
      expect(presentM1Context(mismatch).ok).toBe(false)

      const nullSnapshotRevWithDraft = createSyntheticM1ContextFields({
        snapshot: {
          draftRevision: null,
          spacerDraft: createSyntheticM1SpacerDraft({ draftRevision: 'draft-rev-1' }),
        },
      })
      expect(presentM1Context(nullSnapshotRevWithDraft).ok).toBe(false)
    })

    it('allows activity.draftRevision to differ from snapshot.draftRevision', () => {
      const context = createSyntheticM1ContextFields({
        snapshot: {
          draftRevision: 'draft-rev-2',
          spacerDraft: createSyntheticM1SpacerDraft({ draftRevision: 'draft-rev-2' }),
        },
        activities: [
          createSyntheticM1Activity({ draftRevision: 'draft-rev-1', taskId: 'task-old' }),
          createSyntheticM1Activity({ draftRevision: null, taskId: 'task-null' }),
        ],
      })
      const result = presentM1Context(context)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(result.value.draftRevision).toBe('draft-rev-2')
      expect(result.value.activities.map((a) => a.draftRevision)).toEqual(['draft-rev-1', null])
    })
  })

  describe('independent connection, authorization, and writer projections', () => {
    it('keeps connected + unauthorized + unoccupied independent', () => {
      const context = createSyntheticM1ContextFields({
        snapshot: {
          connection: 'connected',
          authorization: { authorized: false, canWrite: false },
          writer: { epoch: 0, occupied: false },
        },
      })
      const result = presentM1Context(context)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(result.value.connection).toEqual({ state: 'connected', label: '已连接' })
      expect(result.value.authorization).toEqual({
        state: 'unauthorized',
        authorized: false,
        canWrite: false,
        label: '未授权',
      })
      expect(result.value.writer).toEqual({
        occupied: false,
        epoch: 0,
        label: '写入位空闲',
      })
      expect('callerId' in result.value.writer).toBe(false)
    })

    it('keeps disconnected + authorized-readonly + occupied independent', () => {
      const context = createSyntheticM1ContextFields({
        snapshot: {
          connection: 'disconnected',
          authorization: { authorized: true, canWrite: false },
          writer: { epoch: 5, occupied: true },
        },
      })
      const result = presentM1Context(context)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(result.value.connection).toEqual({ state: 'disconnected', label: '未连接' })
      expect(result.value.authorization).toEqual({
        state: 'authorized-readonly',
        authorized: true,
        canWrite: false,
        label: '已授权（只读）',
      })
      expect(result.value.writer).toEqual({
        occupied: true,
        epoch: 5,
        label: '写入位已占用',
      })
    })

    it('keeps connecting + authorized-writable independent', () => {
      const context = createSyntheticM1ContextFields({
        snapshot: {
          connection: 'connecting',
          authorization: { authorized: true, canWrite: true },
          writer: { epoch: 3, occupied: false },
        },
      })
      const result = presentM1Context(context)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(result.value.connection).toEqual({ state: 'connecting', label: '连接中' })
      expect(result.value.authorization.state).toBe('authorized-writable')
      expect(result.value.writer.occupied).toBe(false)
    })
  })

  describe('all seven activity statuses', () => {
    const cases: readonly (readonly [M1ActivityStatus, string])[] = [
      ['queued', '排队中'],
      ['running', '运行中'],
      ['awaitingInput', '等待输入'],
      ['interrupted', '已中断'],
      ['succeeded', '已成功'],
      ['failed', '已失败'],
      ['cancelled', '已取消'],
    ]

    it.each(cases)('maps status %s to %s while preserving raw status', (status, expectedLabel) => {
      const statusResult = presentM1ActivityStatus(status)
      expect(statusResult).toEqual({
        ok: true,
        value: { status, label: expectedLabel },
      })

      const activityResult = presentM1Activity(createSyntheticM1Activity({ status }))
      expect(activityResult.ok).toBe(true)
      if (!activityResult.ok) return
      expect(activityResult.value.status).toBe(status)
      expect(activityResult.value.statusLabel).toBe(expectedLabel)

      const contextResult = presentM1Context(
        createSyntheticM1ContextFields({
          activities: [createSyntheticM1Activity({ status })],
        }),
      )
      expect(contextResult.ok).toBe(true)
      if (!contextResult.ok) return
      expect(contextResult.value.activities[0]?.status).toBe(status)
      expect(contextResult.value.activities[0]?.statusLabel).toBe(expectedLabel)
    })

    it('fails closed for unknown activity statuses', () => {
      expect(presentM1ActivityStatus('paused')).toEqual({
        ok: false,
        reason: 'INVALID_ACTIVITY_STATUS',
      })
      expect(presentM1Activity({ ...createSyntheticM1Activity(), status: 'paused' })).toEqual({
        ok: false,
        reason: 'INVALID_ACTIVITY',
      })
    })
  })

  describe('explicit nullable fields and spacer projection', () => {
    it('presents explicit nulls for draftRevision, spacerDraft, baseRevision, lastStep, question, errorCode, and region', () => {
      const emptyDraftContext = createSyntheticM1ContextFields({
        snapshot: {
          draftRevision: null,
          spacerDraft: null,
        },
        activities: [
          createSyntheticM1Activity({
            baseRevision: null,
            draftRevision: null,
            lastStep: null,
            question: null,
            errorCode: null,
          }),
        ],
      })

      const result = presentM1Context(emptyDraftContext)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(result.value.draftRevision).toBeNull()
      expect(result.value.spacerDraft).toBeNull()
      const activity = result.value.activities[0]
      expect(activity?.baseRevision).toBeNull()
      expect(activity?.draftRevision).toBeNull()
      expect(activity?.lastStep).toBeNull()
      expect(activity?.question).toBeNull()
      expect(activity?.errorCode).toBeNull()
    })

    it('maps spacer q values via formatMm, document/userInput sources, and nullable question/region', () => {
      const draft = createSyntheticM1SpacerDraft({
        innerDiameterQ: 200000,
        outerDiameterQ: 320000,
        lengthQ: 150000,
        question: createSyntheticM1Question({
          reason: 'ambiguousReference',
          anchors: [createSyntheticM1Anchor({ region: null })],
        }),
      })
      const result = presentM1SpacerDraft(draft)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(result.value.innerDiameterQ).toBe(200000)
      expect(result.value.outerDiameterQ).toBe(320000)
      expect(result.value.lengthQ).toBe(150000)
      expect(result.value.innerDiameterMm).toBe(formatMm(200000))
      expect(result.value.outerDiameterMm).toBe(formatMm(320000))
      expect(result.value.lengthMm).toBe(formatMm(150000))
      expect(result.value.sources.innerDiameterQ).toEqual({
        type: 'userInput',
        label: '用户输入',
        anchor: null,
      })
      expect(result.value.sources.outerDiameterQ.type).toBe('document')
      expect(result.value.sources.outerDiameterQ.anchor?.region).not.toBeNull()
      expect(result.value.sources.lengthQ.anchor?.region).toBeNull()
      expect(result.value.question?.reason).toBe('ambiguousReference')
      expect(result.value.question?.reasonLabel).toBe('引用不明确')
      expect(result.value.question?.anchors[0]?.region).toBeNull()
      expect(result.value.formalSaveEnabled).toBe(false)
      expect(result.value.productionApiConnected).toBe(false)
    })

    it('rejects empty string in nullable text fields', () => {
      const emptyErrorCode = createSyntheticM1Activity({ errorCode: '' })
      const emptyBaseRevision = createSyntheticM1Activity({ baseRevision: '' })
      const emptyDraftRevision = createSyntheticM1Activity({ draftRevision: '' })
      expect(presentM1Activity(emptyErrorCode).ok).toBe(false)
      expect(presentM1Activity(emptyBaseRevision).ok).toBe(false)
      expect(presentM1Activity(emptyDraftRevision).ok).toBe(false)
    })

    it('validates and formats createSpacerDraft fields', () => {
      const valid = presentM1CreateSpacerDraft(createSyntheticM1CreateSpacerDraft())
      expect(valid.ok).toBe(true)
      if (valid.ok) {
        expect(valid.value.innerDiameterMm).toBe(formatMm(200000))
        expect(valid.value.outerDiameterMm).toBe(formatMm(320000))
        expect(valid.value.lengthMm).toBe(formatMm(150000))
        expect(valid.value.formalSaveEnabled).toBe(false)
        expect(valid.value.productionApiConnected).toBe(false)
      }

      const invertedDiameters = presentM1CreateSpacerDraft(
        createSyntheticM1CreateSpacerDraft({
          innerDiameterQ: 320000,
          outerDiameterQ: 200000,
        }),
      )
      expect(invertedDiameters.ok).toBe(false)
    })
  })

  describe('event page cursor acceptance', () => {
    it('keeps nextConsumerCursor equal to afterSequence on a valid empty page', () => {
      const result = acceptM1EventPage('proj-alpha', 10, {
        events: [],
        nextCursor: 10,
        highWatermark: 10,
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.nextConsumerCursor).toBe(10)
      expect(result.value.advanced).toBe(false)
      expect(result.value.hasMoreEvents).toBe(false)
    })

    it('advances only to page.nextCursor and never to highWatermark when more events exist', () => {
      const result = acceptM1EventPage('proj-alpha', 10, {
        events: [
          { projectId: 'proj-alpha', sequence: 11 },
          { projectId: 'proj-alpha', sequence: 12 },
        ],
        nextCursor: 12,
        highWatermark: 25,
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.nextConsumerCursor).toBe(12)
      expect(result.value.nextConsumerCursor).not.toBe(25)
      expect(result.value.highWatermark).toBe(25)
      expect(result.value.hasMoreEvents).toBe(true)
      expect(result.value.advanced).toBe(true)
    })

    it('refuses to advance on inclusive sequence, gaps, wrong project, wrong nextCursor, or highWatermark < nextCursor', () => {
      const invalidPages = [
        // inclusive sequence (10 === afterSequence)
        {
          events: [{ projectId: 'proj-alpha', sequence: 10 }],
          nextCursor: 11,
          highWatermark: 11,
        },
        // gap in sequence
        {
          events: [
            { projectId: 'proj-alpha', sequence: 11 },
            { projectId: 'proj-alpha', sequence: 13 },
          ],
          nextCursor: 12,
          highWatermark: 13,
        },
        // non-contiguous / reversed
        {
          events: [
            { projectId: 'proj-alpha', sequence: 12 },
            { projectId: 'proj-alpha', sequence: 11 },
          ],
          nextCursor: 12,
          highWatermark: 12,
        },
        // wrong projectId
        {
          events: [{ projectId: 'proj-other', sequence: 11 }],
          nextCursor: 11,
          highWatermark: 11,
        },
        // empty page trying to advance nextCursor
        {
          events: [],
          nextCursor: 11,
          highWatermark: 11,
        },
        // non-empty page with wrong nextCursor
        {
          events: [{ projectId: 'proj-alpha', sequence: 11 }],
          nextCursor: 12,
          highWatermark: 12,
        },
        // highWatermark < nextCursor
        {
          events: [{ projectId: 'proj-alpha', sequence: 11 }],
          nextCursor: 11,
          highWatermark: 10,
        },
      ]

      for (const page of invalidPages) {
        const result = acceptM1EventPage('proj-alpha', 10, page)
        expect(result).toEqual({
          ok: false,
          reason: 'INVALID_EVENT_PAGE',
          nextConsumerCursor: null,
          advanced: false,
          productionApiConnected: false,
        })
      }

      expect(
        acceptM1EventPage('', 10, { events: [], nextCursor: 10, highWatermark: 10 }).ok,
      ).toBe(false)
    })
  })

  describe('spacer draft eligibility field-layer verdict', () => {
    it('maps emptyProject and emptyDraft to eligible, nonEmpty to DRAFT_NOT_EMPTY, and garbage to INVALID_REQUEST', () => {
      expect(presentM1SpacerDraftEligibility('emptyProject')).toMatchObject({
        occupancy: 'emptyProject',
        verdict: 'eligible',
        eligible: true,
        formalSaveEnabled: false,
        productionApiConnected: false,
      })
      expect(presentM1SpacerDraftEligibility('emptyDraft')).toMatchObject({
        occupancy: 'emptyDraft',
        verdict: 'eligible',
        eligible: true,
      })
      expect(presentM1SpacerDraftEligibility('nonEmpty')).toMatchObject({
        occupancy: 'nonEmpty',
        verdict: 'DRAFT_NOT_EMPTY',
        eligible: false,
      })
      for (const garbage of ['unknown', '', null, 123, {}]) {
        expect(presentM1SpacerDraftEligibility(garbage)).toMatchObject({
          occupancy: null,
          verdict: 'INVALID_REQUEST',
          eligible: false,
        })
      }
    })
  })

  describe('read recovery and writer rejection hints', () => {
    it('maps CURSOR_EXPIRED to refetchSnapshot without skipping gaps or replaying from start', () => {
      const result = presentM1ReadRecovery('CURSOR_EXPIRED')
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.code).toBe('CURSOR_EXPIRED')
      expect(result.action).toBe('refetchSnapshot')
      expect(result.shouldRefetchSnapshot).toBe(true)
      expect(result.shouldClearRestrictedView).toBe(false)
      expect(result.skipGapsAllowed).toBe(false)
      expect(result.replayFromStartAllowed).toBe(false)
      expect(result.productionApiConnected).toBe(false)
    })

    it('maps AUTH_REQUIRED to requireAuthorization and clearing restricted view', () => {
      const result = presentM1ReadRecovery('AUTH_REQUIRED')
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.code).toBe('AUTH_REQUIRED')
      expect(result.action).toBe('requireAuthorization')
      expect(result.shouldRefetchSnapshot).toBe(false)
      expect(result.shouldClearRestrictedView).toBe(true)
      expect(result.productionApiConnected).toBe(false)
    })

    it('fails closed on unknown read recovery or writer rejection codes', () => {
      expect(presentM1ReadRecovery('OTHER')).toEqual({
        ok: false,
        reason: 'UNKNOWN_READ_RECOVERY_CODE',
        productionApiConnected: false,
      })
      expect(presentM1WriterRejection('OTHER')).toEqual({
        ok: false,
        reason: 'UNKNOWN_WRITER_REJECTION_CODE',
        productionApiConnected: false,
      })
    })

    it('maps WRITER_HELD, WRITER_REVOKED, and AUTH_REQUIRED writer rejections', () => {
      expect(presentM1WriterRejection('WRITER_HELD')).toMatchObject({
        ok: true,
        code: 'WRITER_HELD',
        category: 'occupancy',
        productionApiConnected: false,
      })
      expect(presentM1WriterRejection('WRITER_REVOKED')).toMatchObject({
        ok: true,
        code: 'WRITER_REVOKED',
        category: 'occupancy',
        productionApiConnected: false,
      })
      expect(presentM1WriterRejection('AUTH_REQUIRED')).toMatchObject({
        ok: true,
        code: 'AUTH_REQUIRED',
        category: 'authorization',
        productionApiConnected: false,
      })
    })
  })
})
