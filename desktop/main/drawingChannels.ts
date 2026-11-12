/**
 * C：隔套图纸 IPC（drawing:update-spacer / drawing:export-pdf / drawing:export-svg）。
 *
 * 每个通道都走 installChannel：sender 白名单 → strict schema → handler → 统一包络。
 * renderer 只能传会话、编辑序号、十进制字符串、登记比例与图框技术字段；不能传
 * 路径、SVG/bitmap、打印选项或图元数组。main 重新解析 q、重建 DrawingData 并
 * 原子接纳参数与图纸引用。
 */
import { z } from 'zod'
import type {
  DrawingExportValue,
  DrawingUpdateValue,
  IpcErrorCode,
  ProjectStageValue,
} from '../shared/contracts'
import { IPC_CHANNELS } from '../shared/contracts'
import { buildSpacerDrawing, draftVersionText, DrawingBuildError } from '../../src/drawing/spacerDrawing'
import { renderDrawingSvg, validateDrawingSvgMarkup } from '../../src/drawing/renderDrawingSvg'
import { DxfExportError, buildDxfDocument, validateDxfBytes } from '../../src/drawing/dxfExport'
import { USER_INPUT_BASIS, USER_INPUT_FILE_SUFFIX } from '../../src/drawing/types'
import { SPACER_PART_ID, scaleKey, type DrawingData } from '../../src/drawing/types'
import { parseSpacerParameters } from '../../src/parts/spacerParameters'
import type { ProjectFileDrawingRecord } from '../../src/project-file/types'
import { IpcFailure, installChannel, type IpcDeps, type IpcMainLike } from './ipc'
import type { SenderGuard } from './senderGuard'
import type { ProjectService } from './projectService'
import type { RecoveryStore } from './recovery'
import type { DrawingExportStore, DrawingExportKind } from './drawingExportStore'
import { checkPdf } from './pdfCheck'
import { toSnapshotDto } from '../../src/project-file/codec'
import type { SessionController } from './sessionController'

const idLike = z
  .string()
  .min(1)
  .max(240)
  .refine((value) => !value.includes('/') && !value.includes('\\') && !value.includes('\u0000'), {
    message: 'ID 不能是路径',
  })

const drawingSchemas = {
  updateSpacer: z
    .object({
      sessionId: z.string().min(1).max(200),
      baseEditSeq: z.number().int().nonnegative(),
      partId: idLike,
      inputs: z
        .object({
          innerDiameter: z.string().max(32),
          outerDiameter: z.string().max(32),
          length: z.string().max(32),
        })
        .strict(),
      scale: z
        .object({
          numerator: z.number().int().positive(),
          denominator: z.number().int().positive(),
        })
        .strict(),
      frameFields: z
        .object({
          partName: z.string().max(200),
          drawingNumber: z.string().max(200),
          version: z.string().max(200),
          material: z.string().max(200),
          tolerance: z.string().max(200),
          surface: z.string().max(200),
          drafter: z.string().max(200),
          date: z.string().max(200),
        })
        .strict(),
    })
    .strict(),
  exportDrawing: z
    .object({
      sessionId: z.string().min(1).max(200),
      baseEditSeq: z.number().int().nonnegative(),
      drawingId: idLike,
      drawingFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    })
    .strict(),
} as const

export interface DrawingChannelDeps {
  guard: SenderGuard
  controller: SessionController
  projectService: ProjectService
  recovery: RecoveryStore
  exportStore: DrawingExportStore
  /** 系统保存对话框；取消返回 null。只允许 main 决定路径。 */
  pickExportPath: (
    windowId: number,
    kind: DrawingExportKind,
    suggestedName: string,
  ) => Promise<string | null>
  /** 目标已存在时的显式覆盖确认；返回 false 即取消。 */
  confirmOverwrite: (windowId: number, targetPath: string) => Promise<boolean>
  /** 隐藏打印窗口 + printToPDF；返回真实 PDF 字节。 */
  printPdf: (data: DrawingData) => Promise<Uint8Array>
  log?: IpcDeps['log']
}

