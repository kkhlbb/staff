// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CunlianApi, ProjectOpenValue, MenuActionPayload, EditorFlushRequest } from '../../desktop/shared/contracts'
import { createSampleSnapshot } from '../project-file/__fixtures__/sampleProjectFile'
import { createModelSnapshot, sampleStlTriangle, MODEL_PART_ID, MODEL_REVISION_ID } from '../project-file/__fixtures__/modelProjectFile'
import { createSpacerSnapshot } from '../project-file/__fixtures__/spacerProjectFile'
import { createRequirementProject, createTwoVersionRequirementProject } from '../requirements/__fixtures__/requirementFixture'
import { toSnapshotDto, decodeProjectFile, encodeProjectFile } from '../project-file/codec'
import { DesktopWorkspace } from './DesktopWorkspace'
import { expectNoUiInternalIds, UI_REVISION_ID, UI_HEX_ID } from '../test/uiIdGuard'

it('UI-ID guard: 主工作台与图纸面板真实输出不泄漏身份', async () => {
  opened.snapshot = await createSpacerSnapshot()
  const old = opened.snapshot.project.currentRevisionId
  opened.snapshot.project.currentRevisionId = UI_REVISION_ID

  opened.snapshot.fileRevisions.forEach(rev => { if (rev.revisionId === old) rev.revisionId = UI_REVISION_ID })
  render(<DesktopWorkspace />)
  await waitFor(() => expect(screen.getByRole('button', { name: '打开内置示例 · 尺寸链示例（A）' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '打开内置示例 · 尺寸链示例（A）' }))
  const workbench = await screen.findByRole('main', { name: '寸链桌面工作台' })
  expect(within(workbench).getByRole('heading', { name: /寸链 ·/ })).toBeInTheDocument()
  expectNoUiInternalIds(workbench)
  const drawing = screen.getByRole('tabpanel', { name: '工程图' })
  expect(drawing.textContent).toContain('隔套')
  expectNoUiInternalIds(drawing)
})

it('UI-ID guard: 启动项目列表不显示内部版本', async () => {
  vi.mocked(api.listRecent).mockResolvedValue({ ok: true, value: { items: [{ recentId: UI_HEX_ID, projectId: UI_HEX_ID, name: '守卫项目', path: '/guard.cunlian', rev: UI_REVISION_ID, missing: false, lastOpenedAt: '2026-11-09T08:00:00Z' }] } })
  render(<DesktopWorkspace />)
  await screen.findByText('守卫项目')
  expectNoUiInternalIds(screen.getByRole('main', { name: '寸链启动页' }))
})
import { buildSpacerDrawing } from '../drawing/spacerDrawing'
import { parseSpacerParameters } from '../parts/spacerParameters'
import type { ProjectFileDrawingRecord } from '../project-file/types'
import { computeChange } from '../revisions/compute'
import { buildCommitCandidate } from '../revisions/commit'
import { deriveReviewGroups } from '../revisions/status'
import { computeCandidateRequirementCheck } from '../requirements/check'
import { confirmCandidate, rejectCandidate } from '../document-extraction/draft'
import type { ExtractionDraft } from '../document-extraction/types'
import { buildSyntheticExtractionDraft } from '../document-extraction/__fixtures__/draftFixture'

// 3D 场景在 jsdom 里没有 WebGL2：用伪场景模块替换，只验证接线与命令调用。
const scene = vi.hoisted(() => ({
  options: [] as Record<string, unknown>[],
  handles: [] as Record<string, unknown>[],
  spacerDimensions: [] as unknown[],
}))
vi.mock('../parts/threeScene', () => ({
  createDemoScene: (options: Record<string, unknown>) => {
    const handle: Record<string, unknown> = {
      probe: { webgl: 'webgl2', glVersion: 'WebGL 2.0 (Mock)', glRenderer: 'Mock GPU', glVendor: 'Mock', antialias: true, dpr: 2 },
      selected: null,
      explode: 0,
      active: true,
      disposed: false,
      setSelectedPartId: (id: string | null) => { handle.selected = id },
      setSpacerDimensions: (spacer: unknown) => { scene.spacerDimensions.push(spacer) },
      spacerLengthMm: () => 12,
      setExplodeT: (t: number) => { handle.explode = t },
      setActive: (value: boolean) => { handle.active = value },
      resetView: () => undefined,
      zoomBy: () => undefined,
      frameCount: () => 0,
      getView: () => ({ position: [0, 0, 0], target: [0, 0, 0], zoom: 1 }),
      dispose: () => { handle.disposed = true },
    }
    scene.options.push(options)
    scene.handles.push(handle)
    return handle
  },
}))

// 导入模型的场景同样需要 WebGL2：用伪模块验证接线与命令，不冒充真渲染。
const modelScene = vi.hoisted(() => ({
  handles: [] as Record<string, unknown>[],
  options: [] as Record<string, unknown>[],
}))
vi.mock('../parts/modelScene', () => ({
  createModelScene: (options: Record<string, unknown>) => {
    const handle: Record<string, unknown> = {
      probe: { webgl: 'webgl2', glVersion: 'WebGL 2.0 (Mock)', glRenderer: 'Mock GPU', dpr: 2 },
      selected: Boolean(options.selected),
      active: true,
      disposed: false,
      frames: 0,
      setSelected: (value: boolean) => { handle.selected = value },
      setActive: (value: boolean) => { handle.active = value },
      resetView: () => undefined,
      zoomBy: () => undefined,
      getView: () => ({ position: [0, 0, 0], target: [0, 0, 0], zoom: 1 }),
      frameCount: () => handle.frames,
      dispose: () => { handle.disposed = true },
    }
    modelScene.handles.push(handle)
    modelScene.options.push(options)
    return handle
  },
}))

let menu: (payload: MenuActionPayload) => void
let flush: (payload: EditorFlushRequest) => void
let opened: ProjectOpenValue
let api: CunlianApi
let drawingSnapshot: ProjectOpenValue['snapshot'] | null = null
let changeDraft: import('../../desktop/shared/contracts').ChangeDraftValue | null = null
const failure = { ok: false as const, error: { code: 'NO_SPACE' as const, message: '磁盘空间不足' } }
beforeEach(async () => {
  opened = { sessionId: 'session-1', editSeq: 0, snapshot: await createSampleSnapshot(), path: null, fingerprint: null, warnings: [] }
  drawingSnapshot = null
  changeDraft = null
  api = {
    getProjectContext: vi.fn(async () => ({ ok: false as const, code: 'TOOL_FAILED' as const, message: '此 UI 用例不调用 Agent', requestId: 'mock-tool', objectVersion: 'mock' })),
    getConfirmedInputs: vi.fn(async () => ({ ok: false as const, code: 'TOOL_FAILED' as const, message: '此 UI 用例不调用 Agent', requestId: 'mock-tool', objectVersion: 'mock' })),
    applyConfirmedInputs: vi.fn(async () => ({ ok: false as const, code: 'TOOL_FAILED' as const, message: '此 UI 用例不调用 Agent', requestId: 'mock-tool', objectVersion: 'mock' })),
    stageParameterChange: vi.fn(async () => ({ ok: false as const, code: 'TOOL_FAILED' as const, message: '此 UI 用例不调用 Agent', requestId: 'mock-tool', objectVersion: 'mock' })),
    previewAndCheck: vi.fn(async () => ({ ok: false as const, code: 'TOOL_FAILED' as const, message: '此 UI 用例不调用 Agent', requestId: 'mock-tool', objectVersion: 'mock' })),
    // V4 阶段 3：侧栏存在时的最小桥；本文件不驱动演示任务。
    agentStart: vi.fn(async () => ({ ok: false as const, code: 'INVALID_INPUT' as const, message: '此 UI 用例不启动 Agent', requestId: 'mock-agent', objectVersion: 'mock' })),
    agentCancel: vi.fn(async () => ({ ok: false as const, code: 'INVALID_INPUT' as const, message: '无任务', requestId: 'mock-agent', objectVersion: 'mock' })),
    agentResume: vi.fn(async () => ({ ok: false as const, code: 'INVALID_INPUT' as const, message: '无任务', requestId: 'mock-agent', objectVersion: 'mock' })),
    agentTaskState: vi.fn(async () => ({ ok: false as const, code: 'INVALID_INPUT' as const, message: '无任务', requestId: 'mock-agent', objectVersion: 'mock' })),
    agentProviderStatus: vi.fn(async () => ({ ok: true as const, data: { real: { configured: false, provider: null }, demo: { available: true as const, modelId: 'fake-1' as const, label: '离线演示（假模型，不联网）' } }, requestId: 'mock-agent', objectVersion: 'n/a' })),
    agentPreviewSummary: vi.fn(async () => ({ ok: true as const, data: null, requestId: 'mock-agent', objectVersion: 'n/a' })),
    issueAgentApproval: vi.fn(async () => ({ ok: false as const, code: 'NOT_CONFIRMED' as const, message: '无预览', requestId: 'mock-agent', objectVersion: 'mock' })),
    commitApprovedDraft: vi.fn(async () => ({ ok: false as const, code: 'INVALID_INPUT' as const, message: '无授权', requestId: 'mock-agent', objectVersion: 'mock' })),
    locateEvidence: vi.fn(async () => ({ ok: false as const, code: 'INVALID_INPUT' as const, message: '无证据', requestId: 'mock-agent', objectVersion: 'mock' })),
    onAgentEvent: vi.fn(() => () => undefined),
    newProject: vi.fn(async () => ({ ok: true as const, value: opened })),
    openProject: vi.fn(async () => ({ ok: true as const, value: opened })),
    saveProject: vi.fn(async () => ({ ok: true as const, value: { path: '/project.cunlian', fingerprint: 'hash', savedSeq: 0, warnings: [] } })),
    saveProjectAs: vi.fn(async () => ({ ok: true as const, value: { path: '/copy.cunlian', fingerprint: 'hash-copy', savedSeq: 0, warnings: [] } })),
    stageDraft: vi.fn<CunlianApi['stageDraft']>(async request => ({ ok: true as const, value: { acceptedSeq: request.editSeq, recovery: 'pending' } })),
    listRecent: vi.fn(async () => ({ ok: true as const, value: { items: [{ recentId: 'recent-1', projectId: 'project-a', name: '失效项目', path: '/missing.cunlian', missing: true, lastOpenedAt: '2026-11-09T08:00:00Z' }] } })),
    relinkRecent: vi.fn(async () => ({ ok: false as const, error: { code: 'CANCELLED' as const, message: '取消' } })),
    listRecovery: vi.fn(async () => ({ ok: true as const, value: { items: [{ recoveryId: 'draft-1', projectId: 'project-a', name: '恢复项目', basePath: null, baseFingerprint: null, savedAt: '2026-11-09T08:00:00Z', editSeq: 1 }] } })),
    restoreRecovery: vi.fn(async () => ({ ok: true as const, value: opened })),
    reattachSession: vi.fn<CunlianApi['reattachSession']>(async () => ({ ok: true as const, value: { session: null } })),
    readAttachment: vi.fn(async () => ({ ok: false as const, error: { code: 'NOT_FOUND' as const, message: '附件未提供' } })),
    revealProject: vi.fn(async () => ({ ok: false as const, error: { code: 'NOT_FOUND' as const, message: '尚未保存' } })),
    requestClose: vi.fn(async () => ({ ok: false as const, error: { code: 'CANCELLED' as const, message: '取消' } })),
    inspectV2: vi.fn(async () => ({ ok: true as const, value: { importToken: 'token', projects: [{ id: 'project-a', name: '迁移项目', attachmentCount: 1, missingItems: 0 }], warnings: ['来源仍需复核'] } })),
    commitV2: vi.fn(async () => ({ ok: true as const, value: { ...opened, path: '/import.cunlian' } })),
    onMenuAction: vi.fn(listener => { menu = listener; return vi.fn() }),
    onEditorFlush: vi.fn(listener => { flush = listener; return vi.fn() }),
    respondEditorFlush: vi.fn(),
    // B2 新增：默认未选择/无模型，既有用例行为不变。
    pickModel: vi.fn(async () => ({ ok: false as const, error: { code: 'CANCELLED' as const, message: '取消' } })),
    readModel: vi.fn(async () => ({ ok: false as const, error: { code: 'CANDIDATE_EXPIRED' as const, message: '无候选' } })),
    commitModel: vi.fn(async () => ({ ok: false as const, error: { code: 'STALE_EDIT' as const, message: '无候选' } })),
    releaseModel: vi.fn(async () => ({ ok: true as const, value: { released: false } })),
    linkModel: vi.fn(async () => ({ ok: false as const, error: { code: 'MISSING_REFERENCE' as const, message: '无模型' } })),
    // C 新增：用同一生成器构造权威返回，验证预览/参数接线。
    updateSpacerDrawing: vi.fn<CunlianApi['updateSpacerDrawing']>(async request => {
      const parsed = parseSpacerParameters(request.inputs)
      if (!parsed.ok) {
        return { ok: false as const, error: { code: 'INVALID_PARAMETER' as const, message: parsed.message, detail: `${parsed.field}/${parsed.reason}` } }
      }
      const base = drawingSnapshot ?? opened.snapshot
      try {
        const drawing = buildSpacerDrawing({
          projectId: base.project.id,
          revisionId: base.project.currentRevisionId,
          drawingId: `drawing:${base.project.id}:spacer`,
          parameters: parsed.parameters,
          scale: request.scale,
          frameFields: request.frameFields,
        })
        const record: ProjectFileDrawingRecord = {
          drawingId: drawing.drawingId,
          drawingDataVersion: 1,
          templateId: drawing.templateId,
          templateVersion: drawing.templateVersion,
          partId: drawing.partId,
          revisionId: drawing.revisionId,
          parameterIds: drawing.parameterSnapshot.map(item => item.parameterId),
          paper: drawing.paper,
          scale: drawing.scale,
          frameFields: request.frameFields,
          status: 'pending-review-draft',
          dataFingerprint: drawing.fingerprint,
        }
        const snapshot: ProjectOpenValue['snapshot'] = {
          ...base,
          project: { ...base.project, parameters: parsed.parameters.map(item => ({ ...item, parameterRevision: 1 })), drawings: [record] },
        }
        drawingSnapshot = snapshot
        return {
          ok: true as const,
          value: {
            acceptedSeq: request.baseEditSeq + 1,
            drawingId: record.drawingId,
            drawingFingerprint: drawing.fingerprint,
            drawingData: drawing,
            snapshot,
            recovery: 'pending' as const,
          },
        }
      } catch (error) {
        return { ok: false as const, error: { code: 'DRAWING_OVERFLOW' as const, message: error instanceof Error ? error.message : String(error) } }
      }
    }),
    exportDrawingPdf: vi.fn(async () => ({ ok: false as const, error: { code: 'CANCELLED' as const, message: '取消' } })),
    exportDrawingSvg: vi.fn(async () => ({ ok: false as const, error: { code: 'CANCELLED' as const, message: '取消' } })),
    exportDrawingDxfR12: vi.fn(async () => ({ ok: false as const, error: { code: 'CANCELLED' as const, message: '取消' } })),
    exportDrawingDxf2000: vi.fn(async () => ({ ok: false as const, error: { code: 'CANCELLED' as const, message: '取消' } })),
    stepExport: vi.fn(async () => ({ ok: false as const, error: { code: 'CANCELLED' as const, message: '取消' } })),
    stepCancel: vi.fn(async () => ({ ok: true as const, value: { cancelled: false } })),
    openDxf: vi.fn(async () => ({ ok: false as const, error: { code: 'CANCELLED' as const, message: '取消' } })),
    takePendingDxf: vi.fn(async () => ({ ok: true as const, value: null })),
    // D 新增：与真实契约同形状；只证明接线，不替代 main 原子性验收。
    stageChangeDraft: vi.fn<CunlianApi['stageChangeDraft']>(async request => {
      const parsed = parseSpacerParameters(request.inputs, request.sourceNotes)
      if (!parsed.ok) {
        return { ok: false as const, error: { code: 'INVALID_PARAMETER' as const, message: parsed.message } }
      }
      const base = drawingSnapshot ?? opened.snapshot
      const formal = new Map(base.project.parameters.map(item => [item.key, item]))
      const parameters = parsed.parameters.map(item => ({
        ...item,
        parameterRevision: formal.get(item.key) ? (formal.get(item.key)!.valueQ === item.valueQ ? formal.get(item.key)!.parameterRevision : formal.get(item.key)!.parameterRevision + 1) : 1,
      }))
      const bindings = base.project.dimensionLinks.filter((link): link is import('../project-file/types').ProjectFileParameterBindingLink => link.kind === 'parameter-binding').map(link => ({ ...link }))
      changeDraft = {
        draftId: 'draft-mock-1',
        draftRevision: (changeDraft?.draftRevision ?? 0) + 1,
        baseToken: 'a'.repeat(16),
        draftToken: 'b'.repeat(16),
        parameters,
        bindings,
        confirmationCleared: false,
      }
      return { ok: true as const, value: changeDraft }
    }),
    previewChange: vi.fn<CunlianApi['previewChange']>(async request => {
      if (changeDraft === null || request.draftToken !== changeDraft.draftToken || request.baseToken !== changeDraft.baseToken) {
        return { ok: false as const, error: { code: 'STALE_BASE' as const, message: '基准已变化，预览已过期，请重新预览' } }
      }
      const base = drawingSnapshot ?? opened.snapshot
      try {
        const fullSnapshot = {
          ...base,
          // SnapshotDto 不携带附件字节；mock 用 blob 键合成可读附件，供条款来源检查。
          attachments: base.blobs.map(blob => ({ blobKey: blob.blobKey, bytes: new Uint8Array(1) })),
        } as unknown as import('../project-file/types').ProjectFileSnapshot
        const computation = computeChange(
          fullSnapshot,
          { parameters: changeDraft.parameters, bindings: changeDraft.bindings },
          { revisionId: 'rev-d-mock-1', now: '2026-11-09T10:00:00.000Z' },
        )
        const groups = deriveReviewGroups(base.project, {
          computation,
          availableBlobKeys: new Set(base.blobs.map(blob => blob.blobKey)),
          documents: base.documents,
          revisions: base.revisions,
          sourceBindings: base.bindings,
        })
        let requirement: import('../../desktop/shared/contracts').ChangePreviewValue['requirement'] = null
        const activeRequirementId = base.project.activeRequirementRevisionId
        if (activeRequirementId !== null) {
          const checked = await computeCandidateRequirementCheck({
            snapshot: fullSnapshot,
            requirementRevisions: base.project.requirementRevisions,
            activeRequirementRevisionId: activeRequirementId,
            pendingEdit: null,
            draft: {
              draftId: changeDraft.draftId,
              draftRevision: changeDraft.draftRevision,
              parameters: changeDraft.parameters,
              bindings: changeDraft.bindings,
            },
            checkedAt: '2026-11-09T10:00:00.000Z',
            checkId: 'check-preview-mock',
            inputIssue: null,
          })
          if (!checked.ok) throw new Error(checked.error.message)
          requirement = {
            check: checked.value.check,
            evaluation: checked.value.evaluation,
            revision: base.project.requirementRevisions.find(
              item => item.revisionId === activeRequirementId,
            ) ?? null,
            originalTargetResult: checked.value.originalTargetResult,
            requirementResult: checked.value.requirementResult,
          }
        }
        return {
          ok: true as const,
          value: {
            previewId: 'preview-mock-1',
            previewToken: 'c'.repeat(16),
            baseToken: request.baseToken,
            draftToken: request.draftToken,
            revisionId: 'rev-d-mock-1',
            parameters: computation.parameters,
            previousChain: computation.previousChain,
            chain: computation.chain,
            previousResult: computation.previousResult,
            result: computation.result,
            parameterDiffs: computation.parameterDiffs,
            termDiffs: computation.termDiffs,
            affectedTermIds: computation.affectedTermIds,
            unboundTermIds: computation.unboundTermIds,
            drawing: {
              record: computation.drawing.record,
              left: computation.drawing.previousData,
              right: computation.drawing.data,
              leftProblem: computation.drawing.previousProblem,
            },
            review: {
              rulesVersion: '1.0.0',
              findings: [],
              calculation: { status: computation.result.status, label: '预览', satisfied: null },
              reviewComplete: false,
              pending: [],
              canCreateReport: true,
              hasAnyBinding: true,
              byStatus: { passed: 0, failed: 0, unchecked: 0, 'needs-human': 0, 'not-applicable': 0 },
              groups: [],
            },
            groups,
            blockers: [],
            requirement,
          },
        }
      } catch (error) {
        return { ok: false as const, error: { code: 'CALCULATION_FAILED' as const, message: error instanceof Error ? error.message : String(error) } }
      }
    }),
    applyChange: vi.fn<CunlianApi['applyChange']>(async request => {
      if (changeDraft === null || request.baseToken !== changeDraft.baseToken || request.draftToken !== changeDraft.draftToken) {
        return { ok: false as const, error: { code: 'STALE_BASE' as const, message: '基准已变化，旧确认请求已拒绝' } }
      }
      const base = drawingSnapshot ?? opened.snapshot
      try {
        const computation = computeChange(
          { ...base, attachments: [] } as unknown as import('../project-file/types').ProjectFileSnapshot,
          { parameters: changeDraft.parameters, bindings: changeDraft.bindings },
          { revisionId: 'rev-d-mock-1', now: '2026-11-09T10:00:00.000Z' },
        )
        const candidate = buildCommitCandidate(
          { ...base, attachments: [] } as unknown as import('../project-file/types').ProjectFileSnapshot,
          computation,
          {
            revisionId: 'rev-d-mock-1',
            analysisSnapshotId: 'snapshot-d-rev-d-mock-1',
            createdAt: '2026-11-09T10:00:00.000Z',
            reason: request.reason,
            restoredFromRevisionId: null,
            reauthenticateBindings: false,
          },
        )
        opened = { ...opened, snapshot: candidate.snapshot as unknown as ProjectOpenValue['snapshot'], path: '/project.cunlian', fingerprint: 'd'.repeat(64) }
        drawingSnapshot = candidate.snapshot as unknown as ProjectOpenValue['snapshot']
        changeDraft = null
        return {
          ok: true as const,
          value: {
            revisionId: 'rev-d-mock-1',
            acceptedSeq: 1,
            savedSeq: 1,
            snapshot: candidate.snapshot as unknown as ProjectOpenValue['snapshot'],
            path: '/project.cunlian',
            fingerprint: 'd'.repeat(64),
            analysisSnapshotId: 'snapshot-d-rev-d-mock-1',
            recovery: 'none' as const,
            warnings: [],
          },
        }
      } catch (error) {
        return { ok: false as const, error: { code: 'SAVE_FAILED' as const, message: error instanceof Error ? error.message : String(error) } }
      }
    }),
    bindParameter: vi.fn<CunlianApi['bindParameter']>(async request => {
      const base = drawingSnapshot ?? opened.snapshot
      const parameters = base.project.parameters.length
        ? base.project.parameters
        : parseSpacerParameters({ innerDiameter: '20.00', outerDiameter: '32.00', length: '12.00' }).ok
          ? (parseSpacerParameters({ innerDiameter: '20.00', outerDiameter: '32.00', length: '12.00' }) as { ok: true; parameters: import('../drawing/types').ParameterSnapshotItem[] }).parameters.map(item => ({ ...item, parameterRevision: 1 }))
          : []
      changeDraft = {
        draftId: 'draft-mock-1',
        draftRevision: (changeDraft?.draftRevision ?? 0) + 1,
        baseToken: 'a'.repeat(16),
        draftToken: 'b'.repeat(16),
        parameters,
        bindings: [{ kind: 'parameter-binding', bindingId: 'binding-mock-1', termId: request.termId, partId: request.partId, parameterId: request.parameterId, syncField: 'nominal', createdAt: '2026-11-09T10:00:00.000Z' }],
        confirmationCleared: false,
      }
      return { ok: true as const, value: changeDraft }
    }),
    unbindParameter: vi.fn<CunlianApi['unbindParameter']>(async request => {
      // 与真实 main 同语义：没有草稿时先由快照建立草稿，再移除该绑定。
      const base = drawingSnapshot ?? opened.snapshot
      const draft = changeDraft ?? {
        draftId: 'draft-mock-1',
        draftRevision: 0,
        baseToken: 'a'.repeat(16),
        draftToken: 'b'.repeat(16),
        parameters: base.project.parameters.map(item => ({ ...item })),
        bindings: base.project.dimensionLinks
          .filter((link): link is import('../project-file/types').ProjectFileParameterBindingLink => link.kind === 'parameter-binding')
          .map(link => ({ ...link })),
        confirmationCleared: false,
      }
      if (!draft.bindings.some(binding => binding.bindingId === request.bindingId)) {
        return { ok: false as const, error: { code: 'INVALID_BINDING' as const, message: '绑定不存在' } }
      }
      changeDraft = {
        ...draft,
        draftRevision: draft.draftRevision + 1,
        bindings: draft.bindings.filter(binding => binding.bindingId !== request.bindingId),
      }
      return { ok: true as const, value: changeDraft }
    }),
    compareDrawings: vi.fn<CunlianApi['compareDrawings']>(async () => ({
      ok: false as const,
      error: { code: 'COMPARE_UNAVAILABLE' as const, message: 'mock 不提供图纸对比' },
    })),
    restoreRevisionDraft: vi.fn<CunlianApi['restoreRevisionDraft']>(async () => ({
      ok: false as const,
      error: { code: 'INVALID_REQUEST' as const, message: 'mock 不提供恢复' },
    })),
    // V3.5：默认取消导入、无待确认表单；用例按需覆盖。
    importSource: vi.fn<CunlianApi['importSource']>(async () => ({
      ok: false as const,
      error: { code: 'CANCELLED' as const, message: '取消' },
    })),
    // 草图入口：默认取消；用例按需覆盖。
    importSketchImage: vi.fn<CunlianApi['importSketchImage']>(async () => ({
      ok: false as const,
      error: { code: 'CANCELLED' as const, message: '取消' },
    })),
    ingestSketchReadings: vi.fn<CunlianApi['ingestSketchReadings']>(async () => ({
      ok: false as const,
      error: { code: 'INVALID_REQUEST' as const, message: 'mock 不提供草图读数' },
    })),
    stageRequirementEdit: vi.fn<CunlianApi['stageRequirementEdit']>(async request => ({
      ok: true as const,
      value: {
        baseToken: 'e'.repeat(16),
        acceptedSeq: 0,
        activeRequirementRevisionId: opened.snapshot.project.activeRequirementRevisionId,
        hasPendingEdit: request.edit !== null,
      },
    })),
    confirmRequirement: vi.fn<CunlianApi['confirmRequirement']>(async () => ({
      ok: false as const,
      error: { code: 'INVALID_REQUIREMENT_INPUT' as const, message: 'mock 不提供条款确认' },
    })),
    // V3.6 新增：提取/决定默认不适用，既有用例行为不变。
    // 体验修订：decide 动作新增 revoke；mock 显式回显动作，仍返回失败（无项目会话）。
    runExtraction: vi.fn<CunlianApi['runExtraction']>(async () => ({
      ok: false as const,
      error: { code: 'SOURCE_NOT_FOUND' as const, message: 'mock 不提供提取' },
    })),
    decideExtraction: vi.fn<CunlianApi['decideExtraction']>(async (request) => ({
      ok: false as const,
      error: { code: 'NOT_FOUND' as const, message: `mock 不提供提取决定（${request.action}）` },
    })),
    cancelExtraction: vi.fn<CunlianApi['cancelExtraction']>(async () => ({
      ok: true as const,
      value: { cancelled: false },
    })),
    // 多草稿：删除旧草稿默认不适用；用例按需覆盖，既有行为不变。
    deleteExtractionDraft: vi.fn<CunlianApi['deleteExtractionDraft']>(async () => ({
      ok: false as const,
      error: { code: 'NOT_FOUND' as const, message: 'mock 不提供草稿删除' },
    })),
  }
  vi.stubGlobal('cunlian', api)
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  modelScene.handles.length = 0
  modelScene.options.length = 0
  scene.handles.length = 0
  scene.options.length = 0
  scene.spacerDimensions.length = 0
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
async function openExample() {
  render(<DesktopWorkspace />)
  await waitFor(() => expect(screen.getByRole('button', { name: /打开内置示例/ })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: /打开内置示例/ }))
  await screen.findByRole('main', { name: '寸链桌面工作台' })
  await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeEnabled())
}

describe('A-04b 会话接线', () => {
  it('启动页列出最近/恢复，失效项只重新定位，Rev 不伪造', async () => {
    render(<DesktopWorkspace />)
    await screen.findByText('有尚未保存的恢复草稿')
    expect(screen.getByText(/未命名版本/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新定位' }))
    await waitFor(() => expect(api.relinkRecent).toHaveBeenCalledWith({ recentId: 'recent-1' }))
    expect(api.openProject).not.toHaveBeenCalled()
  })
  it('打开内置示例，树/属性/复核来自快照，布局与页签保留', async () => {
    await openExample()
    expect(api.newProject).toHaveBeenCalledWith({ name: '尺寸链示例（A）', template: 'chain-demo' })
    expect(screen.getByText('未保存草稿')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'H · 总长' }))
    expect(screen.getByRole('heading', { name: '属性 · H · 总长' })).toBeInTheDocument()
    expect(screen.getByText('52.200 mm')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '尺寸链' }))
    expect(screen.getByRole('tab', { name: '尺寸链' })).toHaveAttribute('aria-selected', 'true')
    const splitter = screen.getByRole('separator', { name: '项目树宽度' })
    fireEvent.keyDown(splitter, { key: 'ArrowRight' }); expect(splitter).toHaveAttribute('aria-valuenow', '240')
    fireEvent.click(screen.getByRole('button', { name: /复核与变更/ }))
    expect(screen.getByText('极限范围 0.150 至 0.250 mm')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /复核与变更/ })).toHaveTextContent('图纸 未生成')
    expect(screen.queryByRole('button', { name: '增加组成环' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '删除组成环' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '确认审查' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '冻结分析快照' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '前往图纸导出' }))
    expect(screen.getByRole('tab', { name: '工程图' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('button', { name: opened.snapshot.documents[0].title }))
    expect(screen.getByText('有元数据，未读取附件')).toBeInTheDocument()
  })
  it('无任务书项目：标题栏标清“依据：用户输入，无外部原文件”', async () => {
    opened = {
      ...opened,
      snapshot: {
        ...opened.snapshot,
        project: { ...opened.snapshot.project, sourceKind: 'user-intent', actorId: '老王', sessionSeq: 1 },
      },
    }
    await openExample()
    expect(screen.getByTestId('project-source-note').textContent).toBe('依据：用户输入，无外部原文件')
  })

  it('菜单 save/saveAs/open/close 真实转交，屏障回复当前会话；失败不更换 UI 快照', async () => {
    await openExample()
    act(() => menu({ action: 'save' }))
    await screen.findByText('已保存')
    expect(api.saveProject).toHaveBeenCalledWith({ sessionId: 'session-1', editSeq: 0, expectedFingerprint: null })
    act(() => menu({ action: 'saveAs' }))
    await waitFor(() => expect(api.saveProjectAs).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeEnabled())
    vi.mocked(api.openProject).mockResolvedValueOnce(failure)
    act(() => menu({ action: 'open' }))
    await screen.findByText('保存失败，编辑内容仍可继续处理')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(opened.snapshot.project.name)
    await act(async () => flush({ requestId: 'barrier' }))
    expect(api.respondEditorFlush).toHaveBeenCalledWith({ requestId: 'barrier', sessionId: 'session-1', editSeq: 0 })
    act(() => menu({ action: 'close' }))
    await waitFor(() => expect(api.requestClose).toHaveBeenCalled())
    expect(screen.getByRole('main', { name: '寸链桌面工作台' })).toBeInTheDocument()
  })
  it('恢复为未保存副本', async () => {
    render(<DesktopWorkspace />)
    fireEvent.click(await screen.findByRole('button', { name: '恢复为未保存副本' }))
    await screen.findByText('未保存草稿')
    expect(api.restoreRecovery).toHaveBeenCalledWith({ recoveryId: 'draft-1' })
  })
  it('新建与迁移菜单有可操作表单，取消不改会话，迁移成功接入主进程结果', async () => {
    render(<DesktopWorkspace />)
    await waitFor(() => expect(screen.getByRole('button', { name: /打开内置示例/ })).toBeEnabled())
    act(() => menu({ action: 'new' }))
    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '新项目' } })
    fireEvent.click(screen.getByRole('button', { name: '新建' }))
    await screen.findByText('未保存草稿')
    expect(api.newProject).toHaveBeenCalledWith({ name: '新项目', template: 'empty' })
    act(() => menu({ action: 'importV2' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: '选择完整备份…' }))
    await within(dialog).findByText('迁移项目')
    fireEvent.click(within(dialog).getByRole('button', { name: '导入并另存为…' }))
    await screen.findByText('已保存')
    expect(api.commitV2).toHaveBeenCalledWith({ importToken: 'token', projectId: 'project-a' })
  })
  it('保存失败保留当前项目，之后仍可另存；取消打开不替换会话', async () => {
    await openExample()
    vi.mocked(api.saveProject).mockResolvedValueOnce(failure)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await screen.findByText('保存失败，编辑内容仍可继续处理')
    await waitFor(() => expect(screen.getByRole('button', { name: '另存为…' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '另存为…' }))
    await screen.findByText('已保存')
    await waitFor(() => expect(screen.getByRole('button', { name: '打开项目' })).toBeEnabled())
    vi.mocked(api.openProject).mockResolvedValueOnce({ ok: false, error: { code: 'CANCELLED', message: '取消' } })
    fireEvent.click(screen.getByRole('button', { name: '打开项目' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeEnabled())
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(opened.snapshot.project.name)
  })
  it('卸载注销菜单与编辑屏障', () => {
    const offMenu = vi.fn(); const offFlush = vi.fn()
    vi.mocked(api.onMenuAction).mockReturnValueOnce(offMenu)
    vi.mocked(api.onEditorFlush).mockReturnValueOnce(offFlush)
    const { unmount } = render(<DesktopWorkspace />)
    unmount()
    expect(offMenu).toHaveBeenCalledOnce(); expect(offFlush).toHaveBeenCalledOnce()
  })
  it('没有桥时明确说明限制，不捏造文件成功', () => {
    vi.stubGlobal('cunlian', undefined)
    render(<DesktopWorkspace />)
    fireEvent.keyDown(window, { key: 's', metaKey: true })
    expect(screen.getByRole('status')).toHaveTextContent('window.cunlian 不可用')
  })
})

describe('A-04c 实质页面', () => {
  it('最近项目缺正式序号时显示未命名版本，不回显 main 的内部 Rev', async () => {
    vi.mocked(api.listRecent).mockResolvedValue({ ok: true, value: { items: [{ recentId: 'r', projectId: 'p', name: '项目', path: '/p.cunlian', lastOpenedAt: 'now', missing: false, rev: 'rev-real-7' }] } })
    render(<DesktopWorkspace />)
    expect(await screen.findByText(/未命名版本/)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('rev-real-7')
  })
  it('启动重新挂接 main 会话，沿用序号 stage，重挂接不伪报已保存', async () => {
    vi.mocked(api.reattachSession).mockResolvedValue({ ok: true, value: { ...opened, editSeq: 7, savedSeq: 0, path: '/p.cunlian', recovery: 'pending' } })
    render(<DesktopWorkspace />)
    await screen.findByText('有未保存修改')
    expect(api.newProject).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: '尺寸链' }))
    await waitFor(() => expect(screen.getByLabelText('第 1 行 H 基本尺寸')).toBeEnabled())
    fireEvent.change(screen.getByLabelText('第 1 行 H 基本尺寸'), { target: { value: '52.3' } })
    await waitFor(() => expect(api.stageDraft).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-1', editSeq: 8 })))
  })
  it('编辑数值/目标经既有领域计算并 stage，无效输入定位字段且不冒充旧结果', async () => {
    await openExample()
    fireEvent.click(screen.getByRole('tab', { name: '尺寸链' }))
    fireEvent.change(screen.getByLabelText('第 1 行 H 基本尺寸'), { target: { value: '52.3' } })
    expect(within(screen.getByRole('region', { name: '当前计算结果' })).getByText('0.250 至 0.350 mm')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('目标上限'), { target: { value: '0.4' } })
    await waitFor(() => expect(api.stageDraft).toHaveBeenCalled())
    const request = vi.mocked(api.stageDraft).mock.calls.at(-1)![0]
    // Independent input must not silently become the official chain.
    expect(request.snapshot.project.dimensionChain).toEqual(opened.snapshot.project.dimensionChain)
    expect(request.snapshot.draft?.terms[0].nominal).toBe('52.3')
    expect(request.snapshot.draft?.targetMax).toBe('0.4')
    expect(request.snapshot.draft?.basisRelationRevision).toBe(opened.snapshot.project.relationRevision)
    expect(request.snapshot.analysisSnapshots).toEqual(opened.snapshot.analysisSnapshots)
    fireEvent.change(screen.getByLabelText('第 1 行 H 基本尺寸'), { target: { value: 'bad' } })
    const input = screen.getByLabelText('第 1 行 H 基本尺寸')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(document.getElementById(input.getAttribute('aria-describedby')!)).toHaveTextContent(/.+/)
    expect(within(screen.getByRole('region', { name: '当前计算结果' })).queryByText('0.250 至 0.350 mm')).not.toBeInTheDocument()
    await waitFor(() => expect(vi.mocked(api.stageDraft).mock.calls.at(-1)![0].snapshot.draft?.terms[0].nominal).toBe('bad'))
  })
  it('来源 PDF 通过 readAttachment 取确切版本，读取失败有明确不可用提示，定位切页', async () => {
    opened.snapshot.bindings[0].page = 2
    await openExample()
    fireEvent.click(screen.getByRole('tab', { name: '来源 PDF' }))
    await waitFor(() => expect(api.readAttachment).toHaveBeenCalledWith({ sessionId: 'session-1', revisionId: 'sr-1' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('附件不可用')
    fireEvent.click(screen.getByRole('button', { name: '查看原图位置' }))
    expect(screen.getByLabelText('页码跳转')).toHaveValue(2)
  })
  it('声明缺失不渲染空白 PDF，不尝试绕道读取', async () => {
    opened.snapshot.missingAttachments = [{ documentId: 'doc-1', revisionId: 'sr-1', blobKey: 'blob-1', reason: 'declared-missing' }]
    await openExample()
    fireEvent.click(screen.getByRole('tab', { name: '来源 PDF' }))
    expect(screen.getByRole('alert')).toHaveTextContent('已声明缺失')
    expect(api.readAttachment).not.toHaveBeenCalled()
  })
  it('历史报告只读原值，不重算；comparison 缺字段显示未冻结', async () => {
    delete opened.snapshot.analysisSnapshots[0].comparison
    opened.snapshot.analysisSnapshots[0].result.minQ = 1234
    await openExample()
    fireEvent.click(screen.getByRole('tab', { name: '历史报告' }))
    expect(screen.getByText('导入的历史记录/冻结结果，不代表当前已确认')).toBeInTheDocument()
    expect(screen.getByText('0.1234 至 0.250 mm')).toBeInTheDocument()
    expect(screen.getByText('未冻结')).toBeInTheDocument()
    // 只检查历史报告面板本身没有输入框；任务侧栏的输入框不属于该面板。
    expect(within(screen.getByRole('tabpanel', { name: '历史报告' })).queryByRole('textbox')).not.toBeInTheDocument()
    expect(api.stageDraft).not.toHaveBeenCalled()
  })
})

describe('B1 内置轴系示例整合', () => {
  beforeEach(() => { scene.options.length = 0; scene.handles.length = 0 })

  const PART_NAMES = ['阶梯轴', '左轴承', '隔套', '右轴承', '挡圈']
  const tree = () => screen.getByRole('complementary', { name: '项目树' })
  const partGroup = () => within(tree()).getByText('零件').closest('details')!

  async function openShaftExample() {
    render(<DesktopWorkspace />)
    fireEvent.click(await screen.findByRole('button', { name: '打开轴系示例 · 示意装配' }))
    await screen.findByRole('main', { name: '寸链桌面工作台' })
    await screen.findByText(/3D 就绪/)
  }

  it('B1-A01 启动页轴系入口：建可另存的尺寸链会话后开启示例并转到 3D', async () => {
    await openShaftExample()
    expect(api.newProject).toHaveBeenCalledWith({ name: '轴系示例 · 示意装配', template: 'chain-demo' })
    expect(screen.getByRole('tab', { name: '3D' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText(/内置轴系示例 · 示意装配/)).toBeInTheDocument()
    expect(screen.getByText(/隔套示意几何随当前参数草稿/)).toBeInTheDocument()
    expect(screen.getByText(/需重新打开示例/)).toBeInTheDocument()
    expect(within(partGroup()).getAllByRole('button')).toHaveLength(5)
    for (const name of PART_NAMES) expect(within(partGroup()).getByRole('button', { name })).toBeInTheDocument()
    expect(within(tree()).queryByText('尚未打开轴系示例')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: /轴系示意装配三维视图/ })).toBeInTheDocument()
    expect(document.querySelector('.three-viewport')!.getAttribute('data-part-count')).toBe('5')
  })

  it('B2 占位：3D 未开启时提供 STL 导入与内置示例入口，无出图假入口', async () => {
    await openExample()
    fireEvent.click(screen.getByRole('tab', { name: '3D' }))
    expect(screen.getByRole('button', { name: '查看内置轴系示例' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导入 STL 模型…' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /导出 SVG|导出图纸/ })).toBeNull()
    expect(screen.getByText('尚未打开轴系示例')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '查看内置轴系示例' }))
    await screen.findByText(/3D 就绪/)
    expect(within(partGroup()).getAllByRole('button')).toHaveLength(5)
    // 没有新建会话：示例挂到当前会话上。
    expect(api.newProject).toHaveBeenCalledTimes(1)
  })

  it('B1-A02 树→模型：隔套选中、属性只读、aria-pressed 与命令同步', async () => {
    await openShaftExample()
    fireEvent.click(within(tree()).getByRole('button', { name: '隔套' }))
    expect(within(tree()).getByRole('button', { name: '隔套' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(tree()).getByRole('button', { name: '阶梯轴' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('heading', { name: '属性 · 隔套' })).toBeInTheDocument()
    expect(screen.getByText('20.000 mm')).toBeInTheDocument()
    expect(screen.getByText('32.000 mm')).toBeInTheDocument()
    expect(screen.getByText('12.000 mm')).toBeInTheDocument()
    expect(within(document.getElementById('desktop-panel-1')!).getByText('当前选择：隔套')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '在工程图页编辑参数' })).toBeEnabled()
    expect(scene.handles.at(-1)!.selected).toBe('builtin:shaft-demo:spacer')
  })

  it('B1-A03 模型→树：场景命中回调更新树与属性，空白清除选择', async () => {
    await openShaftExample()
    const options = scene.options.at(-1) as { onSelectPart: (partId: string | null) => void }
    act(() => options.onSelectPart('builtin:shaft-demo:bearing-left'))
    expect(within(tree()).getByRole('button', { name: '左轴承' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { name: '属性 · 左轴承' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '在工程图页编辑参数' })).toBeEnabled()
    act(() => options.onSelectPart(null))
    expect(within(tree()).getByRole('button', { name: '左轴承' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('heading', { name: '属性 · 未选择' })).toBeInTheDocument()
  })

  it('B1-A04/A05 爆炸与复位命令下发，选中在切换中保留', async () => {
    await openShaftExample()
    fireEvent.click(within(tree()).getByRole('button', { name: '隔套' }))
    const handle = scene.handles.at(-1)!
    fireEvent.change(screen.getByRole('slider', { name: '爆炸程度' }), { target: { value: '100' } })
    expect(handle.explode).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: '复位装配' }))
    expect(handle.explode).toBe(0)
    expect(within(tree()).getByRole('button', { name: '隔套' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('B1 属性栏「爆炸位移（当前）」随滑条变化，「设计最大位移（上限）」为静态值', async () => {
    await openShaftExample()
    fireEvent.click(within(tree()).getByRole('button', { name: '左轴承' }))
    const panel = document.getElementById('desktop-properties')!
    const value = (key: string) => within(panel).getByText(key).nextElementSibling?.textContent
    expect(value('爆炸位移（当前）')).toBe('0.000 mm（X）')
    expect(value('设计最大位移（上限）')).toBe('-24.000 mm（X）')
    fireEvent.change(screen.getByRole('slider', { name: '爆炸程度' }), { target: { value: '100' } })
    expect(value('爆炸位移（当前）')).toBe('-24.000 mm（X）')
    fireEvent.change(screen.getByRole('slider', { name: '爆炸程度' }), { target: { value: '50' } })
    expect(value('爆炸位移（当前）')).toBe('-12.000 mm（X）')
    fireEvent.click(screen.getByRole('button', { name: '复位装配' }))
    expect(value('爆炸位移（当前）')).toBe('0.000 mm（X）')
    fireEvent.click(within(tree()).getByRole('button', { name: '隔套' }))
    expect(value('爆炸位移（当前）')).toBe('0.000 mm（X）')
    expect(value('设计最大位移（上限）')).toBe('0.000 mm（X）（装配基准，不参与爆炸）')
  })

  it('B1-A07 标签保持：切走时暂停渲染，切换后选择/爆炸/实例不丢', async () => {
    await openShaftExample()
    fireEvent.click(within(tree()).getByRole('button', { name: '隔套' }))
    fireEvent.change(screen.getByRole('slider', { name: '爆炸程度' }), { target: { value: '40' } })
    const handle = scene.handles.at(-1)!
    fireEvent.click(screen.getByRole('tab', { name: '尺寸链' }))
    await waitFor(() => expect(handle.active).toBe(false))
    fireEvent.click(screen.getByRole('tab', { name: '3D' }))
    await waitFor(() => expect(handle.active).toBe(true))
    expect(handle.disposed).toBe(false)
    expect(handle.explode).toBe(0.4)
    expect(within(tree()).getByRole('button', { name: '隔套' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('B1-A09 状态隔离：3D 选择/爆炸/相机不产生 stageDraft，保存状态仍由 A-04 决定', async () => {
    await openShaftExample()
    fireEvent.click(within(tree()).getByRole('button', { name: '隔套' }))
    fireEvent.change(screen.getByRole('slider', { name: '爆炸程度' }), { target: { value: '70' } })
    const options = scene.options.at(-1) as { onViewChange: (view: unknown) => void }
    act(() => options.onViewChange({ position: [1, 2, 3], target: [0, 0, 0], zoom: 2 }))
    fireEvent.click(screen.getByRole('button', { name: '重置视角' }))
    expect(api.stageDraft).not.toHaveBeenCalled()
    expect(screen.getByText('未保存草稿')).toBeInTheDocument()
    // 主标题仍来自 main 返回的快照，3D 交互没有替换或重算项目数据。
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('寸链 ·')
    expect(screen.getByRole('heading', { name: '属性 · 隔套' })).toBeInTheDocument()
  })

  it('B1-A07 换会话：示例关闭、旧 3D 实例释放、零件选择清空', async () => {
    await openShaftExample()
    fireEvent.click(within(tree()).getByRole('button', { name: '隔套' }))
    vi.mocked(api.openProject).mockResolvedValueOnce({ ok: true, value: { ...opened, sessionId: 'session-2', editSeq: 0 } })
    fireEvent.click(screen.getByRole('button', { name: '打开项目' }))
    await waitFor(() => expect(screen.getByText('尚未打开轴系示例')).toBeInTheDocument())
    expect(screen.queryByRole('img', { name: /轴系示意装配三维视图/ })).toBeNull()
    expect(scene.handles.length).toBeGreaterThan(0)
    // 卸载清理与文案更新是同一轮 React 提交后的 effect；在并发负载下要等它完成。
    await waitFor(() => expect(scene.handles.every(handle => handle.disposed === true)).toBe(true))
    expect(screen.getByRole('heading', { name: '属性 · 未选择' })).toBeInTheDocument()
  })
})

describe('B2 模型导入与外形资料来源', () => {
  const tree = () => screen.getByRole('complementary', { name: '项目树' })
  const partGroup = () => within(tree()).getByText('零件').closest('details')!
  it('导入：pick→read→确认→commit；显示文件名/面数，爆炸入口禁用', async () => {
    const { snapshot } = await createModelSnapshot()
    const dto = toSnapshotDto(snapshot)
    const stlBytes = sampleStlTriangle()
    vi.mocked(api.pickModel).mockResolvedValueOnce({ ok: true, value: { candidateToken: 'tok-1', fileName: 'sleeve.stl', byteSize: stlBytes.byteLength, sha256: 'a'.repeat(64) } })
    vi.mocked(api.readModel).mockResolvedValueOnce({ ok: true, value: { bytes: stlBytes, sha256: 'a'.repeat(64), fileName: 'sleeve.stl', byteSize: stlBytes.byteLength } })
    vi.mocked(api.commitModel).mockResolvedValueOnce({ ok: true, value: { acceptedSeq: 1, modelRevisionId: MODEL_REVISION_ID, snapshot: dto, recovery: 'written' } })

    await openExample()
    fireEvent.click(screen.getByRole('tab', { name: '3D' }))
    fireEvent.click(screen.getByRole('button', { name: '导入 STL 模型…' }))
    const dialog = await screen.findByRole('dialog', { name: '确认导入模型' })
    expect(within(dialog).getByDisplayValue('sleeve')).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText('部件名称'), { target: { value: '隔套外形' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '导入为不可变版本' }))

    await waitFor(() => expect(api.commitModel).toHaveBeenCalled())
    const request = vi.mocked(api.commitModel).mock.calls.at(-1)![0]
    expect(request.expectedCurrentModelRevisionId).toBeNull()
    expect(request.partName).toBe('隔套外形')
    expect(request.unitNote).toBe('未注明（STL 无标准单位）')
    await screen.findByText(/导入模型 · sleeve.stl/)
    expect(screen.getByRole('button', { name: '爆炸（整体网格不支持）' })).toBeDisabled()
    expect(within(partGroup()).getByRole('button', { name: '隔套外形' })).toBeInTheDocument()
    fireEvent.click(within(partGroup()).getByRole('button', { name: '隔套外形' }))
    expect(screen.getAllByText(/不改变尺寸链数值、不自动同步/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/1 面/).length).toBeGreaterThan(0)
  })

  it('解析失败：具体错误、旧模型视图保留、候选被释放、不调用 commit', async () => {
    const { snapshot } = await createModelSnapshot()
    const dto = toSnapshotDto(snapshot)
    const stlBytes = sampleStlTriangle()
    vi.mocked(api.openProject).mockResolvedValueOnce({ ok: true, value: { ...opened, snapshot: dto } })
    // 首次按版本读取用于显示；替换候选读取返回坏字节。
    vi.mocked(api.readModel)
      .mockResolvedValueOnce({ ok: true, value: { bytes: stlBytes, sha256: 'a'.repeat(64), fileName: 'sleeve.stl', byteSize: stlBytes.byteLength } })
      .mockResolvedValueOnce({ ok: true, value: { bytes: new TextEncoder().encode('not an stl'), sha256: 'b'.repeat(64), fileName: 'broken.stl', byteSize: 10 } })
    vi.mocked(api.pickModel).mockResolvedValueOnce({ ok: true, value: { candidateToken: 'tok-bad', fileName: 'broken.stl', byteSize: 10, sha256: 'b'.repeat(64) } })
    vi.mocked(api.releaseModel).mockResolvedValue({ ok: true, value: { released: true } })

    render(<DesktopWorkspace />)
    fireEvent.click(await screen.findByRole('button', { name: /打开项目/ }))
    await screen.findByRole('main', { name: '寸链桌面工作台' })
    fireEvent.click(screen.getByRole('tab', { name: '3D' }))
    await screen.findByText(/导入模型 · sleeve.stl/)
    fireEvent.click(screen.getByRole('button', { name: '替换模型…' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('STL_')
    expect(alert).toHaveTextContent('旧视图、当前版本与关联未改变')
    expect(screen.getByText(/导入模型 · sleeve.stl/)).toBeInTheDocument()
    expect(api.commitModel).not.toHaveBeenCalled()
    expect(api.releaseModel).toHaveBeenCalledWith({ sessionId: 'session-1', candidateToken: 'tok-bad' })
  })

  it('关联：确认文案明确不改变数值；确认后显示已核对', async () => {
    const { snapshot } = await createModelSnapshot()
    const dto = toSnapshotDto(snapshot)
    const link = {
      kind: 'visual-reference' as const,
      linkId: 'link-ui',
      termId: 't-s',
      target: { granularity: 'model' as const, partId: MODEL_PART_ID, modelRevisionId: MODEL_REVISION_ID },
      reviewStatus: 'confirmed' as const,
      reviewedModelRevisionId: MODEL_REVISION_ID,
      reviewedAt: '2026-11-09T10:00:00.000Z',
      reason: '',
    }
    vi.mocked(api.openProject).mockResolvedValueOnce({ ok: true, value: { ...opened, snapshot: dto } })
    vi.mocked(api.readModel).mockResolvedValue({ ok: true, value: { bytes: sampleStlTriangle(), sha256: 'a'.repeat(64), fileName: 'sleeve.stl', byteSize: 134 } })
    vi.mocked(api.linkModel).mockResolvedValueOnce({
      ok: true,
      value: { acceptedSeq: 1, snapshot: { ...dto, project: { ...dto.project, dimensionLinks: [link] } }, recovery: 'written', warning: '该关联只表示外形资料来源，不改变尺寸链数值、不自动同步。' },
    })

    render(<DesktopWorkspace />)
    fireEvent.click(await screen.findByRole('button', { name: /打开项目/ }))
    await screen.findByRole('main', { name: '寸链桌面工作台' })
    fireEvent.click(within(tree()).getByRole('button', { name: 'S · 隔套' }))
    const section = screen.getByRole('region', { name: '外形资料来源关联' })
    fireEvent.click(within(section).getByRole('button', { name: '关联整体模型…' }))
    const dialog = await screen.findByRole('dialog', { name: '确认外形资料来源关联' })
    expect(dialog).toHaveTextContent('不改变尺寸链数值、不自动同步')
    expect(dialog).toHaveTextContent('也不驱动参数隔套预览')
    fireEvent.click(within(dialog).getByRole('button', { name: '确认关联（不改变数值）' }))

    await waitFor(() => expect(api.linkModel).toHaveBeenCalled())
    const request = vi.mocked(api.linkModel).mock.calls.at(-1)![0]
    expect(request).toMatchObject({
      operation: 'bind',
      termId: 't-s',
      target: { granularity: 'model', partId: MODEL_PART_ID, modelRevisionId: MODEL_REVISION_ID },
    })
    await waitFor(() => expect(within(section).getByText(/已核对/)).toBeInTheDocument())
  })

  it('替换尺寸差异极大的模型：按新几何包围盒重新 fit，不沿用旧相机', async () => {
    // 伪场景模块替换了真实实现，这里取回未打桩的纯几何函数做数字核对。
    const actual = await vi.importActual<typeof import('../parts/modelScene')>('../parts/modelScene')
    const { snapshot } = await createModelSnapshot()
    const dto = toSnapshotDto(snapshot)
    // 替换后的快照：同一零件指向新不可变版本；新几何由 readModel 返回的 100×100 三角形决定。
    const dtoB = {
      ...dto,
      project: {
        ...dto.project,
        parts: dto.project.parts.map(part => ({ ...part, currentModelRevisionId: 'model-2' })),
        modelRevisions: [
          ...dto.project.modelRevisions,
          {
            ...dto.project.modelRevisions[0],
            modelRevisionId: 'model-2',
            parentModelRevisionId: MODEL_REVISION_ID,
            bounds: { min: [0, 0, 0] as [number, number, number], max: [100, 100, 0] as [number, number, number] },
          },
        ],
      },
    }

    vi.mocked(api.openProject).mockResolvedValueOnce({ ok: true, value: { ...opened, snapshot: dto } })
    vi.mocked(api.readModel).mockImplementation(async request =>
      request.ref.kind === 'candidate'
        ? { ok: true as const, value: { bytes: sampleStlTriangle(100), sha256: 'b'.repeat(64), fileName: 'wrench-like.stl', byteSize: 134 } }
        : { ok: true as const, value: { bytes: sampleStlTriangle(1), sha256: 'a'.repeat(64), fileName: 'sleeve.stl', byteSize: 134 } },
    )
    vi.mocked(api.pickModel).mockResolvedValueOnce({
      ok: true,
      value: { candidateToken: 'tok-2', fileName: 'wrench-like.stl', byteSize: 134, sha256: 'b'.repeat(64) },
    })
    vi.mocked(api.commitModel).mockResolvedValueOnce({
      ok: true,
      value: { acceptedSeq: 1, modelRevisionId: 'model-2', snapshot: dtoB, recovery: 'written' },
    })

    render(<DesktopWorkspace />)
    fireEvent.click(await screen.findByRole('button', { name: /打开项目/ }))
    await screen.findByRole('main', { name: '寸链桌面工作台' })
    fireEvent.click(screen.getByRole('tab', { name: '3D' }))
    await screen.findByText(/导入模型 · sleeve.stl/)
    await waitFor(() => expect(modelScene.options).toHaveLength(1))

    // 用户在旧模型（1×1×0）上手动转过视角：相机离原点 8.66。
    const first = modelScene.options[0] as { onViewChange: (view: unknown) => void }
    act(() => first.onViewChange({ position: [5, 5, 5], target: [0, 0, 0], zoom: 1 }))

    fireEvent.click(screen.getByRole('button', { name: '替换模型…' }))
    const dialog = await screen.findByRole('dialog', { name: '确认导入模型' })
    fireEvent.click(within(dialog).getByRole('button', { name: '导入为不可变版本' }))

    await waitFor(() => expect(modelScene.options).toHaveLength(2))
    const replaced = modelScene.options[1] as {
      view: unknown
      bounds: { min: readonly number[]; max: readonly number[] }
    }

    // 新场景拿到的是新几何包围盒，而不是旧版本的 view；由 modelScene 走首建同一套 fit。
    expect(replaced.bounds).toEqual({ min: [0, 0, 0], max: [100, 100, 0] })
    expect(replaced.view).toBeNull()

    // fit 距离与旧 pose 对比：新几何需要 >100 的相机距离，旧 pose 只有 8.66。
    const fitted = actual.defaultModelView({ min: [0, 0, 0], max: [100, 100, 0] }, 1.6)
    const fittedDistance = Math.hypot(
      fitted.position[0] - fitted.target[0],
      fitted.position[1] - fitted.target[1],
      fitted.position[2] - fitted.target[2],
    )
    expect(fittedDistance).toBeGreaterThan(100)
    expect(fittedDistance / Math.hypot(5, 5, 5)).toBeGreaterThan(10)

    // 同一版本内再转视角不会重建场景（手动视角仍只在本次会话保留）。
    act(() => (replaced as unknown as { onViewChange: (view: unknown) => void }).onViewChange({ position: [80, 60, 120], target: [50, 50, 0], zoom: 1 }))
    expect(modelScene.options).toHaveLength(2)
  })
})

describe('C-03 工程图预览与参数联动', () => {
  it('生成图纸后预览来自权威 DrawingData；点击标注定位参数', async () => {
    await openExample()
    fireEvent.click(screen.getByRole('button', { name: '生成图纸' }))
    await waitFor(() => expect(api.updateSpacerDrawing).toHaveBeenCalledTimes(1))
    expect(api.updateSpacerDrawing).toHaveBeenCalledWith({
      sessionId: 'session-1',
      baseEditSeq: 0,
      partId: 'builtin:shaft-demo:spacer',
      inputs: { innerDiameter: '20.00', outerDiameter: '32.00', length: '12.00' },
      scale: { numerator: 1, denominator: 1 },
      frameFields: expect.objectContaining({ partName: '隔套' }),
    })
    const canvas = await waitFor(() => {
      const found = document.querySelector('[data-drawing-fingerprint]')
      if (found === null) throw new Error('no canvas')
      return found as HTMLElement
    })
    expect(canvas.querySelector('[data-annotation-id="ann.length"] text')?.textContent).toBe('12.000')
    expect(canvas.querySelector('[data-annotation-id="ann.outer-diameter"] text')?.textContent).toBe('⌀32.000')

    const annotation = canvas.querySelector('[data-annotation-id="ann.length"]')
    expect(annotation).not.toBeNull()
    fireEvent.click(annotation as Element)
    expect(await screen.findByRole('heading', { name: /属性 · 标注 · 12.000/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '长度 · 图纸参数' })).toBeInTheDocument()
    expect(screen.getByText(/q = 120000 · 输入 2 位小数/)).toBeInTheDocument()
  })

  it('12.1000 与 12.10 统一显示三位且保留元数据，几何/参数 q 不变；非法输入保留旧图', async () => {
    await openExample()
    fireEvent.click(screen.getByRole('button', { name: '生成图纸' }))
    await waitFor(() => expect(document.querySelector('[data-drawing-fingerprint]')).not.toBeNull())
    const lengthInput = screen.getByLabelText('长度输入')
    fireEvent.change(lengthInput, { target: { value: '12.1000' } })
    fireEvent.click(screen.getByRole('button', { name: '应用参数与比例' }))
    await waitFor(() => {
      expect(document.querySelector('[data-annotation-id="ann.length"] text')?.textContent).toBe('12.100')
    })
    fireEvent.change(lengthInput, { target: { value: '12.10' } })
    fireEvent.click(screen.getByRole('button', { name: '应用参数与比例' }))
    await waitFor(() => {
      expect(document.querySelector('[data-annotation-id="ann.length"] text')?.textContent).toBe('12.100')
    })
    // 预览的参数元数据来自同一份快照：q 不变，只有有效位不同。
    expect(screen.getByText('121000 q · 2 位')).toBeInTheDocument()

    const before = document.querySelector('[data-drawing-fingerprint]')?.getAttribute('data-drawing-fingerprint')
    fireEvent.change(screen.getByLabelText('内径输入'), { target: { value: '40.00' } })
    fireEvent.click(screen.getByRole('button', { name: '应用参数与比例' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/外径必须大于内径/)
    expect(document.querySelector('[data-drawing-fingerprint]')?.getAttribute('data-drawing-fingerprint')).toBe(before)
    expect(document.querySelector('[data-annotation-id="ann.length"] text')?.textContent).toBe('12.100')
  })

  it('纸面比例只改视图尺寸；画布缩放不触发数据更新', async () => {
    await openExample()
    fireEvent.click(screen.getByRole('button', { name: '生成图纸' }))
    await waitFor(() => expect(document.querySelector('[data-drawing-fingerprint]')).not.toBeNull())
    const callsBefore = vi.mocked(api.updateSpacerDrawing).mock.calls.length
    fireEvent.change(screen.getByLabelText('纸面比例'), { target: { value: '1:2' } })
    fireEvent.click(screen.getByRole('button', { name: '应用参数与比例' }))
    await waitFor(() => expect(vi.mocked(api.updateSpacerDrawing).mock.calls.length).toBe(callsBefore + 1))
    const last = vi.mocked(api.updateSpacerDrawing).mock.calls.at(-1)?.[0]
    expect(last?.scale).toEqual({ numerator: 1, denominator: 2 })
    await waitFor(() => {
      expect(document.querySelector('[data-annotation-id="ann.length"] text')?.textContent).toBe('12.000')
    })
    const zoomCalls = vi.mocked(api.updateSpacerDrawing).mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: '50%' }))
    fireEvent.click(screen.getByRole('button', { name: '150%' }))
    expect(vi.mocked(api.updateSpacerDrawing).mock.calls.length).toBe(zoomCalls)
  })
})

describe('V3.5 第 3 阶段：草稿候选画面与提交门禁', () => {
  it('合法草稿自动预览后工程图/标注/属性按候选参数重画；非法输入保留上次画面并标注', async () => {
    opened.snapshot = (await createSpacerSnapshot({
      length: '12.00',
      confirmed: true,
      material: '',
    })) as unknown as ProjectOpenValue['snapshot']
    await openExample()

    // 3D 在场时也读取同一份草稿参数（只替换隔套网格，组件不重建）。
    fireEvent.click(screen.getByRole('tab', { name: '3D' }))
    fireEvent.click(await screen.findByRole('button', { name: '查看内置轴系示例' }))
    await waitFor(() => expect(scene.handles).toHaveLength(1))
    await waitFor(() =>
      expect(document.querySelector('.three-viewport')?.getAttribute('data-three-state')).toBe('ready'),
    )
    const sceneHandleBefore = scene.handles[0]

    fireEvent.click(screen.getByRole('tab', { name: '工程图' }))
    const drawingPanel = screen.getByLabelText('隔套工程图')
    const annotationText = () =>
      drawingPanel.querySelector('[data-annotation-id="ann.length"] text')?.textContent
    await waitFor(() => expect(annotationText()).toBe('12.000'))
    fireEvent.click(screen.getByRole('button', { name: '150%' }))
    expect(screen.getByRole('button', { name: '150%' })).toHaveAttribute('aria-pressed', 'true')

    const bench = screen.getByLabelText('参数联动')
    fireEvent.change(within(bench).getByLabelText('长度（mm）'), { target: { value: '12.04' } })
    await waitFor(() => expect(api.previewChange).toHaveBeenCalled(), { timeout: 3000 })
    await waitFor(() => expect(annotationText()).toBe('12.040'), { timeout: 3000 })

    // 2D 图形与标注确实按候选参数重画，并明确标“未提交”。
    expect(within(drawingPanel).getByText(/候选参数预览（未提交）/)).toBeInTheDocument()
    expect(within(drawingPanel).getByText('候选草稿 · 未提交')).toBeInTheDocument()
    // 项目树与属性也读候选快照（用户实测的 120000 q 不再停留）。
    fireEvent.click(screen.getByRole('button', { name: '长度 · 12.040' }))
    expect(screen.getByRole('heading', { name: '长度 · 图纸参数' })).toBeInTheDocument()
    expect(screen.getByText(/q = 120400 · 输入 2 位小数/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '标注 · 12.040' })).toBeInTheDocument()
    // 3D：隔套长度随草稿变成 12.04。
    await waitFor(() =>
      expect(
        scene.spacerDimensions.some(
          (item) => Math.abs((item as { length: number }).length - 12.04) < 1e-9,
        ),
      ).toBe(true),
    )
    // 候选值刷新不能重建 3D 场景/图纸组件：同一个场景句柄与 2D 缩放保持不变。
    expect(scene.handles).toHaveLength(1)
    expect(scene.handles[0]).toBe(sceneHandleBefore)
    expect(screen.getByRole('button', { name: '150%' })).toHaveAttribute('aria-pressed', 'true')

    // 非法输入：保留上次有效候选画面，并标明“输入待修正”。
    const benchAfter = screen.getByLabelText('参数联动')
    fireEvent.change(within(benchAfter).getByLabelText('长度（mm）'), { target: { value: 'abc' } })
    await waitFor(
      () => expect(within(screen.getByLabelText('隔套工程图')).getByText(/输入待修正/)).toBeInTheDocument(),
      { timeout: 3000 },
    )
    expect(annotationText()).toBe('12.040')
    expect(drawingPanel.querySelector('[data-drawing-fingerprint]')).not.toBeNull()
  })

  it('条款检查为不满足时确认提交按钮 disabled，原因文字仍可见', async () => {
    const requirement = await createRequirementProject()
    // 模拟真实项目：条款确认后又导入了任务书 PDF（与参数绑定无关的来源清单项）。
    // 旧 sourceBasis 会把这条新增文档算进去，导致绑定被误判待核。
    const base = requirement.snapshot
    opened.snapshot = {
      ...base,
      documents: [
        ...base.documents,
        {
          id: 'doc-taskbook-extra',
          projectId: base.project.id,
          title: 'taskbook-2p.pdf',
          latestRevisionId: 'sr-taskbook-extra',
        },
      ],
      revisions: [
        ...base.revisions,
        {
          id: 'sr-taskbook-extra',
          projectId: base.project.id,
          documentId: 'doc-taskbook-extra',
          fileName: 'taskbook-2p.pdf',
          sha256: 'e'.repeat(64),
          byteSize: 2048,
          pageCount: 2,
          createdAt: '2026-11-09T09:30:00.000Z',
          blobKey: 'blob-taskbook-extra',
        },
      ],
      blobs: [
        ...base.blobs,
        {
          blobKey: 'blob-taskbook-extra',
          projectId: base.project.id,
          sha256: 'e'.repeat(64),
          byteSize: 2048,
        },
      ],
    } as unknown as ProjectOpenValue['snapshot']
    await openExample()
    fireEvent.click(screen.getByRole('tab', { name: '工程图' }))
    await within(screen.getByLabelText('参数联动')).findByText('已确认生效')

    fireEvent.change(within(screen.getByLabelText('参数联动')).getByLabelText('长度（mm）'), {
      target: { value: '12.10' },
    })
    fireEvent.click(within(screen.getByLabelText('参数联动')).getByRole('button', { name: '建立/更新草稿' }))
    await waitFor(() => expect(api.stageChangeDraft).toHaveBeenCalled())
    fireEvent.click(within(screen.getByLabelText('参数联动')).getByRole('button', { name: '预览变更' }))
    expect(await screen.findByText(`预览：草稿 · 第 ${opened.snapshot.fileRevisions.length + 1} 版`)).toBeInTheDocument()

    const bench = screen.getByLabelText('参数联动')
    const confirm = within(bench).getByRole('button', { name: '确认提交（一次原子写入）' })
    await waitFor(() => expect(confirm).toBeDisabled())
    const reason = document.getElementById('change-workbench-confirm-reason')
    expect(reason).toHaveTextContent('条款检查为「不满足要求」')
    expect(reason).toHaveTextContent('下界越界')
    expect(confirm).toHaveAttribute('title', expect.stringContaining('条款检查为「不满足要求」'))
    expect(api.applyChange).not.toHaveBeenCalled()
  })

  it('顶栏批次标签在启动页与工作台两处都是 V4.0 · Beta', async () => {
    render(<DesktopWorkspace />)
    await waitFor(() => expect(screen.getByRole('button', { name: /打开内置示例/ })).toBeEnabled())
    expect(document.querySelector('.desktop-workspace__batch')).toHaveTextContent('V4.0 · Beta')
    expect(screen.queryByText('V3 · D 批次')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /打开内置示例/ }))
    await screen.findByRole('main', { name: '寸链桌面工作台' })
    const batches = document.querySelectorAll('.desktop-workspace__batch')
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveTextContent('V4.0 · Beta')
    expect(screen.queryByText('V3 · D 批次')).toBeNull()
  })
})

describe('D 参数联动工作台（renderer mock 接线）', () => {
  it('无参数绑定显示「未关联尺寸链」', async () => {
    await openExample()
    fireEvent.click(screen.getByRole('tab', { name: '工程图' }))
    const bench = screen.getByLabelText('参数联动')
    expect(await within(bench).findByText('未关联尺寸链')).toBeInTheDocument()
    expect(within(bench).getByRole('button', { name: '预览变更' })).toBeDisabled()
  })

  it('12→14：草稿/预览/确认走新 IPC；五类坏消息独立显示', async () => {
    opened.snapshot = (await createSpacerSnapshot({
      length: '12.00',
      confirmed: true,
      material: '',
    })) as unknown as ProjectOpenValue['snapshot']
    await openExample()
    fireEvent.click(screen.getByRole('tab', { name: '工程图' }))

    let bench = screen.getByLabelText('参数联动')
    expect(await within(bench).findByText(/已关联 1 个组成环/)).toBeInTheDocument()
    expect(within(bench).getByLabelText('长度（mm）')).toHaveValue('12.000')

    fireEvent.change(within(bench).getByLabelText('长度（mm）'), { target: { value: '14.00' } })
    fireEvent.click(within(bench).getByRole('button', { name: '建立/更新草稿' }))
    await waitFor(() => expect(api.stageChangeDraft).toHaveBeenCalled())
    expect(vi.mocked(api.stageChangeDraft).mock.calls.at(-1)?.[0].inputs.length).toBe('14.00')

    // 草稿修订号变化会重建工作区（输入框跟随权威草稿），重新取当前节点。
    bench = screen.getByLabelText('参数联动')
    fireEvent.click(within(bench).getByRole('button', { name: '预览变更' }))
    await waitFor(() => expect(api.previewChange).toHaveBeenCalled())
    expect(await screen.findByText(`预览：草稿 · 第 ${opened.snapshot.fileRevisions.length + 1} 版`)).toBeInTheDocument()
    expect(screen.getAllByText(/-1\.850 ～ -1\.750/).length).toBeGreaterThan(0)

    const group = screen.getByLabelText('复核与变更分组')
    for (const heading of ['受影响环', '需复核来源', '关系待核', '材料缺失', '计算不满足']) {
      expect(within(group).getByRole('heading', { name: heading })).toBeInTheDocument()
    }
    expect(within(group).getByText(/材料待补充/)).toBeInTheDocument()
    expect(within(group).getAllByText(/关系待核/).length).toBeGreaterThan(0)
    expect(within(group).getAllByText(/待复核草稿/).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: '确认提交（一次原子写入）' }))
    await waitFor(() => expect(api.applyChange).toHaveBeenCalled())
    expect(await screen.findByText(/已提交新版本 未命名版本/)).toBeInTheDocument()
  })

  // 缺陷 1：旧预览失效必须写明原因；“从未预览”与“预览作废”不能共用一套文案。
  const bench = () => screen.getByLabelText('参数联动')
  const confirmButton = () => within(bench()).getByRole('button', { name: '确认提交（一次原子写入）' })
  async function openSpacerBench() {
    opened.snapshot = (await createSpacerSnapshot({
      length: '12.00',
      confirmed: true,
      material: '',
    })) as unknown as ProjectOpenValue['snapshot']
    await openExample()
    fireEvent.click(screen.getByRole('tab', { name: '工程图' }))
    await within(bench()).findByText(/已关联 1 个组成环/)
  }
  async function stageLength(value: string) {
    const before = vi.mocked(api.stageChangeDraft).mock.calls.length
    fireEvent.change(within(bench()).getByLabelText('长度（mm）'), { target: { value } })
    fireEvent.click(within(bench()).getByRole('button', { name: '建立/更新草稿' }))
    await waitFor(() => expect(vi.mocked(api.stageChangeDraft).mock.calls.length).toBe(before + 1))
    await waitFor(() => expect(vi.mocked(api.stageChangeDraft).mock.calls.at(-1)?.[0].inputs.length).toBe(value))
  }

  it('D-UI-1 预览后再次建立草稿：role=alert 写明旧预览作废原因，确认按钮带可读原因', async () => {
    await openSpacerBench()
    await stageLength('14.00')
    await waitFor(() => expect(within(bench()).getByRole('button', { name: '预览变更' })).toBeEnabled())

    fireEvent.click(within(bench()).getByRole('button', { name: '预览变更' }))
    expect(await screen.findByText(`预览：草稿 · 第 ${opened.snapshot.fileRevisions.length + 1} 版`)).toBeInTheDocument()

    await stageLength('15.00')

    const alert = await within(bench()).findByRole('alert')
    expect(alert).toHaveTextContent('基准已变化，旧预览已作废')
    expect(alert).toHaveTextContent('请重新预览后再确认')
    expect(confirmButton()).toBeDisabled()
    expect(confirmButton()).toHaveAttribute('title', expect.stringContaining('旧预览已作废'))
    // 已作废 ≠ 从未预览：不再显示“尚未预览”。
    expect(within(bench()).queryByText(/尚未预览/)).toBeNull()
    expect(screen.queryByText(`预览：草稿 · 第 ${opened.snapshot.fileRevisions.length + 1} 版`)).toBeNull()
  })

  it('D-UI-2 从未预览：不出现“已作废”文案，灰按钮用 title 与文本说明尚未预览', async () => {
    await openSpacerBench()
    // 首次进入：既没预览过，也不能冒充“已作废”。
    expect(within(bench()).queryByText(/旧预览已作废/)).toBeNull()
    expect(within(bench()).queryByRole('alert')).toBeNull()
    expect(confirmButton()).toBeDisabled()
    expect(confirmButton()).toHaveAttribute('title', expect.stringContaining('尚未预览'))
    expect(within(bench()).getByText(/尚未预览：先点「预览变更」/)).toBeInTheDocument()

    await stageLength('14.00')
    await waitFor(() => expect(within(bench()).getByRole('button', { name: '预览变更' })).toBeEnabled())
    expect(within(bench()).queryByText(/旧预览已作废/)).toBeNull()
    expect(within(bench()).queryByRole('alert')).toBeNull()
  })

  it('D-UI-3 作废后重新预览：原因消失、确认按钮恢复可用', async () => {
    await openSpacerBench()
    await stageLength('14.00')
    await waitFor(() => expect(within(bench()).getByRole('button', { name: '预览变更' })).toBeEnabled())
    fireEvent.click(within(bench()).getByRole('button', { name: '预览变更' }))
    expect(await screen.findByText(`预览：草稿 · 第 ${opened.snapshot.fileRevisions.length + 1} 版`)).toBeInTheDocument()
    await stageLength('15.00')
    expect(await within(bench()).findByRole('alert')).toHaveTextContent('基准已变化')

    fireEvent.click(within(bench()).getByRole('button', { name: '预览变更' }))
    await waitFor(() => expect(within(bench()).queryByRole('alert')).toBeNull())
    expect(within(bench()).queryByText(/旧预览已作废/)).toBeNull()
    expect(confirmButton()).toBeEnabled()
    expect(within(bench()).getByText('预览有效：可以确认提交。')).toBeInTheDocument()
  })

  // 缺陷：草稿绑定只写 change.draft.bindings，区块却只看已确认快照 → 绑定成功后仍显示“未关联”。
  it('D-BIND-1 绑定成功后行列表立即出现该环，并标「草稿态待确认」而非有效', async () => {
    await openExample()
    fireEvent.click(screen.getByRole('tab', { name: '工程图' }))
    expect(await within(bench()).findByText('未关联尺寸链')).toBeInTheDocument()

    fireEvent.click(within(bench()).getByRole('button', { name: '绑定参数' }))
    await waitFor(() => expect(api.bindParameter).toHaveBeenCalled())
    // 草稿修订号变化会重建工作区节点：每轮重新取当前节点，别抓着旧 DOM。
    await waitFor(() => expect(bench()).toHaveTextContent('草稿态待确认（尚未确认提交）'))

    const panel = bench()
    expect(within(panel).queryByText('未关联尺寸链')).toBeNull()
    expect(within(panel).getByText(/已关联 1 个组成环（其中 1 个草稿态待确认）/)).toBeInTheDocument()
    // 未确认 ≠ 有效：不得显示“已确认生效”。
    expect(within(panel).queryByText('已确认生效')).toBeNull()
    expect(within(panel).queryByText(/未关联尺寸链：尚无参数绑定/)).toBeNull()
  })

  it('D-BIND-2 确认提交后同一绑定变「已确认生效」，不再显示草稿态', async () => {
    opened.snapshot = (await createSpacerSnapshot({
      length: '12.00',
      confirmed: true,
      material: '',
    })) as unknown as ProjectOpenValue['snapshot']
    await openExample()
    fireEvent.click(screen.getByRole('tab', { name: '工程图' }))
    expect(await within(bench()).findByText('已确认生效')).toBeInTheDocument()

    fireEvent.click(within(bench()).getByRole('button', { name: '绑定参数' }))
    await waitFor(() => expect(api.bindParameter).toHaveBeenCalled())
    await waitFor(() => expect(bench()).toHaveTextContent('草稿态待确认'))

    fireEvent.click(within(bench()).getByRole('button', { name: '预览变更' }))
    await waitFor(() => expect(api.previewChange).toHaveBeenCalled())
    expect(await screen.findByText(`预览：草稿 · 第 ${opened.snapshot.fileRevisions.length + 1} 版`)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '确认提交（一次原子写入）' }))
    await waitFor(() => expect(api.applyChange).toHaveBeenCalled())
    expect(await screen.findByText(/已提交新版本 未命名版本/)).toBeInTheDocument()

    await waitFor(() => expect(bench()).toHaveTextContent('已确认生效'))
    const panel = bench()
    expect(within(panel).queryByText(/草稿态待确认/)).toBeNull()
  })

  it('D-BIND-3 解除绑定后该行消失，并回到「未关联尺寸链」', async () => {
    opened.snapshot = (await createSpacerSnapshot({
      length: '12.00',
      confirmed: true,
      material: '',
    })) as unknown as ProjectOpenValue['snapshot']
    await openExample()
    fireEvent.click(screen.getByRole('tab', { name: '工程图' }))
    expect(await within(bench()).findByText('已确认生效')).toBeInTheDocument()

    fireEvent.click(within(bench()).getByRole('button', { name: '解除绑定' }))
    await waitFor(() => expect(api.unbindParameter).toHaveBeenCalled())
    await waitFor(() => expect(bench()).toHaveTextContent('未关联尺寸链'))

    const panel = bench()
    expect(within(panel).getByText(/未关联尺寸链：尚无参数绑定/)).toBeInTheDocument()
    expect(within(panel).queryByText('已确认生效')).toBeNull()
    expect(within(panel).queryByRole('button', { name: '解除绑定' })).toBeNull()
  })
})

describe('V3.5 复核区：任务书条款入口', () => {
  it('打开向导：双范围并列、固定链与待确认表单登记', async () => {
    await openExample()
    fireEvent.click(screen.getByRole('button', { name: /复核与变更/ }))
    const entry = await screen.findByRole('button', { name: '绑定任务书要求…' })
    fireEvent.click(entry)
    const dialog = await screen.findByRole('dialog', { name: '绑定任务书要求' })
    expect(within(dialog).getByText('原项目目标')).toBeInTheDocument()
    expect(within(dialog).getByText('任务书要求')).toBeInTheDocument()
    expect(within(dialog).getByText(/唯一判定依据/)).toBeInTheDocument()
    expect(within(dialog).getByText(/项目唯一轴向链/)).toBeInTheDocument()

    fireEvent.change(within(dialog).getByLabelText('条款原文'), {
      target: { value: '轴向装配间隙 C 应为 0.1000～0.3000 mm，含两端' },
    })
    fireEvent.change(within(dialog).getByLabelText('条款下限'), { target: { value: '0.1000' } })
    fireEvent.change(within(dialog).getByLabelText('条款上限'), { target: { value: '0.3000' } })
    expect(await within(dialog).findByText(/0\.100 ～ 0\.300 mm（闭区间/)).toBeInTheDocument()

    await waitFor(
      () => expect(api.stageRequirementEdit).toHaveBeenCalled(),
      { timeout: 2000 },
    )
    const lastCall = (api.stageRequirementEdit as unknown as { mock: { calls: unknown[][] } })
      .mock.calls.at(-1)![0] as { edit: { lowerText: string; upperText: string } }
    expect(lastCall.edit.lowerText).toBe('0.1000')
    expect(lastCall.edit.upperText).toBe('0.3000')

    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '绑定任务书要求' })).toBeNull())
  })
})

describe('V3.5 补缺：历史条款版本定位（复核区入口）', () => {
  async function openWithRequirementSnapshot(
    snapshot: Awaited<ReturnType<typeof createTwoVersionRequirementProject>>['snapshot'],
  ) {
    opened.snapshot = toSnapshotDto(snapshot) as unknown as ProjectOpenValue['snapshot']
    await openExample()
    fireEvent.click(screen.getByRole('button', { name: /复核与变更/ }))
    return screen.findByLabelText('条款版本历史')
  }

  it('建第二个版本后，旧版本仍打开自己的 PDF 版本与选区；两版本分别取各自值', async () => {
    const project = await createTwoVersionRequirementProject()
    const history = await openWithRequirementSnapshot(project.snapshot)

    fireEvent.click(within(history).getByTestId('locate-revision-requirement-history-reqrev-1'))
    expect(await screen.findByRole('tab', { name: '来源 PDF' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByLabelText('来源版本')).toHaveValue('sr-1')
    expect(screen.getByLabelText('页码跳转')).toHaveValue(2)
    let summary = await screen.findByTestId('requirement-locate-summary')
    expect(summary).toHaveTextContent('已定位任务书条款')
    expect(summary).toHaveTextContent('来源 PDF 第 1 版 第 2 页')
    expect(summary).toHaveTextContent('[10, 10, 110, 30]')

    fireEvent.click(within(history).getByTestId('locate-revision-requirement-history-reqrev-2'))
    expect(screen.getByLabelText('来源版本')).toHaveValue('sr-taskbook-2')
    expect(screen.getByLabelText('页码跳转')).toHaveValue(1)
    summary = await screen.findByTestId('requirement-locate-summary')
    expect(summary).toHaveTextContent('已定位任务书条款')
    expect(summary).toHaveTextContent('来源 PDF 第 1 版 第 1 页')
    expect(summary).toHaveTextContent('[20, 40, 220, 80]')
    // 两个版本不都指向活动版本。
    expect(within(history).getByTestId('requirement-history-row-reqrev-1')).toHaveTextContent('第 1 版')
    expect(within(history).getByTestId('requirement-history-row-reqrev-2')).toHaveTextContent('第 2 版')

    // 只读定位：不改活动条款，不触发任何写入。
    expect(api.confirmRequirement).not.toHaveBeenCalled()
    expect(api.stageRequirementEdit).not.toHaveBeenCalled()
    expect(api.applyChange).not.toHaveBeenCalled()
    expect(api.stageChangeDraft).not.toHaveBeenCalled()
    expect(api.saveProject).not.toHaveBeenCalled()

    // “历史报告”页也列出旧版本，不再只有活动条款。
    fireEvent.click(screen.getByRole('tab', { name: '历史报告' }))
    const historyPage = screen.getByTestId('history-requirement-section')
    expect(within(historyPage).getByTestId('history-requirement-row-reqrev-1')).toHaveTextContent(
      '第 1 版',
    )
  })

  it('关闭重开（项目文件编码/解码往返）后，旧版本仍定位到 sr-1 第 2 页', async () => {
    const project = await createTwoVersionRequirementProject()
    const encoded = await encodeProjectFile(project.snapshot)
    expect(encoded.ok, encoded.ok ? '' : encoded.error.message).toBe(true)
    if (!encoded.ok) return
    const decoded = await decodeProjectFile(encoded.value.bytes)
    expect(decoded.ok, decoded.ok ? '' : decoded.error.message).toBe(true)
    if (!decoded.ok) return

    const history = await openWithRequirementSnapshot(decoded.value.snapshot)
    fireEvent.click(within(history).getByTestId('locate-revision-requirement-history-reqrev-1'))
    expect(screen.getByLabelText('来源版本')).toHaveValue('sr-1')
    expect(screen.getByLabelText('页码跳转')).toHaveValue(2)
    const summary = await screen.findByTestId('requirement-locate-summary')
    expect(summary).toHaveTextContent('已定位任务书条款')
    expect(summary).toHaveTextContent('[10, 10, 110, 30]')
  })

  it('旧版本来源被删时明确说明原因、不打开任何 PDF、不用活动版本顶替', async () => {
    const project = await createTwoVersionRequirementProject()
    const missing = {
      ...project.snapshot,
      revisions: project.snapshot.revisions.filter((item) => item.id !== 'sr-1'),
    }
    const history = await openWithRequirementSnapshot(missing)
    expect(within(history).getByTestId('requirement-history-row-reqrev-1')).toHaveTextContent(
      '来源缺失',
    )

    fireEvent.click(within(history).getByTestId('locate-revision-requirement-history-reqrev-1'))
    const error = await screen.findByTestId('requirement-locate-error')
    expect(error).toHaveTextContent('来源缺失')
    expect(error).not.toHaveTextContent('sr-1')
    expect(error).toHaveTextContent('不在项目文件中')
    // 没有渲染 PDF 查看器（不会静默打开另一个版本）。
    expect(document.querySelector('.pdf-viewer')).toBeNull()
    expect(screen.getByLabelText('来源版本')).not.toHaveValue('sr-taskbook-2')
    expect(api.readAttachment).not.toHaveBeenCalled()
    expect(api.confirmRequirement).not.toHaveBeenCalled()
    expect(api.applyChange).not.toHaveBeenCalled()
  })
})

describe('V3.6 任务书提取页', () => {
  it('显示规则版本/样本限制，提取只传确切 revision 与页范围（不传路径或字节）', async () => {
    await openExample()
    fireEvent.click(screen.getByRole('tab', { name: '任务书提取' }))
    const panel = await screen.findByRole('tabpanel', { name: /任务书提取/ })
    expect(within(panel).getByText(/只验证过 1 份自造样例/)).toBeInTheDocument()
    expect(within(panel).getByText(/不做 OCR、DOCX、图片识别或联网识别/)).toBeInTheDocument()
    expect(within(panel).getByText(/未确认前不参与任何计算/)).toBeInTheDocument()

    fireEvent.click(within(panel).getByRole('button', { name: '提取候选' }))
    await waitFor(() => expect(api.runExtraction).toHaveBeenCalledTimes(1))
    const request = vi.mocked(api.runExtraction).mock.calls[0]![0]
    expect(request).toMatchObject({
      sessionId: 'session-1',
      revisionId: 'sr-1',
      pageFrom: 1,
      pageTo: 2,
    })
    const raw = request as unknown as Record<string, unknown>
    expect(raw).not.toHaveProperty('path')
    expect(raw).not.toHaveProperty('bytes')
    expect(raw).not.toHaveProperty('sha256')
    // mock 明确失败：面板必须展示错误，而不是假装提取成功。
    expect(await within(panel).findByRole('alert')).toHaveTextContent('SOURCE_NOT_FOUND')
  })
})

describe('V3.6 补缺：提取入口角标（未决计数）', () => {
  type Snapshot = ProjectOpenValue['snapshot']

  /** 用项目文件里的真实提取草稿（合成文本层 → 领域解析，4 待确认 + 1 阻塞）。 */
  async function withDrafts(base: Snapshot): Promise<{ snapshot: Snapshot; draft: ExtractionDraft }> {
    const revision = base.revisions[0]!
    const draft = buildSyntheticExtractionDraft({
      projectId: base.project.id,
      baseToken: `base-${base.project.id}`,
      source: {
        documentId: revision.documentId,
        revisionId: revision.id,
        sha256: revision.sha256,
        blobKey: revision.blobKey,
        pageCount: revision.pageCount,
      },
    })
    return {
      snapshot: { ...base, project: { ...base.project, extractionDrafts: [draft] } },
      draft,
    }
  }

  /** 全部处理：待确认逐条确认，阻塞拒绝（阻塞不能确认）。 */
  function decideAll(draft: ExtractionDraft): ExtractionDraft {
    let current = draft
    for (const candidate of draft.candidates) {
      const result = candidate.status === 'pending'
        ? confirmCandidate(current, {
            candidateId: candidate.candidateId,
            editRevision: candidate.editRevision,
            confirmed: true,
            actor: 'local-operator',
            decidedAt: '2026-11-10T10:00:00.000Z',
          })
        : candidate.status === 'blocked'
          ? rejectCandidate(current, {
              candidateId: candidate.candidateId,
              editRevision: candidate.editRevision,
              actor: 'local-operator',
              decidedAt: '2026-11-10T10:00:00.000Z',
              reason: '不支持运算符，改人工录入',
            })
          : { ok: true as const, value: current }
      if (!result.ok) throw new Error(`决定失败：${result.code}`)
      current = result.value
    }
    return current
  }

  it('有未决项：入口角标显示待确认/阻塞数，title 一句话可读，面板不自动展开也不自动提取', async () => {
    const prepared = await withDrafts(await createSampleSnapshot())
    opened.snapshot = prepared.snapshot

    await openExample()

    const badge = screen.getByTestId('extraction-pending-badge')
    expect(badge).toHaveTextContent('待确认 4 · 阻塞 1')
    const tab = screen.getByRole('tab', { name: '任务书提取' })
    expect(tab).toHaveAttribute('title', '有 5 项提取候选待处理（4 待确认、1 阻塞）')
    expect(tab).toHaveAttribute('aria-describedby', 'desktop-extraction-pending-desc')
    expect(screen.getByText('有 5 项提取候选待处理（4 待确认、1 阻塞）')).toBeInTheDocument()

    // 不自动展开面板：提取页仍然隐藏在 tab 之后，且没有触发任何提取。
    expect(screen.getByRole('tab', { name: '任务书提取' })).toHaveAttribute('aria-selected', 'false')
    expect(document.getElementById('desktop-panel-5')!.hidden).toBe(true)
    expect(screen.getByRole('tabpanel', { name: '工程图' })).toBeVisible()
    expect(api.runExtraction).not.toHaveBeenCalled()
  })

  it('已确认/已拒绝全部处理完：角标消失（不显示 0 或空徽标）', async () => {
    const prepared = await withDrafts(await createSampleSnapshot())
    const decided = decideAll(prepared.draft)
    expect(decided.candidates.map((candidate) => candidate.status)).toEqual([
      'confirmed',
      'confirmed',
      'confirmed',
      'confirmed',
      'rejected',
    ])
    opened.snapshot = { ...prepared.snapshot, project: { ...prepared.snapshot.project, extractionDrafts: [decided] } }

    await openExample()

    expect(screen.queryByTestId('extraction-pending-badge')).toBeNull()
    const tab = screen.getByRole('tab', { name: '任务书提取' })
    expect(tab).not.toHaveAttribute('title')
    expect(tab).not.toHaveAttribute('aria-describedby')
    expect(document.querySelector('.desktop-workspace__tab-badge')).toBeNull()
    expect(screen.queryByText(/待确认 0|阻塞 0/)).toBeNull()
  })

  it('关闭重开（项目文件编码/解码往返）：角标与数字保持一致', async () => {
    const prepared = await withDrafts(await createSampleSnapshot())
    const encoded = await encodeProjectFile(prepared.snapshot as unknown as import('../project-file/types').ProjectFileSnapshot)
    expect(encoded.ok, encoded.ok ? '' : encoded.error.message).toBe(true)
    if (!encoded.ok) return
    const decoded = await decodeProjectFile(encoded.value.bytes)
    expect(decoded.ok, decoded.ok ? '' : decoded.error.message).toBe(true)
    if (!decoded.ok) return
    const reopened = decoded.value.snapshot
    const candidates = reopened.project.extractionDrafts[0]!.candidates
    expect(candidates.filter((candidate) => candidate.status === 'pending')).toHaveLength(4)
    expect(candidates.filter((candidate) => candidate.status === 'blocked')).toHaveLength(1)

    opened.snapshot = toSnapshotDto(reopened) as unknown as Snapshot
    await openExample()

    expect(screen.getByTestId('extraction-pending-badge')).toHaveTextContent('待确认 4 · 阻塞 1')
    expect(screen.getByRole('tab', { name: '任务书提取' })).toHaveAttribute(
      'title',
      '有 5 项提取候选待处理（4 待确认、1 阻塞）',
    )
  })
})
