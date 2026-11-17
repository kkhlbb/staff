/** 仅供“导出已保存版本”：不保存项目，不改变普通草稿导出策略。 */
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { rebuildDrawingFromProject } from '../../src/drawing/rebuildDrawing'
import { renderDrawingSvg, validateDrawingSvgMarkup } from '../../src/drawing/renderDrawingSvg'
import { USER_INPUT_FILE_SUFFIX } from '../../src/drawing/types'
import { decodeProjectFile } from '../../src/project-file/codec'
import type { AgentExportValue, ToolResult } from '../shared/contracts'
import type { AgentToolDeps } from './agentToolService'
import { DrawingExportStore } from './drawingExportStore'

/** 在入队前捕获身份/序号；执行时和每个异步阶段后重新核对。 */
export function createSavedVersionExport(
  deps: Pick<AgentToolDeps, 'controller' | 'projectService' | 'exportPorts'>,
  windowId: number,
  format: 'pdf' | 'svg',
): () => Promise<ToolResult<AgentExportValue>> {
  const requestId = randomUUID()
  const session = deps.controller.sessionFor(windowId)
  const objectVersion = session?.snapshot.project.currentRevisionId ?? 'unavailable'
  const sourcePath = session?.path
  const sourceFingerprint = session?.fingerprint
  const acceptedSeq = session?.acceptedSeq
  const savedSeq = session?.savedSeq
  const snapshot = session?.snapshot
  const initiallyDirty = session !== null && deps.controller.isDirty(session)
  const failure = (code: 'STALE_BASE' | 'SAVE_FAILED' | 'CANCELLED' | 'TOOL_FAILED' | 'UNSUPPORTED_SCOPE', message: string): ToolResult<AgentExportValue> => ({ ok: false, code, message, requestId, objectVersion })
  const unchanged = (): boolean => session !== null
    && !deps.controller.isDirty(session)
    && deps.controller.sessionFor(windowId) === session
    && session.acceptedSeq === acceptedSeq && session.savedSeq === savedSeq
    && session.path === sourcePath && session.fingerprint === sourceFingerprint
    && session.snapshot === snapshot
  const cancelled = (): ToolResult<AgentExportValue> => failure('CANCELLED', '导出期间项目出现新编辑或已切换，已取消；请先保存后重新导出，没有产生导出文件')

  return async () => {
    if (session === null) return failure('STALE_BASE', '没有活动项目')
    if (initiallyDirty) return failure('SAVE_FAILED', '有未保存修改，请先保存后导出已保存版本')
    if (!unchanged()) return cancelled()
    // main 的 clean 不代表 renderer 没有 debounce 中的编辑。共享入口强制屏障，
    // 不持有 projectService 会话锁（stage 必须能够接纳），也绝不自动保存。
    const barrier = await deps.controller.flushPendingEdits(windowId)
    if (!barrier.ok) return failure('SAVE_FAILED', `编辑屏障未完成，请先保存后重试；未导出（${barrier.error.code}）`)
    if (deps.controller.sessionFor(windowId) !== session) return cancelled()
    if (deps.controller.isDirty(session)) return failure('SAVE_FAILED', '有未保存修改，请先保存后导出已保存版本')
    if (!unchanged()) return cancelled()
    if (sourcePath == null || sourceFingerprint == null) return failure('SAVE_FAILED', '当前项目尚未保存，请先保存后导出已保存版本')
    const ports = deps.exportPorts
    if (ports === undefined) return failure('UNSUPPORTED_SCOPE', '导出端口未装配')
    const read = await deps.projectService.readProjectBytes(sourcePath)
    if (!unchanged()) return cancelled()
    if (!read.ok || read.value.fingerprint !== sourceFingerprint) return failure('STALE_BASE', '已保存文件无法读取或已被外部修改，请重新打开后导出')
    const decoded = await decodeProjectFile(read.value.bytes)
    if (!unchanged()) return cancelled()
    if (!decoded.ok || decoded.value.snapshot.project.id !== snapshot!.project.id) return failure('SAVE_FAILED', '已保存文件校验失败，未导出')
    const savedProject = decoded.value.snapshot.project
    const revisionId = savedProject.currentRevisionId
    const rebuilt = rebuildDrawingFromProject(savedProject)
    if (!rebuilt.ok) return failure('TOOL_FAILED', `图纸无法重建：${rebuilt.message}`)
    const drawing = rebuilt.data
    const svg = renderDrawingSvg(drawing)
    let bytes: Uint8Array
    if (format === 'svg') bytes = new TextEncoder().encode(svg)
    else {
      if (ports.renderPdf === undefined) return failure('UNSUPPORTED_SCOPE', 'PDF 渲染端口未装配，改用 svg')
      try { bytes = await ports.renderPdf(windowId, svg, drawing) }
      catch { return unchanged() ? failure('TOOL_FAILED', 'PDF 渲染失败，未产生文件') : cancelled() }
      if (!unchanged()) return cancelled()
    }
    const suffix = savedProject.sourceKind === 'user-intent' ? USER_INPUT_FILE_SUFFIX : ''
    const suggested = `${savedProject.name}${suffix}-${revisionId.slice(0, 8)}.${format}`
    const target = await ports.pickTarget(windowId, suggested)
    if (!unchanged()) return cancelled()
    if (target === null) return failure('CANCELLED', '已在系统对话框中取消导出；没有产生文件')
    const store = ports.store ?? new DrawingExportStore()
    const existing = await store.fingerprint(target)
    if (!unchanged()) return cancelled()
    // 系统对话框/生成期间的新本地编辑也必须接纳后再复核，仍然不占事务锁。
    const commitBarrier = await deps.controller.acquireExportLease(windowId)
    if (!commitBarrier.ok) return cancelled()
    const lease = commitBarrier.value
    try {
      if (!lease.valid() || !unchanged()) return cancelled()
      // 租约覆盖 store 的所有 await，不再把瞬时 flush 当作持续编辑边界。
      // renderer 新 edit 排队，尚不更新其权威快照/序号；其他编辑请求明确拒绝。
      // main 已到达的编辑仍受原会话事务/dirty 检查保护。线性化点是 rename 调用。
      return await deps.projectService.transaction(session.sessionId, async () => {
        if (!lease.valid() || !unchanged()) return cancelled()
        const saved = await store.save({
          targetPath: target, kind: format, bytes, expectedFingerprint: existing,
          canCommit: () => lease.valid() && unchanged(),
          verify: async written => {
            if (format === 'svg') {
              const report = validateDrawingSvgMarkup(new TextDecoder().decode(written), drawing)
              return report.ok ? { ok: true } : { ok: false, message: report.errors.join('；') }
            }
            return new TextDecoder().decode(written.slice(0, 5)) === '%PDF-'
              ? { ok: true } : { ok: false, message: '导出内容不是 PDF' }
          },
        })
        if (!saved.ok) return saved.error.code === 'BUSY' && (!lease.valid() || !unchanged())
          ? cancelled() : failure('SAVE_FAILED', `${saved.error.message}（${saved.error.code}）`)
        return { ok: true, data: { status: 'EXPORTED', fileName: path.basename(target), byteSize: bytes.byteLength, sha256: saved.value.fingerprint, revisionId }, requestId, objectVersion: revisionId }
      })
    } finally { lease.release() }
  }
}