function reject(code: IpcErrorCode, message: string, detail?: string): never {
  throw new IpcFailure(code, message, detail)
}

function mapBuildError(error: unknown): never {
  if (error instanceof DrawingBuildError) {
    const code =
      error.code === 'DRAWING_OVERFLOW'
        ? 'DRAWING_OVERFLOW'
        : error.code === 'PART_NAME_REQUIRED' || error.code === 'INVALID_DRAWING'
          ? 'INVALID_DRAWING'
          : 'INVALID_PARAMETER'
    reject(code, error.message, error.detail)
  }
  throw error
}

function sanitizeSuggestedName(name: string): string {
  const cleaned = [...name]
    .map((character) =>
      character.charCodeAt(0) < 32 || '/\\:*?"<>|'.includes(character) ? '_' : character,
    )
    .join('')
    .trim()
  return (cleaned === '' ? '隔套图纸' : cleaned).slice(0, 80)
}

function drawingRecordOf(data: DrawingData, frameFields: {
  partName: string
  drawingNumber: string
  version: string
  material: string
  tolerance: string
  surface: string
  drafter: string
  date: string
}): ProjectFileDrawingRecord {
  return {
    drawingId: data.drawingId,
    drawingDataVersion: 1,
    templateId: data.templateId,
    templateVersion: data.templateVersion,
    partId: data.partId,
    revisionId: data.revisionId,
    parameterIds: data.parameterSnapshot.map((item) => item.parameterId),
    paper: data.paper,
    scale: data.scale,
    frameFields,
    status: 'pending-review-draft',
    dataFingerprint: data.fingerprint,
  }
}

export function registerDrawingChannels(ipc: IpcMainLike, deps: DrawingChannelDeps): void {
  const ipcDeps: IpcDeps = { guard: deps.guard, log: deps.log }
  const busySessions = new Set<string>()

  function requireActive(windowId: number, sessionId: string) {
    if (deps.controller.sessionIdFor(windowId) !== sessionId) {
      reject('STALE_SESSION', '会话已失效，请重新打开项目')
    }
    const session = deps.projectService.getSession(sessionId)
    if (session === null) {
      reject('STALE_SESSION', '会话已失效，请重新打开项目')
    }
    return session
  }

  function rebuildAuthoritative(
    projectId: string,
    record: ProjectFileDrawingRecord,
    parameters: Parameters<typeof buildSpacerDrawing>[0]['parameters'],
    revisionId: string,
  ): DrawingData {
    try {
      return buildSpacerDrawing({
        projectId,
        revisionId,
        drawingId: record.drawingId,
        parameters,
        scale: record.scale,
        frameFields: record.frameFields,
      })
    } catch (error) {
      mapBuildError(error)
    }
  }

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.drawingUpdateSpacer,
      schema: drawingSchemas.updateSpacer,
      handle: async ({ sender }, params): Promise<DrawingUpdateValue> => {
        const windowId = sender.webContentsId
        const session = requireActive(windowId, params.sessionId)
        if (params.partId !== SPACER_PART_ID) {
          reject('INVALID_PARAMETER', '只支持隔套部件', params.partId)
        }
        if (params.baseEditSeq !== session.acceptedSeq) {
          reject(
            'STALE_EDIT',
            '编辑序号已过期，请基于最新状态重试',
            `acceptedSeq=${session.acceptedSeq}, baseEditSeq=${params.baseEditSeq}`,
          )
        }
        const parsed = parseSpacerParameters(params.inputs)
        if (!parsed.ok) {
          reject(
            'INVALID_PARAMETER',
            `${parsed.field}：${parsed.message}`,
            `${parsed.field}/${parsed.reason}`,
          )
        }
        const project = session.snapshot.project
        const drawingId = `drawing:${project.id}:spacer`
        // 版本栏：留空时写可读的「草稿 · 第 N 版」（当前版本序号），并随图纸记录持久化；
        // 内部 revision UUID 只留在项目文件里，不印到图上。
        const frameFields = {
          ...params.frameFields,
          version: params.frameFields.version.trim() === ''
            ? draftVersionText(session.snapshot.fileRevisions.length)
            : params.frameFields.version.trim(),
        }
        let data: DrawingData
        try {
          data = buildSpacerDrawing({
            projectId: project.id,
            revisionId: project.currentRevisionId,
            drawingId,
            parameters: parsed.parameters,
            scale: params.scale,
            frameFields,
          })
        } catch (error) {
          mapBuildError(error)
        }
        const previous = new Map(
          project.parameters.map((item) => [item.parameterId, item.parameterRevision]),
        )
        const parameters = parsed.parameters.map((item) => ({
          ...item,
          // C 通道不改变参数修订号语义：沿用已有修订号，新参数从 1 起。
          parameterRevision: previous.get(item.parameterId) ?? 1,
        }))
        const record = drawingRecordOf(data, frameFields)
        const applied = deps.projectService.applySpacerDrawing(
          session.sessionId,
          params.baseEditSeq,
          parameters,
          record,
        )
        if (!applied.ok) {
          reject(applied.error.code, applied.error.message, applied.error.detail)
        }
        const current = deps.projectService.getSession(session.sessionId)
        if (current === null) {
          reject('STALE_SESSION', '会话已失效，请重新打开项目')
        }
        const recoveryOutcome = await deps.recovery.stage(
          session.sessionId,
          current.snapshot,
          applied.value.acceptedSeq,
          deps.controller.recoveryMeta(current, current.snapshot),
        )
        const value: DrawingUpdateValue = {
          acceptedSeq: applied.value.acceptedSeq,
          drawingId,
          drawingFingerprint: data.fingerprint,
          drawingData: data,
          snapshot: toSnapshotDto(current.snapshot),
          recovery: recoveryOutcome.state,
        }
        if (recoveryOutcome.warning !== undefined) value.warning = recoveryOutcome.warning
        return value
      },
    },
    ipcDeps,
  )

  async function exportDrawing(
    windowId: number,
    kind: DrawingExportKind,
    params: z.infer<typeof drawingSchemas.exportDrawing>,
  ): Promise<DrawingExportValue> {
    const session = requireActive(windowId, params.sessionId)
    if (params.baseEditSeq !== session.acceptedSeq) {
      reject(
        'STALE_EDIT',
        '导出请求已过期，请基于最新图纸重试',
        `acceptedSeq=${session.acceptedSeq}, baseEditSeq=${params.baseEditSeq}`,
      )
    }
    if (busySessions.has(session.sessionId)) {
      reject('BUSY', '已有导出任务进行中，请稍候')
    }
    const project = session.snapshot.project
    const record = project.drawings.find((item) => item.drawingId === params.drawingId)
    if (record === undefined) {
      reject('DRAWING_NOT_FOUND', '当前项目没有该图纸草稿')
    }
    if (record.dataFingerprint !== params.drawingFingerprint) {
      reject('STALE_DRAWING', '图纸已更新，导出请求基于旧指纹')
    }
    const data = rebuildAuthoritative(project.id, record, project.parameters, record.revisionId)
    if (data.fingerprint !== params.drawingFingerprint) {
      reject('INVALID_DRAWING', '重建的图纸指纹与请求不一致')
    }

    // DXF：在“选路径”之前就生成字节——数据非法时不会弹对话框，也不会留下半截文件。
    const dxfVersion = kind === 'dxf-r12' ? 'r12' : kind === 'dxf-2000' ? '2000' : null
    let dxfBytes: Uint8Array | null = null
    if (dxfVersion !== null) {
      try {
        dxfBytes = buildDxfDocument(data, dxfVersion).bytes
      } catch (error) {
        if (error instanceof DxfExportError) {
          reject(
            error.code === 'UNSUPPORTED_VERSION' ? 'INVALID_PARAMETER' : 'INVALID_DRAWING',
            `DXF 生成失败：${error.message}`,
            error.detail,
          )
        }
        throw error
      }
    }

    const svg = dxfVersion === null ? renderDrawingSvg(data) : null
    if (svg !== null) {
      const svgCheck = validateDrawingSvgMarkup(svg, data)
      if (!svgCheck.ok) {
        reject('INVALID_DRAWING', 'SVG 结构校验失败', svgCheck.errors.join('；'))
      }
    }

    busySessions.add(session.sessionId)
    try {
      const baseName = sanitizeSuggestedName(
        `${record.frameFields.partName || '隔套'}-图纸-${scaleKey(record.scale).replace(':', '_')}`,
      ) + (record.frameFields.basis === USER_INPUT_BASIS ? USER_INPUT_FILE_SUFFIX : '')
      const suffix =
        kind === 'dxf-r12' ? '-DXF-R12.dxf' : kind === 'dxf-2000' ? '-DXF-2000.dxf' : `.${kind}`
      const target = await deps.pickExportPath(
        windowId,
        kind,
        `${baseName}${suffix}`,
      )
      if (target === null) {
        reject('CANCELLED', '已取消选择导出位置')
      }
      const existing = await deps.exportStore.fingerprint(target)
      if (existing !== null) {
        const confirmed = await deps.confirmOverwrite(windowId, target)
        if (!confirmed) {
          reject('CANCELLED', '已取消覆盖已有文件')
        }
      }

      let bytes: Uint8Array
      if (kind === 'svg') {
        bytes = new TextEncoder().encode(svg as string)
      } else if (dxfVersion !== null) {
        bytes = dxfBytes as Uint8Array
      } else {
        try {
          bytes = await deps.printPdf(data)
        } catch (error) {
          if (error instanceof IpcFailure) throw error
          reject(
            'PDF_EXPORT_FAILED',
            '打印视图生成 PDF 失败',
            error instanceof Error ? error.message : String(error),
          )
        }
      }

      const saved = await deps.exportStore.save({
        targetPath: target,
        kind,
        bytes,
        expectedFingerprint: existing,
        verify: async (written) => {
          if (kind === 'pdf') {
            const report = checkPdf(written)
            if (!report.ok) {
              return { ok: false, message: report.errors.join('；') }
            }
            return { ok: true }
          }
          if (dxfVersion !== null) {
            const report = validateDxfBytes(written, data, dxfVersion)
            return report.ok ? { ok: true } : { ok: false, message: report.errors.join('；') }
          }
          const text = new TextDecoder().decode(written)
          const report = validateDrawingSvgMarkup(text, data)
          return report.ok ? { ok: true } : { ok: false, message: report.errors.join('；') }
        },
      })
      if (!saved.ok) {
        reject(saved.error.code, saved.error.message, saved.error.detail)
      }
      const fileName = target.split(/[\\/]/).pop() ?? target
      return {
        fileName,
        byteSize: bytes.byteLength,
        sha256: saved.value.fingerprint,
        drawingId: data.drawingId,
        drawingFingerprint: data.fingerprint,
      }
    } finally {
      busySessions.delete(session.sessionId)
    }
  }

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.drawingExportPdf,
      schema: drawingSchemas.exportDrawing,
      handle: async ({ sender }, params) => exportDrawing(sender.webContentsId, 'pdf', params),
    },
    ipcDeps,
  )

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.drawingExportSvg,
      schema: drawingSchemas.exportDrawing,
      handle: async ({ sender }, params) => exportDrawing(sender.webContentsId, 'svg', params),
    },
    ipcDeps,
  )

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.drawingExportDxfR12,
      schema: drawingSchemas.exportDrawing,
      handle: async ({ sender }, params) => exportDrawing(sender.webContentsId, 'dxf-r12', params),
    },
    ipcDeps,
  )

  installChannel(
    ipc,
    {
      channel: IPC_CHANNELS.drawingExportDxf2000,
      schema: drawingSchemas.exportDrawing,
      handle: async ({ sender }, params) => exportDrawing(sender.webContentsId, 'dxf-2000', params),
    },
    ipcDeps,
  )
}

/** 测试用：验证更新通道的恢复状态形状与 stage 一致。 */
export type DrawingStageResult = ProjectStageValue
